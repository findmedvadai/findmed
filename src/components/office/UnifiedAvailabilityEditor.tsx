// Single-table weekly availability editor across ALL of a doctor's offices.
// Each block carries its own office selector; multiple blocks can share a day
// (split shifts) or a doctor can run two offices on the same day with
// non-overlapping hours.
//
// Validation is local (no overlap within the same office on the same day) and
// runs on save. Times use the design-system TimePicker (shadcn-based) instead
// of native <input type="time">.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  _index?: number;
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
  // Group by (office_id, weekday) and check pairwise overlap.
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

  const { data: offices = [] } = useQuery<OfficeRow[]>({
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
  });
  const activeOffices = useMemo(() => offices.filter((o) => o.is_active), [offices]);

  const { data: existing = [], isLoading } = useQuery<AvailabilityRow[]>({
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
  });

  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  useEffect(() => {
    if (existing) setRows(existing);
  }, [existing]);

  const update = (idx: number, patch: Partial<AvailabilityRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    if (activeOffices.length === 0) {
      toast.error("Crea al menos un consultorio antes de agregar disponibilidad.");
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        office_id: activeOffices[0].id,
        doctor_id: doctorId,
        weekday: 1,
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
        const offName = offices.find((o) => o.id === overlap.officeId)?.name ?? "";
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

  if (isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  // Sorted copy for stable rendering. We track original index inside the
  // unsorted array via the row's _index, set just before render.
  const indexed = rows.map((r, i) => ({ ...r, _index: i }));
  const sorted = [...indexed].sort(
    (a, b) =>
      a.weekday - b.weekday ||
      timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
  );

  return (
    <div className="space-y-3">
      {sorted.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Aún no tienes horarios. Agrega tu primer bloque para empezar a recibir citas.
          </CardContent>
        </Card>
      )}

      {sorted.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Activo</th>
                <th className="px-3 py-2 text-left font-medium">Día</th>
                <th className="px-3 py-2 text-left font-medium">Inicio</th>
                <th className="px-3 py-2 text-left font-medium">Fin</th>
                <th className="px-3 py-2 text-left font-medium">Consultorio</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row._index} className="border-t">
                  <td className="px-3 py-2">
                    <Switch
                      checked={row.is_enabled}
                      onCheckedChange={(v) => update(row._index!, { is_enabled: v })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={String(row.weekday)}
                      onValueChange={(v) => update(row._index!, { weekday: Number(v) })}
                      disabled={!row.is_enabled}
                    >
                      <SelectTrigger className="h-8 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAYS.map((wd) => (
                          <SelectItem key={wd.value} value={String(wd.value)}>
                            {wd.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <TimePicker
                      value={row.start_time}
                      onValueChange={(v) => update(row._index!, { start_time: v })}
                      disabled={!row.is_enabled}
                      className="h-8 w-28"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <TimePicker
                      value={row.end_time}
                      onValueChange={(v) => update(row._index!, { end_time: v })}
                      disabled={!row.is_enabled}
                      className="h-8 w-28"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={row.office_id}
                      onValueChange={(v) => update(row._index!, { office_id: v })}
                      disabled={!row.is_enabled}
                    >
                      <SelectTrigger className="h-8 w-44">
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
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => removeRow(row._index!)}
                      title="Borrar bloque"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={addRow} className="gap-1">
          <Plus className="h-4 w-4" /> Agregar bloque
        </Button>
        <Button
          size="sm"
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
