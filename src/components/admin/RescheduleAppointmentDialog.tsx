import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { differenceInMinutes } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
    setDate(formatMx(start, "yyyy-MM-dd"));
    setStartTime(formatMx(start, "HH:mm"));
    setDuration(originalDuration);
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
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-google-events"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-outlook-events"] });
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
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-google-events"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-outlook-events"] });
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reagendar cita</DialogTitle>
          <DialogDescription>
            {appointment.patient_name} — se notifica al paciente y al doctor por WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-date">Nueva fecha *</Label>
              <Input
                id="r-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-start">Nueva hora *</Label>
              <TimePicker value={startTime} onValueChange={setStartTime} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-duration">Duración (min) *</Label>
              <Input
                id="r-duration"
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Math.max(5, parseInt(e.target.value || "0", 10)))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Termina</Label>
              <Input value={endTime} disabled readOnly />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? "Reagendando..." : "Reagendar"}
            </Button>
          </div>
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
