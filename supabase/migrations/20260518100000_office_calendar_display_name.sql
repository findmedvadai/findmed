-- Persist the friendly display name of the connected calendar at pick time
-- so the UI doesn't have to re-fetch it from the provider on every page load
-- (slow, can fail, and was causing the trigger to show generic "Calendario
-- conectado" text instead of the real name like "Prueba FindMed").
--
-- Columns are nullable: offices connected before this migration keep NULL and
-- the UI falls back to a one-time live lookup until the doctor switches/saves
-- a calendar from the picker, at which point the name gets written.

ALTER TABLE public.doctor_offices
  ADD COLUMN IF NOT EXISTS google_calendar_name TEXT,
  ADD COLUMN IF NOT EXISTS outlook_calendar_name TEXT;

COMMENT ON COLUMN public.doctor_offices.google_calendar_name IS
  'Friendly display name of the Google calendar the doctor picked. Snapshot taken at pick time — does not auto-update if the calendar is renamed in Google.';

COMMENT ON COLUMN public.doctor_offices.outlook_calendar_name IS
  'Friendly display name of the Outlook calendar the doctor picked. Snapshot taken at pick time — does not auto-update if the calendar is renamed in Outlook.';
