// Doctor settings page. Designed for older, less tech-savvy users:
//   * No collapsed accordions hiding important controls.
//   * Clear visual hierarchy: profile → general settings → offices → schedule.
//   * No raw calendar IDs or jargon.
//   * Big, labelled action buttons everywhere.
//
// The doctor.address column is intentionally NOT shown anywhere here — it's
// deprecated since Mejora 2; the address now lives on each office.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarDays, Save, Settings as SettingsIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import DoctorProfileCard from "@/components/doctor/DoctorProfileCard";
import OfficeManager from "@/components/office/OfficeManager";
import UnifiedAvailabilityEditor from "@/components/office/UnifiedAvailabilityEditor";

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

  if (settingsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuración</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tus consultorios, horarios y conexión de calendarios.
        </p>
      </div>

      {doctorId && <DoctorProfileCard doctorId={doctorId} />}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SettingsIcon className="h-4 w-4 text-muted-foreground" />
            Ajustes generales
          </CardTitle>
          <CardDescription>
            Tiempo mínimo que un paciente debe confirmar antes de la cita.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="confirm-hours">Confirmar antes de (horas)</Label>
              <Input
                id="confirm-hours"
                type="number"
                min={1}
                max={72}
                value={minConfirmHours}
                onChange={(e) => setMinConfirmHours(Number(e.target.value))}
              />
            </div>
          </div>
          <Button
            onClick={() => saveSettingsMut.mutate()}
            disabled={saveSettingsMut.isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {saveSettingsMut.isPending ? "Guardando…" : "Guardar ajustes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            Mis consultorios
          </CardTitle>
          <CardDescription>
            Cada consultorio tiene su ubicación, calendario, color y duración de cita. No puedes
            tener dos consultorios activos en la misma zona.
          </CardDescription>
        </CardHeader>
        <CardContent>{doctorId && <OfficeManager doctorId={doctorId} />}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            Disponibilidad semanal
          </CardTitle>
          <CardDescription>
            Define en qué días y horarios atiendes en cada consultorio. Puedes tener varios bloques
            el mismo día (mañana en uno y tarde en otro, por ejemplo).
          </CardDescription>
        </CardHeader>
        <CardContent>{doctorId && <UnifiedAvailabilityEditor doctorId={doctorId} />}</CardContent>
      </Card>
    </div>
  );
}
