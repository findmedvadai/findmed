// Condiciones del catálogo de triaje: conteos, búsqueda y filtros, y acciones
// (crear, editar, duplicar, activar/desactivar, eliminar).
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, Copy, ListChecks, MoreHorizontal, Pencil, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import { plural } from "@/lib/plural";
import { FilterBar, SearchInput } from "@/components/app/FilterBar";
import { StatCard } from "@/components/app/StatCard";
import { SoftBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import {
  EMPTY_FILTERS,
  LIGHT,
  ORIGEN_LABEL,
  ROUTING,
  countConditions,
  filterConditions,
  hasActiveFilters,
  keywordLabel,
  triageAdmin,
  type ConditionFilters,
  type TriageCondition,
  type TriageMapping,
  type TriageVocabulary,
} from "@/lib/triage-admin";
import { ConditionSheet } from "./ConditionSheet";
import { invalidateTriage } from "./queries";

interface ConditionsViewProps {
  conditions: TriageCondition[] | undefined;
  loading: boolean;
  mappings: TriageMapping[];
  vocabulary: TriageVocabulary | undefined;
}

export function ConditionsView({ conditions, loading, mappings, vocabulary }: ConditionsViewProps) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ConditionFilters>(EMPTY_FILTERS);
  const [sheet, setSheet] = useState<{ key: number; condition: TriageCondition | null } | null>(null);
  const [toDelete, setToDelete] = useState<TriageCondition | null>(null);

  const all = useMemo(() => conditions ?? [], [conditions]);
  const rows = useMemo(() => filterConditions(all, filters), [all, filters]);
  const counts = useMemo(() => countConditions(all), [all]);
  const labelOf = useMemo(() => new Map(mappings.map((m) => [m.especialidad, m.patient_label])), [mappings]);
  const specialtyOptions = useMemo(() => [...new Set(all.map((c) => c.especialidad))].sort(), [all]);
  const origenOptions = useMemo(() => [...new Set(all.map((c) => c.origen).filter(Boolean) as string[])].sort(), [all]);
  const set = <K extends keyof ConditionFilters>(k: K, v: ConditionFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const open = (condition: TriageCondition | null) => setSheet({ key: Date.now(), condition });

  const onError = (e: Error) => toast({ title: "No se guardó", description: e.message, variant: "destructive" });

  const toggleActive = useMutation({
    mutationFn: (c: TriageCondition) =>
      triageAdmin({ action: "condition_set_active", id: c.id, is_active: !c.is_active, expected_updated_at: c.updated_at }),
    onSuccess: (_d, c) => {
      invalidateTriage(qc);
      toast({ title: c.is_active ? "Condición desactivada" : "Condición activada", description: c.is_active ? "El agente deja de usarla." : "El agente ya la usa." });
    },
    onError: (e: Error) => { invalidateTriage(qc); onError(e); },
  });

  const duplicate = useMutation({
    mutationFn: (c: TriageCondition) => triageAdmin<{ condition: TriageCondition }>({ action: "condition_duplicate", id: c.id }),
    onSuccess: (res) => {
      invalidateTriage(qc);
      toast({ title: "Copia creada", description: "Queda inactiva y sin validar hasta que la revises y la actives." });
      open(res.condition);
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: (c: TriageCondition) => triageAdmin({ action: "condition_delete", id: c.id }),
    onSuccess: () => {
      invalidateTriage(qc);
      toast({ title: "Condición eliminada", description: "Queda registrada en el historial de cambios." });
      setToDelete(null);
    },
    onError,
  });

  const filtered = hasActiveFilters(filters);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Condiciones activas" value={loading ? "—" : counts.active} hint={counts.inactive ? plural(counts.inactive, "inactiva", "inactivas") : "Todas activas"} icon={ListChecks} />
        <StatCard
          label="Validadas"
          value={loading ? "—" : `${counts.validated} de ${counts.total}`}
          hint={counts.total - counts.validated ? `${counts.total - counts.validated} pendientes de revisión clínica` : "Todo validado"}
          icon={ShieldCheck}
          tone={counts.total && counts.validated === counts.total ? "success" : "warning"}
        />
        <Card className="p-4 sm:col-span-2">
          <p className="text-xs font-medium text-muted-foreground">Activas por primera parada</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(ROUTING).map(([k, r]) => (
              <button
                key={k}
                type="button"
                onClick={() => set("routing", filters.routing === k ? "all" : k)}
                className={cn("rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring", filters.routing === k && "ring-2 ring-primary/40")}
                aria-pressed={filters.routing === k}
              >
                <SoftBadge tone={r.tone} dot>
                  {r.label} · {loading ? "—" : counts.byRouting[k] ?? 0}
                </SoftBadge>
              </button>
            ))}
            {(counts.byRouting.sin_definir ?? 0) > 0 && <SoftBadge>Sin definir · {counts.byRouting.sin_definir}</SoftBadge>}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">Condiciones</h2>
            <p className="text-xs text-muted-foreground">
              Cada condición dice a qué especialidad y a qué primera parada orienta el agente según las palabras clave del paciente.
            </p>
          </div>
          <Button size="sm" className="shrink-0 gap-1.5 self-start" onClick={() => open(null)} disabled={!mappings.length}>
            <Plus className="h-4 w-4" /> Nueva condición
          </Button>
        </div>
        <div className="space-y-2 border-t px-4 py-3">
          <FilterBar>
            <SearchInput value={filters.search} onChange={(v) => set("search", v)} placeholder="Buscar padecimiento, término o nota…" />
            <Select value={filters.especialidad} onValueChange={(v) => set("especialidad", v)}>
              <SelectTrigger className="h-9 w-[180px] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las especialidades</SelectItem>
                {specialtyOptions.map((s) => <SelectItem key={s} value={s}>{labelOf.get(s) ?? s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.routing} onValueChange={(v) => set("routing", v)}>
              <SelectTrigger className="h-9 w-[180px] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda primera parada</SelectItem>
                {Object.entries(ROUTING).map(([k, r]) => <SelectItem key={k} value={k}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.light} onValueChange={(v) => set("light", v)}>
              <SelectTrigger className="h-9 w-[150px] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo semáforo</SelectItem>
                {Object.entries(LIGHT).map(([k, l]) => <SelectItem key={k} value={k}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.validated} onValueChange={(v) => set("validated", v as ConditionFilters["validated"])}>
              <SelectTrigger className="h-9 w-[150px] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Validadas y no</SelectItem>
                <SelectItem value="yes">Validadas</SelectItem>
                <SelectItem value="no">Sin validar</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.origen} onValueChange={(v) => set("origen", v)}>
              <SelectTrigger className="h-9 w-[160px] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo origen</SelectItem>
                {origenOptions.map((o) => <SelectItem key={o} value={o}>{ORIGEN_LABEL[o] ?? o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => set("status", v as ConditionFilters["status"])}>
              <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Activas e inactivas</SelectItem>
                <SelectItem value="active">Activas</SelectItem>
                <SelectItem value="inactive">Inactivas</SelectItem>
              </SelectContent>
            </Select>
            {filtered && (
              <Button size="sm" variant="ghost" className="h-9" onClick={() => setFilters(EMPTY_FILTERS)}>Limpiar</Button>
            )}
            {!loading && (
              <span className="ml-auto text-xs text-muted-foreground">
                {rows.length === all.length ? plural(all.length, "condición", "condiciones") : `${rows.length} de ${all.length}`}
              </span>
            )}
          </FilterBar>
        </div>
        <div className="border-t">
          {loading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : rows.length === 0 ? (
            filtered && all.length ? (
              <EmptyState icon={Search} title="Sin resultados" description="Ninguna condición coincide con la búsqueda o los filtros." className="rounded-none border-0" />
            ) : (
              <EmptyState icon={ListChecks} title="El catálogo está vacío" description="Agrega la primera condición para que el agente pueda orientar por síntomas." className="rounded-none border-0" />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="h-9 pl-4 pr-3 text-xs">Padecimiento</TableHead>
                  <TableHead className="hidden h-9 px-3 text-xs md:table-cell">Especialidad</TableHead>
                  <TableHead className="hidden h-9 px-3 text-xs lg:table-cell">Semáforo</TableHead>
                  <TableHead className="h-9 px-3 text-xs">Primera parada</TableHead>
                  <TableHead className="hidden h-9 px-3 text-xs sm:table-cell">Validada</TableHead>
                  <TableHead className="h-9 w-[64px] px-3 text-xs">Activa</TableHead>
                  <TableHead className="h-9 w-[48px] px-3 text-xs"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const route = ROUTING[c.primera_parada ?? ""];
                  const light = LIGHT[c.semaforo ?? ""];
                  const name = c.padecimiento ?? `Condición ${c.id}`;
                  return (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => open(c)}>
                      <TableCell className="py-2.5 pl-4 pr-3">
                        <p className={cn("break-words text-sm font-medium", c.is_active ? "text-foreground" : "text-muted-foreground")}>{name}</p>
                        <p className="line-clamp-1 text-xs text-muted-foreground">{(c.keywords ?? []).map(keywordLabel).join(" · ")}</p>
                        <p className="text-xs text-muted-foreground md:hidden">{labelOf.get(c.especialidad) ?? c.especialidad}</p>
                      </TableCell>
                      <TableCell className="hidden px-3 py-2.5 text-sm text-muted-foreground md:table-cell">{labelOf.get(c.especialidad) ?? c.especialidad}</TableCell>
                      <TableCell className="hidden px-3 py-2.5 lg:table-cell">{light ? <SoftBadge tone={light.tone} dot>{light.label}</SoftBadge> : "—"}</TableCell>
                      <TableCell className="px-3 py-2.5">{route ? <SoftBadge tone={route.tone}>{route.label}</SoftBadge> : <SoftBadge>Sin definir</SoftBadge>}</TableCell>
                      <TableCell className="hidden px-3 py-2.5 sm:table-cell">
                        {c.validado ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Sí</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CircleDashed className="h-3.5 w-3.5" /> Pendiente</span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={c.is_active}
                          disabled={toggleActive.isPending && toggleActive.variables?.id === c.id}
                          onCheckedChange={() => toggleActive.mutate(c)}
                          aria-label={`${c.is_active ? "Desactivar" : "Activar"} ${name}`}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Acciones de ${name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => open(c)}><Pencil className="mr-2 h-3.5 w-3.5" /> Editar</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => duplicate.mutate(c)} disabled={duplicate.isPending}><Copy className="mr-2 h-3.5 w-3.5" /> Duplicar</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setToDelete(c)} className="text-destructive focus:text-destructive">
                              <Trash2 className="mr-2 h-3.5 w-3.5" /> Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      {sheet && (
        <ConditionSheet
          key={sheet.key}
          open
          onOpenChange={(o) => { if (!o) setSheet(null); }}
          condition={sheet.condition}
          mappings={mappings}
          vocabulary={vocabulary}
        />
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar condición</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Eliminar <strong>{toDelete?.padecimiento ?? "esta condición"}</strong>? El agente deja de usarla de inmediato y no se
              puede deshacer (queda una copia en el historial de cambios). Si solo quieres pausarla, desactívala con el interruptor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (toDelete) remove.mutate(toDelete); }}
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.isPending ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
