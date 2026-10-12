-- Retention for public.whaapy_events (decision D9, Alex 2026-10-12): WhatsApp
-- events — including patients' messages — are kept 12 months and then purged
-- daily. Pure SQL job (no HTTP), so it behaves the same in every environment.

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'purge-whaapy-events',
  '30 9 * * *', -- 03:30 CDMX
  $$DELETE FROM public.whaapy_events WHERE received_at < now() - interval '12 months'$$
);
