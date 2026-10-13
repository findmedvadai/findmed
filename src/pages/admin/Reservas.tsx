import { useState, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarX2, ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { PageHeader } from "@/components/app/PageHeader";
import { FilterBar, SearchInput } from "@/components/app/FilterBar";
import { EmptyState } from "@/components/app/EmptyState";
import { AppointmentStatusBadge, SoftBadge } from "@/components/app/StatusBadge";
import { APPOINTMENT_STATUS } from "@/lib/appointment-status";
import { formatMx, getMexicoWeekBounds, isSameMexicoDay } from "@/lib/timezone";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

const CANCEL_REASON_LABELS: Record<string, string> = {
  patient: "Por paciente",
  doctor: "Por doctor",
  no_confirmation: "Sin confirmación",
  admin: "Por el equipo",
};

const DATE_FILTERS: Record<string, string> = {
  all: "Cualquier fecha",
  today: "Hoy",
  week: "Esta semana",
  upcoming: "Próximas",
  past: "Pasadas",
};

// En estas vistas la cita más cercana va primero.
const ASCENDING_DATE_FILTERS = new Set(["today", "week", "upcoming"]);

interface AppointmentRow {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  symptoms: string | null;
  doctor_notes: string | null;
  cancel_reason: string | null;
  patients: { full_name: string; phone: string } | null;
  doctors: {
    id: string;
    full_name: string;
    city_id: string | null;
    zone_id: string | null;
    doctor_specialties: {
      specialty_id: string;
      specialties: { id: string; name: string } | null;
    }[];
  } | null;
}

interface CityRow {
  id: string;
  name: string;
}

interface ZoneRow {
  id: string;
  name: string;
  city_id: string;
}

const triggerClass = "h-9 min-w-[140px] flex-1 text-sm sm:w-[170px] sm:flex-none";

function DetailField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-0.5", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** embedded: se muestra dentro de otro módulo, sin título propio. */
export default function Reservas({ embedded = false }: { embedded?: boolean } = {}) {
  const [page, setPage] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDoctor, setFilterDoctor] = useState("all");
  const [filterDate, setFilterDate] = useState("all");
  const [filterSpecialty, setFilterSpecialty] = useState("all");
  const [filterCity, setFilterCity] = useState("all");
  const [filterZone, setFilterZone] = useState("all");
  const [selectedAppt, setSelectedAppt] = useState<AppointmentRow | null>(null);

  const { data: rawAppointments, isLoading } = useQuery({
    queryKey: ["admin-reservas-appointments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(`
          id, start_at, end_at, status, symptoms, doctor_notes, cancel_reason,
          patients(full_name, phone),
          doctors(id, full_name, city_id, zone_id, doctor_specialties(specialty_id, specialties(id, name)))
        `)
        .in("status", ["scheduled", "confirmed", "completed", "cancelled"])
        .order("start_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AppointmentRow[];
    },
  });

  const { data: cities } = useQuery({
    queryKey: ["admin-cities"],
    queryFn: async () => {
      const { data } = await supabase.from("cities").select("id, name").eq("is_active", true);
      return (data ?? []) as CityRow[];
    },
  });

  const { data: zones } = useQuery({
    queryKey: ["admin-zones"],
    queryFn: async () => {
      const { data } = await supabase.from("zones").select("id, name, city_id").eq("is_active", true);
      return (data ?? []) as ZoneRow[];
    },
  });

  const cityMap = useMemo(() => new Map((cities ?? []).map((c) => [c.id, c.name])), [cities]);
  const zoneMap = useMemo(() => new Map((zones ?? []).map((z) => [z.id, z.name])), [zones]);

  const { doctorsList, specialtiesList } = useMemo(() => {
    const docMap = new Map<string, string>();
    const specMap = new Map<string, string>();
    for (const a of rawAppointments ?? []) {
      if (a.doctors) {
        docMap.set(a.doctors.id, a.doctors.full_name);
        for (const ds of a.doctors.doctor_specialties ?? []) {
          if (ds.specialties) specMap.set(ds.specialties.id, ds.specialties.name);
        }
      }
    }
    return {
      doctorsList: [...docMap.entries()].sort((a, b) => a[1].localeCompare(b[1])),
      specialtiesList: [...specMap.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    };
  }, [rawAppointments]);

  const filtered = useMemo(() => {
    let items = rawAppointments ?? [];
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      items = items.filter(
        (a) =>
          a.patients?.full_name?.toLowerCase().includes(q) ||
          a.patients?.phone?.includes(q) ||
          a.doctors?.full_name?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== "all") items = items.filter((a) => a.status === filterStatus);
    if (filterDoctor !== "all") items = items.filter((a) => a.doctors?.id === filterDoctor);
    if (filterSpecialty !== "all")
      items = items.filter((a) =>
        a.doctors?.doctor_specialties?.some((ds) => ds.specialty_id === filterSpecialty)
      );
    if (filterCity !== "all") items = items.filter((a) => a.doctors?.city_id === filterCity);
    if (filterZone !== "all") items = items.filter((a) => a.doctors?.zone_id === filterZone);
    if (filterDate !== "all") {
      const now = new Date();
      const week = getMexicoWeekBounds(now);
      items = items.filter((a) => {
        const start = parseISO(a.start_at);
        if (filterDate === "today") return isSameMexicoDay(start, now);
        if (filterDate === "week") return start >= week.start && start <= week.end;
        if (filterDate === "upcoming") return start >= now;
        if (filterDate === "past") return start < now;
        return true;
      });
      if (ASCENDING_DATE_FILTERS.has(filterDate)) {
        items = [...items].sort((a, b) => a.start_at.localeCompare(b.start_at));
      }
    }
    return items;
  }, [rawAppointments, searchText, filterStatus, filterDoctor, filterSpecialty, filterCity, filterZone, filterDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const resetPage = () => setPage(0);

  const extraFilterCount = [filterSpecialty, filterCity, filterZone].filter((v) => v !== "all").length;
  const hasActiveFilters =
    searchText || filterStatus !== "all" || filterDoctor !== "all" || filterDate !== "all" || extraFilterCount > 0;

  const clearFilters = () => {
    setSearchText("");
    setFilterStatus("all");
    setFilterDoctor("all");
    setFilterDate("all");
    setFilterSpecialty("all");
    setFilterCity("all");
    setFilterZone("all");
    setPage(0);
  };

  function getSpecialty(a: AppointmentRow) {
    return a.doctors?.doctor_specialties?.[0]?.specialties?.name ?? "—";
  }

  function getLocation(a: AppointmentRow) {
    const zone = a.doctors?.zone_id ? zoneMap.get(a.doctors.zone_id) : null;
    const city = a.doctors?.city_id ? cityMap.get(a.doctors.city_id) : null;
    return { zone: zone ?? null, city: city ?? null };
  }

  const rangeStart = filtered.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {!embedded && <PageHeader title="Reservas" description="Todas las citas con búsqueda y filtros." />}

      <FilterBar>
        <SearchInput
          value={searchText}
          onChange={(v) => { setSearchText(v); resetPage(); }}
          placeholder="Buscar paciente, teléfono o doctor…"
        />
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); resetPage(); }}>
          <SelectTrigger className={triggerClass} aria-label="Estado"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(APPOINTMENT_STATUS).map(([value, s]) => (
              <SelectItem key={value} value={value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterDoctor} onValueChange={(v) => { setFilterDoctor(v); resetPage(); }}>
          <SelectTrigger className={cn(triggerClass, "sm:w-[200px]")} aria-label="Doctor"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los doctores</SelectItem>
            {doctorsList.map(([id, name]) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterDate} onValueChange={(v) => { setFilterDate(v); resetPage(); }}>
          <SelectTrigger className={triggerClass} aria-label="Fecha"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(DATE_FILTERS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("gap-1.5", extraFilterCount > 0 && "border-primary/40 bg-primary/5")}>
              <SlidersHorizontal className="h-4 w-4" />
              Más filtros
              {extraFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {extraFilterCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3 p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Más filtros</p>
              <p className="text-xs text-muted-foreground">Por especialidad y ubicación del doctor.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Especialidad</Label>
              <Select value={filterSpecialty} onValueChange={(v) => { setFilterSpecialty(v); resetPage(); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las especialidades</SelectItem>
                  {specialtiesList.map(([id, name]) => (
                    <SelectItem key={id} value={id}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Ciudad</Label>
              <Select value={filterCity} onValueChange={(v) => { setFilterCity(v); setFilterZone("all"); resetPage(); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las ciudades</SelectItem>
                  {(cities ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Zona</Label>
              <Select value={filterZone} onValueChange={(v) => { setFilterZone(v); resetPage(); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las zonas</SelectItem>
                  {(zones ?? [])
                    .filter((z) => filterCity === "all" || z.city_id === filterCity)
                    .map((z) => (
                      <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
            <X className="h-3.5 w-3.5" /> Limpiar
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {isLoading ? "Cargando…" : `${filtered.length} ${filtered.length === 1 ? "cita" : "citas"}`}
        </span>
      </FilterBar>

      {!isLoading && pageItems.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title={hasActiveFilters ? "Sin citas con estos filtros" : "Aún no hay citas"}
          description={
            hasActiveFilters
              ? "Prueba con otra búsqueda o quita algunos filtros."
              : "Aquí aparecen las citas que agendan los pacientes, los doctores y el equipo."
          }
          action={
            hasActiveFilters ? (
              <Button size="sm" variant="outline" onClick={clearFilters}>Limpiar filtros</Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="h-9 text-xs">Paciente</TableHead>
                <TableHead className="h-9 text-xs">Fecha</TableHead>
                <TableHead className="hidden h-9 text-xs md:table-cell">Doctor</TableHead>
                <TableHead className="hidden h-9 text-xs xl:table-cell">Ubicación</TableHead>
                <TableHead className="hidden h-9 text-xs lg:table-cell">Síntomas</TableHead>
                <TableHead className="hidden h-9 text-xs md:table-cell">Estado</TableHead>
                <TableHead className="h-9 w-8 text-xs"><span className="sr-only">Abrir</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="hover:bg-transparent">
                      <TableCell className="py-2.5">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="mt-1.5 h-3 w-24" />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="mt-1.5 h-3 w-20" />
                      </TableCell>
                      <TableCell className="hidden py-2.5 md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell className="hidden py-2.5 xl:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden py-2.5 lg:table-cell"><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell className="hidden py-2.5 md:table-cell"><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                      <TableCell className="py-2.5" />
                    </TableRow>
                  ))
                : pageItems.map((a) => {
                    const start = parseISO(a.start_at);
                    const { zone, city } = getLocation(a);
                    return (
                      <TableRow
                        key={a.id}
                        tabIndex={0}
                        className="group cursor-pointer focus-visible:bg-accent/60 focus-visible:outline-none"
                        onClick={() => setSelectedAppt(a)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedAppt(a);
                          }
                        }}
                      >
                        <TableCell className="py-2.5">
                          <p className="font-medium text-foreground">{a.patients?.full_name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">{a.patients?.phone ?? "Sin teléfono"}</p>
                          <AppointmentStatusBadge status={a.status} className="mt-1.5 md:hidden" />
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2.5">
                          <p className="capitalize text-foreground">{formatMx(start, "EEE d MMM yyyy", { locale: es })}</p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {formatMx(start, "HH:mm")} – {formatMx(parseISO(a.end_at), "HH:mm")}
                          </p>
                        </TableCell>
                        <TableCell className="hidden py-2.5 md:table-cell">
                          <p className="text-foreground">{a.doctors?.full_name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">{getSpecialty(a)}</p>
                        </TableCell>
                        <TableCell className="hidden py-2.5 xl:table-cell">
                          <p className="text-foreground">{zone ?? "—"}</p>
                          {city && <p className="text-xs text-muted-foreground">{city}</p>}
                        </TableCell>
                        <TableCell className="hidden max-w-[240px] py-2.5 lg:table-cell">
                          <p className="truncate text-muted-foreground">{a.symptoms || "—"}</p>
                        </TableCell>
                        <TableCell className="hidden py-2.5 md:table-cell">
                          <AppointmentStatusBadge status={a.status} />
                          {a.cancel_reason && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {CANCEL_REASON_LABELS[a.cancel_reason] ?? a.cancel_reason}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 pl-0 text-right">
                          <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>

          {!isLoading && filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
              <span className="text-xs text-muted-foreground">
                {rangeStart}–{rangeEnd} de {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <span className="mr-1 text-xs text-muted-foreground">
                  Página {page + 1} de {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Página anterior"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Página siguiente"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selectedAppt} onOpenChange={(open) => !open && setSelectedAppt(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {selectedAppt && (
            <>
              <DialogHeader className="space-y-2 pr-6">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="text-base">{selectedAppt.patients?.full_name ?? "Detalle de cita"}</DialogTitle>
                  <AppointmentStatusBadge status={selectedAppt.status} />
                  {selectedAppt.cancel_reason && (
                    <SoftBadge tone="neutral">
                      {CANCEL_REASON_LABELS[selectedAppt.cancel_reason] ?? selectedAppt.cancel_reason}
                    </SoftBadge>
                  )}
                </div>
                <DialogDescription className="first-letter:uppercase">
                  {formatMx(parseISO(selectedAppt.start_at), "EEEE d 'de' MMMM 'de' yyyy", { locale: es })} ·{" "}
                  {formatMx(parseISO(selectedAppt.start_at), "HH:mm")} – {formatMx(parseISO(selectedAppt.end_at), "HH:mm")}
                </DialogDescription>
              </DialogHeader>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
                <DetailField label="Teléfono">{selectedAppt.patients?.phone ?? "—"}</DetailField>
                <DetailField label="Doctor">{selectedAppt.doctors?.full_name ?? "—"}</DetailField>
                <DetailField label="Especialidad">{getSpecialty(selectedAppt)}</DetailField>
                <DetailField label="Zona">{getLocation(selectedAppt).zone ?? "—"}</DetailField>
                <DetailField label="Ciudad">{getLocation(selectedAppt).city ?? "—"}</DetailField>
              </dl>

              <div className="grid gap-4 sm:grid-cols-2">
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-foreground">Síntomas</h3>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {selectedAppt.symptoms || "Sin síntomas registrados."}
                  </p>
                </section>
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-foreground">Notas del doctor</h3>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {selectedAppt.doctor_notes || "Sin notas."}
                  </p>
                </section>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
