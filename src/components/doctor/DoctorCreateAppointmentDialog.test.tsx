import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import DoctorCreateAppointmentDialog from "./DoctorCreateAppointmentDialog";

// QA 2026-10-14: con la agenda filtrada por un consultorio, "Nueva cita" lo
// preseleccionaba y lo borraba al instante: mientras cargaba la lista de
// consultorios (vacía), el efecto creía que el consultorio ya no existía.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ doctorId: "d1" }) }));
vi.mock("@/integrations/supabase/client", () => {
  const offices = [
    { id: "o1", name: "Del Valle", display_color: "#00f", appointment_duration_minutes: 30 },
    { id: "o2", name: "Juriquilla", display_color: "#f00", appointment_duration_minutes: 45 },
  ];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "in", "limit"]) chain[m] = () => chain;
  // Respuesta lenta, como la red.
  chain.then = (ok: (v: unknown) => unknown) => new Promise((r) => setTimeout(r, 50)).then(() => ok({ data: offices, error: null }));
  return {
    supabase: {
      from: () => chain,
      functions: { invoke: vi.fn() },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    },
  };
});

// Radix (Checkbox/Select) mide con ResizeObserver, que jsdom no trae.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("DoctorCreateAppointmentDialog", () => {
  it("conserva el consultorio preseleccionado mientras cargan los consultorios", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DoctorCreateAppointmentDialog open onClose={() => {}} defaultOfficeId="o2" defaultDate="2026-10-20" defaultTime="10:00" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("combobox", { name: /Consultorio/i })).toHaveTextContent("Juriquilla");
  });
});
