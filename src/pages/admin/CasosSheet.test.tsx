import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CaseSheet } from "./Casos";
import type { PatientCase } from "@/lib/case-actions";

// QA 2026-10-14: case-actions exige tomar el caso antes de pasarlo a
// "Asignado"/"Esperando…" (409 take_first); el selector lo ofrecía igual.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, role: "admin" }) }));
vi.mock("@/integrations/supabase/client", () => {
  const proxy: unknown = new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko);
      if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
      return () => proxy;
    },
  });
  return {
    supabase: {
      from: () => proxy,
      functions: { invoke: vi.fn() },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    },
  };
});

const caseRow = {
  id: "c1",
  status: "awaiting_assignment",
  priority: "normal",
  request_type: "hospital",
  summary: "Necesita presupuesto",
  subject_phone: "+525500000001",
  contact_name: "Paciente Demo",
  assigned_user_id: null,
  ai_state: "not_requested",
  whaapy_assignment: "none",
  alert_level: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as unknown as PatientCase;

function renderSheet(row: PatientCase) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CaseSheet caseRow={row} staff={{}} me="u1" onClose={() => {}} onChanged={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CaseSheet · estado del caso", () => {
  it("sin responsable pide tomar el caso antes de cambiar el estado", () => {
    renderSheet(caseRow);
    expect(screen.getByText(/Toma el caso para cambiarlo/)).toBeInTheDocument();
  });

  it("con responsable no muestra la indicación", () => {
    renderSheet({ ...caseRow, status: "assigned", assigned_user_id: "u1" } as PatientCase);
    expect(screen.queryByText(/Toma el caso para cambiarlo/)).not.toBeInTheDocument();
  });
});
