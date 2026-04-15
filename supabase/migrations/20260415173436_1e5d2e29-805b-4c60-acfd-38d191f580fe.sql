
ALTER TABLE public.doctors
  ADD COLUMN outlook_refresh_token_ref text,
  ADD COLUMN outlook_calendar_id text,
  ADD COLUMN outlook_calendar_connected boolean NOT NULL DEFAULT false;

ALTER TABLE public.appointments
  ADD COLUMN outlook_event_id text;
