import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const MEXICO_TZ = "America/Mexico_City";
const formatMx = (date: Date, fmt: string) => format(toZonedTime(date, MEXICO_TZ), fmt);
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CreateEventDialogProps {
  open: boolean;
  onClose: () => void;
  defaultDate?: Date;
  defaultStartHour?: number;
  /** If provided, the dialog is in "edit" mode */
  editEvent?: {
    id: string;
    summary: string;
    description?: string;
    start: Date;
    end: Date;
  };
  /**
   * Forces the calendar provider used to write the event.
   * Required when editing an existing event so it goes back to the right calendar.
   * If omitted (creation flow), the provider is auto-detected from the doctor's connections.
   */
  provider?: "google" | "outlook";
}

export default function CreateEventDialog({
  open,
  onClose,
  defaultDate,
  defaultStartHour,
  editEvent,
  provider,
}: CreateEventDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = !!editEvent;

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [submitting, setSubmitting] = useState(false);

  // Reset form when dialog opens. All form fields represent CDMX local time, since
  // the doctor reasons in CDMX and the Edge Functions also assume CDMX as the calendar TZ.
  useEffect(() => {
    if (!open) return;

    if (editEvent) {
      setSummary(editEvent.summary);
      setDescription(editEvent.description ?? "");
      setDate(formatMx(editEvent.start, "yyyy-MM-dd"));
      setStartTime(formatMx(editEvent.start, "HH:mm"));
      setEndTime(formatMx(editEvent.end, "HH:mm"));
    } else {
      setSummary("");
      setDescription("");
      const d = defaultDate ?? new Date();
      setDate(formatMx(d, "yyyy-MM-dd"));
      const sh = defaultStartHour ?? 9;
      setStartTime(
        `${String(Math.floor(sh)).padStart(2, "0")}:${String(Math.round((sh % 1) * 60)).padStart(2, "0")}`
      );
      const eh = (defaultStartHour ?? 9) + 1;
      setEndTime(
        `${String(Math.floor(eh)).padStart(2, "0")}:${String(Math.round((eh % 1) * 60)).padStart(2, "0")}`
      );
    }
  }, [open, editEvent, defaultDate, defaultStartHour]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim() || !date || !startTime || !endTime) return;

    setSubmitting(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        toast.error("No estás autenticado");
        return;
      }

      // When editing an external event we MUST use the same provider it came from.
      // For new events we auto-detect from the doctor's connections.
      let providerPrefix: "google" | "outlook";
      if (provider) {
        providerPrefix = provider;
      } else {
        const { data: doctorData } = await supabase
          .from("doctors")
          .select("google_calendar_connected, outlook_calendar_connected")
          .eq("id", (await supabase.from("users").select("doctor_id").eq("id", session.data.session!.user.id).maybeSingle()).data?.doctor_id ?? "")
          .maybeSingle();

        const useOutlook = doctorData?.outlook_calendar_connected && !doctorData?.google_calendar_connected;
        providerPrefix = useOutlook ? "outlook" : "google";
      }

      // Build naive ISO timestamps (no TZ suffix). The Edge Functions wrap these with
      // timeZone: "America/Mexico_City" when sending to Google/Outlook.
      const startAt = `${date}T${startTime}:00`;
      const endAt = `${date}T${endTime}:00`;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const endpoint = isEdit
        ? `${supabaseUrl}/functions/v1/${providerPrefix}-calendar-update-event`
        : `${supabaseUrl}/functions/v1/${providerPrefix}-calendar-create-event`;

      const payload = isEdit
        ? {
            event_id: editEvent!.id,
            summary: summary.trim(),
            description: description.trim() || undefined,
            start_at: startAt,
            end_at: endAt,
          }
        : {
            summary: summary.trim(),
            description: description.trim() || undefined,
            start_at: startAt,
            end_at: endAt,
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || (isEdit ? "Error al actualizar evento" : "Error al crear evento"));
      }

      toast.success(isEdit ? "Evento actualizado" : "Evento creado en calendario");
      queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
      queryClient.invalidateQueries({ queryKey: ["outlook-calendar-events"] });
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar evento");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar evento" : "Crear evento"}</DialogTitle>
          <DialogDescription>
            {(() => {
              const target =
                provider === "outlook"
                  ? "Outlook Calendar"
                  : provider === "google"
                  ? "Google Calendar"
                  : "tu calendario conectado";
              return isEdit
                ? `Se actualizará en ${target}.`
                : `Se creará en ${target}.`;
            })()}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="summary">Título *</Label>
            <Input
              id="summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Ej: Consulta, Reunión..."
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opcional"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">Fecha</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="startTime">Hora inicio</Label>
              <Input
                id="startTime"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">Hora fin</Label>
              <Input
                id="endTime"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting || !summary.trim()}>
              {submitting
                ? isEdit ? "Guardando..." : "Creando..."
                : isEdit ? "Guardar cambios" : "Crear evento"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
