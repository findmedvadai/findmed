-- Booking integrity + idempotent crons + versioned cron schedules.
--
-- 1. Double-booking was only prevented by check-then-insert in Edge Functions
--    (racy; reserve-create didn't even check). An exclusion constraint makes
--    overlapping active appointments of the same doctor (any office, D2)
--    impossible at the DB level. Edge Functions map SQLSTATE 23P01 to HTTP 409.
-- 2. Reminder crons had no "already sent" marker, so a 2h window with an
--    hourly cron sent the 48h reminder twice. Sent-markers let the cron claim
--    each row atomically (UPDATE ... WHERE marker IS NULL RETURNING).
-- 3. The pg_cron schedules only existed in the live DB (lost once already,
--    see ERRORES.md 2026-04-30). cron.schedule() with an existing jobname
--    updates it in place, so this is safe to re-run.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Integrity -----------------------------------------------------------

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_end_after_start CHECK (end_at > start_at);

-- Business rule (decision D2, 2026-10-12): a doctor can't be booked twice at
-- the same time, even across different offices. Half-open ranges: an
-- appointment ending 10:00 does not conflict with one starting 10:00. Only live
-- statuses participate; cancelled/completed rows never block a slot.
--
-- Pre-check: fail with an explicit message (instead of a generic constraint
-- error) if live data already overlaps. Overlaps must be resolved case by case
-- with FindMed operations — never by deleting appointments in a migration.
DO $$
DECLARE
  overlapping int;
BEGIN
  SELECT count(*) INTO overlapping
  FROM public.appointments a
  JOIN public.appointments b
    ON a.id < b.id
   AND a.doctor_id = b.doctor_id
   AND a.status IN ('scheduled', 'confirmed')
   AND b.status IN ('scheduled', 'confirmed')
   AND tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)');
  IF overlapping > 0 THEN
    RAISE EXCEPTION 'appointments_no_overlap_per_doctor: % pares de citas activas del mismo doctor se traslapan; resolverlos antes de aplicar esta migración', overlapping;
  END IF;
END $$;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_overlap_per_doctor
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status IN ('scheduled', 'confirmed'));

-- 2. Cron idempotency -----------------------------------------------------

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_48h_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_day_of_sent_at timestamptz;

-- Indexes for the cron scans and the slot/overlap queries.
CREATE INDEX IF NOT EXISTS idx_appointments_status_start_at
  ON public.appointments (status, start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status_end_at
  ON public.appointments (status, end_at);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_active_range
  ON public.appointments (doctor_id, start_at, end_at)
  WHERE status IN ('scheduled', 'confirmed');
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id
  ON public.appointments (patient_id);

-- 3. Versioned cron schedules ----------------------------------------------
-- Each job POSTs to its Edge Function with the server key stored in Vault
-- under the name `service_role_key` (the NAME is historical; the VALUE is the
-- current secret key, rotated when the legacy key was revoked). The Edge
-- Functions reject any caller without that key (_shared/service-auth.ts).
--
-- The target base URL also comes from Vault (`edge_functions_base_url`) and
-- is NEVER hard-coded: a local `supabase start`, a preview branch or a staging
-- project that applies this migration must not fire production functions.
-- Without that secret (or without the key) invoke_edge_function is a no-op.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Production already has these jobs (created by hand, see ERRORES.md
-- 2026-04-30) with the URL inline. Carry that URL into Vault once, so the
-- rescheduled jobs keep hitting the same project. Fresh databases have no
-- such jobs, so nothing is created and the crons stay inert.
DO $$
DECLARE
  existing_url text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'edge_functions_base_url') THEN
    SELECT substring(command FROM '(https://[a-z0-9]+\.supabase\.co/functions/v1)/')
      INTO existing_url
      FROM cron.job
     WHERE jobname = 'send-appointment-reminders';
    IF existing_url IS NOT NULL THEN
      PERFORM vault.create_secret(existing_url, 'edge_functions_base_url',
        'Base URL for pg_cron -> Edge Function calls (public.invoke_edge_function)');
    ELSE
      RAISE NOTICE 'edge_functions_base_url not set: cron jobs will be no-ops until it is created in Vault';
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.invoke_edge_function(function_slug text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault
AS $$
DECLARE
  base_url text;
  service_key text;
BEGIN
  SELECT decrypted_secret INTO base_url
    FROM vault.decrypted_secrets WHERE name = 'edge_functions_base_url';
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF base_url IS NULL OR service_key IS NULL THEN
    RAISE NOTICE 'invoke_edge_function(%): skipped, missing edge_functions_base_url or service_role_key in Vault', function_slug;
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url := base_url || '/' || function_slug,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_edge_function(text) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('send-appointment-reminders', '5 * * * *',   $$SELECT public.invoke_edge_function('send-appointment-reminders')$$);
SELECT cron.schedule('send-day-of-reminders',      '0 14 * * *',  $$SELECT public.invoke_edge_function('send-day-of-reminders')$$);
SELECT cron.schedule('auto-cancel-unconfirmed',    '*/15 * * * *', $$SELECT public.invoke_edge_function('auto-cancel-unconfirmed')$$);
SELECT cron.schedule('auto-complete-appointments', '*/15 * * * *', $$SELECT public.invoke_edge_function('auto-complete-appointments')$$);
