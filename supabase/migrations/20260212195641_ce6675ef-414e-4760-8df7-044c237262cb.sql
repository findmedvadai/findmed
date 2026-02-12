
-- =============================================
-- FindMed Phase 1: Core Schema
-- =============================================

-- 1. ENUMS
CREATE TYPE public.app_role AS ENUM ('superadmin', 'admin', 'doctor');
CREATE TYPE public.appointment_status AS ENUM ('scheduled', 'confirmed', 'cancelled', 'completed');
CREATE TYPE public.cancel_reason AS ENUM ('patient', 'doctor', 'no_confirmation');
CREATE TYPE public.notification_type AS ENUM (
  'appointment_scheduled',
  'appointment_cancelled_by_patient',
  'appointment_cancelled_by_doctor',
  'appointment_auto_cancelled',
  'appointment_completed'
);

-- 2. BASE TABLES

-- 2.1 cities
CREATE TABLE public.cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.2 zones
CREATE TABLE public.zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(city_id, name)
);

-- 2.3 specialties
CREATE TABLE public.specialties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.4 doctors
CREATE TABLE public.doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  city_id UUID REFERENCES public.cities(id),
  zone_id UUID REFERENCES public.zones(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  google_calendar_connected BOOLEAN NOT NULL DEFAULT false,
  google_refresh_token_ref TEXT,
  google_calendar_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.5 doctor_specialties
CREATE TABLE public.doctor_specialties (
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  specialty_id UUID NOT NULL REFERENCES public.specialties(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, specialty_id)
);

-- 2.6 doctor_schedule_settings
CREATE TABLE public.doctor_schedule_settings (
  doctor_id UUID PRIMARY KEY REFERENCES public.doctors(id) ON DELETE CASCADE,
  appointment_duration_minutes INT NOT NULL DEFAULT 30,
  min_confirm_hours_before INT NOT NULL DEFAULT 24,
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.7 doctor_weekly_availability
CREATE TABLE public.doctor_weekly_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  weekday INT NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(doctor_id, weekday)
);

-- 2.8 doctor_date_overrides
CREATE TABLE public.doctor_date_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  override_date DATE NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(doctor_id, override_date)
);

-- 2.9 patients
CREATE TABLE public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.10 reservation_sessions
CREATE TABLE public.reservation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  symptoms TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.11 appointments
CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  symptoms TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status public.appointment_status NOT NULL DEFAULT 'scheduled',
  cancel_reason public.cancel_reason,
  doctor_notes TEXT,
  doctor_notes_updated_at TIMESTAMPTZ,
  google_event_id TEXT,
  created_from_session_id UUID REFERENCES public.reservation_sessions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.12 appointment_manage_tokens
CREATE TABLE public.appointment_manage_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_phone TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.13 users (linked to auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  doctor_id UUID REFERENCES public.doctors(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.14 user_roles (separate roles table for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);

-- 2.15 notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_role public.app_role NOT NULL,
  doctor_id UUID REFERENCES public.doctors(id),
  title TEXT NOT NULL,
  body TEXT,
  type public.notification_type NOT NULL,
  appointment_id UUID REFERENCES public.appointments(id),
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- 3. INDEXES
-- =============================================
CREATE INDEX idx_appointments_doctor_id ON public.appointments(doctor_id);
CREATE INDEX idx_appointments_status ON public.appointments(status);
CREATE INDEX idx_appointments_start_at ON public.appointments(start_at);
CREATE INDEX idx_reservation_sessions_token ON public.reservation_sessions(token);
CREATE INDEX idx_appointment_manage_tokens_token ON public.appointment_manage_tokens(token);
CREATE INDEX idx_notifications_doctor_id ON public.notifications(doctor_id);
CREATE INDEX idx_notifications_recipient_role ON public.notifications(recipient_role);
CREATE INDEX idx_doctor_date_overrides_date ON public.doctor_date_overrides(doctor_id, override_date);

-- =============================================
-- 4. UPDATED_AT TRIGGER
-- =============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_doctors_updated_at
  BEFORE UPDATE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_doctor_schedule_settings_updated_at
  BEFORE UPDATE ON public.doctor_schedule_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 5. SECURITY DEFINER HELPER FUNCTIONS
-- =============================================

-- Check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Check if user is admin or superadmin
CREATE OR REPLACE FUNCTION public.is_admin_or_superadmin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin', 'superadmin')
  )
$$;

-- Get the doctor_id for a given user
CREATE OR REPLACE FUNCTION public.get_doctor_id_for_user(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT doctor_id FROM public.users WHERE id = _user_id
$$;

-- =============================================
-- 6. ENABLE RLS ON ALL TABLES
-- =============================================
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_schedule_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_weekly_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_date_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_manage_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 7. RLS POLICIES
-- =============================================

-- 7.1 cities (read: all authenticated, write: admin/superadmin)
CREATE POLICY "Authenticated can read cities" ON public.cities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage cities" ON public.cities
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));

-- 7.2 zones
CREATE POLICY "Authenticated can read zones" ON public.zones
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage zones" ON public.zones
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));

-- 7.3 specialties
CREATE POLICY "Authenticated can read specialties" ON public.specialties
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage specialties" ON public.specialties
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));

