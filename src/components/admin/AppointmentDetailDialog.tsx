import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { es } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Phone,
  Stethoscope,
  Tags,
  FileText,
  ClipboardList,
  CalendarClock,
  XCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppointmentStatusBadge, SoftBadge } from "@/components/app/StatusBadge";
import { InsuranceDocumentsSection } from "@/components/app/PatientInsurance";
import { formatMx } from "@/lib/timezone";
import { invalidateAdminAppointmentViews } from "@/lib/admin-appointment-queries";
import RescheduleAppointmentDialog from "./RescheduleAppointmentDialog";
import { PatientContactSection } from "./PatientContactSection";
import { appointmentPatientName } from "@/lib/patient-name";
import { userErrorMessage } from "@/lib/edge-function-error";

const CANCEL_REASON_LABELS: Record<string, string> = {
  patient: "Cancelada por el paciente",
  doctor: "Cancelada por el doctor",
  no_confirmation: "Sin confirmación",
  admin: "Cancelada por el equipo",
};

interface Props {
  appointmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * When true, surface the admin reschedule + cancel actions inside the dialog.
   * Defaults to false (legacy Inbox usage stays read-only).
   */
  enableActions?: boolean;
  /** Called after a successful reschedule or cancel so the parent can close itself. */
  onAfterAction?: () => void;
}

