// Automatización (antes "Mensajería", B7/B7b, D8): qué WhatsApp recibe el
// paciente en cada momento de su cita, enviado por FindMed directo por la API
// de WHAAPY; el historial de envíos con su estado de entrega y el catálogo de
// plantillas aprobadas por Meta. Las lecturas van por RLS; todo lo que escribe
// o habla con WHAAPY pasa por la Edge Function messaging-admin.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import MessageStepDialog, { type CatalogTemplate, type StepDraft } from "@/components/admin/MessageStepDialog";
import { PageHeader } from "@/components/app/PageHeader";
import { FilterBar, SearchInput } from "@/components/app/FilterBar";
import { EmptyState } from "@/components/app/EmptyState";
import { SoftBadge } from "@/components/app/StatusBadge";
import type { Tone } from "@/components/app/StatCard";
import { messagingAdmin } from "@/lib/messaging-admin";
import { CANCEL_REASON_LABEL, EVENT_INFO, PARAM_LABEL, STATUS_LABEL } from "@/lib/messaging-labels";
import { AlertTriangle, CheckCircle2, Link2, MessageSquare, MousePointerClick, Pencil, Plus, RefreshCw, Send, Trash2, Zap } from "lucide-react";

type Route = Tables<"message_routes">;
type Step = Tables<"message_route_steps">;
type Delivery = Tables<"message_deliveries">;
type OutboxRow = Tables<"domain_outbox">;

const DELIVERY: Record<string, { label: string; tone: Tone }> = {
  sending: { label: "Enviando", tone: "neutral" },
  accepted: { label: "Aceptado", tone: "info" },
  sent: { label: "Enviado", tone: "info" },
  delivered: { label: "Entregado", tone: "success" },
  read: { label: "Leído", tone: "success" },
  failed: { label: "Falló", tone: "danger" },
  uncertain: { label: "Incierto", tone: "warning" },
};

const OUTBOX_LABEL: Record<string, string> = { pending: "En cola", processing: "Procesando", failed: "Falló", uncertain: "Incierto" };

const fmt = (iso: string) => format(parseISO(iso), "d MMM yyyy, HH:mm", { locale: es });
const eventOrder = (e: string) => {
  const i = Object.keys(EVENT_INFO).indexOf(e);
  return i < 0 ? 99 : i;
};

const TABS = ["eventos", "envios", "plantillas"] as const;

