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
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Plus,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { getSpecialtyColor } from "@/lib/specialty-colors";
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
import ExternalEventDetailDialog, {
  type ExternalEvent,
} from "@/components/admin/ExternalEventDetailDialog";
import CreateAppointmentDialog from "@/components/admin/CreateAppointmentDialog";

const START_HOUR = 7;
const END_HOUR = 21;
const HOUR_HEIGHT = 36;
const TOTAL_HOURS = END_HOUR - START_HOUR;

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
}

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

// --- Combobox (unchanged) ---

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
              <CommandItem value="all" onSelect={() => { onChange("all"); setOpen(false); }}>
                <Check className={cn("mr-2 h-3 w-3", value === "all" ? "opacity-100" : "opacity-0")} />
                {allLabel}
              </CommandItem>
              {options.map((opt) => (
                <CommandItem key={opt.id} value={opt.name} onSelect={() => { onChange(opt.id); setOpen(false); }}>
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
          id, start_at, end_at, status, symptoms, office_id, google_event_id, outlook_event_id,
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
        title: a.patients?.full_name ?? "Paciente desconocido",
        patientName: a.patients?.full_name ?? "Paciente desconocido",
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
          officeId: (e as any).office_id ?? null,
          officeName: (e as any).office_name ?? null,
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
          officeId: (e as any).office_id ?? null,
          officeName: (e as any).office_name ?? null,
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

  // Auto-scroll to current CDMX hour on first mount.
  useEffect(() => {
    const now = new Date();
    const h = getMexicoHours(now);
    if (scrollRef.current && h >= START_HOUR && h <= END_HOUR) {
      scrollRef.current.scrollTop = Math.max(0, (h - START_HOUR - 1) * HOUR_HEIGHT);
    }
  }, []);

  const goToPrev = () => setWeekStart((w) => subWeeks(w, 1));
  const goToNext = () => setWeekStart((w) => addWeeks(w, 1));
  const goToToday = () => setWeekStart(getMexicoWeekBounds(new Date()).start);
  const monthLabel = format(toZonedTime(weekStart, MEXICO_TZ), "MMMM yyyy", { locale: es });

  const doctorOptions = (allDoctors ?? []).map((d) => ({ id: d.id, name: d.full_name }));
  const specialtyOptions = (allSpecialties ?? []).map((s) => ({ id: s.id, name: s.name }));

  const calendarSyncWarning =
    (googleEnabled && googleResp?.error === "calendar_not_synced") ||
    (outlookEnabled && outlookResp?.error === "calendar_not_synced");

  // --- Click on empty grid → open create dialog with that slot pre-filled. ---
  const handleSlotClick = (day: Date, e: React.MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const hour = START_HOUR + y / HOUR_HEIGHT;
    const snapped = Math.floor(hour * 2) / 2; // half-hour snap
    const hh = String(Math.floor(snapped)).padStart(2, "0");
    const mm = String(Math.round((snapped % 1) * 60)).padStart(2, "0");
    setCreateDate(formatMx(day, "yyyy-MM-dd"));
    setCreateTime(`${hh}:${mm}`);
    setCreateOpen(true);
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

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h1 className="text-xl font-bold text-foreground capitalize">{monthLabel}</h1>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            onClick={() => {
              setCreateDate(undefined);
              setCreateTime(undefined);
              setCreateOpen(true);
            }}
            className="h-8 w-8"
            title="Crear cita"
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

      {/* Filters + cancelled toggle */}
      <div className="flex items-center gap-2 px-1 flex-wrap">
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
        <div className="flex items-center gap-2 ml-auto">
          <Switch
            id="show-cancelled"
            checked={showCancelled}
            onCheckedChange={setShowCancelled}
          />
          <Label htmlFor="show-cancelled" className="text-xs cursor-pointer">
            Mostrar canceladas
          </Label>
        </div>
      </div>

      {/* Vista general legend */}
      {filterDoctor === "all" && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Vista general:</span>{" "}
          mostrando citas de la plataforma. Filtra un doctor para ver su calendario completo (Google/Outlook).
        </div>
      )}

      {/* Calendar-not-synced warning when filtered */}
      {calendarSyncWarning && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          El calendario externo del doctor no se pudo sincronizar (token expirado).
          Pídele que vuelva a vincularlo desde su configuración.
        </div>
      )}

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
        {weekDays.map((day) => {
          const dayIsToday = isSameMexicoDay(day, currentTime);
          return (
            <div key={day.toISOString()} className="flex flex-col items-center py-1">
              <span className="text-[10px] uppercase text-muted-foreground">
                {format(toZonedTime(day, MEXICO_TZ), "EEE", { locale: es })}
              </span>
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                  dayIsToday ? "bg-primary text-primary-foreground" : "text-foreground"
                }`}
              >
                {formatMx(day, "d")}
              </span>
            </div>
          );
        })}
      </div>

      {/* Grid */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="grid grid-cols-[3rem_repeat(7,1fr)]" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
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
                  onClick={(e) => handleSlotClick(day, e)}
                >
                  {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                    <div
                      key={i}
                      className="absolute inset-x-0 border-t border-border/50"
                      style={{ top: i * HOUR_HEIGHT }}
                    />
                  ))}

                  {dayIsToday && (() => {
                    const h = getMexicoHours(currentTime);
                    const m = getMexicoMinutes(currentTime);
                    if (h < START_HOUR || h >= END_HOUR) return null;
                    const lineTop = ((h - START_HOUR) * 60 + m) / 60 * HOUR_HEIGHT;
                    return (
                      <div className="absolute inset-x-0 z-30 pointer-events-none" style={{ top: lineTop }}>
                        <div className="relative">
                          <div className="absolute -left-[5px] -top-[4px] h-[10px] w-[10px] rounded-full bg-red-500" />
                          <div className="h-[2px] w-full bg-red-500" />
                        </div>
                      </div>
                    );
                  })()}

                  {positioned.map(({ item, col, totalCols }) => {
                    const startMin = (getMexicoHours(item.start) - START_HOUR) * 60 + getMexicoMinutes(item.start);
                    const duration = Math.max(15, differenceInMinutes(item.end, item.start));
                    const top = (startMin / 60) * HOUR_HEIGHT;
                    const height = (duration / 60) * HOUR_HEIGHT;
                    const widthPct = 100 / totalCols;
                    const leftPct = col * widthPct;
                    const isCompressed = totalCols > 1;

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
                      ? "#6B7280"
                      : item.specialtyId
                      ? getSpecialtyColor(item.specialtyId, colorMap)
                      : "#6B7280";

                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "absolute overflow-hidden rounded text-[10px] leading-tight cursor-pointer transition-shadow border-l-4 hover:ring-2 hover:ring-primary/50",
                          isCompressed ? "px-0.5 py-0" : "px-1.5 py-0.5",
                          isExternal ? "bg-muted/60 italic" : "bg-white",
                          isCancelledAppt && "opacity-50 line-through"
                        )}
                        style={{
                          top: Math.max(0, top),
                          height: Math.max(15, height),
                          left: `calc(${leftPct}% + 1px)`,
                          width: `calc(${widthPct}% - 2px)`,
                          borderLeftColor: accent,
                          color: accent,
                        }}
                        onClick={(e) => {
                          e.preventDefault(); // suppress slot-click
                          e.stopPropagation();
                          openItem(item);
                        }}
                        title={`${item.title}\n${formatMx(item.start, "HH:mm")} - ${formatMx(item.end, "HH:mm")}${item.doctorName ? `\n${item.doctorName}` : ""}`}
                      >
                        <div className="flex items-center gap-1 font-semibold truncate">
                          {item.type === "appointment" ? (
                            <span
                              className="inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
                              style={{
                                backgroundColor:
                                  item.status === "confirmed"
                                    ? "#16A34A"
                                    : item.status === "cancelled"
                                    ? "#9CA3AF"
                                    : "#EAB308",
                              }}
                            />
                          ) : (
                            <span className="inline-block text-[8px] uppercase font-bold tracking-wide opacity-70">
                              {item.type === "outlook" ? "OUT" : "GCAL"}
                            </span>
                          )}
                          <span className="truncate">{item.title}</span>
                        </div>
                        {!isCompressed && (
                          <>
                            <div className="truncate opacity-80">
                              {formatMx(item.start, "HH:mm")} - {formatMx(item.end, "HH:mm")}
                            </div>
                            {height > 30 && item.doctorName && (
                              <div className="truncate opacity-70">{item.doctorName}</div>
                            )}
                          </>
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
