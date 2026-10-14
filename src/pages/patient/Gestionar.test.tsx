import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Gestionar from "./Gestionar";

const appointment = (status: string) => ({
  appointment_id: "a1",
  doctor_id: "d1",
  office_id: "o1",
  office_name: "Consultorio Centro",
  office_address: "Av. Reforma 1",
  doctor_name: "Dra. Laura Gómez",
  doctor_address: null,
  patient_name: "Ana Pérez",
  start_at: "2099-10-14T16:00:00Z",
  end_at: "2099-10-14T16:30:00Z",
  status,
});

function renderWith(status: string, overrides: Record<string, unknown> = {}) {
  // manage-validate responde la cita; el resto de llamadas no se usan aquí.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ...appointment(status), ...overrides }) }));
  return render(
    <MemoryRouter initialEntries={["/gestionar?token=tok"]}>
      <Gestionar />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Gestionar — estado de la cita", () => {
  it("una cita reservada se muestra 'Por confirmar' en tono de advertencia, no en verde", async () => {
    renderWith("scheduled");
    const label = await screen.findByText("Por confirmar");
    expect(label).toHaveClass("text-warning");
    expect(label).not.toHaveClass("text-confirmed");
  });

  it("solo la confirmada va en verde", async () => {
    renderWith("confirmed");
    expect(await screen.findByText("Confirmada")).toHaveClass("text-confirmed");
  });

  it("el calendario para reagendar tiene los botones de navegación en español", async () => {
    renderWith("confirmed");
    fireEvent.click(await screen.findByRole("button", { name: /Reagendar cita/ }));
    expect(screen.getByRole("button", { name: "Ir al mes anterior" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ir al mes siguiente" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Go to/i })).not.toBeInTheDocument();
  });

  // QA 2026-10-14: una consulta ya atendida (o una cita pasada) seguía
  // ofreciendo "Cancelar cita"; manage-cancel responde 409.
  it("una consulta completada no ofrece cancelar ni reagendar", async () => {
    renderWith("completed");
    expect(await screen.findByText("Esta consulta ya se realizó.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelar cita/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reagendar cita/ })).not.toBeInTheDocument();
  });

  it("una cita confirmada que ya pasó no ofrece cancelar", async () => {
    renderWith("confirmed", { start_at: "2020-01-01T16:00:00Z", end_at: "2020-01-01T16:30:00Z" });
    expect(await screen.findByText(/ya pasó/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelar cita/ })).not.toBeInTheDocument();
  });
});

describe("Gestionar — enlace con error", () => {
  it("un 503 de la plataforma sin campo error muestra un aviso, no una cita vacía", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ code: "BOOT_ERROR", message: "Function failed to start" }) }));
    render(
      <MemoryRouter initialEntries={["/gestionar?token=tok"]}>
        <Gestionar />
      </MemoryRouter>,
    );
    expect(await screen.findByText("No pudimos abrir tu cita")).toBeInTheDocument();
    expect(screen.queryByText("Tu cita")).not.toBeInTheDocument();
  });

  it("un token inválido se explica sin jerga", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "Token inválido" }) }));
    render(
      <MemoryRouter initialEntries={["/gestionar?token=tok"]}>
        <Gestionar />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Este enlace no es válido/)).toBeInTheDocument();
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
  });
});
