// Centro de mensajería de WhatsApp (bloques B7/B7b, decisión D8): qué mensaje
// manda FindMed en cada evento de la cita, quién lo envía hoy (n8n o FindMed),
// el historial de envíos con su estado de entrega y el catálogo de plantillas
// aprobadas en WHAAPY. Las lecturas van por RLS; todo lo que escribe o habla
// con WHAAPY pasa por la Edge Function messaging-admin.
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { PARAM_LABEL, STATUS_LABEL } from "@/lib/messaging-labels";
import { MessageSquare, Pencil, Plus, RefreshCw, Send, Trash2 } from "lucide-react";

type Route = Tables<"message_routes">;
type Step = Tables<"message_route_steps">;
type Delivery = Tables<"message_deliveries">;
type OutboxRow = Tables<"domain_outbox">;

const OWNER_LABEL: Record<string, string> = { n8n: "n8n (actual)", findmed: "FindMed", none: "Nadie" };

const DELIVERY_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  sending: { label: "Enviando", variant: "outline" },
  accepted: { label: "Aceptado", variant: "secondary" },
  sent: { label: "Enviado", variant: "secondary" },
  delivered: { label: "Entregado", variant: "default" },
  read: { label: "Leído", variant: "default" },
  failed: { label: "Falló", variant: "destructive" },
  uncertain: { label: "Incierto", variant: "destructive" },
};

const OUTBOX_LABEL: Record<string, string> = {
  pending: "En cola",
  processing: "Procesando",
  failed: "Falló",
  uncertain: "Incierto",
};

/** Llama a messaging-admin; en error lanza Error con el mensaje (y problemas) del backend. */
async function messagingAdmin<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await supabase.functions.invoke("messaging-admin", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.error) {
    let message = "No se pudo completar la acción.";
    let code: string | null = null;
    const ctx = (res.error as { context?: Response }).context;
    if (ctx && typeof ctx.clone === "function") {
      const json = await ctx.clone().json().catch(() => null) as { error?: string; message?: string; problems?: string[] } | null;
      if (json?.message) message = json.message;
      if (json?.problems?.length) message = json.problems.join(" ");
      code = json?.error ?? null;
    }
    const err = new Error(message) as Error & { code?: string | null };
    err.code = code;
    throw err;
  }
  return res.data as T;
}

const fmt = (iso: string) => format(parseISO(iso), "d MMM yyyy, HH:mm", { locale: es });

export default function Mensajeria() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Mensajería</h1>
        <p className="text-sm text-muted-foreground">
          Mensajes de WhatsApp que recibe el paciente en cada momento de su cita, quién los envía y si llegaron.
        </p>
      </div>
      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Eventos</TabsTrigger>
          <TabsTrigger value="deliveries">Envíos</TabsTrigger>
          <TabsTrigger value="templates">Plantillas</TabsTrigger>
        </TabsList>
        <TabsContent value="events"><EventsTab /></TabsContent>
        <TabsContent value="deliveries"><DeliveriesTab /></TabsContent>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
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

/* ───────── Eventos ───────── */

