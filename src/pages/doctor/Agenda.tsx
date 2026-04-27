import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  addDays,
  parseISO,
  differenceInMinutes,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { es } from "date-fns/locale";

const MEXICO_TZ = "America/Mexico_City";

function getMexicoHours(date: Date): number {
  return toZonedTime(date, MEXICO_TZ).getHours();
}
function getMexicoMinutes(date: Date): number {
  return toZonedTime(date, MEXICO_TZ).getMinutes();
}
function formatMexicoTime(date: Date, fmt: string): string {
  return format(toZonedTime(date, MEXICO_TZ), fmt);
}

// Compare two instants by their CDMX calendar day, regardless of the browser's TZ.
function isSameMexicoDay(a: Date, b: Date): boolean {
  return formatMexicoTime(a, "yyyy-MM-dd") === formatMexicoTime(b, "yyyy-MM-dd");
}

// Returns the CDMX week boundaries for the week containing `instant`, expressed
// as absolute UTC instants. weekStartsOn: 0 = Sunday.
function getMexicoWeekBounds(instant: Date): { start: Date; end: Date } {
  const cdmxNaive = toZonedTime(instant, MEXICO_TZ);
  const startNaive = startOfWeek(cdmxNaive, { weekStartsOn: 0 });
  const endNaive = endOfWeek(cdmxNaive, { weekStartsOn: 0 });
  return {
    start: fromZonedTime(startNaive, MEXICO_TZ),
    end: fromZonedTime(endNaive, MEXICO_TZ),
  };
}
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import AppointmentDetailDialog, { type CalendarItem } from "@/components/doctor/AppointmentDetailDialog";
import DayHeaderPopover from "@/components/doctor/DayHeaderPopover";
import CreateEventDialog from "@/components/doctor/CreateEventDialog";

type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];

interface GoogleEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string | null;
  htmlLink: string;
}

const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_HEIGHT = 36;
const TOTAL_HOURS = END_HOUR - START_HOUR;

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

