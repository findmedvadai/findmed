-- B10 · Messaging cutover: every patient message goes out from FindMed through
-- the WHAAPY API; n8n stops receiving FindMed events (decided by Alex, 13-oct).
--
-- * message_routes.owner = 'findmed' for every event. dispatch-webhook then
--   enqueues the event in domain_outbox and no longer calls any webhook for it
--   (single owner, A5); findmed-events-worker sends the mapped templates.
--   The 14 mapped steps were validated against the real WHAAPY catalog
--   (14/14, 12-oct). Events without steps (post-consultation) send nothing,
--   exactly as today (n8n had no consumer for them, F18).
-- * The outgoing webhooks that pointed to n8n are paused (not deleted), so the
--   Webhooks screen shows the real state and the change can be reverted from
--   the UI. They only subscribed to these same 8 events.
--
-- Revert: set the owner back to 'n8n' per event from /admin/automatizacion and
-- reactivate the webhooks.

UPDATE public.message_routes
   SET owner = 'findmed', updated_at = now()
 WHERE owner <> 'findmed';

UPDATE public.webhooks
   SET is_active = false
 WHERE is_active
   AND url LIKE 'https://automation.vadai.com.mx/%';
