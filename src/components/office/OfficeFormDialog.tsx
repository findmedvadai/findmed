// Create / edit a doctor's office. Used by the doctor (own office) and the
// admin (any doctor's office). The Edge Function handles the auth check.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface OfficeRow {
  id: string;
  doctor_id: string;
  name: string;
  address: string | null;
  city_id: string | null;
  zone_id: string | null;
  appointment_duration_minutes: number;
  display_color: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  doctorId: string;
  office: OfficeRow | null;
  onSaved: () => void;
}

const DURATION_OPTIONS = [15, 20, 30, 45, 60, 90, 120];
const COLOR_PALETTE = [
  "#2563EB",
  "#16A34A",
  "#DC2626",
  "#9333EA",
  "#EA580C",
  "#0D9488",
  "#DB2777",
  "#65A30D",
];

export default function OfficeFormDialog({ open, onClose, doctorId, office, onSaved }: Props) {
  const isEdit = !!office;
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [cityId, setCityId] = useState<string>("");
  const [zoneId, setZoneId] = useState<string>("");
  const [duration, setDuration] = useState(30);
  const [displayColor, setDisplayColor] = useState<string>(COLOR_PALETTE[0]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (office) {
      setName(office.name);
      setAddress(office.address ?? "");
      setCityId(office.city_id ?? "");
      setZoneId(office.zone_id ?? "");
      setDuration(office.appointment_duration_minutes);
      setDisplayColor(office.display_color || COLOR_PALETTE[0]);
    } else {
      setName("");
      setAddress("");
      setCityId("");
      setZoneId("");
      setDuration(30);
      setDisplayColor(COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)]);
    }
  }, [open, office]);

  const { data: cities = [] } = useQuery({
    queryKey: ["all-cities"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cities")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data ?? [];
    },
  });

  const { data: zones = [] } = useQuery({
    queryKey: ["zones-for-city", cityId],
    queryFn: async () => {
      if (!cityId) return [];
      const { data } = await supabase
        .from("zones")
        .select("id, name, city_id")
        .eq("city_id", cityId)
        .eq("is_active", true)
        .order("name");
      return data ?? [];
    },
    enabled: !!cityId,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No autenticado");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const endpoint = isEdit ? "doctor-office-update" : "doctor-office-create";
      const body = isEdit
        ? {
            office_id: office!.id,
            name: name.trim(),
            address: address.trim() || null,
            city_id: cityId || null,
            zone_id: zoneId || null,
            appointment_duration_minutes: duration,
            display_color: displayColor,
          }
        : {
            doctor_id: doctorId,
            name: name.trim(),
            address: address.trim() || null,
            city_id: cityId || null,
            zone_id: zoneId || null,
            appointment_duration_minutes: duration,
            display_color: displayColor,
          };
      const res = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "zone_taken") {
          throw new Error(data.message ?? "Ya tienes un consultorio en esa zona.");
        }
        throw new Error(data?.error || "Error al guardar");
      }
      return data;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Consultorio actualizado" : "Consultorio creado");
      onSaved();
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const errors: Record<string, string> = {};
  if (!name.trim()) errors.name = "El nombre es requerido";
  if (!address.trim()) errors.address = "La dirección es requerida";
  if (!cityId) errors.cityId = "Selecciona una ciudad";
  if (!zoneId) errors.zoneId = "Selecciona una zona";
  if (!duration || duration < 5) errors.duration = "Duración inválida";
  if (!displayColor) errors.displayColor = "Selecciona un color";
  const canSubmit = Object.keys(errors).length === 0 && !submitting;

  const [showErrors, setShowErrors] = useState(false);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      setShowErrors(true);
      return;
    }
    setSubmitting(true);
    submitMutation.mutate(undefined, { onSettled: () => setSubmitting(false) });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar consultorio" : "Nuevo consultorio"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Actualiza los datos. La duración aplica a las citas que ya pertenecen a este consultorio."
              : "Configura nombre, ubicación, color y duración de cita."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nombre *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Bosques, Interlomas, Polanco…"
            />
            {showErrors && errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Dirección *</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Calle, número, colonia…"
            />
            {showErrors && errors.address && (
              <p className="text-xs text-destructive">{errors.address}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Ciudad *</Label>
              <Select
                value={cityId}
                onValueChange={(v) => {
                  setCityId(v);
                  setZoneId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  {cities.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showErrors && errors.cityId && (
                <p className="text-xs text-destructive">{errors.cityId}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Zona *</Label>
              <Select value={zoneId} onValueChange={setZoneId} disabled={!cityId}>
                <SelectTrigger>
                  <SelectValue placeholder={cityId ? "Selecciona" : "Primero ciudad"} />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showErrors && errors.zoneId && (
                <p className="text-xs text-destructive">{errors.zoneId}</p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Duración de cita (minutos)</Label>
            <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} min
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Color del consultorio *</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDisplayColor(c)}
                  className={cn(
                    "h-8 w-8 rounded-md border-2 transition-all",
                    displayColor === c ? "border-foreground scale-110" : "border-transparent"
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Identifica visualmente las citas de este consultorio en tu calendario.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear consultorio"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
