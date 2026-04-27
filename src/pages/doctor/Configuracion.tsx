import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
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

export default function Configuracion() {
  const { doctorId } = useAuth();
  const queryClient = useQueryClient();

  // Doctor-level settings (timezone, min_confirm_hours_before). The
  // appointment_duration_minutes field is now per-office, so we don't expose
  // it here.
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
          // appointment_duration_minutes is deprecated at this scope but
          // kept in the upsert payload as the row's existing value, since
          // it's NOT NULL in schema.
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
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground">Configuración</h1>

      {doctorId && <DoctorProfileCard doctorId={doctorId} />}

      <Card>
        <CardHeader>
          <CardTitle>Ajustes generales</CardTitle>
          <CardDescription>
            Tiempo mínimo que un paciente debe confirmar antes de la cita. La duración de cita se
            configura por consultorio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Confirmar antes de (horas)</Label>
              <Input
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
          <CardTitle>Mis consultorios</CardTitle>
          <CardDescription>
            Crea uno o varios consultorios. Cada uno tiene su propia ubicación, calendario, duración
            de cita y disponibilidad semanal. No puedes tener dos consultorios activos en la misma
            zona.
          </CardDescription>
        </CardHeader>
        <CardContent>{doctorId && <OfficeManager doctorId={doctorId} />}</CardContent>
      </Card>
    </div>
  );
}
