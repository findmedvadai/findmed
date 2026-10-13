-- Triage catalog v2 (D12, N31/N32).
--
-- The source catalog repeated each condition 20 times with synthetic phrases
-- and had no explicit first stop, so the agent could book an elective consult
-- for an "urgencias hoy" condition. v2 is one row per condition with:
--  * primera_parada: where the patient goes first (returned to the agent as
--    `routing`; urgent routes never book a consult);
--  * requiere_todos / requiere_alguno: gate terms an urgent condition needs to
--    be eligible ("dolor de cabeza" alone is not "cefalea de alarma");
--  * pregunta_diferencial: the question that breaks a tie;
--  * accion_operativa: internal clinical guidance, never returned to the agent;
--  * origen / validado: provenance and review by FindMed's medical team.
-- Rows are loaded by scripts/import-triage.mjs; the catalog itself is not in
-- the repo (it is FindMed's clinical content and the repo is public).

ALTER TABLE public.triage_findmed
  ADD COLUMN padecimiento text,
  ADD COLUMN primera_parada text CHECK (primera_parada IN ('urgencias_inmediato', 'urgencias_hoy', 'consulta_mismo_dia', 'consulta')),
  ADD COLUMN requiere_todos text[] NOT NULL DEFAULT '{}',
  ADD COLUMN requiere_alguno text[] NOT NULL DEFAULT '{}',
  ADD COLUMN pregunta_diferencial text,
  ADD COLUMN accion_operativa text,
  ADD COLUMN origen text,
  ADD COLUMN validado boolean NOT NULL DEFAULT false;

-- v2 splits "Cirugia+Gastro+Coloprocto" and adds specialties FindMed does have.
-- Search lists ordered by doctors available on 12-oct-2026.
UPDATE public.triage_specialty_map
   SET patient_label = 'Cirujano general',
       search_specialties = '{Cirugía General,Gastroenterología,Proctología}',
       notes = 'Agrupación del catálogo v1'
 WHERE especialidad = 'Cirugia+Gastro+Coloprocto';

INSERT INTO public.triage_specialty_map (especialidad, patient_label, search_specialties, notes) VALUES
  ('CirugiaGeneral', 'Cirujano general', '{Cirugía General}', NULL),
  ('Gastroenterologia', 'Gastroenterólogo', '{Gastroenterología,Medicina Interna}', NULL),
  ('Coloproctologia', 'Coloproctólogo', '{Proctología,Cirugía General}', NULL),
  ('Oftalmologia', 'Oftalmólogo', '{Oftalmología}', NULL),
  ('CirugiaPlastica', 'Cirujano plástico', '{Plástico Reconstructor}', NULL)
ON CONFLICT (especialidad) DO UPDATE
  SET patient_label = EXCLUDED.patient_label, search_specialties = EXCLUDED.search_specialties;
