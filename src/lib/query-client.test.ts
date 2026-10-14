import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: h.error, dismiss: h.dismiss } }));

import { createQueryClient } from "./query-client";

// QA 2026-10-14: con la consulta principal fallando, Agenda, Doctores,
// Automatización, Catálogos y las vistas del doctor se veían vacías sin aviso.
describe("createQueryClient", () => {
  beforeEach(() => {
    h.error.mockReset();
    h.dismiss.mockReset();
  });

  it("avisa en español cuando una lectura falla sin datos previos", async () => {
    const qc = createQueryClient();
    await qc
      .fetchQuery({ queryKey: ["x"], retry: false, queryFn: () => Promise.reject(new Error("TypeError: Failed to fetch")) })
      .catch(() => {});
    expect(h.error).toHaveBeenCalledWith("No se pudo cargar la información", expect.objectContaining({ id: "query-load-error" }));
  });

  it("no avisa si la pantalla ya tiene datos (refresco en segundo plano)", async () => {
    const qc = createQueryClient();
    qc.setQueryData(["y"], [1, 2]);
    await qc
      .fetchQuery({ queryKey: ["y"], retry: false, staleTime: 0, queryFn: () => Promise.reject(new Error("x")) })
      .catch(() => {});
    expect(h.error).not.toHaveBeenCalled();
  });

  it("respeta meta.silentError", async () => {
    const qc = createQueryClient();
    await qc
      .fetchQuery({ queryKey: ["z"], retry: false, meta: { silentError: true }, queryFn: () => Promise.reject(new Error("x")) })
      .catch(() => {});
    expect(h.error).not.toHaveBeenCalled();
  });

  it("quita el aviso cuando la lectura que fallaba se recupera", async () => {
    const qc = createQueryClient();
    let fail = true;
    const queryFn = () => (fail ? Promise.reject(new Error("x")) : Promise.resolve([1]));
    await qc.fetchQuery({ queryKey: ["w"], retry: false, queryFn }).catch(() => {});
    expect(h.error).toHaveBeenCalledTimes(1);
    fail = false;
    await qc.fetchQuery({ queryKey: ["w"], retry: false, staleTime: 0, queryFn });
    expect(h.dismiss).toHaveBeenCalledWith("query-load-error");
  });
});
