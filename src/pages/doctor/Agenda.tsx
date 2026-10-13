import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { addWeeks, subWeeks, addDays, parseISO, differenceInMinutes } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarPlus, ChevronLeft, ChevronRight, Info, Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/app/PageHeader";
import type { Tone } from "@/components/app/StatCard";
import type { Database } from "@/integrations/supabase/types";
import AppointmentDetailDialog, { type CalendarItem } from "@/components/doctor/AppointmentDetailDialog";
import DayHeaderPopover from "@/components/doctor/DayHeaderPopover";
import CreateEventDialog from "@/components/doctor/CreateEventDialog";
import DoctorCreateAppointmentDialog from "@/components/doctor/DoctorCreateAppointmentDialog";
import { APPOINTMENT_STATUS } from "@/lib/appointment-status";
import {
  formatMx,
  getMexicoHours,
  getMexicoMinutes,
  getMexicoWeekBounds,
  isSameMexicoDay,
} from "@/lib/timezone";
import { cn } from "@/lib/utils";

type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];

interface GoogleEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string | null;
  htmlLink: string;
  office_id?: string;
  office_name?: string;
}

const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_HEIGHT = 48;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const GRID_COLS = "grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]";

// Fondo y borde de cada cita según el tono de su estado (mismo color que en
// el resto de los módulos). Los eventos del calendario externo van aparte.
const TONE_CHIP: Record<Tone, string> = {
  warning: "bg-warning/10 border-l-warning",
  success: "bg-success/10 border-l-success",
  info: "bg-info/10 border-l-info",
  danger: "bg-destructive/10 border-l-destructive",
  neutral: "bg-muted border-l-muted-foreground/40",
};
const TONE_DOT: Record<Tone, string> = {
  warning: "bg-warning",
  success: "bg-success",
  info: "bg-info",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground",
};
const toneOf = (status?: string): Tone => APPOINTMENT_STATUS[status ?? ""]?.tone ?? "neutral";

