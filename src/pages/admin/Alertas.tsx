// Configuración → Alertas: cómo se entera el equipo de un caso que necesita a
// una persona. Avisos del navegador (por computadora), números de guardia que
// reciben WhatsApp, tiempos de respuesta (SLA) con re-avisos, plantilla de
// WHAAPY y las últimas alertas enviadas con sus recibos. Lecturas por RLS;
// escrituras y la alerta de prueba por la Edge Function case-actions.
import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, Bell, BellRing, Pencil, Plus, Send, Trash2, Volume2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { SoftBadge } from "@/components/app/StatusBadge";
import type { Tone } from "@/components/app/StatCard";
import { toast } from "@/hooks/use-toast";
import { useBrowserAlertPermission } from "@/hooks/useBrowserAlerts";
import { useStaffAlertSettings } from "@/hooks/useStaffAlertSettings";
import { playAlertSound, showBrowserAlert } from "@/lib/browser-alerts";
import { alertAction, casePath, DELIVERY_STATUS, RECEIVES_LABEL } from "@/lib/staff-alerts";
import { cn } from "@/lib/utils";

type Recipient = Tables<"staff_alert_recipients">;
type Settings = Tables<"staff_alert_settings">;

const fmt = (iso: string) => format(parseISO(iso), "d MMM, HH:mm", { locale: es });
const onError = (e: Error) => toast({ title: "No se pudo completar", description: e.message, variant: "destructive" });

export default function Alertas() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Alertas del equipo"
        description="Cómo se entera el equipo cuando un paciente necesita a una persona: aviso en el panel con sonido, notificación del navegador y WhatsApp a los números de guardia, con re-avisos si nadie toma el caso."
      />
      <BrowserAlertsCard />
      <RecipientsCard />
      <SettingsCard />
      <RecentAlertsCard />
    </div>
  );
}

/* ───────── Avisos del navegador ───────── */

const PERMISSION: Record<string, { label: string; tone: Tone }> = {
  granted: { label: "Activados", tone: "success" },
  default: { label: "Sin activar", tone: "warning" },
  denied: { label: "Bloqueados", tone: "danger" },
  unsupported: { label: "No disponibles", tone: "neutral" },
};

function BrowserAlertsCard() {
  const { permission, request } = useBrowserAlertPermission();
  const state = PERMISSION[permission] ?? PERMISSION.unsupported;
  const sample = () =>
    showBrowserAlert({ title: "Avisos de FindMed activados", body: "Así te avisaremos de casos nuevos, canalizaciones y casos vencidos.", tag: "findmed-alert-test" });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 pb-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="h-4 w-4 text-muted-foreground" /> Avisos en este navegador
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Con el panel abierto, cada caso nuevo, canalización o caso vencido muestra un aviso fijo con “Ver caso” y suena un tono. Con los
            avisos del navegador activados también te enteras aunque estés en otra pestaña o aplicación.
          </p>
        </div>
        <SoftBadge tone={state.tone} dot>{state.label}</SoftBadge>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          {permission === "default" && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                const p = await request();
                if (p === "granted") sample();
                else if (p === "denied") toast({ title: "El navegador bloqueó los avisos", description: "Puedes permitirlos desde el candado junto a la dirección.", variant: "destructive" });
              }}
            >
              <BellRing className="h-4 w-4" /> Activar avisos del navegador
            </Button>
          )}
          {permission === "granted" && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={sample}>
              <BellRing className="h-4 w-4" /> Probar aviso
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => playAlertSound(false)}>
            <Volume2 className="h-4 w-4" /> Probar sonido
          </Button>
        </div>
        {permission === "denied" && (
          <p className="text-xs text-muted-foreground">
            Están bloqueados: ábrelos desde el candado junto a la dirección (Configuración del sitio → Notificaciones → Permitir) y recarga la página.
          </p>
        )}
        {permission === "unsupported" && (
          <p className="text-xs text-muted-foreground">Este navegador no permite notificaciones; el aviso dentro del panel y el sonido sí funcionan.</p>
        )}
        <p className="text-xs text-muted-foreground">Es por computadora: cada persona del equipo lo activa en su navegador.</p>
      </CardContent>
    </Card>
  );
}

/* ───────── Números de guardia ───────── */

