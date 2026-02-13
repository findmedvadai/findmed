import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, endOfDay, addDays, subDays, isToday, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Clock, User, FileText, CalendarDays, Globe } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Database } from "@/integrations/supabase/types";

type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];

const statusConfig: Record<AppointmentStatus, { label: string; className: string }> = {
  scheduled: { label: "Agendada", className: "bg-scheduled text-scheduled-foreground" },
  confirmed: { label: "Confirmada", className: "bg-confirmed text-confirmed-foreground" },
  cancelled: { label: "Cancelada", className: "bg-destructive text-destructive-foreground" },
  completed: { label: "Completada", className: "bg-muted text-muted-foreground" },
};

interface GoogleEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string | null;
  htmlLink: string;
}

export default function Agenda() {
  const { doctorId } = useAuth();
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const dateKey = format(selectedDate, "yyyy-MM-dd");

  // Local appointments
  const { data: appointments, isLoading } = useQuery({
    queryKey: ["doctor-appointments", doctorId, dateKey],
    queryFn: async () => {
      if (!doctorId) return [];
      const dayStart = startOfDay(selectedDate).toISOString();
      const dayEnd = endOfDay(selectedDate).toISOString();

      const { data, error } = await supabase
        .from("appointments")
        .select("id, start_at, end_at, status, symptoms, doctor_notes, patients(full_name, phone)")
        .eq("doctor_id", doctorId)
        .gte("start_at", dayStart)
        .lte("start_at", dayEnd)
        .order("start_at", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!doctorId,
  });

  // Google Calendar events
  const { data: googleEvents } = useQuery({
    queryKey: ["google-calendar-events", doctorId, dateKey],
    queryFn: async () => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return [];

      const timeMin = startOfDay(selectedDate).toISOString();
      const timeMax = endOfDay(selectedDate).toISOString();

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(
        `${supabaseUrl}/functions/v1/google-calendar-events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
          },
        }
      );

      if (!response.ok) return [];
      const data = await response.json();
      return (data.events || []) as GoogleEvent[];
    },
    enabled: !!doctorId,
    refetchInterval: 60_000, // Poll every 60 seconds
  });

  const goToPrev = () => setSelectedDate((d) => subDays(d, 1));
  const goToNext = () => setSelectedDate((d) => addDays(d, 1));
  const goToToday = () => setSelectedDate(new Date());

  // Merge and sort all events by start time
  const allItems = useMemo(() => {
    const localItems = (appointments || []).map((appt) => ({
      type: "appointment" as const,
      id: appt.id,
      startTime: appt.start_at,
      endTime: appt.end_at,
      data: appt,
    }));

    // Filter google events that don't already exist as appointments (by google_event_id)
    const appointmentGoogleIds = new Set((appointments || []).map((a) => a.id));
    const gcalItems = (googleEvents || [])
      .filter((e) => !appointmentGoogleIds.has(e.id))
      .map((e) => ({
        type: "google" as const,
        id: e.id,
        startTime: e.start,
        endTime: e.end,
        data: e,
      }));

    return [...localItems, ...gcalItems].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }, [appointments, googleEvents]);

  const summary = useMemo(() => {
    if (!appointments) return { total: 0, confirmed: 0, scheduled: 0 };
    return {
      total: appointments.length,
      confirmed: appointments.filter((a) => a.status === "confirmed").length,
      scheduled: appointments.filter((a) => a.status === "scheduled").length,
    };
  }, [appointments]);

  return (
    <div className="space-y-6">
      {/* Header with date navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Mi Agenda</h1>
          <p className="text-sm text-muted-foreground">
            {isToday(selectedDate)
              ? "Hoy"
              : format(selectedDate, "EEEE", { locale: es })}
            {" — "}
            {format(selectedDate, "d 'de' MMMM yyyy", { locale: es })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goToPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant={isToday(selectedDate) ? "default" : "outline"}
            size="sm"
            onClick={goToToday}
          >
            Hoy
          </Button>
          <Button variant="outline" size="icon" onClick={goToNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CalendarDays className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{summary.total}</p>
              <p className="text-xs text-muted-foreground">Citas</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="h-3 w-3 rounded-full bg-confirmed" />
            <div>
              <p className="text-2xl font-bold">{summary.confirmed}</p>
              <p className="text-xs text-muted-foreground">Confirmadas</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="h-3 w-3 rounded-full bg-scheduled" />
            <div>
              <p className="text-2xl font-bold">{summary.scheduled}</p>
              <p className="text-xs text-muted-foreground">Por confirmar</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Event list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : allItems.length > 0 ? (
        <div className="space-y-3">
          {allItems.map((item) => {
            if (item.type === "appointment") {
              const appt = item.data as typeof appointments extends (infer U)[] ? U : never;
              const start = parseISO(appt.start_at);
              const end = parseISO(appt.end_at);
              const cfg = statusConfig[appt.status as AppointmentStatus];
              const patient = appt.patients as { full_name: string; phone: string } | null;

              return (
                <Card key={appt.id} className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-start gap-4 p-4">
                    <div className="flex flex-col items-center rounded-lg bg-secondary px-3 py-2 text-center">
                      <span className="text-lg font-bold text-primary">
                        {format(start, "HH:mm")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(end, "HH:mm")}
                      </span>
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">
                            {patient?.full_name ?? "Paciente desconocido"}
                          </span>
                        </div>
                        <Badge className={cfg.className}>{cfg.label}</Badge>
                      </div>
                      {patient?.phone && (
                        <p className="text-sm text-muted-foreground">{patient.phone}</p>
                      )}
                      {appt.symptoms && (
                        <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{appt.symptoms}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            }

            // Google Calendar event
            const gcal = item.data as GoogleEvent;
            const start = parseISO(gcal.start);
            const end = parseISO(gcal.end);

            return (
              <Card key={`gcal-${gcal.id}`} className="border-primary/20 transition-shadow hover:shadow-md">
                <CardContent className="flex items-start gap-4 p-4">
                  <div className="flex flex-col items-center rounded-lg bg-primary/10 px-3 py-2 text-center">
                    <span className="text-lg font-bold text-primary">
                      {format(start, "HH:mm")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {format(end, "HH:mm")}
                    </span>
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-primary" />
                        <span className="font-medium">{gcal.summary}</span>
                      </div>
                      <Badge variant="outline" className="text-primary border-primary/30">
                        Google Calendar
                      </Badge>
                    </div>
                    {gcal.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{gcal.description}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Clock className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-lg font-medium text-muted-foreground">Sin citas</p>
            <p className="text-sm text-muted-foreground/70">
              No hay citas programadas para este día.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
