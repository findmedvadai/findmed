-- Prepared patient actions (confirm / cancel) with idempotent execution.
--
-- Why (decisions A4, X06, X08 in docs/findmed-migration):
--  * the WHAAPY agent may retry a tool call after a timeout; executing the same
--    cancellation twice, or "confirming" something different from what the
--    patient saw, must be impossible;
--  * an action is first PREPARED (what, on which appointment, for which
--    phone) and only then COMMITTED once, with recorded evidence of the
--    patient's confirmation. A commit replayed after success returns the
--    stored result instead of acting again.
--
-- Rows are written only by Edge Functions with the service key; admins can
-- read them for support. No anon/authenticated writes.

CREATE TABLE public.operation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('mcp', 'whatsapp_button', 'web', 'api')),
  subject_phone text NOT NULL,              -- canonical phone that owns the intent
  action text NOT NULL CHECK (action IN ('confirm', 'cancel')),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  payload_hash text NOT NULL,               -- sha256 of channel|phone|action|appointment
  status text NOT NULL DEFAULT 'pending_confirmation'
    CHECK (status IN ('pending_confirmation', 'executing', 'succeeded', 'failed', 'expired')),
  result jsonb,
  confirmation_evidence jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One live intent per (phone, appointment, action): preparing twice returns
-- the same operation instead of piling up rows.
CREATE UNIQUE INDEX operation_requests_one_pending
  ON public.operation_requests (subject_phone, appointment_id, action)
  WHERE status = 'pending_confirmation';

CREATE INDEX idx_operation_requests_appointment ON public.operation_requests (appointment_id);

CREATE TRIGGER update_operation_requests_updated_at
  BEFORE UPDATE ON public.operation_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.operation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read operation requests"
  ON public.operation_requests FOR SELECT TO authenticated
  USING (public.is_admin_or_superadmin(auth.uid()));
