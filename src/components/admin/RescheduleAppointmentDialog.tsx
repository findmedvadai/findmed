import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { differenceInMinutes } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import { supabase } from "@/integrations/supabase/client";
import { buildMexicoIso, formatMx } from "@/lib/timezone";
import { weekdayLabel } from "@/lib/availability-check";
import { invalidateAdminAppointmentViews } from "@/lib/admin-appointment-queries";

interface Props {
  open: boolean;
  onClose: () => void;
  appointment: {
    id: string;
    start_at: string;
    end_at: string;
    patient_name: string;
  };
  onRescheduled?: () => void;
}

function addMinutesToHm(hm: string, minutes: number): string {
  const [h, m] = hm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor((total % 1440 + 1440) % 1440 / 60);
  const newM = ((total % 60) + 60) % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

export default function RescheduleAppointmentDialog({
  open,
  onClose,
  appointment,
  onRescheduled,
}: Props) {
  const queryClient = useQueryClient();
  const start = new Date(appointment.start_at);
  const end = new Date(appointment.end_at);
  const originalDuration = Math.max(5, differenceInMinutes(end, start));

  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState(originalDuration);
  const [submitting, setSubmitting] = useState(false);
  const [availabilityWarning, setAvailabilityWarning] = useState<{
    weekday: number;
    blocks: { start_time: string; end_time: string }[];
    office_name: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const s = new Date(appointment.start_at);
    const e = new Date(appointment.end_at);
    setDate(formatMx(s, "yyyy-MM-dd"));
    setStartTime(formatMx(s, "HH:mm"));
    setDuration(Math.max(5, differenceInMinutes(e, s)));
  }, [open, appointment.id, appointment.start_at, appointment.end_at]);

  const endTime = useMemo(() => addMinutesToHm(startTime, duration), [startTime, duration]);

  const callReschedule = async (forceOutside: boolean) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("No autenticado");
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    const startAt = buildMexicoIso(date, startTime);
    const endAt = buildMexicoIso(date, endTime);

    return await fetch(`${supabaseUrl}/functions/v1/admin-reschedule-appointment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appointment_id: appointment.id,
        start_at: startAt,
        end_at: endAt,
        force_outside_availability: forceOutside || undefined,
      }),
    });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await callReschedule(false);
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "outside_availability") {
          setAvailabilityWarning({
            weekday: data.weekday,
            blocks: data.blocks ?? [],
            office_name: data.office_name ?? "",
          });
          throw new Error("__OUTSIDE_AVAILABILITY_HANDLED__");
        }
        if (data.error === "slot_conflict") {
          throw new Error("Slot ocupado: hay otra cita o evento en ese horario.");
        }
        throw new Error(data.error || "Error al reagendar");
      }
      return data as { sync_warnings: string[] };
    },
    onSuccess: (data) => {
      const warnings = data.sync_warnings ?? [];
      if (warnings.length === 0) {
        toast.success("Cita reagendada");
      } else {
        const provider = warnings.includes("google") && warnings.includes("outlook")
          ? "Google y Outlook"
          : warnings.includes("google")
          ? "Google"
          : "Outlook";
        toast.warning(`Cita reagendada, pero no se pudo sincronizar con ${provider}.`);
      }
      invalidateAdminAppointmentViews(queryClient);
      onRescheduled?.();
      onClose();
    },
    onError: (err: Error) => {
      if (err.message === "__OUTSIDE_AVAILABILITY_HANDLED__") return;
      toast.error(err.message);
    },
  });

  const forceMutation = useMutation({
    mutationFn: async () => {
      const res = await callReschedule(true);
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "slot_conflict") {
          throw new Error("Slot ocupado: hay otra cita o evento en ese horario.");
        }
        throw new Error(data.error || "Error al reagendar");
      }
      return data as { sync_warnings: string[] };
    },
    onSuccess: (data) => {
      const warnings = data.sync_warnings ?? [];
      if (warnings.length === 0) toast.success("Cita reagendada (fuera de disponibilidad)");
      else toast.warning("Cita reagendada con sincronización parcial.");
      invalidateAdminAppointmentViews(queryClient);
      setAvailabilityWarning(null);
      onRescheduled?.();
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || duration <= 0) return;
    setSubmitting(true);
    mutation.mutate(undefined, { onSettled: () => setSubmitting(false) });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reagendar cita</DialogTitle>
          <DialogDescription>Se notifica al paciente y al doctor por WhatsApp.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{appointment.patient_name}</p>
            <p className="text-xs text-muted-foreground first-letter:uppercase">
              Ahora: {formatMx(start, "EEE d 'de' MMM yyyy", { locale: es })} · {formatMx(start, "HH:mm")} – {formatMx(end, "HH:mm")}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-date" className="text-sm">Nueva fecha</Label>
              <Input
                id="r-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 text-sm"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Nueva hora</Label>
              <TimePicker value={startTime} onValueChange={setStartTime} className="h-9 text-sm" withIcon />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-duration" className="text-sm">Duración (min)</Label>
              <Input
                id="r-duration"
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Math.max(5, parseInt(e.target.value || "0", 10)))}
                className="h-9 text-sm"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">Termina</Label>
              <Input value={endTime} disabled readOnly className="h-9 bg-muted/50 text-sm" />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2 sm:space-x-0">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={submitting} className="gap-1.5">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Reagendando..." : "Reagendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <AlertDialog
        open={!!availabilityWarning}
        onOpenChange={(o) => {
          if (!o) setAvailabilityWarning(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fuera de disponibilidad</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  El nuevo horario está fuera de la disponibilidad configurada del consultorio
                  {availabilityWarning?.office_name ? ` "${availabilityWarning.office_name}"` : ""} en{" "}
                  <strong>{availabilityWarning ? weekdayLabel(availabilityWarning.weekday) : ""}</strong>.
                </p>
                {availabilityWarning && availabilityWarning.blocks.length > 0 && (
                  <div>
                    <p className="text-muted-foreground">Disponibilidad ese día:</p>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {availabilityWarning.blocks.map((b, i) => (
                        <li key={i}>
                          {b.start_time.slice(0, 5)} – {b.end_time.slice(0, 5)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {availabilityWarning && availabilityWarning.blocks.length === 0 && (
                  <p className="text-muted-foreground">
                    Este día no tiene horarios configurados para este consultorio.
                  </p>
                )}
                <p>¿Reagendar de todas formas?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => forceMutation.mutate()}
              disabled={forceMutation.isPending}
            >
              Reagendar de todas formas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
