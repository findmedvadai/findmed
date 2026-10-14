import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PorCompletar from "./PorCompletar";

// Supabase falso: cada tabla responde sus filas; los insert se registran.
const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  inserts: [] as { table: string; values: unknown }[],
  invoke: vi.fn(),
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
        if (prop === "insert") {
          return (values: unknown) => {
            h.inserts.push({ table, values });
            return proxy;
          };
        }
        return () => proxy;
      },
    });
    return proxy;
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      functions: { invoke: (...args: unknown[]) => h.invoke(...args) },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ doctorId: "doc-1" }) }));

const appt = (id: string, name: string, forms: { id: string }[] = []) => ({
  id,
  start_at: "2026-10-12T16:30:00Z",
  end_at: "2026-10-12T17:00:00Z",
  status: "confirmed",
  symptoms: "Dolor abdominal",
  doctor_notes: null,
  patients: { full_name: name, phone: "+525512345678" },
  post_consultation_forms: forms,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PorCompletar />
    </QueryClientProvider>,
  );
}

const optionFor = (label: string) => screen.getByRole("radio", { name: new RegExp(label) });
const cardOf = (label: string) => optionFor(label).closest("label") as HTMLElement;

describe("Por completar — tipo de manejo", () => {
  it("pide el tipo de manejo, sugiere según lo capturado y envía lo que el médico confirma", async () => {
    h.tables = {
      appointments: [appt("a1", "Ana Pérez"), appt("a2", "Luis Ya Enviado", [{ id: "f-old" }])],
      doctors: [{ full_name: "Dra. Laura Gómez" }],
    };
    h.inserts = [];
    h.invoke.mockReset().mockResolvedValue({ data: {}, error: null });
    renderPage();

    expect((await screen.findAllByText("Ana Pérez")).length).toBeGreaterThan(0);
    // Una consulta que ya tiene formulario no se vuelve a pedir (aunque no tenga notas).
    expect(screen.queryByText("Luis Ya Enviado")).not.toBeInTheDocument();

    const send = screen.getByRole("button", { name: /Enviar formulario/ });
    expect(send).toBeDisabled();
    expect(screen.getByText("Elige el tipo de manejo para poder enviar el formulario.")).toBeInTheDocument();

    // Sin nada capturado se sugiere conservador; al activar hospitalización, procedimiento.
    expect(within(cardOf("Conservador")).getByText("Sugerido")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Se envió a hospitalización" }));
    expect(within(cardOf("Requiere procedimiento")).getByText("Sugerido")).toBeInTheDocument();
    expect(within(cardOf("Conservador")).queryByText("Sugerido")).not.toBeInTheDocument();

    // El médico decide otra cosa: urgente.
    fireEvent.click(optionFor("Urgente"));
    expect(send).toBeEnabled();
    fireEvent.click(send);

    await waitFor(() => expect(h.invoke).toHaveBeenCalled());
    const form = h.inserts.find((i) => i.table === "post_consultation_forms")!.values as Record<string, unknown>;
    expect(form.management_type).toBe("urgente");
    expect(form.hospitalization).toBe("Sí, sin detalle."); // interruptor encendido sin detalle no se pierde
    expect(form.lab_tests).toBeNull();
    // El nombre ya trae el título: nada de "Dr. Dra. …".
    const notification = h.inserts.find((i) => i.table === "notifications")!.values as { body: string };
    expect(notification.body).toBe("Dra. Laura Gómez envió formulario post-consulta para Ana Pérez (12 oct 2026)");
    const [fn, opts] = h.invoke.mock.calls[0] as [string, { body: { event_type: string; payload: Record<string, unknown> } }];
    expect(fn).toBe("dispatch-webhook");
    expect(opts.body.event_type).toBe("postconsultation.submitted");
    expect(opts.body.payload.management_type).toBe("urgente");
  });
});
