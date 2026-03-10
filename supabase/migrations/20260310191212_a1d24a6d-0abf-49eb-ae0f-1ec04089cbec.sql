
-- Enum for post consultation status
CREATE TYPE public.post_consultation_status AS ENUM ('pending', 'read', 'report_sent');

-- Add new notification type
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'postconsultation_submitted';

-- Hospitals table
CREATE TABLE public.hospitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  address text,
  city_id uuid REFERENCES public.cities(id),
  zone_id uuid REFERENCES public.zones(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin can manage hospitals" ON public.hospitals FOR ALL TO authenticated USING (is_admin_or_superadmin(auth.uid())) WITH CHECK (is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Authenticated can read hospitals" ON public.hospitals FOR SELECT TO authenticated USING (true);

-- Laboratories table
CREATE TABLE public.laboratories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  address text,
  city_id uuid REFERENCES public.cities(id),
  zone_id uuid REFERENCES public.zones(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.laboratories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin can manage laboratories" ON public.laboratories FOR ALL TO authenticated USING (is_admin_or_superadmin(auth.uid())) WITH CHECK (is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Authenticated can read laboratories" ON public.laboratories FOR SELECT TO authenticated USING (true);

-- Post consultation forms table
CREATE TABLE public.post_consultation_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id),
  doctor_id uuid NOT NULL REFERENCES public.doctors(id),
  observations text,
  prescribed_medications text,
  imaging_studies text,
  lab_tests text,
  specialist_referral text,
  hospitalization text,
  review_status public.post_consultation_status NOT NULL DEFAULT 'pending',
  report_destination_type text,
  report_destination_id uuid,
  report_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.post_consultation_forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctor can insert own forms" ON public.post_consultation_forms FOR INSERT TO authenticated WITH CHECK (doctor_id = get_doctor_id_for_user(auth.uid()));
CREATE POLICY "Admin can read forms" ON public.post_consultation_forms FOR SELECT TO authenticated USING (is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Admin can update forms" ON public.post_consultation_forms FOR UPDATE TO authenticated USING (is_admin_or_superadmin(auth.uid())) WITH CHECK (is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Doctor can read own forms" ON public.post_consultation_forms FOR SELECT TO authenticated USING (doctor_id = get_doctor_id_for_user(auth.uid()));
