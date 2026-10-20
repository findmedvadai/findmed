import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { PatientContactSection } from "./PatientContactSection";
import { appointmentPatientName, contactChanges, titularIfDifferent } from "@/lib/patient-name";

// Garantía 20-oct-2026: el admin corrige titular, teléfono y quién se atiende en la cita.
const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt" } } }) },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("appointmentPatientName", () => {
  it("muestra a quien se atiende y, en citas antiguas, al titular", () => {
    const titular = { full_name: "María López" };
    expect(appointmentPatientName({ patient_name: "Juanito López", patients: titular })).toBe("Juanito López");
    expect(appointmentPatientName({ patient_name: null, patients: titular })).toBe("María López");
    expect(appointmentPatientName({ patient_name: " ", patients: null }, "—")).toBe("—");
    expect(titularIfDifferent({ patient_name: "Juanito López", patients: titular })).toBe("María López");
    expect(titularIfDifferent({ patient_name: "maría lópez", patients: titular })).toBeNull();
  });
});

describe("contactChanges", () => {
  it("solo manda lo que cambió; vacío en la cita = el titular", () => {
    const initial = { fullName: "María López", phone: "+525512345678", attendedName: "Juanito" };
    expect(contactChanges("p1", initial, { fullName: "María López ", phone: "+525512345678", attendedName: "Juanito" }, "a1")).toBeNull();
    expect(contactChanges("p1", initial, { fullName: "María López", phone: "5511112222", attendedName: "" }, "a1")).toEqual({
      action: "contact",
      patient_id: "p1",
      phone: "5511112222",
      appointment_id: "a1",
      appointment_patient_name: null,
    });
    // Sin cita (detalle de caso) el nombre por cita nunca viaja.
    expect(contactChanges("p1", initial, { fullName: "María L. Ruiz", phone: "+525512345678", attendedName: "x" })).toEqual({
      action: "contact",
      patient_id: "p1",
      full_name: "María L. Ruiz",
    });
  });
});

describe("PatientContactSection", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  const renderSection = (onSaved = vi.fn()) =>
    wrap(
      <PatientContactSection
        patientId="p1"
        contact={{ fullName: "María López", phone: "+525512345678" }}
        appointment={{ id: "a1", patientName: "Juanito López" }}
        onSaved={onSaved}
      />,
    );

  it("muestra titular, teléfono y quién se atiende", () => {
    renderSection();
    expect(screen.getByText("María López")).toBeInTheDocument();
    expect(screen.getByText("+525512345678")).toBeInTheDocument();
    expect(screen.getByText("Juanito López")).toBeInTheDocument();
  });

  it("guarda con la Edge Function solo lo que cambió y refresca las vistas", async () => {
    invoke.mockResolvedValue({ data: { patient: { id: "p1", full_name: "María López", phone: "+525511112222" } }, error: null });
    const onSaved = vi.fn();
    renderSection(onSaved);
    fireEvent.click(screen.getByRole("button", { name: /Editar datos/ }));
    const save = screen.getByRole("button", { name: "Guardar" });
    expect(save).toBeDisabled(); // sin cambios
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "55 1111 2222" } });
    fireEvent.change(screen.getByLabelText("Nombre de quien se atiende en esta cita"), { target: { value: "Juan Pablo López" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("admin-update-patient-insurance", expect.objectContaining({
      body: {
        action: "contact",
        patient_id: "p1",
        phone: "55 1111 2222",
        appointment_id: "a1",
        appointment_patient_name: "Juan Pablo López",
      },
    }));
  });

  it("si el teléfono ya es de otro paciente muestra el mensaje del servidor y no cierra", async () => {
    const context = new Response(JSON.stringify({ error: "phone_taken", message: "Ese teléfono ya pertenece a otro paciente." }), { status: 409 });
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context }) });
    const onSaved = vi.fn();
    renderSection(onSaved);
    fireEvent.click(screen.getByRole("button", { name: /Editar datos/ }));
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "5511112222" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Ese teléfono ya pertenece a otro paciente."));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
  });

  it("no deja guardar un nombre de titular vacío", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Editar datos/ }));
    fireEvent.change(screen.getByLabelText("Nombre del titular"), { target: { value: " " } });
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(screen.getByText("Escribe el nombre completo del titular.")).toBeInTheDocument();
  });
});
