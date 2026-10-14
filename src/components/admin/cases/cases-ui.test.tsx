import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import CaseReimbursementPanel from "./CaseReimbursementPanel";
import CaseOriginCard from "./CaseOriginCard";
import NewCaseDialog from "./NewCaseDialog";
import type { PatientCase } from "@/lib/case-actions";

// Supabase falso de solo lectura: cada tabla responde sus filas.
const h = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string): unknown => {
    const rows = () => h.tables[table] ?? [];
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
            Promise.resolve({ data: rows(), error: null }).then(ok, ko);
        }
        if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve({ data: rows()[0] ?? null, error: null });
        return () => proxy;
      },
    });
    return proxy;
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      functions: { invoke: vi.fn() },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    },
  };
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

const baseCase = {
  id: "case-1",
  request_type: "reimbursement",
  status: "assigned",
  priority: "normal",
  appointment_id: null,
} as unknown as PatientCase;

describe("Casos — Etapa 2", () => {
  it("panel de reembolso: lista lo registrado y solo ofrece avanzar el estado", async () => {
    h.tables = {
      reimbursements: [{
        id: "r1", case_id: "case-1", insurer: "AXA Seguros", invoice_number: "F-1024", amount: 1500.5, currency: "MXN",
        status: "recibido", notes: "Factura original", created_at: "2026-10-12T16:00:00Z", submitted_at: null, resolved_at: null,
      }],
    };
    wrap(<CaseReimbursementPanel caseRow={baseCase} closed={false} onChanged={() => {}} />);
    expect(await screen.findByText("AXA Seguros")).toBeInTheDocument();
    expect(screen.getByText("Recibido")).toBeInTheDocument();
    expect(screen.getByText(/Factura F-1024/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Cambiar estado del reembolso" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Editar/ })).toBeInTheDocument();
  });

  it("panel de reembolso: en un caso de reembolso sin registros abre el formulario", async () => {
    h.tables = { reimbursements: [] };
    wrap(<CaseReimbursementPanel caseRow={baseCase} closed={false} onChanged={() => {}} />);
    expect(await screen.findByLabelText("Aseguradora")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar" })).toBeDisabled();
  });

  it("panel de reembolso: en otros tipos de caso solo muestra el acceso", async () => {
    h.tables = { reimbursements: [] };
    wrap(<CaseReimbursementPanel caseRow={{ ...baseCase, request_type: "hospital" }} closed={false} onChanged={() => {}} />);
    expect(await screen.findByRole("button", { name: /Registrar un reembolso/ })).toBeInTheDocument();
  });

  it("origen post-consulta: tipo de manejo, doctor y accesos a la cita y al formulario", async () => {
    h.tables = {
      post_consultation_case_links: [{
        form_id: "f1", outcome: "created", created_at: "2026-10-12T18:00:00Z",
        post_consultation_forms: {
          id: "f1", management_type: "urgente", appointment_id: "a1",
          appointments: { start_at: "2026-10-12T16:30:00Z", doctors: { full_name: "Dra. Laura Gómez" } },
        },
      }],
    };
    wrap(<CaseOriginCard caseRow={{ ...baseCase, request_type: "urgency" }} />);
    expect(await screen.findByText("Origen: post-consulta")).toBeInTheDocument();
    expect(screen.getByText("Urgente")).toBeInTheDocument();
    expect(screen.getByText("Dra. Laura Gómez")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ver cita/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ver formulario/ })).toBeInTheDocument();
  });

  it("nuevo caso: no deja crear sin paciente, tipo y resumen", () => {
    h.tables = {};
    wrap(<NewCaseDialog open onOpenChange={() => {}} onCreated={() => {}} />);
    expect(screen.getByText("Nuevo caso")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear caso" })).toBeDisabled();
  });
});
