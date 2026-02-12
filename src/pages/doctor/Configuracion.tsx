import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Save, Calendar as CalendarIcon, Link2, Unlink } from "lucide-react";

const WEEKDAYS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

const DURATION_OPTIONS = [15, 20, 30, 45, 60];

interface WeekdaySlot {
  id?: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_enabled: boolean;
}

export default function Configuracion() {
  const { doctorId } = useAuth();
  const queryClient = useQueryClient();

  // --- Schedule Settings ---
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

  const [duration, setDuration] = useState(30);
  const [minConfirmHours, setMinConfirmHours] = useState(24);

  useEffect(() => {
    if (settings) {
      setDuration(settings.appointment_duration_minutes);
      setMinConfirmHours(settings.min_confirm_hours_before);
    }
  }, [settings]);

  const saveSettingsMut = useMutation({
    mutationFn: async () => {
      if (!doctorId) return;
      const { error } = await supabase.from("doctor_schedule_settings").upsert(
        {
          doctor_id: doctorId,
          appointment_duration_minutes: duration,
          min_confirm_hours_before: minConfirmHours,
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

  // --- Weekly Availability ---
  const { data: availability, isLoading: availLoading } = useQuery({
    queryKey: ["doctor-availability", doctorId],
    queryFn: async () => {
      if (!doctorId) return [];
      const { data, error } = await supabase
        .from("doctor_weekly_availability")
        .select("*")
        .eq("doctor_id", doctorId)
        .order("weekday", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!doctorId,
  });

  const [slots, setSlots] = useState<WeekdaySlot[]>([]);

  useEffect(() => {
    if (availability) {
      const mapped = WEEKDAYS.map((wd) => {
        const existing = availability.find((a) => a.weekday === wd.value);
        return existing
          ? { id: existing.id, weekday: existing.weekday, start_time: existing.start_time, end_time: existing.end_time, is_enabled: existing.is_enabled }
          : { weekday: wd.value, start_time: "09:00", end_time: "17:00", is_enabled: false };
      });
      setSlots(mapped);
    }
  }, [availability]);

  const updateSlot = (weekday: number, field: keyof WeekdaySlot, value: string | boolean) => {
    setSlots((prev) =>
      prev.map((s) => (s.weekday === weekday ? { ...s, [field]: value } : s))
    );
  };

  const saveAvailabilityMut = useMutation({
    mutationFn: async () => {
      if (!doctorId) return;
      for (const slot of slots) {
        const row = {
          doctor_id: doctorId,
          weekday: slot.weekday,
          start_time: slot.start_time,
          end_time: slot.end_time,
          is_enabled: slot.is_enabled,
        };
        if (slot.id) {
          await supabase.from("doctor_weekly_availability").update(row).eq("id", slot.id);
        } else {
          await supabase.from("doctor_weekly_availability").insert(row);
        }
      }
    },
    onSuccess: () => {
      toast({ title: "Disponibilidad guardada" });
      queryClient.invalidateQueries({ queryKey: ["doctor-availability", doctorId] });
    },
    onError: () => toast({ title: "Error al guardar disponibilidad", variant: "destructive" }),
  });

  // --- Google Calendar ---
  const { data: doctor } = useQuery({
    queryKey: ["doctor-profile", doctorId],
    queryFn: async () => {
      if (!doctorId) return null;
      const { data, error } = await supabase
        .from("doctors")
        .select("google_calendar_connected, google_calendar_id")
        .eq("id", doctorId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!doctorId,
  });

  const isLoading = settingsLoading || availLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-foreground">Configuración</h1>

      {/* Schedule Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Ajustes de Citas</CardTitle>
          <CardDescription>Duración de citas y tiempo mínimo de confirmación.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Duración de cita (minutos)</Label>
              <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>{d} min</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

      {/* Weekly Availability */}
      <Card>
        <CardHeader>
          <CardTitle>Disponibilidad Semanal</CardTitle>
          <CardDescription>Define los días y horarios en que aceptas citas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {WEEKDAYS.map((wd) => {
            const slot = slots.find((s) => s.weekday === wd.value);
            if (!slot) return null;
            return (
              <div key={wd.value} className="flex items-center gap-3 rounded-lg border p-3">
                <Switch
                  checked={slot.is_enabled}
                  onCheckedChange={(v) => updateSlot(wd.value, "is_enabled", v)}
                />
                <span className="w-24 text-sm font-medium">{wd.label}</span>
                <Input
                  type="time"
                  value={slot.start_time}
                  onChange={(e) => updateSlot(wd.value, "start_time", e.target.value)}
                  disabled={!slot.is_enabled}
                  className="w-28"
                />
                <span className="text-muted-foreground">a</span>
                <Input
                  type="time"
                  value={slot.end_time}
                  onChange={(e) => updateSlot(wd.value, "end_time", e.target.value)}
                  disabled={!slot.is_enabled}
                  className="w-28"
                />
              </div>
            );
          })}
          <Button
            onClick={() => saveAvailabilityMut.mutate()}
            disabled={saveAvailabilityMut.isPending}
            className="mt-2 gap-2"
          >
            <Save className="h-4 w-4" />
            {saveAvailabilityMut.isPending ? "Guardando…" : "Guardar disponibilidad"}
          </Button>
        </CardContent>
      </Card>

      {/* Google Calendar */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Google Calendar
          </CardTitle>
          <CardDescription>
            Sincroniza tus citas con Google Calendar para verlas en tu calendario.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {doctor?.google_calendar_connected ? (
            <div className="flex items-center justify-between rounded-lg border border-confirmed/30 bg-confirmed/5 p-4">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-confirmed" />
                <div>
                  <p className="text-sm font-medium">Conectado</p>
                  {doctor.google_calendar_id && (
                    <p className="text-xs text-muted-foreground">{doctor.google_calendar_id}</p>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-2" disabled>
                <Unlink className="h-4 w-4" /> Desconectar
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
              <Link2 className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Conecta tu Google Calendar para sincronizar citas automáticamente.
              </p>
              <Button className="gap-2 bg-cta text-cta-foreground hover:bg-cta/90" disabled>
                <CalendarIcon className="h-4 w-4" /> Conectar Google Calendar
              </Button>
              <p className="text-xs text-muted-foreground">
                Requiere configuración de credenciales de Google.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
