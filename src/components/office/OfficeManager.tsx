// Office manager: grid of expanded cards (no collapsed accordions). Each card
// shows the office's identity, calendar connection, and management actions
// inline — designed for older, less tech-savvy doctors so nothing important
// is hidden behind a click.
//
// Used by both the doctor's Configuracion page and the admin's Doctores page.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import OfficeFormDialog from "./OfficeFormDialog";
import OfficeCalendarConnector from "./OfficeCalendarConnector";

interface OfficeRow {
  id: string;
  doctor_id: string;
  name: string;
  address: string | null;
  city_id: string | null;
  zone_id: string | null;
  appointment_duration_minutes: number;
  display_color: string;
  google_calendar_connected: boolean;
  google_calendar_id: string | null;
  outlook_calendar_connected: boolean;
  outlook_calendar_id: string | null;
  is_active: boolean;
}

interface ZoneCity {
  id: string;
  name: string;
}

interface Props {
  doctorId: string;
}

export default function OfficeManager({ doctorId }: Props) {
  const queryClient = useQueryClient();
  const [editingOffice, setEditingOffice] = useState<OfficeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ office: OfficeRow; affected: number } | null>(
    null
  );

  const officesKey = ["doctor-offices", doctorId];

  const { data: offices = [], isLoading } = useQuery<OfficeRow[]>({
    queryKey: officesKey,
    queryFn: async () => {
      const { data } = await supabase
        .from("doctor_offices")
        .select(
          "id, doctor_id, name, address, city_id, zone_id, appointment_duration_minutes, display_color, " +
            "google_calendar_connected, google_calendar_id, " +
            "outlook_calendar_connected, outlook_calendar_id, is_active"
        )
        .eq("doctor_id", doctorId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true });
      return (data ?? []) as OfficeRow[];
    },
  });

  // City + zone names for display under each office.
  const { data: locations } = useQuery<{ cities: Record<string, string>; zones: Record<string, string> }>({
    queryKey: ["office-location-names", offices.map((o) => `${o.city_id}-${o.zone_id}`).join(",")],
    queryFn: async () => {
      const cityIds = [...new Set(offices.map((o) => o.city_id).filter(Boolean) as string[])];
      const zoneIds = [...new Set(offices.map((o) => o.zone_id).filter(Boolean) as string[])];
      const cityMap: Record<string, string> = {};
      const zoneMap: Record<string, string> = {};
      if (cityIds.length > 0) {
        const { data } = await supabase.from("cities").select("id, name").in("id", cityIds);
        for (const c of (data ?? []) as ZoneCity[]) cityMap[c.id] = c.name;
      }
      if (zoneIds.length > 0) {
        const { data } = await supabase.from("zones").select("id, name").in("id", zoneIds);
        for (const z of (data ?? []) as ZoneCity[]) zoneMap[z.id] = z.name;
      }
      return { cities: cityMap, zones: zoneMap };
    },
    enabled: offices.length > 0,
  });

  const callEndpoint = async <T,>(name: string, body: unknown): Promise<T> => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("No autenticado");
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || data?.error || "Error desconocido");
    return data as T;
  };

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ office, isActive }: { office: OfficeRow; isActive: boolean }) =>
      callEndpoint("doctor-office-update", { office_id: office.id, is_active: isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: officesKey });
      toast.success("Consultorio actualizado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleDeleteRequest = async (office: OfficeRow) => {
    try {
      const data = await callEndpoint<{ affected_count: number }>("doctor-office-delete", {
        office_id: office.id,
        dry_run: true,
      });
      setConfirmDelete({ office, affected: data.affected_count });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const confirmDeleteMutation = useMutation({
    mutationFn: async (officeId: string) =>
      callEndpoint<{ cancelled: number }>("doctor-office-delete", {
        office_id: officeId,
        confirm: true,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: officesKey });
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-appointments"] });
      const cancelled = data?.cancelled ?? 0;
      toast.success(
        cancelled > 0
          ? `Consultorio borrado. Se cancelaron ${cancelled} citas y se notificó por WhatsApp.`
          : "Consultorio borrado."
      );
      setConfirmDelete(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando consultorios…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Agregar consultorio
        </Button>
      </div>

      {offices.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-2">
            <Building2 className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Aún no tienes consultorios. Agrega el primero para empezar a recibir citas.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {offices.map((o) => {
            const cityName = o.city_id ? locations?.cities[o.city_id] : null;
            const zoneName = o.zone_id ? locations?.zones[o.zone_id] : null;
            return (
              <Card key={o.id} className={!o.is_active ? "opacity-60" : ""}>
                <CardContent className="p-5 space-y-4">
                  {/* Header row: identity + actions. */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span
                        className="mt-1 inline-block h-6 w-1.5 rounded-sm shrink-0"
                        style={{ backgroundColor: o.display_color }}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-semibold leading-none">{o.name}</h3>
                          {!o.is_active && (
                            <Badge variant="outline" className="text-[10px]">
                              Inactivo
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                          {o.address && <p>{o.address}</p>}
                          {(cityName || zoneName) && (
                            <p>
                              {[zoneName, cityName].filter(Boolean).join(", ")}
                            </p>
                          )}
                          <p>Duración de cita: {o.appointment_duration_minutes} min</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          toggleActiveMutation.mutate({ office: o, isActive: !o.is_active })
                        }
                        className="gap-1"
                      >
                        <Power className="h-3.5 w-3.5" />
                        {o.is_active ? "Desactivar" : "Activar"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingOffice(o)}
                        className="gap-1"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteRequest(o)}
                        className="gap-1 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Borrar
                      </Button>
                    </div>
                  </div>

                  {/* Calendar connection inline. */}
                  <OfficeCalendarConnector office={o} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <OfficeFormDialog
        open={creating || !!editingOffice}
        onClose={() => {
          setCreating(false);
          setEditingOffice(null);
        }}
        doctorId={doctorId}
        office={editingOffice}
        onSaved={() => queryClient.invalidateQueries({ queryKey: officesKey })}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Borrar consultorio
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.affected ? (
                <>
                  Esto cancelará <strong>{confirmDelete.affected}</strong> cita
                  {confirmDelete.affected === 1 ? "" : "s"} futura
                  {confirmDelete.affected === 1 ? "" : "s"} del consultorio "{confirmDelete.office.name}"
                  y notificará por WhatsApp al paciente y al doctor.
                </>
              ) : (
                <>
                  Esto borrará el consultorio "{confirmDelete?.office.name}". No tiene citas activas
                  futuras.
                </>
              )}{" "}
              ¿Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && confirmDeleteMutation.mutate(confirmDelete.office.id)}
              disabled={confirmDeleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmDeleteMutation.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : null}
              Sí, borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