function computeOverlapColumns(items: CalendarItem[]) {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
  const result: { item: CalendarItem; col: number; totalCols: number }[] = [];
  const groups: CalendarItem[][] = [];
  let currentGroup: CalendarItem[] = [];
  let groupEnd = 0;

  for (const item of sorted) {
    if (currentGroup.length === 0 || item.start.getTime() < groupEnd) {
      currentGroup.push(item);
      groupEnd = Math.max(groupEnd, item.end.getTime());
    } else {
      groups.push(currentGroup);
      currentGroup = [item];
      groupEnd = item.end.getTime();
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  for (const group of groups) {
    const totalCols = group.length;
    group.forEach((item, col) => {
      result.push({ item, col, totalCols });
    });
  }

  return result;
}

/** Navegación de semana: anterior · Hoy · siguiente, en un solo grupo. */
function WeekNav({ onPrev, onToday, onNext, isCurrent }: { onPrev: () => void; onToday: () => void; onNext: () => void; isCurrent: boolean }) {
  return (
    <div className="inline-flex items-center rounded-md border bg-background p-px shadow-sm">
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onPrev} aria-label="Semana anterior">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="ghost" className={cn("h-8 px-3", isCurrent && "text-primary")} onClick={onToday}>
        Hoy
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onNext} aria-label="Semana siguiente">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function SummaryStat({ value, label, dot }: { value: number; label: string; dot?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {dot && <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />}
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      {label}
    </span>
  );
}

export default function Agenda() {
  const { doctorId } = useAuth();
  // weekStart is the absolute UTC instant for Sunday 00:00 CDMX of the visible week.
  const [weekStart, setWeekStart] = useState(() => getMexicoWeekBounds(new Date()).start);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null);
  // Cita (real appointment) dialog.
  const [createApptOpen, setCreateApptOpen] = useState(false);
  const [createApptDate, setCreateApptDate] = useState<string | undefined>();
  const [createApptTime, setCreateApptTime] = useState<string | undefined>();
  // Personal event dialog (external calendar).
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [createEventDate, setCreateEventDate] = useState<Date | undefined>();
  const [createEventHour, setCreateEventHour] = useState<number | undefined>();
  // "all" = aggregate across every office of the doctor.
  const [officeFilter, setOfficeFilter] = useState<string>("all");

  const { data: offices = [] } = useQuery({
    queryKey: ["doctor-offices-for-agenda", doctorId],
    queryFn: async () => {
      if (!doctorId) return [] as { id: string; name: string; display_color: string }[];
      const { data } = await supabase
        .from("doctor_offices")
        .select("id, name, display_color")
        .eq("doctor_id", doctorId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true });
      return (data ?? []) as { id: string; name: string; display_color: string }[];
    },
    enabled: !!doctorId,
  });

  // Color lookup by office_id for visual distinction in the calendar grid.
  const officeColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of offices) map.set(o.id, o.display_color);
    return map;
  }, [offices]);

  // Current time for red line indicator
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const weekEnd = useMemo(() => getMexicoWeekBounds(weekStart).end, [weekStart]);
  const weekKey = formatMx(weekStart, "yyyy-MM-dd");

  // Each day is the CDMX-midnight instant for that calendar day in the visible week.
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const { data: appointments, isLoading: loadingAppointments } = useQuery({
    queryKey: ["doctor-appointments", doctorId, weekKey, officeFilter],
    queryFn: async () => {
      if (!doctorId) return [];
      let q = supabase
        .from("appointments")
        .select(
          "id, office_id, google_event_id, outlook_event_id, start_at, end_at, status, symptoms, doctor_notes, patients(full_name, phone), doctor_offices(name)"
        )
        .eq("doctor_id", doctorId)
        .gte("start_at", weekStart.toISOString())
        .lte("start_at", weekEnd.toISOString())
        .in("status", ["scheduled", "confirmed", "completed"])
        .order("start_at", { ascending: true });
      if (officeFilter !== "all") q = q.eq("office_id", officeFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!doctorId,
  });

  const buildExternalUrl = (provider: "google" | "outlook") => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const params = new URLSearchParams({
      timeMin: weekStart.toISOString(),
      timeMax: weekEnd.toISOString(),
    });
    if (officeFilter !== "all") params.set("office_id", officeFilter);
    return `${supabaseUrl}/functions/v1/${provider}-calendar-events?${params.toString()}`;
  };

  const { data: googleEvents } = useQuery({
    queryKey: ["google-calendar-events", doctorId, weekKey, officeFilter],
    queryFn: async () => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return [];
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(buildExternalUrl("google"), {
        headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.events || []) as GoogleEvent[];
    },
    enabled: !!doctorId,
    refetchInterval: 60_000,
  });

  const { data: outlookEvents } = useQuery({
    queryKey: ["outlook-calendar-events", doctorId, weekKey, officeFilter],
    queryFn: async () => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return [];
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(buildExternalUrl("outlook"), {
        headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.events || []) as GoogleEvent[];
    },
    enabled: !!doctorId,
    refetchInterval: 60_000,
  });

  const calendarItems = useMemo(() => {
    const items: CalendarItem[] = [];
    for (const appt of appointments || []) {
      const patient = appt.patients as { full_name: string; phone: string } | null;
      const officeRow = appt.doctor_offices as { name: string } | null;
      items.push({
        id: appt.id,
        type: "appointment",
        start: parseISO(appt.start_at),
        end: parseISO(appt.end_at),
        title: patient?.full_name ?? "Paciente desconocido",
        status: appt.status as AppointmentStatus,
        phone: patient?.phone ?? undefined,
        symptoms: appt.symptoms ?? undefined,
        doctorNotes: appt.doctor_notes ?? undefined,
        officeId: appt.office_id ?? undefined,
        officeName: officeRow?.name,
      });
    }
    const googleEventIds = new Set(
      (appointments || []).map((a) => a.google_event_id).filter(Boolean)
    );
    for (const e of googleEvents || []) {
      if (googleEventIds.has(e.id)) continue;
      items.push({
        id: e.id,
        type: "google",
        start: parseISO(e.start),
        end: parseISO(e.end),
        title: e.summary,
        htmlLink: e.htmlLink,
        description: e.description ?? undefined,
        officeId: e.office_id,
        officeName: e.office_name,
      });
    }
    const outlookEventIds = new Set(
      (appointments || []).map((a) => a.outlook_event_id).filter(Boolean)
    );
    for (const e of outlookEvents || []) {
      if (outlookEventIds.has(e.id)) continue;
      items.push({
        id: e.id,
        type: "outlook",
        start: parseISO(e.start),
        end: parseISO(e.end),
        title: e.summary,
        htmlLink: e.htmlLink,
        description: e.description ?? undefined,
        officeId: e.office_id,
        officeName: e.office_name,
      });
    }
    return items;
  }, [appointments, googleEvents, outlookEvents]);

  const itemsByDay = useMemo(() => {
    const map: Record<number, CalendarItem[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    for (const item of calendarItems) {
      const dayIdx = weekDays.findIndex((d) => isSameMexicoDay(d, item.start));
      if (dayIdx >= 0) map[dayIdx].push(item);
    }
    return map;
  }, [calendarItems, weekDays]);

  useEffect(() => {
    const now = new Date();
    const currentHour = getMexicoHours(now);
    if (scrollRef.current && currentHour >= START_HOUR && currentHour <= END_HOUR) {
      scrollRef.current.scrollTop = Math.max(0, (currentHour - START_HOUR - 1) * HOUR_HEIGHT);
    }
  }, []);

  const goToPrev = () => setWeekStart((w) => subWeeks(w, 1));
  const goToNext = () => setWeekStart((w) => addWeeks(w, 1));
  const goToToday = () => setWeekStart(getMexicoWeekBounds(new Date()).start);

  const monthLabel = formatMx(weekStart, "MMMM yyyy", { locale: es });
  const rangeLabel =
    formatMx(weekStart, "M") === formatMx(weekEnd, "M")
      ? `${formatMx(weekStart, "d")} – ${formatMx(weekEnd, "d 'de' MMMM", { locale: es })}`
      : `${formatMx(weekStart, "d 'de' MMM", { locale: es })} – ${formatMx(weekEnd, "d 'de' MMM", { locale: es })}`;
  const isCurrentWeek = isSameMexicoDay(weekStart, getMexicoWeekBounds(new Date()).start);

  const summary = useMemo(() => {
    if (!appointments) return { total: 0, confirmed: 0, scheduled: 0 };
    const nowUtc = currentTime;
    const pending = appointments.filter((a) => parseISO(a.end_at) > nowUtc);
    return {
      total: pending.length,
      confirmed: pending.filter((a) => a.status === "confirmed").length,
      scheduled: pending.filter((a) => a.status === "scheduled").length,
    };
  }, [appointments, currentTime]);

  // Current time line position
  const currentTimeTop = useMemo(() => {
    const h = getMexicoHours(currentTime);
    const m = getMexicoMinutes(currentTime);
    if (h < START_HOUR || h >= END_HOUR) return null;
    return ((h - START_HOUR) * 60 + m) / 60 * HOUR_HEIGHT;
  }, [currentTime]);

  const openCreateAppointment = () => {
    setCreateApptDate(undefined);
    setCreateApptTime(undefined);
    setCreateApptOpen(true);
  };
  const openCreateEvent = () => {
    setCreateEventDate(undefined);
    setCreateEventHour(undefined);
    setCreateEventOpen(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agenda"
        description="Tus citas de FindMed y los eventos de tu calendario conectado."
        actions={
          <>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={openCreateEvent}>
              <CalendarPlus className="h-4 w-4" /> Evento personal
            </Button>
            <Button size="sm" className="gap-1.5" onClick={openCreateAppointment}>
              <Plus className="h-4 w-4" /> Nueva cita
            </Button>
          </>
        }
      />

      {/* Toolbar: semana + consultorio */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <WeekNav onPrev={goToPrev} onToday={goToToday} onNext={goToNext} isCurrent={isCurrentWeek} />
        <div className="min-w-0">
          <p className="text-sm font-semibold capitalize leading-tight text-foreground">{monthLabel}</p>
          <p className="text-xs text-muted-foreground">{rangeLabel}</p>
        </div>
        {offices.length > 1 && (
          <Select value={officeFilter} onValueChange={setOfficeFilter}>
            <SelectTrigger className="h-9 w-full text-sm sm:ml-auto sm:w-[220px]" aria-label="Consultorio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los consultorios</SelectItem>
              {offices.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: o.display_color }} aria-hidden />
                    {o.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Card className="relative overflow-hidden">
        {/* Resumen de la semana */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5">
          <SummaryStat value={summary.total} label={summary.total === 1 ? "cita pendiente" : "citas pendientes"} />
          <SummaryStat value={summary.confirmed} label={summary.confirmed === 1 ? "confirmada" : "confirmadas"} dot="bg-success" />
          <SummaryStat value={summary.scheduled} label="por confirmar" dot="bg-warning" />
          <span className="flex w-full items-center gap-1.5 text-xs text-muted-foreground md:ml-auto md:w-auto">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Haz clic en un horario para crear una cita, o en un día para bloquearlo.
          </span>
        </div>

        {/* Semana */}
        <div ref={scrollRef} className="max-h-[min(70vh,680px)] overflow-auto">
          <div className="min-w-[720px]">
            <div className={cn("sticky top-0 z-40 grid border-b bg-card", GRID_COLS)}>
              <div className="sticky left-0 z-10 bg-card" />
              {weekDays.map((day) => {
                const dayIsToday = isSameMexicoDay(day, currentTime);
                return (
                  <DayHeaderPopover key={day.toISOString()} day={day} doctorId={doctorId ?? ""}>
                    <button
                      type="button"
                      title="Bloquear o desbloquear este día"
                      aria-label={`Opciones del ${formatMx(day, "EEEE d 'de' MMMM", { locale: es })}`}
                      className="flex flex-col items-center gap-0.5 border-l py-2 transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
                    >
                      <span className={cn("text-[11px] font-medium uppercase", dayIsToday ? "text-primary" : "text-muted-foreground")}>
                        {formatMx(day, "EEE", { locale: es })}
                      </span>
                      <span
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                          dayIsToday ? "bg-primary text-primary-foreground" : "text-foreground",
                        )}
                      >
                        {formatMx(day, "d")}
                      </span>
                    </button>
                  </DayHeaderPopover>
                );
              })}
            </div>

            <div
              ref={gridRef}
              className={cn("grid", GRID_COLS)}
              style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}
            >
              {/* Time labels */}
              <div className="sticky left-0 z-[35] bg-card">
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={i}
                    className="absolute right-2 text-[10px] tabular-nums text-muted-foreground"
                    style={{ top: i * HOUR_HEIGHT + 3 }}
                  >
                    {String(START_HOUR + i).padStart(2, "0")}:00
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {weekDays.map((day, dayIdx) => {
                const dayItems = itemsByDay[dayIdx] || [];
                const positioned = computeOverlapColumns(dayItems);
                const dayIsToday = isSameMexicoDay(day, currentTime);

                return (
                  <div
                    key={day.toISOString()}
                    className={cn("relative cursor-pointer border-l", dayIsToday && "bg-primary/[0.03]")}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const y = e.clientY - rect.top;
                      const hour = START_HOUR + y / HOUR_HEIGHT;
                      const snappedHour = Math.floor(hour * 2) / 2;
                      const h = Math.floor(snappedHour);
                      const m = Math.round((snappedHour % 1) * 60);
                      const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                      setCreateApptDate(formatMx(day, "yyyy-MM-dd"));
                      setCreateApptTime(timeStr);
                      setCreateApptOpen(true);
                    }}
                  >
                    {/* Hour lines */}
                    {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                      <div key={i}>
                        <div className="absolute inset-x-0 border-t" style={{ top: i * HOUR_HEIGHT }} />
                        <div className="absolute inset-x-0 border-t border-dashed border-border/60" style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
                      </div>
                    ))}

                    {/* Current time line */}
                    {dayIsToday && currentTimeTop !== null && (
                      <div
                        className="pointer-events-none absolute inset-x-0 z-30"
                        style={{ top: currentTimeTop }}
                      >
                        <div className="relative">
                          <div className="absolute -left-[4px] -top-[3px] h-2 w-2 rounded-full bg-destructive" />
                          <div className="h-px w-full bg-destructive" />
                        </div>
                      </div>
                    )}

                    {/* Events */}
                    {positioned.map(({ item, col, totalCols }) => {
                      const startMinutes =
                        (getMexicoHours(item.start) - START_HOUR) * 60 + getMexicoMinutes(item.start);
                      const duration = Math.max(15, differenceInMinutes(item.end, item.start));
                      const top = (startMinutes / 60) * HOUR_HEIGHT;
                      const height = Math.max(18, (duration / 60) * HOUR_HEIGHT);
                      const widthPercent = 100 / totalCols;
                      const leftPercent = col * widthPercent;
                      const isExternal = item.type === "google" || item.type === "outlook";
                      const isShort = height < 34;
                      const isCompressed = totalCols > 1;
                      const tone = toneOf(item.status);
                      const time = `${formatMx(item.start, "HH:mm")} – ${formatMx(item.end, "HH:mm")}`;

                      // Office color is shown as the left border of the chip —
                      // gives the doctor a quick visual cue per office while the
                      // fill keeps the status color.
                      const officeColorVal = item.officeId ? officeColor.get(item.officeId) : null;
                      return (
                        <button
                          type="button"
                          key={item.id}
                          className={cn(
                            "absolute overflow-hidden rounded-md border-l-[3px] text-left leading-tight text-foreground shadow-sm transition-shadow hover:z-20 hover:shadow-md focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isShort ? "px-1.5 py-0.5" : "px-1.5 py-1",
                            isExternal ? "border border-primary/20 border-l-primary/60 bg-primary/[0.06]" : TONE_CHIP[tone],
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedItem(item);
                          }}
                          style={{
                            top: Math.max(0, top),
                            height,
                            left: `calc(${leftPercent}% + 2px)`,
                            width: `calc(${widthPercent}% - 4px)`,
                            ...(officeColorVal && { borderLeftColor: officeColorVal }),
                          }}
                          title={`${item.title}\n${time}${item.officeName ? `\n${item.officeName}` : ""}${item.symptoms ? `\n${item.symptoms}` : ""}`}
                        >
                          <span className="flex items-center gap-1 text-[11px] font-semibold">
                            {isExternal ? (
                              <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                                {item.type === "outlook" ? "OUT" : "GCAL"}
                              </span>
                            ) : (
                              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden />
                            )}
                            {isShort && !isCompressed && (
                              <span className="shrink-0 font-medium tabular-nums text-muted-foreground">{formatMx(item.start, "HH:mm")}</span>
                            )}
                            <span className="truncate">{item.title}</span>
                          </span>
                          {!isShort && !isCompressed && (
                            <span className="mt-0.5 block truncate text-[10px] tabular-nums text-muted-foreground">{time}</span>
                          )}
                          {!isCompressed && height > 52 && item.officeName && offices.length > 1 && (
                            <span className="block truncate text-[10px] text-muted-foreground">{item.officeName}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {loadingAppointments && (
          <div className="pointer-events-none absolute inset-x-0 top-[124px] z-40 flex justify-center px-4">
            <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando citas…
            </div>
          </div>
        )}

        {/* Leyenda */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          {(["scheduled", "confirmed", "completed"] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-sm", TONE_DOT[toneOf(s)])} aria-hidden />
              {APPOINTMENT_STATUS[s].label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-primary/60 bg-primary/10" aria-hidden />
            Evento de tu calendario
          </span>
          {offices.length > 1 && (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:ml-auto">
              <span className="font-medium text-foreground">Consultorios</span>
              {offices.map((o) => (
                <span key={o.id} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-[3px] rounded-full" style={{ backgroundColor: o.display_color }} aria-hidden />
                  {o.name}
                </span>
              ))}
            </span>
          )}
        </div>
      </Card>

      <AppointmentDetailDialog
        item={selectedItem}
        open={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        doctorId={doctorId ?? ""}
      />

      <DoctorCreateAppointmentDialog
        open={createApptOpen}
        onClose={() => setCreateApptOpen(false)}
        defaultOfficeId={officeFilter !== "all" ? officeFilter : undefined}
        defaultDate={createApptDate}
        defaultTime={createApptTime}
      />

      <CreateEventDialog
        open={createEventOpen}
        onClose={() => setCreateEventOpen(false)}
        defaultDate={createEventDate}
        defaultStartHour={createEventHour}
        officeId={officeFilter !== "all" ? officeFilter : undefined}
      />
    </div>
  );
}
