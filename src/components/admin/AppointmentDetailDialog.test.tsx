import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AppointmentDetailDialog from "./AppointmentDetailDialog";

// QA 2026-10-14: el detalle de la cita ofrecía "Cancelar cita" y "Reagendar" en
// citas ya atendidas (el backend responde 409 a ambas).
const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));

vi.mock("@/integrations/supabase/client", () => {
  const proxy: unknown = new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko);
      if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve({ data: h.row, error: null });
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

const base = {
  id: "a1",
  start_at: "2026-10-10T16:00:00Z",
  end_at: "2026-10-10T16:30:00Z",
  symptoms: "Dolor de rodilla",
  doctor_notes: null,
  doctor_notes_updated_at: null,
  cancel_reason: null,
  booking_source: "patient_self",
  google_event_id: null,
  outlook_event_id: null,
  documents_requested_at: null,
  documents_received_at: null,
  patients: { id: "p1", full_name: "Paciente Demo", phone: "+525500000001", has_insurance: null, insurer: null, policy_number: null },
  doctors: { id: "d1", full_name: "Dra. Demo", doctor_specialties: [] },
};

function renderWith(status: string) {
  h.row = { ...base, status };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppointmentDetailDialog appointmentId="a1" open onOpenChange={() => {}} enableActions />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AppointmentDetailDialog (admin)", () => {
  it("ofrece cancelar y reagendar en una cita confirmada", async () => {
    renderWith("confirmed");
    expect(await screen.findByRole("button", { name: /Cancelar cita/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reagendar/ })).toBeInTheDocument();
  });

  it("no ofrece cancelar ni reagendar una cita atendida y explica por qué", async () => {
    renderWith("completed");
    expect(await screen.findByText(/ya se atendió/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelar cita/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reagendar/ })).not.toBeInTheDocument();
  });

  it("tampoco en una cita cancelada", async () => {
    renderWith("cancelled");
    expect(await screen.findByText(/está cancelada/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reagendar/ })).not.toBeInTheDocument();
  });
});
