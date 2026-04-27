import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { es } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  User,
  Phone,
  Stethoscope,
  Calendar,
  Clock,
  FileText,
  ClipboardList,
  CalendarClock,
  XCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatMx } from "@/lib/timezone";
import RescheduleAppointmentDialog from "./RescheduleAppointmentDialog";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Programada", className: "bg-blue-100 text-blue-800" },
  confirmed: { label: "Confirmada", className: "bg-green-100 text-green-800" },
  cancelled: { label: "Cancelada", className: "bg-red-100 text-red-800" },
  completed: { label: "Completada", className: "bg-primary/10 text-primary" },
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
           patients(id, full_name, phone),
           doctors(id, full_name, doctor_specialties(specialties(name)))`
        )
        .eq("id", appointmentId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!appointmentId && open,
  });

  const patient = data?.patients as { id: string; full_name: string | null; phone: string | null } | null;
  const doctor = data?.doctors as { id: string; full_name: string | null; doctor_specialties: { specialties: { name: string } | null }[] } | null;
  const specialties = (doctor?.doctor_specialties ?? [])
    .map((ds) => ds.specialties?.name)
    .filter((x): x is string => Boolean(x));
  const status = STATUS_MAP[data?.status ?? ""] ?? STATUS_MAP.scheduled;

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
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Error al cancelar");
    },
    onSuccess: () => {
      toast.success("Cita cancelada");
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-appointment-detail", appointmentId] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-google-events"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-outlook-events"] });
      onAfterAction?.();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setCancelling(false),
  });

  const isCancelled = data?.status === "cancelled";
  const showActions = enableActions && data && !isCancelled;

  return (
    <>
      <Dialog open={open && !rescheduleOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Detalle de cita
              <Badge variant="outline" className="text-xs">Plataforma</Badge>
            </DialogTitle>
            <DialogDescription>Información de la cita seleccionada</DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : data ? (
            <div className="space-y-4 text-sm">
              <div className="flex justify-end gap-2">
                <Badge className={status.className}>{status.label}</Badge>
                {data.cancel_reason && (
                  <Badge variant="outline" className="text-xs capitalize">
                    Motivo: {data.cancel_reason}
                  </Badge>
                )}
              </div>

              <Section icon={User} label="Paciente">
                <p className="font-medium">{patient?.full_name ?? "—"}</p>
                {patient?.phone && (
                  <p className="flex items-center gap-1 text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {patient.phone}
                  </p>
                )}
              </Section>

              <Section icon={Stethoscope} label="Doctor">
                <p className="font-medium">{doctor?.full_name ?? "—"}</p>
                {specialties.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {specialties.map((s) => (
                      <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                )}
              </Section>

              <Section icon={Calendar} label="Fecha y horario">
                <p>
                  {data.start_at &&
                    formatMx(new Date(data.start_at), "EEEE d 'de' MMMM yyyy", { locale: es })}
                </p>
                <p className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {data.start_at && formatMx(new Date(data.start_at), "HH:mm")}
                  {" – "}
                  {data.end_at && formatMx(new Date(data.end_at), "HH:mm")}
                </p>
              </Section>

              <Section icon={ClipboardList} label="Síntomas iniciales">
                <p className="whitespace-pre-line text-muted-foreground">
                  {data.symptoms || "Sin síntomas registrados"}
                </p>
              </Section>

              <Section icon={FileText} label="Notas médicas">
                <p className="whitespace-pre-line text-muted-foreground">
                  {data.doctor_notes || "Sin notas"}
                </p>
                {data.doctor_notes_updated_at && (
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Actualizado:{" "}
                    {formatMx(new Date(data.doctor_notes_updated_at), "d MMM yyyy · HH:mm", { locale: es })}
                  </p>
                )}
              </Section>

              {showActions && (
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setRescheduleOpen(true)}>
                    <CalendarClock className="mr-1.5 h-4 w-4" />
                    Reagendar
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" disabled={cancelling}>
                        {cancelling ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <XCircle className="mr-1.5 h-4 w-4" />
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
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">No se encontró la cita.</p>
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
            patient_name: patient?.full_name ?? "Paciente",
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

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof User;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="pl-5">{children}</div>
    </div>
  );
}
