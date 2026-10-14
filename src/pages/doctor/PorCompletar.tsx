import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { SoftBadge } from "@/components/app/StatusBadge";
import { cn } from "@/lib/utils";
import { formatMx } from "@/lib/timezone";
import {
  isManagementType,
  MANAGEMENT_TYPE_INFO,
  MANAGEMENT_TYPES,
  suggestManagementType,
  type ManagementType,
} from "@/lib/management-type";
import { CalendarDays, CheckCircle2, Phone, Send, Pill, ScanLine, FlaskConical, UserRoundPlus, Building2 } from "lucide-react";

const TOGGLE_FIELDS = [
  { key: "prescribed_medications", label: "Se recetaron medicamentos", placeholder: "Nombres, dosis y frecuencia...", icon: Pill },
  { key: "imaging_studies", label: "Se solicitaron estudios de imagen", placeholder: "Tipo de estudio (radiografía, ultrasonido, resonancia, etc.)...", icon: ScanLine },
  { key: "lab_tests", label: "Se solicitaron análisis de laboratorio", placeholder: "Tipo de análisis (biometría, química sanguínea, etc.)...", icon: FlaskConical },
  { key: "specialist_referral", label: "Se refirió a otro especialista", placeholder: "Especialidad y motivo de referencia...", icon: UserRoundPlus },
  { key: "hospitalization", label: "Se envió a hospitalización", placeholder: "Hospital, motivo y urgencia...", icon: Building2 },
] as const;

type ToggleKey = typeof TOGGLE_FIELDS[number]["key"];

type PendingAppointment = PostConsultationFormProps["appointment"];

