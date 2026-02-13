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
import { Save, Calendar as CalendarIcon, Link2, Unlink, Loader2 } from "lucide-react";

const WEEKDAYS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

const DURATION_OPTIONS = [15, 20, 30, 45, 60, 90, 120];

interface WeekdaySlot {
  id?: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_enabled: boolean;
}

interface GoogleCalendar {
  id: string;
  summary: string;
  primary: boolean;
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

  const [slots, setSlots] = useState<WeekdaySlot[]>(
    WEEKDAYS.map((wd) => ({ weekday: wd.value, start_time: "09:00", end_time: "17:00", is_enabled: false }))
  );

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
  const { data: doctor, refetch: refetchDoctor } = useQuery({
    queryKey: ["doctor-profile", doctorId],
    queryFn: async () => {
      if (!doctorId) return null;
      const { data, error } = await supabase
        .from("doctors")
        .select("google_calendar_connected, google_calendar_id, google_refresh_token_ref")
        .eq("id", doctorId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!doctorId,
  });

  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [calendarList, setCalendarList] = useState<GoogleCalendar[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>("");

  // Detect "token saved but no calendar selected" state and load calendar list
  const hasTokenButNoCalendar = doctor?.google_refresh_token_ref && !doctor?.google_calendar_connected;

  useEffect(() => {
    if (hasTokenButNoCalendar && calendarList.length === 0 && !loadingCalendars) {
      fetchCalendarList();
    }
  }, [hasTokenButNoCalendar]);

  const fetchCalendarList = async () => {
    setLoadingCalendars(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");

      const res = await supabase.functions.invoke("google-calendar-list", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.error) throw res.error;
      const calendars = res.data?.calendars || [];
      setCalendarList(calendars);
      // Pre-select primary if available
      const primary = calendars.find((c: GoogleCalendar) => c.primary);
      if (primary) setSelectedCalendarId(primary.id);
      else if (calendars.length > 0) setSelectedCalendarId(calendars[0].id);
    } catch (error) {
      console.error("Error fetching calendars:", error);
      toast({ title: "Error al cargar calendarios", variant: "destructive" });
    } finally {
      setLoadingCalendars(false);
    }
  };

  const saveCalendarSelection = async () => {
    if (!doctorId || !selectedCalendarId) return;
    const { error } = await supabase
      .from("doctors")
      .update({
        google_calendar_id: selectedCalendarId,
        google_calendar_connected: true,
      })
      .eq("id", doctorId);

    if (error) {
      toast({ title: "Error al guardar calendario", variant: "destructive" });
    } else {
      toast({ title: "Calendario seleccionado" });
      setCalendarList([]);
      refetchDoctor();
    }
  };

  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");

      const res = await supabase.functions.invoke("google-calendar-auth", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.error) throw res.error;
      const { url } = res.data;
      
      const popup = window.open(url, "google-calendar-auth", "width=500,height=700,scrollbars=yes");
      
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          setConnectingGoogle(false);
          refetchDoctor();
        }
      }, 500);
    } catch (error) {
      console.error("Error connecting Google Calendar:", error);
      toast({ title: "Error al conectar Google Calendar", variant: "destructive" });
      setConnectingGoogle(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!doctorId) return;
    const { error } = await supabase
      .from("doctors")
      .update({
        google_calendar_connected: false,
        google_calendar_id: null,
        google_refresh_token_ref: null,
      })
      .eq("id", doctorId);
    if (error) {
      toast({ title: "Error al desconectar", variant: "destructive" });
    } else {
      toast({ title: "Google Calendar desconectado" });
      setCalendarList([]);
      refetchDoctor();
    }
  };

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
              <Button variant="outline" size="sm" className="gap-2" onClick={handleDisconnectGoogle}>
                <Unlink className="h-4 w-4" /> Desconectar
              </Button>
            </div>
          ) : hasTokenButNoCalendar ? (
            /* Calendar selection step */
            <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
                <p className="text-sm font-medium">Cuenta de Google vinculada — selecciona un calendario</p>
              </div>
              {loadingCalendars ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando calendarios…
                </div>
              ) : calendarList.length > 0 ? (
                <div className="space-y-3">
                  <Select value={selectedCalendarId} onValueChange={setSelectedCalendarId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un calendario" />
                    </SelectTrigger>
                    <SelectContent>
                      {calendarList.map((cal) => (
                        <SelectItem key={cal.id} value={cal.id}>
                          {cal.summary}{cal.primary ? " (Principal)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      onClick={saveCalendarSelection}
                      disabled={!selectedCalendarId}
                      className="gap-2"
                    >
                      <Save className="h-4 w-4" />
                      Usar este calendario
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDisconnectGoogle}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">No se encontraron calendarios.</p>
                  <Button variant="outline" size="sm" onClick={fetchCalendarList}>
                    Reintentar
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
              <Link2 className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Conecta tu Google Calendar para sincronizar citas automáticamente.
              </p>
              <Button
                className="gap-2 bg-cta text-cta-foreground hover:bg-cta/90"
                onClick={handleConnectGoogle}
                disabled={connectingGoogle}
              >
                {connectingGoogle ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CalendarIcon className="h-4 w-4" />
                )}
                {connectingGoogle ? "Conectando…" : "Conectar Google Calendar"}
              </Button>
              <p className="text-xs text-muted-foreground">
                La integración se activará cuando el administrador configure las credenciales de Google.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
