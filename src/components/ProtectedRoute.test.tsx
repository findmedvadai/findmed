import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// QA 2026-10-14: con sesión pero con el rol aún sin leer, ProtectedRoute pintaba
// el panel pedido; un doctor que abría /admin/* veía el panel del admin unos
// instantes (y disparaba sus consultas) antes de ser redirigido.
const auth = vi.hoisted(() => ({ value: { session: null as unknown, role: null as string | null, loading: false } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.value }));

import ProtectedRoute, { ROLE_TIMEOUT_MS } from "./ProtectedRoute";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>Pantalla de login</p>} />
        <Route path="/doctor/inicio" element={<p>Inicio del doctor</p>} />
        <Route
          path="/admin/inicio"
          element={
            <ProtectedRoute allowedRoles={["admin", "superadmin"]}>
              <p>Panel admin</p>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("no pinta el panel mientras el rol no se conoce", () => {
    auth.value = { session: { user: { id: "u1" } }, role: null, loading: false };
    renderAt("/admin/inicio");
    expect(screen.queryByText("Panel admin")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("redirige al doctor a su inicio sin mostrar el panel del admin", () => {
    auth.value = { session: { user: { id: "u1" } }, role: "doctor", loading: false };
    renderAt("/admin/inicio");
    expect(screen.queryByText("Panel admin")).not.toBeInTheDocument();
    expect(screen.getByText("Inicio del doctor")).toBeInTheDocument();
  });

  it("muestra el panel al admin", () => {
    auth.value = { session: { user: { id: "u1" } }, role: "admin", loading: false };
    renderAt("/admin/inicio");
    expect(screen.getByText("Panel admin")).toBeInTheDocument();
  });

  it("sin sesión manda al login", () => {
    auth.value = { session: null, role: null, loading: false };
    renderAt("/admin/inicio");
    expect(screen.getByText("Pantalla de login")).toBeInTheDocument();
  });

  it("si el rol nunca llega, avisa en español en vez de mostrar un panel", () => {
    auth.value = { session: { user: { id: "u1" } }, role: null, loading: false };
    renderAt("/admin/inicio");
    act(() => {
      vi.advanceTimersByTime(ROLE_TIMEOUT_MS + 10);
    });
    expect(screen.getByText("No pudimos cargar tu perfil")).toBeInTheDocument();
    expect(screen.queryByText("Panel admin")).not.toBeInTheDocument();
  });
});
