-- 20261020130000_appointment_patient_name.sql
--
-- Garantía 20-oct-2026 (caso real del 19-oct): un mismo teléfono (el del titular, quien
-- escribe por WhatsApp) agenda para varias personas de su familia. Hasta hoy cada reserva
-- hacía `UPDATE patients SET full_name = <nombre recibido>`: reservar para un hijo
-- renombraba al titular y todas sus citas pasadas y futuras mostraban el nombre del hijo.
--
--   1. appointments.patient_name: nombre de quien RECIBE la atención en esa cita. El
--      titular (dueño del teléfono) sigue en patients.full_name y ya no se sobrescribe.
--      Las vistas muestran `patient_name ?? patients.full_name`. Backfill: el nombre
--      actual del paciente (lo mejor que sabemos de las citas existentes).
--   2. reservation_sessions.patient_name: el nombre que dio el agente al generar el
--      enlace /reserva; reserve-create lo copia a la cita.
--
-- Privilegios: appointments y reservation_sessions tienen GRANT SELECT de tabla para
-- authenticated (no por columna, a diferencia de doctors/doctor_offices), así que la
-- columna nueva es legible sin GRANT extra. guard_client_appointment_update usa una lista
-- de columnas EDITABLES por un doctor (notas y completar): patient_name no está en ella,
-- así que un doctor no puede cambiarla desde el navegador; el admin la edita vía la Edge
-- Function admin-update-patient-insurance (action "contact").
--
-- Idempotente. Probado en supabase/tests/patient-name-contact_test.ts (PGlite).

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS patient_name text;
ALTER TABLE public.reservation_sessions ADD COLUMN IF NOT EXISTS patient_name text;

UPDATE public.appointments a
SET patient_name = p.full_name
FROM public.patients p
WHERE a.patient_id = p.id
  AND a.patient_name IS NULL
  AND nullif(btrim(p.full_name), '') IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_patient_name_len') THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_patient_name_len
      CHECK (patient_name IS NULL OR char_length(btrim(patient_name)) BETWEEN 1 AND 160);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_sessions_patient_name_len') THEN
    ALTER TABLE public.reservation_sessions
      ADD CONSTRAINT reservation_sessions_patient_name_len
      CHECK (patient_name IS NULL OR char_length(btrim(patient_name)) BETWEEN 1 AND 160);
  END IF;
END $$;

COMMENT ON COLUMN public.appointments.patient_name IS
  'Nombre de quien recibe la atención en esta cita (puede ser un familiar del titular). Mostrar patient_name ?? patients.full_name.';
COMMENT ON COLUMN public.reservation_sessions.patient_name IS
  'Nombre de quien se atenderá, dado al generar el enlace /reserva; reserve-create lo copia a appointments.patient_name.';
