import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const MEXICO_TZ = "America/Mexico_City";
const formatMx = (date: Date, fmt: string) => format(toZonedTime(date, MEXICO_TZ), fmt);
const todayMx = () => formatMx(new Date(), "yyyy-MM-dd");
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import { weekdayLabel } from "@/lib/availability-check";

interface CreateEventDialogProps {
  open: boolean;
  onClose: () => void;
  defaultDate?: Date;
  defaultStartHour?: number;
  /**
   * Office to write the event into. Optional when creating from the "Todos los
   * consultorios" view — the dialog renders an office picker. Required when
   * editing an existing event since each event lives in a specific office.
   */
  officeId?: string;
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
   * If omitted (creation flow), the provider is auto-detected from the office's connections.
   */
  provider?: "google" | "outlook";
}

export default function CreateEventDialog({
  open,
  onClose,
  defaultDate,
  defaultStartHour,
  officeId: officeIdProp,
  editEvent,
  provider,
}: CreateEventDialogProps) {
  const queryClient = useQueryClient();
  const { doctorId } = useAuth();
  const isEdit = !!editEvent;

  // When officeIdProp isn't provided (i.e. caller is in "all offices" view),
  // we render an in-dialog office picker. State holds the chosen value.
  const [officeIdState, setOfficeIdState] = useState<string>(officeIdProp ?? "");
  const officeId = officeIdProp ?? officeIdState;

  const { data: offices = [] } = useQuery({
    queryKey: ["create-event-dialog-offices", doctorId],
    queryFn: async () => {
      if (!doctorId) return [] as { id: string; name: string; display_color: string }[];
      const { data } = await supabase
        .from("doctor_offices")
        .select("id, name, display_color")
        .eq("doctor_id", doctorId)
        .eq("is_active", true)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true });
      return (data ?? []) as { id: string; name: string; display_color: string }[];
    },
    enabled: !!doctorId && !officeIdProp && open,
  });

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [submitting, setSubmitting] = useState(false);
  // Office duration (minutes) — used to auto-fill endTime.
  const [officeDuration, setOfficeDuration] = useState<number>(60);

  // Helper: add duration minutes to HH:mm string.
  const addMinutes = (hm: string, mins: number): string => {
    const [h, m] = hm.split(":").map(Number);
    const total = h * 60 + m + mins;
    const newH = Math.floor(((total % 1440) + 1440) % 1440 / 60);
    const newM = ((total % 60) + 60) % 60;
    return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
  };

  // Fetch office appointment_duration_minutes whenever the selected office changes.
  useEffect(() => {
    if (!officeId) return;
    supabase
      .from("doctor_offices")
      .select("appointment_duration_minutes")
      .eq("id", officeId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.appointment_duration_minutes) {
          setOfficeDuration(data.appointment_duration_minutes);
        }
      });
  }, [officeId]);

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
      const st = `${String(Math.floor(sh)).padStart(2, "0")}:${String(Math.round((sh % 1) * 60)).padStart(2, "0")}`;
      setStartTime(st);
      setEndTime(addMinutes(st, officeDuration));
    }
    // Pre-select the only office automatically when no prop and exactly 1 exists.
    if (!officeIdProp && offices.length === 1) {
      setOfficeIdState(offices[0].id);
    }
  }, [open, editEvent, defaultDate, defaultStartHour, officeIdProp, offices, officeDuration]);

  // When start time changes (and not in edit mode), recalculate end time.
  useEffect(() => {
    if (!isEdit && startTime && officeDuration) {
      setEndTime(addMinutes(startTime, officeDuration));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, officeDuration]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  // The outside-availability soft-warning state. Same UX as the admin path:
  // backend returns 409 outside_availability with the office's enabled
  // blocks; we surface them and let the user override.
  const [availabilityWarning, setAvailabilityWarning] = useState<{
    weekday: number;
    blocks: { start_time: string; end_time: string }[];
    office_name: string;
  } | null>(null);

  const callApi = async (forceOutside: boolean) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("No estás autenticado");

    let providerPrefix: "google" | "outlook";
    if (provider) {
      providerPrefix = provider;
    } else {
      const { data: officeData } = await supabase
        .from("doctor_offices")
        .select("google_calendar_connected, outlook_calendar_connected")
        .eq("id", officeId)
        .maybeSingle();
      const useOutlook =
        officeData?.outlook_calendar_connected && !officeData?.google_calendar_connected;
      providerPrefix = useOutlook ? "outlook" : "google";
    }

    const startAt = `${date}T${startTime}:00-06:00`;
    const endAt = `${date}T${endTime}:00-06:00`;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const endpoint = isEdit
      ? `${supabaseUrl}/functions/v1/${providerPrefix}-calendar-update-event`
      : `${supabaseUrl}/functions/v1/${providerPrefix}-calendar-create-event`;

    const payload: Record<string, unknown> = {
      office_id: officeId,
      summary: summary.trim(),
      description: description.trim() || undefined,
      start_at: startAt,
      end_at: endAt,
      force_outside_availability: forceOutside || undefined,
    };
    if (isEdit) payload.event_id = editEvent!.id;

    return await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  };

  const finishSuccess = () => {
    toast.success(isEdit ? "Evento actualizado" : "Evento creado en calendario");
    queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
    queryClient.invalidateQueries({ queryKey: ["outlook-calendar-events"] });
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim() || !date || !startTime || !endTime) return;
    if (!officeId) {
      toast.error("Selecciona un consultorio");
      return;
    }

    setSubmitting(true);
    try {
      const res = await callApi(false);
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "outside_availability") {
          setAvailabilityWarning({
            weekday: data.weekday,
            blocks: data.blocks ?? [],
            office_name: data.office_name ?? "",
          });
          return;
        }
        throw new Error(data.error || (isEdit ? "Error al actualizar evento" : "Error al crear evento"));
      }
      finishSuccess();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar evento");
    } finally {
      setSubmitting(false);
    }
  };

  const handleForceCreate = async () => {
    setAvailabilityWarning(null);
    setSubmitting(true);
    try {
      const res = await callApi(true);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al guardar evento");
      finishSuccess();
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
          {!officeIdProp && !isEdit && (
            <div className="space-y-2">
              <Label htmlFor="office">Consultorio *</Label>
              <Select value={officeIdState} onValueChange={setOfficeIdState}>
                <SelectTrigger id="office">
                  <SelectValue placeholder="Selecciona un consultorio" />
                </SelectTrigger>
                <SelectContent>
                  {offices.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: o.display_color }}
                        />
                        {o.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
              min={todayMx()}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="startTime">Hora inicio</Label>
              <TimePicker value={startTime} onValueChange={setStartTime} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">Hora fin</Label>
              <TimePicker value={endTime} onValueChange={setEndTime} />
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
                  El horario que elegiste está fuera de la disponibilidad configurada del consultorio
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
                <p>¿Crear el evento de todas formas?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleForceCreate} disabled={submitting}>
              Crear de todas formas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