function initials(name: string | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** Cuánto lleva pendiente la consulta: "Hoy", "Ayer", "Hace 3 días". */
function pendingFor(iso: string) {
  const days = differenceInCalendarDays(new Date(), parseISO(iso));
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  return `Hace ${days} días`;
}

export default function PorCompletar() {
  const { doctorId } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const { data: appointments, isLoading } = useQuery({
    queryKey: ["por-completar", doctorId],
    queryFn: async () => {
      if (!doctorId) return [];
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("appointments")
        .select("id, start_at, end_at, status, symptoms, doctor_notes, patients(full_name, phone), post_consultation_forms(id)")
        .eq("doctor_id", doctorId)
        .is("doctor_notes", null)
        .or(`status.eq.completed,and(status.eq.confirmed,end_at.lt.${nowIso})`)
        .order("start_at", { ascending: false });

      if (error) throw error;
      // Una consulta enviada sin observaciones conserva doctor_notes en null:
      // si ya tiene formulario, no se vuelve a pedir (evita formularios duplicados).
      return (data ?? []).filter((a) => !a.post_consultation_forms?.length);
    },
    enabled: !!doctorId,
  });

  const list = (appointments ?? []) as PendingAppointment[];
  // Si la consulta elegida ya se envió (o aún no hay elección), se muestra la primera.
  const selected = list.find((a) => a.id === selectedId) ?? list[0] ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    // En pantallas angostas el formulario queda debajo de la lista: llevarlo a la vista.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Por completar"
        description="Consultas que ya pasaron y necesitan tus notas post-consulta. Con ellas FindMed da seguimiento al paciente."
        actions={
          list.length > 0 ? (
            <SoftBadge tone="warning" dot>
              {list.length === 1 ? "1 consulta pendiente" : `${list.length} consultas pendientes`}
            </SoftBadge>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="divide-y overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-10 w-10 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </Card>
          <Skeleton className="h-[420px] w-full rounded-lg" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Todo al día"
          description="No tienes consultas pendientes de notas post-consulta."
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="overflow-hidden lg:sticky lg:top-20">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Consultas sin notas</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>
            </div>
            <ul className="divide-y lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto">
              {list.map((appt) => {
                const start = parseISO(appt.start_at);
                const active = appt.id === selected?.id;
                return (
                  <li key={appt.id}>
                    <button
                      type="button"
                      onClick={() => select(appt.id)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none",
                        active ? "bg-primary/5" : "hover:bg-accent/40 focus-visible:bg-accent/40",
                      )}
                    >
                      {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />}
                      <div className={cn("flex w-10 shrink-0 flex-col items-center rounded-md border py-1", active ? "border-primary/30 bg-background" : "bg-muted/50")}>
                        <span className="text-[10px] font-medium uppercase leading-none text-muted-foreground">{format(start, "MMM", { locale: es })}</span>
                        <span className="text-base font-semibold leading-tight text-foreground">{format(start, "d")}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={cn("truncate text-sm font-medium", active ? "text-primary" : "text-foreground")}>
                            {appt.patients?.full_name ?? "Paciente desconocido"}
                          </p>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{pendingFor(appt.start_at)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{format(start, "EEEE · HH:mm", { locale: es })}</p>
                        {appt.symptoms && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{appt.symptoms}</p>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div ref={formRef} className="min-w-0 scroll-mt-20">
            {/* Todos los formularios quedan montados para no perder lo escrito al cambiar de consulta. */}
            {list.map((appt) => (
              <div key={appt.id} className={appt.id === selected?.id ? "block" : "hidden"}>
                <PostConsultationForm
                  appointment={appt}
                  doctorId={doctorId!}
                  onSaved={() => {
                    queryClient.invalidateQueries({ queryKey: ["por-completar", doctorId] });
                    queryClient.invalidateQueries({ queryKey: ["doctor-to-complete-count", doctorId] });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface PostConsultationFormProps {
  appointment: {
    id: string;
    start_at: string;
    end_at: string;
    status: string;
    symptoms: string | null;
    doctor_notes: string | null;
    patients: { full_name: string; phone: string } | null;
  };
  doctorId: string;
  onSaved: () => void;
}

function PostConsultationForm({ appointment, doctorId, onSaved }: PostConsultationFormProps) {
  const [observations, setObservations] = useState("");
  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>({
    prescribed_medications: false,
    imaging_studies: false,
    lab_tests: false,
    specialist_referral: false,
    hospitalization: false,
  });
  const [fields, setFields] = useState<Record<ToggleKey, string>>({
    prescribed_medications: "",
    imaging_studies: "",
    lab_tests: "",
    specialist_referral: "",
    hospitalization: "",
  });
  // Obligatorio: el médico confirma la sugerencia o elige otro (null = aún no elige).
  const [managementType, setManagementType] = useState<ManagementType | null>(null);
  const suggested = suggestManagementType({
    imaging_studies: toggles.imaging_studies,
    lab_tests: toggles.lab_tests,
    hospitalization: toggles.hospitalization,
  });

  const start = parseISO(appointment.start_at);
  const patient = appointment.patients as { full_name: string; phone: string } | null;

  const handleToggle = (key: ToggleKey, checked: boolean) => {
    setToggles((prev) => ({ ...prev, [key]: checked }));
    if (!checked) {
      setFields((prev) => ({ ...prev, [key]: "" }));
    }
  };

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!managementType) throw new Error("Elige el tipo de manejo antes de enviar.");
      // Build form data
      const formData: Record<string, string | null> = {
        observations: observations.trim() || null,
      };
      for (const f of TOGGLE_FIELDS) {
        // Un interruptor encendido sin detalle también cuenta: el equipo debe saber que se indicó.
        formData[f.key] = toggles[f.key] ? (fields[f.key].trim() || "Sí, sin detalle.") : null;
      }

      // Insert post consultation form
      const { error: formError } = await supabase
        .from("post_consultation_forms")
        .insert({
          appointment_id: appointment.id,
          doctor_id: doctorId,
          observations: formData.observations,
          prescribed_medications: formData.prescribed_medications,
          imaging_studies: formData.imaging_studies,
          lab_tests: formData.lab_tests,
          specialist_referral: formData.specialist_referral,
          hospitalization: formData.hospitalization,
          management_type: managementType,
        });
      if (formError) throw formError;

      // Update appointment status
      const { error: apptError } = await supabase
        .from("appointments")
        .update({
          doctor_notes: formData.observations,
          doctor_notes_updated_at: new Date().toISOString(),
          status: "completed",
        })
        .eq("id", appointment.id);
      if (apptError) throw apptError;

      // Get doctor name for notification
      const { data: doctorData } = await supabase
        .from("doctors")
        .select("full_name")
        .eq("id", doctorId)
        .single();

      // Insert admin notification
      await supabase.from("notifications").insert({
        doctor_id: doctorId,
        appointment_id: appointment.id,
        recipient_role: "admin",
        type: "postconsultation_submitted",
        title: "Formulario post-consulta enviado",
        // El nombre ya trae el título ("Dra. Mariana…"): no anteponer "Dr.".
        body: `${doctorData?.full_name ?? "El doctor"} envió formulario post-consulta para ${patient?.full_name ?? "Paciente"} (${formatMx(start, "d MMM yyyy", { locale: es })})`,
      });

      // Dispatch webhook
      try {
        await supabase.functions.invoke("dispatch-webhook", {
          body: {
            event_type: "postconsultation.submitted",
            payload: {
              appointment_id: appointment.id,
              patient_name: patient?.full_name,
              patient_phone: patient?.phone,
              doctor_name: doctorData?.full_name,
              start_at: appointment.start_at,
              end_at: appointment.end_at,
              symptoms: appointment.symptoms,
              observations: formData.observations,
              prescribed_medications: formData.prescribed_medications,
              imaging_studies: formData.imaging_studies,
              lab_tests: formData.lab_tests,
              specialist_referral: formData.specialist_referral,
              hospitalization: formData.hospitalization,
              management_type: managementType,
            },
          },
        });
      } catch (e) {
        console.error("Webhook dispatch error:", e);
      }
    },
    onSuccess: () => {
      toast({ title: "Formulario enviado", description: "FindMed inicia el seguimiento según el tipo de manejo." });
      onSaved();
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const activeCount = TOGGLE_FIELDS.filter((f) => toggles[f.key]).length;
  const idPrefix = `pc-${appointment.id}`;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 space-y-0 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {initials(patient?.full_name)}
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate text-sm font-semibold">{patient?.full_name ?? "Paciente desconocido"}</CardTitle>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {format(start, "EEEE d 'de' MMMM yyyy · HH:mm", { locale: es })}
              </span>
              {patient?.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {patient.phone}
                </span>
              )}
            </div>
          </div>
        </div>
        <SoftBadge tone="warning" dot className="self-start sm:self-center">Sin notas</SoftBadge>
      </CardHeader>

      <div className="space-y-5 p-4">
        {appointment.symptoms && (
          <div className="rounded-md border bg-muted/40 px-3 py-2.5">
            <p className="text-xs font-medium text-muted-foreground">Motivo de consulta</p>
            <p className="mt-0.5 text-sm text-foreground">{appointment.symptoms}</p>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-2">
          {/* Observations */}
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-observations`} className="text-sm font-semibold">
              Observaciones de la consulta
            </Label>
            <p className="text-xs text-muted-foreground">Diagnóstico, indicaciones y lo que FindMed debe saber para el seguimiento.</p>
            <Textarea
              id={`${idPrefix}-observations`}
              placeholder="Escribe las observaciones principales de esta consulta…"
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              rows={8}
              className="resize-none text-sm"
            />
          </div>

          {/* Toggle fields */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Acciones realizadas</p>
              {activeCount > 0 && <span className="text-xs text-muted-foreground">{activeCount} seleccionada{activeCount > 1 ? "s" : ""}</span>}
            </div>
            <p className="text-xs text-muted-foreground">Activa lo que indicaste al paciente y agrega el detalle.</p>
            <div className="divide-y rounded-lg border">
              {TOGGLE_FIELDS.map((field) => {
                const Icon = field.icon;
                const on = toggles[field.key];
                const toggleId = `${idPrefix}-toggle-${field.key}`;
                return (
                  <div key={field.key} className={cn("px-3 py-2.5 transition-colors", on && "bg-primary/[0.03]")}>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor={toggleId} className="flex min-w-0 cursor-pointer items-center gap-2.5 text-sm font-normal text-foreground">
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                            on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        {field.label}
                      </Label>
                      <Switch
                        id={toggleId}
                        checked={on}
                        onCheckedChange={(checked) => handleToggle(field.key, checked)}
                      />
                    </div>
                    {on && (
                      <Textarea
                        aria-label={field.label}
                        placeholder={field.placeholder}
                        value={fields[field.key]}
                        onChange={(e) =>
                          setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        rows={2}
                        autoFocus
                        className="mt-2.5 resize-none bg-background text-sm animate-in fade-in-0 slide-in-from-top-1"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Tipo de manejo (obligatorio): define el seguimiento que inicia FindMed. */}
        <section className="space-y-2" aria-labelledby={`${idPrefix}-mt-title`}>
          <div>
            <p id={`${idPrefix}-mt-title`} className="text-sm font-semibold text-foreground">
              Tipo de manejo <span className="text-destructive" aria-hidden>*</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Te sugerimos uno según lo que activaste arriba; confírmalo o elige otro. Con esto FindMed inicia el seguimiento que corresponde.
            </p>
          </div>
          <RadioGroup
            value={managementType ?? ""}
            onValueChange={(v) => isManagementType(v) && setManagementType(v)}
            aria-labelledby={`${idPrefix}-mt-title`}
            aria-required
            className="grid gap-2 sm:grid-cols-2"
          >
            {MANAGEMENT_TYPES.map((t) => {
              const info = MANAGEMENT_TYPE_INFO[t];
              const optionId = `${idPrefix}-mt-${t}`;
              const checked = managementType === t;
              return (
                <Label
                  key={t}
                  htmlFor={optionId}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal leading-normal transition-colors",
                    checked
                      ? t === "urgente"
                        ? "border-destructive/50 bg-destructive/5"
                        : "border-primary/50 bg-primary/5"
                      : "hover:bg-accent/40",
                  )}
                >
                  <RadioGroupItem id={optionId} value={t} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                      {info.label}
                      {t === suggested && <SoftBadge tone="info">Sugerido</SoftBadge>}
                    </span>
                    <span className="block text-xs text-muted-foreground">{info.description}</span>
                  </span>
                </Label>
              );
            })}
          </RadioGroup>
          {managementType && managementType !== suggested && managementType !== "urgente" && (
            <p className="text-xs text-muted-foreground">
              Elegiste un manejo distinto a la sugerencia ({MANAGEMENT_TYPE_INFO[suggested].short}); se respetará tu elección.
            </p>
          )}
        </section>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className={cn("text-xs", managementType ? "text-muted-foreground" : "text-warning")}>
          {managementType
            ? "Al enviar, la consulta queda completada y FindMed inicia el seguimiento según el tipo de manejo."
            : "Elige el tipo de manejo para poder enviar el formulario."}
        </p>
        <Button
          size="sm"
          onClick={() => submitMut.mutate()}
          disabled={submitMut.isPending || !managementType}
          className="gap-1.5 self-end sm:self-auto"
        >
          <Send className="h-4 w-4" />
          {submitMut.isPending ? "Enviando…" : "Enviar formulario"}
        </Button>
      </div>
    </Card>
  );
}