export default function AppointmentDetailDialog({
  appointmentId,
  open,
  onOpenChange,
  enableActions = false,
  onAfterAction,
}: Props) {
  const queryClient = useQueryClient();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-appointment-detail", appointmentId],
    queryFn: async () => {
      if (!appointmentId) return null;
      const { data, error } = await supabase
        .from("appointments")
        .select(
          `id, start_at, end_at, status, symptoms,
           doctor_notes, doctor_notes_updated_at,
           cancel_reason, booking_source, google_event_id, outlook_event_id,
           documents_requested_at, documents_received_at, patient_name,
           patients(id, full_name, phone, has_insurance, insurer, policy_number),
           doctors(id, full_name, doctor_specialties(specialties(name)))`
        )
        .eq("id", appointmentId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!appointmentId && open,
  });

  const patient = data?.patients as {
    id: string;
    full_name: string | null;
    phone: string | null;
    has_insurance: boolean | null;
    insurer: string | null;
    policy_number: string | null;
  } | null;
  const doctor = data?.doctors as { id: string; full_name: string | null; doctor_specialties: { specialties: { name: string } | null }[] } | null;
  const specialties = (doctor?.doctor_specialties ?? [])
    .map((ds) => ds.specialties?.name)
    .filter((x): x is string => Boolean(x));

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!appointmentId) throw new Error("Sin cita");
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/admin-cancel-appointment`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ appointment_id: appointmentId }),
      }).catch(() => {
        throw new Error("No se pudo cancelar la cita. Verifica tu conexión a internet y vuelve a intentar.");
      });
      // admin-cancel-appointment responde { error: "<mensaje en español>" }.
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(body.message || body.error || "No se pudo cancelar la cita.");
    },
    onSuccess: () => {
      toast.success("Cita cancelada");
      // Calendario, lista de la Agenda, eventos externos y este detalle.
      invalidateAdminAppointmentViews(queryClient);
      onAfterAction?.();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(userErrorMessage(err, "No se pudo completar la acción.")),
    onSettled: () => setCancelling(false),
  });

  const isCancelled = data?.status === "cancelled";
  // Una cita atendida o cancelada ya no se cancela ni se reagenda (el backend responde 409).
  const isFinal = isCancelled || data?.status === "completed";
  const showActions = enableActions && data && !isFinal;
  const start = data?.start_at ? new Date(data.start_at) : null;
  const end = data?.end_at ? new Date(data.end_at) : null;

  return (
    <>
      <Dialog open={open && !rescheduleOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {isLoading ? (
            <>
              <DialogHeader className="space-y-2 pr-6">
                <DialogTitle className="sr-only">Detalle de cita</DialogTitle>
                <DialogDescription className="sr-only">Cargando la información de la cita.</DialogDescription>
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
              </DialogHeader>
              <Skeleton className="h-20 w-full rounded-lg" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            </>
          ) : data ? (
            <>
              <DialogHeader className="space-y-2 pr-6">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="text-base">{appointmentPatientName(data, "Detalle de cita")}</DialogTitle>
                  <AppointmentStatusBadge status={data.status} />
                  {data.cancel_reason && (
                    <SoftBadge tone="neutral">
                      {CANCEL_REASON_LABELS[data.cancel_reason] ?? data.cancel_reason}
                    </SoftBadge>
                  )}
                </div>
                <DialogDescription className="first-letter:uppercase">
                  {start && formatMx(start, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })}
                  {start && end && ` · ${formatMx(start, "HH:mm")} – ${formatMx(end, "HH:mm")}`}
                </DialogDescription>
              </DialogHeader>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
                <DetailField icon={Stethoscope} label="Doctor">{doctor?.full_name ?? "—"}</DetailField>
                <DetailField icon={Tags} label="Especialidad">
                  {specialties.length > 0 ? specialties.join(", ") : "—"}
                </DetailField>
              </dl>

              <PatientContactSection
                patientId={patient?.id}
                contact={{ fullName: patient?.full_name, phone: patient?.phone }}
                appointment={{ id: data.id, patientName: data.patient_name }}
                onSaved={() => invalidateAdminAppointmentViews(queryClient)}
              />

              <InsuranceDocumentsSection
                patientId={patient?.id}
                insurance={{
                  hasInsurance: patient?.has_insurance,
                  insurer: patient?.insurer,
                  policyNumber: patient?.policy_number,
                }}
                requestedAt={data.documents_requested_at}
                receivedAt={data.documents_received_at}
                editable
                whatsappLink
                onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin-appointment-detail", appointmentId] })}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <section className="space-y-1.5">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <ClipboardList className="h-4 w-4 text-muted-foreground" /> Síntomas iniciales
                  </h3>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {data.symptoms || "Sin síntomas registrados."}
                  </p>
                </section>
                <section className="space-y-1.5">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <FileText className="h-4 w-4 text-muted-foreground" /> Notas médicas
                  </h3>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {data.doctor_notes || "Sin notas."}
                  </p>
                  {data.doctor_notes_updated_at && (
                    <p className="text-xs text-muted-foreground">
                      Actualizado el{" "}
                      {formatMx(new Date(data.doctor_notes_updated_at), "d MMM yyyy · HH:mm", { locale: es })}
                    </p>
                  )}
                </section>
              </div>

              {enableActions && isFinal && (
                <p className="border-t pt-4 text-xs text-muted-foreground">
                  {isCancelled
                    ? "Esta cita está cancelada: ya no se puede reagendar ni volver a cancelar."
                    : "Esta cita ya se atendió: ya no se puede reagendar ni cancelar."}
                </p>
              )}
              {showActions && (
                <DialogFooter className="gap-2 border-t pt-4 sm:justify-between sm:space-x-0">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={cancelling}
                      >
                        {cancelling ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <XCircle className="h-4 w-4" />
                        )}
                        Cancelar cita
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Cancelar esta cita?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Se notificará al paciente y al doctor por WhatsApp. Si la cita
                          tiene evento en Google u Outlook, intentaremos eliminarlo.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Volver</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => {
                            setCancelling(true);
                            cancelMutation.mutate();
                          }}
                        >
                          Sí, cancelar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRescheduleOpen(true)}>
                    <CalendarClock className="h-4 w-4" />
                    Reagendar
                  </Button>
                </DialogFooter>
              )}
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Detalle de cita</DialogTitle>
                <DialogDescription>No se encontró la cita. Puede que se haya eliminado.</DialogDescription>
              </DialogHeader>
            </>
          )}
        </DialogContent>
      </Dialog>

      {data && enableActions && (
        <RescheduleAppointmentDialog
          open={rescheduleOpen}
          onClose={() => setRescheduleOpen(false)}
          appointment={{
            id: data.id,
            start_at: data.start_at,
            end_at: data.end_at,
            patient_name: appointmentPatientName(data),
          }}
          onRescheduled={() => {
            onAfterAction?.();
            onOpenChange(false);
          }}
        />
      )}
    </>
  );
}

function DetailField({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Phone;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}
