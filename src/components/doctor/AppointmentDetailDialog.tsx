import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isPast } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { buildMexicoIso, formatMx as fmx } from "@/lib/timezone";
import { weekdayLabel } from "@/lib/availability-check";

const MEXICO_TZ = "America/Mexico_City";
function formatMx(date: Date, fmt: string, opts?: Parameters<typeof format>[2]) {
  return format(toZonedTime(date, MEXICO_TZ), fmt, opts);
}
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileText,
  MapPin,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppointmentStatusBadge, SoftBadge } from "@/components/app/StatusBadge";
import { InsuranceDocumentsSection } from "@/components/app/PatientInsurance";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";
import CreateEventDialog from "./CreateEventDialog";
import { userErrorMessage } from "@/lib/edge-function-error";

type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];

export type CalendarItemType = "appointment" | "google" | "outlook";

export interface CalendarItem {
  id: string;
  type: CalendarItemType;
  start: Date;
  end: Date;
  title: string;
  status?: AppointmentStatus;
  phone?: string;
  symptoms?: string;
  doctorNotes?: string;
  // Office tag for the multi-office "all" view label.
  officeId?: string;
  officeName?: string;
  htmlLink?: string;
  description?: string;
}

interface Props {
  item: CalendarItem | null;
  open: boolean;
  onClose: () => void;
  doctorId: string;
}

