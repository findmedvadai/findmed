-- Patient cases and human handoff (block B6, capabilities M09/M10/M11 — see
-- docs/findmed-migration/decisiones.md D10).
--
-- Why: until now a request without an automatic answer (hospital, studies,
-- urgency, "no options in my city", "I want a person") only got a WHAAPY tag
-- from n8n. A tag proves nothing: nobody owns the request, nothing says
-- whether the AI stopped answering, and nothing is closed with a reason.
--
--  * patient_cases: one row per request that needs a person. Status flow:
--      open → awaiting_assignment → assigned → (awaiting_patient | awaiting_provider)*
--           → resolved | closed
--    `assigned` is set ONLY when a staff member takes the case in FindMed
--    (single owner of assignment = FindMed backend). WHAAPY assignment and
--    AI pause are side effects recorded in ai_state / whaapy_assignment and
--    in case_events, never assumed.
--  * case_events: append-only history (who did what, provider results,
--    errors). Internal: never shown to the patient.
--
-- Writes come only from Edge Functions with the service key (findmed-mcp,
-- case-actions); admins read through RLS.

CREATE TABLE public.patient_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type text NOT NULL
    CHECK (request_type IN ('appointment_help', 'hospital', 'studies', 'urgency', 'follow_up', 'other')),
  source text NOT NULL DEFAULT 'mcp' CHECK (source IN ('mcp', 'admin', 'whatsapp')),
  subject_phone text NOT NULL,                       -- canonical phone of the contact
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  contact_name text,
  city text,
  zone text,
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 3 AND 1000),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'awaiting_assignment', 'assigned', 'awaiting_patient',
                      'awaiting_provider', 'resolved', 'closed')),
  handoff_reason text,
  handoff_requested_at timestamptz,
  assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  next_action text,
  due_at timestamptz,
  resolution_reason text,
  resolved_at timestamptz,
  -- WHAAPY projection (last known; history lives in case_events)
  whaapy_conversation_id text,
  whaapy_contact_id text,
  ai_state text NOT NULL DEFAULT 'not_requested'
    CHECK (ai_state IN ('not_requested', 'paused', 'pause_failed', 'resumed', 'resume_failed')),
  whaapy_assignment text NOT NULL DEFAULT 'none'
    CHECK (whaapy_assignment IN ('none', 'assigned', 'failed', 'no_matching_agent', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_cases_resolution_needs_reason
    CHECK (status NOT IN ('resolved', 'closed') OR resolution_reason IS NOT NULL)
);

-- One active case per contact and request type: a retried or repeated
-- open_case returns the existing case instead of creating duplicates (M09).
CREATE UNIQUE INDEX patient_cases_one_active
  ON public.patient_cases (subject_phone, request_type)
  WHERE status NOT IN ('resolved', 'closed');

CREATE INDEX idx_patient_cases_queue ON public.patient_cases (status, priority, created_at)
  WHERE status NOT IN ('resolved', 'closed');
CREATE INDEX idx_patient_cases_phone ON public.patient_cases (subject_phone);

CREATE TRIGGER update_patient_cases_updated_at
  BEFORE UPDATE ON public.patient_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.patient_cases(id) ON DELETE CASCADE,
  event_type text NOT NULL,          -- created, deduplicated, handoff_requested, ai_paused, ...
  actor text NOT NULL CHECK (actor IN ('agent', 'staff', 'system', 'whaapy')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_case_events_case ON public.case_events (case_id, created_at);

ALTER TABLE public.patient_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read patient cases"
  ON public.patient_cases FOR SELECT TO authenticated
  USING (public.is_admin_or_superadmin(auth.uid()));

CREATE POLICY "Admins can read case events"
  ON public.case_events FOR SELECT TO authenticated
  USING (public.is_admin_or_superadmin(auth.uid()));
