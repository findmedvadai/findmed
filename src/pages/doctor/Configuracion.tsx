// Doctor settings page ("Mi configuración"). Designed for older, less
// tech-savvy users:
//   * No collapsed accordions or tabs hiding important controls: every section
//     is on the page; a side index (desktop) jumps to each one.
//   * Clear visual hierarchy: profile → confirmation rule → offices → schedule.
//   * No raw calendar IDs or jargon.
//   * Labelled action buttons everywhere.
//
// The doctor.address column is intentionally NOT shown anywhere here — it's
// deprecated since Mejora 2; the address now lives on each office.
import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarClock, Clock, Save, UserRound } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import DoctorProfileCard from "@/components/doctor/DoctorProfileCard";
import OfficeManager from "@/components/office/OfficeManager";
import UnifiedAvailabilityEditor from "@/components/office/UnifiedAvailabilityEditor";
import { PageHeader } from "@/components/app/PageHeader";

type IconType = ComponentType<{ className?: string }>;

const SECTIONS: { id: string; label: string; icon: IconType }[] = [
  { id: "perfil", label: "Perfil", icon: UserRound },
  { id: "confirmacion", label: "Confirmación de citas", icon: CalendarClock },
  { id: "consultorios", label: "Consultorios y calendarios", icon: Building2 },
  { id: "horarios", label: "Horarios de atención", icon: Clock },
];

function Section({
  id,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: IconType;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 space-y-0.5">
          <h2 id={`${id}-title`} className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function Configuracion() {
  const { doctorId } = useAuth();
  const queryClient = useQueryClient();

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["doctor-settings", doctorId],
    queryFn: async () => {
      if (!doctorId) return null;
      const { data, error } = await supabase
        .from("doctor_schedule_settings")
        .select("*")
        .eq("doctor_id", doctorId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!doctorId,
  });

  const [minConfirmHours, setMinConfirmHours] = useState(24);
  useEffect(() => {
    if (settings) setMinConfirmHours(settings.min_confirm_hours_before);
  }, [settings]);

  const saveSettingsMut = useMutation({
    mutationFn: async () => {
      if (!doctorId) return;
      const { error } = await supabase.from("doctor_schedule_settings").upsert(
        {
          doctor_id: doctorId,
          min_confirm_hours_before: minConfirmHours,
          appointment_duration_minutes: settings?.appointment_duration_minutes ?? 30,
        },
        { onConflict: "doctor_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Configuración guardada" });
      queryClient.invalidateQueries({ queryKey: ["doctor-settings", doctorId] });
    },
    onError: () => toast({ title: "Error al guardar", variant: "destructive" }),
  });

  const confirmDirty = !!settings && minConfirmHours !== settings.min_confirm_hours_before;

  const goTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const header = (
    <PageHeader
      title="Mi configuración"
      description="Tu perfil, tus consultorios, los horarios en que atiendes y la conexión con tu calendario."
    />
  );

  if (settingsLoading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
          <div className="hidden space-y-2 lg:block">
            {SECTIONS.map((s) => <Skeleton key={s.id} className="h-8 w-full" />)}
          </div>
          <div className="space-y-6">
            <div className="grid gap-4 xl:grid-cols-2">
              <Skeleton className="h-[220px] w-full rounded-lg" />
              <Skeleton className="h-[220px] w-full rounded-lg" />
            </div>
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
        {/* Índice de secciones (escritorio) */}
        <nav aria-label="Secciones de la configuración" className="hidden lg:sticky lg:top-20 lg:block">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => goTo(s.id)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <s.icon className="h-4 w-4 shrink-0" />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-8">
          <Section id="perfil" icon={UserRound} title="Perfil" description="Tu nombre, teléfono y especialidades.">
            {doctorId && <DoctorProfileCard doctorId={doctorId} />}
          </Section>

          <Section
            id="confirmacion"
            icon={CalendarClock}
            title="Confirmación de citas"
            description="Tiempo mínimo que un paciente debe confirmar antes de la cita."
          >
            <Card>
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-hours" className="text-sm">Confirmar antes de</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="confirm-hours"
                      type="number"
                      min={1}
                      max={72}
                      className="h-9 w-24 text-sm"
                      value={minConfirmHours}
                      onChange={(e) => setMinConfirmHours(Number(e.target.value))}
                    />
                    <span className="text-sm text-muted-foreground">horas</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Si el paciente no confirma a tiempo, la cita se cancela automáticamente.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3">
                  {confirmDirty && <span className="text-xs font-medium text-warning">Cambios sin guardar</span>}
                  <Button
                    size="sm"
                    onClick={() => saveSettingsMut.mutate()}
                    disabled={saveSettingsMut.isPending}
                    className="gap-1.5"
                  >
                    <Save className="h-4 w-4" />
                    {saveSettingsMut.isPending ? "Guardando…" : "Guardar ajustes"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Section>

          <Section
            id="consultorios"
            icon={Building2}
            title="Consultorios y calendarios"
            description="Cada consultorio tiene su ubicación, calendario, color y duración de cita. No puedes tener dos consultorios activos en la misma zona."
          >
            {doctorId && <OfficeManager doctorId={doctorId} />}
          </Section>

          <Section
            id="horarios"
            icon={Clock}
            title="Horarios de atención"
            description="Define en qué días y horarios atiendes en cada consultorio. Puedes tener varios bloques el mismo día (mañana en uno y tarde en otro, por ejemplo)."
          >
            {doctorId && <UnifiedAvailabilityEditor doctorId={doctorId} />}
          </Section>
        </div>
      </div>
    </div>
  );
}
