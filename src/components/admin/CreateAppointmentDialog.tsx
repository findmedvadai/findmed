import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { buildMexicoIso, formatMx } from "@/lib/timezone";
import PatientAutocomplete, { type PatientLookupResult } from "./PatientAutocomplete";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-selected doctor when the calendar is filtered by one. */
  defaultDoctorId?: string | null;
  /** Pre-selected office (when calendar filtered to a specific office). */
  defaultOfficeId?: string | null;
  /** Pre-filled CDMX-local date (yyyy-MM-dd). */
  defaultDate?: string;
  /** Pre-filled CDMX-local time (HH:mm). */
  defaultTime?: string;
}

interface DoctorOption {
  id: string;
  full_name: string;
}

interface OfficeOption {
  id: string;
  name: string;
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

export default function CreateAppointmentDialog({
  open,
  onClose,
  defaultDoctorId,
  defaultOfficeId,
  defaultDate,
  defaultTime,
}: Props) {
  const queryClient = useQueryClient();

  const [doctorId, setDoctorId] = useState<string>("");
  const [officeId, setOfficeId] = useState<string>("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState(30);
  const [searchQuery, setSearchQuery] = useState("");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [notifyPatient, setNotifyPatient] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [durationManuallyEdited, setDurationManuallyEdited] = useState(false);

  // Reset form when reopening.
  useEffect(() => {
    if (!open) return;
    setDoctorId(defaultDoctorId ?? "");
    setOfficeId(defaultOfficeId ?? "");
    setDate(defaultDate ?? formatMx(new Date(), "yyyy-MM-dd"));
    setStartTime(defaultTime ?? "09:00");
    setSearchQuery("");
    setPatientId(null);
    setFullName("");
    setPhone("");
    setSymptoms("");
    setNotifyPatient(false);
    setDurationManuallyEdited(false);
  }, [open, defaultDoctorId, defaultOfficeId, defaultDate, defaultTime]);

  const { data: doctors = [] } = useQuery<DoctorOption[]>({
    queryKey: ["admin-create-appt-doctors"],
    queryFn: async () => {
      const { data } = await supabase
        .from("doctors")
        .select("id, full_name")
        .eq("is_active", true)
        .eq("is_deleted", false)
        .order("full_name");
      return (data ?? []) as DoctorOption[];
    },
  });

  // Active offices for the selected doctor.
  const { data: offices = [] } = useQuery<OfficeOption[]>({
    queryKey: ["admin-create-appt-offices", doctorId],
    queryFn: async () => {
      if (!doctorId) return [];
      const { data } = await supabase
        .from("doctor_offices")
        .select("id, name, appointment_duration_minutes")
        .eq("doctor_id", doctorId)
        .eq("is_active", true)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true });
      return (data ?? []) as OfficeOption[];
    },
    enabled: !!doctorId,
  });

  // Auto-pick when the doctor has exactly one active office.
  useEffect(() => {
    if (!officeId && offices.length === 1) setOfficeId(offices[0].id);
    // If the current office is no longer in the list (e.g. doctor changed),
    // clear the selection.
    if (officeId && !offices.find((o) => o.id === officeId)) setOfficeId("");
  }, [offices, officeId]);

  // Sync duration with the SELECTED OFFICE (was doctor-level pre-mejora-2).
  useEffect(() => {
    if (durationManuallyEdited) return;
    const o = offices.find((x) => x.id === officeId);
    if (o) setDuration(o.appointment_duration_minutes ?? 30);
  }, [offices, officeId, durationManuallyEdited]);

  // End time derived from start + duration; users edit duration, not end-time.
  const endTime = useMemo(() => addMinutesToHm(startTime, duration), [startTime, duration]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const startAt = buildMexicoIso(date, startTime);
      const endAt = buildMexicoIso(date, endTime);

      const res = await fetch(`${supabaseUrl}/functions/v1/admin-create-appointment`, {
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
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.error === "slot_conflict") {
          throw new Error("Slot ocupado: ya hay otra cita o evento en ese horario.");
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
          : warnings.includes("google")
          ? "Google"
          : "Outlook";
        toast.warning(
          `Cita creada, pero no se pudo sincronizar con ${provider}. Crea el evento manualmente o reintenta más tarde.`
        );
      }
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-google-events"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-outlook-events"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const onSelectPatient = (p: PatientLookupResult) => {
    setPatientId(p.id);
    setFullName(p.full_name);
    setPhone(p.phone);
    setSearchQuery(p.full_name);
  };

  const canSubmit =
    !!doctorId &&
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
    createMutation.mutate(undefined, {
      onSettled: () => setSubmitting(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear cita</DialogTitle>
          <DialogDescription>
            La cita se crea como confirmada. Se notifica al doctor por WhatsApp;
            al paciente solo si activas el toggle.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="doctor">Doctor *</Label>
            <Select value={doctorId} onValueChange={(v) => { setDoctorId(v); setOfficeId(""); }}>
              <SelectTrigger id="doctor">
                <SelectValue placeholder="Selecciona un doctor" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {doctorId && (
            <div className="space-y-1.5">
              <Label htmlFor="office">Consultorio *</Label>
              <Select value={officeId} onValueChange={setOfficeId}>
                <SelectTrigger id="office">
                  <SelectValue placeholder={offices.length ? "Selecciona un consultorio" : "Sin consultorios activos"} />
                </SelectTrigger>
                <SelectContent>
                  {offices.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {offices.length === 0 && (
                <p className="text-xs text-destructive">
                  Este doctor no tiene consultorios activos. Crea uno desde el panel de doctores.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="date">Fecha *</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="startTime">Hora inicio *</Label>
              <Input
                id="startTime"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="duration">Duración (min) *</Label>
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
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hora fin</Label>
              <Input value={endTime} disabled readOnly />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Buscar paciente</Label>
            <PatientAutocomplete
              query={searchQuery}
              onQueryChange={(q) => {
                setSearchQuery(q);
                if (patientId && q !== fullName) setPatientId(null);
              }}
              onSelect={onSelectPatient}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Nombre del paciente *</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Teléfono *</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+52 55 1234 5678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="symptoms">Motivo de consulta (opcional)</Label>
            <Textarea
              id="symptoms"
              rows={2}
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="notify"
              checked={notifyPatient}
              onCheckedChange={(v) => setNotifyPatient(v === true)}
            />
            <Label htmlFor="notify" className="text-sm font-normal cursor-pointer">
              Enviar confirmación por WhatsApp al paciente
            </Label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? "Creando..." : "Crear cita"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
