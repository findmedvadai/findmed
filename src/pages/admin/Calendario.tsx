import { useState, useMemo, useEffect, useRef } from "react";

import { useQuery } from "@tanstack/react-query";
import {
  format,
  addWeeks,
  subWeeks,
  addDays,
  parseISO,
  differenceInMinutes,
} from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarX2,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Info,
  Plus,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { PageHeader } from "@/components/app/PageHeader";
import { FilterBar } from "@/components/app/FilterBar";
import type { Tone } from "@/components/app/StatCard";
import { APPOINTMENT_STATUS } from "@/lib/appointment-status";
import { DEFAULT_COLOR, getSpecialtyColor } from "@/lib/specialty-colors";
import { cn } from "@/lib/utils";
import {
  MEXICO_TZ,
  formatMx,
  getMexicoHours,
  getMexicoMinutes,
  getMexicoWeekBounds,
  isSameMexicoDay,
  toUtcIso,
} from "@/lib/timezone";
import AppointmentDetailDialog from "@/components/admin/AppointmentDetailDialog";
import { appointmentPatientName } from "@/lib/patient-name";
import ExternalEventDetailDialog, {
  type ExternalEvent,
} from "@/components/admin/ExternalEventDetailDialog";
import CreateAppointmentDialog from "@/components/admin/CreateAppointmentDialog";

const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_HEIGHT = 48;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const GRID_COLS = "grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]";

// --- Types ---

type CalendarItemType = "appointment" | "google" | "outlook";

interface CalendarItem {
  id: string;
  type: CalendarItemType;
  start: Date;
  end: Date;
  title: string;
  // Appointment-only
  appointmentId?: string;
  patientName?: string;
  doctorId?: string;
  doctorName?: string;
  specialtyId?: string | null;
  specialtyName?: string | null;
  status?: string;
  symptoms?: string | null;
  // Office (both appointment and external events have one).
  officeId?: string | null;
  officeName?: string | null;
  // External-only
  description?: string | null;
  htmlLink?: string | null;
}

interface AppointmentRow {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  symptoms: string | null;
  office_id: string | null;
  google_event_id: string | null;
  outlook_event_id: string | null;
  patient_name: string | null;
  patients: { full_name: string } | null;
  doctors: {
    id: string;
    full_name: string;
    doctor_specialties: { specialty_id: string; specialties: { id: string; name: string; color: string | null } | null }[];
  } | null;
  doctor_offices: { id: string; name: string } | null;
}

interface ExternalApiEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string | null;
  htmlLink: string | null;
  office_id?: string | null;
  office_name?: string | null;
}

const STATUS_DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

const statusDot = (status?: string) => STATUS_DOT[APPOINTMENT_STATUS[status ?? ""]?.tone ?? "neutral"];

// --- Overlap layout ---

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

