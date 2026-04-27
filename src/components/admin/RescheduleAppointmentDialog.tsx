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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { buildMexicoIso, formatMx } from "@/lib/timezone";

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

  // Initialize from the appointment in CDMX local terms each time we open.
  useEffect(() => {
    if (!open) return;
    setDate(formatMx(start, "yyyy-MM-dd"));
    setStartTime(formatMx(start, "HH:mm"));
    setDuration(originalDuration);
  }, [open, appointment.id, appointment.start_at, appointment.end_at]);

  const endTime = useMemo(() => addMinutesToHm(startTime, duration), [startTime, duration]);

  const mutation = useMutation({
    mutationFn: async () => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const startAt = buildMexicoIso(date, startTime);
      const endAt = buildMexicoIso(date, endTime);

      const res = await fetch(`${supabaseUrl}/functions/v1/admin-reschedule-appointment`, {
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
        }),
      });

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
      if (warnings.length === 0) {
        toast.success("Cita reagendada");
      } else {
        const provider = warnings.includes("google") && warnings.includes("outlook")
          ? "Google y Outlook"
          : warnings.includes("google")
          ? "Google"
          : "Outlook";
        toast.warning(
          `Cita reagendada, pero no se pudo sincronizar con ${provider}.`
        );
      }
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-google-events"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-outlook-events"] });
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
              <Input
                id="r-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
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
    </Dialog>
  );
}
