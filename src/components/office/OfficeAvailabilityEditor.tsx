// Per-office weekly availability editor. Multiple blocks per day are allowed
// — e.g. morning + afternoon split. We validate locally that blocks within
// the same office on the same day don't overlap before saving.
//
// Each row is a single (weekday, start_time, end_time) block. The "active"
// switch is a soft toggle: a disabled row exists in DB but is_enabled=false.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

interface OfficeRow {
  id: string;
  doctor_id: string;
}

interface AvailabilityRow {
  id?: string;
  office_id: string;
  doctor_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_enabled: boolean;
  // Local-only marker for rows that came from the form, not the DB.
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
  office: OfficeRow;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function blocksOverlapWithinDay(rows: AvailabilityRow[]): { weekday: number } | null {
  for (const day of WEEKDAYS) {
    const dayRows = rows.filter((r) => r.is_enabled && r.weekday === day.value);
    for (let i = 0; i < dayRows.length; i++) {
      for (let j = i + 1; j < dayRows.length; j++) {
        const aStart = timeToMinutes(dayRows[i].start_time);
        const aEnd = timeToMinutes(dayRows[i].end_time);
        const bStart = timeToMinutes(dayRows[j].start_time);
        const bEnd = timeToMinutes(dayRows[j].end_time);
        if (aStart < bEnd && bStart < aEnd) return { weekday: day.value };
      }
    }
  }
  return null;
}

export default function OfficeAvailabilityEditor({ office }: Props) {
  const queryClient = useQueryClient();
  const cacheKey = ["office-availability", office.id];

  const { data: existing = [], isLoading } = useQuery<AvailabilityRow[]>({
    queryKey: cacheKey,
    queryFn: async () => {
      const { data } = await supabase
        .from("doctor_weekly_availability")
        .select("*")
        .eq("office_id", office.id)
        .order("weekday", { ascending: true })
        .order("start_time", { ascending: true });
      return (data ?? []) as AvailabilityRow[];
    },
  });

  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  useEffect(() => {
    if (existing) setRows(existing);
  }, [existing]);

  const updateRow = (idx: number, patch: Partial<AvailabilityRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRow = (weekday: number) => {
    setRows((prev) => [
      ...prev,
      {
        office_id: office.id,
        doctor_id: office.doctor_id,
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
      const overlap = blocksOverlapWithinDay(rows);
      if (overlap) {
        const dayLabel = WEEKDAYS.find((d) => d.value === overlap.weekday)?.label ?? "";
        throw new Error(`Bloques solapados el ${dayLabel} en este consultorio.`);
      }

      for (const row of rows) {
        const payload = {
          office_id: office.id,
          doctor_id: office.doctor_id,
          weekday: row.weekday,
          start_time: row.start_time,
          end_time: row.end_time,
          is_enabled: row.is_enabled,
        };
        if (row.id) {
          const { error } = await supabase
            .from("doctor_weekly_availability")
            .update(payload)
            .eq("id", row.id);
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
      queryClient.invalidateQueries({ queryKey: cacheKey });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const grouped = useMemo(() => {
    const map = new Map<number, AvailabilityRow[]>();
    for (const wd of WEEKDAYS) map.set(wd.value, []);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      map.get(r.weekday)!.push({ ...r, _index: i } as AvailabilityRow & { _index: number });
    }
    return map;
  }, [rows]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  return (
    <div className="space-y-3">
      {WEEKDAYS.map((wd) => {
        const dayRows = (grouped.get(wd.value) ?? []) as Array<AvailabilityRow & { _index: number }>;
        return (
          <div key={wd.value} className="rounded-md border p-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{wd.label}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addRow(wd.value)}
                className="h-7 gap-1 text-xs"
              >
                <Plus className="h-3 w-3" /> Agregar bloque
              </Button>
            </div>
            {dayRows.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin disponibilidad este día.</p>
            )}
            {dayRows.map((row) => (
              <div key={row._index} className="flex items-center gap-2">
                <Switch
                  checked={row.is_enabled}
                  onCheckedChange={(v) => updateRow(row._index, { is_enabled: v })}
                />
                <Input
                  type="time"
                  value={row.start_time}
                  onChange={(e) => updateRow(row._index, { start_time: e.target.value })}
                  disabled={!row.is_enabled}
                  className="w-28 h-8 text-xs"
                />
                <span className="text-xs text-muted-foreground">a</span>
                <Input
                  type="time"
                  value={row.end_time}
                  onChange={(e) => updateRow(row._index, { end_time: e.target.value })}
                  disabled={!row.is_enabled}
                  className="w-28 h-8 text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => removeRow(row._index)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        );
      })}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="gap-1"
        >
          <Save className="h-3 w-3" />
          {saveMutation.isPending ? "Guardando…" : "Guardar disponibilidad"}
        </Button>
      </div>
    </div>
  );
}
