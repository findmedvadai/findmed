-- =============================================
-- Durable audit log for calendar connection lifecycle events
-- =============================================
-- Problem this solves: when a Google/Outlook Calendar auto-disconnects (the
-- provider invalidates the refresh token and `_shared/calendar-tokens.ts`
-- flips the office to disconnected), the ONLY trace was a `console.warn` in the
-- Edge Function logs, which rotate out in ~24h. We lost exactly this evidence
-- for two affected doctors and could not determine root cause. Application logs
-- are NOT an acceptable store for this — that is the specific thing that failed
-- us. This table is that durable, queryable, non-expiring store.
--
-- It also records MANUAL disconnects (doctor/admin dropping a stale connection
-- via doctor-office-update). During the diagnosis we could not tell whether an
-- affected office died by manual disconnect or by Google; `event_type`
-- disambiguates that from the first event onward.
--
-- Design notes:
--   * Append-only. Nothing in the app deletes from this table. It must survive
--     indefinitely so a disconnect weeks/months ago is still investigable.
--   * `office_id` / `doctor_id` are stored as plain UUIDs WITHOUT foreign keys
--     on purpose. Doctors are hard-deletable (ON DELETE CASCADE from doctors ->
--     doctor_offices), and an FK here would cascade-delete the forensic history
--     with them. Decoupling keeps the evidence even after the office/doctor row
--     is gone — which is precisely when you most need it.
--   * Inserts happen only from Edge Functions using the service-role key, which
--     bypasses RLS. There is therefore no INSERT policy; the only RLS policy is
--     a SELECT gate for admins who investigate.

CREATE TABLE IF NOT EXISTS public.calendar_connection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
  event_type TEXT NOT NULL CHECK (event_type IN ('auto_disconnect', 'manual_disconnect')),

  -- Which office/doctor. Plain UUIDs (no FK) for durability across deletion.
  office_id UUID NOT NULL,
  doctor_id UUID,

  -- What caused it.
  --   auto_disconnect: the provider error code (e.g. 'invalid_grant').
  --   manual_disconnect: 'manual'.
  reason_code TEXT,
  -- auto_disconnect only: HTTP status + full provider JSON body of the failed
  -- token refresh, so the actual reason returned is preserved verbatim.
  http_status INTEGER,
  provider_response JSONB,

  -- manual_disconnect only: who triggered it.
  actor_user_id UUID,
  actor_role TEXT,

  -- Token lifetime measurement. `connected_at` is the office's stored connect
  -- timestamp at the moment of disconnect (NULL for connections that predate
  -- the connect-time capture, or when unknown). `lifetime_seconds` is derived.
  connected_at TIMESTAMPTZ,

  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  lifetime_seconds BIGINT GENERATED ALWAYS AS (
    CASE
      WHEN connected_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (occurred_at - connected_at))::BIGINT
      ELSE NULL
    END
  ) STORED
);

-- Investigation access patterns: by office, by doctor, by time.
CREATE INDEX IF NOT EXISTS idx_calendar_connection_events_office
  ON public.calendar_connection_events (office_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_connection_events_doctor
  ON public.calendar_connection_events (doctor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_connection_events_occurred_at
  ON public.calendar_connection_events (occurred_at DESC);

COMMENT ON TABLE public.calendar_connection_events IS
  'Durable, append-only audit log of calendar disconnect events (auto via provider invalid_grant, and manual). Independent of Edge Function log retention. Never deleted by the app.';

-- RLS: admins read for investigation; inserts come from service-role Edge
-- Functions which bypass RLS entirely, so no INSERT/UPDATE/DELETE policy exists.
ALTER TABLE public.calendar_connection_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read calendar_connection_events"
  ON public.calendar_connection_events
  FOR SELECT TO authenticated
  USING (public.is_admin_or_superadmin(auth.uid()));

-- =============================================
-- Connect-time capture on doctor_offices
-- =============================================
-- Stamped when a calendar connection goes live (the doctor picks a calendar and
-- the office flips `*_calendar_connected` to true). Enables measuring token
-- lifetime (connect -> drop). Nullable, no backfill: connections that predate
-- this migration have an unknown connect time and stay NULL until reconnected.
ALTER TABLE public.doctor_offices
  ADD COLUMN IF NOT EXISTS google_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outlook_connected_at TIMESTAMPTZ;

COMMENT ON COLUMN public.doctor_offices.google_connected_at IS
  'When the Google Calendar connection last went live (calendar picked, connected flipped true). Used to measure token lifetime. NULL for connections predating this capture.';

COMMENT ON COLUMN public.doctor_offices.outlook_connected_at IS
  'When the Outlook Calendar connection last went live (calendar picked, connected flipped true). Used to measure token lifetime. NULL for connections predating this capture.';
