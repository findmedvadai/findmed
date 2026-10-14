import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useCaseDeepLink } from "./useCaseDeepLink";

// QA 2026-10-14: /admin/casos?caso=<id> con un id inexistente no hacía nada:
// ningún aviso y el parámetro se quedaba en la URL.
const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, toast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({ toast: h.toast }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: h.row, error: null }),
  };
  return { supabase: { from: () => chain } };
});

const ID = "5b0f3c1e-1111-4222-8333-944455556666";

function Probe({ onOpen }: { onOpen: (c: unknown) => void }) {
  useCaseDeepLink(onOpen);
  const loc = useLocation();
  return <p data-testid="url">{loc.pathname + loc.search}</p>;
}

function renderAt(path: string, onOpen = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Probe onOpen={onOpen} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onOpen;
}

describe("useCaseDeepLink", () => {
  beforeEach(() => {
    h.toast.mockReset();
    h.row = null;
  });

  it("abre el caso existente una vez y limpia la URL", async () => {
    h.row = { id: ID, contact_name: "Paciente" };
    const onOpen = renderAt(`/admin/casos?caso=${ID}`);
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("url").textContent).toBe("/admin/casos");
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("avisa y limpia la URL si el caso no existe", async () => {
    const onOpen = renderAt(`/admin/casos?caso=${ID}`);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "No encontramos ese caso" })));
    expect(screen.getByTestId("url").textContent).toBe("/admin/casos");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("un id mal formado no consulta y avisa", async () => {
    renderAt(`/admin/casos?caso=%3Cscript%3E`);
    await waitFor(() => expect(h.toast).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("url").textContent).toBe("/admin/casos");
  });
});
