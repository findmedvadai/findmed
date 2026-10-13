import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimePicker } from "@/components/ui/time-picker";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { buildMexicoIso, formatMx } from "@/lib/timezone";
import { weekdayLabel } from "@/lib/availability-check";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-selected office (when calendar is filtered to one). */
  defaultOfficeId?: string | null;
  /** Pre-filled CDMX-local date (yyyy-MM-dd). */
  defaultDate?: string;
  /** Pre-filled CDMX-local time (HH:mm). */
  defaultTime?: string;
}

interface OfficeOption {
  id: string;
  name: string;
  display_color: string;
  appointment_duration_minutes: number;
}

const TIME_HM_REGEX = /^\d{2}:\d{2}$/;

function addMinutesToHm(hm: string, minutes: number): string {
  const [h, m] = hm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor((total % 1440 + 1440) % 1440 / 60);
  const newM = ((total % 60) + 60) % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

function diffMinutesHm(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

export default function DoctorCreateAppointmentDialog({
  open,
  onClose,
  defaultOfficeId,
  defaultDate,
  defaultTime,
}: Props) {
  const queryClient = useQueryClient();
  const { doctorId } = useAuth();

  const [officeId, setOfficeId] = useState<string>("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState(30);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [notifyPatient, setNotifyPatient] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [durationManuallyEdited, setDurationManuallyEdited] = useState(false);

  // Reset form when reopening.
  useEffect(() => {
    if (!open) return;
    setOfficeId(defaultOfficeId ?? "");
    setDate(defaultDate ?? formatMx(new Date(), "yyyy-MM-dd"));
    setStartTime(defaultTime ?? "09:00");
    setFullName("");
    setPhone("");
    setSymptoms("");
    setNotifyPatient(false);
    setDurationManuallyEdited(false);
  }, [open, defaultOfficeId, defaultDate, defaultTime]);

  const { data: offices = [] } = useQuery<OfficeOption[]>({
    queryKey: ["doctor-create-appt-offices", doctorId],
    queryFn: async () => {
      if (!doctorId) return [];
      const { data } = await supabase
        .from("doctor_offices")
        .select("id, name, display_color, appointment_duration_minutes")
        .eq("doctor_id", doctorId)
        .eq("is_active", true)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true });
      return (data ?? []) as OfficeOption[];
    },
    enabled: !!doctorId && open,
  });

  // Auto-pick when doctor has exactly one office.
  useEffect(() => {
    if (!officeId && offices.length === 1) setOfficeId(offices[0].id);
    if (officeId && !offices.find((o) => o.id === officeId)) setOfficeId("");
  }, [offices, officeId]);

  // Sync duration with selected office.
  useEffect(() => {
    if (durationManuallyEdited) return;
    const o = offices.find((x) => x.id === officeId);
    if (o) setDuration(o.appointment_duration_minutes ?? 30);
  }, [offices, officeId, durationManuallyEdited]);

  const endTime = useMemo(() => addMinutesToHm(startTime, duration), [startTime, duration]);

  const [availabilityWarning, setAvailabilityWarning] = useState<{
    weekday: number;
    blocks: { start_time: string; end_time: string }[];
    office_name: string;
  } | null>(null);

  const callCreate = async (forceOutside: boolean) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("No autenticado");
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    const startAt = buildMexicoIso(date, startTime);
    const endAt = buildMexicoIso(date, endTime);

    return await fetch(`${supabaseUrl}/functions/v1/doctor-create-appointment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        doctor_id: doctorId,
        office_id: officeId,
        start_at: startAt,
        end_at: endAt,
        patient: {
          full_name: fullName.trim(),
          phone: phone.trim(),
        },
        symptoms: symptoms.trim() || undefined,
        notify_patient_whatsapp: notifyPatient,
        force_outside_availability: forceOutside || undefined,
      }),
    });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await callCreate(false);
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
          throw new Error("Slot ocupado: ya hay otra cita en ese horario.");
        }
        throw new Error(data.error || "Error al crear cita");
      }
      return data as { appointment_id: string; patient_id: string; sync_warnings: string[] };
    },
    onSuccess: (data) => {
      const warnings = data.sync_warnings ?? [];
      if (warnings.length === 0) {
        toast.success("Cita creada");
      } else {
        const provider = warnings.includes("google") && warnings.includes("outlook")
          ? "Google y Outlook"
          : warnings.includes("google") ? "Google" : "Outlook";
        toast.warning(`Cita creada, pero no se pudo sincronizar con ${provider}.`);
      }
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments", doctorId] });
      onClose();
    },
    onError: (err: Error) => {
      if (err.message === "__OUTSIDE_AVAILABILITY_HANDLED__") return;
      toast.error(err.message);
    },
  });

  const forceCreateMutation = useMutation({
    mutationFn: async () => {
      const res = await callCreate(true);
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "slot_conflict") throw new Error("Slot ocupado.");
        throw new Error(data.error || "Error al crear cita");
      }
      return data as { appointment_id: string; patient_id: string; sync_warnings: string[] };
    },
    onSuccess: (data) => {
      const warnings = data.sync_warnings ?? [];
      if (warnings.length === 0) toast.success("Cita creada (fuera de disponibilidad)");
      else {
        const provider = warnings.includes("google") && warnings.includes("outlook")
          ? "Google y Outlook"
          : warnings.includes("google") ? "Google" : "Outlook";
        toast.warning(`Cita creada, pero no se pudo sincronizar con ${provider}.`);
      }
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments", doctorId] });
      setAvailabilityWarning(null);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canSubmit =
    !!officeId &&
    !!date &&
    TIME_HM_REGEX.test(startTime) &&
    duration > 0 &&
    diffMinutesHm(startTime, endTime) > 0 &&
    fullName.trim().length > 0 &&
    phone.trim().length > 0 &&
    !submitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    createMutation.mutate(undefined, { onSettled: () => setSubmitting(false) });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva cita</DialogTitle>
          <DialogDescription>
            Se registra como confirmada y se sincroniza con tu calendario.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Horario</h3>
            {offices.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="office" className="text-sm">Consultorio</Label>
                <Select value={officeId} onValueChange={setOfficeId}>
                  <SelectTrigger id="office" className="h-9 text-sm">
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="date" className="text-sm">Fecha</Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  min={formatMx(new Date(), "yyyy-MM-dd")}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-9 text-sm"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Hora de inicio</Label>
                <TimePicker value={startTime} onValueChange={setStartTime} className="h-9 text-sm" withIcon />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="duration" className="text-sm">Duración (min)</Label>
                <Input
                  id="duration"
                  type="number"
                  min={5}
                  step={5}
                  value={duration}
                  onChange={(e) => {
                    setDurationManuallyEdited(true);
                    setDuration(Math.max(5, parseInt(e.target.value || "0", 10)));
                  }}
                  className="h-9 text-sm"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">Termina</Label>
                <Input value={endTime} disabled readOnly className="h-9 bg-muted/50 text-sm" />
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Paciente</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fullName" className="text-sm">Nombre completo</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nombre y apellidos"
                  className="h-9 text-sm"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-sm">Teléfono</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+52 55 1234 5678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-9 text-sm"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="symptoms" className="text-sm">
                Motivo de consulta <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Textarea
                id="symptoms"
                rows={2}
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                className="text-sm"
              />
            </div>

            <div className="flex items-start gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
              <Checkbox
                id="notify"
                checked={notifyPatient}
                onCheckedChange={(v) => setNotifyPatient(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="notify" className="cursor-pointer space-y-0.5 font-normal">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  Avisar al paciente por WhatsApp
                </span>
                <span className="block text-xs text-muted-foreground">Le llega la confirmación de su cita.</span>
              </Label>
            </div>
          </section>

          <DialogFooter className="gap-2 border-t pt-4 sm:space-x-0">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit} className="gap-1.5">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Creando..." : "Crear cita"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <AlertDialog
        open={!!availabilityWarning}
        onOpenChange={(o) => { if (!o) setAvailabilityWarning(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fuera de disponibilidad</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  El horario elegido está fuera de la disponibilidad configurada del consultorio
                  {availabilityWarning?.office_name ? ` "${availabilityWarning.office_name}"` : ""} en{" "}
                  <strong>{availabilityWarning ? weekdayLabel(availabilityWarning.weekday) : ""}</strong>.
                </p>
                {availabilityWarning && availabilityWarning.blocks.length > 0 && (
                  <div>
                    <p className="text-muted-foreground">Disponibilidad ese día:</p>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {availabilityWarning.blocks.map((b, i) => (
                        <li key={i}>{b.start_time.slice(0, 5)} – {b.end_time.slice(0, 5)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {availabilityWarning && availabilityWarning.blocks.length === 0 && (
                  <p className="text-muted-foreground">
                    Este día no tiene horarios configurados para este consultorio.
                  </p>
                )}
                <p>¿Crear la cita de todas formas?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => forceCreateMutation.mutate()}
              disabled={forceCreateMutation.isPending}
            >
              Crear de todas formas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
