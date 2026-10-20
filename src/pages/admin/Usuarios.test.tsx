import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Usuarios from "./Usuarios";
import { LOGIN_URL } from "@/lib/admin-users";

// La página solo habla con la Edge Function admin-users: se simula `functions.invoke`.
const h = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: h.invoke },
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt" } } }) },
  },
}));

const LIST = {
  users: [
    { id: "u1", email: "admin@findmed.com.mx", role: "admin", created_at: null, last_sign_in_at: "2026-10-19T23:30:00Z", status: "active", is_self: true },
    { id: "u2", email: "recepcion@findmed.com.mx", role: "admin", created_at: null, last_sign_in_at: null, status: "disabled", is_self: false },
  ],
  viewer: { id: "u1", is_superadmin: false },
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Usuarios />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const actions = () => h.invoke.mock.calls.map((c) => (c[1] as { body: { action: string } }).body.action);

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockImplementation((_fn: string, { body }: { body: Record<string, unknown> }) => {
    if (body.action === "list") return Promise.resolve({ data: LIST, error: null });
    if (body.action === "create") return Promise.resolve({ data: { user: { id: "u3", email: body.email, role: "admin" } }, error: null });
    return Promise.resolve({ data: { success: true }, error: null });
  });
});

describe("Configuración → Usuarios", () => {
  it("lista las cuentas del equipo con rol, último acceso en hora CDMX, estado y 'Tú'", async () => {
    wrap();
    expect(await screen.findByText("admin@findmed.com.mx")).toBeInTheDocument();
    expect(screen.getByText("recepcion@findmed.com.mx")).toBeInTheDocument();
    expect(screen.getByText("Tú")).toBeInTheDocument();
    expect(screen.getAllByText("Administrador")).toHaveLength(2);
    expect(screen.getByText("19 oct 2026, 17:30")).toBeInTheDocument(); // 23:30 UTC = 17:30 CDMX
    expect(screen.getByText("Nunca")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText("Desactivado")).toBeInTheDocument();
    expect(h.invoke).toHaveBeenCalledWith("admin-users", expect.objectContaining({ body: { action: "list" } }));
  });

  it("la fila propia no ofrece desactivar el acceso", async () => {
    wrap();
    fireEvent.keyDown(await screen.findByRole("button", { name: "Acciones para admin@findmed.com.mx" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Cambiar contraseña")).toBeInTheDocument();
    expect(within(menu).queryByText(/Desactivar acceso|Reactivar acceso/)).toBeNull();
  });

  it("reactivar el acceso de otra cuenta pide confirmación y llama a set_active", async () => {
    wrap();
    fireEvent.keyDown(await screen.findByRole("button", { name: "Acciones para recepcion@findmed.com.mx" }), { key: "Enter" });
    fireEvent.click(within(await screen.findByRole("menu")).getByText("Reactivar acceso"));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("¿Reactivar el acceso?")).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Reactivar acceso" }));
    await waitFor(() => expect(actions()).toContain("set_active"));
    const call = h.invoke.mock.calls.find((c) => (c[1] as { body: { action: string } }).body.action === "set_active")!;
    expect((call[1] as { body: unknown }).body).toEqual({ action: "set_active", user_id: "u2", active: true });
  });

  it("nuevo usuario: valida la contraseña, genera una segura y al crear muestra los datos para compartir", async () => {
    wrap();
    await screen.findByText("admin@findmed.com.mx");
    fireEvent.click(screen.getByRole("button", { name: /Nuevo usuario/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Correo"), { target: { value: "Caja@FindMed.com.mx" } });
    fireEvent.change(within(dialog).getByLabelText("Contraseña"), { target: { value: "corta" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear usuario" }));
    expect(await within(dialog).findByText(/al menos 8 caracteres/)).toHaveClass("text-destructive");
    expect(actions()).not.toContain("create");

    fireEvent.click(within(dialog).getByRole("button", { name: /Generar/ }));
    const password = (within(dialog).getByLabelText("Contraseña") as HTMLInputElement).value;
    expect(password).toMatch(/^(?=.*[A-Za-z])(?=.*\d).{14}$/);
    expect(within(dialog).getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    expect((within(dialog).getByLabelText("Confirmar contraseña") as HTMLInputElement).value).toBe(password);

    fireEvent.click(within(dialog).getByRole("button", { name: "Crear usuario" }));
    await waitFor(() => expect(actions()).toContain("create"));
    const createCall = h.invoke.mock.calls.find((c) => (c[1] as { body: { action: string } }).body.action === "create")!;
    expect((createCall[1] as { body: unknown }).body).toEqual({ action: "create", email: "caja@findmed.com.mx", password, role: "admin" });

    expect(await screen.findByText("Comparte estos datos de acceso con la persona por un canal privado.")).toBeInTheDocument();
    expect(screen.getByText(password)).toBeInTheDocument();
    expect(screen.getByText(LOGIN_URL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copiar datos/ })).toBeInTheDocument();
  });

  it("si la lista no carga, lo dice y ofrece reintentar", async () => {
    h.invoke.mockImplementation(() => Promise.resolve({ data: null, error: new Error("boom") }));
    wrap();
    expect(await screen.findByText("No se pudo cargar los usuarios del equipo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });
});
