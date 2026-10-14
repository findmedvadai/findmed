-- Triage catalog editable from the admin panel (Configuración → Catálogos →
-- Triaje).
--
-- Until now the catalog (triage_findmed + triage_specialty_map) was loaded
-- only with scripts/import-triage.mjs. The team now reviews, edits, validates
-- and tests it from the panel; writes go through the Edge Function
-- `triage-admin` (requireAdmin + vocabulary validation against
-- _shared/triage.ts), never directly from the browser.
--
--  * is_active: an inactive condition is kept (and its history) but the engine
--    (suggest_specialty) ignores it.
--  * validated_by / validated_by_email / validated_at: who marked the
--    condition as reviewed by the clinical lead, and when. The email is a
--    snapshot so the record survives user changes.
--  * notas: internal notes of the team (never returned to the agent).
--  * updated_at / updated_by: last change, also used by the panel to detect
--    two people editing the same condition at once.
--  * triage_changes: append-only log of every change to the catalog (who,
--    when, action, before/after). condition_id has no FK on purpose so the log
--    survives a deleted condition. RLS: SELECT admins; inserts only from the
--    Edge Function with the service key. Never deleted.
--
-- The clinical content itself is not in this migration (the repo is public).

ALTER TABLE public.triage_findmed
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN notas text,
  ADD COLUMN validated_by uuid,
  ADD COLUMN validated_by_email text,
  ADD COLUMN validated_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_by uuid;

-- The engine filters by is_active on every query.
CREATE INDEX idx_triage_findmed_active ON public.triage_findmed (is_active);

CREATE TABLE public.triage_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL CHECK (entity IN ('condition', 'specialty_map')),
  action text NOT NULL CHECK (action IN (
    'create', 'update', 'duplicate', 'activate', 'deactivate', 'validate', 'unvalidate', 'delete',
    'map_create', 'map_update', 'map_delete'
  )),
  condition_id bigint,          -- triage_findmed.id (no FK: survives a delete)
  especialidad text,            -- triage_specialty_map.especialidad for map changes
  actor_user_id uuid,
  actor_email text,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_triage_changes_condition ON public.triage_changes (condition_id, created_at DESC);
CREATE INDEX idx_triage_changes_created ON public.triage_changes (created_at DESC);

ALTER TABLE public.triage_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read triage changes" ON public.triage_changes
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));
