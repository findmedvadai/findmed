-- Etapa 2 (alcance B): retro estructurada del especialista, rutas operativas
-- automáticas después de la post-consulta y registro de reembolsos.
--
-- Why: the doctor's post-consultation form was free text only. Nobody was told
-- that a patient needed studies, a procedure or an urgent call, and invoices /
-- reimbursements were tracked outside FindMed. Now:
--
--  * post_consultation_forms.management_type: the type of management the
--    doctor confirms (conservador | estudios | procedimiento | urgente).
--    Nullable: forms sent before this change have none (the server derives it
--    from the captured fields).
--  * patient_cases gets three request types (procedure, referral,
--    reimbursement), a new origin (post_consultation) and a link to the
--    appointment it came from.
--  * post_consultation_case_links: one row per (form, route). It is the
--    idempotency marker of the post-consultation triggers (re-sending the same
--    form never opens a second case) and the list of cases each form produced,
--    including cases that already existed and only received a new event
--    (outcome = 'appended', "one active case per phone + type").
--  * reimbursements: structured record of invoices / reimbursements handled in
--    a case (recibido → en_proceso → finalizado | rechazado).
--
-- Writes to the new tables come only from Edge Functions with the service key
-- (dispatch-webhook → _shared/postconsult-routes.ts, case-actions); admins read
-- through RLS. Doctors keep inserting their own forms (existing policy).

-- 1. Tipo de manejo -----------------------------------------------------------
ALTER TABLE public.post_consultation_forms
  ADD COLUMN management_type text
  CONSTRAINT post_consultation_forms_management_type_check
  CHECK (management_type IN ('conservador', 'estudios', 'procedimiento', 'urgente'));

-- 2. Tipos y origen de casos (constraint names verified in production) --------
ALTER TABLE public.patient_cases DROP CONSTRAINT patient_cases_request_type_check;
ALTER TABLE public.patient_cases ADD CONSTRAINT patient_cases_request_type_check
  CHECK (request_type IN ('appointment_help', 'hospital', 'studies', 'urgency', 'follow_up', 'other',
                          'procedure', 'referral', 'reimbursement'));

ALTER TABLE public.patient_cases DROP CONSTRAINT patient_cases_source_check;
ALTER TABLE public.patient_cases ADD CONSTRAINT patient_cases_source_check
  CHECK (source IN ('mcp', 'admin', 'whatsapp', 'post_consultation'));

-- 3. Enlace del caso con la cita que lo originó -----------------------------
ALTER TABLE public.patient_cases
  ADD COLUMN appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE INDEX idx_patient_cases_appointment ON public.patient_cases (appointment_id)
  WHERE appointment_id IS NOT NULL;

-- 4. Casos generados por cada formulario post-consulta -----------------------
CREATE TABLE public.post_consultation_case_links (
  form_id uuid NOT NULL REFERENCES public.post_consultation_forms(id) ON DELETE CASCADE,
  request_type text NOT NULL,
  case_id uuid NOT NULL REFERENCES public.patient_cases(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('created', 'appended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (form_id, request_type)
);

CREATE INDEX idx_post_consultation_case_links_case ON public.post_consultation_case_links (case_id);

ALTER TABLE public.post_consultation_case_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read post-consultation case links"
  ON public.post_consultation_case_links FOR SELECT TO authenticated
  USING (public.is_admin_or_superadmin(auth.uid()));

-- 5. Reembolsos ---------------------------------------------------------------
CREATE TABLE public.reimbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.patient_cases(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  insurer text NOT NULL CHECK (char_length(insurer) BETWEEN 2 AND 120),
  invoice_number text CHECK (invoice_number IS NULL OR char_length(invoice_number) BETWEEN 1 AND 60),
  amount numeric(12, 2) CHECK (amount IS NULL OR amount >= 0),
  currency text NOT NULL DEFAULT 'MXN' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'recibido'
    CHECK (status IN ('recibido', 'en_proceso', 'finalizado', 'rechazado')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  submitted_at timestamptz,          -- sent to the insurer (first move to en_proceso)
  resolved_at timestamptz,           -- finalizado / rechazado
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reimbursements_resolved_needs_date
    CHECK (status NOT IN ('finalizado', 'rechazado') OR resolved_at IS NOT NULL)
);

CREATE INDEX idx_reimbursements_case ON public.reimbursements (case_id, created_at);
CREATE INDEX idx_reimbursements_open ON public.reimbursements (status, created_at)
  WHERE status IN ('recibido', 'en_proceso');

CREATE TRIGGER update_reimbursements_updated_at
  BEFORE UPDATE ON public.reimbursements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.reimbursements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read reimbursements"
  ON public.reimbursements FOR SELECT TO authenticated
  USING (public.is_admin_or_superadmin(auth.uid()));
