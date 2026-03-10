import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Pencil, Building2, FlaskConical } from "lucide-react";
import { SPECIALTY_COLORS } from "@/lib/specialty-colors";
import { Textarea } from "@/components/ui/textarea";

/* ═══════ Cities Tab ═══════ */

function CitiesTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");

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
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("cities").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-cities"] }); toast({ title: "Ciudad actualizada" }); setEditItem(null); setName(""); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("cities").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog-cities"] }),
    onError: () => toast({ title: "Error al cambiar estado", variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1" onClick={() => { setShowAdd(true); setName(""); }}>
          <Plus className="h-4 w-4" /> Agregar
        </Button>
      </div>
      <CatalogTable
        items={(cities ?? []).map((c) => ({ id: c.id, name: c.name, is_active: c.is_active }))}
        onEdit={(item) => { setEditItem(item); setName(item.name); }}
        onToggle={(id, active) => toggleMut.mutate({ id, is_active: active })}
      />
      <CatalogFormDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Agregar Ciudad"
        name={name}
        setName={setName}
        onSave={() => { if (name.trim()) addMut.mutate(name.trim()); }}
        saving={addMut.isPending}
      />
      <CatalogFormDialog
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title="Editar Ciudad"
        name={name}
        setName={setName}
        onSave={() => { if (editItem && name.trim()) editMut.mutate({ id: editItem.id, name: name.trim() }); }}
        saving={editMut.isPending}
      />
    </div>
  );
}

/* ═══════ Zones Tab ═══════ */

function ZonesTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [newZoneCityId, setNewZoneCityId] = useState("");

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
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("zones").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-zones"] }); toast({ title: "Zona actualizada" }); setEditItem(null); setName(""); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("zones").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog-zones"] }),
    onError: () => toast({ title: "Error al cambiar estado", variant: "destructive" }),
  });

  const filtered = (zones ?? []).filter((z) => cityFilter === "all" || z.city_id === cityFilter);

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Select value={cityFilter} onValueChange={setCityFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Filtrar por ciudad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las ciudades</SelectItem>
            {(cities ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" className="gap-1" onClick={() => { setShowAdd(true); setName(""); setNewZoneCityId(""); }}>
          <Plus className="h-4 w-4" /> Agregar
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Ciudad</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-24">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Sin zonas</TableCell></TableRow>
          )}
          {filtered.map((z) => (
            <TableRow key={z.id}>
              <TableCell className="font-medium">{z.name}</TableCell>
              <TableCell className="text-muted-foreground">{(z as any).cities?.name ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={z.is_active ? "default" : "secondary"}>{z.is_active ? "Activo" : "Inactivo"}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditItem({ id: z.id, name: z.name }); setName(z.name); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Switch checked={z.is_active} onCheckedChange={(v) => toggleMut.mutate({ id: z.id, is_active: v })} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {/* Add dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Agregar Zona</DialogTitle>
            <DialogDescription>Selecciona la ciudad e ingresa el nombre.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Ciudad *</Label>
              <Select value={newZoneCityId || "none"} onValueChange={(v) => setNewZoneCityId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Seleccionar ciudad</SelectItem>
                  {(cities ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancelar</Button>
            <Button onClick={() => { if (name.trim() && newZoneCityId) addMut.mutate({ name: name.trim(), city_id: newZoneCityId }); }} disabled={addMut.isPending || !newZoneCityId}>
              {addMut.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Edit dialog */}
      <CatalogFormDialog
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title="Editar Zona"
        name={name}
        setName={setName}
        onSave={() => { if (editItem && name.trim()) editMut.mutate({ id: editItem.id, name: name.trim() }); }}
        saving={editMut.isPending}
      />
    </div>
  );
}

/* ═══════ Specialties Tab ═══════ */

function SpecialtiesTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<{ id: string; name: string; color: string | null } | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("");

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
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: async ({ id, name, color }: { id: string; name: string; color: string | null }) => {
      const { error } = await supabase.from("specialties").update({ name, color }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-specialties"] }); qc.invalidateQueries({ queryKey: ["specialties"] }); toast({ title: "Especialidad actualizada" }); setEditItem(null); setName(""); setColor(""); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("specialties").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog-specialties"] }),
    onError: () => toast({ title: "Error al cambiar estado", variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1" onClick={() => { setShowAdd(true); setName(""); setColor(""); }}>
          <Plus className="h-4 w-4" /> Agregar
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Color</TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-24">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(specialties ?? []).length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Sin registros</TableCell></TableRow>
          )}
          {(specialties ?? []).map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <span
                  className="inline-block h-5 w-5 rounded-full border border-border"
                  style={{ backgroundColor: item.color || "#6B7280" }}
                />
              </TableCell>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>
                <Badge variant={item.is_active ? "default" : "secondary"}>{item.is_active ? "Activo" : "Inactivo"}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditItem({ id: item.id, name: item.name, color: item.color }); setName(item.name); setColor(item.color || ""); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Switch checked={item.is_active} onCheckedChange={(v) => toggleMut.mutate({ id: item.id, is_active: v })} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Add specialty dialog */}
      <SpecialtyFormDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Agregar Especialidad"
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
        title="Editar Especialidad"
        name={name}
        setName={setName}
        color={color}
        setColor={setColor}
        onSave={() => { if (editItem && name.trim()) editMut.mutate({ id: editItem.id, name: name.trim(), color: color || null }); }}
        saving={editMut.isPending}
      />
    </div>
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
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Ingresa el nombre y elige un color.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nombre *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSave(); }} />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {SPECIALTY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${color === c ? "border-foreground scale-110 ring-2 ring-foreground/20" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span
                className="inline-block h-6 w-6 rounded-full border border-border flex-shrink-0"
                style={{ backgroundColor: color || "#6B7280" }}
              />
              <Input
                placeholder="#HEX personalizado"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="flex-1 text-xs"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={onSave} disabled={saving || !name.trim()}>{saving ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════ Shared components ═══════ */

function CatalogTable({
  items,
  onEdit,
  onToggle,
}: {
  items: { id: string; name: string; is_active: boolean }[];
  onEdit: (item: { id: string; name: string }) => void;
  onToggle: (id: string, active: boolean) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="w-24">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 && (
          <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Sin registros</TableCell></TableRow>
        )}
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-medium">{item.name}</TableCell>
            <TableCell>
              <Badge variant={item.is_active ? "default" : "secondary"}>{item.is_active ? "Activo" : "Inactivo"}</Badge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(item)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Switch checked={item.is_active} onCheckedChange={(v) => onToggle(item.id, v)} />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

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
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Ingresa el nombre del registro.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Nombre *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSave(); }} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={onSave} disabled={saving || !name.trim()}>{saving ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════ Main ═══════ */

export default function Catalogos() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Catálogos</h1>
      <Tabs defaultValue="cities">
        <TabsList>
          <TabsTrigger value="cities">Ciudades</TabsTrigger>
          <TabsTrigger value="zones">Zonas</TabsTrigger>
          <TabsTrigger value="specialties">Especialidades</TabsTrigger>
        </TabsList>
        <TabsContent value="cities"><CitiesTab /></TabsContent>
        <TabsContent value="zones"><ZonesTab /></TabsContent>
        <TabsContent value="specialties"><SpecialtiesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