export default function AppointmentDetailDialog({ item, open, onClose, doctorId }: Props) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [editEventOpen, setEditEventOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reschedule inline form state.
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleStart, setRescheduleStart] = useState("09:00");
  const [rescheduleEnd, setRescheduleEnd] = useState("10:00");
  const [rescheduleWarning, setRescheduleWarning] = useState<{
    weekday: number;
    blocks: { start_time: string; end_time: string }[];
    office_name: string;
  } | null>(null);

  // Seguro del paciente y estado de sus documentos (solo lectura para el doctor; RLS: sus citas y sus pacientes).
  const isFindmedAppointment = !!item && item.type === "appointment";
  const { data: coverage } = useQuery({
    queryKey: ["doctor-appointment-coverage", item?.id],
    enabled: open && isFindmedAppointment,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("documents_requested_at, documents_received_at, patients(id, has_insurance, insurer, policy_number)")
        .eq("id", item!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const coveragePatient = coverage?.patients as {
    id: string;
    has_insurance: boolean | null;
    insurer: string | null;
    policy_number: string | null;
  } | null | undefined;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["doctor-appointments", doctorId] });
  };

  const invalidateExternal = () => {
    queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
    queryClient.invalidateQueries({ queryKey: ["outlook-calendar-events"] });
  };

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/cancel-by-doctor`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ appointment_id: id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error al cancelar");
    },
    onSuccess: () => {
      toast.success("Cita cancelada");
      invalidate();
      onClose();
    },
    onError: (err: Error) => toast.error(userErrorMessage(err, "No se pudo cancelar la cita.")),
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("appointments")
        .update({ status: "completed" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cita completada");
      invalidate();
      onClose();
    },
    // La guarda de la base (20261014160000) solo deja al doctor completar una cita
    // agendada/confirmada o editar sus notas; su mensaje viene en español.
    onError: (err) => toast.error(userErrorMessage(err, "No se pudo completar la cita.")),
  });

  const notesMutation = useMutation({
    mutationFn: async ({ id, doctorNotes }: { id: string; doctorNotes: string }) => {
      const { error } = await supabase
        .from("appointments")
        .update({ doctor_notes: doctorNotes, doctor_notes_updated_at: new Date().toISOString(), status: "completed" })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: async (_id) => {
      toast.success("Notas guardadas");
      invalidate();
      setEditingNotes(false);
    },
    onError: (err) => toast.error(userErrorMessage(err, "No se pudieron guardar las notas.")),
  });

  const handleDeleteExternalEvent = async () => {
    if (!item) return;
    const provider = item.type === "outlook" ? "outlook" : "google";
    setDeleting(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) { toast.error("No autenticado"); return; }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const res = await fetch(`${supabaseUrl}/functions/v1/${provider}-calendar-delete-event`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event_id: item.id, office_id: item.officeId }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error al eliminar");

      toast.success(provider === "outlook"
        ? "Evento eliminado de Outlook Calendar"
        : "Evento eliminado de Google Calendar");
      invalidateExternal();
      onClose();
    } catch (err) {
      toast.error(userErrorMessage(err, "No se pudo eliminar el evento."));
    } finally {
      setDeleting(false);
    }
  };

  const callReschedule = async (forceOutside: boolean) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("No autenticado");
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    return await fetch(`${supabaseUrl}/functions/v1/doctor-reschedule-appointment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appointment_id: item!.id,
        start_at: buildMexicoIso(rescheduleDate, rescheduleStart),
        end_at: buildMexicoIso(rescheduleDate, rescheduleEnd),
        force_outside_availability: forceOutside || undefined,
      }),
    });
  };

  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      const res = await callReschedule(false);
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "outside_availability") {
          setRescheduleWarning({
            weekday: data.weekday,
            blocks: data.blocks ?? [],
            office_name: data.office_name ?? "",
          });
          throw new Error("__OUTSIDE_AVAILABILITY_HANDLED__");
        }
        if (data.error === "slot_conflict") throw new Error("Slot ocupado: ya hay otra cita en ese horario.");
        throw new Error(data.error || "Error al reagendar");
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Cita reagendada");
      invalidate();
      setRescheduling(false);
      onClose();
    },
    onError: (err: Error) => {
      if (err.message === "__OUTSIDE_AVAILABILITY_HANDLED__") return;
      toast.error(userErrorMessage(err, "No se pudo reagendar la cita."));
    },
  });

  const forceRescheduleMutation = useMutation({
    mutationFn: async () => {
      const res = await callReschedule(true);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al reagendar");
      return data;
    },
    onSuccess: () => {
      toast.success("Cita reagendada (fuera de disponibilidad)");
      invalidate();
      setRescheduleWarning(null);
      setRescheduling(false);
      onClose();
    },
    onError: (err: Error) => toast.error(userErrorMessage(err, "No se pudo reagendar la cita.")),
  });

  const openRescheduleForm = () => {
    if (!item) return;
    setRescheduleDate(fmx(item.start, "yyyy-MM-dd"));
    setRescheduleStart(fmx(item.start, "HH:mm"));
    setRescheduleEnd(fmx(item.end, "HH:mm"));
    setRescheduling(true);
  };

  if (!item) return null;

  const isExternal = item.type === "google" || item.type === "outlook";
  const externalProvider: "google" | "outlook" | null =
    item.type === "outlook" ? "outlook" : item.type === "google" ? "google" : null;
  const canComplete = item.status === "confirmed" && isPast(item.start);
  const canCancel = item.status === "scheduled" || item.status === "confirmed";
  const canReschedule = item.status === "scheduled" || item.status === "confirmed";
  const canEditNotes = item.status === "completed";

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setEditingNotes(false);
      onClose();
    }
  };

  const startEditNotes = () => {
    setNotes(item.doctorNotes ?? "");
    setEditingNotes(true);
  };

  return (
    <>
      <Dialog open={open && !editEventOpen} onOpenChange={handleOpenChange}>
        <DialogContent className={cn("max-h-[90vh] overflow-y-auto", isExternal ? "sm:max-w-lg" : "sm:max-w-2xl")}>
          <DialogHeader className="space-y-2 pr-6">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="text-base">{item.title}</DialogTitle>
              {!isExternal && item.status && <AppointmentStatusBadge status={item.status} />}
              {!isExternal && !item.status && <SoftBadge tone="neutral">FindMed</SoftBadge>}
              {externalProvider === "google" && <SoftBadge tone="neutral">Google Calendar</SoftBadge>}
              {externalProvider === "outlook" && <SoftBadge tone="neutral">Outlook Calendar</SoftBadge>}
            </div>
            <DialogDescription className="first-letter:uppercase">
              {formatMx(item.start, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })} ·{" "}
              {formatMx(item.start, "HH:mm")} – {formatMx(item.end, "HH:mm")}
            </DialogDescription>
          </DialogHeader>

          {!isExternal && (
            <div className="space-y-4">
              {item.officeName && (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">Consultorio</span>
                  <span className="truncate font-medium text-foreground">{item.officeName}</span>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <section className="space-y-1.5">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <ClipboardList className="h-4 w-4 text-muted-foreground" /> Síntomas
                  </h3>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {item.symptoms || "Sin síntomas registrados."}
                  </p>
                </section>
                <section className="space-y-1.5">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <FileText className="h-4 w-4 text-muted-foreground" /> Notas médicas
                  </h3>
                  {canEditNotes && editingNotes ? (
                    <div className="space-y-2">
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Escribe las notas médicas..."
                        rows={4}
                        className="text-sm"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setEditingNotes(false)}>
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          disabled={notesMutation.isPending}
                          onClick={() => notesMutation.mutate({ id: item.id, doctorNotes: notes })}
                        >
                          Guardar notas
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-line text-sm text-muted-foreground">
                      {item.doctorNotes || "Sin notas."}
                    </p>
                  )}
                </section>
              </div>
              {coverage && (
                <InsuranceDocumentsSection
                  patientId={coveragePatient?.id}
                  insurance={{
                    hasInsurance: coveragePatient?.has_insurance,
                    insurer: coveragePatient?.insurer,
                    policyNumber: coveragePatient?.policy_number,
                  }}
                  requestedAt={coverage.documents_requested_at}
                  receivedAt={coverage.documents_received_at}
                />
              )}
            </div>
          )}

          {isExternal && (item.description || item.htmlLink) && (
            <div className="space-y-3">
              {item.description && (
                <p className="whitespace-pre-line rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  {item.description}
                </p>
              )}
              {item.htmlLink && (
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a href={item.htmlLink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    {externalProvider === "outlook" ? "Abrir en Outlook Calendar" : "Abrir en Google Calendar"}
                  </a>
                </Button>
              )}
            </div>
          )}

          {/* Reschedule inline form */}
          {!isExternal && canReschedule && rescheduling && (
            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Reagendar cita</p>
                <p className="text-xs text-muted-foreground">Se avisa al paciente del nuevo horario.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="col-span-2 space-y-1.5 sm:col-span-1">
                  <Label className="text-sm">Fecha</Label>
                  <Input
                    type="date"
                    value={rescheduleDate}
                    min={fmx(new Date(), "yyyy-MM-dd")}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Inicio</Label>
                  <TimePicker value={rescheduleStart} onValueChange={setRescheduleStart} className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Fin</Label>
                  <TimePicker value={rescheduleEnd} onValueChange={setRescheduleEnd} className="h-9 text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRescheduling(false)}
                  disabled={rescheduleMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={rescheduleMutation.isPending || !rescheduleDate || !rescheduleStart || !rescheduleEnd}
                  onClick={() => rescheduleMutation.mutate()}
                >
                  {rescheduleMutation.isPending ? "Reagendando..." : "Confirmar nuevo horario"}
                </Button>
              </div>
            </div>
          )}

          {/* Actions for external events (Google / Outlook) */}
          {isExternal && (
            <DialogFooter className="gap-2 border-t pt-4 sm:justify-between sm:space-x-0">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                    Eliminar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Eliminar este evento?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {externalProvider === "outlook"
                        ? "Se eliminará de tu Outlook Calendar. Esta acción no se puede deshacer."
                        : "Se eliminará de tu Google Calendar. Esta acción no se puede deshacer."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Volver</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteExternalEvent}
                      disabled={deleting}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {deleting ? "Eliminando..." : "Sí, eliminar"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {/* El editor solo existe cuando el evento trae su consultorio (ver abajo). */}
              {externalProvider && item.officeId && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditEventOpen(true)}>
                  <Pencil className="h-4 w-4" />
                  Editar
                </Button>
              )}
            </DialogFooter>
          )}

          {/* Actions for appointments */}
          {!isExternal && (canCancel || (canEditNotes && !editingNotes) || (canReschedule && !rescheduling) || canComplete) && (
            <DialogFooter className="gap-2 border-t pt-4 sm:justify-between sm:space-x-0">
              <div>
                {canCancel && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto">
                        <XCircle className="h-4 w-4" />
                        Cancelar cita
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Cancelar esta cita?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta acción no se puede deshacer. El paciente será notificado de la cancelación.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Volver</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => cancelMutation.mutate(item.id)}
                          disabled={cancelMutation.isPending}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Sí, cancelar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {canEditNotes && !editingNotes && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={startEditNotes}>
                    <Pencil className="h-4 w-4" />
                    Editar notas
                  </Button>
                )}
                {canReschedule && !rescheduling && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={openRescheduleForm}>
                    <CalendarClock className="h-4 w-4" />
                    Reagendar
                  </Button>
                )}
                {canComplete && (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={completeMutation.isPending}
                    onClick={() => completeMutation.mutate(item.id)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Completar
                  </Button>
                )}
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Reschedule outside-availability confirmation */}
      <AlertDialog
        open={!!rescheduleWarning}
        onOpenChange={(o) => { if (!o) setRescheduleWarning(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fuera de disponibilidad</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  El horario elegido está fuera de la disponibilidad configurada del consultorio
                  {rescheduleWarning?.office_name ? ` "${rescheduleWarning.office_name}"` : ""} en{" "}
                  <strong>{rescheduleWarning ? weekdayLabel(rescheduleWarning.weekday) : ""}</strong>.
                </p>
                {rescheduleWarning && rescheduleWarning.blocks.length > 0 && (
                  <ul className="list-disc list-inside text-muted-foreground">
                    {rescheduleWarning.blocks.map((b, i) => (
                      <li key={i}>{b.start_time.slice(0, 5)} – {b.end_time.slice(0, 5)}</li>
                    ))}
                  </ul>
                )}
                <p>¿Reagendar de todas formas?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => forceRescheduleMutation.mutate()}
              disabled={forceRescheduleMutation.isPending}
            >
              Reagendar de todas formas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit event dialog (for external events) */}
      {isExternal && externalProvider && item.officeId && (
        <CreateEventDialog
          open={editEventOpen}
          onClose={() => {
            setEditEventOpen(false);
            onClose();
          }}
          provider={externalProvider}
          officeId={item.officeId}
          editEvent={{
            id: item.id,
            summary: item.title,
            description: item.description,
            start: item.start,
            end: item.end,
          }}
        />
      )}
    </>
  );
}
