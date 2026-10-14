import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  changedFields,
  countConditions,
  emptyConditionForm,
  filterConditions,
  formFromCondition,
  formProblems,
  hasActiveFilters,
  keywordLabel,
  suggestKeywords,
  type TriageCondition,
} from "./triage-admin";

const row = (over: Partial<TriageCondition>): TriageCondition => ({
  id: 1, especialidad: "Ortopedia", padecimiento: "Esguince de tobillo", semaforo: "AMARILLO", primera_parada: "consulta",
  keywords: ["tobillo", "dolor"], requiere_todos: [], requiere_alguno: [], si_esto_aparece_subir_a_urgencias: null,
  pregunta_diferencial: null, accion_operativa: null, origen: "n8n_v1", notas: null, validado: false, is_active: true,
  extra: null, source: "x", imported_at: "", updated_at: "", updated_by: null, validated_at: null, validated_by: null,
  validated_by_email: null, ...over,
});

const rows = [
  row({ id: 1 }),
  row({ id: 2, especialidad: "Urologia", padecimiento: "Cólico renal", primera_parada: "urgencias_hoy", semaforo: "NARANJA", keywords: ["abdomen", "hematuria"], validado: true, origen: "nuevo" }),
  row({ id: 3, padecimiento: "Fractura", primera_parada: "urgencias_hoy", is_active: false }),
];

describe("triage-admin helpers", () => {
  it("keywordLabel muestra el término legible con acentos", () => {
    expect(keywordLabel("perdida_audicion")).toBe("pérdida audición");
    expect(keywordLabel("muneca")).toBe("muñeca");
    expect(keywordLabel("rodilla")).toBe("rodilla");
  });

  it("filtra por especialidad, ruta, validación, origen y estado", () => {
    expect(filterConditions(rows, { ...EMPTY_FILTERS, especialidad: "Urologia" }).map((r) => r.id)).toEqual([2]);
    expect(filterConditions(rows, { ...EMPTY_FILTERS, routing: "urgencias_hoy" }).map((r) => r.id)).toEqual([2, 3]);
    expect(filterConditions(rows, { ...EMPTY_FILTERS, validated: "no" }).map((r) => r.id)).toEqual([1, 3]);
    expect(filterConditions(rows, { ...EMPTY_FILTERS, origen: "nuevo" }).map((r) => r.id)).toEqual([2]);
    expect(filterConditions(rows, { ...EMPTY_FILTERS, status: "inactive" }).map((r) => r.id)).toEqual([3]);
    expect(filterConditions(rows, { ...EMPTY_FILTERS, light: "NARANJA" }).map((r) => r.id)).toEqual([2]);
  });

  it("la búsqueda ignora acentos y encuentra por palabra clave", () => {
    expect(filterConditions(rows, { ...EMPTY_FILTERS, search: "colico" }).map((r) => r.id)).toEqual([2]);
    expect(filterConditions(rows, { ...EMPTY_FILTERS, search: "hematuria renal" }).map((r) => r.id)).toEqual([2]);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: " x " })).toBe(true);
  });

  it("los conteos por ruta solo cuentan condiciones activas", () => {
    const c = countConditions(rows);
    expect(c).toMatchObject({ total: 3, active: 2, inactive: 1, validated: 1 });
    expect(c.byRouting).toEqual({ consulta: 1, urgencias_hoy: 1 });
  });

  it("el formulario detecta campos faltantes y se llena desde una condición", () => {
    expect(formProblems(emptyConditionForm())).toHaveLength(5);
    expect(formProblems(formFromCondition(rows[0]))).toEqual([]);
  });

  it("changedFields lista solo lo que cambió", () => {
    expect(changedFields({ keywords: ["a"], notas: null, validado: false }, { keywords: ["a", "b"], notas: null, validado: true }))
      .toEqual(["keywords", "validado"]);
    expect(changedFields(null, { keywords: [] })).toEqual([]);
  });
});

describe("suggestKeywords", () => {
  const vocab = ["rodilla", "caida", "dolor", "sangrado_rectal", "perdida_audicion", "ojo", "fiebre", "abdomen_superior"];
  it("sugiere términos del vocabulario a partir de texto libre", () => {
    expect(suggestKeywords("Me duele la rodilla desde que me caí, tengo fiebre", vocab)).toEqual(["rodilla", "caida", "fiebre"]);
    expect(suggestKeywords("pérdida de audición", vocab)).toEqual(["perdida_audicion"]);
    expect(suggestKeywords("dolor en el abdomen superior", vocab)).toEqual(["dolor", "abdomen_superior"]);
    expect(suggestKeywords("", vocab)).toEqual([]);
  });
});
