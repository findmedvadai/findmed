// Mapeo especialidad del catálogo → cómo se le dice al paciente y qué
// especialidades de FindMed busca el agente (en orden). Avisa cuando una
// especialidad de búsqueda no tiene médicos activos.
import { useId, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, Pencil, Plus, Route, Trash2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { plural } from "@/lib/plural";
import { SoftBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { triageAdmin, type SpecialtyCoverage, type TriageCondition, type TriageMapping } from "@/lib/triage-admin";
import { invalidateTriage, useSpecialtyCoverage } from "./queries";

interface SpecialtyMapViewProps {
  mappings: TriageMapping[] | undefined;
  loading: boolean;
  conditions: TriageCondition[];
}

interface MapForm {
  especialidad: string;
  patient_label: string;
  search_specialties: string[];
  notes: string;
}

export function SpecialtyMapView({ mappings, loading, conditions }: SpecialtyMapViewProps) {
  const qc = useQueryClient();
  const { data: coverage, isLoading: loadingCoverage } = useSpecialtyCoverage();
  const [editing, setEditing] = useState<{ key: number; mapping: TriageMapping | null } | null>(null);
  const [toDelete, setToDelete] = useState<TriageMapping | null>(null);

  const coverageByName = useMemo(() => new Map((coverage ?? []).map((s) => [s.name, s])), [coverage]);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of conditions) m.set(c.especialidad, (m.get(c.especialidad) ?? 0) + 1);
    return m;
  }, [conditions]);

  const remove = useMutation({
    mutationFn: (m: TriageMapping) => triageAdmin({ action: "map_delete", especialidad: m.especialidad }),
    onSuccess: () => {
      invalidateTriage(qc);
      toast({ title: "Especialidad quitada del mapeo" });
      setToDelete(null);
    },
    onError: (e: Error) => toast({ title: "No se eliminó", description: e.message, variant: "destructive" }),
  });

  const rows = mappings ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold text-foreground">Mapeo de especialidades</h2>
          <p className="text-xs text-muted-foreground">
            Cómo le dice el agente al paciente cada especialidad del catálogo y qué especialidades de FindMed busca, en orden. Sin
            especialidades de búsqueda, el agente pasa el caso a una persona.
          </p>
        </div>
        <Button size="sm" className="shrink-0 gap-1.5 self-start" onClick={() => setEditing({ key: Date.now(), mapping: null })}>
          <Plus className="h-4 w-4" /> Agregar especialidad
        </Button>
      </div>
      <div className="border-t">
        {loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Route} title="Sin especialidades en el mapeo" description="Agrega la primera para poder crear condiciones." className="rounded-none border-0" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="h-9 pl-4 pr-3 text-xs">Especialidad del catálogo</TableHead>
                <TableHead className="h-9 px-3 text-xs">Búsqueda en FindMed</TableHead>
                <TableHead className="hidden h-9 px-3 text-xs md:table-cell">Condiciones</TableHead>
                <TableHead className="h-9 w-[84px] px-3 text-xs"><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.especialidad}>
                  <TableCell className="py-2.5 pl-4 pr-3 align-top">
                    <p className="text-sm font-medium text-foreground">{m.patient_label}</p>
                    <p className="text-xs text-muted-foreground">{m.especialidad}</p>
                    {m.notes && <p className="text-xs text-muted-foreground">{m.notes}</p>}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 align-top">
                    <SearchList names={m.search_specialties} coverage={coverageByName} loading={loadingCoverage} />
                  </TableCell>
                  <TableCell className="hidden px-3 py-2.5 align-top text-sm text-muted-foreground md:table-cell">{usage.get(m.especialidad) ?? 0}</TableCell>
                  <TableCell className="px-3 py-2.5 align-top">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Editar ${m.patient_label}`} onClick={() => setEditing({ key: Date.now(), mapping: m })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Quitar ${m.patient_label}`}
                        onClick={() => setToDelete(m)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {editing && (
        <MappingDialog key={editing.key} mapping={editing.mapping} coverage={coverage ?? []} onClose={() => setEditing(null)} />
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitar del mapeo</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && (usage.get(toDelete.especialidad) ?? 0) > 0
                ? `${plural(usage.get(toDelete.especialidad) ?? 0, "condición usa", "condiciones usan")} esta especialidad: cámbialas o elimínalas antes de quitarla.`
                : `¿Quitar «${toDelete?.patient_label}» del mapeo? Queda registrado en el historial de cambios.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (toDelete) remove.mutate(toDelete); }}
              disabled={remove.isPending || (toDelete ? (usage.get(toDelete.especialidad) ?? 0) > 0 : true)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.isPending ? "Quitando…" : "Quitar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function coverageNote(s: SpecialtyCoverage | undefined): { tone: "warning" | "danger" | "neutral"; text: string } | null {
  if (!s) return { tone: "danger", text: "No existe en Especialidades" };
  if (!s.is_active) return { tone: "warning", text: "Especialidad inactiva" };
  if (s.active_doctors === 0) return { tone: "warning", text: "Sin médicos activos" };
  return null;
}

function SearchList({ names, coverage, loading }: { names: string[]; coverage: Map<string, SpecialtyCoverage>; loading: boolean }) {
  if (names.length === 0) {
    return <SoftBadge tone="warning">Sin búsqueda: pasa a una persona</SoftBadge>;
  }
  return (
    <ol className="space-y-1">
      {names.map((n, i) => {
        const s = coverage.get(n);
        const note = loading ? null : coverageNote(s);
        return (
          <li key={n} className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
            <span className="text-foreground">{n}</span>
            {!loading && s && !note && <span className="text-xs text-muted-foreground">· {plural(s.active_doctors, "médico", "médicos")}</span>}
            {note && (
              <SoftBadge tone={note.tone}>
                <AlertTriangle className="h-3 w-3" /> {note.text}
              </SoftBadge>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function MappingDialog({ mapping, coverage, onClose }: { mapping: TriageMapping | null; coverage: SpecialtyCoverage[]; onClose: () => void }) {
  const qc = useQueryClient();
  const fid = useId();
  const creating = !mapping;
  const [form, setForm] = useState<MapForm>(() => ({
    especialidad: mapping?.especialidad ?? "",
    patient_label: mapping?.patient_label ?? "",
    search_specialties: mapping?.search_specialties ?? [],
    notes: mapping?.notes ?? "",
  }));
  const set = <K extends keyof MapForm>(k: K, v: MapForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const byName = new Map(coverage.map((s) => [s.name, s]));
  const available = coverage.filter((s) => s.is_active && !form.search_specialties.includes(s.name));

  const move = (i: number, d: -1 | 1) => {
    const next = [...form.search_specialties];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set("search_specialties", next);
  };

  const save = useMutation({
    mutationFn: () =>
      triageAdmin<{ warnings: string[] }>({
        action: creating ? "map_create" : "map_update",
        mapping: { ...form, especialidad: form.especialidad.trim(), notes: form.notes.trim() || null },
      }),
    onSuccess: (res) => {
      invalidateTriage(qc);
      toast({ title: creating ? "Especialidad agregada" : "Mapeo actualizado", description: res.warnings?.length ? res.warnings.join(" ") : "El agente ya usa este mapeo." });
      onClose();
    },
    onError: (e: Error) => toast({ title: "No se guardó", description: e.message, variant: "destructive" }),
  });

  const canSave = form.especialidad.trim() && form.patient_label.trim() && !save.isPending;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{creating ? "Agregar especialidad al mapeo" : `Editar «${mapping?.patient_label}»`}</DialogTitle>
          <DialogDescription>
            La etiqueta es lo que el agente le dice al paciente. Las especialidades de búsqueda se intentan en este orden.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-key`}>Clave en el catálogo *</Label>
            <Input
              id={`${fid}-key`}
              className="h-9 text-sm"
              value={form.especialidad}
              onChange={(e) => set("especialidad", e.target.value)}
              disabled={!creating}
              placeholder="Dermatologia"
            />
            {creating && <p className="text-xs text-muted-foreground">Sin acentos ni espacios. No se puede cambiar después.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-label`}>Cómo se le dice al paciente *</Label>
            <Input id={`${fid}-label`} className="h-9 text-sm" value={form.patient_label} onChange={(e) => set("patient_label", e.target.value)} placeholder="Dermatólogo" maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label>Especialidades de búsqueda en FindMed</Label>
            {form.search_specialties.length === 0 ? (
              <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                Ninguna: el agente explica que FindMed no tiene esa especialidad y pasa el caso a una persona.
              </p>
            ) : (
              <ol className="space-y-1">
                {form.search_specialties.map((n, i) => {
                  const note = coverageNote(byName.get(n));
                  return (
                    <li key={n} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
                      <span className="w-4 text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{n}</span>
                      {note && <SoftBadge tone={note.tone}>{note.text}</SoftBadge>}
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir ${n}`}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === form.search_specialties.length - 1} aria-label={`Bajar ${n}`}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => set("search_specialties", form.search_specialties.filter((x) => x !== n))} aria-label={`Quitar ${n}`}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ol>
            )}
            <Select value="" onValueChange={(v) => set("search_specialties", [...form.search_specialties, v])}>
              <SelectTrigger className="h-9 text-sm" disabled={available.length === 0}>
                <SelectValue placeholder={available.length ? "Agregar especialidad activa…" : "No hay más especialidades activas"} />
              </SelectTrigger>
              <SelectContent>
                {available.map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name} · {s.active_doctors ? plural(s.active_doctors, "médico", "médicos") : "sin médicos activos"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-notes`}>Notas</Label>
            <Textarea id={`${fid}-notes`} rows={2} className="text-sm" value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={500} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button size="sm" variant="outline" onClick={onClose} disabled={save.isPending}>Cancelar</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!canSave}>{save.isPending ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
