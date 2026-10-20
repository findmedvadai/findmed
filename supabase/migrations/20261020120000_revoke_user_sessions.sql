-- Configuración → Usuarios: "Desactivar acceso" cierra las sesiones abiertas.
--
-- La Edge Function admin-users desactiva una cuenta del equipo con un ban en
-- Auth (auth.admin.updateUserById({ ban_duration })). El ban impide iniciar
-- sesión y renovar el token, pero la API de administración de Auth no tiene
-- "cerrar las sesiones de este usuario": sin esto, una pestaña abierta seguiría
-- renovando hasta que el ban se lea en el siguiente refresh. Borrar las filas
-- de auth.sessions (refresh_tokens cae en cascada por session_id) invalida
-- cualquier renovación; el access token vigente expira solo (máx. 1 h).
--
-- Solo la service role la ejecuta (la llama admin-users tras verificar que
-- quien pide es admin). Nunca anon ni authenticated.

CREATE OR REPLACE FUNCTION public.revoke_user_sessions(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  removed integer := 0;
BEGIN
  IF _user_id IS NULL THEN
    RETURN 0;
  END IF;
  DELETE FROM auth.sessions WHERE user_id = _user_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  -- Tokens antiguos sin session_id (no caen en la cascada).
  DELETE FROM auth.refresh_tokens WHERE user_id = _user_id::text;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_sessions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_user_sessions(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(uuid) TO service_role;

COMMENT ON FUNCTION public.revoke_user_sessions(uuid) IS
  'Cierra las sesiones de Auth de un usuario (desactivar acceso en Configuración → Usuarios). Solo service_role.';
