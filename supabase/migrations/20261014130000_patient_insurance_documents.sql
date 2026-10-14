-- Insurance captured by the WhatsApp agent and "documents received" on the
-- appointment (FindMed decisions a/b, 14-oct-2026).
--
--  a) The agent (FINDI v2.5) asks whether the patient has major-medical
--     insurance, the insurer and the policy number, and saves them on the
--     patient through the MCP (save_patient_insurance / create_booking_link).
--     Admins can correct them from the appointment detail
--     (admin-update-patient-insurance). has_insurance NULL = not captured.
--  b) When FindMed already asked for documents (template pedir_documentos) and
--     the patient sends an image or a PDF by WhatsApp, the upcoming appointment
--     is marked documents_received_at and admins get a notification. Files and
--     media URLs are NOT copied or stored: the team looks at them in the
--     WHAAPY inbox (/admin/whatsapp).
--
-- RLS: no new tables. The existing row policies already cover the new columns
-- (admins: "Admin can manage patients/appointments"; doctors: "Doctor can read
-- own patients" / "Doctor can read own appointments"), and the table-level
-- grants include new columns. Writes come from Edge Functions (service key).

-- 1. Patient insurance ----------------------------------------------------------

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS has_insurance boolean,
  ADD COLUMN IF NOT EXISTS insurer text,
  ADD COLUMN IF NOT EXISTS policy_number text,
  ADD COLUMN IF NOT EXISTS insurance_updated_at timestamptz;

ALTER TABLE public.patients
  ADD CONSTRAINT patients_insurer_length CHECK (insurer IS NULL OR char_length(insurer) BETWEEN 1 AND 80),
  ADD CONSTRAINT patients_policy_number_length CHECK (policy_number IS NULL OR char_length(policy_number) BETWEEN 1 AND 40),
  -- "Sin seguro" never keeps an insurer or a policy from before.
  ADD CONSTRAINT patients_no_insurance_no_policy CHECK (
    has_insurance IS DISTINCT FROM false OR (insurer IS NULL AND policy_number IS NULL)
  );

-- 2. Documents on the appointment -------------------------------------------------

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS documents_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS documents_received_at timestamptz;

-- "Pending documents" lookups (admin home, inbound WhatsApp media).
CREATE INDEX IF NOT EXISTS idx_appointments_documents_pending
  ON public.appointments (start_at)
  WHERE documents_requested_at IS NOT NULL
    AND documents_received_at IS NULL
    AND status IN ('scheduled', 'confirmed');

-- documents_requested_at = first time WHAAPY accepted the pedir_documentos
-- template for that appointment (worker or manual resend from the messaging
-- center). A trigger keeps it in one place instead of every sender.
CREATE OR REPLACE FUNCTION public.mark_documents_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.appointment_id IS NOT NULL
     AND NEW.template_name = 'pedir_documentos'
     AND NEW.status IN ('accepted', 'sent', 'delivered', 'read') THEN
    UPDATE public.appointments
       SET documents_requested_at = now()
     WHERE id = NEW.appointment_id
       AND documents_requested_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_documents_requested() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS message_deliveries_mark_documents_requested ON public.message_deliveries;
CREATE TRIGGER message_deliveries_mark_documents_requested
  AFTER INSERT OR UPDATE OF status ON public.message_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.mark_documents_requested();

-- Backfill from what was already sent.
UPDATE public.appointments a
   SET documents_requested_at = d.first_at
  FROM (
    SELECT appointment_id, min(created_at) AS first_at
      FROM public.message_deliveries
     WHERE template_name = 'pedir_documentos'
       AND status IN ('accepted', 'sent', 'delivered', 'read')
       AND appointment_id IS NOT NULL
     GROUP BY appointment_id
  ) d
 WHERE a.id = d.appointment_id
   AND a.documents_requested_at IS NULL;

-- 3. Admin notification type -------------------------------------------------------
-- Not used inside this migration (a new enum value can't be used in the same
-- transaction); Edge Functions insert it afterwards.

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'documents_received';
