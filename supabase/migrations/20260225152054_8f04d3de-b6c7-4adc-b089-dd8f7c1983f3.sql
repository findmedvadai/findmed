CREATE POLICY "Doctor can insert admin notifications"
  ON public.notifications
  FOR INSERT
  WITH CHECK (
    recipient_role IN ('admin', 'superadmin')
    AND doctor_id = get_doctor_id_for_user(auth.uid())
  );