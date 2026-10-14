-- "Pedir documentos" only on the first booking, never on a reschedule.
--
-- Problem: the patient reschedules from /gestionar → manage-reschedule creates
-- a NEW appointment (and cancels the old one) and emits
-- appointment.status_changed with new_status = 'scheduled' for it. That is the
-- same event as a first booking, so the worker sent both scheduled steps again,
-- including pedir_documentos (póliza + INE) that the patient already received.
-- Staff reschedules (admin/doctor) move the appointment in place and only emit
-- appointment.rescheduled_by_staff, which has no document step.
--
-- Fix:
--  * message_route_steps.skip_on_reschedule: the step is not sent when the
--    event comes from a reschedule. The worker (_shared/messaging.ts) treats
--    as reschedule any appointment.rescheduled* event and any event whose
--    payload carries `rescheduled_from` (manage-reschedule sets it with the
--    old appointment id). Editable from Automatización ("No enviar al
--    reagendar").
--  * pedir_documentos gets it on. The other scheduled step
--    (reservada_estado_cita, with the new date and the /gestionar link) is
--    still sent on a reschedule.
--
-- Default false keeps every other step as it is. RLS: no new table; the
-- existing SELECT policy for admins covers the column, writes stay in
-- messaging-admin (service key).

ALTER TABLE public.message_route_steps
  ADD COLUMN IF NOT EXISTS skip_on_reschedule boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.message_route_steps.skip_on_reschedule IS
  'true = the step is only sent on the original booking, never when the event comes from a reschedule (payload.rescheduled_from or appointment.rescheduled* events).';

UPDATE public.message_route_steps
   SET skip_on_reschedule = true
 WHERE template_name = 'pedir_documentos'
   AND skip_on_reschedule = false;
