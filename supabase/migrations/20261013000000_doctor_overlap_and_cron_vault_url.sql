-- Follow-up to 20261012120000 (already applied in production; never edit an
-- applied migration — see ERRORES.md 2026-10-12).
--
-- [D2] Decision D2 (Alex, 2026-10-12): a doctor can't be booked twice at the
--      same time, even across different offices. Replaces the per-office
--      exclusion constraint with a per-doctor one. The pre-check aborts with an
--      explicit message if live data already overlaps; such cases are resolved
--      with operations, never by deleting appointments here.
-- [CRON-URL] invoke_edge_function had the production URL hard-coded, so any
--      environment applying the migrations (local, preview, staging) would make
--      its crons call PRODUCTION functions. The base URL now lives in Vault
--      (`edge_functions_base_url`); without it, or without the key, the
--      function is a no-op.

-- [D2] ---------------------------------------------------------------------

DO $$
DECLARE
  overlapping int;
BEGIN
  SELECT count(*) INTO overlapping
  FROM public.appointments a
  JOIN public.appointments b
    ON a.id < b.id
   AND a.doctor_id = b.doctor_id
   AND a.status IN ('scheduled', 'confirmed')
   AND b.status IN ('scheduled', 'confirmed')
   AND tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)');
  IF overlapping > 0 THEN
    RAISE EXCEPTION 'appointments_no_overlap_per_doctor: % pares de citas activas del mismo doctor se traslapan; resolverlos antes de aplicar esta migración', overlapping;
  END IF;
END $$;

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_no_overlap_per_office;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_overlap_per_doctor
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status IN ('scheduled', 'confirmed'));

DROP INDEX IF EXISTS public.idx_appointments_office_active_range;
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_active_range
  ON public.appointments (doctor_id, start_at, end_at)
  WHERE status IN ('scheduled', 'confirmed');

-- [/D2] --------------------------------------------------------------------

-- [CRON-URL] ---------------------------------------------------------------

-- Carry the current URL into Vault once, but ONLY where cron credentials were
-- configured by hand (the `service_role_key` secret exists — production). A
-- fresh database has neither, so nothing is created and crons stay inert.
DO $$
DECLARE
  current_url text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'edge_functions_base_url')
     AND EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
    SELECT substring(pg_get_functiondef('public.invoke_edge_function(text)'::regprocedure)
                     FROM '(https://[a-z0-9]+\.supabase\.co/functions/v1)/')
      INTO current_url;
    IF current_url IS NOT NULL THEN
      PERFORM vault.create_secret(current_url, 'edge_functions_base_url',
        'Base URL for pg_cron -> Edge Function calls (public.invoke_edge_function)');
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'edge_functions_base_url') THEN
    RAISE NOTICE 'edge_functions_base_url not set: cron jobs are no-ops until it is created in Vault';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.invoke_edge_function(function_slug text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault
AS $$
DECLARE
  base_url text;
  service_key text;
BEGIN
  SELECT decrypted_secret INTO base_url
    FROM vault.decrypted_secrets WHERE name = 'edge_functions_base_url';
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF base_url IS NULL OR service_key IS NULL THEN
    RAISE NOTICE 'invoke_edge_function(%): skipped, missing edge_functions_base_url or service_role_key in Vault', function_slug;
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url := base_url || '/' || function_slug,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_edge_function(text) FROM PUBLIC, anon, authenticated;

-- [/CRON-URL] --------------------------------------------------------------
