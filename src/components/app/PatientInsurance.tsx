// Seguro del paciente (aseguradora, póliza, "Sin seguro", "No capturado") y
// estado de sus documentos para una cita (Recibidos / Pendientes / No
// solicitados). Lo captura el agente de WhatsApp; el admin puede corregir el
// seguro desde el detalle de la cita (Edge Function admin-update-patient-insurance).
// Los documentos no se guardan en FindMed: se consultan en el módulo WhatsApp.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { FileCheck2, Loader2, Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SoftBadge } from "@/components/app/StatusBadge";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";
import { DOCUMENTS_STATUS, documentsStatus, insuranceChoice, type InsuranceChoice } from "@/lib/patient-documents";
import { cn } from "@/lib/utils";

export interface PatientInsuranceValue {
  hasInsurance: boolean | null | undefined;
  insurer: string | null | undefined;
  policyNumber: string | null | undefined;
}

/** Aseguradora y póliza; "Sin seguro" o "No capturado" cuando aplica. */
export function PatientInsurance({ hasInsurance, insurer, policyNumber, className }: PatientInsuranceValue & { className?: string }) {
  if (hasInsurance === false) return <SoftBadge tone="neutral" className={className}>Sin seguro</SoftBadge>;
  if (hasInsurance !== true) return <span className={cn("text-sm text-muted-foreground", className)}>No capturado</span>;
  return (
    <div className={cn("min-w-0", className)}>
      <p className="truncate text-sm text-foreground">{insurer || "Aseguradora no capturada"}</p>
      <p className="text-xs text-muted-foreground">{policyNumber ? `Póliza ${policyNumber}` : "Póliza no capturada"}</p>
    </div>
  );
}

/** Recibidos / Pendientes / No solicitados. `short` para tablas. */
export function DocumentsBadge({
  requestedAt,
  receivedAt,
  short = false,
  className,
}: {
  requestedAt: string | null | undefined;
  receivedAt: string | null | undefined;
  short?: boolean;
  className?: string;
}) {
  const s = DOCUMENTS_STATUS[documentsStatus({ documents_requested_at: requestedAt, documents_received_at: receivedAt })];
  return (
    <SoftBadge tone={s.tone} dot className={className}>
      <span title={s.hint}>{short ? `Docs: ${s.short.toLowerCase()}` : s.label}</span>
    </SoftBadge>
  );
}

async function updatePatientInsurance(body: {
  patient_id: string;
  has_insurance: boolean | null;
  insurer: string | null;
  policy_number: string | null;
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await supabase.functions.invoke("admin-update-patient-insurance", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.error) {
    const parsed = await extractEdgeFunctionError(res.error);
    throw new Error(parsed.message && !/non-2xx/i.test(parsed.message) ? parsed.message : "No se pudo guardar el seguro.");
  }
  return res.data as { patient: { id: string; has_insurance: boolean | null; insurer: string | null; policy_number: string | null } };
}

const CHOICE_LABEL: Record<InsuranceChoice, string> = {
  yes: "Con seguro",
  no: "Sin seguro",
  unknown: "No capturado",
};

function InsuranceEditor({
  patientId,
  initial,
  onDone,
  onCancel,
}: {
  patientId: string;
  initial: PatientInsuranceValue;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<InsuranceChoice>(insuranceChoice(initial.hasInsurance));
  const [insurer, setInsurer] = useState(initial.insurer ?? "");
  const [policy, setPolicy] = useState(initial.policyNumber ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      updatePatientInsurance({
        patient_id: patientId,
        has_insurance: choice === "yes" ? true : choice === "no" ? false : null,
        insurer: choice === "yes" ? insurer.trim() || null : null,
        policy_number: choice === "yes" ? policy.trim() || null : null,
      }),
    onSuccess: () => {
      toast.success("Seguro actualizado");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Seguro</Label>
          <Select value={choice} onValueChange={(v) => setChoice(v as InsuranceChoice)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(CHOICE_LABEL) as InsuranceChoice[]).map((k) => (
                <SelectItem key={k} value={k}>{CHOICE_LABEL[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`insurer-${patientId}`} className="text-xs">Aseguradora</Label>
          <Input
            id={`insurer-${patientId}`}
            value={insurer}
            maxLength={80}
            disabled={choice !== "yes"}
            onChange={(e) => setInsurer(e.target.value)}
            placeholder="p. ej. GNP"
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`policy-${patientId}`} className="text-xs">Número de póliza</Label>
          <Input
            id={`policy-${patientId}`}
            value={policy}
            maxLength={40}
            disabled={choice !== "yes"}
            onChange={(e) => setPolicy(e.target.value)}
            placeholder="Opcional"
            className="h-9 text-sm"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={mutation.isPending}>Cancelar</Button>
        <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending} className="gap-1.5">
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </div>
    </div>
  );
}

/**
 * Bloque "Seguro y documentos" para los detalles de cita. `editable` (solo
 * admin) muestra el botón para corregir el seguro; `onSaved` refresca la vista.
 * `whatsappLink` enlaza al módulo WhatsApp, donde se ven los documentos.
 */
export function InsuranceDocumentsSection({
  patientId,
  insurance,
  requestedAt,
  receivedAt,
  editable = false,
  whatsappLink = false,
  onSaved,
}: {
  patientId: string | null | undefined;
  insurance: PatientInsuranceValue;
  requestedAt: string | null | undefined;
  receivedAt: string | null | undefined;
  editable?: boolean;
  whatsappLink?: boolean;
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const docs = DOCUMENTS_STATUS[documentsStatus({ documents_requested_at: requestedAt, documents_received_at: receivedAt })];

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Seguro y documentos
        </h3>
        {editable && patientId && !editing && (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Editar seguro
          </Button>
        )}
      </div>

      {editing && patientId ? (
        <InsuranceEditor
          patientId={patientId}
          initial={insurance}
          onCancel={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            onSaved?.();
          }}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Seguro de gastos médicos</p>
            <PatientInsurance {...insurance} />
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileCheck2 className="h-3.5 w-3.5" /> Póliza e INE
            </p>
            <DocumentsBadge requestedAt={requestedAt} receivedAt={receivedAt} />
            <p className="text-xs text-muted-foreground">
              {docs.hint}
              {whatsappLink && documentsStatus({ documents_received_at: receivedAt }) === "received" && (
                <>
                  {" "}
                  <Link to="/admin/whatsapp" className="font-medium text-primary hover:underline">Verla en el módulo WhatsApp</Link>
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
