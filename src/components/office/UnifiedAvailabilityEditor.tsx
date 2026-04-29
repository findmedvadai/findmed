// Weekly availability across ALL of a doctor's offices, grouped by day.
//
// Layout: one section per day of the week (fixed, not selectable). Inside
// each day's section, a list of blocks; each block carries its own office
// selector, start/end times, and an enable toggle. Adding a block to a day
// just appends a new row to that section.
//
// Multiple blocks per day per office are valid as long as they don't overlap
// (validated locally on save). Multiple blocks per day across different
// offices are always valid (different physical locations).
//
// IMPORTANT: do NOT default `data` to `[]` in useQuery — the literal default
// would generate a fresh array reference on every render and trigger an
// infinite setRows → re-render loop with the dependency-array effect below.
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TimePicker } from "@/components/ui/time-picker";
import { supabase } from "@/integrations/supabase/client";

interface OfficeRow {
  id: string;
  name: string;
  display_color: string;
  is_active: boolean;
}

interface AvailabilityRow {
  id?: string;
  office_id: string;
  doctor_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_enabled: boolean;
  _temp?: boolean;
}

const WEEKDAYS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

interface Props {
  doctorId: string;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function findOverlap(rows: AvailabilityRow[]): { officeId: string; weekday: number } | null {
  const groups = new Map<string, AvailabilityRow[]>();
  for (const r of rows.filter((x) => x.is_enabled)) {
    const key = `${r.office_id}|${r.weekday}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  for (const [key, list] of groups.entries()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const aStart = timeToMinutes(list[i].start_time);
        const aEnd = timeToMinutes(list[i].end_time);
        const bStart = timeToMinutes(list[j].start_time);
        const bEnd = timeToMinutes(list[j].end_time);
        if (aStart < bEnd && bStart < aEnd) {
          const [officeId, weekday] = key.split("|");
          return { officeId, weekday: Number(weekday) };
        }
      }
    }
  }
  return null;
}

export default function UnifiedAvailabilityEditor({ doctorId }: Props) {
  const queryClient = useQueryClient();
  const offKey = ["doctor-offices", doctorId];
  const avKey = ["doctor-all-availability", doctorId];

  const { data: offices } = useQuery<OfficeRow[]>({
    queryKey: offKey,
    queryFn: async () => {
      const { data } = await supabase
        .from("doctor_offices")
        .select("id, name, display_color, is_active")
        .eq("doctor_id", doctorId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true });
      return (data ?? []) as OfficeRow[];
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const activeOffices = useMemo(
    () => (offices ?? []).filter((o) => o.is_active),
    [offices]
  );

  const { data: existing, isLoading } = useQuery<AvailabilityRow[]>({
    queryKey: avKey,
    queryFn: async () => {
      const { data } = await supabase
        .from("doctor_weekly_availability")
        .select("*")
        .eq("doctor_id", doctorId)
        .order("weekday", { ascending: true })
        .order("start_time", { ascending: true });
      return (data ?? []) as AvailabilityRow[];
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  useEffect(() => {
    if (existing) setRows(existing.map((r) => ({
      ...r,
      start_time: r.start_time.slice(0, 5),
      end_time: r.end_time.slice(0, 5),
    })));
  }, [existing]);

  const update = (idx: number, patch: Partial<AvailabilityRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRowForDay = (weekday: number) => {
    if (activeOffices.length === 0) {
      toast.error("Crea al menos un consultorio antes de agregar disponibilidad.");
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        office_id: activeOffices[0].id,
        doctor_id: doctorId,
        weekday,
        start_time: "09:00",
        end_time: "13:00",
        is_enabled: true,
        _temp: true,
      },
    ]);
  };

  const removeRow = async (idx: number) => {
    const target = rows[idx];
    if (target.id) {
      const { error } = await supabase
        .from("doctor_weekly_availability")
        .delete()
        .eq("id", target.id);
      if (error) {
        toast.error("No se pudo borrar el bloque");
        return;
      }
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const overlap = findOverlap(rows);
      if (overlap) {
        const wdName = WEEKDAYS.find((w) => w.value === overlap.weekday)?.label ?? "";
        const offName = (offices ?? []).find((o) => o.id === overlap.officeId)?.name ?? "";
        throw new Error(`Bloques traslapados en ${offName} (${wdName}). Ajusta los horarios.`);
      }

      for (const r of rows) {
        if (timeToMinutes(r.end_time) <= timeToMinutes(r.start_time)) {
          throw new Error("La hora de fin debe ser mayor que la de inicio.");
        }
        const payload = {
          office_id: r.office_id,
          doctor_id: doctorId,
          weekday: r.weekday,
          start_time: r.start_time,
          end_time: r.end_time,
          is_enabled: r.is_enabled,
        };
        if (r.id) {
          const { error } = await supabase
            .from("doctor_weekly_availability")
            .update(payload)
            .eq("id", r.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("doctor_weekly_availability")
            .insert(payload);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success("Disponibilidad guardada");
      queryClient.invalidateQueries({ queryKey: avKey });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading && rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  // Build (weekday → [{row, originalIndex}]) once for stable rendering.
  const rowsByDay = new Map<number, Array<AvailabilityRow & { _index: number }>>();
  for (const wd of WEEKDAYS) rowsByDay.set(wd.value, []);
  rows.forEach((r, i) => {
    rowsByDay.get(r.weekday)?.push({ ...r, _index: i });
  });
  for (const list of rowsByDay.values()) {
    list.sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
  }

  return (
    <div className="space-y-3">
      {WEEKDAYS.map((wd) => {
        const dayRows = rowsByDay.get(wd.value) ?? [];
        return (
          <Card key={wd.value}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">{wd.label}</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => addRowForDay(wd.value)}
                  className="h-7 gap-1 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" /> Agregar bloque
                </Button>
              </div>
              {dayRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin bloques configurados.</p>
              ) : (
                <div className="space-y-2">
                  {dayRows.map((row) => {
                    const officeColor =
                      activeOffices.find((o) => o.id === row.office_id)?.display_color ?? "#6B7280";
                    return (
                      <div
                        key={row._index}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 p-2"
                      >
                        <span
                          className="inline-block h-6 w-1 shrink-0 rounded-sm"
                          style={{ backgroundColor: officeColor }}
                          aria-hidden
                        />
                        <Switch
                          checked={row.is_enabled}
                          onCheckedChange={(v) => update(row._index, { is_enabled: v })}
                        />
                        <TimePicker
                          value={row.start_time}
                          onValueChange={(v) => update(row._index, { start_time: v })}
                          disabled={!row.is_enabled}
                          className="h-8 w-28"
                        />
                        <span className="text-xs text-muted-foreground">a</span>
                        <TimePicker
                          value={row.end_time}
                          onValueChange={(v) => update(row._index, { end_time: v })}
                          disabled={!row.is_enabled}
                          className="h-8 w-28"
                        />
                        <Select
                          value={row.office_id}
                          onValueChange={(v) => update(row._index, { office_id: v })}
                          disabled={!row.is_enabled}
                        >
                          <SelectTrigger className="h-8 flex-1 min-w-[10rem]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {activeOffices.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                <span className="inline-flex items-center gap-2">
                                  <span
                                    className="inline-block h-2 w-2 rounded-full"
                                    style={{ backgroundColor: o.display_color }}
                                  />
                                  {o.name}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => removeRow(row._index)}
                          title="Borrar bloque"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      <div className="flex justify-end pt-1">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="gap-1"
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "Guardando…" : "Guardar disponibilidad"}
        </Button>
      </div>
    </div>
  );
}
