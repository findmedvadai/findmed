import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Check, User, FileText, Send, Pill, ScanLine, FlaskConical, UserRoundPlus, Building2 } from "lucide-react";

const TOGGLE_FIELDS = [
  { key: "prescribed_medications", label: "Se recetaron medicamentos", placeholder: "Nombres, dosis y frecuencia...", icon: Pill },
  { key: "imaging_studies", label: "Se solicitaron estudios de imagen", placeholder: "Tipo de estudio (radiografía, ultrasonido, resonancia, etc.)...", icon: ScanLine },
  { key: "lab_tests", label: "Se solicitaron análisis de laboratorio", placeholder: "Tipo de análisis (biometría, química sanguínea, etc.)...", icon: FlaskConical },
  { key: "specialist_referral", label: "Se refirió a otro especialista", placeholder: "Especialidad y motivo de referencia...", icon: UserRoundPlus },
  { key: "hospitalization", label: "Se envió a hospitalización", placeholder: "Hospital, motivo y urgencia...", icon: Building2 },
] as const;

type ToggleKey = typeof TOGGLE_FIELDS[number]["key"];

export default function PorCompletar() {
  const { doctorId } = useAuth();
  const queryClient = useQueryClient();

  const { data: appointments, isLoading } = useQuery({
    queryKey: ["por-completar", doctorId],
    queryFn: async () => {
      if (!doctorId) return [];
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("appointments")
        .select("id, start_at, end_at, status, symptoms, doctor_notes, patients(full_name, phone)")
        .eq("doctor_id", doctorId)
        .is("doctor_notes", null)
        .or(`status.eq.completed,and(status.eq.confirmed,end_at.lt.${nowIso})`)
        .order("start_at", { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!doctorId,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Por Completar</h1>
        <p className="text-sm text-muted-foreground">
          Citas completadas que aún necesitan tu formulario post-consulta.
        </p>
      </div>

      {appointments && appointments.length > 0 ? (
        <div className="space-y-4">
          {appointments.map((appt) => (
            <PostConsultationForm
              key={appt.id}
              appointment={appt}
              doctorId={doctorId!}
              onSaved={() =>
                queryClient.invalidateQueries({ queryKey: ["por-completar", doctorId] })
              }
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Check className="mb-3 h-10 w-10 text-confirmed" />
            <p className="text-lg font-medium text-muted-foreground">Todo al día</p>
            <p className="text-sm text-muted-foreground/70">
              No hay citas pendientes de formulario post-consulta.
            </p>
          </CardContent>
        </Card>
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
      // Build form data
      const formData: Record<string, string | null> = {
        observations: observations.trim() || null,
      };
      for (const f of TOGGLE_FIELDS) {
        formData[f.key] = toggles[f.key] ? (fields[f.key].trim() || null) : null;
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
        } as any);
      if (formError) throw formError;

      // Update appointment status
      const { error: apptError } = await supabase
        .from("appointments")
        .update({
          doctor_notes: formData.observations,
          doctor_notes_updated_at: new Date().toISOString(),
          status: "completed" as any,
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
        body: `Dr. ${doctorData?.full_name ?? "Doctor"} envió formulario post-consulta para ${patient?.full_name ?? "Paciente"} (${format(start, "d MMM yyyy", { locale: es })})`,
      } as any);

      // Dispatch webhook
      try {
        await supabase.functions.invoke("dispatch-webhook", {
          body: {
            event_type: "postconsultation.submitted",
            data: {
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
            },
          },
        });
      } catch (e) {
        console.error("Webhook dispatch error:", e);
      }
    },
    onSuccess: () => {
      toast({ title: "Formulario enviado" });
      onSaved();
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">
              {patient?.full_name ?? "Paciente desconocido"}
            </CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">
            {format(start, "d MMM yyyy · HH:mm", { locale: es })}
          </Badge>
        </div>
        {appointment.symptoms && (
          <CardDescription className="flex items-start gap-1.5 mt-1">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{appointment.symptoms}</span>
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Observations */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Observaciones de la consulta</Label>
          <Textarea
            placeholder="Escribe las observaciones principales de esta consulta…"
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>

        {/* Toggle fields */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-muted-foreground">Acciones realizadas</Label>
          {TOGGLE_FIELDS.map((field) => {
            const Icon = field.icon;
            return (
              <div key={field.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm cursor-pointer" htmlFor={`toggle-${field.key}`}>
                      {field.label}
                    </Label>
                  </div>
                  <Switch
                    id={`toggle-${field.key}`}
                    checked={toggles[field.key]}
                    onCheckedChange={(checked) => handleToggle(field.key, checked)}
                  />
                </div>
                <div
                  className="overflow-hidden transition-all duration-300 ease-in-out"
                  style={{
                    maxHeight: toggles[field.key] ? "200px" : "0px",
                    opacity: toggles[field.key] ? 1 : 0,
                  }}
                >
                  <Textarea
                    placeholder={field.placeholder}
                    value={fields[field.key]}
                    onChange={(e) =>
                      setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    rows={2}
                    className="resize-none"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <Button
          onClick={() => submitMut.mutate()}
          disabled={submitMut.isPending}
          className="gap-2 w-full sm:w-auto"
        >
          <Send className="h-4 w-4" />
          {submitMut.isPending ? "Enviando…" : "Enviar formulario"}
        </Button>
      </CardContent>
    </Card>
  );
}
