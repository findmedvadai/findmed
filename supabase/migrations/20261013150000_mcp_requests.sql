-- Log of every request the WHAAPY agent makes to findmed-mcp (admin AI
-- dashboard, /admin/agente-ia). Lets the team see, while going live, what the
-- agent asked, what FindMed answered and where it failed: connection tests
-- (initialize/tools/list), tool calls with their arguments and result,
-- validation errors and rejected tokens.
--
-- Contains patient data (phone, name, symptoms in arguments/results): admins
-- read via RLS, only the Edge Function writes, kept 12 months like the rest of
-- the WhatsApp history.

CREATE TABLE public.mcp_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('auth_failed', 'initialize', 'tools/list', 'tools/call', 'protocol_error', 'other')),
  method text,
  tool_name text,
  subject_phone text,                 -- canonical phone from arguments.phone, when present
  arguments jsonb,
  ok boolean NOT NULL,
  status text,                        -- success | failed | needs_more_info | pending_confirmation | queued
  error_code text,
  error_message text,
  duration_ms integer,
  trace_id text,
  result jsonb,                       -- envelope returned to the agent (truncated if huge)
  client text,                        -- User-Agent (connection tests)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mcp_requests_created ON public.mcp_requests (created_at DESC);
CREATE INDEX idx_mcp_requests_phone ON public.mcp_requests (subject_phone, created_at DESC) WHERE subject_phone IS NOT NULL;
CREATE INDEX idx_mcp_requests_errors ON public.mcp_requests (created_at DESC) WHERE NOT ok;

ALTER TABLE public.mcp_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read mcp requests" ON public.mcp_requests
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));

SELECT cron.schedule('purge-mcp-requests', '50 9 * * *',
  $$DELETE FROM public.mcp_requests WHERE created_at < now() - interval '12 months'$$);
