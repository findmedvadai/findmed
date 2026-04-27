// Office manager: list-of-cards UI to create / edit / activate / delete a
// doctor's offices. Used by both the doctor's Configuracion page and the
// admin's Doctores page. The Edge Function endpoints
// (`doctor-office-create/update/delete`) accept either an admin or the
// office's owning doctor as caller, so this component is identical in both
// contexts — only the `doctorId` prop changes.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Pencil, Building2, Link2, Unlink, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import OfficeFormDialog from "./OfficeFormDialog";
import OfficeCalendarConnector from "./OfficeCalendarConnector";
import OfficeAvailabilityEditor from "./OfficeAvailabilityEditor";

interface OfficeRow {
  id: string;
  doctor_id: string;
  name: string;
  address: string | null;
  city_id: string | null;
  zone_id: string | null;
  appointment_duration_minutes: number;
  google_calendar_connected: boolean;
  google_calendar_id: string | null;
  outlook_calendar_connected: boolean;
  outlook_calendar_id: string | null;
  is_active: boolean;
}

interface Props {
  doctorId: string;
}

export default function OfficeManager({ doctorId }: Props) {
  const queryClient = useQueryClient();
  const [editingOffice, setEditingOffice] = useState<OfficeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ office: OfficeRow; affected: number } | null>(null);

  const officesKey = ["doctor-offices", doctorId];

  const { data: offices = [], isLoading } = useQuery<OfficeRow[]>({
    queryKey: officesKey,
    queryFn: async () => {
      const { data } = await supabase
        .from("doctor_offices")
        .select(
          "id, doctor_id, name, address, city_id, zone_id, appointment_duration_minutes, " +
            "google_calendar_connected, google_calendar_id, " +
            "outlook_calendar_connected, outlook_calendar_id, is_active"
        )
        .eq("doctor_id", doctorId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true });
      return (data ?? []) as OfficeRow[];
    },
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {offices.length === 0
            ? "No hay consultorios. Agrega el primero."
            : `${offices.length} consultorio${offices.length === 1 ? "" : "s"}`}
        </p>
        <Button size="sm" onClick={() => setCreating(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Agregar consultorio
        </Button>
      </div>

      <Accordion type="multiple" className="space-y-2">
        {offices.map((o) => (
          <AccordionItem key={o.id} value={o.id} className="border rounded-md">
            <div className="flex items-center justify-between px-3 py-1">
              <AccordionTrigger className="flex-1 hover:no-underline py-2">
                <div className="flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{o.name}</span>
                      {!o.is_active && (
                        <Badge variant="outline" className="text-[10px]">Inactivo</Badge>
                      )}
                      {o.google_calendar_connected && (
                        <Badge variant="outline" className="text-[10px]">Google</Badge>
                      )}
                      {o.outlook_calendar_connected && (
                        <Badge variant="outline" className="text-[10px]">Outlook</Badge>
                      )}
                    </div>
                    {o.address && <p className="text-xs text-muted-foreground">{o.address}</p>}
                  </div>
                </div>
              </AccordionTrigger>
              <div className="flex items-center gap-1 pl-2">
                <Switch
                  checked={o.is_active}
                  onCheckedChange={(v) => toggleActiveMutation.mutate({ office: o, isActive: v })}
                  aria-label="Activar"
                />
                <Button variant="ghost" size="icon" onClick={() => setEditingOffice(o)} className="h-8 w-8">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteRequest(o)}
                  className="h-8 w-8 text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <AccordionContent className="px-3 pb-4">
              <div className="space-y-4">
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <h4 className="text-xs uppercase font-semibold text-muted-foreground">Calendarios</h4>
                    <OfficeCalendarConnector office={o} />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <h4 className="text-xs uppercase font-semibold text-muted-foreground">
                      Disponibilidad semanal
                    </h4>
                    <OfficeAvailabilityEditor office={o} />
                  </CardContent>
                </Card>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Create / edit dialog. */}
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

      {/* Delete confirmation. */}
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
