import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import CreateEventDialog from "./CreateEventDialog";

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

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  completed: "Completada",
};

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  scheduled: "bg-scheduled text-scheduled-foreground",
  confirmed: "bg-confirmed text-confirmed-foreground",
  cancelled: "bg-destructive/60 text-destructive-foreground",
  completed: "bg-primary/80 text-primary-foreground",
};

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
    onError: (err: Error) => toast.error(err.message || "Error al cancelar la cita"),
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
    onError: () => toast.error("Error al completar la cita"),
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
    onSuccess: async (id) => {
      // Insert admin notification for completed appointment
      try {
        const [{ data: doctorData }, { data: apptData }] = await Promise.all([
          supabase.from("doctors").select("full_name").eq("id", doctorId).single(),
          supabase.from("appointments").select("patient_id").eq("id", id).single(),
        ]);
        if (apptData?.patient_id) {
          const { data: patientData } = await supabase
            .from("patients").select("full_name").eq("id", apptData.patient_id).single();
          await supabase.from("notifications").insert({
            doctor_id: doctorId,
            appointment_id: id,
            recipient_role: "admin",
            type: "appointment_completed",
            title: "Cita completada con notas",
            body: `Dr. ${doctorData?.full_name ?? "Doctor"} completó notas para ${patientData?.full_name ?? "Paciente"}`,
          } as any);
        }
      } catch (e) {
        console.error("Error inserting admin notification:", e);
      }
      toast.success("Notas guardadas");
      invalidate();
      setEditingNotes(false);
    },
    onError: () => toast.error("Error al guardar notas"),
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
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar evento");
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
      toast.error(err.message);
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
    onError: (err: Error) => toast.error(err.message),
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {item.title}
              {!isExternal && item.status && (
                <Badge className={STATUS_STYLES[item.status]}>{STATUS_LABELS[item.status]}</Badge>
              )}
              {!isExternal && !item.status && (
                <Badge variant="outline" className="text-xs">Plataforma</Badge>
              )}
              {externalProvider === "google" && (
                <Badge variant="outline" className="text-xs">Google</Badge>
              )}
              {externalProvider === "outlook" && (
                <Badge variant="outline" className="text-xs">Outlook</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {formatMx(item.start, "EEEE d 'de' MMMM, yyyy", { locale: es })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">Horario: </span>
              <span className="font-medium">
                {formatMx(item.start, "HH:mm")} – {formatMx(item.end, "HH:mm")}
              </span>
            </div>

            {!isExternal && item.symptoms && (
              <div>
                <span className="text-muted-foreground">Síntomas: </span>
                <span>{item.symptoms}</span>
              </div>
            )}

            {isExternal && item.description && (
              <div>
                <span className="text-muted-foreground">Descripción: </span>
                <span>{item.description}</span>
              </div>
            )}

            {!isExternal && item.doctorNotes && !editingNotes && (
              <div>
                <span className="text-muted-foreground">Notas médicas: </span>
                <span>{item.doctorNotes}</span>
              </div>
            )}

            {isExternal && item.htmlLink && (
              <a
                href={item.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline text-xs"
              >
                {externalProvider === "outlook" ? "Abrir en Outlook Calendar" : "Abrir en Google Calendar"}
              </a>
            )}
          </div>

          {/* Edit notes for completed appointments */}
          {canEditNotes && editingNotes && (
            <div className="space-y-2">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Escribe las notas médicas..."
                rows={4}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setEditingNotes(false)}>
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
          )}

          {/* Actions for external events (Google / Outlook) */}
          {isExternal && (
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setEditEventOpen(true)}>
                Editar
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
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
                    <AlertDialogAction onClick={handleDeleteExternalEvent} disabled={deleting}>
                      {deleting ? "Eliminando..." : "Sí, eliminar"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {/* Actions for appointments */}
          {!isExternal && (
            <>
              {/* Reschedule inline form */}
              {canReschedule && rescheduling && (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-sm font-medium">Reagendar cita</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Fecha</Label>
                    <Input
                      type="date"
                      value={rescheduleDate}
                      min={fmx(new Date(), "yyyy-MM-dd")}
                      onChange={(e) => setRescheduleDate(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Hora inicio</Label>
                      <TimePicker value={rescheduleStart} onValueChange={setRescheduleStart} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Hora fin</Label>
                      <TimePicker value={rescheduleEnd} onValueChange={setRescheduleEnd} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
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
                      {rescheduleMutation.isPending ? "Reagendando..." : "Confirmar reagenda"}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                {canEditNotes && !editingNotes && (
                  <Button variant="outline" size="sm" onClick={startEditNotes}>
                    Editar notas
                  </Button>
                )}
                {canReschedule && !rescheduling && (
                  <Button variant="outline" size="sm" onClick={openRescheduleForm}>
                    Reagendar
                  </Button>
                )}
                {canComplete && (
                  <Button
                    size="sm"
                    disabled={completeMutation.isPending}
                    onClick={() => completeMutation.mutate(item.id)}
                  >
                    Completar
                  </Button>
                )}
                {canCancel && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm">
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
                        >
                          Sí, cancelar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </>
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
