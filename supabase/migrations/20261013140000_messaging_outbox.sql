-- Transactional WhatsApp messaging owned by FindMed (block B7; decisions A5, D8,
-- R33–R38 in docs/findmed-migration).
--
-- Until now every domain event went to dispatch-webhook → n8n, and n8n chose
-- and sent the WHAAPY template. This migration adds what FindMed needs to do it
-- itself, one event type at a time, with a single owner per event (R38):
--
--  * message_routes: owner of each event type — 'n8n' (current behavior, the
--    default for every event), 'findmed' (outbox + worker) or 'none'.
--    dispatch-webhook reads it; switching an event to 'findmed' stops the n8n
--    webhooks for that event, so the patient never gets the message twice.
--  * message_route_steps: which templates each event sends, in order, with
--    their parameters. Seeded with the n8n flows (fixing N30: parameters are
--    an array, the reschedule template gets its 5 values in template order).
--    Editable from the admin messaging center (B7b).
--  * domain_outbox: one row per event to deliver (unique dedupe_key, so a
--    repeated emit is a no-op). Claimed by the worker with SKIP LOCKED and a
--    lease; retried with backoff; a stale event is skipped, not sent.
--  * message_deliveries: one row per (event, step) sent to WHAAPY, with the
--    provider ids and the receipts (sent → delivered → read / failed). A step
--    already accepted is never sent again; a lost response is 'uncertain' and
--    waits for a person instead of risking a duplicate (WHAAPY has no
--    idempotency key, N23).
--
-- Writes only by Edge Functions with the service key; admins read via RLS.

-- 1. Routes ------------------------------------------------------------------

CREATE TABLE public.message_routes (
  event_type text PRIMARY KEY,
  owner text NOT NULL DEFAULT 'n8n' CHECK (owner IN ('n8n', 'findmed', 'none')),
  description text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_message_routes_updated_at
  BEFORE UPDATE ON public.message_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.message_route_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL REFERENCES public.message_routes(event_type) ON DELETE CASCADE,
  -- Only for appointment.status_changed: which new status this step applies to.
  when_status text CHECK (when_status IN ('scheduled', 'confirmed', 'cancelled', 'completed')),
  -- Extra guard for cancellations: only when cancel_reason matches (e.g. 'patient').
  when_cancel_reason text,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 20),
  template_name text NOT NULL,
  language text NOT NULL DEFAULT 'es_MX',
  -- Ordered body variables; each one a key the worker knows how to fill
  -- (patient_name, start_local, previous_start_local, doctor_name,
  -- office_address, min_confirm_hours).
  body_params text[] NOT NULL DEFAULT '{}',
  -- URL button suffix ({{1}} of the button). 'manage_token' = /gestionar token.
  url_button_param text CHECK (url_button_param IN ('manage_token')),
  -- Quick-reply payload override: '<action>:<appointment_id>' (A6, N24).
  quick_reply_action text CHECK (quick_reply_action IN ('confirm', 'cancel')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX message_route_steps_order
  ON public.message_route_steps (event_type, coalesce(when_status, ''), position);

CREATE TRIGGER update_message_route_steps_updated_at
  BEFORE UPDATE ON public.message_route_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Outbox and deliveries ------------------------------------------------------

CREATE TABLE public.domain_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_id uuid,                      -- appointment id
  payload jsonb NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed', 'uncertain')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_domain_outbox_due ON public.domain_outbox (next_attempt_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX idx_domain_outbox_aggregate ON public.domain_outbox (aggregate_id, created_at);

CREATE TRIGGER update_domain_outbox_updated_at
  BEFORE UPDATE ON public.domain_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.message_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid REFERENCES public.domain_outbox(id) ON DELETE SET NULL,
  step_position integer,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  to_phone text NOT NULL,
  template_name text NOT NULL,
  language text NOT NULL DEFAULT 'es_MX',
  request jsonb,                          -- body sent to WHAAPY (no secrets)
  status text NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'uncertain')),
  whaapy_message_id text,
  wamid text,
  error_code text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'worker' CHECK (source IN ('worker', 'manual')),
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A step of an event is delivered at most once (manual resends have no outbox row).
CREATE UNIQUE INDEX message_deliveries_one_per_step
  ON public.message_deliveries (outbox_id, step_position) WHERE outbox_id IS NOT NULL;
CREATE INDEX idx_message_deliveries_whaapy ON public.message_deliveries (whaapy_message_id)
  WHERE whaapy_message_id IS NOT NULL;
CREATE INDEX idx_message_deliveries_appointment ON public.message_deliveries (appointment_id, created_at);

CREATE TRIGGER update_message_deliveries_updated_at
  BEFORE UPDATE ON public.message_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Atomic claim for the worker ---------------------------------------------

