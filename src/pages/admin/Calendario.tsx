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
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getSpecialtyColor } from "@/lib/specialty-colors";

const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_HEIGHT = 36;
const TOTAL_HOURS = END_HOUR - START_HOUR;

// --- Types ---

interface AppointmentRow {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  symptoms: string | null;
  patients: { full_name: string } | null;
  doctors: {
    id: string;
    full_name: string;
    doctor_specialties: { specialty_id: string; specialties: { id: string; name: string } | null }[];
  } | null;
}

interface CalendarAppt {
  id: string;
  start: Date;
  end: Date;
  patientName: string;
  doctorName: string;
  specialtyId: string | null;
  specialtyName: string | null;
  status: string;
  symptoms: string | null;
}

// --- Overlap logic (same as doctor Agenda) ---

function computeOverlapColumns(items: CalendarAppt[]) {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
  const result: { item: CalendarAppt; col: number; totalCols: number }[] = [];
  const groups: CalendarAppt[][] = [];
  let currentGroup: CalendarAppt[] = [];
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

// --- Component ---

export default function Calendario() {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );
  const [filterDoctor, setFilterDoctor] = useState("all");
  const [filterSpecialty, setFilterSpecialty] = useState("all");
  const [selectedAppt, setSelectedAppt] = useState<CalendarAppt | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
  const weekKey = format(weekStart, "yyyy-MM-dd");

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Fetch appointments
  const { data: rawAppointments, isLoading } = useQuery({
    queryKey: ["admin-calendar-appointments", weekKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(`
          id, start_at, end_at, status, symptoms,
          patients(full_name),
          doctors(id, full_name, doctor_specialties(specialty_id, specialties(id, name)))
        `)
        .gte("start_at", weekStart.toISOString())
        .lte("start_at", weekEnd.toISOString())
        .in("status", ["scheduled", "confirmed", "completed", "cancelled"])
        .order("start_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AppointmentRow[];
    },
  });

  // Extract unique specialties (sorted by name) for color assignment
  const { sortedSpecialtyIds, specialtyMap, doctors } = useMemo(() => {
    const specMap = new Map<string, string>(); // id -> name
    const docMap = new Map<string, string>(); // id -> name
    for (const a of rawAppointments ?? []) {
      if (a.doctors) {
        docMap.set(a.doctors.id, a.doctors.full_name);
        for (const ds of a.doctors.doctor_specialties ?? []) {
          if (ds.specialties) {
            specMap.set(ds.specialties.id, ds.specialties.name);
          }
        }
      }
    }
    const sortedEntries = [...specMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    return {
      sortedSpecialtyIds: sortedEntries.map(([id]) => id),
      specialtyMap: specMap,
      doctors: docMap,
    };
  }, [rawAppointments]);

  // Build calendar items
  const calendarItems = useMemo(() => {
    const items: CalendarAppt[] = [];
    for (const a of rawAppointments ?? []) {
      const firstSpec = a.doctors?.doctor_specialties?.[0];
      items.push({
        id: a.id,
        start: parseISO(a.start_at),
        end: parseISO(a.end_at),
        patientName: a.patients?.full_name ?? "Paciente desconocido",
        doctorName: a.doctors?.full_name ?? "Doctor",
        specialtyId: firstSpec?.specialty_id ?? null,
        specialtyName: firstSpec?.specialties?.name ?? null,
        status: a.status,
        symptoms: a.symptoms,
      });
    }
    return items;
  }, [rawAppointments]);

  // Apply filters
  const filteredItems = useMemo(() => {
    let items = calendarItems;
    if (filterDoctor !== "all") {
      items = items.filter((i) => {
        const row = rawAppointments?.find((r) => r.id === i.id);
        return row?.doctors?.id === filterDoctor;
      });
    }
    if (filterSpecialty !== "all") {
      items = items.filter((i) => i.specialtyId === filterSpecialty);
    }
    return items;
  }, [calendarItems, filterDoctor, filterSpecialty, rawAppointments]);

  // Group by day
  const itemsByDay = useMemo(() => {
    const map: Record<number, CalendarAppt[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    for (const item of filteredItems) {
      const dayIdx = weekDays.findIndex((d) => isSameDay(d, item.start));
      if (dayIdx >= 0) map[dayIdx].push(item);
    }
    return map;
  }, [filteredItems, weekDays]);

  // Summary
  const summary = useMemo(() => {
    const items = filteredItems;
    return {
      total: items.length,
      confirmed: items.filter((i) => i.status === "confirmed").length,
      scheduled: items.filter((i) => i.status === "scheduled").length,
    };
  }, [filteredItems]);

  // Auto-scroll to current hour
  useEffect(() => {
    const now = new Date();
    const h = getHours(now);
    if (scrollRef.current && h >= START_HOUR && h <= END_HOUR) {
      scrollRef.current.scrollTop = Math.max(0, (h - START_HOUR - 1) * HOUR_HEIGHT);
    }
  }, []);

  const goToPrev = () => setWeekStart((w) => subWeeks(w, 1));
  const goToNext = () => setWeekStart((w) => addWeeks(w, 1));
  const goToToday = () => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const monthLabel = format(weekStart, "MMMM yyyy", { locale: es });

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h1 className="text-xl font-bold text-foreground capitalize">{monthLabel}</h1>
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

      {/* Filters */}
      <div className="flex items-center gap-2 px-1 flex-wrap">
        <Select value={filterDoctor} onValueChange={setFilterDoctor}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="Todos los doctores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los doctores</SelectItem>
            {[...doctors.entries()].map(([id, name]) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterSpecialty} onValueChange={setFilterSpecialty}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="Todas las especialidades" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las especialidades</SelectItem>
            {sortedSpecialtyIds.map((id) => (
              <SelectItem key={id} value={id}>{specialtyMap.get(id)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      {/* Specialty legend */}
      {sortedSpecialtyIds.length > 0 && (
        <div className="flex items-center gap-2 px-1 flex-wrap">
          {sortedSpecialtyIds.map((id) => {
            const color = getSpecialtyColor(id, sortedSpecialtyIds);
            return (
              <Badge
                key={id}
                variant="outline"
                className="text-[10px] gap-1 font-normal"
                style={{ borderColor: color, color }}
              >
                <span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: color }} />
                {specialtyMap.get(id)}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Day headers */}
      <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b border-border">
        <div />
        {weekDays.map((day) => (
          <div key={day.toISOString()} className="flex flex-col items-center py-1">
            <span className="text-[10px] uppercase text-muted-foreground">
              {format(day, "EEE", { locale: es })}
            </span>
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                isToday(day) ? "bg-primary text-primary-foreground" : "text-foreground"
              }`}
            >
              {format(day, "d")}
            </span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
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
                  className={`relative border-l border-border ${isToday(day) ? "bg-primary/5" : ""}`}
                >
                  {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                    <div
                      key={i}
                      className="absolute inset-x-0 border-t border-border/50"
                      style={{ top: i * HOUR_HEIGHT }}
                    />
                  ))}

                  {positioned.map(({ item, col, totalCols }) => {
                    const startMin = (getHours(item.start) - START_HOUR) * 60 + getMinutes(item.start);
                    const duration = Math.max(15, differenceInMinutes(item.end, item.start));
                    const top = (startMin / 60) * HOUR_HEIGHT;
                    const height = (duration / 60) * HOUR_HEIGHT;
                    const widthPct = 100 / totalCols;
                    const leftPct = col * widthPct;

                    const specColor = item.specialtyId
                      ? getSpecialtyColor(item.specialtyId, sortedSpecialtyIds)
                      : "#6B7280";

                    const isReduced = item.status === "cancelled" || item.status === "completed";

                    return (
                      <div
                        key={item.id}
                        className={`absolute overflow-hidden rounded px-1.5 py-0.5 text-[10px] leading-tight cursor-pointer hover:ring-2 hover:ring-primary/50 transition-shadow bg-white border-l-4 ${isReduced ? "opacity-50" : ""}`}
                        style={{
                          top: Math.max(0, top),
                          height: Math.max(15, height),
                          left: `calc(${leftPct}% + 1px)`,
                          width: `calc(${widthPct}% - 2px)`,
                          borderLeftColor: specColor,
                          color: specColor,
                        }}
                        onClick={() => setSelectedAppt(item)}
                        title={`${item.patientName}\n${format(item.start, "HH:mm")} - ${format(item.end, "HH:mm")}\n${item.doctorName}`}
                      >
                        <div className="flex items-center gap-1 font-semibold truncate">
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor:
                                item.status === "confirmed" ? "#16A34A" : "#EAB308",
                            }}
                          />
                          <span className="truncate">{item.patientName}</span>
                        </div>
                        <div className="truncate opacity-80">
                          {format(item.start, "HH:mm")} - {format(item.end, "HH:mm")}
                        </div>
                        {height > 30 && (
                          <div className="truncate opacity-70">{item.doctorName}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!selectedAppt} onOpenChange={(open) => !open && setSelectedAppt(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Detalle de cita</DialogTitle>
            <DialogDescription>Información de la cita seleccionada</DialogDescription>
          </DialogHeader>
          {selectedAppt && (
            <div className="space-y-3 text-sm">
              <div>
                <span className="font-medium text-muted-foreground">Paciente:</span>{" "}
                {selectedAppt.patientName}
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Doctor:</span>{" "}
                {selectedAppt.doctorName}
              </div>
              {selectedAppt.specialtyName && (
                <div>
                  <span className="font-medium text-muted-foreground">Especialidad:</span>{" "}
                  {selectedAppt.specialtyName}
                </div>
              )}
              <div>
                <span className="font-medium text-muted-foreground">Fecha:</span>{" "}
                {format(selectedAppt.start, "EEEE d 'de' MMMM, yyyy", { locale: es })}
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Horario:</span>{" "}
                {format(selectedAppt.start, "HH:mm")} - {format(selectedAppt.end, "HH:mm")}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-muted-foreground">Estado:</span>
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    backgroundColor:
                      selectedAppt.status === "confirmed" ? "#16A34A" : "#EAB308",
                  }}
                />
                <span className="capitalize">{selectedAppt.status === "scheduled" ? "Por confirmar" : selectedAppt.status === "confirmed" ? "Confirmada" : selectedAppt.status}</span>
              </div>
              {selectedAppt.symptoms && (
                <div>
                  <span className="font-medium text-muted-foreground">Síntomas:</span>{" "}
                  {selectedAppt.symptoms}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
