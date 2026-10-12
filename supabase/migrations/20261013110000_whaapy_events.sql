-- Durable inbox for webhooks sent by WHAAPY to FindMed (Edge Function
-- `whaapy-inbound`). Every verified delivery is stored first and processed
-- afterwards (delivery receipts for the messaging center, handoff/conversation
-- state, WhatsApp button replies), so a processing bug never loses an event and
-- WHAAPY's retries (up to 3) never produce duplicates (dedupe_key is unique).
--
-- Payloads can contain patient data: RLS allows reading only to admins, and
-- writes only happen through the service key.

CREATE TABLE public.whaapy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,   -- sha256(event|timestamp|message/conversation ids)
  event_type text NOT NULL,          -- e.g. message.delivered, conversation.assigned
  event_timestamp timestamptz,       -- `timestamp` of the WHAAPY payload
  whaapy_message_id text,
  conversation_id text,
  contact_id text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text
);

CREATE INDEX idx_whaapy_events_unprocessed ON public.whaapy_events (received_at) WHERE processed_at IS NULL;
CREATE INDEX idx_whaapy_events_message ON public.whaapy_events (whaapy_message_id) WHERE whaapy_message_id IS NOT NULL;
CREATE INDEX idx_whaapy_events_conversation ON public.whaapy_events (conversation_id) WHERE conversation_id IS NOT NULL;

ALTER TABLE public.whaapy_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read whaapy events"
  ON public.whaapy_events FOR SELECT TO authenticated
  USING (public.is_admin_or_superadmin(auth.uid()));
