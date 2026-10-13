import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSpecialtyColor } from "@/lib/specialty-colors";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Building2,
  Calendar,
  CalendarCheck,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  Stethoscope,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import OfficeManager from "@/components/office/OfficeManager";
import UnifiedAvailabilityEditor from "@/components/office/UnifiedAvailabilityEditor";
import {
  extractEdgeFunctionError,
  toastFromEdgeFunctionError,
} from "@/lib/edge-function-error";
import { PageHeader } from "@/components/app/PageHeader";
import { FilterBar, SearchInput } from "@/components/app/FilterBar";
import { StatCard, type Tone } from "@/components/app/StatCard";
import { EmptyState } from "@/components/app/EmptyState";
import { SoftBadge } from "@/components/app/StatusBadge";

/* ───────── types ───────── */

interface DoctorRow {
  id: string;
  full_name: string;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  city_id: string | null;
  zone_id: string | null;
  doctor_specialties: {
    specialty_id: string;
    specialties: { id: string; name: string; color: string | null } | null;
  }[];
  cities: { name: string } | null;
  zones: { name: string } | null;
}

type DetailTab = "datos" | "consultorios" | "horarios" | "calendarios";

const DETAIL_TABS: { value: DetailTab; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { value: "datos", label: "Datos", icon: UserRound },
  { value: "consultorios", label: "Consultorios", icon: Building2 },
  { value: "horarios", label: "Horarios", icon: Clock },
  { value: "calendarios", label: "Calendarios", icon: CalendarCheck },
];

/** Resumen de configuración por doctor (solo consultorios activos). */
interface SetupSummary {
  offices: number;
  withCalendar: number;
  withAvailability: number;
}

const NO_SETUP: SetupSummary = { offices: 0, withCalendar: 0, withAvailability: 0 };

interface SetupStatus {
  tone: Tone;
  /** Etiqueta corta para la tabla (la columna da el contexto). */
  short: string;
  /** Etiqueta con contexto para la lista móvil y la ficha. */
  long: string;
  /** Sin consultorios: no aplica. */
  empty?: boolean;
}

function setupStatus(s: SetupSummary): { offices: SetupStatus; schedule: SetupStatus; calendar: SetupStatus } {
  const none = s.offices === 0;
  const offices: SetupStatus = none
    ? { tone: "warning", short: "Ninguno", long: "Sin consultorio" }
    : {
        tone: "neutral",
        short: s.offices === 1 ? "1 activo" : `${s.offices} activos`,
        long: s.offices === 1 ? "1 consultorio" : `${s.offices} consultorios`,
      };
  const missingSchedule = s.offices - s.withAvailability;
  const schedule: SetupStatus = none
    ? { tone: "neutral", short: "—", long: "", empty: true }
    : missingSchedule === 0
      ? { tone: "success", short: "Configurados", long: "Horarios configurados" }
      : s.withAvailability === 0
        ? { tone: "warning", short: "Sin horarios", long: "Sin horarios" }
        : { tone: "warning", short: `Faltan en ${missingSchedule}`, long: `Faltan horarios en ${missingSchedule}` };
  const calendar: SetupStatus = none
    ? { tone: "neutral", short: "—", long: "", empty: true }
    : s.withCalendar === s.offices
      ? { tone: "success", short: "Conectado", long: "Calendario conectado" }
      : s.withCalendar === 0
        ? { tone: "neutral", short: "Sin conectar", long: "Sin calendario" }
        : { tone: "info", short: `${s.withCalendar} de ${s.offices}`, long: `Calendario ${s.withCalendar} de ${s.offices}` };
  return { offices, schedule, calendar };
}

/* ───────── helpers ───────── */

function useCatalogs() {
  const cities = useQuery({
    queryKey: ["cities"],
    queryFn: async () => {
      const { data } = await supabase.from("cities").select("id, name").eq("is_active", true).order("name");
      return data ?? [];
    },
  });
  const zones = useQuery({
    queryKey: ["zones"],
    queryFn: async () => {
      const { data } = await supabase.from("zones").select("id, name, city_id").eq("is_active", true).order("name");
      return data ?? [];
    },
  });
  const specialties = useQuery({
    queryKey: ["specialties"],
    queryFn: async () => {
      const { data } = await supabase.from("specialties").select("id, name, color").eq("is_active", true).order("name");
      return data ?? [];
    },
  });

  // Build colorMap from DB
  const colorMap: Record<string, string> = {};
  for (const s of specialties.data ?? []) {
    if (s.color) colorMap[s.id] = s.color;
  }

  return { cities: cities.data ?? [], zones: zones.data ?? [], specialties: specialties.data ?? [], colorMap };
}

function initials(name: string) {
  const parts = name
    .replace(/^(dra?|dr)\.?\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join("") || "?").toUpperCase();
}

