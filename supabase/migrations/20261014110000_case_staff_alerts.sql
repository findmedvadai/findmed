-- Staff alerts for patient cases (client complaint #1, 13-oct): when the agent
-- tells a patient "someone from FindMed will continue", nobody on the team was
-- notified — _shared/cases.ts created the case and nothing else. In production
-- an urgent case waited 20 h without anyone taking it.
--
-- Decision (FindMed): panel alerts + WhatsApp to on-call numbers, with
-- escalation by time.
--
--  * notification_type gains case_opened / case_handoff / case_overdue and
--    notifications.case_id links the alert to its case (the panel shows a
--    persistent toast with "Ver caso" through Realtime).
--  * patient_cases.last_alert_at / alert_level: escalation state. A case still
--    open/awaiting_assignment one SLA period after its last alert is escalated
--    (panel + WhatsApp), every SLA period, up to max_escalations.
--  * staff_alert_settings (one row): SLA per priority, max escalations,
--    WhatsApp on/off and the WHAAPY template (default alerta_caso_findmed).
--  * staff_alert_recipients: on-call WhatsApp numbers (all alerts or urgent only).
--  * case_alerts: one row per alert (case, kind, level) — the idempotency gate
--    (dedupe_key) and the WhatsApp queue the worker claims with SKIP LOCKED.
--  * message_deliveries records every WhatsApp sent to the team
--    (source 'staff_alert'), so receipts (sent/delivered/read/failed) arrive
--    through the same whaapy-inbound path as patient messages.
--  * The findmed-events-worker cron also wakes up for queued alerts and for
--    cases past their SLA (public.staff_alerts_have_work). The rule mirrors
--    nextEscalationAt() in supabase/functions/_shared/staff-alerts.ts.
--
-- The new enum values are NOT used inside this migration (a value added by
-- ALTER TYPE can't be used in the same transaction); Edge Functions insert them.
-- Writes come only from Edge Functions with the service key (findmed-mcp,
-- case-actions, findmed-events-worker); admins read through RLS.

-- 1. Notification types and link to the case ---------------------------------

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'case_opened';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'case_handoff';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'case_overdue';

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES public.patient_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_case_id
  ON public.notifications (case_id) WHERE case_id IS NOT NULL;

-- 2. Escalation state on the case -----------------------------------------------

ALTER TABLE public.patient_cases
  ADD COLUMN IF NOT EXISTS last_alert_at timestamptz,
  ADD COLUMN IF NOT EXISTS alert_level smallint NOT NULL DEFAULT 0;

ALTER TABLE public.patient_cases
  DROP CONSTRAINT IF EXISTS patient_cases_alert_level_check;
ALTER TABLE public.patient_cases
  ADD CONSTRAINT patient_cases_alert_level_check CHECK (alert_level >= 0);

-- 3. Settings (single row) ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_alert_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Postgres regexes cap repetition counts at 255, so the length goes apart.
  template_name text NOT NULL DEFAULT 'alerta_caso_findmed'
    CHECK (template_name ~ '^[a-z0-9_]+$' AND char_length(template_name) <= 512),
  template_language text NOT NULL DEFAULT 'es_MX'
    CHECK (template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  sla_urgent_minutes integer NOT NULL DEFAULT 10 CHECK (sla_urgent_minutes BETWEEN 1 AND 1440),
  sla_high_minutes integer NOT NULL DEFAULT 30 CHECK (sla_high_minutes BETWEEN 1 AND 1440),
  sla_normal_minutes integer NOT NULL DEFAULT 120 CHECK (sla_normal_minutes BETWEEN 1 AND 10080),
  max_escalations smallint NOT NULL DEFAULT 3 CHECK (max_escalations BETWEEN 0 AND 10),
  whatsapp_enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_staff_alert_settings_updated_at ON public.staff_alert_settings;
CREATE TRIGGER update_staff_alert_settings_updated_at
  BEFORE UPDATE ON public.staff_alert_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.staff_alert_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 4. On-call numbers --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_alert_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  -- Canonical phone from _shared/phone.ts (normalizeMxPhone): E.164, +52 + 10 digits for Mexico.
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$' AND (phone !~ '^\+52' OR char_length(phone) = 13)),
  receives text NOT NULL DEFAULT 'all' CHECK (receives IN ('all', 'urgent_only')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_alert_recipients_phone_key
  ON public.staff_alert_recipients (phone);

DROP TRIGGER IF EXISTS update_staff_alert_recipients_updated_at ON public.staff_alert_recipients;
CREATE TRIGGER update_staff_alert_recipients_updated_at
  BEFORE UPDATE ON public.staff_alert_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Alerts: idempotency gate + WhatsApp queue -------------------------------------

CREATE TABLE IF NOT EXISTS public.case_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,                 -- '<case_id>:<kind>:<level>'
  case_id uuid NOT NULL REFERENCES public.patient_cases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('opened', 'handoff', 'overdue')),
  level smallint NOT NULL DEFAULT 0 CHECK (level >= 0),
  priority text NOT NULL CHECK (priority IN ('normal', 'high', 'urgent')),
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  whatsapp_status text NOT NULL DEFAULT 'pending'
    CHECK (whatsapp_status IN ('pending', 'processing', 'sent', 'partial', 'failed', 'uncertain', 'skipped')),
  whatsapp_detail text,                            -- why skipped/failed (no_recipients, template, …)
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_alerts_due ON public.case_alerts (next_attempt_at)
  WHERE whatsapp_status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_case_alerts_case ON public.case_alerts (case_id, created_at);

DROP TRIGGER IF EXISTS update_case_alerts_updated_at ON public.case_alerts;
CREATE TRIGGER update_case_alerts_updated_at
  BEFORE UPDATE ON public.case_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Claims due alerts (or alerts whose lease expired) so two worker runs never
-- send the same alert at the same time. Same pattern as claim_outbox.
CREATE OR REPLACE FUNCTION public.claim_case_alerts(p_limit integer, p_lease_seconds integer)
RETURNS SETOF public.case_alerts
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.case_alerts a
     SET whatsapp_status = 'processing',
         attempts = a.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds)
   WHERE a.id IN (
     SELECT id FROM public.case_alerts
      WHERE (whatsapp_status = 'pending' AND next_attempt_at <= now())
         OR (whatsapp_status = 'processing' AND locked_until < now())
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING a.*;
$$;

REVOKE ALL ON FUNCTION public.claim_case_alerts(integer, integer) FROM PUBLIC, anon, authenticated;

-- 6. WhatsApp deliveries to the team ------------------------------------------------

ALTER TABLE public.message_deliveries
  ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES public.patient_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS case_alert_id uuid REFERENCES public.case_alerts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staff_recipient_id uuid REFERENCES public.staff_alert_recipients(id) ON DELETE SET NULL;

ALTER TABLE public.message_deliveries DROP CONSTRAINT IF EXISTS message_deliveries_source_check;
ALTER TABLE public.message_deliveries ADD CONSTRAINT message_deliveries_source_check
  CHECK (source IN ('worker', 'manual', 'staff_alert'));

-- One WhatsApp per alert and on-call number (retries reuse the row).
CREATE UNIQUE INDEX IF NOT EXISTS message_deliveries_one_per_alert_recipient
  ON public.message_deliveries (case_alert_id, staff_recipient_id)
  WHERE case_alert_id IS NOT NULL AND staff_recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_deliveries_staff_alerts
  ON public.message_deliveries (created_at) WHERE source = 'staff_alert';

-- 7. RLS: admins read; writes only through Edge Functions (service key) ----------

ALTER TABLE public.staff_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_alert_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read staff alert settings" ON public.staff_alert_settings;
CREATE POLICY "Admins can read staff alert settings" ON public.staff_alert_settings
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));

DROP POLICY IF EXISTS "Admins can read staff alert recipients" ON public.staff_alert_recipients;
CREATE POLICY "Admins can read staff alert recipients" ON public.staff_alert_recipients
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));

