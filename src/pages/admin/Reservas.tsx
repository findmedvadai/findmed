import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Por confirmar",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  completed: "Completada",
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-yellow-100 text-yellow-800 border-yellow-300",
  confirmed: "bg-green-100 text-green-800 border-green-300",
  cancelled: "bg-red-100 text-red-800 border-red-300",
  completed: "bg-gray-100 text-gray-600 border-gray-300",
};

const CANCEL_REASON_LABELS: Record<string, string> = {
  patient: "Por paciente",
  doctor: "Por doctor",
  no_confirmation: "Sin confirmación",
};

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

export default function Reservas() {
  const [page, setPage] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDoctor, setFilterDoctor] = useState("all");
  const [filterSpecialty, setFilterSpecialty] = useState("all");
  const [filterCity, setFilterCity] = useState("all");
  const [filterZone, setFilterZone] = useState("all");
  const [selectedAppt, setSelectedAppt] = useState<AppointmentRow | null>(null);

  // Fetch all appointments (internal only)
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

  // Fetch cities and zones for display
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

  // Extract unique doctors and specialties for filters
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

  // Filter
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

    return items;
  }, [rawAppointments, searchText, filterStatus, filterDoctor, filterSpecialty, filterCity, filterZone]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when filters change
  const resetPage = () => setPage(0);

  const hasActiveFilters =
    searchText || filterStatus !== "all" || filterDoctor !== "all" ||
    filterSpecialty !== "all" || filterCity !== "all" || filterZone !== "all";

  const clearFilters = () => {
    setSearchText("");
    setFilterStatus("all");
    setFilterDoctor("all");
    setFilterSpecialty("all");
    setFilterCity("all");
    setFilterZone("all");
    setPage(0);
  };

  function getSpecialty(a: AppointmentRow) {
    return a.doctors?.doctor_specialties?.[0]?.specialties?.name ?? "—";
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Reservas</h1>
        <span className="text-sm text-muted-foreground">{filtered.length} citas</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar paciente, teléfono o doctor..."
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); resetPage(); }}
            className="h-8 w-64 pl-9 text-xs"
          />
        </div>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); resetPage(); }}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="scheduled">Por confirmar</SelectItem>
            <SelectItem value="confirmed">Confirmada</SelectItem>
            <SelectItem value="completed">Completada</SelectItem>
            <SelectItem value="cancelled">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterDoctor} onValueChange={(v) => { setFilterDoctor(v); resetPage(); }}>
          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Doctor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los doctores</SelectItem>
            {doctorsList.map(([id, name]) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterSpecialty} onValueChange={(v) => { setFilterSpecialty(v); resetPage(); }}>
          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Especialidad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las especialidades</SelectItem>
            {specialtiesList.map(([id, name]) => (
              <SelectItem key={id} value={id}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterCity} onValueChange={(v) => { setFilterCity(v); setFilterZone("all"); resetPage(); }}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Ciudad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las ciudades</SelectItem>
            {(cities ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterZone} onValueChange={(v) => { setFilterZone(v); resetPage(); }}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Zona" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las zonas</SelectItem>
            {(zones ?? [])
              .filter((z) => filterCity === "all" || z.city_id === filterCity)
              .map((z) => (
                <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
              ))}
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs gap-1">
            <X className="h-3 w-3" /> Limpiar
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Paciente</TableHead>
              <TableHead className="text-xs">Teléfono</TableHead>
              <TableHead className="text-xs">Síntomas</TableHead>
              <TableHead className="text-xs">Doctor</TableHead>
              <TableHead className="text-xs">Especialidad</TableHead>
              <TableHead className="text-xs">Ciudad</TableHead>
              <TableHead className="text-xs">Zona</TableHead>
              <TableHead className="text-xs">Fecha cita</TableHead>
              <TableHead className="text-xs">Estado</TableHead>
              <TableHead className="text-xs">Motivo cancelación</TableHead>
              <TableHead className="text-xs">Notas doctor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-10">
                  <div className="flex items-center justify-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  </div>
                </TableCell>
              </TableRow>
            ) : pageItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-10 text-muted-foreground">
                  No se encontraron citas
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => setSelectedAppt(a)}
                >
                  <TableCell className="text-xs font-medium">{a.patients?.full_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{a.patients?.phone ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-[150px] truncate">{a.symptoms ?? "—"}</TableCell>
                  <TableCell className="text-xs">{a.doctors?.full_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{getSpecialty(a)}</TableCell>
                  <TableCell className="text-xs">{a.doctors?.city_id ? cityMap.get(a.doctors.city_id) ?? "—" : "—"}</TableCell>
                  <TableCell className="text-xs">{a.doctors?.zone_id ? zoneMap.get(a.doctors.zone_id) ?? "—" : "—"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {format(parseISO(a.start_at), "dd/MM/yyyy HH:mm")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[a.status] ?? ""}`}>
                      {STATUS_LABELS[a.status] ?? a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {a.cancel_reason ? CANCEL_REASON_LABELS[a.cancel_reason] ?? a.cancel_reason : "—"}
                  </TableCell>
                  <TableCell className="text-xs max-w-[150px] truncate">{a.doctor_notes ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selectedAppt} onOpenChange={(open) => !open && setSelectedAppt(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle de cita</DialogTitle>
            <DialogDescription>Información completa de la cita</DialogDescription>
          </DialogHeader>
          {selectedAppt && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="font-medium text-muted-foreground">Paciente</span>
                  <p>{selectedAppt.patients?.full_name ?? "—"}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Teléfono</span>
                  <p>{selectedAppt.patients?.phone ?? "—"}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Doctor</span>
                  <p>{selectedAppt.doctors?.full_name ?? "—"}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Especialidad</span>
                  <p>{getSpecialty(selectedAppt)}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Ciudad</span>
                  <p>{selectedAppt.doctors?.city_id ? cityMap.get(selectedAppt.doctors.city_id) ?? "—" : "—"}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Zona</span>
                  <p>{selectedAppt.doctors?.zone_id ? zoneMap.get(selectedAppt.doctors.zone_id) ?? "—" : "—"}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Fecha</span>
                  <p>{format(parseISO(selectedAppt.start_at), "EEEE d 'de' MMMM, yyyy", { locale: es })}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Horario</span>
                  <p>{format(parseISO(selectedAppt.start_at), "HH:mm")} - {format(parseISO(selectedAppt.end_at), "HH:mm")}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Estado</span>
                  <p>
                    <Badge variant="outline" className={`text-xs ${STATUS_COLORS[selectedAppt.status] ?? ""}`}>
                      {STATUS_LABELS[selectedAppt.status] ?? selectedAppt.status}
                    </Badge>
                  </p>
                </div>
                {selectedAppt.cancel_reason && (
                  <div>
                    <span className="font-medium text-muted-foreground">Motivo cancelación</span>
                    <p>{CANCEL_REASON_LABELS[selectedAppt.cancel_reason] ?? selectedAppt.cancel_reason}</p>
                  </div>
                )}
              </div>
              {selectedAppt.symptoms && (
                <div>
                  <span className="font-medium text-muted-foreground">Síntomas</span>
                  <p className="mt-1">{selectedAppt.symptoms}</p>
                </div>
              )}
              {selectedAppt.doctor_notes && (
                <div>
                  <span className="font-medium text-muted-foreground">Notas del doctor</span>
                  <p className="mt-1">{selectedAppt.doctor_notes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