export default function Automatizacion() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as string) : "eventos";

  const sync = useMutation({
    mutationFn: () => messagingAdmin({ action: "sync_templates" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whaapy-templates"] });
      toast({ title: "Plantillas sincronizadas con Meta" });
    },
    onError: (e: Error) => toast({ title: "No se pudo sincronizar", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Automatización"
        description="Los WhatsApp que recibe el paciente en cada momento de su cita. FindMed los envía directo por WHAAPY con plantillas aprobadas por Meta."
        actions={
          <Button size="sm" variant="outline" className="gap-2" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw className={sync.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Sincronizar plantillas
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams(v === "eventos" ? {} : { tab: v }, { replace: true })}>
        <TabsList className="h-9">
          <TabsTrigger value="eventos" className="text-sm">Eventos</TabsTrigger>
          <TabsTrigger value="envios" className="text-sm">Envíos</TabsTrigger>
          <TabsTrigger value="plantillas" className="text-sm">Plantillas</TabsTrigger>
        </TabsList>
        <TabsContent value="eventos" className="mt-4"><EventsTab /></TabsContent>
        <TabsContent value="envios" className="mt-4"><DeliveriesTab /></TabsContent>
        <TabsContent value="plantillas" className="mt-4"><TemplatesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function useTemplates(enabled = true) {
  return useQuery({
    queryKey: ["whaapy-templates"],
    enabled,
    queryFn: async () => (await messagingAdmin<{ templates: CatalogTemplate[] }>({ action: "templates" })).templates,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function useRoutes() {
  return useQuery({
    queryKey: ["message-routes"],
    queryFn: async () => {
      const [routes, steps] = await Promise.all([
        supabase.from("message_routes").select("*"),
        supabase.from("message_route_steps").select("*").order("position"),
      ]);
      if (routes.error) throw routes.error;
      if (steps.error) throw steps.error;
      return {
        routes: (routes.data ?? []).sort((a, b) => eventOrder(a.event_type) - eventOrder(b.event_type)),
        steps: steps.data ?? [],
      };
    },
    placeholderData: keepPreviousData,
  });
}

/* ───────── Eventos ───────── */

function StepRow({
  step,
  template,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  step: Step;
  template: CatalogTemplate | undefined;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`group flex items-start gap-3 rounded-md border bg-background px-3 py-2.5 ${step.enabled ? "" : "opacity-60"}`}>
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
        {step.position}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[13px] font-medium text-foreground">{step.template_name}</span>
          {!template && <SoftBadge tone="danger">No existe en WHAAPY</SoftBadge>}
          {step.url_button_param && (
            <SoftBadge tone="neutral"><Link2 className="h-3 w-3" /> Enlace /gestionar</SoftBadge>
          )}
          {step.quick_reply_action && (
            <SoftBadge tone="info"><MousePointerClick className="h-3 w-3" /> Botón {step.quick_reply_action === "confirm" ? "confirmar" : "cancelar"}</SoftBadge>
          )}
          {step.skip_on_reschedule && <SoftBadge tone="neutral">No se repite al reagendar</SoftBadge>}
        </div>
        {template?.body && <p className="line-clamp-2 text-xs text-muted-foreground">{template.body}</p>}
        {step.body_params.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Variables: {step.body_params.map((p, i) => `{{${i + 1}}} ${PARAM_LABEL[p] ?? p}`).join(" · ")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span><Switch checked={step.enabled} disabled={busy} onCheckedChange={onToggle} className="scale-90" /></span>
          </TooltipTrigger>
          <TooltipContent>{step.enabled ? "Pausar este mensaje" : "Activar este mensaje"}</TooltipContent>
        </Tooltip>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit} aria-label="Editar">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="Eliminar">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function EventsTab() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StepDraft | null>(null);
  const [ownerChange, setOwnerChange] = useState<{ route: Route; owner: string } | null>(null);
  const [toDelete, setToDelete] = useState<Step | null>(null);

  const { data, isLoading } = useRoutes();
  const { data: templates, error: templatesError } = useTemplates();
  const byName = useMemo(() => new Map((templates ?? []).map((t) => [t.name, t])), [templates]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["message-routes"] });
  const onError = (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" });

  const setOwner = useMutation({
    mutationFn: (v: { event_type: string; owner: string }) => messagingAdmin({ action: "set_owner", ...v }),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["admin-home-overview"] });
      toast({ title: "Evento actualizado" });
    },
    onError,
    onSettled: () => setOwnerChange(null),
  });
  const saveStep = useMutation({
    mutationFn: (step: StepDraft) => messagingAdmin({ action: "save_step", step }),
    onSuccess: () => {
      refresh();
      setDraft(null);
      toast({ title: "Mensaje guardado" });
    },
    onError,
  });
  const deleteStep = useMutation({
    mutationFn: (id: string) => messagingAdmin({ action: "delete_step", id }),
    onSuccess: () => {
      refresh();
      toast({ title: "Mensaje eliminado" });
    },
    onError,
    onSettled: () => setToDelete(null),
  });

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}</div>;
  const routes = data?.routes ?? [];
  const steps = data?.steps ?? [];
  const onN8n = routes.filter((r) => r.owner === "n8n");

  const newDraft = (route: Route, position: number): StepDraft => ({
    event_type: route.event_type,
    when_status: null,
    when_cancel_reason: null,
    position,
    template_name: "",
    language: "es_MX",
    body_params: [],
    url_button_param: null,
    quick_reply_action: null,
    enabled: true,
    skip_on_reschedule: false,
  });

  return (
    <div className="space-y-4">
      {onN8n.length > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-foreground">
            {onN8n.length === 1 ? "1 evento todavía lo envía n8n." : `${onN8n.length} eventos todavía los envía n8n.`} Usa "Pasar a FindMed" en cada uno para que todo salga por WHAAPY.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-success/25 bg-success/5 p-3 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          <p className="text-foreground">Todos los mensajes los envía FindMed directo por WHAAPY. n8n ya no participa.</p>
        </div>
      )}
      {templatesError && (
        <p className="text-sm text-destructive">No se pudo leer el catálogo de WHAAPY: {(templatesError as Error).message}</p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {routes.map((route) => {
          const info = EVENT_INFO[route.event_type];
          const routeSteps = steps
            .filter((s) => s.event_type === route.event_type)
            .sort((a, b) => (a.when_status ?? "").localeCompare(b.when_status ?? "") || a.position - b.position);
          const nextPosition = Math.max(0, ...routeSteps.map((s) => s.position)) + 1;
          const groups = route.event_type === "appointment.status_changed"
            ? Object.keys(STATUS_LABEL).map((st) => ({ key: st, steps: routeSteps.filter((s) => s.when_status === st) }))
            : [{ key: "", steps: routeSteps }];
          const active = route.owner === "findmed";
          return (
            <Card key={route.event_type} className="flex flex-col">
              <div className="flex items-start justify-between gap-3 border-b p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">{info?.title ?? route.description ?? route.event_type}</h3>
                    {info?.internal && <SoftBadge tone="neutral">Interno</SoftBadge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{info?.when ?? route.description}</p>
                  <p className="font-mono text-[11px] text-muted-foreground/80">{route.event_type}</p>
                </div>
                {route.owner === "n8n" ? (
                  <Button size="sm" className="h-8 shrink-0" onClick={() => setOwnerChange({ route, owner: "findmed" })}>Pasar a FindMed</Button>
                ) : (
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {active ? "Activo" : "Pausado"}
                    <Switch checked={active} onCheckedChange={(on) => setOwnerChange({ route, owner: on ? "findmed" : "none" })} />
                  </label>
                )}
              </div>
              <CardContent className="flex-1 space-y-3 p-4">
                {routeSteps.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {info?.internal ? "Evento interno: no envía WhatsApp al paciente." : "Este evento no envía ningún mensaje."}
                  </p>
                )}
                {groups.map((g) =>
                  g.key && g.steps.length === 0 ? null : (
                    <div key={g.key || "all"} className="space-y-2">
                      {g.key && (
                        <p className="text-xs font-medium text-muted-foreground">
                          Cuando pasa a <span className="text-foreground">{STATUS_LABEL[g.key]}</span>
                          {g.key === "cancelled" && g.steps[0]?.when_cancel_reason ? ` ${CANCEL_REASON_LABEL[g.steps[0].when_cancel_reason] ?? ""}` : ""}
                        </p>
                      )}
                      {g.steps.map((s) => (
                        <StepRow
                          key={s.id}
                          step={s}
                          template={byName.get(s.template_name)}
                          busy={saveStep.isPending}
                          onToggle={(enabled) => saveStep.mutate({ ...(s as StepDraft), enabled })}
                          onEdit={() => setDraft(s as StepDraft)}
                          onDelete={() => setToDelete(s)}
                        />
                      ))}
                    </div>
                  ),
                )}
                <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-primary" disabled={!templates} onClick={() => setDraft(newDraft(route, nextPosition))}>
                  <Plus className="h-4 w-4" /> Agregar mensaje
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <MessageStepDialog
        open={!!draft}
        draft={draft}
        templates={templates ?? []}
        saving={saveStep.isPending}
        onCancel={() => setDraft(null)}
        onSave={(s) => saveStep.mutate(s)}
      />

      <AlertDialog open={!!ownerChange} onOpenChange={(o) => !o && setOwnerChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {ownerChange?.owner === "findmed" ? "¿Enviar este evento desde FindMed?" : "¿Pausar los mensajes de este evento?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {ownerChange?.owner === "findmed" &&
                "FindMed enviará estos mensajes directo por WHAAPY. Antes se revisa que cada mensaje coincida con su plantilla."}
              {ownerChange?.owner === "none" && "Mientras esté pausado, el paciente no recibirá ningún WhatsApp en este momento de su cita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={setOwner.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (ownerChange) setOwner.mutate({ event_type: ownerChange.route.event_type, owner: ownerChange.owner });
              }}
            >
              {ownerChange?.owner === "none" ? "Pausar" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este mensaje?</AlertDialogTitle>
            <AlertDialogDescription>
              El paciente dejará de recibir "{toDelete?.template_name}" en este evento. Si solo quieres pausarlo, usa el interruptor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (toDelete) deleteStep.mutate(toDelete.id); }}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────── Envíos ───────── */

function DeliveriesTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [resendTarget, setResendTarget] = useState<Delivery | null>(null);
  const [acceptRisk, setAcceptRisk] = useState(false);

  const { data: deliveries, isLoading } = useQuery({
    queryKey: ["message-deliveries", statusFilter],
    queryFn: async () => {
      let q = supabase.from("message_deliveries").select("*").order("created_at", { ascending: false }).limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const { data: stuck } = useQuery({
    queryKey: ["outbox-stuck"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("domain_outbox")
        .select("*")
        .in("status", ["pending", "processing", "failed", "uncertain"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as OutboxRow[];
    },
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["message-deliveries"] });
    queryClient.invalidateQueries({ queryKey: ["outbox-stuck"] });
    queryClient.invalidateQueries({ queryKey: ["admin-home-overview"] });
  };
  const onError = (e: Error) => toast({ title: "No se pudo completar", description: e.message, variant: "destructive" });

  const resend = useMutation({
    mutationFn: (d: Delivery) => messagingAdmin({ action: "resend", delivery_id: d.id, confirm_duplicate_risk: acceptRisk }),
    onSuccess: () => {
      refresh();
      toast({ title: "Mensaje reenviado" });
    },
    onError,
    onSettled: () => {
      setResendTarget(null);
      setAcceptRisk(false);
    },
  });
  const retry = useMutation({
    mutationFn: (id: string) => messagingAdmin({ action: "retry_outbox", outbox_id: id }),
    onSuccess: () => {
      refresh();
      toast({ title: "Evento de nuevo en la cola" });
    },
    onError,
  });

  const term = search.trim().toLowerCase();
  const rows = (deliveries ?? []).filter((d) => !term || d.template_name.toLowerCase().includes(term) || d.to_phone.includes(term));

  return (
    <div className="space-y-4">
      {stuck && stuck.length > 0 && (
        <Card>
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Eventos en cola o con problema</h3>
            <p className="text-xs text-muted-foreground">Se reintentan solos; los fallidos puedes devolverlos a la cola.</p>
          </div>
          <CardContent className="divide-y p-0">
            {stuck.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <SoftBadge tone={o.status === "failed" ? "danger" : o.status === "uncertain" ? "warning" : "neutral"} dot>
                  {OUTBOX_LABEL[o.status] ?? o.status}
                </SoftBadge>
                <span className="font-medium text-foreground">{EVENT_INFO[o.event_type]?.title ?? o.event_type}</span>
                <span className="text-xs text-muted-foreground">{fmt(o.created_at)}</span>
                {o.last_error && <span className="w-full truncate text-xs text-muted-foreground sm:w-auto">{o.last_error}</span>}
                {o.status === "failed" && (
                  <Button size="sm" variant="outline" className="ml-auto h-8 gap-1.5" disabled={retry.isPending} onClick={() => retry.mutate(o.id)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Reintentar
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar plantilla o teléfono…" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[180px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(DELIVERY).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">{rows.length} envíos</span>
      </FilterBar>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : rows.length > 0 ? (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="h-9 text-xs">Estado</TableHead>
                <TableHead className="h-9 text-xs">Plantilla</TableHead>
                <TableHead className="h-9 text-xs">Teléfono</TableHead>
                <TableHead className="h-9 text-xs">Fecha</TableHead>
                <TableHead className="h-9 text-right text-xs"> </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => {
                const badge = DELIVERY[d.status] ?? { label: d.status, tone: "neutral" as Tone };
                return (
                  <TableRow key={d.id}>
                    <TableCell className="py-2.5"><SoftBadge tone={badge.tone} dot>{badge.label}</SoftBadge></TableCell>
                    <TableCell className="py-2.5">
                      <p className="font-mono text-[13px] text-foreground">{d.template_name}</p>
                      {d.source === "manual" && <p className="text-[11px] text-muted-foreground">Reenvío manual</p>}
                      {d.error_message && <p className="max-w-md truncate text-[11px] text-destructive">{d.error_message}</p>}
                    </TableCell>
                    <TableCell className="py-2.5 text-sm text-muted-foreground">{d.to_phone}</TableCell>
                    <TableCell className="whitespace-nowrap py-2.5 text-sm text-muted-foreground">{fmt(d.created_at)}</TableCell>
                    <TableCell className="py-2.5 text-right">
                      {(d.status === "failed" || d.status === "uncertain") && (
                        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setResendTarget(d)}>
                          <Send className="h-3.5 w-3.5" /> Reenviar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          icon={MessageSquare}
          title={term || statusFilter !== "all" ? "Sin envíos con ese filtro" : "Aún no hay envíos"}
          description="Aquí aparece cada WhatsApp que FindMed manda por WHAAPY, con su estado de entrega."
        />
      )}

      <AlertDialog open={!!resendTarget} onOpenChange={(o) => { if (!o) { setResendTarget(null); setAcceptRisk(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reenviar "{resendTarget?.template_name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Se enviará el mismo mensaje a {resendTarget?.to_phone}.
              {resendTarget?.status === "uncertain" &&
                " No sabemos si el envío anterior llegó (se perdió la respuesta de WHAAPY): el paciente podría recibirlo dos veces."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {resendTarget?.status === "uncertain" && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={acceptRisk} onCheckedChange={(v) => setAcceptRisk(v === true)} />
              Entiendo que puede llegar duplicado
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={resend.isPending || (resendTarget?.status === "uncertain" && !acceptRisk)}
              onClick={(e) => { e.preventDefault(); if (resendTarget) resend.mutate(resendTarget); }}
            >
              Reenviar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────── Plantillas ───────── */

function TemplatesTab() {
  const { data: templates, isLoading, error } = useTemplates();
  const { data: routesData } = useRoutes();
  const [search, setSearch] = useState("");
  const [usage, setUsage] = useState("all");

  const usedIn = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of routesData?.steps ?? []) {
      const title = EVENT_INFO[s.event_type]?.title ?? s.event_type;
      m.set(s.template_name, [...new Set([...(m.get(s.template_name) ?? []), title])]);
    }
    return m;
  }, [routesData]);

  const term = search.trim().toLowerCase();
  const rows = (templates ?? []).filter((t) => {
    if (term && !t.name.toLowerCase().includes(term) && !t.body.toLowerCase().includes(term)) return false;
    if (usage === "used") return usedIn.has(t.name);
    if (usage === "unused") return !usedIn.has(t.name);
    return true;
  });

  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre o texto…" />
        <Select value={usage} onValueChange={setUsage}>
          <SelectTrigger className="h-9 w-[180px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="used">En uso</SelectItem>
            <SelectItem value="unused">Sin usar</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} de {templates?.length ?? 0} · se crean y aprueban en WHAAPY/Meta y aparecen aquí al sincronizar
        </span>
      </FilterBar>
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => {
            const approved = t.status.toUpperCase() === "APPROVED";
            const stale = t.buttons.some((b) => b.type === "URL" && /lovable\.app/i.test(b.url ?? ""));
            const events = usedIn.get(t.name) ?? [];
            return (
              <Card key={`${t.name}-${t.language}`} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-2 p-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="break-all font-mono text-[13px] font-medium text-foreground">{t.name}</span>
                    <SoftBadge tone={approved ? "success" : "danger"}>{approved ? "Aprobada" : t.status}</SoftBadge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <SoftBadge tone={t.category.toUpperCase() === "MARKETING" ? "warning" : "neutral"}>{t.category === "UTILITY" ? "Utilidad" : t.category === "MARKETING" ? "Marketing" : t.category}</SoftBadge>
                    <SoftBadge tone="neutral">{t.language}</SoftBadge>
                    {events.length > 0 ? <SoftBadge tone="info">En uso</SoftBadge> : null}
                  </div>
                  <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{t.body}</p>
                  {t.buttons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {t.buttons.map((b, i) => (
                        <span key={i} className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {b.type === "URL" ? "🔗" : b.type === "QUICK_REPLY" ? "↩" : "•"} {b.text}
                        </span>
                      ))}
                    </div>
                  )}
                  {stale && (
                    <p className="flex items-start gap-1.5 rounded-md bg-destructive/5 p-2 text-[11px] text-destructive">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                      El botón abre el dominio viejo de Lovable. Corrígela en WHAAPY con https://app.findmed.com.mx antes de usarla.
                    </p>
                  )}
                  {events.length > 0 && <p className="mt-auto pt-1 text-[11px] text-muted-foreground">Se usa en: {events.join(", ")}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
