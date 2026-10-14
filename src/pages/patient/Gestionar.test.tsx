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

function renderWith(status: string) {
  // manage-validate responde la cita; el resto de llamadas no se usan aquí.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve(appointment(status)) }));
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
});