interface RecipientForm {
  id: string | null;
  name: string;
  phone: string;
  receives: string;
  is_active: boolean;
}

const EMPTY_FORM: RecipientForm = { id: null, name: "", phone: "", receives: "all", is_active: true };

function useRecipients() {
  return useQuery({
    queryKey: ["staff-alert-recipients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_alert_recipients").select("*").order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    placeholderData: keepPreviousData,
  });
}

function RecipientsCard() {
  const queryClient = useQueryClient();
  const { data: recipients, isLoading, isError } = useRecipients();
  const [form, setForm] = useState<RecipientForm | null>(null);
  const [toDelete, setToDelete] = useState<Recipient | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["staff-alert-recipients"] });

  const save = useMutation({
    mutationFn: (f: RecipientForm) =>
      alertAction({ action: "alert_recipient_save", ...(f.id ? { id: f.id } : {}), name: f.name, phone: f.phone, receives: f.receives, is_active: f.is_active }),
    onSuccess: (_r, f) => {
      refresh();
      setForm(null);
      toast({ title: f.id ? "Número actualizado" : "Número agregado" });
    },
    onError,
  });
  const toggle = useMutation({
    mutationFn: (r: Recipient) => alertAction({ action: "alert_recipient_save", id: r.id, name: r.name, phone: r.phone, receives: r.receives, is_active: !r.is_active }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (r: Recipient) => alertAction({ action: "alert_recipient_delete", id: r.id }),
    onSuccess: () => {
      refresh();
      toast({ title: "Número eliminado" });
    },
    onError,
    onSettled: () => setToDelete(null),
  });
  const test = useMutation({
    mutationFn: (r: Recipient) => alertAction<{ message: string; status: string }>({ action: "alert_test", recipient_id: r.id }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["staff-alert-deliveries"] });
      toast({ title: res.status === "accepted" ? "Alerta de prueba enviada" : "Envío sin confirmar", description: res.message });
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ["staff-alert-deliveries"] });
      onError(e);
    },
  });

  const rows = recipients ?? [];
  const active = rows.filter((r) => r.is_active).length;
  const canSave = !!form && form.name.trim().length > 0 && form.phone.replace(/\D/g, "").length >= 10 && !save.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-sm font-semibold">Números de guardia (WhatsApp)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Reciben un WhatsApp cuando se abre un caso urgente o de prioridad alta, cuando un paciente pide hablar con una persona y en cada
            re-aviso de un caso que nadie ha tomado. “Solo urgentes” recibe únicamente los casos urgentes.
          </p>
        </div>
        <Button size="sm" className="shrink-0 gap-1.5" onClick={() => setForm({ ...EMPTY_FORM })}>
          <Plus className="h-4 w-4" /> Agregar número
        </Button>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        {isLoading ? (
          <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : isError && !recipients ? (
          <EmptyState icon={AlertTriangle} title="No se pudieron cargar los números" description="Revisa tu conexión o que la migración de alertas esté aplicada." />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Send}
            title="Sin números de guardia"
            description="Agrega al menos uno para que las alertas lleguen por WhatsApp. Los avisos en el panel funcionan aunque no haya números."
          />
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? "número" : "números"} · {active} {active === 1 ? "activo" : "activos"}
            </p>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="h-9 text-xs">Nombre</TableHead>
                    <TableHead className="hidden h-9 text-xs sm:table-cell">Recibe</TableHead>
                    <TableHead className="h-9 text-xs">Activo</TableHead>
                    <TableHead className="h-9 text-right text-xs"><span className="sr-only">Acciones</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className={cn(!r.is_active && "text-muted-foreground")}>
                      <TableCell className="py-2.5">
                        <p className={cn("text-sm font-medium", r.is_active ? "text-foreground" : "text-muted-foreground")}>{r.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{r.phone}</p>
                        <p className="text-xs text-muted-foreground sm:hidden">{RECEIVES_LABEL[r.receives] ?? r.receives}</p>
                      </TableCell>
                      <TableCell className="hidden py-2.5 sm:table-cell">
                        <SoftBadge tone={r.receives === "urgent_only" ? "danger" : "info"}>{RECEIVES_LABEL[r.receives] ?? r.receives}</SoftBadge>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Switch
                          checked={r.is_active}
                          disabled={toggle.isPending}
                          onCheckedChange={() => toggle.mutate(r)}
                          aria-label={r.is_active ? `Desactivar ${r.name}` : `Activar ${r.name}`}
                        />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5"
                            disabled={test.isPending}
                            onClick={() => test.mutate(r)}
                            title="Enviar una alerta de prueba a este número"
                          >
                            <Send className="h-3.5 w-3.5" /> <span className="hidden md:inline">Enviar prueba</span>
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => setForm({ id: r.id, name: r.name, phone: r.phone, receives: r.receives, is_active: r.is_active })}
                            aria-label={`Editar ${r.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setToDelete(r)}
                            aria-label={`Eliminar ${r.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar número de guardia" : "Agregar número de guardia"}</DialogTitle>
            <DialogDescription>Recibirá por WhatsApp las alertas de casos que nadie ha tomado.</DialogDescription>
          </DialogHeader>
          {form && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSave) save.mutate(form);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="recipient-name">Nombre</Label>
                <Input id="recipient-name" value={form.name} maxLength={120} placeholder="Ej. Guardia de noche" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recipient-phone">WhatsApp</Label>
                <Input
                  id="recipient-phone"
                  inputMode="tel"
                  value={form.phone}
                  placeholder="55 1234 5678"
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">10 dígitos para México, o con lada internacional (+…).</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recipient-receives">Recibe</Label>
                <Select value={form.receives} onValueChange={(v) => setForm({ ...form, receives: v })}>
                  <SelectTrigger id="recipient-receives"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las alertas</SelectItem>
                    <SelectItem value="urgent_only">Solo urgentes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                Activo
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
                <Button type="submit" disabled={!canSave}>{save.isPending ? "Guardando…" : "Guardar"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar a {toDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Dejará de recibir alertas por WhatsApp. El historial de alertas enviadas se conserva.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) remove.mutate(toDelete);
              }}
              disabled={remove.isPending}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* ───────── Tiempos y plantilla ───────── */

interface SettingsForm {
  sla_urgent_minutes: string;
  sla_high_minutes: string;
  sla_normal_minutes: string;
  max_escalations: string;
  whatsapp_enabled: boolean;
  template_name: string;
  template_language: string;
}

const toForm = (s: Settings): SettingsForm => ({
  sla_urgent_minutes: String(s.sla_urgent_minutes),
  sla_high_minutes: String(s.sla_high_minutes),
  sla_normal_minutes: String(s.sla_normal_minutes),
  max_escalations: String(s.max_escalations),
  whatsapp_enabled: s.whatsapp_enabled,
  template_name: s.template_name,
  template_language: s.template_language,
});

function NumberField({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">{label}</Label>
      <Input id={id} type="number" inputMode="numeric" min={0} className="h-9" value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function SettingsCard() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, isError } = useStaffAlertSettings();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  // Rellenar el formulario con lo guardado (y al volver a cargar tras guardar).
  if (settings && loadedAt !== settings.updated_at) {
    setLoadedAt(settings.updated_at);
    setForm(toForm(settings));
  }

  const save = useMutation({
    mutationFn: (f: SettingsForm) =>
      alertAction({
        action: "alert_settings_save",
        sla_urgent_minutes: Number(f.sla_urgent_minutes),
        sla_high_minutes: Number(f.sla_high_minutes),
        sla_normal_minutes: Number(f.sla_normal_minutes),
        max_escalations: Number(f.max_escalations),
        whatsapp_enabled: f.whatsapp_enabled,
        template_name: f.template_name.trim(),
        template_language: f.template_language.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-alert-settings"] });
      queryClient.invalidateQueries({ queryKey: ["admin-home-overview"] });
      toast({ title: "Configuración de alertas guardada" });
    },
    onError,
  });

  const dirty = !!form && !!settings && JSON.stringify(form) !== JSON.stringify(toForm(settings));
  const set = (patch: Partial<SettingsForm>) => form && setForm({ ...form, ...patch });

  return (
    <Card>
      <CardHeader className="space-y-1 p-4 pb-2">
        <CardTitle className="text-sm font-semibold">Tiempos de respuesta y re-avisos</CardTitle>
        <p className="text-xs text-muted-foreground">
          Si nadie toma un caso dentro de su tiempo, se vuelve a avisar (panel y WhatsApp) cada periodo, hasta el número de re-avisos indicado.
          El tiempo cuenta desde que se abrió el caso.
        </p>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !form ? (
          <EmptyState
            icon={AlertTriangle}
            title="No se pudo cargar la configuración"
            description={isError ? "Revisa tu conexión o que la migración de alertas esté aplicada." : "Falta la fila de configuración de alertas en la base de datos."}
          />
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty && !save.isPending) save.mutate(form);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <NumberField id="sla-urgent" label="Urgente (minutos)" hint="Por defecto 10" value={form.sla_urgent_minutes} onChange={(v) => set({ sla_urgent_minutes: v })} />
              <NumberField id="sla-high" label="Alta (minutos)" hint="Por defecto 30" value={form.sla_high_minutes} onChange={(v) => set({ sla_high_minutes: v })} />
              <NumberField id="sla-normal" label="Normal (minutos)" hint="Por defecto 120" value={form.sla_normal_minutes} onChange={(v) => set({ sla_normal_minutes: v })} />
              <NumberField id="max-escalations" label="Re-avisos máximos" hint="0 = sin re-avisos" value={form.max_escalations} onChange={(v) => set({ max_escalations: v })} />
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <label className="flex items-center justify-between gap-3 text-sm font-medium text-foreground">
                Enviar WhatsApp a los números de guardia
                <Switch checked={form.whatsapp_enabled} onCheckedChange={(v) => set({ whatsapp_enabled: v })} />
              </label>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                <div className="space-y-1.5">
                  <Label htmlFor="template-name" className="text-xs font-medium">Plantilla de WHAAPY</Label>
                  <Input id="template-name" className="h-9 font-mono text-sm" value={form.template_name} onChange={(e) => set({ template_name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="template-language" className="text-xs font-medium">Idioma</Label>
                  <Input id="template-language" className="h-9 font-mono text-sm" value={form.template_language} onChange={(e) => set({ template_language: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Debe estar aprobada por Meta (categoría Utilidad) con 4 variables —tipo de caso, prioridad, resumen corto y minutos esperando— y el
                botón “Ver caso” con el enlace <span className="font-mono">https://app.findmed.com.mx/admin/casos?caso={"{{1}}"}</span>. Si no existe o no
                está aprobada, el envío queda como fallido y aparece en Inicio; el aviso en el panel llega igual.
              </p>
            </div>

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!dirty || save.isPending}>{save.isPending ? "Guardando…" : "Guardar cambios"}</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────── Últimas alertas por WhatsApp ───────── */

function RecentAlertsCard() {
  const { data: recipients } = useRecipients();
  const { data: deliveries, isLoading } = useQuery({
    queryKey: ["staff-alert-deliveries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_deliveries")
        .select("id, status, to_phone, created_at, error_message, case_id, staff_recipient_id")
        .eq("source", "staff_alert")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const nameOf = (id: string | null) => (id ? recipients?.find((r) => r.id === id)?.name ?? null : null);
  const rows = deliveries ?? [];

  return (
    <Card>
      <CardHeader className="space-y-1 p-4 pb-2">
        <CardTitle className="text-sm font-semibold">Últimas alertas por WhatsApp</CardTitle>
        <p className="text-xs text-muted-foreground">Cada envío a un número de guardia con su estado (aceptado, entregado, leído o fallido).</p>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Todavía no se ha enviado ninguna alerta por WhatsApp.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((d) => {
              const st = DELIVERY_STATUS[d.status] ?? { label: d.status, tone: "neutral" as Tone };
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <SoftBadge tone={st.tone} dot>{st.label}</SoftBadge>
                  <span className="font-medium text-foreground">{nameOf(d.staff_recipient_id) ?? d.to_phone}</span>
                  <span className="text-xs text-muted-foreground">{fmt(d.created_at)}</span>
                  {!d.case_id && <SoftBadge tone="neutral">Prueba</SoftBadge>}
                  {d.case_id && (
                    <Link to={casePath(d.case_id)} className="ml-auto text-xs font-medium text-primary hover:underline">
                      Ver caso
                    </Link>
                  )}
                  {d.error_message && <p className="w-full text-xs text-destructive">{d.error_message}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
