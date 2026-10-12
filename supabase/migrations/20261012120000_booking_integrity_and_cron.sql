-- Booking integrity + idempotent crons + versioned cron schedules.
--
-- 1. Double-booking was only prevented by check-then-insert in Edge Functions
--    (racy; reserve-create didn't even check). An exclusion constraint makes
--    overlapping active appointments in the same office impossible at the DB
--    level. Edge Functions map SQLSTATE 23P01 to HTTP 409.
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

-- Half-open ranges: an appointment ending 10:00 does not conflict with one
-- starting 10:00. Only live statuses participate; cancelled/completed rows
-- never block a slot.
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_overlap_per_office
  EXCLUDE USING gist (
    office_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status IN ('scheduled', 'confirmed') AND office_id IS NOT NULL);

-- 2. Cron idempotency -----------------------------------------------------

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_48h_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_day_of_sent_at timestamptz;

-- Indexes for the cron scans and the slot/overlap queries.
CREATE INDEX IF NOT EXISTS idx_appointments_status_start_at
  ON public.appointments (status, start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status_end_at
  ON public.appointments (status, end_at);
CREATE INDEX IF NOT EXISTS idx_appointments_office_active_range
  ON public.appointments (office_id, start_at, end_at)
  WHERE status IN ('scheduled', 'confirmed');
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id
  ON public.appointments (patient_id);

-- 3. Versioned cron schedules ----------------------------------------------
-- Each job POSTs to its Edge Function with the server key stored in Vault
-- under the name `service_role_key` (the NAME is historical; the VALUE is the
-- current secret key, rotated when the legacy key was revoked). The Edge
-- Functions reject any caller without that key (_shared/service-auth.ts).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.invoke_edge_function(function_slug text)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, net, vault
AS $$
  SELECT net.http_post(
    url := 'https://jyzvdowflblxmlahlupo.supabase.co/functions/v1/' || function_slug,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.invoke_edge_function(text) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('send-appointment-reminders', '5 * * * *',   $$SELECT public.invoke_edge_function('send-appointment-reminders')$$);
SELECT cron.schedule('send-day-of-reminders',      '0 14 * * *',  $$SELECT public.invoke_edge_function('send-day-of-reminders')$$);
SELECT cron.schedule('auto-cancel-unconfirmed',    '*/15 * * * *', $$SELECT public.invoke_edge_function('auto-cancel-unconfirmed')$$);
SELECT cron.schedule('auto-complete-appointments', '*/15 * * * *', $$SELECT public.invoke_edge_function('auto-complete-appointments')$$);
