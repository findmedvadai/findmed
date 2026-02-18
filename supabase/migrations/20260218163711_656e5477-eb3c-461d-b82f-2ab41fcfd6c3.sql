CREATE POLICY "Doctor can read own patients"
  ON public.patients
  FOR SELECT
  USING (
    id IN (
      SELECT patient_id FROM public.appointments
      WHERE doctor_id = get_doctor_id_for_user(auth.uid())
    )
  );