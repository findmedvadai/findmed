import { describe, expect, it } from "vitest";
import { isManagementType, MANAGEMENT_TYPES, MANAGEMENT_TYPE_INFO, suggestManagementType } from "./management-type";
import { CASE_TYPE_LABEL, formatMoney, nextReimbursementStatuses } from "./case-labels";

describe("suggestManagementType (misma regla que _shared/postconsult-routes.ts)", () => {
  it("hospitalización manda sobre estudios", () => {
    expect(suggestManagementType({ hospitalization: true, lab_tests: true })).toBe("procedimiento");
  });
  it("imagen o laboratorio → estudios", () => {
    expect(suggestManagementType({ imaging_studies: true })).toBe("estudios");
    expect(suggestManagementType({ lab_tests: true })).toBe("estudios");
  });
  it("nada capturado → conservador; urgente nunca se sugiere", () => {
    expect(suggestManagementType({})).toBe("conservador");
    const all = [
      suggestManagementType({ hospitalization: true }),
      suggestManagementType({ imaging_studies: true }),
      suggestManagementType({}),
    ];
    expect(all).not.toContain("urgente");
  });
  it("todos los tipos tienen etiqueta y se validan", () => {
    for (const t of MANAGEMENT_TYPES) {
      expect(MANAGEMENT_TYPE_INFO[t].label.length).toBeGreaterThan(0);
      expect(isManagementType(t)).toBe(true);
    }
    expect(isManagementType("cirugia")).toBe(false);
    expect(isManagementType(null)).toBe(false);
  });
});

describe("case-labels", () => {
  it("etiqueta los tipos nuevos de caso", () => {
    expect(CASE_TYPE_LABEL.procedure).toBe("Procedimiento");
    expect(CASE_TYPE_LABEL.referral).toBe("Referencia");
    expect(CASE_TYPE_LABEL.reimbursement).toBe("Reembolso");
  });
  it("los reembolsos solo avanzan y los estados finales no cambian", () => {
    expect(nextReimbursementStatuses("recibido")).toEqual(["en_proceso", "finalizado", "rechazado"]);
    expect(nextReimbursementStatuses("en_proceso")).toEqual(["finalizado", "rechazado"]);
    expect(nextReimbursementStatuses("finalizado")).toEqual([]);
    expect(nextReimbursementStatuses("rechazado")).toEqual([]);
  });
  it("formatea montos con su moneda", () => {
    expect(formatMoney(null, "MXN")).toBeNull();
    expect(formatMoney(1500.5, "MXN")).toMatch(/1,500\.50/);
    expect(formatMoney(1500.5, "MXN")).toContain("MXN");
  });
});
