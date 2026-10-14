-- 20261014160000_security_hardening.sql
--
-- Auditoría de seguridad del 14-oct-2026 (docs/findmed-migration/hallazgos.md N13 y S02–S07).
-- Endurece privilegios y RLS sin cambiar ningún flujo legítimo del panel:
--
--   1. anon (la publishable key) deja de tener privilegios en las tablas de public.
--      Hoy RLS ya le devolvía 0 filas en las 40 tablas; esto es defensa en profundidad
--      para tablas futuras. Los pacientes nunca leen tablas: usan Edge Functions.
--   2. authenticated pierde TRUNCATE/TRIGGER/REFERENCES (TRUNCATE ignora RLS).
--   3. Las funciones de rol (has_role, is_admin_or_superadmin, get_doctor_id_for_user)
--      dejan de ser invocables por anon vía /rpc (oráculo de roles por UUID). Las tres
--      políticas que estaban "TO public" pasan a "TO authenticated" para que anon nunca
--      las evalúe.
--   4. users / user_roles: sin escrituras desde el navegador. Altas, cambios de rol y
--      credenciales van solo por Edge Functions (service role). Cierra "un admin se
--      otorga superadmin desde la consola".
--   5. doctor_offices / doctors: el navegador ya no puede leer los refresh tokens de
--      Google/Outlook (privilegios por columna). Se agregan columnas generadas
--      google_token_stored / outlook_token_stored para saber si hay token sin exponerlo.
--      doctor_offices sin escrituras desde el navegador (todo pasa por doctor-office-*).
--      IMPORTANTE para migraciones futuras: una columna nueva en doctor_offices o doctors
--      NO es legible por authenticated hasta que se haga GRANT SELECT (columna).
--   6. appointments: un doctor (no admin) solo puede cambiar doctor_notes,
--      doctor_notes_updated_at y completar la cita (scheduled/confirmed → completed).
--      Antes podía cambiar start_at, status, cancel_reason, marcadores de cron, etc.
--   7. doctors: un doctor (no admin) solo puede cambiar full_name y phone (antes podía
--      reactivarse con is_active o des-borrarse con is_deleted).
--   8. notifications: el navegador solo puede actualizar is_read; un doctor solo inserta
--      el aviso "postconsultation_submitted" de una cita suya.
--   9. post_consultation_forms: un doctor solo inserta formularios de citas suyas y en
--      estado inicial.
--
-- Idempotente: se puede correr dos veces. Probado en supabase/tests/security-hardening_test.ts.

-- 1 + 2. Privilegios de tabla -------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;

-- 3. Funciones de rol y políticas "TO public" ---------------------------------------------
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND (tablename, policyname) IN (
        ('notifications', 'Doctor can insert admin notifications'),
        ('patients', 'Doctor can read own patients'),
        ('webhooks', 'Admin can manage webhooks'))
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', p.policyname, p.tablename);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_superadmin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_doctor_id_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_or_superadmin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_doctor_id_for_user(uuid) TO authenticated, service_role;

-- 4. users / user_roles: solo lectura desde el navegador -----------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.users, public.user_roles FROM authenticated;

-- 5. Refresh tokens fuera del alcance del navegador -----------------------------------------
ALTER TABLE public.doctor_offices
  ADD COLUMN IF NOT EXISTS google_token_stored boolean
    GENERATED ALWAYS AS (google_refresh_token_ref IS NOT NULL) STORED;
ALTER TABLE public.doctor_offices
  ADD COLUMN IF NOT EXISTS outlook_token_stored boolean
    GENERATED ALWAYS AS (outlook_refresh_token_ref IS NOT NULL) STORED;

REVOKE INSERT, UPDATE, DELETE ON public.doctor_offices FROM authenticated;

-- SELECT por columna: todas menos los tokens. REVOKE de tabla también quita los permisos
-- por columna, así que volver a correrlo deja el mismo estado.
DO $$
DECLARE
  t text;
  cols text;
  upd_cols text;
