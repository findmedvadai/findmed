import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UnifiedAvailabilityEditor from "./UnifiedAvailabilityEditor";

// QA 2026-10-14: si la lectura de horarios fallaba, el editor se mostraba
// vacío ("sin bloques") y guardar desde ahí agregaba bloques encima de los
// existentes. Ahora muestra el error con "Reintentar".
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown) =>
      Promise.resolve(
        table === "doctor_weekly_availability"
          ? { data: null, error: { message: "QA: fallo simulado", code: "500" } }
          : { data: [{ id: "o1", name: "Del Valle", display_color: "#00f", is_active: true }], error: null },
      ).then(ok);
    return c;
  };
  return { supabase: { from: (t: string) => chain(t) } };
});

describe("UnifiedAvailabilityEditor", () => {
  it("no muestra un editor vacío cuando falla la lectura de horarios", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <UnifiedAvailabilityEditor doctorId="d1" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("No se pudo cargar tu horario de atención")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Guardar disponibilidad/ })).not.toBeInTheDocument();
  });
});