/** Fondo tenue a partir del color de la especialidad (dato del catálogo). */
function tint(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}1F` : undefined;
}

function locationLabel(d: DoctorRow) {
  return [d.cities?.name, d.zones?.name].filter(Boolean).join(" · ");
}

const SELECT_CLASS = "h-9 w-[calc(50%-0.25rem)] text-sm sm:w-[170px]";

/* ───────── main component ───────── */

export default function Doctores() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterSpecialty, setFilterSpecialty] = useState("all");
  const [filterCity, setFilterCity] = useState("all");
  const [filterZone, setFilterZone] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSetup, setFilterSetup] = useState("all");

  const [detail, setDetail] = useState<{ id: string; tab: DetailTab } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [credentialsId, setCredentialsId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const catalogs = useCatalogs();

  /* ── fetch doctors ── */
  const { data: doctors, isLoading } = useQuery({
    queryKey: ["admin-doctors"],
    queryFn: async () => {
      // doctors.google_calendar_connected is DEPRECATED since Mejora 2 — the
      // real connection state lives per-office in doctor_offices. We do NOT
      // read the legacy column here; the detail card fetches per-office state
      // and renders it instead.
      const { data, error } = await supabase
        .from("doctors")
        .select(`
          id, full_name, phone, address, is_active, city_id, zone_id,
          doctor_specialties(specialty_id, specialties(id, name, color)),
          cities(name), zones(name)
        `)
        .eq("is_deleted", false)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as unknown as DoctorRow[];
    },
  });

  /* ── per-doctor setup summary (read-only) ──
     Consultorios activos, cuántos tienen calendario (Google/Outlook) y cuántos
     tienen disponibilidad semanal. Se lee de doctor_offices — nunca de las
     columnas deprecated de doctors (ver ERRORES.md 2026-05-18). */
  const { data: setup } = useQuery({
    queryKey: ["admin-doctors-setup"],
    queryFn: async () => {
      const { data: offices, error } = await supabase
        .from("doctor_offices")
        .select("id, doctor_id, google_calendar_connected, outlook_calendar_connected")
        .eq("is_active", true)
        .eq("is_deleted", false);
      if (error) throw error;
      const officeIds = (offices ?? []).map((o) => o.id);
      const withAvailability = new Set<string>();
      if (officeIds.length > 0) {
        const { data: availability, error: avError } = await supabase
          .from("doctor_weekly_availability")
          .select("office_id")
          .eq("is_enabled", true)
          .in("office_id", officeIds);
        if (avError) throw avError;
        for (const a of availability ?? []) withAvailability.add(a.office_id);
      }
      const byDoctor: Record<string, SetupSummary> = {};
      for (const o of offices ?? []) {
        const s = byDoctor[o.doctor_id] ?? { ...NO_SETUP };
        s.offices += 1;
        if (o.google_calendar_connected || o.outlook_calendar_connected) s.withCalendar += 1;
        if (withAvailability.has(o.id)) s.withAvailability += 1;
        byDoctor[o.doctor_id] = s;
      }
      return byDoctor;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  /* ── toggle active ── */
  const toggleActiveMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("doctors").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-doctors"] }),
    onError: () => toast({ title: "Error al cambiar estado", variant: "destructive" }),
  });

  /* ── soft delete ── */
  const deleteDoctorMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("doctors").update({ is_deleted: true, is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-doctors"] });
      toast({ title: "Doctor eliminado correctamente" });
    },
    onError: () => toast({ title: "Error al eliminar doctor", variant: "destructive" }),
  });

  const allDoctors = doctors ?? [];
  const findDoctor = (id: string | null) => (id ? allDoctors.find((d) => d.id === id) ?? null : null);
  const detailDoctor = findDoctor(detail?.id ?? null);
  const editingDoctor = findDoctor(editingId);
  const credentialsDoctor = findDoctor(credentialsId);

  const setupOf = (id: string) => setup?.[id] ?? NO_SETUP;

  const openDetail = (id: string, tab: DetailTab = "datos") => setDetail({ id, tab });
  const changeTab = (tab: DetailTab) => {
    if (!detail) return;
    setDetail({ id: detail.id, tab });
  };
  const closeDetail = () => {
    setDetail(null);
    // Los cambios hechos en Consultorios/Horarios se reflejan en el resumen.
    queryClient.invalidateQueries({ queryKey: ["admin-doctors-setup"] });
  };

  /* ── filter logic ── */
  const term = search.trim().toLowerCase();
  const filtered = allDoctors.filter((d) => {
    if (term && !d.full_name.toLowerCase().includes(term) && !(d.phone ?? "").toLowerCase().includes(term)) return false;
    if (filterStatus === "active" && !d.is_active) return false;
    if (filterStatus === "inactive" && d.is_active) return false;
    if (filterCity !== "all" && d.city_id !== filterCity) return false;
    if (filterZone !== "all" && d.zone_id !== filterZone) return false;
    if (filterSpecialty !== "all" && !d.doctor_specialties.some((ds) => ds.specialty_id === filterSpecialty)) return false;
    if (setup && filterSetup !== "all") {
      const s = setupOf(d.id);
      if (filterSetup === "pending" && !(s.offices === 0 || s.withAvailability < s.offices)) return false;
      if (filterSetup === "no-calendar" && !(s.offices > 0 && s.withCalendar < s.offices)) return false;
    }
    return true;
  });

  const hasFilters =
    !!term || filterSpecialty !== "all" || filterCity !== "all" || filterZone !== "all" || filterStatus !== "all" || filterSetup !== "all";
  const clearFilters = () => {
    setSearch("");
    setFilterSpecialty("all");
    setFilterCity("all");
    setFilterZone("all");
    setFilterStatus("all");
    setFilterSetup("all");
  };

  /* ── KPIs (doctores activos) ── */
  const activeDoctors = allDoctors.filter((d) => d.is_active);
  const stats = setup
    ? activeDoctors.reduce(
        (acc, d) => {
          const s = setupOf(d.id);
          if (s.offices === 0) acc.noOffice += 1;
          acc.offices += s.offices;
          acc.noSchedule += s.offices - s.withAvailability;
          acc.withCalendar += s.withCalendar;
          return acc;
        },
        { noOffice: 0, offices: 0, noSchedule: 0, withCalendar: 0 },
      )
    : null;

  /* ── card color helper ── */
  function getPrimaryColor(d: DoctorRow) {
    const first = d.doctor_specialties[0];
    if (!first) return "#6B7280";
    return getSpecialtyColor(first.specialty_id, catalogs.colorMap);
  }

  const zonesForFilter = filterCity !== "all" ? catalogs.zones.filter((z) => z.city_id === filterCity) : catalogs.zones;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Doctores"
        description="Perfiles, consultorios, horarios y calendarios de los médicos de la red."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Nuevo doctor
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {isLoading || !stats ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[84px] rounded-lg" />)
        ) : (
          <>
            <StatCard label="Doctores activos" value={activeDoctors.length} hint={`De ${allDoctors.length} registrados`} icon={Stethoscope} tone="info" />
            <StatCard
              label="Sin consultorio activo"
              value={stats.noOffice}
              hint="No se les pueden agendar citas"
              icon={Building2}
              tone={stats.noOffice ? "warning" : "success"}
            />
            <StatCard
              label="Consultorios sin horarios"
              value={stats.noSchedule}
              hint="No aparecen al agendar"
              icon={Clock}
              tone={stats.noSchedule ? "warning" : "success"}
            />
            <StatCard
              label="Calendarios conectados"
              value={`${stats.withCalendar}/${stats.offices}`}
              hint="Consultorios con Google u Outlook"
              icon={CalendarCheck}
              tone={stats.offices > 0 && stats.withCalendar === stats.offices ? "success" : "neutral"}
            />
          </>
        )}
      </div>

      {/* Filters */}
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre o teléfono…" />
        <Select value={filterSpecialty} onValueChange={setFilterSpecialty}>
          <SelectTrigger className={SELECT_CLASS} aria-label="Especialidad"><SelectValue placeholder="Especialidad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las especialidades</SelectItem>
            {catalogs.specialties.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCity} onValueChange={(v) => { setFilterCity(v); setFilterZone("all"); }}>
          <SelectTrigger className={SELECT_CLASS} aria-label="Ciudad"><SelectValue placeholder="Ciudad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las ciudades</SelectItem>
            {catalogs.cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterZone} onValueChange={setFilterZone}>
          <SelectTrigger className={SELECT_CLASS} aria-label="Zona"><SelectValue placeholder="Zona" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las zonas</SelectItem>
            {zonesForFilter.map((z) => (
              <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className={cn(SELECT_CLASS, "sm:w-[140px]")} aria-label="Estado"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="inactive">Inactivos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSetup} onValueChange={setFilterSetup}>
          <SelectTrigger className={SELECT_CLASS} aria-label="Configuración"><SelectValue placeholder="Configuración" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Cualquier configuración</SelectItem>
            <SelectItem value="pending">Con pendientes</SelectItem>
            <SelectItem value="no-calendar">Sin calendario</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 sm:ml-auto">
          {hasFilters && (
            <Button size="sm" variant="ghost" className="h-9 gap-1 px-2 text-muted-foreground" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" /> Limpiar
            </Button>
          )}
          {!isLoading && (
            <span className="text-xs text-muted-foreground">
              {filtered.length} de {allDoctors.length}
            </span>
          )}
        </div>
      </FilterBar>

      {/* List */}
      {isLoading ? (
        <Card className="overflow-hidden">
          <div className="h-9 border-b bg-muted/40" />
          <div className="divide-y">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
                <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
              </div>
            ))}
          </div>
        </Card>
      ) : allDoctors.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          title="Aún no hay doctores"
          description="Crea la cuenta del primer doctor; después podrás darle consultorios, horarios y conectar su calendario."
          action={
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> Nuevo doctor
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          title="Sin resultados"
          description="Ningún doctor coincide con la búsqueda o los filtros."
          action={
            <Button size="sm" variant="outline" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop: tabla */}
          <Card className="hidden overflow-hidden xl:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="h-9 pl-4 pr-3 text-xs">Doctor</TableHead>
                  <TableHead className="h-9 px-3 text-xs">Especialidades</TableHead>
                  <TableHead className="h-9 px-3 text-xs">Consultorios</TableHead>
                  <TableHead className="h-9 px-3 text-xs">Horarios</TableHead>
                  <TableHead className="h-9 px-3 text-xs">Calendario</TableHead>
                  <TableHead className="h-9 px-3 text-xs">Estado</TableHead>
                  <TableHead className="h-9 w-12 px-3 text-xs"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((doc) => {
                  const status = setupStatus(setupOf(doc.id));
                  return (
                    <TableRow key={doc.id} className="cursor-pointer" onClick={() => openDetail(doc.id)}>
                      <TableCell className="py-2.5 pl-4 pr-3">
                        <div className="flex items-center gap-3">
                          <DoctorAvatar name={doc.full_name} color={getPrimaryColor(doc)} />
                          <div className="min-w-0">
                            <button
                              type="button"
                              className="block max-w-[200px] truncate rounded-sm text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={(e) => { e.stopPropagation(); openDetail(doc.id); }}
                            >
                              {doc.full_name}
                            </button>
                            <p className="max-w-[200px] truncate text-xs text-muted-foreground">
                              {locationLabel(doc) || "Sin ubicación"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        <SpecialtyChips items={doc.doctor_specialties} colorMap={catalogs.colorMap} max={2} />
                      </TableCell>
                      <TableCell className="px-3 py-2.5"><SetupCell loading={!setup} status={status.offices} /></TableCell>
                      <TableCell className="px-3 py-2.5"><SetupCell loading={!setup} status={status.schedule} /></TableCell>
                      <TableCell className="px-3 py-2.5"><SetupCell loading={!setup} status={status.calendar} /></TableCell>
                      <TableCell className="px-3 py-2.5"><ActiveBadge active={doc.is_active} /></TableCell>
                      <TableCell className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Acciones para ${doc.full_name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem className="gap-2" onClick={() => openDetail(doc.id, "datos")}>
                              <UserRound className="h-4 w-4 text-muted-foreground" /> Ver ficha
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2" onClick={() => setEditingId(doc.id)}>
                              <Pencil className="h-4 w-4 text-muted-foreground" /> Editar datos
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2" onClick={() => openDetail(doc.id, "consultorios")}>
                              <Building2 className="h-4 w-4 text-muted-foreground" /> Consultorios
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2" onClick={() => openDetail(doc.id, "horarios")}>
                              <Clock className="h-4 w-4 text-muted-foreground" /> Horarios
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2" onClick={() => openDetail(doc.id, "calendarios")}>
                              <CalendarCheck className="h-4 w-4 text-muted-foreground" /> Calendarios
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {/* Móvil / tablet: lista compacta */}
          <Card className="divide-y overflow-hidden xl:hidden">
            {filtered.map((doc) => {
              const status = setupStatus(setupOf(doc.id));
              const specs = doc.doctor_specialties.map((ds) => ds.specialties?.name).filter(Boolean).join(", ");
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => openDetail(doc.id)}
                  className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                >
                  <DoctorAvatar name={doc.full_name} color={getPrimaryColor(doc)} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{doc.full_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[specs || "Sin especialidad", locationLabel(doc)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <ActiveBadge active={doc.is_active} />
                    </div>
                    {setup ? (
                      <div className="flex flex-wrap gap-1.5">
                        <SoftBadge tone={status.offices.tone}>{status.offices.long}</SoftBadge>
                        {!status.schedule.empty && <SoftBadge tone={status.schedule.tone}>{status.schedule.long}</SoftBadge>}
                        {!status.calendar.empty && <SoftBadge tone={status.calendar.tone}>{status.calendar.long}</SoftBadge>}
                      </div>
                    ) : (
                      <Skeleton className="h-5 w-40 rounded-full" />
                    )}
                  </div>
                  <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </Card>
        </>
      )}

      {/* Ficha del doctor */}
      {detailDoctor && detail && (
        <DoctorDetailSheet
          doctor={detailDoctor}
          tab={detail.tab}
          onTabChange={changeTab}
          colorMap={catalogs.colorMap}
          color={getPrimaryColor(detailDoctor)}
          setup={setup ? setupOf(detailDoctor.id) : null}
          onClose={closeDetail}
          onEdit={() => setEditingId(detailDoctor.id)}
          onEditCredentials={() => setCredentialsId(detailDoctor.id)}
          togglingActive={toggleActiveMut.isPending}
          onToggleActive={() => {
            toggleActiveMut.mutate({ id: detailDoctor.id, is_active: !detailDoctor.is_active });
          }}
          onDelete={() => {
            deleteDoctorMut.mutate(detailDoctor.id);
            closeDetail();
          }}
        />
      )}

      {/* Edit credentials dialog */}
      {credentialsDoctor && (
        <EditCredentialsDialog
          doctor={credentialsDoctor}
          onClose={() => setCredentialsId(null)}
          onSuccess={() => {
            setCredentialsId(null);
            queryClient.invalidateQueries({ queryKey: ["doctor-credentials", credentialsDoctor.id] });
          }}
        />
      )}

      {/* Create dialog */}
      {showCreate && (
        <CreateDoctorDialog
          catalogs={catalogs}
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ["admin-doctors"] });
          }}
        />
      )}

      {/* Edit dialog */}
      {editingDoctor && (
        <EditDoctorDialog
          doctor={editingDoctor}
          catalogs={catalogs}
          onClose={() => setEditingId(null)}
          onSuccess={() => {
            setEditingId(null);
            queryClient.invalidateQueries({ queryKey: ["admin-doctors"] });
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   Presentational helpers
   ═══════════════════════════════════════════ */

function DoctorAvatar({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <div
      className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold", className)}
      style={{ color, backgroundColor: tint(color) }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

function SpecialtyChips({
  items,
  colorMap,
  max,
}: {
  items: DoctorRow["doctor_specialties"];
  colorMap: Record<string, string>;
  /** Cuántas mostrar antes de "+N". Sin valor: todas. */
  max?: number;
}) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground">Sin especialidad</span>;
  const shown = max ? items.slice(0, max) : items;
  const rest = items.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((ds) => (
        <span
          key={ds.specialty_id}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs text-foreground",
            max && "max-w-[150px]",
          )}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: getSpecialtyColor(ds.specialty_id, colorMap) }}
          />
          <span className="truncate">{ds.specialties?.name ?? "—"}</span>
        </span>
      ))}
      {rest > 0 && <span className="text-xs text-muted-foreground">+{rest}</span>}
    </div>
  );
}

function SetupCell({ status, loading }: { status: SetupStatus; loading: boolean }) {
  if (loading) return <Skeleton className="h-5 w-20 rounded-full" />;
  if (status.empty) return <span className="text-xs text-muted-foreground">—</span>;
  return <SoftBadge tone={status.tone}>{status.short}</SoftBadge>;
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <SoftBadge tone={active ? "success" : "neutral"} dot>
      {active ? "Activo" : "Inactivo"}
    </SoftBadge>
  );
}

function CopyButton({ value, label, toastTitle }: { value: string; label: string; toastTitle: string }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={label}
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast({ title: toastTitle });
      }}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

function InfoItem({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-0.5", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function PanelIntro({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/* ═══════════════════════════════════════════
   Detail Sheet (ficha con pestañas)
   ═══════════════════════════════════════════ */

function DoctorDetailSheet({
  doctor,
  tab,
  onTabChange,
  colorMap,
  color,
  setup,
  onClose,
  onEdit,
  onEditCredentials,
  togglingActive,
  onToggleActive,
  onDelete,
}: {
  doctor: DoctorRow;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  colorMap: Record<string, string>;
  color: string;
  setup: SetupSummary | null;
  onClose: () => void;
  onEdit: () => void;
  onEditCredentials: () => void;
  togglingActive: boolean;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const status = setup ? setupStatus(setup) : null;
  const specs = doctor.doctor_specialties.map((ds) => ds.specialties?.name).filter(Boolean).join(", ");

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="space-y-0 border-b px-5 py-4 pr-12 text-left">
          <div className="flex items-start gap-3">
            <DoctorAvatar name={doctor.full_name} color={color} className="h-11 w-11 text-sm" />
            <div className="min-w-0 flex-1 space-y-1">
              <SheetTitle className="truncate text-base font-semibold">{doctor.full_name}</SheetTitle>
              <SheetDescription className="truncate text-xs">
                {[specs || "Sin especialidad", locationLabel(doctor)].filter(Boolean).join(" · ")}
              </SheetDescription>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <ActiveBadge active={doctor.is_active} />
                {status && (
                  <>
                    <SoftBadge tone={status.offices.tone}>{status.offices.long}</SoftBadge>
                    {!status.schedule.empty && <SoftBadge tone={status.schedule.tone}>{status.schedule.long}</SoftBadge>}
                    {!status.calendar.empty && <SoftBadge tone={status.calendar.tone}>{status.calendar.long}</SoftBadge>}
                  </>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(v) => onTabChange(v as DetailTab)} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-5 py-2.5">
            <TabsList className="grid h-9 w-full grid-cols-4 sm:inline-flex sm:w-auto">
              {DETAIL_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="gap-1.5 px-2 text-xs sm:px-3 sm:text-sm">
                  <t.icon className="hidden h-3.5 w-3.5 sm:block" />
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-4 py-4 sm:px-5">
            <TabsContent value="datos" className="mt-0">
              <DoctorDataPanel
                doctor={doctor}
                colorMap={colorMap}
                onEdit={onEdit}
                onEditCredentials={onEditCredentials}
                togglingActive={togglingActive}
                onToggleActive={onToggleActive}
                onDelete={onDelete}
              />
            </TabsContent>
            <TabsContent value="consultorios" className="mt-0 space-y-3">
              <PanelIntro>
                Cada consultorio tiene su ubicación, calendario, color y duración de cita. No puede haber dos consultorios
                activos del mismo doctor en la misma zona.
              </PanelIntro>
              <OfficeManager doctorId={doctor.id} />
            </TabsContent>
            <TabsContent value="horarios" className="mt-0 space-y-3">
              <PanelIntro>
                Días y horas en que el doctor atiende en cada consultorio. Puede haber varios bloques el mismo día mientras
                no se traslapen en el mismo consultorio. Guarda antes de cambiar de pestaña o cerrar la ficha.
              </PanelIntro>
              <UnifiedAvailabilityEditor doctorId={doctor.id} />
            </TabsContent>
            <TabsContent value="calendarios" className="mt-0">
              <DoctorCalendarsPanel doctorId={doctor.id} onManage={() => onTabChange("consultorios")} />
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function DoctorDataPanel({
  doctor,
  colorMap,
  onEdit,
  onEditCredentials,
  togglingActive,
  onToggleActive,
  onDelete,
}: {
  doctor: DoctorRow;
  colorMap: Record<string, string>;
  onEdit: () => void;
  onEditCredentials: () => void;
  togglingActive: boolean;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [showPassword, setShowPassword] = useState(false);

  // Fetch login credentials
  const { data: credentials, isLoading: credentialsLoading } = useQuery({
    queryKey: ["doctor-credentials", doctor.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("email, initial_password")
        .eq("doctor_id", doctor.id)
        .single();
      if (error) return null;
      return data;
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-4 pb-3">
          <CardTitle className="text-sm font-semibold">Información general</CardTitle>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <InfoItem label="Teléfono">{doctor.phone ?? "—"}</InfoItem>
            <InfoItem label="Ciudad">{doctor.cities?.name ?? "—"}</InfoItem>
            <InfoItem label="Zona">{doctor.zones?.name ?? "—"}</InfoItem>
            <InfoItem label="Especialidades" className="sm:col-span-3">
              <SpecialtyChips items={doctor.doctor_specialties} colorMap={colorMap} />
            </InfoItem>
            <InfoItem label="ID del doctor" className="sm:col-span-3">
              <span className="flex items-center gap-1">
                <span className="truncate font-mono text-xs text-muted-foreground">{doctor.id}</span>
                <CopyButton value={doctor.id} label="Copiar ID" toastTitle="ID copiado" />
              </span>
            </InfoItem>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 pb-3">
          <div className="space-y-0.5">
            <CardTitle className="text-sm font-semibold">Acceso a la plataforma</CardTitle>
            <p className="text-xs text-muted-foreground">Datos con los que el doctor inicia sesión.</p>
          </div>
          <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5" onClick={onEditCredentials}>
            <KeyRound className="h-3.5 w-3.5" /> Cambiar
          </Button>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {credentialsLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <InfoItem label="Email">
                {credentials?.email ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate">{credentials.email}</span>
                    <CopyButton value={credentials.email} label="Copiar email" toastTitle="Email copiado" />
                  </span>
                ) : (
                  "—"
                )}
              </InfoItem>
              <InfoItem label="Contraseña">
                {credentials?.initial_password ? (
                  <span className="flex items-center gap-1">
                    <span className="font-mono text-xs">{showPassword ? credentials.initial_password : "••••••••"}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                    <CopyButton value={credentials.initial_password} label="Copiar contraseña" toastTitle="Contraseña copiada" />
                  </span>
                ) : (
                  "—"
                )}
              </InfoItem>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-sm font-semibold">Cuenta</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <Label htmlFor={`doctor-active-${doctor.id}`} className="text-sm font-medium">
                Doctor activo
              </Label>
              <p className="text-xs text-muted-foreground">Desactívalo para pausarlo sin borrar su información.</p>
            </div>
            <Switch
              id={`doctor-active-${doctor.id}`}
              checked={doctor.is_active}
              disabled={togglingActive}
              onCheckedChange={onToggleActive}
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Eliminar doctor</p>
              <p className="text-xs text-muted-foreground">Deja de aparecer en la plataforma. Las citas pasadas se conservan.</p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Eliminar a {doctor.full_name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Este doctor dejará de aparecer en la plataforma. Las citas pasadas se conservarán. Esta acción no se puede deshacer fácilmente.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Eliminar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DoctorCalendarsPanel({ doctorId, onManage }: { doctorId: string; onManage: () => void }) {
  // Per-office calendar status. We READ from doctor_offices (not the deprecated
  // doctors.google_calendar_connected which was lying — it never got updated
  // after Mejora 2 moved calendar state into doctor_offices). Each active,
  // non-deleted office has its own Google/Outlook connection state. We show
  // only the names + a small connection indicator per office: anything richer
  // (like the calendar email or the picker) lives in the Consultorios tab.
  const { data: offices } = useQuery({
    queryKey: ["doctor-offices-summary", doctorId],
    queryFn: async () => {
      const { data } = await supabase
        .from("doctor_offices")
        .select(
          "id, name, google_calendar_connected, outlook_calendar_connected, is_active"
        )
        .eq("doctor_id", doctorId)
        .eq("is_deleted", false)
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      return (data ?? []) as Array<{
        id: string;
        name: string;
        google_calendar_connected: boolean;
        outlook_calendar_connected: boolean;
        is_active: boolean;
      }>;
    },
  });

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="space-y-0.5 p-4 pb-3">
          <CardTitle className="text-sm font-semibold">Calendarios por consultorio</CardTitle>
          <p className="text-xs text-muted-foreground">
            Cada consultorio activo se conecta a su propio Google Calendar u Outlook.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {!offices ? (
            <div className="space-y-2 border-t p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : offices.length === 0 ? (
            <div className="border-t">
              <EmptyState
                icon={Building2}
                title="Sin consultorios activos"
                description="Agrega o activa un consultorio para poder conectar su calendario."
                className="rounded-none border-0"
              />
            </div>
          ) : (
            <ul className="divide-y border-t">
              {offices.map((o) => {
                const connected = o.google_calendar_connected || o.outlook_calendar_connected;
                return (
                  <li key={o.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                        connected ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Calendar className="h-4 w-4" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{o.name}</span>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {o.google_calendar_connected && <SoftBadge tone="success" dot>Google conectado</SoftBadge>}
                      {o.outlook_calendar_connected && <SoftBadge tone="success" dot>Outlook conectado</SoftBadge>}
                      {!connected && <SoftBadge tone="neutral">Sin calendario</SoftBadge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 rounded-lg border border-info/20 bg-info/5 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground">
          Para conectar, cambiar o desconectar un calendario, ábrelo desde su consultorio.
        </p>
        <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 self-start sm:self-auto" onClick={onManage}>
          <Building2 className="h-3.5 w-3.5" /> Ir a Consultorios
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Form helpers
   ═══════════════════════════════════════════ */

function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SpecialtyPicker({
  specialties,
  colorMap,
  selected,
  onToggle,
}: {
  specialties: { id: string; name: string }[];
  colorMap: Record<string, string>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (specialties.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No hay especialidades activas. Agrégalas en Configuración › Catálogos.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {specialties.map((s) => {
        const active = selected.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(s.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary/40 bg-primary/10 text-primary"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {active ? (
              <Check className="h-3 w-3" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: getSpecialtyColor(s.id, colorMap) }} />
            )}
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

const FORM_SECTIONS = "space-y-5 [&>section+section]:border-t [&>section+section]:pt-4";

/* ═══════════════════════════════════════════
   Create Doctor Dialog
   ═══════════════════════════════════════════ */

function CreateDoctorDialog({
  catalogs,
  onClose,
  onSuccess,
}: {
  catalogs: ReturnType<typeof useCatalogs>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    phone: "",
    address: "",
    city_id: "",
    zone_id: "",
    specialty_ids: [] as string[],
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const toggleSpec = (id: string) =>
    setForm((p) => ({
      ...p,
      specialty_ids: p.specialty_ids.includes(id)
        ? p.specialty_ids.filter((s) => s !== id)
        : [...p.specialty_ids, id],
    }));

  const handleCreate = async () => {
    // Client-side validation: bloqueamos el caso obvio sin pegar al backend.
    // Errores que requieren validación remota (email duplicado, etc.) los
    // manejamos en el catch.
    if (!form.full_name.trim()) {
      toast({ title: "Falta el nombre completo", variant: "destructive" });
      return;
    }
    if (!form.email.trim()) {
      toast({ title: "Falta el email", variant: "destructive" });
      return;
    }
    if (!form.password) {
      toast({ title: "Falta la contraseña inicial", variant: "destructive" });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email.trim())) {
      toast({
        title: "Email inválido",
        description: "Verifica el formato (ej. doctor@findmed.com).",
        variant: "destructive",
      });
      return;
    }
    if (form.password.length < 6) {
      toast({
        title: "Contraseña insegura",
        description: "Debe tener al menos 6 caracteres.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await supabase.functions.invoke("create-doctor", {
        body: {
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          phone: form.phone || null,
          address: form.address || null,
          city_id: form.city_id || null,
          zone_id: form.zone_id || null,
          specialty_ids: form.specialty_ids,
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.error) {
        const parsed = await extractEdgeFunctionError(res.error);
        const { title, description } = toastFromEdgeFunctionError(parsed, "Error al crear doctor");
        toast({ title, description, variant: "destructive" });
        return;
      }
      toast({ title: "Doctor creado", description: "La cuenta del doctor ya puede iniciar sesión." });
      onSuccess();
    } catch (err: unknown) {
      const parsed = await extractEdgeFunctionError(err);
      const { title, description } = toastFromEdgeFunctionError(parsed, "Error al crear doctor");
      toast({ title, description, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const zonesFiltered = form.city_id ? catalogs.zones.filter((z) => z.city_id === form.city_id) : catalogs.zones;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo doctor</DialogTitle>
          <DialogDescription>
            Crea la cuenta con la que el doctor entrará a FindMed. Sus consultorios y horarios se configuran después en su ficha.
          </DialogDescription>
        </DialogHeader>
        <div className={FORM_SECTIONS}>
          <FormSection title="Datos del doctor">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre completo *" className="sm:col-span-2">
                <Input className="h-9 text-sm" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Dr. Juan Pérez" />
              </Field>
              <Field label="Teléfono">
                <Input className="h-9 text-sm" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+52 55 1234 5678" />
              </Field>
            </div>
          </FormSection>
          <FormSection title="Acceso a la plataforma" description="Comparte estos datos con el doctor para que inicie sesión.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email *">
                <Input className="h-9 text-sm" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="doctor@findmed.com" />
              </Field>
              <Field label="Contraseña inicial *" hint="Mínimo 6 caracteres.">
                <Input className="h-9 text-sm" type="text" value={form.password} onChange={(e) => set("password", e.target.value)} />
              </Field>
            </div>
          </FormSection>
          <FormSection title="Ubicación">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ciudad">
                <Select value={form.city_id || "none"} onValueChange={(v) => { set("city_id", v === "none" ? "" : v); set("zone_id", ""); }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin ciudad</SelectItem>
                    {catalogs.cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Zona">
                <Select value={form.zone_id || "none"} onValueChange={(v) => set("zone_id", v === "none" ? "" : v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin zona</SelectItem>
                    {zonesFiltered.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </FormSection>
          <FormSection title="Especialidades" description="Selecciona una o varias.">
            <SpecialtyPicker
              specialties={catalogs.specialties}
              colorMap={catalogs.colorMap}
              selected={form.specialty_ids}
              onToggle={toggleSpec}
            />
          </FormSection>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleCreate} disabled={saving}>{saving ? "Creando…" : "Crear doctor"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════
   Edit Doctor Dialog
   ═══════════════════════════════════════════ */

function EditDoctorDialog({
  doctor,
  catalogs,
  onClose,
  onSuccess,
}: {
  doctor: DoctorRow;
  catalogs: ReturnType<typeof useCatalogs>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    full_name: doctor.full_name,
    phone: doctor.phone ?? "",
    address: doctor.address ?? "",
    city_id: doctor.city_id ?? "",
    zone_id: doctor.zone_id ?? "",
    specialty_ids: doctor.doctor_specialties.map((ds) => ds.specialty_id),
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const toggleSpec = (id: string) =>
    setForm((p) => ({
      ...p,
      specialty_ids: p.specialty_ids.includes(id)
        ? p.specialty_ids.filter((s) => s !== id)
        : [...p.specialty_ids, id],
    }));

  const handleSave = async () => {
    if (!form.full_name) {
      toast({ title: "El nombre es obligatorio", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error: docErr } = await supabase
        .from("doctors")
        .update({
          full_name: form.full_name,
          phone: form.phone || null,
          address: form.address || null,
          city_id: form.city_id || null,
          zone_id: form.zone_id || null,
        })
        .eq("id", doctor.id);
      if (docErr) throw docErr;

      await supabase.from("doctor_specialties").delete().eq("doctor_id", doctor.id);
      if (form.specialty_ids.length > 0) {
        const { error: specErr } = await supabase
          .from("doctor_specialties")
          .insert(form.specialty_ids.map((sid) => ({ doctor_id: doctor.id, specialty_id: sid })));
        if (specErr) throw specErr;
      }

      toast({ title: "Doctor actualizado" });
      onSuccess();
    } catch (err: unknown) {
      toast({ title: "Error al actualizar", description: (err as Error)?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const zonesFiltered = form.city_id ? catalogs.zones.filter((z) => z.city_id === form.city_id) : catalogs.zones;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar doctor</DialogTitle>
          <DialogDescription>Datos generales de {doctor.full_name}. Los consultorios se editan en su ficha.</DialogDescription>
        </DialogHeader>
        <div className={FORM_SECTIONS}>
          <FormSection title="Datos del doctor">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre completo *" className="sm:col-span-2">
                <Input className="h-9 text-sm" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
              </Field>
              <Field label="Teléfono">
                <Input className="h-9 text-sm" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
            </div>
          </FormSection>
          <FormSection title="Ubicación">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ciudad">
                <Select value={form.city_id || "none"} onValueChange={(v) => { set("city_id", v === "none" ? "" : v); set("zone_id", ""); }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin ciudad</SelectItem>
                    {catalogs.cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Zona">
                <Select value={form.zone_id || "none"} onValueChange={(v) => set("zone_id", v === "none" ? "" : v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin zona</SelectItem>
                    {zonesFiltered.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </FormSection>
          <FormSection title="Especialidades" description="Selecciona una o varias.">
            <SpecialtyPicker
              specialties={catalogs.specialties}
              colorMap={catalogs.colorMap}
              selected={form.specialty_ids}
              onToggle={toggleSpec}
            />
          </FormSection>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════
   Edit Credentials Dialog
   ═══════════════════════════════════════════ */

function EditCredentialsDialog({
  doctor,
  onClose,
  onSuccess,
}: {
  doctor: DoctorRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: credentials, isLoading: credLoading } = useQuery({
    queryKey: ["doctor-credentials", doctor.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("email, initial_password")
        .eq("doctor_id", doctor.id)
        .single();
      if (error) return null;
      return data;
    },
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pre-fill email once loaded so the admin sees the current value and can edit.
  // Password stays empty: empty = "no change". This matches the placeholder hint.
  useEffect(() => {
    if (credentials?.email) setEmail(credentials.email);
  }, [credentials?.email]);

  const handleSave = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    const currentEmail = credentials?.email?.toLowerCase() ?? "";

    const hasEmailChange = !!trimmedEmail && trimmedEmail !== currentEmail;
    const hasPasswordChange = !!trimmedPassword;

    if (!hasEmailChange && !hasPasswordChange) {
      toast({ title: "No hay cambios para guardar" });
      return;
    }

    if (hasEmailChange) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        toast({ title: "Email inválido", description: "Verifica el formato (ej. doctor@findmed.com).", variant: "destructive" });
        return;
      }
    }
    if (hasPasswordChange && trimmedPassword.length < 6) {
      toast({ title: "Contraseña muy corta", description: "Debe tener al menos 6 caracteres.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const requestBody: Record<string, string> = { doctor_id: doctor.id };
      if (hasEmailChange) requestBody.email = trimmedEmail;
      if (hasPasswordChange) requestBody.password = trimmedPassword;

      const res = await supabase.functions.invoke("update-doctor-credentials", {
        body: requestBody,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (res.error) {
        const parsed = await extractEdgeFunctionError(res.error);
        const { title, description } = toastFromEdgeFunctionError(parsed, "Error al actualizar");
        toast({ title, description, variant: "destructive" });
        return;
      }

      const parts = [hasEmailChange && "email", hasPasswordChange && "contraseña"].filter(Boolean) as string[];
      toast({
        title: "Credenciales actualizadas",
        description: `Se actualizó ${parts.join(" y ")}. El doctor puede iniciar sesión con los nuevos datos.`,
      });
      queryClient.invalidateQueries({ queryKey: ["doctor-credentials", doctor.id] });
      onSuccess();
    } catch (err: unknown) {
      const parsed = await extractEdgeFunctionError(err);
      const { title, description } = toastFromEdgeFunctionError(parsed, "Error al actualizar");
      toast({ title, description, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar credenciales</DialogTitle>
          <DialogDescription>
            Sincroniza email y contraseña en el sistema de autenticación. Los cambios aplican de inmediato.
          </DialogDescription>
        </DialogHeader>

        {credLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Email" hint="Se guarda en minúsculas.">
              <Input
                type="email"
                className="h-9 text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="doctor@findmed.com"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Nueva contraseña"
              hint="Mínimo 6 caracteres. Tras guardar quedará visible en la ficha para que se la mandes al doctor."
            >
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  className="h-9 pr-9 text-sm"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Deja vacío para no cambiarla"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || credLoading}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
