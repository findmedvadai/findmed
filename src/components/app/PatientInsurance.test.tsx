import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocumentsBadge, InsuranceDocumentsSection, PatientInsurance } from "./PatientInsurance";
import { documentsStatus } from "@/lib/patient-documents";

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
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("documentsStatus", () => {
  it("recibidos gana; pedidos sin recibir = pendientes; sin solicitud = no solicitados", () => {
    expect(documentsStatus({ documents_requested_at: "2026-10-14T10:00:00Z", documents_received_at: "2026-10-14T11:00:00Z" })).toBe("received");
    expect(documentsStatus({ documents_requested_at: "2026-10-14T10:00:00Z", documents_received_at: null })).toBe("pending");
    expect(documentsStatus({})).toBe("not_requested");
  });
});

describe("PatientInsurance", () => {
  it("muestra aseguradora y póliza, 'Sin seguro' y 'No capturado'", () => {
    const { rerender } = render(<PatientInsurance hasInsurance insurer="GNP" policyNumber="P-123" />);
    expect(screen.getByText("GNP")).toBeInTheDocument();
    expect(screen.getByText("Póliza P-123")).toBeInTheDocument();
    rerender(<PatientInsurance hasInsurance insurer="AXA" policyNumber={null} />);
    expect(screen.getByText("Póliza no capturada")).toBeInTheDocument();
    rerender(<PatientInsurance hasInsurance={false} insurer={null} policyNumber={null} />);
    expect(screen.getByText("Sin seguro")).toBeInTheDocument();
    rerender(<PatientInsurance hasInsurance={null} insurer={null} policyNumber={null} />);
    expect(screen.getByText("No capturado")).toBeInTheDocument();
  });

  it("badge de documentos: recibidos / pendientes / no solicitados", () => {
    const { rerender } = render(<DocumentsBadge requestedAt="x" receivedAt="y" />);
    expect(screen.getByText("Documentos recibidos")).toBeInTheDocument();
    rerender(<DocumentsBadge requestedAt="x" receivedAt={null} />);
    expect(screen.getByText("Documentos pendientes")).toBeInTheDocument();
    rerender(<DocumentsBadge requestedAt={null} receivedAt={null} short />);
    expect(screen.getByText("Docs: no solicitados")).toBeInTheDocument();
  });
});

describe("InsuranceDocumentsSection", () => {
  beforeEach(() => invoke.mockReset());

  it("el doctor (sin editable) no ve el botón de editar", () => {
    wrap(
      <InsuranceDocumentsSection
        patientId="p1"
        insurance={{ hasInsurance: true, insurer: "GNP", policyNumber: "P1" }}
        requestedAt="x"
        receivedAt="y"
      />,
    );
    expect(screen.queryByRole("button", { name: /Editar seguro/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Verla en el módulo WhatsApp")).not.toBeInTheDocument();
  });

  it("el admin corrige el seguro con la Edge Function y avisa al terminar", async () => {
    invoke.mockResolvedValue({ data: { patient: { id: "p1", has_insurance: true, insurer: "AXA", policy_number: "Z9" } }, error: null });
    const onSaved = vi.fn();
    wrap(
      <InsuranceDocumentsSection
        patientId="p1"
        insurance={{ hasInsurance: true, insurer: "GNP", policyNumber: "P1" }}
        requestedAt="x"
        receivedAt="y"
        editable
        whatsappLink
        onSaved={onSaved}
      />,
    );
    expect(screen.getByText("Verla en el módulo WhatsApp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Editar seguro/ }));
    fireEvent.change(screen.getByLabelText("Aseguradora"), { target: { value: "AXA" } });
    fireEvent.change(screen.getByLabelText("Número de póliza"), { target: { value: "Z9" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("admin-update-patient-insurance", expect.objectContaining({
      body: { patient_id: "p1", has_insurance: true, insurer: "AXA", policy_number: "Z9" },
    }));
  });
});