-- Claims up to p_limit due rows (or rows whose lease expired), so two worker
-- runs never process the same event at the same time.
CREATE OR REPLACE FUNCTION public.claim_outbox(p_limit integer, p_lease_seconds integer)
RETURNS SETOF public.domain_outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.domain_outbox o
     SET status = 'processing',
         attempts = o.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds)
   WHERE o.id IN (
     SELECT id FROM public.domain_outbox
      WHERE (status = 'pending' AND next_attempt_at <= now())
         OR (status = 'processing' AND locked_until < now())
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*;
$$;

REVOKE ALL ON FUNCTION public.claim_outbox(integer, integer) FROM PUBLIC, anon, authenticated;

-- 4. RLS -----------------------------------------------------------------------

ALTER TABLE public.message_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_route_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read message routes" ON public.message_routes
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Admins can read message route steps" ON public.message_route_steps
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Admins can read outbox" ON public.domain_outbox
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Admins can read message deliveries" ON public.message_deliveries
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));

-- 5. Seed: current n8n behavior, every event still owned by n8n --------------

INSERT INTO public.message_routes (event_type, owner, description) VALUES
  ('appointment.status_changed',       'n8n',  'EV01 · Cambio de estado (reservada, confirmada, cancelada por paciente, completada)'),
  ('appointment.cancelled_by_doctor',  'n8n',  'EV02 · Cancelación del doctor'),
  ('appointment.reminder_48h',         'n8n',  'EV03 · Recordatorio 48 h con confirmación'),
  ('appointment.auto_cancelled',       'n8n',  'EV04 · Cancelación automática por no confirmar'),
  ('appointment.reminder_day_of',      'n8n',  'EV05 · Recordatorio del día de la cita'),
  ('postconsultation.submitted',       'n8n',  'EV06 · Formulario post-consulta (interno, sin mensaje al paciente)'),
  ('postconsultation.report_sent',     'n8n',  'EV07 · Envío de informe (interno, sin mensaje al paciente)'),
  ('appointment.rescheduled_by_staff', 'n8n',  'EV08 · Reagendada por el consultorio');

INSERT INTO public.message_route_steps
  (event_type, when_status, when_cancel_reason, position, template_name, body_params, url_button_param, quick_reply_action)
VALUES
  ('appointment.status_changed', 'scheduled', NULL, 1, 'reservada_estado_cita', '{}', 'manage_token', NULL),
  ('appointment.status_changed', 'scheduled', NULL, 2, 'pedir_documentos', '{}', NULL, NULL),
  ('appointment.status_changed', 'confirmed', NULL, 1, 'confirmada_estado_cita', '{patient_name}', 'manage_token', NULL),
  ('appointment.status_changed', 'confirmed', NULL, 2, 'boton_cancelar_cita', '{}', NULL, 'cancel'),
  -- n8n also sent this for doctor/admin/auto cancellations (double message, EV01).
  ('appointment.status_changed', 'cancelled', 'patient', 1, 'cancelada_paciente', '{}', NULL, NULL),
  ('appointment.status_changed', 'completed', NULL, 1, 'cita_completada', '{}', NULL, NULL),
  ('appointment.cancelled_by_doctor', NULL, NULL, 1, 'canceladadoc_estado_cita', '{patient_name}', 'manage_token', NULL),
  ('appointment.reminder_48h', NULL, NULL, 1, 'dosdias_pre_confirmacion',
     '{patient_name,start_local,doctor_name,office_address,min_confirm_hours}', 'manage_token', NULL),
  ('appointment.reminder_48h', NULL, NULL, 2, 'boton_cancelar_cita', '{}', NULL, 'cancel'),
  ('appointment.reminder_48h', NULL, NULL, 3, 'boton_confirmar_cita', '{}', NULL, 'confirm'),
  ('appointment.auto_cancelled', NULL, NULL, 1, 'autocancelada_estado_cita', '{patient_name}', 'manage_token', NULL),
  ('appointment.reminder_day_of', NULL, NULL, 1, 'cita_manana_recordatorio',
     '{patient_name,start_local,doctor_name,office_address}', 'manage_token', NULL),
  ('appointment.reminder_day_of', NULL, NULL, 2, 'boton_cancelar_cita', '{}', NULL, 'cancel'),
  ('appointment.rescheduled_by_staff', NULL, NULL, 1, 'cita_reagendada_staff',
     '{patient_name,previous_start_local,start_local,doctor_name,office_address}', 'manage_token', NULL);

-- 6. Worker schedule: checked every minute, but the Edge Function is only
-- invoked when there is due work (outbox rows or unprocessed WHAAPY events),
-- so an idle system makes no HTTP calls. Retention: 12 months.

SELECT cron.schedule('findmed-events-worker', '* * * * *', $$
  SELECT public.invoke_edge_function('findmed-events-worker')
   WHERE EXISTS (SELECT 1 FROM public.domain_outbox
                  WHERE (status = 'pending' AND next_attempt_at <= now())
                     OR (status = 'processing' AND locked_until < now()))
      OR EXISTS (SELECT 1 FROM public.whaapy_events
                  WHERE processed_at IS NULL AND received_at < now() - interval '1 minute')
$$);

SELECT cron.schedule('purge-domain-outbox', '45 9 * * *', $$
  DELETE FROM public.domain_outbox WHERE created_at < now() - interval '12 months';
  DELETE FROM public.message_deliveries WHERE created_at < now() - interval '12 months';
$$);