// --- Presentational pieces ---

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
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-9 min-w-[150px] flex-1 justify-between px-3 text-sm font-normal sm:w-[200px] sm:flex-none",
            value !== "all" && "border-primary/40 bg-primary/5",
          )}
        >
          <span className="truncate">{selected}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} className="h-9 text-sm" />
          <CommandList>
            <CommandEmpty>Sin resultados</CommandEmpty>
            <CommandGroup>
              <CommandItem value="all" onSelect={() => { onChange("all"); setOpen(false); }}>
                <Check className={cn("mr-2 h-3.5 w-3.5", value === "all" ? "opacity-100" : "opacity-0")} />
                {allLabel}
              </CommandItem>
              {options.map((opt) => (
                <CommandItem key={opt.id} value={opt.name} onSelect={() => { onChange(opt.id); setOpen(false); }}>
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === opt.id ? "opacity-100" : "opacity-0")} />
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

function GridSkeleton() {
  const blocks = [
    { day: 0, top: 1.5, h: 1 }, { day: 1, top: 3, h: 0.5 }, { day: 1, top: 6, h: 1 },
    { day: 2, top: 2, h: 0.5 }, { day: 3, top: 4.5, h: 1.5 }, { day: 4, top: 1, h: 0.5 },
    { day: 4, top: 7, h: 1 }, { day: 5, top: 3.5, h: 1 },
  ];
  return (
    <div className={cn("grid", GRID_COLS)} style={{ height: 9 * HOUR_HEIGHT }}>
      <div />
      {Array.from({ length: 7 }, (_, d) => (
        <div key={d} className="relative border-l">
          {blocks.filter((b) => b.day === d).map((b, i) => (
            <Skeleton
              key={i}
              className="absolute inset-x-1"
              style={{ top: b.top * HOUR_HEIGHT, height: b.h * HOUR_HEIGHT - 4 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// --- Component ---

/** embedded: se muestra dentro de otro módulo, sin título propio. */
export default function Calendario({ embedded = false }: { embedded?: boolean } = {}) {
  const [weekStart, setWeekStart] = useState(() => getMexicoWeekBounds(new Date()).start);
  const [filterDoctor, setFilterDoctor] = useState("all");
  const [filterOffice, setFilterOffice] = useState("all");
  const [filterSpecialty, setFilterSpecialty] = useState("all");
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [selectedExternal, setSelectedExternal] = useState<ExternalEvent | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>();
  const [createTime, setCreateTime] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoScroll = useRef(false);

  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const weekEnd = useMemo(() => getMexicoWeekBounds(weekStart).end, [weekStart]);
  const weekKey = formatMx(weekStart, "yyyy-MM-dd");
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const { data: allDoctors } = useQuery({
    queryKey: ["all-doctors-for-filter"],
    queryFn: async () => {
      const { data } = await supabase
        .from("doctors")
        .select("id, full_name, google_calendar_connected, outlook_calendar_connected")
        .eq("is_active", true)
        .eq("is_deleted", false)
        .order("full_name");
      return (data ?? []) as { id: string; full_name: string; google_calendar_connected: boolean; outlook_calendar_connected: boolean }[];
    },
  });

  const { data: allSpecialties } = useQuery({
    queryKey: ["all-specialties-for-filter"],
    queryFn: async () => {
      const { data } = await supabase
        .from("specialties")
        .select("id, name, color")
        .eq("is_active", true)
        .order("name");
      return (data ?? []) as { id: string; name: string; color: string | null }[];
    },
  });

  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of allSpecialties ?? []) {
      if (s.color) map[s.id] = s.color;
    }
    return map;
  }, [allSpecialties]);

  // Offices for the doctor sub-filter (only when a doctor is filtered).
  const filteredDoctorIdEarly = filterDoctor === "all" ? null : filterDoctor;
  const { data: doctorOfficeOptions = [] } = useQuery({
    queryKey: ["admin-calendar-offices", filteredDoctorIdEarly],
    queryFn: async () => {
      if (!filteredDoctorIdEarly) return [] as { id: string; name: string; display_color: string; google_calendar_connected: boolean; outlook_calendar_connected: boolean }[];
      const { data } = await supabase
        .from("doctor_offices")
        .select("id, name, display_color, google_calendar_connected, outlook_calendar_connected")
        .eq("doctor_id", filteredDoctorIdEarly)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true });
      return (data ?? []) as { id: string; name: string; display_color: string; google_calendar_connected: boolean; outlook_calendar_connected: boolean }[];
    },
    enabled: !!filteredDoctorIdEarly,
  });

  const officeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of doctorOfficeOptions) map.set(o.id, o.display_color);
    return map;
  }, [doctorOfficeOptions]);

  // Appointments. We always load all statuses including cancelled and filter
  // client-side via the toggle, so flipping it is instant (no refetch).
  const { data: rawAppointments, isLoading } = useQuery({
    queryKey: ["admin-calendar-appointments", weekKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(`
          id, start_at, end_at, status, symptoms, office_id, google_event_id, outlook_event_id, patient_name,
          patients(full_name),
          doctors(id, full_name, doctor_specialties(specialty_id, specialties(id, name, color))),
          doctor_offices(id, name)
        `)
        .gte("start_at", weekStart.toISOString())
        .lte("start_at", weekEnd.toISOString())
        .order("start_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AppointmentRow[];
    },
  });

  const filteredDoctorId = filterDoctor === "all" ? null : filterDoctor;
  const filteredDoctorRow = useMemo(
    () => (allDoctors ?? []).find((d) => d.id === filteredDoctorId),
    [allDoctors, filteredDoctorId]
  );

  // External calendars are only fetched when filtering by a single doctor and
  // that doctor has the relevant calendar connected on at least one office.
  // Reading from doctor_offices (not deprecated doctors.google_calendar_connected).
  const googleEnabled = !!filteredDoctorId && doctorOfficeOptions.some((o) => o.google_calendar_connected);
  const outlookEnabled = !!filteredDoctorId && doctorOfficeOptions.some((o) => o.outlook_calendar_connected);

  const { data: googleResp } = useQuery({
    queryKey: ["admin-calendar-google-events", filteredDoctorId, weekKey],
    queryFn: async () => {
      if (!filteredDoctorId) return { events: [] as ExternalApiEvent[], error: null };
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return { events: [], error: null };
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const url =
        `${supabaseUrl}/functions/v1/google-calendar-events?` +
        `timeMin=${encodeURIComponent(weekStart.toISOString())}` +
        `&timeMax=${encodeURIComponent(weekEnd.toISOString())}` +
        `&doctor_id=${encodeURIComponent(filteredDoctorId)}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, apikey: anonKey } });
      if (!resp.ok) return { events: [], error: null };
      const body = await resp.json();
      return {
        events: (body.events ?? []) as ExternalApiEvent[],
        error: body.error ?? null,
      };
    },
    enabled: googleEnabled,
    refetchInterval: 60_000,
  });

  const { data: outlookResp } = useQuery({
    queryKey: ["admin-calendar-outlook-events", filteredDoctorId, weekKey],
    queryFn: async () => {
      if (!filteredDoctorId) return { events: [] as ExternalApiEvent[], error: null };
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return { events: [], error: null };
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const url =
        `${supabaseUrl}/functions/v1/outlook-calendar-events?` +
        `timeMin=${encodeURIComponent(weekStart.toISOString())}` +
        `&timeMax=${encodeURIComponent(weekEnd.toISOString())}` +
        `&doctor_id=${encodeURIComponent(filteredDoctorId)}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, apikey: anonKey } });
      if (!resp.ok) return { events: [], error: null };
      const body = await resp.json();
      return {
        events: (body.events ?? []) as ExternalApiEvent[],
        error: body.error ?? null,
      };
    },
    enabled: outlookEnabled,
    refetchInterval: 60_000,
  });

  const calendarItems = useMemo(() => {
    const items: CalendarItem[] = [];

    // 1) Internal appointments (status filter handled below).
    for (const a of rawAppointments ?? []) {
      if (a.status === "cancelled" && !showCancelled) continue;
      const firstSpec = a.doctors?.doctor_specialties?.[0];
      items.push({
        id: `appt-${a.id}`,
        appointmentId: a.id,
        type: "appointment",
        start: parseISO(a.start_at),
        end: parseISO(a.end_at),
        title: appointmentPatientName(a, "Paciente desconocido"),
        patientName: appointmentPatientName(a, "Paciente desconocido"),
        doctorId: a.doctors?.id ?? null,
        doctorName: a.doctors?.full_name ?? "Doctor",
        specialtyId: firstSpec?.specialty_id ?? null,
        specialtyName: firstSpec?.specialties?.name ?? null,
        status: a.status,
        symptoms: a.symptoms,
        officeId: a.office_id ?? a.doctor_offices?.id ?? null,
        officeName: a.doctor_offices?.name ?? null,
      });
    }

    // 2) External events only on filtered-doctor view, deduped against
    //    appointments that already track them via *_event_id.
    if (filteredDoctorId) {
      const linkedGoogleIds = new Set(
        (rawAppointments ?? []).map((a) => a.google_event_id).filter(Boolean) as string[]
      );
      const linkedOutlookIds = new Set(
        (rawAppointments ?? []).map((a) => a.outlook_event_id).filter(Boolean) as string[]
      );

      for (const e of googleResp?.events ?? []) {
        if (linkedGoogleIds.has(e.id)) continue;
        items.push({
          id: `gcal-${e.id}`,
          type: "google",
          start: parseISO(toUtcIso(e.start)),
          end: parseISO(toUtcIso(e.end)),
          title: e.summary,
          doctorId: filteredDoctorId,
          doctorName: filteredDoctorRow?.full_name,
          description: e.description,
          htmlLink: e.htmlLink,
          officeId: e.office_id ?? null,
          officeName: e.office_name ?? null,
        });
      }
      for (const e of outlookResp?.events ?? []) {
        if (linkedOutlookIds.has(e.id)) continue;
        items.push({
          id: `ocal-${e.id}`,
          type: "outlook",
          start: parseISO(toUtcIso(e.start)),
          end: parseISO(toUtcIso(e.end)),
          title: e.summary,
          doctorId: filteredDoctorId,
          doctorName: filteredDoctorRow?.full_name,
          description: e.description,
          htmlLink: e.htmlLink,
          officeId: e.office_id ?? null,
          officeName: e.office_name ?? null,
        });
      }
    }

    return items;
  }, [rawAppointments, googleResp, outlookResp, filteredDoctorId, filteredDoctorRow, showCancelled]);

  // Apply filters (doctor + office + specialty). External events bypass
  // specialty filter (they don't carry one) but get filtered out if the user
  // picks a specialty.
  const filteredItems = useMemo(() => {
    return calendarItems.filter((i) => {
      if (filterDoctor !== "all" && i.doctorId !== filterDoctor) return false;
      if (filterOffice !== "all" && i.officeId !== filterOffice) return false;
      if (filterSpecialty !== "all") {
        if (i.type !== "appointment") return false;
        if (i.specialtyId !== filterSpecialty) return false;
      }
      return true;
    });
  }, [calendarItems, filterDoctor, filterOffice, filterSpecialty]);

  const itemsByDay = useMemo(() => {
    const map: Record<number, CalendarItem[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    for (const item of filteredItems) {
      const dayIdx = weekDays.findIndex((d) => isSameMexicoDay(d, item.start));
      if (dayIdx >= 0) map[dayIdx].push(item);
    }
    return map;
  }, [filteredItems, weekDays]);

  const summary = useMemo(() => {
    const onlyAppts = filteredItems.filter((i) => i.type === "appointment" && i.status !== "cancelled");
    return {
      total: onlyAppts.length,
      confirmed: onlyAppts.filter((i) => i.status === "confirmed").length,
      scheduled: onlyAppts.filter((i) => i.status === "scheduled").length,
    };
  }, [filteredItems]);

  const weekSpecialtyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of rawAppointments ?? []) {
      for (const ds of a.doctors?.doctor_specialties ?? []) {
        ids.add(ds.specialty_id);
      }
    }
    return [...ids];
  }, [rawAppointments]);

  // Auto-scroll to the current CDMX hour once the grid has rendered.
  useEffect(() => {
    if (isLoading || didAutoScroll.current || !scrollRef.current) return;
    didAutoScroll.current = true;
    const h = getMexicoHours(new Date());
    if (h >= START_HOUR && h <= END_HOUR) {
      scrollRef.current.scrollTop = Math.max(0, (h - START_HOUR - 1) * HOUR_HEIGHT);
    }
  }, [isLoading]);

  const goToPrev = () => setWeekStart((w) => subWeeks(w, 1));
  const goToNext = () => setWeekStart((w) => addWeeks(w, 1));
  const goToToday = () => setWeekStart(getMexicoWeekBounds(new Date()).start);
  const monthLabel = format(toZonedTime(weekStart, MEXICO_TZ), "MMMM yyyy", { locale: es });
  const rangeLabel =
    formatMx(weekStart, "M") === formatMx(weekEnd, "M")
      ? `${formatMx(weekStart, "d")} – ${formatMx(weekEnd, "d 'de' MMMM", { locale: es })}`
      : `${formatMx(weekStart, "d 'de' MMM", { locale: es })} – ${formatMx(weekEnd, "d 'de' MMM", { locale: es })}`;
  const isCurrentWeek = isSameMexicoDay(weekStart, getMexicoWeekBounds(new Date()).start);

  const doctorOptions = (allDoctors ?? []).map((d) => ({ id: d.id, name: d.full_name }));
  const specialtyOptions = (allSpecialties ?? []).map((s) => ({ id: s.id, name: s.name }));

  const calendarSyncWarning =
    (googleEnabled && googleResp?.error === "calendar_not_synced") ||
    (outlookEnabled && outlookResp?.error === "calendar_not_synced");

  const hasFilters = filterDoctor !== "all" || filterOffice !== "all" || filterSpecialty !== "all" || showCancelled;
  const clearFilters = () => {
    setFilterDoctor("all");
    setFilterOffice("all");
    setFilterSpecialty("all");
    setShowCancelled(false);
  };

  const openCreate = (date?: string, time?: string) => {
    setCreateDate(date);
    setCreateTime(time);
    setCreateOpen(true);
  };

  // --- Click on empty grid → open create dialog with that slot pre-filled. ---
  const handleSlotClick = (day: Date, e: React.MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const hour = START_HOUR + y / HOUR_HEIGHT;
    const snapped = Math.floor(hour * 2) / 2; // half-hour snap
    const hh = String(Math.floor(snapped)).padStart(2, "0");
    const mm = String(Math.round((snapped % 1) * 60)).padStart(2, "0");
    openCreate(formatMx(day, "yyyy-MM-dd"), `${hh}:${mm}`);
  };

  const openItem = (item: CalendarItem) => {
    if (item.type === "appointment" && item.appointmentId) {
      setSelectedAppointmentId(item.appointmentId);
    } else if (item.type === "google" || item.type === "outlook") {
      setSelectedExternal({
        id: item.id,
        provider: item.type,
        title: item.title,
        start: item.start,
        end: item.end,
        description: item.description ?? null,
        doctorName: item.doctorName,
        htmlLink: item.htmlLink ?? undefined,
      });
    }
  };

  const showOfficeLegend = !!filteredDoctorIdEarly && doctorOfficeOptions.length > 0;
  const currentLineTop = (() => {
    const h = getMexicoHours(currentTime);
    const m = getMexicoMinutes(currentTime);
    if (h < START_HOUR || h >= END_HOUR) return null;
    return ((h - START_HOUR) * 60 + m) / 60 * HOUR_HEIGHT;
  })();

  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader title="Calendario" description="Citas de todos los doctores por semana." />
      )}

      {/* Toolbar: semana + acción principal */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <WeekNav onPrev={goToPrev} onToday={goToToday} onNext={goToNext} isCurrent={isCurrentWeek} />
        <div className="min-w-0">
          <p className="text-sm font-semibold capitalize leading-tight text-foreground">{monthLabel}</p>
          <p className="text-xs text-muted-foreground">{rangeLabel}</p>
        </div>
        <Button size="sm" className="ml-auto gap-1.5" onClick={() => openCreate(undefined, undefined)}>
          <Plus className="h-4 w-4" /> Nueva cita
        </Button>
      </div>

      {/* Filtros */}
      <FilterBar>
        <FilterCombobox
          value={filterDoctor}
          onChange={(v) => {
            setFilterDoctor(v);
            setFilterOffice("all");
          }}
          options={doctorOptions}
          placeholder="Buscar doctor..."
          allLabel="Todos los doctores"
        />
        {filteredDoctorIdEarly && doctorOfficeOptions.length > 0 && (
          <FilterCombobox
            value={filterOffice}
            onChange={setFilterOffice}
            options={doctorOfficeOptions}
            placeholder="Buscar consultorio..."
            allLabel="Todos los consultorios"
          />
        )}
        <FilterCombobox
          value={filterSpecialty}
          onChange={setFilterSpecialty}
          options={specialtyOptions}
          placeholder="Buscar especialidad..."
          allLabel="Todas las especialidades"
        />
        <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-3">
          <Switch id="show-cancelled" checked={showCancelled} onCheckedChange={setShowCancelled} className="scale-90" />
          <Label htmlFor="show-cancelled" className="cursor-pointer text-sm font-normal">
            Canceladas
          </Label>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> Limpiar
          </Button>
        )}
      </FilterBar>

      {calendarSyncWarning && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            El calendario externo del doctor no se pudo sincronizar (token expirado). Pídele que lo vuelva a
            vincular desde su configuración.
          </p>
        </div>
      )}

      <Card className="relative overflow-hidden">
        {/* Resumen de la semana */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5">
          <SummaryStat value={summary.total} label={summary.total === 1 ? "cita" : "citas"} />
          <SummaryStat value={summary.confirmed} label={summary.confirmed === 1 ? "confirmada" : "confirmadas"} dot="bg-success" />
          <SummaryStat value={summary.scheduled} label="por confirmar" dot="bg-warning" />
          <span className="flex w-full items-center gap-1.5 text-xs text-muted-foreground md:ml-auto md:w-auto">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {filterDoctor === "all"
              ? "Vista general: solo citas de FindMed. Elige un doctor para ver también su Google/Outlook."
              : "Incluye los eventos de Google/Outlook del doctor."}
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
                  <div key={day.toISOString()} className="flex flex-col items-center gap-0.5 border-l py-2">
                    <span className={cn("text-[11px] font-medium uppercase", dayIsToday ? "text-primary" : "text-muted-foreground")}>
                      {format(toZonedTime(day, MEXICO_TZ), "EEE", { locale: es })}
                    </span>
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                        dayIsToday ? "bg-primary text-primary-foreground" : "text-foreground",
                      )}
                    >
                      {formatMx(day, "d")}
                    </span>
                  </div>
                );
              })}
            </div>

            {isLoading ? (
              <GridSkeleton />
            ) : (
              <div className={cn("relative grid", GRID_COLS)} style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
                {/* Horas */}
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

                {/* Días */}
                {weekDays.map((day, dayIdx) => {
                  const dayItems = itemsByDay[dayIdx] || [];
                  const positioned = computeOverlapColumns(dayItems);
                  const dayIsToday = isSameMexicoDay(day, currentTime);

                  return (
                    <div
                      key={day.toISOString()}
                      className={cn("relative cursor-pointer border-l", dayIsToday && "bg-primary/[0.03]")}
                      onClick={(e) => handleSlotClick(day, e)}
                    >
                      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                        <div key={i}>
                          <div className="absolute inset-x-0 border-t" style={{ top: i * HOUR_HEIGHT }} />
                          <div className="absolute inset-x-0 border-t border-dashed border-border/60" style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
                        </div>
                      ))}

                      {dayIsToday && currentLineTop !== null && (
                        <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: currentLineTop }}>
                          <div className="relative">
                            <div className="absolute -left-[4px] -top-[3px] h-2 w-2 rounded-full bg-destructive" />
                            <div className="h-px w-full bg-destructive" />
                          </div>
                        </div>
                      )}

                      {positioned.map(({ item, col, totalCols }) => {
                        const startMin = (getMexicoHours(item.start) - START_HOUR) * 60 + getMexicoMinutes(item.start);
                        const duration = Math.max(15, differenceInMinutes(item.end, item.start));
                        const top = (startMin / 60) * HOUR_HEIGHT;
                        const height = Math.max(18, (duration / 60) * HOUR_HEIGHT);
                        const widthPct = 100 / totalCols;
                        const leftPct = col * widthPct;
                        const isCompressed = totalCols > 1;
                        const isShort = height < 34;

                        const isExternal = item.type === "google" || item.type === "outlook";
                        const isCancelledAppt = item.type === "appointment" && item.status === "cancelled";

                        // When the admin filters by a specific doctor, switch the
                        // event's left-border to the office color — this makes
                        // multi-office days easy to scan. Otherwise we keep the
                        // specialty color (which is the macro filter across all
                        // doctors).
                        const officeAccent = item.officeId ? officeColorMap.get(item.officeId) : null;
                        const accent = filteredDoctorIdEarly && officeAccent
                          ? officeAccent
                          : isExternal
                          ? DEFAULT_COLOR
                          : item.specialtyId
                          ? getSpecialtyColor(item.specialtyId, colorMap)
                          : DEFAULT_COLOR;
                        const time = `${formatMx(item.start, "HH:mm")} – ${formatMx(item.end, "HH:mm")}`;

                        return (
                          <button
                            type="button"
                            key={item.id}
                            className={cn(
                              "absolute overflow-hidden rounded-md border border-l-[3px] text-left leading-tight shadow-sm transition-shadow hover:z-20 hover:shadow-md focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              isShort ? "px-1.5 py-0.5" : "px-1.5 py-1",
                              isExternal ? "bg-muted text-muted-foreground" : "bg-card text-foreground",
                              isCancelledAppt && "opacity-60",
                            )}
                            style={{
                              top: Math.max(0, top),
                              height,
                              left: `calc(${leftPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                              borderLeftColor: accent,
                              ...(!isExternal && { background: `color-mix(in srgb, ${accent} 9%, hsl(var(--card)))` }),
                            }}
                            onClick={(e) => {
                              e.preventDefault(); // suppress slot-click
                              e.stopPropagation();
                              openItem(item);
                            }}
                            title={`${item.title}\n${time}${item.doctorName ? `\n${item.doctorName}` : ""}${item.officeName ? `\n${item.officeName}` : ""}`}
                          >
                            <span className={cn("flex items-center gap-1 text-[11px] font-semibold", isCancelledAppt && "line-through")}>
                              {item.type === "appointment" ? (
                                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDot(item.status))} aria-hidden />
                              ) : (
                                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide opacity-70">
                                  {item.type === "outlook" ? "OUT" : "GCAL"}
                                </span>
                              )}
                              {isShort && !isCompressed && (
                                <span className="shrink-0 font-medium tabular-nums text-muted-foreground">{formatMx(item.start, "HH:mm")}</span>
                              )}
                              <span className="truncate">{item.title}</span>
                            </span>
                            {!isShort && !isCompressed && (
                              <span className="mt-0.5 block truncate text-[10px] tabular-nums text-muted-foreground">{time}</span>
                            )}
                            {!isCompressed && height > 52 && item.doctorName && (
                              <span className="block truncate text-[10px] text-muted-foreground">{item.doctorName}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {!isLoading && filteredItems.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-[124px] z-40 flex justify-center px-4">
            <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm">
              <CalendarX2 className="h-4 w-4 shrink-0" />
              {hasFilters ? "Sin citas con estos filtros esta semana" : "Sin citas esta semana"}
            </div>
          </div>
        )}

        {/* Leyenda */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          {showOfficeLegend ? (
            <>
              <span className="font-medium text-foreground">Consultorios</span>
              {doctorOfficeOptions.map((o) => (
                <span key={o.id} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: o.display_color }} aria-hidden />
                  {o.name}
                </span>
              ))}
            </>
          ) : weekSpecialtyIds.length > 0 ? (
            <>
              <span className="font-medium text-foreground">Especialidades</span>
              {weekSpecialtyIds.map((id) => {
                const color = getSpecialtyColor(id, colorMap);
                const name = (allSpecialties ?? []).find((s) => s.id === id)?.name ?? id;
                return (
                  <span key={id} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
                    {name}
                  </span>
                );
              })}
            </>
          ) : null}
          <span className="w-full sm:ml-auto sm:w-auto">Haz clic en un horario libre para crear una cita.</span>
        </div>
      </Card>

      {/* Detail dialogs */}
      <AppointmentDetailDialog
        appointmentId={selectedAppointmentId}
        open={!!selectedAppointmentId}
        onOpenChange={(o) => { if (!o) setSelectedAppointmentId(null); }}
        enableActions
        onAfterAction={() => setSelectedAppointmentId(null)}
      />
      <ExternalEventDetailDialog
        event={selectedExternal}
        open={!!selectedExternal}
        onClose={() => setSelectedExternal(null)}
      />

      <CreateAppointmentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultDoctorId={filteredDoctorId}
        defaultOfficeId={filterOffice !== "all" ? filterOffice : null}
        defaultDate={createDate}
        defaultTime={createTime}
      />
    </div>
  );
}
