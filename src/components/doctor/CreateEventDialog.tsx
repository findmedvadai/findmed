import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
}

export default function CreateEventDialog({
  open,
  onClose,
  defaultDate,
  defaultStartHour,
}: CreateEventDialogProps) {
  const queryClient = useQueryClient();

  const initialDate = defaultDate ? format(defaultDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
  const initialStart = defaultStartHour !== undefined
    ? `${String(Math.floor(defaultStartHour)).padStart(2, "0")}:${String(Math.round((defaultStartHour % 1) * 60)).padStart(2, "0")}`
    : "09:00";
  const initialEndHour = defaultStartHour !== undefined ? defaultStartHour + 1 : 10;
  const initialEnd = `${String(Math.floor(initialEndHour)).padStart(2, "0")}:${String(Math.round((initialEndHour % 1) * 60)).padStart(2, "0")}`;

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const [submitting, setSubmitting] = useState(false);

  // Reset form when dialog opens with new defaults
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      setSummary("");
      setDescription("");
    }
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

      const startAt = `${date}T${startTime}:00`;
      const endAt = `${date}T${endTime}:00`;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const res = await fetch(
        `${supabaseUrl}/functions/v1/google-calendar-create-event`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary: summary.trim(),
            description: description.trim() || undefined,
            start_at: startAt,
            end_at: endAt,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Error al crear evento");
      }

      toast.success("Evento creado en Google Calendar");
      queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
      handleOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Error al crear evento");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crear evento</DialogTitle>
          <DialogDescription>
            Se creará en tu Google Calendar conectado.
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
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting || !summary.trim()}>
              {submitting ? "Creando..." : "Crear evento"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
