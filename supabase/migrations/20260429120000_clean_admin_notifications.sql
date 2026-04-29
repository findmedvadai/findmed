-- Remove all existing admin notifications except postconsultation_submitted.
-- Going forward, only postconsultation_submitted flows insert admin rows.
DELETE FROM public.notifications
WHERE recipient_role = 'admin'
  AND type != 'postconsultation_submitted';