BEGIN
  FOREACH t IN ARRAY ARRAY['doctor_offices', 'doctors'] LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
    FROM pg_attribute
    WHERE attrelid = format('public.%I', t)::regclass AND attnum > 0 AND NOT attisdropped
      AND attname NOT IN ('google_refresh_token_ref', 'outlook_refresh_token_ref');
    EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO authenticated', cols, t);
  END LOOP;

  -- doctors: el admin edita desde el panel (activar, borrar lógico, datos). Nunca tokens.
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO upd_cols
  FROM pg_attribute
  WHERE attrelid = 'public.doctors'::regclass AND attnum > 0 AND NOT attisdropped
    AND attname NOT IN ('id', 'created_at', 'google_refresh_token_ref', 'outlook_refresh_token_ref',
                        'google_calendar_connected', 'google_calendar_id',
                        'outlook_calendar_connected', 'outlook_calendar_id');
  EXECUTE 'REVOKE UPDATE ON public.doctors FROM authenticated';
  EXECUTE format('GRANT UPDATE (%s) ON public.doctors TO authenticated', upd_cols);
END $$;

-- Altas y borrados físicos de médicos solo por create-doctor (service role).
REVOKE INSERT, DELETE ON public.doctors FROM authenticated;

-- 6 + 7. Guardas de columnas para usuarios que no son admin ---------------------------------
-- Corren solo cuando la sesión es `authenticated` (PostgREST); el service role de las Edge
-- Functions y las migraciones no pasan por aquí.
CREATE OR REPLACE FUNCTION public.guard_client_appointment_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  editable constant text[] := ARRAY['doctor_notes', 'doctor_notes_updated_at', 'status', 'updated_at'];
BEGIN
  IF current_user <> 'authenticated' OR public.is_admin_or_superadmin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - editable) IS DISTINCT FROM (to_jsonb(OLD) - editable) THEN
    RAISE EXCEPTION 'Solo puedes editar las notas de la cita o marcarla como completada'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (NEW.status = 'completed' AND OLD.status IN ('scheduled', 'confirmed')) THEN
    RAISE EXCEPTION 'Cambio de estado no permitido: usa cancelar o reagendar'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_client_appointment_update ON public.appointments;
CREATE TRIGGER guard_client_appointment_update
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_appointment_update();

CREATE OR REPLACE FUNCTION public.guard_client_doctor_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  editable constant text[] := ARRAY['full_name', 'phone', 'updated_at'];
BEGIN
  IF current_user <> 'authenticated' OR public.is_admin_or_superadmin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - editable) IS DISTINCT FROM (to_jsonb(OLD) - editable) THEN
    RAISE EXCEPTION 'Solo puedes editar tu nombre y teléfono' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_client_doctor_update ON public.doctors;
CREATE TRIGGER guard_client_doctor_update
  BEFORE UPDATE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_doctor_update();

REVOKE EXECUTE ON FUNCTION public.guard_client_appointment_update() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guard_client_doctor_update() FROM PUBLIC, anon;

-- 8. notifications --------------------------------------------------------------------------
REVOKE UPDATE ON public.notifications FROM authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

DROP POLICY IF EXISTS "Doctor can insert admin notifications" ON public.notifications;
CREATE POLICY "Doctor can insert admin notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    recipient_role = ANY (ARRAY['admin'::public.app_role, 'superadmin'::public.app_role])
    AND type = 'postconsultation_submitted'::public.notification_type
    AND case_id IS NULL
    AND doctor_id = public.get_doctor_id_for_user(auth.uid())
    AND (appointment_id IS NULL OR EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = notifications.appointment_id AND a.doctor_id = notifications.doctor_id))
  );

-- 9. post_consultation_forms ----------------------------------------------------------------
DROP POLICY IF EXISTS "Doctor can insert own forms" ON public.post_consultation_forms;
CREATE POLICY "Doctor can insert own forms" ON public.post_consultation_forms
  FOR INSERT TO authenticated
  WITH CHECK (
    doctor_id = public.get_doctor_id_for_user(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = post_consultation_forms.appointment_id
        AND a.doctor_id = post_consultation_forms.doctor_id)
    AND review_status = 'pending'::public.post_consultation_status
    AND report_sent_at IS NULL
    AND report_destination_id IS NULL
  );
