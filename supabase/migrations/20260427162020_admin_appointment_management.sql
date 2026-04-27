-- =============================================
-- Admin appointment management
-- =============================================
-- Adds the schema needed for the admin to create, reschedule, and cancel
-- appointments from the calendar:
--   * `booking_source` enum so we can distinguish patient_self / admin_manual / doctor_manual
--   * `appointments.booking_source` and `appointments.created_by_user_id`
--   * `cancel_reason` gains 'admin'
--   * `notification_type` gains 'appointment_rescheduled' and 'appointment_cancelled_by_admin'
--
-- Idempotent where Postgres allows. Run order matters: enum before column.
-- =============================================

-- 1. New enum: booking_source
DO $$
BEGIN
  CREATE TYPE public.booking_source AS ENUM ('patient_self', 'admin_manual', 'doctor_manual');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- 2/3. New columns on appointments
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS booking_source public.booking_source NOT NULL DEFAULT 'patient_self',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_created_by_user_id
  ON public.appointments(created_by_user_id);

-- 4. cancel_reason: add 'admin'
ALTER TYPE public.cancel_reason ADD VALUE IF NOT EXISTS 'admin';

-- 5/6. notification_type: add 'appointment_rescheduled' and 'appointment_cancelled_by_admin'
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'appointment_rescheduled';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'appointment_cancelled_by_admin';

-- RLS check: the existing "Admin can manage appointments" policy already grants
-- FOR ALL TO authenticated to admins (via is_admin_or_superadmin). The new columns
-- are owned by the same policy, so no policy change is needed.
