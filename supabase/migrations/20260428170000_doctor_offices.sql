-- =============================================
-- Multi-office per doctor (Mejora 2)
-- =============================================
-- A doctor can now operate from multiple physical offices, each with its own
-- address, geo, weekly availability, external calendars (Google/Outlook), and
-- appointment duration. The legacy 1:1 fields on `doctors` (address, city_id,
-- zone_id, google_*, outlook_*) are NOT removed — they are deprecated and
-- left in place for safety; new code should not read or write them. A future
-- cleanup migration can drop them once we're sure nothing depends on them.
--
-- Hard rules enforced at the schema level:
--   * `(doctor_id, zone_id)` is unique among active, non-deleted offices.
--   * `appointments.office_id` must belong to a `doctor_office` whose
--     doctor_id matches `appointments.doctor_id` (composite FK).
--   * Same composite-FK protection on `doctor_weekly_availability` and
--     `reservation_sessions`.
-- =============================================

-- 1. NEW TABLE: doctor_offices
CREATE TABLE IF NOT EXISTS public.doctor_offices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  city_id UUID REFERENCES public.cities(id),
  zone_id UUID REFERENCES public.zones(id),
  google_calendar_connected BOOLEAN NOT NULL DEFAULT false,
  google_refresh_token_ref TEXT,
  google_calendar_id TEXT,
  outlook_calendar_connected BOOLEAN NOT NULL DEFAULT false,
  outlook_refresh_token_ref TEXT,
  outlook_calendar_id TEXT,
  appointment_duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (appointment_duration_minutes > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Composite UNIQUE so child tables can FK on (doctor_id, office_id) and
-- prevent cross-doctor office assignment.
ALTER TABLE public.doctor_offices
  ADD CONSTRAINT doctor_offices_doctor_id_id_key UNIQUE (doctor_id, id);

CREATE INDEX IF NOT EXISTS idx_doctor_offices_doctor_id ON public.doctor_offices(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_offices_city_zone ON public.doctor_offices(city_id, zone_id);

-- One zone per doctor among active, non-deleted offices. Soft-deleted/inactive
-- offices are ignored, so the doctor can re-create or reactivate without
-- conflict.
CREATE UNIQUE INDEX IF NOT EXISTS doctor_offices_active_zone_unique
  ON public.doctor_offices (doctor_id, zone_id)
  WHERE is_active = true AND is_deleted = false AND zone_id IS NOT NULL;

CREATE TRIGGER update_doctor_offices_updated_at
  BEFORE UPDATE ON public.doctor_offices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. BACKFILL — one office per existing doctor.
-- The migrated office takes the doctor's current address/city/zone/calendars
-- and the duration from doctor_schedule_settings (default 30 if missing).
INSERT INTO public.doctor_offices (
  doctor_id,
  name,
  address,
  city_id,
  zone_id,
  google_calendar_connected,
  google_refresh_token_ref,
  google_calendar_id,
  outlook_calendar_connected,
  outlook_refresh_token_ref,
  outlook_calendar_id,
  appointment_duration_minutes,
  is_active,
  is_deleted,
  created_at,
  updated_at
)
SELECT
  d.id AS doctor_id,
  'Consultorio principal' AS name,
  d.address,
  d.city_id,
  d.zone_id,
  COALESCE(d.google_calendar_connected, false),
  d.google_refresh_token_ref,
  d.google_calendar_id,
  COALESCE(d.outlook_calendar_connected, false),
  d.outlook_refresh_token_ref,
  d.outlook_calendar_id,
  COALESCE(s.appointment_duration_minutes, 30),
  COALESCE(d.is_active, true),
  COALESCE(d.is_deleted, false),
  COALESCE(d.created_at, now()),
  now()
FROM public.doctors d
LEFT JOIN public.doctor_schedule_settings s ON s.doctor_id = d.id
WHERE NOT EXISTS (
  -- Idempotency: skip doctors who already have an office.
  SELECT 1 FROM public.doctor_offices o WHERE o.doctor_id = d.id
);

-- 3. doctor_weekly_availability: add office_id, drop the (doctor_id, weekday)
-- unique that prevented multiple blocks per day, and add the composite FK.
-- Multiple blocks per day are now valid as long as they don't overlap within
-- the same office (validation at app level).
ALTER TABLE public.doctor_weekly_availability
  ADD COLUMN IF NOT EXISTS office_id UUID;

UPDATE public.doctor_weekly_availability AS av
SET office_id = (
  SELECT o.id
  FROM public.doctor_offices o
  WHERE o.doctor_id = av.doctor_id
  ORDER BY o.created_at ASC
  LIMIT 1
)
WHERE av.office_id IS NULL;

ALTER TABLE public.doctor_weekly_availability
  ALTER COLUMN office_id SET NOT NULL;

ALTER TABLE public.doctor_weekly_availability
  DROP CONSTRAINT IF EXISTS doctor_weekly_availability_doctor_id_weekday_key;

ALTER TABLE public.doctor_weekly_availability
  ADD CONSTRAINT doctor_weekly_availability_office_fk
  FOREIGN KEY (doctor_id, office_id)
  REFERENCES public.doctor_offices(doctor_id, id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_doctor_weekly_availability_office_id
  ON public.doctor_weekly_availability(office_id, weekday);

-- 4. appointments: add office_id with composite FK.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS office_id UUID;

UPDATE public.appointments AS a
SET office_id = (
  SELECT o.id
  FROM public.doctor_offices o
  WHERE o.doctor_id = a.doctor_id
  ORDER BY o.created_at ASC
  LIMIT 1
)
WHERE a.office_id IS NULL;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_office_fk
  FOREIGN KEY (doctor_id, office_id)
  REFERENCES public.doctor_offices(doctor_id, id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_appointments_office_id ON public.appointments(office_id);

-- Note: we leave `appointments.office_id` nullable for now to avoid breaking
-- writes from older Edge Function versions during the rollout. Once every
-- write path is updated and deployed, a follow-up migration can flip it to
-- NOT NULL.

-- 5. reservation_sessions: add office_id (the patient's assigned office for
-- the triage link). Backfilled to the doctor's only office.
ALTER TABLE public.reservation_sessions
  ADD COLUMN IF NOT EXISTS office_id UUID;

UPDATE public.reservation_sessions AS r
SET office_id = (
  SELECT o.id
  FROM public.doctor_offices o
  WHERE o.doctor_id = r.doctor_id
  ORDER BY o.created_at ASC
  LIMIT 1
)
WHERE r.office_id IS NULL;

ALTER TABLE public.reservation_sessions
  ADD CONSTRAINT reservation_sessions_office_fk
  FOREIGN KEY (doctor_id, office_id)
  REFERENCES public.doctor_offices(doctor_id, id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_reservation_sessions_office_id
  ON public.reservation_sessions(office_id);

-- 6. RLS — doctor_offices.
ALTER TABLE public.doctor_offices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can manage doctor_offices" ON public.doctor_offices
  FOR ALL TO authenticated
  USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));

CREATE POLICY "Doctor can read own offices" ON public.doctor_offices
  FOR SELECT TO authenticated
  USING (doctor_id = public.get_doctor_id_for_user(auth.uid()));

CREATE POLICY "Doctor can manage own offices" ON public.doctor_offices
  FOR ALL TO authenticated
  USING (doctor_id = public.get_doctor_id_for_user(auth.uid()))
  WITH CHECK (doctor_id = public.get_doctor_id_for_user(auth.uid()));

-- Anonymous (patient flow via service-role Edge Functions) gets no policy
-- by design — the Edge Functions bypass RLS via the service role key.
