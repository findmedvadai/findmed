import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PasswordGate from "./PasswordGate";
import { saveSettingsUnlock } from "@/lib/settings-unlock";

const signInWithPassword = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithPassword: (...args: unknown[]) => signInWithPassword(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1", email: "admin@findmed.test" } }),
}));

function renderGate() {
  return render(
    <PasswordGate>
      <p>Contenido protegido</p>
    </PasswordGate>,
  );
}

function submit(password: string) {
  fireEvent.change(screen.getByLabelText("Tu contraseña"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
}

describe("PasswordGate", () => {
  beforeEach(() => signInWithPassword.mockReset());
  afterEach(() => sessionStorage.clear());

  it("pide la contraseña de la propia cuenta", () => {
    renderGate();
    expect(screen.getByText("Confirma tu contraseña para entrar a esta sección.")).toBeInTheDocument();
    expect(screen.getByText("admin@findmed.test")).toBeInTheDocument();
    expect(screen.queryByText("Contenido protegido")).not.toBeInTheDocument();
  });

  it("con la contraseña correcta re-autentica la cuenta conectada y desbloquea", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    renderGate();
    submit("la-de-mi-cuenta");
    expect(await screen.findByText("Contenido protegido")).toBeInTheDocument();
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "admin@findmed.test", password: "la-de-mi-cuenta" });
  });

  it("con la contraseña incorrecta no desbloquea y lo dice", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
    });
    renderGate();
    submit("otra");
    expect(await screen.findByText("Contraseña incorrecta.")).toBeInTheDocument();
    expect(screen.queryByText("Contenido protegido")).not.toBeInTheDocument();
  });

  it("no hay contraseña compartida: todo intento lo decide Supabase Auth", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 429, code: "over_request_rate_limit", message: "rate limit" },
    });
    renderGate();
    submit("cualquier-clave-compartida");
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Demasiados intentos/)).toBeInTheDocument();
    expect(screen.queryByText("Contenido protegido")).not.toBeInTheDocument();
  });

  it("si ya se desbloqueó en los últimos 30 minutos entra directo", () => {
    saveSettingsUnlock("admin-1");
    renderGate();
    expect(screen.getByText("Contenido protegido")).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