DROP POLICY IF EXISTS "Admins can read case alerts" ON public.case_alerts;
CREATE POLICY "Admins can read case alerts" ON public.case_alerts
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));

-- 8. Cron wake-up ---------------------------------------------------------------------

-- True when the worker has staff-alert work: queued WhatsApp alerts, or a case
-- nobody took one SLA period after its last alert (same rule as
-- nextEscalationAt in _shared/staff-alerts.ts; defaults if the row is missing).
CREATE OR REPLACE FUNCTION public.staff_alerts_have_work()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH s AS (
    SELECT coalesce(max(sla_urgent_minutes), 10)  AS urgent_min,
           coalesce(max(sla_high_minutes), 30)    AS high_min,
           coalesce(max(sla_normal_minutes), 120) AS normal_min,
           coalesce(max(max_escalations), 3)      AS max_level
      FROM public.staff_alert_settings
     WHERE id
  )
  SELECT EXISTS (SELECT 1 FROM public.case_alerts
                  WHERE (whatsapp_status = 'pending' AND next_attempt_at <= now())
                     OR (whatsapp_status = 'processing' AND locked_until < now()))
      OR EXISTS (SELECT 1
                   FROM public.patient_cases c CROSS JOIN s
                  WHERE c.status IN ('open', 'awaiting_assignment')
                    AND c.alert_level < s.max_level
                    AND greatest(c.created_at, c.last_alert_at)
                        + make_interval(mins => CASE c.priority
                                                  WHEN 'urgent' THEN s.urgent_min
                                                  WHEN 'high' THEN s.high_min
                                                  ELSE s.normal_min
                                                END)
                        <= now());
$$;

REVOKE ALL ON FUNCTION public.staff_alerts_have_work() FROM PUBLIC, anon, authenticated;

-- Same job as 20261013140000 (every minute, only when there is work), now also
-- for staff alerts. Unschedule + schedule keeps it idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'findmed-events-worker') THEN
    PERFORM cron.unschedule('findmed-events-worker');
  END IF;
END $$;

SELECT cron.schedule('findmed-events-worker', '* * * * *', $$
  SELECT public.invoke_edge_function('findmed-events-worker')
   WHERE EXISTS (SELECT 1 FROM public.domain_outbox
                  WHERE (status = 'pending' AND next_attempt_at <= now())
                     OR (status = 'processing' AND locked_until < now()))
      OR EXISTS (SELECT 1 FROM public.whaapy_events
                  WHERE processed_at IS NULL AND received_at < now() - interval '1 minute')
      OR public.staff_alerts_have_work()
$$);
