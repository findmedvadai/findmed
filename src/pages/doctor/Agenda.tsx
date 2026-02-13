import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  addDays,
  isSameDay,
  isToday,
  parseISO,
  differenceInMinutes,
  getHours,
  getMinutes,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Database } from "@/integrations/supabase/types";

type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];

interface GoogleEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string | null;
  htmlLink: string;
}

interface CalendarItem {
  id: string;
  type: "appointment" | "google";
  start: Date;
  end: Date;
  title: string;
  status?: AppointmentStatus;
  phone?: string;
  symptoms?: string;
}

const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_HEIGHT = 60;
const TOTAL_HOURS = END_HOUR - START_HOUR;

function computeOverlapColumns(items: CalendarItem[]) {
  // Sort by start time
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
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
  const weekKey = format(weekStart, "yyyy-MM-dd");

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Local appointments for the week
  const { data: appointments, isLoading } = useQuery({
    queryKey: ["doctor-appointments", doctorId, weekKey],
    queryFn: async () => {
      if (!doctorId) return [];
      const { data, error } = await supabase
        .from("appointments")
        .select("id, start_at, end_at, status, symptoms, doctor_notes, patients(full_name, phone)")
        .eq("doctor_id", doctorId)
        .gte("start_at", weekStart.toISOString())
        .lte("start_at", weekEnd.toISOString())
        .order("start_at", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!doctorId,
  });

  // Google Calendar events for the week
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
    refetchInterval: 60_000,
  });

  // Build calendar items
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
      });
    }

    const appointmentIds = new Set((appointments || []).map((a) => a.id));
    for (const e of googleEvents || []) {
      if (appointmentIds.has(e.id)) continue;
      items.push({
        id: e.id,
        type: "google",
        start: parseISO(e.start),
        end: parseISO(e.end),
        title: e.summary,
      });
    }

    return items;
  }, [appointments, googleEvents]);

  // Group items by day index (0-6)
  const itemsByDay = useMemo(() => {
    const map: Record<number, CalendarItem[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    for (const item of calendarItems) {
      const dayIdx = weekDays.findIndex((d) => isSameDay(d, item.start));
      if (dayIdx >= 0) map[dayIdx].push(item);
    }
    return map;
  }, [calendarItems, weekDays]);

  // Auto-scroll to current hour on mount
  useEffect(() => {
    const now = new Date();
    const currentHour = getHours(now);
    if (scrollRef.current && currentHour >= START_HOUR && currentHour <= END_HOUR) {
      const scrollTop = (currentHour - START_HOUR - 1) * HOUR_HEIGHT;
      scrollRef.current.scrollTop = Math.max(0, scrollTop);
    }
  }, []);

  const goToPrev = () => setWeekStart((w) => subWeeks(w, 1));
  const goToNext = () => setWeekStart((w) => addWeeks(w, 1));
  const goToToday = () => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }));

  const monthLabel = format(weekStart, "MMMM yyyy", { locale: es });

  function getEventStyle(item: CalendarItem): string {
    if (item.type === "google") return "bg-primary/80 text-primary-foreground";
    if (item.status === "scheduled") return "bg-scheduled text-scheduled-foreground";
    if (item.status === "confirmed") return "bg-confirmed text-confirmed-foreground";
    if (item.status === "cancelled") return "bg-destructive/60 text-destructive-foreground";
    return "bg-muted text-muted-foreground";
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-foreground capitalize">{monthLabel}</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={goToPrev} className="h-8 w-8">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant={isSameDay(weekStart, startOfWeek(new Date(), { weekStartsOn: 0 })) ? "default" : "outline"}
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

      {/* Day headers */}
      <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b border-border">
        <div /> {/* spacer for time column */}
        {weekDays.map((day) => (
          <div key={day.toISOString()} className="flex flex-col items-center py-1">
            <span className="text-[10px] uppercase text-muted-foreground">
              {format(day, "EEE", { locale: es })}
            </span>
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                isToday(day)
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground"
              }`}
            >
              {format(day, "d")}
            </span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div
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

            return (
              <div
                key={day.toISOString()}
                className={`relative border-l border-border ${
                  isToday(day) ? "bg-primary/5" : ""
                }`}
              >
                {/* Hour lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={i}
                    className="absolute inset-x-0 border-t border-border/50"
                    style={{ top: i * HOUR_HEIGHT }}
                  />
                ))}

                {/* Events */}
                {positioned.map(({ item, col, totalCols }) => {
                  const startMinutes =
                    (getHours(item.start) - START_HOUR) * 60 + getMinutes(item.start);
                  const duration = Math.max(
                    15,
                    differenceInMinutes(item.end, item.start)
                  );
                  const top = (startMinutes / 60) * HOUR_HEIGHT;
                  const height = (duration / 60) * HOUR_HEIGHT;
                  const widthPercent = 100 / totalCols;
                  const leftPercent = col * widthPercent;

                  return (
                    <div
                      key={item.id}
                      className={`absolute overflow-hidden rounded px-1 py-0.5 text-[10px] leading-tight cursor-default ${getEventStyle(item)}`}
                      style={{
                        top: Math.max(0, top),
                        height: Math.max(15, height),
                        left: `calc(${leftPercent}% + 1px)`,
                        width: `calc(${widthPercent}% - 2px)`,
                      }}
                      title={`${item.title}\n${format(item.start, "HH:mm")} - ${format(item.end, "HH:mm")}${item.symptoms ? `\n${item.symptoms}` : ""}`}
                    >
                      <div className="font-semibold truncate">{item.title}</div>
                      <div className="truncate opacity-80">
                        {format(item.start, "HH:mm")} - {format(item.end, "HH:mm")}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