function EventsTab() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StepDraft | null>(null);
  const [ownerChange, setOwnerChange] = useState<{ route: Route; owner: string } | null>(null);
  const [toDelete, setToDelete] = useState<Step | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["message-routes"],
    queryFn: async () => {
      const [routes, steps] = await Promise.all([
        supabase.from("message_routes").select("*").order("description"),
        supabase.from("message_route_steps").select("*").order("position"),
      ]);
      if (routes.error) throw routes.error;
      if (steps.error) throw steps.error;
      return { routes: routes.data ?? [], steps: steps.data ?? [] };
    },
    placeholderData: keepPreviousData,
  });
  const { data: templates, error: templatesError } = useTemplates();

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["message-routes"] });
  const onError = (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" });

  const setOwner = useMutation({
    mutationFn: (v: { event_type: string; owner: string }) => messagingAdmin({ action: "set_owner", ...v }),
    onSuccess: () => {
      refresh();
      toast({ title: "Dueño del evento actualizado" });
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

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  const routes = data?.routes ?? [];
  const steps = data?.steps ?? [];

  return (
    <div className="space-y-4">
      {templatesError && (
        <p className="text-sm text-destructive">
          No se pudo leer el catálogo de WHAAPY: {(templatesError as Error).message}
        </p>
      )}
      {routes.map((route) => {
        const routeSteps = steps
          .filter((s) => s.event_type === route.event_type)
          .sort((a, b) => (a.when_status ?? "").localeCompare(b.when_status ?? "") || a.position - b.position);
        const nextPosition = Math.max(0, ...routeSteps.map((s) => s.position)) + 1;
        return (
          <Card key={route.event_type}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">{route.description ?? route.event_type}</CardTitle>
                <p className="text-xs text-muted-foreground">{route.event_type}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Lo envía</span>
                <Select value={route.owner} onValueChange={(owner) => owner !== route.owner && setOwnerChange({ route, owner })}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(OWNER_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {routeSteps.length === 0 && <p className="text-sm text-muted-foreground">Sin mensajes al paciente.</p>}
              {routeSteps.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
                  <Badge variant="outline">#{s.position}</Badge>
                  {s.when_status && (
                    <Badge variant="secondary">
                      {STATUS_LABEL[s.when_status]}
                      {s.when_cancel_reason ? ` · ${s.when_cancel_reason === "patient" ? "por el paciente" : s.when_cancel_reason}` : ""}
                    </Badge>
                  )}
                  <span className="font-medium">{s.template_name}</span>
                  <span className="text-muted-foreground">
                    {s.body_params.map((p) => PARAM_LABEL[p] ?? p).join(" · ")}
                    {s.url_button_param ? " · enlace /gestionar" : ""}
                    {s.quick_reply_action ? ` · botón ${s.quick_reply_action === "confirm" ? "confirmar" : "cancelar"}` : ""}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <Switch
                      checked={s.enabled}
                      disabled={saveStep.isPending}
                      onCheckedChange={(enabled) => saveStep.mutate({ ...(s as StepDraft), enabled })}
                    />
                    <Button size="icon" variant="ghost" onClick={() => setDraft(s as StepDraft)} aria-label="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setToDelete(s)} aria-label="Eliminar">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={!templates}
                onClick={() =>
                  setDraft({
                    event_type: route.event_type,
                    when_status: null,
                    when_cancel_reason: null,
                    position: nextPosition,
                    template_name: "",
                    language: "es_MX",
                    body_params: [],
                    url_button_param: null,
                    quick_reply_action: null,
                    enabled: true,
                  })}
              >
                <Plus className="h-4 w-4" /> Agregar mensaje
              </Button>
            </CardContent>
          </Card>
        );
      })}

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
            <AlertDialogTitle>¿Cambiar quién envía este mensaje?</AlertDialogTitle>
            <AlertDialogDescription>
              {ownerChange?.owner === "findmed" &&
                "Desde ahora FindMed enviará estos mensajes por WHAAPY y n8n dejará de recibir el evento. Antes se revisa que cada mensaje coincida con su plantilla."}
              {ownerChange?.owner === "n8n" && "n8n volverá a recibir el evento y FindMed dejará de enviar estos mensajes."}
              {ownerChange?.owner === "none" && "Nadie enviará mensajes al paciente para este evento."}
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
              Confirmar
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
  const [resendTarget, setResendTarget] = useState<Delivery | null>(null);
  const [acceptRisk, setAcceptRisk] = useState(false);

  const { data: deliveries, isLoading } = useQuery({
    queryKey: ["message-deliveries", statusFilter],
    queryFn: async () => {
      let q = supabase.from("message_deliveries").select("*").order("created_at", { ascending: false }).limit(100);
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

  return (
    <div className="space-y-4">
      {stuck && stuck.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Eventos pendientes o con problema</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {stuck.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-md border p-2">
                <Badge variant={o.status === "failed" || o.status === "uncertain" ? "destructive" : "secondary"}>
                  {OUTBOX_LABEL[o.status] ?? o.status}
                </Badge>
                <span>{o.event_type}</span>
                <span className="text-muted-foreground">{fmt(o.created_at)}</span>
                {o.last_error && <span className="text-muted-foreground">· {o.last_error}</span>}
                {o.status === "failed" && (
                  <Button size="sm" variant="outline" className="ml-auto gap-2" disabled={retry.isPending} onClick={() => retry.mutate(o.id)}>
                    <RefreshCw className="h-4 w-4" /> Reintentar
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(DELIVERY_BADGE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : deliveries && deliveries.length > 0 ? (
        <div className="space-y-2">
          {deliveries.map((d) => {
            const badge = DELIVERY_BADGE[d.status] ?? { label: d.status, variant: "outline" as const };
            return (
              <Card key={d.id}>
                <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="font-medium">{d.template_name}</span>
                  <span className="text-muted-foreground">{d.to_phone}</span>
                  <span className="text-muted-foreground">{fmt(d.created_at)}</span>
                  {d.source === "manual" && <Badge variant="outline">Reenvío manual</Badge>}
                  {d.error_message && <span className="w-full text-destructive">{d.error_message}</span>}
                  {(d.status === "failed" || d.status === "uncertain") && (
                    <Button size="sm" variant="outline" className="ml-auto gap-2" onClick={() => setResendTarget(d)}>
                      <Send className="h-4 w-4" /> Reenviar
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
            <MessageSquare className="h-8 w-8" />
            <p>Aún no hay envíos de FindMed. Aparecerán cuando un evento pase de n8n a FindMed.</p>
          </CardContent>
        </Card>
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
  const queryClient = useQueryClient();
  const { data: templates, isLoading, error } = useTemplates();
  const sync = useMutation({
    mutationFn: () => messagingAdmin({ action: "sync_templates" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whaapy-templates"] });
      toast({ title: "Plantillas sincronizadas con Meta" });
    },
    onError: (e: Error) => toast({ title: "No se pudo sincronizar", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Plantillas aprobadas por Meta en la cuenta de WHAAPY. Las nuevas se crean y aprueban en Meta; aquí aparecen al sincronizar.
        </p>
        <Button size="sm" variant="outline" className="gap-2" disabled={sync.isPending} onClick={() => sync.mutate()}>
          <RefreshCw className="h-4 w-4" /> Sincronizar
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(templates ?? []).map((t) => (
            <Card key={`${t.name}-${t.language}`}>
              <CardContent className="space-y-2 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <Badge variant={t.status.toUpperCase() === "APPROVED" ? "secondary" : "destructive"}>{t.status}</Badge>
                  <Badge variant="outline">{t.category}</Badge>
                  <span className="text-xs text-muted-foreground">{t.language}</span>
                </div>
                <p className="whitespace-pre-wrap text-muted-foreground">{t.body}</p>
                {t.buttons.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {t.buttons.map((b, i) => <Badge key={i} variant="outline">{b.text}</Badge>)}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
