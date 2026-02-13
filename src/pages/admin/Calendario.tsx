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
import { ChevronLeft, ChevronRight, CalendarDays, Check, ChevronsUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getSpecialtyColor } from "@/lib/specialty-colors";
import { cn } from "@/lib/utils";

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
    doctor_specialties: { specialty_id: string; specialties: { id: string; name: string; color: string | null } | null }[];
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

// --- Overlap logic ---

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

// --- Combobox component ---

function FilterCombobox({
  value,
  onChange,
  options,
  placeholder,
  allLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  placeholder: string;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value === "all" ? allLabel : options.find((o) => o.id === value)?.name ?? allLabel;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-8 w-52 justify-between text-xs font-normal">
          <span className="truncate">{selected}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0">
        <Command>
          <CommandInput placeholder={placeholder} className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty>Sin resultados</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="all"
                onSelect={() => { onChange("all"); setOpen(false); }}
              >
                <Check className={cn("mr-2 h-3 w-3", value === "all" ? "opacity-100" : "opacity-0")} />
                {allLabel}
              </CommandItem>
              {options.map((opt) => (
                <CommandItem
                  key={opt.id}
                  value={opt.name}
                  onSelect={() => { onChange(opt.id); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-3 w-3", value === opt.id ? "opacity-100" : "opacity-0")} />
                  {opt.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
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

  // Fetch ALL doctors and specialties for filters
  const { data: allDoctors } = useQuery({
    queryKey: ["all-doctors-for-filter"],
    queryFn: async () => {
      const { data } = await supabase.from("doctors").select("id, full_name").eq("is_active", true).order("full_name");
      return (data ?? []) as { id: string; full_name: string }[];
    },
  });

  const { data: allSpecialties } = useQuery({
    queryKey: ["all-specialties-for-filter"],
    queryFn: async () => {
      const { data } = await supabase.from("specialties").select("id, name, color").eq("is_active", true).order("name");
      return (data ?? []) as { id: string; name: string; color: string | null }[];
    },
  });

  // Build colorMap from DB specialties
  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of allSpecialties ?? []) {
      if (s.color) map[s.id] = s.color;
    }
    return map;
  }, [allSpecialties]);

  // Fetch appointments
  const { data: rawAppointments, isLoading } = useQuery({
    queryKey: ["admin-calendar-appointments", weekKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(`
          id, start_at, end_at, status, symptoms,
          patients(full_name),
          doctors(id, full_name, doctor_specialties(specialty_id, specialties(id, name, color)))
        `)
        .gte("start_at", weekStart.toISOString())
        .lte("start_at", weekEnd.toISOString())
        .in("status", ["scheduled", "confirmed", "completed", "cancelled"])
        .order("start_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AppointmentRow[];
    },
  });

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

  // Specialty legend from active specialties in current week
  const weekSpecialtyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of rawAppointments ?? []) {
      for (const ds of a.doctors?.doctor_specialties ?? []) {
        ids.add(ds.specialty_id);
      }
    }
    return [...ids];
  }, [rawAppointments]);

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

  const doctorOptions = (allDoctors ?? []).map((d) => ({ id: d.id, name: d.full_name }));
  const specialtyOptions = (allSpecialties ?? []).map((s) => ({ id: s.id, name: s.name }));

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

      {/* Filters - searchable comboboxes */}
      <div className="flex items-center gap-2 px-1 flex-wrap">
        <FilterCombobox
          value={filterDoctor}
          onChange={setFilterDoctor}
          options={doctorOptions}
          placeholder="Buscar doctor..."
          allLabel="Todos los doctores"
        />
        <FilterCombobox
          value={filterSpecialty}
          onChange={setFilterSpecialty}
          options={specialtyOptions}
          placeholder="Buscar especialidad..."
          allLabel="Todas las especialidades"
        />
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
      {weekSpecialtyIds.length > 0 && (
        <div className="flex items-center gap-2 px-1 flex-wrap">
          {weekSpecialtyIds.map((id) => {
            const color = getSpecialtyColor(id, colorMap);
            const name = (allSpecialties ?? []).find((s) => s.id === id)?.name ?? id;
            return (
              <Badge
                key={id}
                variant="outline"
                className="text-[10px] gap-1 font-normal"
                style={{ borderColor: color, color }}
              >
                <span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: color }} />
                {name}
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
                      ? getSpecialtyColor(item.specialtyId, colorMap)
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
