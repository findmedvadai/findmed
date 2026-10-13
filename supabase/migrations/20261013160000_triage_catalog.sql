-- Triage catalog for suggest_specialty (M02, F10).
--
-- The n8n agent chose the specialist with free SQL against
-- public.triage_findmed in VADAI's Postgres ("Vadai Postgress" credential),
-- not in FindMed. This migration brings that catalog into FindMed with the
-- same columns, so the MCP tool can rank it with parameters (no SQL written by
-- the model) and keep provenance:
--
--  * triage_findmed: one row per clinical case of the catalog — specialty,
--    traffic light (semaforo), alarm signals to ask about, standardized
--    keywords. Loaded by an import script from the original table; `extra`
--    keeps any other source columns verbatim.
--  * triage_specialty_map: how each triage specialty is said to the patient
--    and which FindMed specialties (public.specialties.name) to search, in
--    order. Specialties FindMed doesn't offer map to an empty list, so the
--    agent hands off to a person instead of improvising.
--
-- Clinical content is FindMed's: rows are imported as they are, never
-- generated. Admins read via RLS; writes only with the service key.

CREATE TABLE public.triage_findmed (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  especialidad text NOT NULL,
  semaforo text CHECK (semaforo IN ('ROJO', 'NARANJA', 'AMARILLO', 'VERDE')),
  si_esto_aparece_subir_a_urgencias text,
  keywords text[] NOT NULL DEFAULT '{}',
  extra jsonb,
  source text NOT NULL DEFAULT 'vadai_postgres.triage_findmed',
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_triage_findmed_keywords ON public.triage_findmed USING gin (keywords);

CREATE TABLE public.triage_specialty_map (
  especialidad text PRIMARY KEY,          -- value as it appears in triage_findmed
  patient_label text NOT NULL,            -- what the agent tells the patient
  search_specialties text[] NOT NULL DEFAULT '{}', -- public.specialties.name, in search order
  notes text
);

ALTER TABLE public.triage_findmed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triage_specialty_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read triage catalog" ON public.triage_findmed
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));
CREATE POLICY "Admins can read triage specialty map" ON public.triage_specialty_map
  FOR SELECT TO authenticated USING (public.is_admin_or_superadmin(auth.uid()));

-- Labels from the FINDI v1 prompt (PASO 6); search lists = FindMed catalog on
-- 12-oct-2026. Empty list = FindMed has no doctors of that specialty.
INSERT INTO public.triage_specialty_map (especialidad, patient_label, search_specialties, notes) VALUES
  ('Cirugia+Gastro+Coloprocto', 'Gastroenterólogo', '{Gastroenterología,Cirugía General,Proctología}', NULL),
  ('Ortopedia', 'Ortopedista', '{Ortopedia}', NULL),
  ('Urologia', 'Urólogo', '{Urología}', NULL),
  ('Ginecologia', 'Ginecólogo', '{Ginecología}', NULL),
  ('Otorrino', 'Otorrinolaringólogo', '{Otorrinolaringología}', NULL),
  ('MedicinaInterna', 'Internista', '{Medicina Interna}', NULL),
  ('Cardiologia', 'Cardiólogo', '{}', 'Sin cardiología en el catálogo de FindMed'),
  ('Neurologia', 'Neurólogo', '{}', 'Sin neurología en el catálogo de FindMed'),
  ('Neurocirugia', 'Neurocirujano', '{Neurocirugía}', NULL),
  ('Oncologia', 'Oncólogo', '{Oncología}', NULL),
  ('Neumologia', 'Neumólogo', '{}', 'Sin neumología en el catálogo de FindMed'),
  ('Nefrologia', 'Nefrólogo', '{}', 'Sin nefrología en el catálogo de FindMed'),
  ('Vascular', 'Cirujano vascular', '{Angiología y Cirugía Vascular}', NULL);