export default function Agenda() {
  const { doctorId } = useAuth();
  const queryClient = useQueryClient();
  // weekStart is the absolute UTC instant for Sunday 00:00 CDMX of the visible week.
  const [weekStart, setWeekStart] = useState(() => getMexicoWeekBounds(new Date()).start);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [createEventDate, setCreateEventDate] = useState<Date | undefined>();
  const [createEventHour, setCreateEventHour] = useState<number | undefined>();

  // Current time for red line indicator
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const weekEnd = useMemo(() => getMexicoWeekBounds(weekStart).end, [weekStart]);
  const weekKey = formatMexicoTime(weekStart, "yyyy-MM-dd");

  // Each day is the CDMX-midnight instant for that calendar day in the visible week.
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const { data: appointments } = useQuery({
    queryKey: ["doctor-appointments", doctorId, weekKey],
    queryFn: async () => {
      if (!doctorId) return [];
      const { data, error } = await supabase
        .from("appointments")
        .select("id, google_event_id, outlook_event_id, start_at, end_at, status, symptoms, doctor_notes, patients(full_name, phone)")
        .eq("doctor_id", doctorId)
        .gte("start_at", weekStart.toISOString())
        .lte("start_at", weekEnd.toISOString())
        .in("status", ["scheduled", "confirmed", "completed"])
        .order("start_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!doctorId,
  });

  const { data: googleEvents } = useQuery({
    queryKey: ["google-calendar-events", doctorId, weekKey],
    queryFn: async () => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return [];
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/google-calendar-events?timeMin=${encodeURIComponent(weekStart.toISOString())}&timeMax=${encodeURIComponent(weekEnd.toISOString())}`,
        { headers: { Authorization: `Bearer ${token}`, apikey: anonKey } }
      );
      if (!response.ok) return [];
      const data = await response.json();
      return (data.events || []) as GoogleEvent[];
    },
    enabled: !!doctorId,
    refetchInterval: 60_000,
  });

  const { data: outlookEvents } = useQuery({
    queryKey: ["outlook-calendar-events", doctorId, weekKey],
    queryFn: async () => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return [];
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/outlook-calendar-events?timeMin=${encodeURIComponent(weekStart.toISOString())}&timeMax=${encodeURIComponent(weekEnd.toISOString())}`,
        { headers: { Authorization: `Bearer ${token}`, apikey: anonKey } }
      );
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
      });
    }
    // Add Outlook events. Same visual treatment as Google but tagged so the detail
    // dialog can show the right badge / route delete & edit to the right endpoint.
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

  const monthLabel = format(toZonedTime(weekStart, MEXICO_TZ), "MMMM yyyy", { locale: es });

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

  function getEventStyle(item: CalendarItem): string {
    if (item.type === "google" || item.type === "outlook")
      return "bg-primary/80 text-primary-foreground";
    if (item.status === "scheduled") return "bg-scheduled text-scheduled-foreground";
    if (item.status === "confirmed") return "bg-confirmed text-confirmed-foreground";
    return "bg-muted text-muted-foreground";
  }

  // Current time line position
  const currentTimeTop = useMemo(() => {
    const h = getMexicoHours(currentTime);
    const m = getMexicoMinutes(currentTime);
    if (h < START_HOUR || h >= END_HOUR) return null;
    return ((h - START_HOUR) * 60 + m) / 60 * HOUR_HEIGHT;
  }, [currentTime]);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-foreground capitalize">{monthLabel}</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="default"
            size="icon"
            onClick={() => {
              setCreateEventDate(undefined);
              setCreateEventHour(undefined);
              setCreateEventOpen(true);
            }}
            className="h-8 w-8"
            title="Crear evento"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={goToPrev} className="h-8 w-8">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant={isSameMexicoDay(weekStart, getMexicoWeekBounds(new Date()).start) ? "default" : "outline"}
            size="sm"
            onClick={goToToday}
            className="h-8 text-xs"
          >
            Hoy
          </Button>
          <Button variant="outline" size="icon" onClick={goToNext} className="h-8 w-8">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 px-1">
        <Card>
          <CardContent className="flex items-center gap-2 p-3">
            <CalendarDays className="h-4 w-4 text-primary" />
            <div>
              <p className="text-lg font-bold leading-none">{summary.total}</p>
              <p className="text-[10px] text-muted-foreground">Citas</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-2 p-3">
            <div className="h-2.5 w-2.5 rounded-full bg-confirmed" />
            <div>
              <p className="text-lg font-bold leading-none">{summary.confirmed}</p>
              <p className="text-[10px] text-muted-foreground">Confirmadas</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-2 p-3">
            <div className="h-2.5 w-2.5 rounded-full bg-scheduled" />
            <div>
              <p className="text-lg font-bold leading-none">{summary.scheduled}</p>
              <p className="text-[10px] text-muted-foreground">Por confirmar</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b border-border">
        <div />
        {weekDays.map((day) => {
          const dayIsToday = isSameMexicoDay(day, currentTime);
          return (
            <DayHeaderPopover key={day.toISOString()} day={day} doctorId={doctorId ?? ""}>
              <button className="flex flex-col items-center py-1 hover:bg-accent/50 rounded transition-colors cursor-pointer">
                <span className="text-[10px] uppercase text-muted-foreground">
                  {format(toZonedTime(day, MEXICO_TZ), "EEE", { locale: es })}
                </span>
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                    dayIsToday ? "bg-primary text-primary-foreground" : "text-foreground"
                  }`}
                >
                  {formatMexicoTime(day, "d")}
                </span>
              </button>
            </DayHeaderPopover>
          );
        })}
      </div>

      {/* Grid */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div
          ref={gridRef}
          className="grid grid-cols-[3rem_repeat(7,1fr)]"
          style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}
        >
          {/* Time labels */}
          <div className="relative">
            {Array.from({ length: TOTAL_HOURS }, (_, i) => (
              <div
                key={i}
                className="absolute right-2 text-[10px] text-muted-foreground"
                style={{ top: i * HOUR_HEIGHT - 6 }}
              >
                {format(new Date(2000, 0, 1, START_HOUR + i), "h a")}
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
                className={`relative border-l border-border ${dayIsToday ? "bg-primary/5" : ""}`}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const hour = START_HOUR + y / HOUR_HEIGHT;
                  const snappedHour = Math.floor(hour * 2) / 2;
                  setCreateEventDate(day);
                  setCreateEventHour(snappedHour);
                  setCreateEventOpen(true);
                }}
              >
                {/* Hour lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={i}
                    className="absolute inset-x-0 border-t border-border/50"
                    style={{ top: i * HOUR_HEIGHT }}
                  />
                ))}

                {/* Current time red line */}
                {dayIsToday && currentTimeTop !== null && (
                  <div
                    className="absolute inset-x-0 z-30 pointer-events-none"
                    style={{ top: currentTimeTop }}
                  >
                    <div className="relative">
                      <div className="absolute -left-[5px] -top-[4px] h-[10px] w-[10px] rounded-full bg-red-500" />
                      <div className="h-[2px] w-full bg-red-500" />
                    </div>
                  </div>
                )}

                {/* Events */}
                {positioned.map(({ item, col, totalCols }) => {
                  const startMinutes =
                    (getMexicoHours(item.start) - START_HOUR) * 60 + getMexicoMinutes(item.start);
                  const duration = Math.max(15, differenceInMinutes(item.end, item.start));
                  const top = (startMinutes / 60) * HOUR_HEIGHT;
                  const height = (duration / 60) * HOUR_HEIGHT;
                  const widthPercent = 100 / totalCols;
                  const leftPercent = col * widthPercent;

                  return (
                    <div
                      key={item.id}
                      className={`absolute overflow-hidden rounded px-1 py-0.5 text-[10px] leading-tight cursor-pointer hover:ring-2 hover:ring-primary/50 transition-shadow ${getEventStyle(item)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedItem(item);
                      }}
                      style={{
                        top: Math.max(0, top),
                        height: Math.max(15, height),
                        left: `calc(${leftPercent}% + 1px)`,
                        width: `calc(${widthPercent}% - 2px)`,
                      }}
                       title={`${item.title}\n${formatMexicoTime(item.start, "HH:mm")} - ${formatMexicoTime(item.end, "HH:mm")}${item.symptoms ? `\n${item.symptoms}` : ""}`}
                    >
                      <div className="font-semibold truncate">{item.title}</div>
                      <div className="truncate opacity-80">
                        {formatMexicoTime(item.start, "HH:mm")} - {formatMexicoTime(item.end, "HH:mm")}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <AppointmentDetailDialog
        item={selectedItem}
        open={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        doctorId={doctorId ?? ""}
      />

      <CreateEventDialog
        open={createEventOpen}
        onClose={() => setCreateEventOpen(false)}
        defaultDate={createEventDate}
        defaultStartHour={createEventHour}
      />
    </div>
  );
}
