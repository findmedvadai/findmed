import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSpecialtyColor } from "@/lib/specialty-colors";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Search,
  Plus,
  Calendar,
  MapPin,
  Pencil,
  Copy,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";

/* ───────── types ───────── */

interface DoctorRow {
  id: string;
  full_name: string;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  city_id: string | null;
  zone_id: string | null;
  google_calendar_connected: boolean;
  doctor_specialties: {
    specialty_id: string;
    specialties: { id: string; name: string; color: string | null } | null;
  }[];
  cities: { name: string } | null;
  zones: { name: string } | null;
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

/* ───────── main component ───────── */

export default function Doctores() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterSpecialty, setFilterSpecialty] = useState("all");
  const [filterCity, setFilterCity] = useState("all");
  const [filterZone, setFilterZone] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const [selectedDoctor, setSelectedDoctor] = useState<DoctorRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const catalogs = useCatalogs();

  /* ── fetch doctors ── */
  const { data: doctors, isLoading } = useQuery({
    queryKey: ["admin-doctors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select(`
          id, full_name, phone, address, is_active, city_id, zone_id,
          google_calendar_connected,
          doctor_specialties(specialty_id, specialties(id, name, color)),
          cities(name), zones(name)
        `)
        .eq("is_deleted", false)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as unknown as DoctorRow[];
    },
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
      const { error } = await supabase.from("doctors").update({ is_deleted: true, is_active: false } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-doctors"] });
      toast({ title: "Doctor eliminado correctamente" });
    },
    onError: () => toast({ title: "Error al eliminar doctor", variant: "destructive" }),
  });

  /* ── filter logic ── */
  const filtered = (doctors ?? []).filter((d) => {
    if (search && !d.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus === "active" && !d.is_active) return false;
    if (filterStatus === "inactive" && d.is_active) return false;
    if (filterCity !== "all" && d.city_id !== filterCity) return false;
    if (filterZone !== "all" && d.zone_id !== filterZone) return false;
    if (filterSpecialty !== "all" && !d.doctor_specialties.some((ds) => ds.specialty_id === filterSpecialty)) return false;
    return true;
  });

  /* ── card color helper ── */
  function getPrimaryColor(d: DoctorRow) {
    const first = d.doctor_specialties[0];
    if (!first) return "#6B7280";
    return getSpecialtyColor(first.specialty_id, catalogs.colorMap);
  }

  function getPrimarySpecialtyName(d: DoctorRow) {
    return d.doctor_specialties[0]?.specialties?.name ?? "Sin especialidad";
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground">Doctores</h1>
        <Button className="gap-2" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Nuevo Doctor
        </Button>
      </div>

      {/* Search - full width */}
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nombre…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Filters - second row */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterSpecialty} onValueChange={setFilterSpecialty}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Especialidad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las especialidades</SelectItem>
            {catalogs.specialties.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCity} onValueChange={(v) => { setFilterCity(v); setFilterZone("all"); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Ciudad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las ciudades</SelectItem>
            {catalogs.cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterZone} onValueChange={setFilterZone}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Zona" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las zonas</SelectItem>
            {(filterCity !== "all" ? catalogs.zones.filter((z) => z.city_id === filterCity) : catalogs.zones).map((z) => (
              <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="inactive">Inactivos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">Sin resultados</p>
          <p className="text-sm">Ajusta los filtros o crea un nuevo doctor.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((doc) => {
            const color = getPrimaryColor(doc);
            return (
              <button
                key={doc.id}
                onClick={() => setSelectedDoctor(doc)}
                className="text-left rounded-xl bg-card border shadow-sm p-4 border-l-4 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
                style={{ borderLeftColor: color }}
              >
                <p className="font-semibold text-base" style={{ color }}>{doc.full_name}</p>
                <p className="text-sm mt-1" style={{ color }}>{getPrimarySpecialtyName(doc)}</p>
                <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <span>{[doc.cities?.name, doc.zones?.name].filter(Boolean).join(" — ") || "Sin ubicación"}</span>
                </div>
                {!doc.is_active && (
                  <Badge variant="secondary" className="mt-2 text-xs">Inactivo</Badge>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Detail dialog */}
      {selectedDoctor && (
      <DoctorDetailDialog
          doctor={selectedDoctor}
          colorMap={catalogs.colorMap}
          onClose={() => setSelectedDoctor(null)}
          onToggleActive={() => {
            toggleActiveMut.mutate({ id: selectedDoctor.id, is_active: !selectedDoctor.is_active });
            setSelectedDoctor(null);
          }}
          onEdit={() => {
            setShowEdit(true);
          }}
          onDelete={() => {
            deleteDoctorMut.mutate(selectedDoctor.id);
            setSelectedDoctor(null);
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
      {showEdit && selectedDoctor && (
        <EditDoctorDialog
          doctor={selectedDoctor}
          catalogs={catalogs}
          onClose={() => setShowEdit(false)}
          onSuccess={() => {
            setShowEdit(false);
            setSelectedDoctor(null);
            queryClient.invalidateQueries({ queryKey: ["admin-doctors"] });
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   Detail Dialog
   ═══════════════════════════════════════════ */

function DoctorDetailDialog({
  doctor,
  colorMap,
  onClose,
  onToggleActive,
  onEdit,
  onDelete,
}: {
  doctor: DoctorRow;
  colorMap: Record<string, string>;
  onClose: () => void;
  onToggleActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showPassword, setShowPassword] = useState(false);

  // Fetch login credentials
  const { data: credentials } = useQuery({
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
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{doctor.full_name}</DialogTitle>
          <DialogDescription>Detalle del doctor</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <Row label="ID">
            <span className="font-mono text-xs text-muted-foreground flex items-center gap-1">
              {doctor.id}
              <button onClick={() => { navigator.clipboard.writeText(doctor.id); toast({ title: "ID copiado" }); }} className="hover:text-foreground">
                <Copy className="h-3 w-3" />
              </button>
            </span>
          </Row>
          <Row label="Teléfono">{doctor.phone ?? "—"}</Row>
          <Row label="Dirección">{doctor.address ?? "—"}</Row>
          <Row label="Especialidades">
            <div className="flex flex-wrap gap-1">
              {doctor.doctor_specialties.length === 0 && <span className="text-muted-foreground">—</span>}
              {doctor.doctor_specialties.map((ds) => {
                const c = getSpecialtyColor(ds.specialty_id, colorMap);
                return (
                  <Badge key={ds.specialty_id} variant="outline" style={{ borderColor: c, color: c }}>
                    {ds.specialties?.name}
                  </Badge>
                );
              })}
            </div>
          </Row>
          <Row label="Ciudad">{doctor.cities?.name ?? "—"}</Row>
          <Row label="Zona">{doctor.zones?.name ?? "—"}</Row>
          <Row label="Google Calendar">
            <div className="flex items-center gap-1.5">
              <Calendar className={`h-4 w-4 ${doctor.google_calendar_connected ? "text-confirmed" : "text-muted-foreground"}`} />
              <span>{doctor.google_calendar_connected ? "Conectado" : "No conectado"}</span>
            </div>
          </Row>
          <Row label="Estado">
            <Badge variant={doctor.is_active ? "default" : "secondary"}>{doctor.is_active ? "Activo" : "Inactivo"}</Badge>
          </Row>

          {/* Login credentials section */}
          <div className="border-t pt-3 mt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Acceso a la plataforma</p>
            <Row label="Email">
              {credentials?.email ? (
                <span className="flex items-center gap-1">
                  {credentials.email}
                  <button onClick={() => { navigator.clipboard.writeText(credentials.email!); toast({ title: "Email copiado" }); }} className="hover:text-foreground text-muted-foreground">
                    <Copy className="h-3 w-3" />
                  </button>
                </span>
              ) : "—"}
            </Row>
            <Row label="Contraseña">
              {credentials?.initial_password ? (
                <span className="flex items-center gap-1 font-mono text-xs">
                  {showPassword ? credentials.initial_password : "••••••••"}
                  <button onClick={() => setShowPassword(!showPassword)} className="hover:text-foreground text-muted-foreground">
                    {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <button onClick={() => { navigator.clipboard.writeText(credentials.initial_password!); toast({ title: "Contraseña copiada" }); }} className="hover:text-foreground text-muted-foreground">
                    <Copy className="h-3 w-3" />
                  </button>
                </span>
              ) : "—"}
            </Row>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="gap-1">
                <Trash2 className="h-3 w-3" /> Eliminar
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
          <Button variant="outline" size="sm" onClick={onToggleActive}>
            {doctor.is_active ? "Desactivar" : "Activar"}
          </Button>
          <Button size="sm" className="gap-1" onClick={onEdit}>
            <Pencil className="h-3 w-3" /> Editar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  );
}

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
    if (!form.email || !form.password || !form.full_name) {
      toast({ title: "Completa los campos obligatorios", variant: "destructive" });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email.trim())) {
      toast({ title: "El correo electrónico no tiene un formato válido (ej. doctor@findmed.com)", variant: "destructive" });
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
      if (res.error) throw res.error;
      toast({ title: "Doctor creado exitosamente" });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Error al crear doctor", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const zonesFiltered = form.city_id ? catalogs.zones.filter((z) => z.city_id === form.city_id) : catalogs.zones;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Doctor</DialogTitle>
          <DialogDescription>Crea una cuenta de doctor en la plataforma.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Nombre completo *">
            <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email *">
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Contraseña *">
              <Input type="text" value={form.password} onChange={(e) => set("password", e.target.value)} />
            </Field>
          </div>
          <Field label="Teléfono">
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Dirección">
            <Textarea value={form.address} onChange={(e) => set("address", e.target.value)} rows={2} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Ciudad">
              <Select value={form.city_id || "none"} onValueChange={(v) => { set("city_id", v === "none" ? "" : v); set("zone_id", ""); }}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin ciudad</SelectItem>
                  {catalogs.cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Zona">
              <Select value={form.zone_id || "none"} onValueChange={(v) => set("zone_id", v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin zona</SelectItem>
                  {zonesFiltered.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Especialidades">
            <div className="flex flex-wrap gap-2">
              {catalogs.specialties.map((s) => {
                const active = form.specialty_ids.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSpec(s.id)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-accent"}`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? "Creando…" : "Crear Doctor"}</Button>
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
    } catch (err: any) {
      toast({ title: "Error al actualizar", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const zonesFiltered = form.city_id ? catalogs.zones.filter((z) => z.city_id === form.city_id) : catalogs.zones;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Doctor</DialogTitle>
          <DialogDescription>Modifica la información del doctor.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Nombre completo *">
            <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </Field>
          <Field label="Teléfono">
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Dirección">
            <Textarea value={form.address} onChange={(e) => set("address", e.target.value)} rows={2} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Ciudad">
              <Select value={form.city_id || "none"} onValueChange={(v) => { set("city_id", v === "none" ? "" : v); set("zone_id", ""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin ciudad</SelectItem>
                  {catalogs.cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Zona">
              <Select value={form.zone_id || "none"} onValueChange={(v) => set("zone_id", v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin zona</SelectItem>
                  {zonesFiltered.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Especialidades">
            <div className="flex flex-wrap gap-2">
              {catalogs.specialties.map((s) => {
                const active = form.specialty_ids.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSpec(s.id)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-accent"}`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}
