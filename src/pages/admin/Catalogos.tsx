import { useId, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Building2, FlaskConical, Landmark, MapPin, Pencil, Plus, Search, Stethoscope, Trash2 } from "lucide-react";
import { SPECIALTY_COLORS } from "@/lib/specialty-colors";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/app/PageHeader";
import { FilterBar, SearchInput } from "@/components/app/FilterBar";
import { EmptyState } from "@/components/app/EmptyState";

type IconType = ComponentType<{ className?: string }>;

/* ═══════ Delete Confirm Dialog ═══════ */

function DeleteConfirmDialog({
  open,
  onClose,
  onConfirm,
  itemName,
  deleting,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  itemName: string;
  deleting: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar registro</AlertDialogTitle>
          <AlertDialogDescription>
            ¿Eliminar <strong>{itemName}</strong>? Esta acción no se puede deshacer. Si solo quieres dejar de ofrecerlo,
            desactívalo con el interruptor.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Eliminando…" : "Eliminar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ═══════ Layout pieces ═══════ */

function CatalogPanel({
  title,
  description,
  addLabel,
  onAdd,
  toolbar,
  children,
}: {
  title: string;
  description: string;
  addLabel: string;
  onAdd: () => void;
  toolbar: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button size="sm" className="shrink-0 gap-1.5 self-start" onClick={onAdd}>
          <Plus className="h-4 w-4" /> {addLabel}
        </Button>
      </div>
      <div className="border-t px-4 py-3">
        <FilterBar>{toolbar}</FilterBar>
      </div>
      <div className="border-t">{children}</div>
    </Card>
  );
}

function ResultCount({ shown, total, loading }: { shown: number; total: number; loading: boolean }) {
  if (loading) return null;
  return (
    <span className="ml-auto text-xs text-muted-foreground">
      {shown === total ? `${total} ${total === 1 ? "registro" : "registros"}` : `${shown} de ${total}`}
    </span>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-4 w-full max-w-[220px]" />
          <Skeleton className="ml-auto h-5 w-9 rounded-full" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

function StatusToggle({ name, active, onChange }: { name: string; active: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Switch checked={active} onCheckedChange={onChange} aria-label={`${active ? "Desactivar" : "Activar"} ${name}`} />
      <span className={cn("hidden text-xs sm:inline", active ? "text-foreground" : "text-muted-foreground")}>
        {active ? "Activo" : "Inactivo"}
      </span>
    </div>
  );
}

function RowActions({ name, onEdit, onDelete }: { name: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Editar ${name}`} onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label={`Eliminar ${name}`}
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

interface ExtraColumn<T> {
  header: string;
  className?: string;
  render: (item: T) => ReactNode;
}

/** Tabla compacta de un catálogo: nombre (+ columnas extra), estado con interruptor y acciones. */
function CatalogTable<T extends { id: string; name: string; is_active: boolean }>({
  loading,
  items,
  total,
  filtered,
  empty,
  columns = [],
  leading,
  subtitle,
  onEdit,
  onToggle,
  onDelete,
}: {
  loading: boolean;
  items: T[];
  total: number;
  /** Hay búsqueda o filtro activo. */
  filtered: boolean;
  empty: { icon: IconType; title: string; description: string };
  columns?: ExtraColumn<T>[];
  leading?: (item: T) => ReactNode;
  subtitle?: (item: T) => ReactNode;
  onEdit: (item: T) => void;
  onToggle: (item: T, active: boolean) => void;
  onDelete: (item: T) => void;
}) {
  if (loading) return <LoadingRows />;
  if (items.length === 0) {
    return total > 0 && filtered ? (
      <EmptyState
        icon={Search}
        title="Sin resultados"
        description="Ningún registro coincide con la búsqueda o el filtro."
        className="rounded-none border-0"
      />
    ) : (
      <EmptyState icon={empty.icon} title={empty.title} description={empty.description} className="rounded-none border-0" />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className="h-9 pl-4 pr-3 text-xs">Nombre</TableHead>
          {columns.map((c) => (
            <TableHead key={c.header} className={cn("h-9 px-3 text-xs", c.className)}>{c.header}</TableHead>
          ))}
          <TableHead className="h-9 w-[64px] px-3 text-xs sm:w-[130px]">Estado</TableHead>
          <TableHead className="h-9 w-[84px] px-3 text-xs"><span className="sr-only">Acciones</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="py-2.5 pl-4 pr-3">
              <div className="flex items-center gap-2.5">
                {leading?.(item)}
                <div className="min-w-0">
                  <p className={cn("break-words text-sm font-medium", item.is_active ? "text-foreground" : "text-muted-foreground")}>
                    {item.name}
                  </p>
                  {subtitle && <div className="text-xs text-muted-foreground">{subtitle(item)}</div>}
                </div>
              </div>
            </TableCell>
            {columns.map((c) => (
              <TableCell key={c.header} className={cn("px-3 py-2.5 text-sm text-muted-foreground", c.className)}>
                {c.render(item)}
              </TableCell>
            ))}
            <TableCell className="px-3 py-2.5">
              <StatusToggle name={item.name} active={item.is_active} onChange={(v) => onToggle(item, v)} />
            </TableCell>
            <TableCell className="px-3 py-2.5">
              <RowActions name={item.name} onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* ═══════ Cities Tab ═══════ */

function CitiesTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<{ id: string; name: string } | null>(null);
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");

  const { data: cities, isLoading } = useQuery({
    queryKey: ["catalog-cities"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cities").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const addMut = useMutation({
    mutationFn: async (n: string) => {
      const { error } = await supabase.from("cities").insert({ name: n });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-cities"] }); toast({ title: "Ciudad creada" }); setShowAdd(false); setName(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("cities").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-cities"] }); toast({ title: "Ciudad actualizada" }); setEditItem(null); setName(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("cities").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog-cities"] }),
    onError: () => toast({ title: "Error al cambiar estado", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cities").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-cities"] }); toast({ title: "Ciudad eliminada" }); setDeleteItem(null); },
    onError: (e: Error) => toast({ title: "Error al eliminar", description: e.message, variant: "destructive" }),
  });

  const all = (cities ?? []).map((c) => ({ id: c.id, name: c.name, is_active: c.is_active }));
  const term = search.trim().toLowerCase();
  const rows = all.filter((c) => !term || c.name.toLowerCase().includes(term));

  return (
    <>
      <CatalogPanel
        title="Ciudades"
        description="Ciudades donde opera la red. Zonas, consultorios, hospitales y laboratorios se ubican en una ciudad."
        addLabel="Agregar ciudad"
        onAdd={() => { setShowAdd(true); setName(""); }}
        toolbar={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar ciudad…" />
            <ResultCount shown={rows.length} total={all.length} loading={isLoading} />
          </>
        }
      >
        <CatalogTable
          loading={isLoading}
          items={rows}
          total={all.length}
          filtered={!!term}
          empty={{ icon: Landmark, title: "Aún no hay ciudades", description: "Agrega la primera ciudad para poder ubicar zonas y consultorios." }}
          onEdit={(item) => { setEditItem(item); setName(item.name); }}
          onToggle={(item, active) => toggleMut.mutate({ id: item.id, is_active: active })}
          onDelete={(item) => setDeleteItem(item)}
        />
      </CatalogPanel>
      <CatalogFormDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Agregar ciudad"
        name={name}
        setName={setName}
        onSave={() => { if (name.trim()) addMut.mutate(name.trim()); }}
        saving={addMut.isPending}
      />
      <CatalogFormDialog
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title="Editar ciudad"
        name={name}
        setName={setName}
        onSave={() => { if (editItem && name.trim()) editMut.mutate({ id: editItem.id, name: name.trim() }); }}
        saving={editMut.isPending}
      />
      <DeleteConfirmDialog
        open={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={() => { if (deleteItem) deleteMut.mutate(deleteItem.id); }}
        itemName={deleteItem?.name ?? ""}
        deleting={deleteMut.isPending}
      />
    </>
  );
}

/* ═══════ Zones Tab ═══════ */

function ZonesTab() {
  const qc = useQueryClient();
  const fieldId = useId();
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<{ id: string; name: string } | null>(null);
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [newZoneCityId, setNewZoneCityId] = useState("");
  const [search, setSearch] = useState("");

  const { data: cities } = useQuery({
    queryKey: ["catalog-cities"],
    queryFn: async () => {
      const { data } = await supabase.from("cities").select("id, name").eq("is_active", true).order("name");
      return data ?? [];
    },
  });

  const { data: zones, isLoading } = useQuery({
    queryKey: ["catalog-zones"],
    queryFn: async () => {
      const { data, error } = await supabase.from("zones").select("*, cities(name)").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const addMut = useMutation({
    mutationFn: async ({ name, city_id }: { name: string; city_id: string }) => {
      const { error } = await supabase.from("zones").insert({ name, city_id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-zones"] }); toast({ title: "Zona creada" }); setShowAdd(false); setName(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("zones").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-zones"] }); toast({ title: "Zona actualizada" }); setEditItem(null); setName(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("zones").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog-zones"] }),
    onError: () => toast({ title: "Error al cambiar estado", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("zones").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-zones"] }); toast({ title: "Zona eliminada" }); setDeleteItem(null); },
    onError: (e: Error) => toast({ title: "Error al eliminar", description: e.message, variant: "destructive" }),
  });

  const all = (zones ?? []).map((z) => ({
    id: z.id,
    name: z.name,
    is_active: z.is_active,
    city_id: z.city_id,
    city: (z as { cities?: { name: string } | null }).cities?.name ?? null,
  }));
  const term = search.trim().toLowerCase();
  const filtered = all.filter(
    (z) => (cityFilter === "all" || z.city_id === cityFilter) && (!term || z.name.toLowerCase().includes(term)),
  );

  return (
    <>
      <CatalogPanel
        title="Zonas"
        description="Zonas dentro de cada ciudad. Cada consultorio se ubica en una zona y un doctor no puede tener dos consultorios activos en la misma."
        addLabel="Agregar zona"
        onAdd={() => { setShowAdd(true); setName(""); setNewZoneCityId(""); }}
        toolbar={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar zona…" />
            <Select value={cityFilter} onValueChange={setCityFilter}>
              <SelectTrigger className="h-9 w-full text-sm sm:w-[180px]" aria-label="Ciudad"><SelectValue placeholder="Filtrar por ciudad" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las ciudades</SelectItem>
                {(cities ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <ResultCount shown={filtered.length} total={all.length} loading={isLoading} />
          </>
        }
      >
        <CatalogTable
          loading={isLoading}
          items={filtered}
          total={all.length}
          filtered={!!term || cityFilter !== "all"}
          empty={{ icon: MapPin, title: "Aún no hay zonas", description: "Agrega zonas dentro de una ciudad para ubicar los consultorios." }}
          subtitle={(z) => <span className="sm:hidden">{z.city ?? "Sin ciudad"}</span>}
          columns={[{ header: "Ciudad", className: "hidden sm:table-cell", render: (z) => z.city ?? "—" }]}
          onEdit={(z) => { setEditItem({ id: z.id, name: z.name }); setName(z.name); }}
          onToggle={(z, active) => toggleMut.mutate({ id: z.id, is_active: active })}
          onDelete={(z) => setDeleteItem({ id: z.id, name: z.name })}
        />
      </CatalogPanel>
      {/* Add dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar zona</DialogTitle>
            <DialogDescription>Selecciona la ciudad e ingresa el nombre de la zona.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Ciudad *</Label>
              <Select value={newZoneCityId || "none"} onValueChange={(v) => setNewZoneCityId(v === "none" ? "" : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Seleccionar ciudad</SelectItem>
                  {(cities ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-name`} className="text-sm">Nombre *</Label>
              <Input id={`${fieldId}-name`} className="h-9 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>Cancelar</Button>
            <Button size="sm" onClick={() => { if (name.trim() && newZoneCityId) addMut.mutate({ name: name.trim(), city_id: newZoneCityId }); }} disabled={addMut.isPending || !newZoneCityId}>
              {addMut.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Edit dialog */}
      <CatalogFormDialog
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title="Editar zona"
        name={name}
        setName={setName}
        onSave={() => { if (editItem && name.trim()) editMut.mutate({ id: editItem.id, name: name.trim() }); }}
        saving={editMut.isPending}
      />
      <DeleteConfirmDialog
        open={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={() => { if (deleteItem) deleteMut.mutate(deleteItem.id); }}
        itemName={deleteItem?.name ?? ""}
        deleting={deleteMut.isPending}
      />
    </>
  );
}

/* ═══════ Specialties Tab ═══════ */

function SpecialtiesTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<{ id: string; name: string; color: string | null } | null>(null);
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data: specialties, isLoading } = useQuery({
    queryKey: ["catalog-specialties"],
    queryFn: async () => {
      const { data, error } = await supabase.from("specialties").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const addMut = useMutation({
    mutationFn: async ({ name, color }: { name: string; color: string | null }) => {
      const { error } = await supabase.from("specialties").insert({ name, color });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-specialties"] }); qc.invalidateQueries({ queryKey: ["specialties"] }); toast({ title: "Especialidad creada" }); setShowAdd(false); setName(""); setColor(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: async ({ id, name, color }: { id: string; name: string; color: string | null }) => {
      const { error } = await supabase.from("specialties").update({ name, color }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-specialties"] }); qc.invalidateQueries({ queryKey: ["specialties"] }); toast({ title: "Especialidad actualizada" }); setEditItem(null); setName(""); setColor(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("specialties").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog-specialties"] }),
    onError: () => toast({ title: "Error al cambiar estado", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("specialties").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-specialties"] }); qc.invalidateQueries({ queryKey: ["specialties"] }); toast({ title: "Especialidad eliminada" }); setDeleteItem(null); },
    onError: (e: Error) => toast({ title: "Error al eliminar", description: e.message, variant: "destructive" }),
  });

  const all = specialties ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter((s) => !term || s.name.toLowerCase().includes(term));

  return (
    <>
      <CatalogPanel
        title="Especialidades"
        description="Especialidades que se asignan a los doctores. El color identifica a cada especialidad en los listados."
        addLabel="Agregar especialidad"
        onAdd={() => { setShowAdd(true); setName(""); setColor(""); }}
        toolbar={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar especialidad…" />
            <ResultCount shown={rows.length} total={all.length} loading={isLoading} />
          </>
        }
      >
        <CatalogTable
          loading={isLoading}
          items={rows}
          total={all.length}
          filtered={!!term}
          empty={{ icon: Stethoscope, title: "Aún no hay especialidades", description: "Agrega las especialidades que se asignan a los doctores." }}
          leading={(item) => (
            <span
              className="h-3 w-3 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: item.color || "#6B7280" }}
              aria-hidden
            />
          )}
          onEdit={(item) => { setEditItem({ id: item.id, name: item.name, color: item.color }); setName(item.name); setColor(item.color || ""); }}
          onToggle={(item, active) => toggleMut.mutate({ id: item.id, is_active: active })}
          onDelete={(item) => setDeleteItem({ id: item.id, name: item.name })}
        />
      </CatalogPanel>

      {/* Add specialty dialog */}
      <SpecialtyFormDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Agregar especialidad"
        name={name}
        setName={setName}
        color={color}
        setColor={setColor}
        onSave={() => { if (name.trim()) addMut.mutate({ name: name.trim(), color: color || null }); }}
        saving={addMut.isPending}
      />

      {/* Edit specialty dialog */}
      <SpecialtyFormDialog
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title="Editar especialidad"
        name={name}
        setName={setName}
        color={color}
        setColor={setColor}
        onSave={() => { if (editItem && name.trim()) editMut.mutate({ id: editItem.id, name: name.trim(), color: color || null }); }}
        saving={editMut.isPending}
      />

      <DeleteConfirmDialog
        open={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={() => { if (deleteItem) deleteMut.mutate(deleteItem.id); }}
        itemName={deleteItem?.name ?? ""}
        deleting={deleteMut.isPending}
      />
    </>
  );
}

/* ═══════ Specialty Form Dialog (with color picker) ═══════ */

function SpecialtyFormDialog({
  open,
  onClose,
  title,
  name,
  setName,
  color,
  setColor,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  name: string;
  setName: (v: string) => void;
  color: string;
  setColor: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const fieldId = useId();
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Ingresa el nombre y elige un color para identificarla.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-name`} className="text-sm">Nombre *</Label>
            <Input
              id={`${fieldId}-name`}
              className="h-9 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-color`} className="text-sm">Color</Label>
            <div className="flex flex-wrap gap-2">
              {SPECIALTY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Usar color ${c}`}
                  aria-pressed={color === c}
                  className={cn(
                    "h-7 w-7 rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    color === c && "scale-110 ring-2 ring-foreground/50",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span
                className="h-9 w-9 shrink-0 rounded-md border border-border"
                style={{ backgroundColor: color || "#6B7280" }}
                aria-hidden
              />
              <Input
                id={`${fieldId}-color`}
                placeholder="#HEX personalizado"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 flex-1 font-mono text-sm"
              />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !name.trim()}>{saving ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════ Shared name-only form ═══════ */

function CatalogFormDialog({
  open,
  onClose,
  title,
  name,
  setName,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  name: string;
  setName: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const fieldId = useId();
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Ingresa el nombre del registro.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-name`} className="text-sm">Nombre *</Label>
          <Input
            id={`${fieldId}-name`}
            className="h-9 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !name.trim()}>{saving ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════ Main ═══════ */

const CATALOGS: { value: string; label: string; icon: IconType; render: () => ReactNode }[] = [
  { value: "especialidades", label: "Especialidades", icon: Stethoscope, render: () => <SpecialtiesTab /> },
  { value: "ciudades", label: "Ciudades", icon: Landmark, render: () => <CitiesTab /> },
  { value: "zonas", label: "Zonas", icon: MapPin, render: () => <ZonesTab /> },
  { value: "hospitales", label: "Hospitales", icon: Building2, render: () => <FacilitiesTab type="hospitals" /> },
  { value: "laboratorios", label: "Laboratorios", icon: FlaskConical, render: () => <FacilitiesTab type="laboratories" /> },
];

export default function Catalogos() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("catalogo");
  const tab = CATALOGS.some((c) => c.value === requested) ? (requested as string) : CATALOGS[0].value;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Catálogos"
        description="Listas base de la plataforma. Desactiva un registro para dejar de ofrecerlo sin borrarlo."
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === CATALOGS[0].value ? {} : { catalogo: v }, { replace: true })}
        orientation="vertical"
        className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start"
      >
        <TabsList
          aria-label="Catálogos"
          className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg border bg-card p-1 shadow-sm lg:sticky lg:top-20 lg:flex-col lg:items-stretch lg:overflow-visible"
        >
          {CATALOGS.map((c) => (
            <TabsTrigger
              key={c.value}
              value={c.value}
              className="h-8 shrink-0 justify-start gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none lg:h-9"
            >
              <c.icon className="h-4 w-4" />
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {CATALOGS.map((c) => (
          <TabsContent key={c.value} value={c.value} className="mt-0 min-w-0">
            {c.render()}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/* ═══════ Facilities Tab (Hospitals / Laboratories) ═══════ */

interface FacilityItem {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city_id: string | null;
  zone_id: string | null;
  is_active: boolean;
  cities?: { name: string } | null;
  zones?: { name: string } | null;
}

function FacilitiesTab({ type }: { type: "hospitals" | "laboratories" }) {
  const qc = useQueryClient();
  const fieldId = useId();
  const label = type === "hospitals" ? "Hospital" : "Laboratorio";
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<FacilityItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [cityId, setCityId] = useState("");
  const [zoneId, setZoneId] = useState("");

  const { data: cities } = useQuery({
    queryKey: ["catalog-cities-active"],
    queryFn: async () => {
      const { data } = await supabase.from("cities").select("id, name").eq("is_active", true).order("name");
      return data ?? [];
    },
  });

  const { data: zones } = useQuery({
    queryKey: ["catalog-zones-active", cityId],
    queryFn: async () => {
      let q = supabase.from("zones").select("id, name").eq("is_active", true).order("name");
      if (cityId) q = q.eq("city_id", cityId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: items, isLoading } = useQuery({
    queryKey: [`catalog-${type}`],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(type)
        .select("*, cities(name), zones(name)")
        .order("name");
      if (error) throw error;
      return (data ?? []) as FacilityItem[];
    },
  });

  const resetForm = () => {
    setName(""); setPhone(""); setEmail(""); setAddress(""); setCityId(""); setZoneId("");
  };

  const addMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from(type).insert({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        city_id: cityId || null,
        zone_id: zoneId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`catalog-${type}`] }); toast({ title: `${label} creado` }); setShowAdd(false); resetForm(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: async () => {
      if (!editItem) return;
      const { error } = await supabase.from(type).update({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        city_id: cityId || null,
        zone_id: zoneId || null,
      }).eq("id", editItem.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`catalog-${type}`] }); toast({ title: `${label} actualizado` }); setEditItem(null); resetForm(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from(type).update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [`catalog-${type}`] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(type).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`catalog-${type}`] }); toast({ title: `${label} eliminado` }); setDeleteItem(null); },
    onError: (e: Error) => toast({ title: "Error al eliminar", description: e.message, variant: "destructive" }),
  });

  const openEdit = (item: FacilityItem) => {
    setEditItem(item);
    setName(item.name);
    setPhone(item.phone ?? "");
    setEmail(item.email ?? "");
    setAddress(item.address ?? "");
    setCityId(item.city_id ?? "");
    setZoneId(item.zone_id ?? "");
  };

  const all = items ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter(
    (i) => !term || i.name.toLowerCase().includes(term) || (i.address ?? "").toLowerCase().includes(term),
  );

  const formDialog = (open: boolean, onClose: () => void, title: string, onSave: () => void, saving: boolean) => (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Completa los datos del {label.toLowerCase()}. Solo el nombre es obligatorio.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-name`} className="text-sm">Nombre *</Label>
            <Input id={`${fieldId}-name`} className="h-9 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-phone`} className="text-sm">Teléfono</Label>
            <Input id={`${fieldId}-phone`} className="h-9 text-sm" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-email`} className="text-sm">Email</Label>
            <Input id={`${fieldId}-email`} className="h-9 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-address`} className="text-sm">Dirección</Label>
            <Input id={`${fieldId}-address`} className="h-9 text-sm" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Ciudad</Label>
            <Select value={cityId || "none"} onValueChange={(v) => { setCityId(v === "none" ? "" : v); setZoneId(""); }}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin ciudad</SelectItem>
                {(cities ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Zona</Label>
            <Select value={zoneId || "none"} onValueChange={(v) => setZoneId(v === "none" ? "" : v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin zona</SelectItem>
                {(zones ?? []).map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !name.trim()}>{saving ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const isHospital = type === "hospitals";

  return (
    <>
      <CatalogPanel
        title={isHospital ? "Hospitales" : "Laboratorios"}
        description={
          isHospital
            ? "Hospitales a los que se puede enviar el reporte post-consulta de un paciente."
            : "Laboratorios a los que se puede enviar el reporte post-consulta de un paciente."
        }
        addLabel={`Agregar ${label.toLowerCase()}`}
        onAdd={() => { setShowAdd(true); resetForm(); }}
        toolbar={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre o dirección…" />
            <ResultCount shown={rows.length} total={all.length} loading={isLoading} />
          </>
        }
      >
        <CatalogTable
          loading={isLoading}
          items={rows}
          total={all.length}
          filtered={!!term}
          empty={{
            icon: isHospital ? Building2 : FlaskConical,
            title: isHospital ? "Aún no hay hospitales" : "Aún no hay laboratorios",
            description: "Agrega el primero para poder elegirlo como destino de los reportes post-consulta.",
          }}
          subtitle={(item) => {
            const contact = [item.address, item.phone, item.email].filter(Boolean).join(" · ");
            const place = [item.cities?.name, item.zones?.name].filter(Boolean).join(" · ");
            return (
              <>
                {contact && <p className="break-words">{contact}</p>}
                {place && <p className="md:hidden">{place}</p>}
              </>
            );
          }}
          columns={[
            { header: "Ciudad", className: "hidden md:table-cell", render: (item) => item.cities?.name ?? "—" },
            { header: "Zona", className: "hidden lg:table-cell", render: (item) => item.zones?.name ?? "—" },
          ]}
          onEdit={openEdit}
          onToggle={(item, active) => toggleMut.mutate({ id: item.id, is_active: active })}
          onDelete={(item) => setDeleteItem({ id: item.id, name: item.name })}
        />
      </CatalogPanel>
      {formDialog(showAdd, () => setShowAdd(false), `Agregar ${label.toLowerCase()}`, () => { if (name.trim()) addMut.mutate(); }, addMut.isPending)}
      {formDialog(!!editItem, () => setEditItem(null), `Editar ${label.toLowerCase()}`, () => { if (name.trim()) editMut.mutate(); }, editMut.isPending)}
      <DeleteConfirmDialog
        open={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={() => { if (deleteItem) deleteMut.mutate(deleteItem.id); }}
        itemName={deleteItem?.name ?? ""}
        deleting={deleteMut.isPending}
      />
    </>
  );
}
