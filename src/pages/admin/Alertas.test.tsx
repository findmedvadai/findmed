import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import type { ReactNode } from "react";
import Alertas from "./Alertas";
import { useCaseAlertListener } from "@/hooks/useCaseAlertListener";

// jsdom no trae ResizeObserver (lo usa el Switch de Radix).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Supabase falso: cada tabla responde sus filas; el canal de Realtime guarda el callback.
const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  realtime: null as null | ((payload: { new: Record<string, unknown> }) => void),
}));

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
  const channel = {
    on: (_event: string, _filter: unknown, cb: (payload: { new: Record<string, unknown> }) => void) => {
      h.realtime = cb;
      return channel;
    },
    subscribe: () => channel,
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      channel: () => channel,
      removeChannel: vi.fn(),
      functions: { invoke: vi.fn() },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    },
  };
});

function wrap(ui: ReactNode, path = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

const SETTINGS = {
  id: true,
  template_name: "alerta_caso_findmed",
  template_language: "es_MX",
  sla_urgent_minutes: 10,
  sla_high_minutes: 30,
  sla_normal_minutes: 120,
  max_escalations: 3,
  whatsapp_enabled: true,
  updated_at: "2026-10-14T15:00:00Z",
};

describe("Configuración → Alertas", () => {
  it("muestra números de guardia, tiempos, plantilla y las últimas alertas con su error", async () => {
    h.tables = {
      staff_alert_recipients: [
        { id: "r1", name: "Guardia noche", phone: "+525511111111", receives: "urgent_only", is_active: true, created_at: "2026-10-14T00:00:00Z" },
      ],
      staff_alert_settings: [SETTINGS],
      message_deliveries: [
        { id: "d1", status: "failed", to_phone: "+525511111111", created_at: "2026-10-14T15:10:00Z", error_message: 'La plantilla "alerta_caso_findmed" no existe en WHAAPY', case_id: "c1", staff_recipient_id: "r1" },
      ],
    };
    wrap(<Alertas />);
    expect((await screen.findAllByText("Guardia noche")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Solo urgentes").length).toBeGreaterThan(0);
    expect(await screen.findByDisplayValue("alerta_caso_findmed")).toBeInTheDocument();
    expect(screen.getByLabelText("Urgente (minutos)")).toHaveValue(10);
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    expect(await screen.findByText(/no existe en WHAAPY/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Probar sonido/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar prueba/ })).toBeInTheDocument();
  });

  it("sin números de guardia explica que el panel avisa igual", async () => {
    h.tables = { staff_alert_recipients: [], staff_alert_settings: [SETTINGS], message_deliveries: [] };
    wrap(<Alertas />);
    expect(await screen.findByText("Sin números de guardia")).toBeInTheDocument();
    expect(screen.getByText(/funcionan aunque no haya números/)).toBeInTheDocument();
  });
});

function Listener() {
  useCaseAlertListener();
  return null;
}

function Where() {
  const loc = useLocation();
  return <p>Ruta: {loc.pathname + loc.search}</p>;
}

describe("alertas de casos en el panel (Realtime)", () => {
  it("una notificación de caso muestra un aviso fijo con 'Ver caso' que abre ese caso", async () => {
    h.tables = { patient_cases: [{ priority: "urgent" }], notifications: [] };
    wrap(
      <>
        <Toaster />
        <Listener />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
      "/admin/inicio",
    );
    expect(h.realtime).toBeTruthy();
    // Una notificación de cita no dispara nada.
    act(() => h.realtime!({ new: { id: "n0", type: "appointment_scheduled", title: "Nueva cita", case_id: null } }));
    await act(async () => {
      h.realtime!({
        new: { id: "n1", type: "case_handoff", title: "Urgencia: paciente necesita atención", body: "Urgencia · prioridad urgente\nDolor de pecho", case_id: "case-9" },
      });
    });
    expect(await screen.findByText("Urgencia: paciente necesita atención")).toBeInTheDocument();
    expect(screen.queryByText("Nueva cita")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver caso" }));
    expect(await screen.findByText("Ruta: /admin/casos?caso=case-9")).toBeInTheDocument();
  });
});