-- 7.4 doctors
CREATE POLICY "Admin can manage doctors" ON public.doctors
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Doctor can read own profile" ON public.doctors
  FOR SELECT TO authenticated USING (id = public.get_doctor_id_for_user(auth.uid()));
CREATE POLICY "Doctor can update own profile" ON public.doctors
  FOR UPDATE TO authenticated USING (id = public.get_doctor_id_for_user(auth.uid()))
  WITH CHECK (id = public.get_doctor_id_for_user(auth.uid()));

-- 7.5 doctor_specialties
CREATE POLICY "Admin can manage doctor_specialties" ON public.doctor_specialties
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Doctor can read own specialties" ON public.doctor_specialties
  FOR SELECT TO authenticated USING (doctor_id = public.get_doctor_id_for_user(auth.uid()));
CREATE POLICY "Doctor can manage own specialties" ON public.doctor_specialties
  FOR ALL TO authenticated USING (doctor_id = public.get_doctor_id_for_user(auth.uid()))
  WITH CHECK (doctor_id = public.get_doctor_id_for_user(auth.uid()));

-- 7.6 doctor_schedule_settings
CREATE POLICY "Admin can manage schedule settings" ON public.doctor_schedule_settings
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Doctor can read own settings" ON public.doctor_schedule_settings
  FOR SELECT TO authenticated USING (doctor_id = public.get_doctor_id_for_user(auth.uid()));
CREATE POLICY "Doctor can manage own settings" ON public.doctor_schedule_settings
  FOR ALL TO authenticated USING (doctor_id = public.get_doctor_id_for_user(auth.uid()))
  WITH CHECK (doctor_id = public.get_doctor_id_for_user(auth.uid()));

-- 7.7 doctor_weekly_availability
CREATE POLICY "Admin can manage weekly availability" ON public.doctor_weekly_availability
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Doctor can read own availability" ON public.doctor_weekly_availability
  FOR SELECT TO authenticated USING (doctor_id = public.get_doctor_id_for_user(auth.uid()));
CREATE POLICY "Doctor can manage own availability" ON public.doctor_weekly_availability
  FOR ALL TO authenticated USING (doctor_id = public.get_doctor_id_for_user(auth.uid()))
  WITH CHECK (doctor_id = public.get_doctor_id_for_user(auth.uid()));

-- 7.8 doctor_date_overrides
CREATE POLICY "Admin can manage date overrides" ON public.doctor_date_overrides
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Doctor can read own overrides" ON public.doctor_date_overrides
  FOR SELECT TO authenticated USING (doctor_id = public.get_doctor_id_for_user(auth.uid()));
CREATE POLICY "Doctor can manage own overrides" ON public.doctor_date_overrides
  FOR ALL TO authenticated USING (doctor_id = public.get_doctor_id_for_user(auth.uid()))
  WITH CHECK (doctor_id = public.get_doctor_id_for_user(auth.uid()));

-- 7.9 patients (admin/superadmin only; edge functions use service role)
CREATE POLICY "Admin can read patients" ON public.patients
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Admin can manage patients" ON public.patients
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));

-- 7.10 reservation_sessions (admin/superadmin only; edge functions use service role)
CREATE POLICY "Admin can read reservation sessions" ON public.reservation_sessions
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));

-- 7.11 appointments
CREATE POLICY "Admin can manage appointments" ON public.appointments
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Doctor can read own appointments" ON public.appointments
  FOR SELECT TO authenticated USING (doctor_id = public.get_doctor_id_for_user(auth.uid()));
CREATE POLICY "Doctor can update own appointment notes" ON public.appointments
  FOR UPDATE TO authenticated
  USING (doctor_id = public.get_doctor_id_for_user(auth.uid()))
  WITH CHECK (doctor_id = public.get_doctor_id_for_user(auth.uid()));

-- 7.12 appointment_manage_tokens (admin/superadmin only; edge functions use service role)
CREATE POLICY "Admin can read manage tokens" ON public.appointment_manage_tokens
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));

-- 7.13 users
CREATE POLICY "User can read own record" ON public.users
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Admin can read all users" ON public.users
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Admin can manage users" ON public.users
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));

-- 7.14 user_roles
CREATE POLICY "User can read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admin can read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Admin can manage roles" ON public.user_roles
  FOR ALL TO authenticated USING (public.is_admin_or_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_or_superadmin(auth.uid()));

-- 7.15 notifications
CREATE POLICY "Doctor can read own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    recipient_role = 'doctor'
    AND doctor_id = public.get_doctor_id_for_user(auth.uid())
  );
CREATE POLICY "Doctor can update own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    recipient_role = 'doctor'
    AND doctor_id = public.get_doctor_id_for_user(auth.uid())
  );
CREATE POLICY "Admin can read admin notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    public.is_admin_or_superadmin(auth.uid())
  );
CREATE POLICY "Admin can update admin notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    public.is_admin_or_superadmin(auth.uid())
  );

-- =============================================
-- 8. SEED CATALOG DATA
-- =============================================
INSERT INTO public.cities (name) VALUES ('Ciudad de México'), ('Querétaro');
