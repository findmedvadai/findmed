// Agente IA (Configuración): estado de la conexión FindMed ↔ WHAAPY y bitácora
// de todo lo que pasa entre el agente de WhatsApp, el paciente y la
// plataforma — herramientas que usa el agente (mcp_requests), mensajes del
// paciente y respuestas de la IA (whaapy_events), plantillas enviadas por
// FindMed (message_deliveries) y movimientos de casos (case_events). Incluye
// un resumen de solo lectura del catálogo de triaje que usa el agente.
// Sirve para operar el arranque: ver en vivo qué hace el agente y dónde falla.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { messagingAdmin, type IntegrationHealth } from "@/lib/messaging-admin";
import { PageHeader } from "@/components/app/PageHeader";
import { FilterBar, SearchInput } from "@/components/app/FilterBar";
import { StatCard, type Tone } from "@/components/app/StatCard";
import { SoftBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Gauge,
  LifeBuoy,
  ListChecks,
  MessageCircle,
  Plug,
  RefreshCw,
  Send,
  Webhook,
  Wrench,
  XCircle,
} from "lucide-react";

/* ───────── tipos y helpers ───────── */

type Source = "agent" | "patient" | "ai_reply" | "staff_reply" | "template" | "receipt" | "case" | "system";

interface ActivityItem {
  id: string;
  at: string;
  source: Source;
  ok: boolean;
  title: string;
  detail?: string | null;
  phone?: string | null;
  raw: unknown;
}

const SOURCE: Record<Source, { label: string; icon: typeof Bot; className: string }> = {
  agent: { label: "Herramienta del agente", icon: Wrench, className: "text-primary" },
  patient: { label: "Paciente", icon: MessageCircle, className: "text-foreground" },
  ai_reply: { label: "Respuesta de la IA", icon: Bot, className: "text-primary" },
  staff_reply: { label: "Respuesta del equipo", icon: MessageCircle, className: "text-muted-foreground" },
  template: { label: "Plantilla de FindMed", icon: Send, className: "text-success" },
  receipt: { label: "Recibo de WhatsApp", icon: CheckCircle2, className: "text-muted-foreground" },
  case: { label: "Caso", icon: LifeBuoy, className: "text-warning" },
  system: { label: "Sistema", icon: AlertTriangle, className: "text-muted-foreground" },
};

const TOOL_LABEL: Record<string, string> = {
  search_care_options: "buscó médicos",
  list_available_slots: "consultó horarios",
  create_booking_link: "generó enlace de reserva",
  list_my_appointments: "consultó citas del paciente",
  prepare_appointment_action: "preparó confirmar/cancelar",
  commit_appointment_action: "ejecutó confirmar/cancelar",
  get_operation_status: "consultó estado de una acción",
  open_case: "abrió un caso",
  request_handoff: "pasó a una persona",
  get_my_case_status: "consultó estado del caso",
};

const RANGES: Record<string, number> = { "1h": 1, "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };
const PAGE_SIZE = 50;

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
/** Últimos 10 dígitos: compara +52XXXXXXXXXX, 521XXXXXXXXXX y 52XXXXXXXXXX. */
const samePhone = (a: string | null | undefined, b: string) => {
  const x = digits(a).slice(-10);
  return x.length === 10 && x === digits(b).slice(-10);
};

/** Texto legible de un mensaje de WhatsApp en formato Meta. */
function messageText(data: Record<string, unknown>): string {
  const m = (data.message ?? {}) as Record<string, unknown>;
  const text = (m.text as { body?: string } | undefined)?.body;
  const button = (m.button as { text?: string; payload?: string } | undefined);
  const reply = (m.interactive as { button_reply?: { title?: string; id?: string } } | undefined)?.button_reply;
  if (typeof data.transcription === "string") return `🎤 ${data.transcription}`;
  if (text) return text;
  if (button) return `Botón: ${button.text ?? button.payload}`;
  if (reply) return `Botón: ${reply.title ?? reply.id}`;
  const type = String(m.type ?? "mensaje");
  return `[${type}]`;
}

const ago = (iso: string | null | undefined) =>
  iso ? formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: es }) : "nunca";

function copyText(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast({ title: "Copiado" }),
    () => toast({ title: "No se pudo copiar", variant: "destructive" }),
  );
}

/* ───────── datos de conexión ───────── */

function useAgentHealth() {
  return useQuery({
    queryKey: ["agent-health"],
    queryFn: () => messagingAdmin<IntegrationHealth>({ action: "health" }),
    refetchInterval: 60_000,
    retry: false,
  });
}

function useAgentStats() {
  return useQuery({
    queryKey: ["agent-stats"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
      const [lastConn, lastCall, calls, errors, authFails, lastEvent, events, evErrors, routes, stuck] = await Promise.all([
        supabase.from("mcp_requests").select("created_at").in("kind", ["initialize", "tools/list"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("mcp_requests").select("created_at").eq("kind", "tools/call").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("mcp_requests").select("id", { count: "exact", head: true }).eq("kind", "tools/call").gte("created_at", since),
        supabase.from("mcp_requests").select("id", { count: "exact", head: true }).eq("ok", false).neq("kind", "auth_failed").gte("created_at", since),
        supabase.from("mcp_requests").select("id", { count: "exact", head: true }).eq("kind", "auth_failed").gte("created_at", since),
        supabase.from("whaapy_events").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("whaapy_events").select("id", { count: "exact", head: true }).gte("received_at", since),
        supabase.from("whaapy_events").select("id", { count: "exact", head: true }).not("processing_error", "is", null).gte("received_at", since),
        supabase.from("message_routes").select("owner"),
        supabase.from("domain_outbox").select("id", { count: "exact", head: true }).in("status", ["failed", "uncertain"]),
      ]);
      const owners = (routes.data ?? []).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.owner]: (acc[r.owner] ?? 0) + 1 }), {});
      return {
        lastConnection: lastConn.data?.created_at ?? null,
        lastCall: lastCall.data?.created_at ?? null,
        calls24h: calls.count ?? 0,
        errors24h: errors.count ?? 0,
        authFails24h: authFails.count ?? 0,
        lastEvent: lastEvent.data?.received_at ?? null,
        events24h: events.count ?? 0,
        eventErrors24h: evErrors.count ?? 0,
        owners,
        stuckOutbox: stuck.count ?? 0,
      };
    },
    refetchInterval: 20_000,
    placeholderData: keepPreviousData,
  });
}

type Stats = NonNullable<ReturnType<typeof useAgentStats>["data"]>;

/* ───────── página ───────── */

export default function AgenteIA() {
  const health = useAgentHealth();
  const stats = useAgentStats();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agente IA"
        description="Conexión con WHAAPY y bitácora de lo que hace el agente de WhatsApp con los pacientes y con FindMed."
        actions={
          <>
            {health.data && (
              <span className="text-xs text-muted-foreground">Revisado {ago(health.data.checked_at)}</span>
            )}
            <Button size="sm" variant="outline" className="gap-2" disabled={health.isFetching} onClick={() => health.refetch()}>
              <RefreshCw className={cn("h-4 w-4", health.isFetching && "animate-spin")} /> Revisar conexión
            </Button>
          </>
        }
      />

      <StatusTiles health={health.data} healthLoading={health.isLoading} healthError={!!health.error} stats={stats.data} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ConnectionCard health={health.data} healthLoading={health.isLoading} healthError={health.error as Error | null} stats={stats.data} />
        <TriageCatalogCard />
      </div>

      <Tabs defaultValue="activity" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Bitácora</h2>
          <TabsList className="h-9">
            <TabsTrigger value="activity" className="gap-1.5 text-sm">
              <Activity className="h-3.5 w-3.5" /> Actividad
            </TabsTrigger>
            <TabsTrigger value="errors" className="gap-1.5 text-sm">
              <CircleAlert className="h-3.5 w-3.5" /> Errores
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="activity" className="mt-0"><ActivityLog errorsOnly={false} /></TabsContent>
        <TabsContent value="errors" className="mt-0"><ActivityLog errorsOnly /></TabsContent>
      </Tabs>

      <SetupGuide />
    </div>
  );
}

/* ───────── indicadores ───────── */

function StatusTiles({
  health,
  healthLoading,
  healthError,
  stats,
}: {
  health: IntegrationHealth | undefined;
  healthLoading: boolean;
  healthError: boolean;
  stats: Stats | undefined;
}) {
  if (!stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[84px] rounded-lg" />)}
      </div>
    );
  }

  const api = health?.whaapy_api;
  const apiTile: { value: string; tone: Tone; hint: string } = !health
    ? healthLoading && !healthError
      ? { value: "Verificando…", tone: "neutral", hint: "Consultando la API de WHAAPY" }
      : { value: "Sin datos", tone: "neutral", hint: "No se pudo consultar la integración" }
    : !api?.configured
    ? { value: "Sin llave", tone: "danger", hint: "Falta configurar la llave de API" }
    : api.ok
    ? { value: "Conectado", tone: "success", hint: `${api.approved ?? 0} de ${api.templates ?? 0} plantillas aprobadas` }
    : { value: "Con error", tone: "danger", hint: api.error ? `HTTP ${api.http_status ?? "?"}: ${api.error}` : "WHAAPY no responde" };

  const mcpToken = health ? !!health.secrets.FINDMED_MCP_TOKEN : null;
  const lastTool = `Última herramienta ${ago(stats.lastCall)}`;
  const mcpTile: { value: string; tone: Tone; hint: string } =
    mcpToken === null && healthLoading && !healthError && !stats.lastConnection
      ? { value: "Verificando…", tone: "neutral", hint: lastTool }
      : mcpToken === false
      ? { value: "Sin token", tone: "danger", hint: "Falta el secreto FINDMED_MCP_TOKEN" }
      : stats.authFails24h > 0
      ? { value: "Rechazado", tone: "warning", hint: `${stats.authFails24h} intentos con token inválido en 24 h` }
      : stats.lastConnection
      ? { value: "Conectado", tone: "success", hint: lastTool }
      : { value: "Sin conexión", tone: "warning", hint: "WHAAPY aún no prueba la conexión" };

  const agentErrors = stats.errors24h + stats.authFails24h;
  const latency = api?.latency_ms;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <StatCard label="WHAAPY API" value={apiTile.value} hint={apiTile.hint} icon={MessageCircle} tone={apiTile.tone} />
      <StatCard label="MCP del agente" value={mcpTile.value} hint={mcpTile.hint} icon={Plug} tone={mcpTile.tone} />
      <StatCard label="Llamadas · 24 h" value={stats.calls24h} hint={`${stats.events24h} eventos recibidos de WHAAPY`} icon={Wrench} tone="info" />
      <StatCard
        label="Errores · 24 h"
        value={agentErrors}
        hint={
          stats.authFails24h
            ? `${stats.authFails24h} con token rechazado`
            : stats.eventErrors24h
            ? `${stats.eventErrors24h} eventos de WHAAPY con error`
            : "Sin fallas del agente"
        }
        icon={CircleAlert}
        tone={agentErrors ? "danger" : stats.eventErrors24h ? "warning" : "success"}
      />
      <StatCard
        label="Latencia WHAAPY"
        value={latency != null ? `${latency} ms` : "—"}
        hint="Respuesta de la API en la última revisión"
        icon={Gauge}
        tone={latency == null ? "neutral" : latency > 2000 ? "warning" : "neutral"}
      />
    </div>
  );
}

/* ───────── estado de la conexión ───────── */

function CheckLine({ ok, label, detail }: { ok: boolean | null; label: ReactNode; detail?: ReactNode }) {
  const Icon = ok === null ? AlertTriangle : ok ? CheckCircle2 : XCircle;
  const cls = ok === null ? "text-muted-foreground" : ok ? "text-success" : "text-destructive";
  return (
    <li className="flex items-start gap-2">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", cls)} />
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
    </li>
  );
}

function ConnectionSection({
  icon: Icon,
  title,
  checks,
  children,
}: {
  icon: typeof Bot;
  title: string;
  checks: (boolean | null)[];
  children: ReactNode;
}) {
  const status: { label: string; tone: Tone } = checks.some((c) => c === false)
    ? { label: "Revisar", tone: "danger" }
    : checks.some((c) => c === null)
    ? { label: "Verificando…", tone: "neutral" }
    : { label: "Correcto", tone: "success" };
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <SoftBadge tone={status.tone} dot>{status.label}</SoftBadge>
        </div>
        <ul className="space-y-1">{children}</ul>
      </div>
    </div>
  );
}

function ConnectionCard({
  health,
  healthLoading,
  healthError,
  stats,
}: {
  health: IntegrationHealth | undefined;
  healthLoading: boolean;
  healthError: Error | null;
  stats: Stats | undefined;
}) {
  const api = health?.whaapy_api;
  const apiConfigured = health ? !!api?.configured : healthError ? false : null;
  const apiOk = api ? api.ok : null;
  const mcpToken = health ? !!health.secrets.FINDMED_MCP_TOKEN : null;
  const mcpConnected = stats ? !!stats.lastConnection : null;
  const mcpClean = stats ? stats.errors24h === 0 && stats.authFails24h === 0 : null;
  const webhookSecret = health ? !!health.secrets.WHAAPY_WEBHOOK_SECRET : null;
  const webhookReceiving = stats ? !!stats.lastEvent : null;
  const outboxClean = stats ? stats.stuckOutbox === 0 : null;

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-semibold">Conexiones</CardTitle>
        <CardDescription className="text-xs">Las tres vías entre FindMed, WHAAPY y el agente.</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {healthError && (
          <p className="mb-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            No se pudo consultar el estado de la integración: {healthError.message}
          </p>
        )}
        {healthLoading && !stats ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}</div>
        ) : (
          <div className="divide-y">
            <ConnectionSection icon={MessageCircle} title="FindMed → WHAAPY (API)" checks={[apiConfigured, apiOk]}>
              <CheckLine ok={apiConfigured} label="Llave de API configurada" />
              <CheckLine
                ok={apiOk}
                label={api?.ok ? "WHAAPY responde" : "WHAAPY no responde"}
                detail={
                  api?.ok
                    ? `${api.approved} plantillas aprobadas de ${api.templates} · ${api.latency_ms} ms`
                    : api?.error
                    ? `HTTP ${api.http_status}: ${api.error}`
                    : null
                }
              />
            </ConnectionSection>
            <ConnectionSection icon={Bot} title="Agente → FindMed (MCP)" checks={[mcpToken, mcpConnected, mcpClean]}>
              <CheckLine ok={mcpToken} label="Token del MCP configurado" />
              <CheckLine
                ok={mcpConnected}
                label={`Última prueba de conexión ${ago(stats?.lastConnection)}`}
                detail={`Última herramienta usada ${ago(stats?.lastCall)}`}
              />
              <CheckLine
                ok={mcpClean}
                label={`${stats?.calls24h ?? 0} llamadas en 24 h`}
                detail={`${stats?.errors24h ?? 0} con error · ${stats?.authFails24h ?? 0} con token rechazado`}
              />
            </ConnectionSection>
            <ConnectionSection icon={Webhook} title="WHAAPY → FindMed (webhook)" checks={[webhookSecret, webhookReceiving, outboxClean]}>
              <CheckLine ok={webhookSecret} label="Secreto del webhook configurado" />
              <CheckLine
                ok={webhookReceiving}
                label={`Último evento recibido ${ago(stats?.lastEvent)}`}
                detail={`${stats?.events24h ?? 0} eventos en 24 h · ${stats?.eventErrors24h ?? 0} con error al procesar`}
              />
              <CheckLine
                ok={outboxClean}
                label={`Mensajes de FindMed: ${stats?.owners.findmed ?? 0} eventos propios, ${stats?.owners.n8n ?? 0} en n8n`}
                detail={
                  stats?.stuckOutbox ? (
                    <>
                      {stats.stuckOutbox} envío(s) fallidos o inciertos ·{" "}
                      <Link to="/admin/automatizacion?tab=envios" className="font-medium text-primary hover:underline">
                        Ver en Automatización
                      </Link>
                    </>
                  ) : null
                }
              />
            </ConnectionSection>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────── catálogo de triaje (solo lectura) ───────── */

const PRIMERA_PARADA: { key: string; label: string; tone: Tone }[] = [
  { key: "urgencias_inmediato", label: "Urgencias inmediato", tone: "danger" },
  { key: "urgencias_hoy", label: "Urgencias hoy", tone: "warning" },
  { key: "consulta_mismo_dia", label: "Consulta el mismo día", tone: "info" },
  { key: "consulta", label: "Consulta", tone: "success" },
];

const ORIGEN: { key: string; label: string }[] = [
  { key: "n8n_v1", label: "n8n v1" },
  { key: "n8n_v1_ajustado", label: "n8n v1 ajustado" },
  { key: "nuevo", label: "Nuevo" },
];

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/40",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

function useTriageCatalog() {
  return useQuery({
    queryKey: ["triage-catalog-summary"],
    queryFn: async () => {
      const [conditions, specialties] = await Promise.all([
        supabase.from("triage_findmed").select("especialidad, primera_parada, validado, origen", { count: "exact" }),
        supabase.from("triage_specialty_map").select("especialidad, patient_label, search_specialties"),
      ]);
      if (conditions.error) throw conditions.error;
      if (specialties.error) throw specialties.error;
      const rows = conditions.data ?? [];
      const byParada: Record<string, number> = {};
      const byOrigen: Record<string, number> = {};
      const bySpecialty: Record<string, number> = {};
      for (const r of rows) {
        const p = r.primera_parada ?? "sin_definir";
        const o = r.origen ?? "sin_definir";
        byParada[p] = (byParada[p] ?? 0) + 1;
        byOrigen[o] = (byOrigen[o] ?? 0) + 1;
        bySpecialty[r.especialidad] = (bySpecialty[r.especialidad] ?? 0) + 1;
      }
      const withoutDoctors = (specialties.data ?? [])
        .filter((s) => (s.search_specialties ?? []).length === 0)
        .map((s) => ({ especialidad: s.especialidad, label: s.patient_label, conditions: bySpecialty[s.especialidad] ?? 0 }))
        .sort((a, b) => b.conditions - a.conditions || a.label.localeCompare(b.label, "es"));
      return {
        total: conditions.count ?? rows.length,
        loaded: rows.length,
        validated: rows.filter((r) => r.validado).length,
        byParada,
        byOrigen,
        withoutDoctors,
      };
    },
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

function CountRow({ label, value, tone }: { label: string; value: number; tone?: Tone }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {tone && <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[tone])} />}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </li>
  );
}

function TriageCatalogCard() {
  const { data, isLoading, error } = useTriageCatalog();
  const pending = data ? data.loaded - data.validated : 0;
  const pct = data && data.loaded ? Math.round((data.validated / data.loaded) * 100) : 0;
  const otherParada = data ? Object.entries(data.byParada).filter(([k]) => !PRIMERA_PARADA.some((p) => p.key === k)).reduce((n, [, v]) => n + v, 0) : 0;
  const otherOrigen = data ? Object.entries(data.byOrigen).filter(([k]) => !ORIGEN.some((o) => o.key === k)).reduce((n, [, v]) => n + v, 0) : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 pb-2">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-sm font-semibold">Catálogo de triaje</CardTitle>
          <CardDescription className="text-xs">Condiciones con las que el agente orienta al paciente. Solo lectura.</CardDescription>
        </div>
        {data && <SoftBadge tone="neutral">{data.total} condiciones</SoftBadge>}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-24 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">No se pudo leer el catálogo: {(error as Error).message}</p>
        ) : !data || data.total === 0 ? (
          <EmptyState icon={ListChecks} title="El catálogo está vacío" description="Se carga con scripts/import-triage.mjs." className="py-6" />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-foreground">Validadas por el equipo médico</span>
                <span className="font-medium tabular-nums text-foreground">
                  {data.validated} <span className="font-normal text-muted-foreground">de {data.loaded}</span>
                </span>
              </div>
              <Progress value={pct} className="h-1.5" aria-label="Condiciones validadas" />
              <p className={cn("text-xs", pending ? "text-warning" : "text-success")}>
                {pending ? `${pending} pendientes de validar: el agente las usa, pero falta la revisión clínica.` : "Todo el catálogo está validado."}
              </p>
              {data.loaded < data.total && (
                <p className="text-xs text-muted-foreground">Conteos sobre las primeras {data.loaded} condiciones.</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Primera parada</p>
                <ul className="space-y-1">
                  {PRIMERA_PARADA.map((p) => <CountRow key={p.key} label={p.label} value={data.byParada[p.key] ?? 0} tone={p.tone} />)}
                  {otherParada > 0 && <CountRow label="Sin definir" value={otherParada} tone="neutral" />}
                </ul>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Origen</p>
                <ul className="space-y-1">
                  {ORIGEN.map((o) => <CountRow key={o.key} label={o.label} value={data.byOrigen[o.key] ?? 0} />)}
                  {otherOrigen > 0 && <CountRow label="Otro / sin definir" value={otherOrigen} />}
                </ul>
              </div>
            </div>

            <div className="space-y-1.5 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">Especialidades sin médicos en FindMed</p>
                <span className="text-xs tabular-nums text-muted-foreground">{data.withoutDoctors.length}</span>
              </div>
              {data.withoutDoctors.length === 0 ? (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Todas las especialidades del catálogo tienen médicos.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">FindMed no tiene médicos: el agente pasa a una persona.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.withoutDoctors.map((s) => (
                      <SoftBadge key={s.especialidad} tone="warning">
                        {s.label}
                        {s.conditions > 0 && <span className="tabular-nums opacity-70">· {s.conditions}</span>}
                      </SoftBadge>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────── bitácora ───────── */

function ActivityLog({ errorsOnly }: { errorsOnly: boolean }) {
  const [range, setRange] = useState("24h");
  const [phone, setPhone] = useState("");
  const [showReceipts, setShowReceipts] = useState(false);
  const [selected, setSelected] = useState<ActivityItem | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data: items, isLoading } = useQuery({
    queryKey: ["agent-activity", range],
    queryFn: async (): Promise<ActivityItem[]> => {
      const since = new Date(Date.now() - RANGES[range] * 3_600_000).toISOString();
      const [mcp, events, deliveries, cases] = await Promise.all([
        supabase.from("mcp_requests").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(300),
        supabase.from("whaapy_events").select("id, event_type, received_at, payload, processing_error").gte("received_at", since).order("received_at", { ascending: false }).limit(300),
        supabase.from("message_deliveries").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(200),
        supabase.from("case_events").select("*, patient_cases(subject_phone, request_type)").gte("created_at", since).order("created_at", { ascending: false }).limit(200),
      ]);
      const out: ActivityItem[] = [];

      for (const r of mcp.data ?? []) {
        const tool = r.tool_name ? TOOL_LABEL[r.tool_name] ?? r.tool_name : null;
        const title = r.kind === "tools/call"
          ? `El agente ${tool ?? "usó una herramienta"}`
          : r.kind === "auth_failed"
          ? "WHAAPY intentó conectarse con un token inválido"
          : r.kind === "initialize" || r.kind === "tools/list"
          ? "WHAAPY probó la conexión con el MCP"
          : `Solicitud ${r.method ?? r.kind}`;
        out.push({
          id: `mcp-${r.id}`,
          at: r.created_at,
          source: r.kind === "tools/call" ? "agent" : "system",
          ok: r.ok,
          title,
          detail: r.ok ? (r.status && r.status !== "success" ? `Resultado: ${r.status}` : r.duration_ms ? `${r.duration_ms} ms` : null) : `${r.error_code ?? "error"}${r.error_message ? `: ${r.error_message}` : ""}`,
          phone: r.subject_phone,
          raw: r,
        });
      }

      for (const e of events.data ?? []) {
        const data = ((e.payload as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
        const failed = !!e.processing_error || e.event_type === "message.failed";
        if (e.event_type === "message.received") {
          const from = String((data.message as { from?: string } | undefined)?.from ?? "");
          out.push({ id: `ev-${e.id}`, at: e.received_at, source: "patient", ok: !e.processing_error, title: messageText(data), detail: e.processing_error, phone: from, raw: e });
        } else if (e.event_type === "message.sent") {
          const ai = data.sent_by_ai === true;
          out.push({
            id: `ev-${e.id}`, at: e.received_at, source: ai ? "ai_reply" : "staff_reply", ok: true,
            title: String(data.content ?? `[${data.type ?? "mensaje"}]`), phone: String(data.to ?? ""), raw: e,
          });
        } else if (["message.delivered", "message.read", "message.failed"].includes(e.event_type)) {
          const err = data.error as { code?: string; message?: string } | undefined;
          out.push({
            id: `ev-${e.id}`, at: e.received_at, source: "receipt", ok: !failed,
            title: e.event_type === "message.failed" ? "WhatsApp no pudo entregar un mensaje" : e.event_type === "message.read" ? "Mensaje leído" : "Mensaje entregado",
            detail: err ? `${err.code}: ${err.message}` : e.processing_error, phone: String(data.to ?? ""), raw: e,
          });
        } else {
          out.push({ id: `ev-${e.id}`, at: e.received_at, source: "system", ok: !failed, title: `WHAAPY: ${e.event_type}`, detail: e.processing_error, raw: e });
        }
      }

      for (const d of deliveries.data ?? []) {
        const bad = d.status === "failed" || d.status === "uncertain";
        out.push({
          id: `del-${d.id}`, at: d.created_at, source: "template", ok: !bad,
          title: `FindMed envió "${d.template_name}" · ${d.status}`, detail: d.error_message, phone: d.to_phone, raw: d,
        });
      }

      for (const c of cases.data ?? []) {
        const pc = c.patient_cases as { subject_phone?: string; request_type?: string } | null;
        out.push({
          id: `case-${c.id}`, at: c.created_at, source: "case", ok: !c.event_type.endsWith("_failed"),
          title: `Caso ${pc?.request_type ?? ""}: ${c.event_type.replace(/_/g, " ")}`, phone: pc?.subject_phone ?? null, raw: c,
        });
      }

      return out.sort((a, b) => (a.at < b.at ? 1 : -1));
    },
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });

  const visible = useMemo(() => {
    let list = items ?? [];
    if (errorsOnly) list = list.filter((i) => !i.ok);
    else if (!showReceipts) list = list.filter((i) => i.source !== "receipt" || !i.ok);
    if (digits(phone).length >= 10) list = list.filter((i) => samePhone(i.phone, phone));
    return list;
  }, [items, errorsOnly, showReceipts, phone]);

  const shown = visible.slice(0, limit);
  const filtered = digits(phone).length >= 10;

  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchInput value={phone} onChange={setPhone} placeholder="Teléfono (10 dígitos)" />
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="h-9 w-[160px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1h">Última hora</SelectItem>
            <SelectItem value="24h">Últimas 24 h</SelectItem>
            <SelectItem value="7d">Últimos 7 días</SelectItem>
            <SelectItem value="30d">Últimos 30 días</SelectItem>
          </SelectContent>
        </Select>
        {!errorsOnly && (
          <label className="flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm text-muted-foreground">
            <Switch checked={showReceipts} onCheckedChange={setShowReceipts} className="scale-90" aria-label="Mostrar recibos de entrega" />
            Recibos de entrega
          </label>
        )}
        <span className="text-xs text-muted-foreground sm:ml-auto">
          {visible.length} registros · se actualiza cada 15 s
        </span>
      </FilterBar>

      {isLoading ? (
        <Card className="overflow-hidden">
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        </Card>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={errorsOnly ? CheckCircle2 : Activity}
          title={errorsOnly ? "Sin errores en este periodo" : "Sin actividad en este periodo"}
          description={
            filtered
              ? "No hay registros para ese teléfono. Prueba con otro periodo."
              : errorsOnly
              ? "Aquí aparecen las llamadas fallidas del agente, eventos de WHAAPY con error y envíos que no salieron."
              : "Aquí aparece cada herramienta que usa el agente, los mensajes del paciente y lo que envía FindMed."
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="h-9 w-[120px] text-xs">Hora</TableHead>
                <TableHead className="hidden h-9 w-[190px] text-xs md:table-cell">Origen</TableHead>
                <TableHead className="h-9 text-xs">Evento</TableHead>
                <TableHead className="hidden h-9 w-[150px] text-xs lg:table-cell">Teléfono</TableHead>
                <TableHead className="h-9 w-8 text-xs"><span className="sr-only">Ver detalle</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((i) => {
                const s = SOURCE[i.source];
                return (
                  <TableRow
                    key={i.id}
                    tabIndex={0}
                    onClick={() => setSelected(i)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(i);
                      }
                    }}
                    className={cn(
                      "cursor-pointer focus-visible:bg-accent/60 focus-visible:outline-none",
                      !i.ok && "bg-destructive/5 hover:bg-destructive/10",
                    )}
                  >
                    <TableCell className="whitespace-nowrap py-2.5 align-top text-xs tabular-nums text-muted-foreground">
                      {format(parseISO(i.at), "d MMM, HH:mm:ss", { locale: es })}
                    </TableCell>
                    <TableCell className="hidden py-2.5 align-top md:table-cell">
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <s.icon className={cn("h-3.5 w-3.5 shrink-0", i.ok ? s.className : "text-destructive")} />
                        {s.label}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5 align-top">
                      <div className="flex items-start gap-2">
                        {!i.ok && <SoftBadge tone="danger" className="mt-px">Error</SoftBadge>}
                        <p className="line-clamp-2 min-w-0 text-sm text-foreground">{i.title}</p>
                      </div>
                      {i.detail && (
                        <p className={cn("mt-0.5 line-clamp-2 text-xs", i.ok ? "text-muted-foreground" : "text-destructive")}>{i.detail}</p>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
                        {s.label}
                        {i.phone ? ` · ${i.phone}` : ""}
                      </p>
                      {i.phone && <p className="mt-0.5 hidden text-xs text-muted-foreground md:block lg:hidden">{i.phone}</p>}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap py-2.5 align-top font-mono text-xs text-muted-foreground lg:table-cell">
                      {i.phone || "—"}
                    </TableCell>
                    <TableCell className="py-2.5 pr-3 align-top">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {visible.length > shown.length && (
            <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
              <span className="text-xs text-muted-foreground">Mostrando {shown.length} de {visible.length}</span>
              <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                Mostrar {Math.min(PAGE_SIZE, visible.length - shown.length)} más
              </Button>
            </div>
          )}
        </Card>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="line-clamp-2 pr-6 text-base">{selected?.title}</DialogTitle>
            {selected && (
              <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span>{SOURCE[selected.source].label}</span>
                <span aria-hidden>·</span>
                <span>{format(parseISO(selected.at), "d MMM yyyy, HH:mm:ss", { locale: es })}</span>
                {selected.phone && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="font-mono">{selected.phone}</span>
                  </>
                )}
                {!selected.ok && <SoftBadge tone="danger">Error</SoftBadge>}
              </DialogDescription>
            )}
          </DialogHeader>
          {selected?.detail && (
            <p className={cn("rounded-md border px-3 py-2 text-xs", selected.ok ? "text-muted-foreground" : "border-destructive/20 bg-destructive/5 text-destructive")}>
              {selected.detail}
            </p>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Registro completo</p>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5"
                onClick={() => selected && copyText(JSON.stringify(selected.raw, null, 2))}
              >
                <Copy className="h-3.5 w-3.5" /> Copiar JSON
              </Button>
            </div>
            <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">
              {selected ? JSON.stringify(selected.raw, null, 2) : ""}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────── guía de conexión ───────── */

function CopyField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2 py-1.5 font-mono text-xs" title={value ?? undefined}>
          {value ?? "—"}
        </code>
        {value && (
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => copyText(value)} aria-label={`Copiar ${label}`}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function GuideStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5 bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{n}</span>
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function SetupGuide() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-accent/40"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Cómo conectar el agente</p>
              <p className="text-xs text-muted-foreground">Conector MCP, campo de teléfono, webhook de WHAAPY y pendientes antes de operar.</p>
            </div>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SetupGuideBody />
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function SetupGuideBody() {
  const { data: health } = useQuery({
    queryKey: ["agent-health"],
    queryFn: () => messagingAdmin<IntegrationHealth>({ action: "health" }),
    retry: false,
  });
  const tools = ["create_booking_link", "list_my_appointments", "prepare_appointment_action", "get_operation_status", "open_case", "request_handoff", "get_my_case_status"];

  return (
    <div className="grid gap-px border-t bg-border md:grid-cols-2">
      <GuideStep n={1} title="Conector MCP en el agente de WHAAPY">
        <CopyField label="URL del servidor MCP" value={health?.mcp_url} />
        <p>
          Autenticación: <strong className="font-medium text-foreground">Bearer</strong> con el token del MCP (secreto{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">FINDMED_MCP_TOKEN</code>; por seguridad no se muestra en la plataforma).
        </p>
        <p>Después usa "Probar conexión" en WHAAPY: en la bitácora debe aparecer "WHAAPY probó la conexión con el MCP" y las 10 herramientas.</p>
      </GuideStep>
      <GuideStep n={2} title="Campo de teléfono en cada herramienta">
        <p>
          En estas herramientas, el campo <code className="rounded bg-muted px-1 font-mono text-xs">phone</code> va fijo a{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">{"{{contact.phoneNumber}}"}</code> (nunca lo llena la IA):
        </p>
        <div className="flex flex-wrap gap-1">
          {tools.map((t) => <SoftBadge key={t} tone="neutral" className="font-mono">{t}</SoftBadge>)}
        </div>
        <p className="text-xs">Así el agente solo puede ver y tocar datos del paciente que está escribiendo.</p>
      </GuideStep>
      <GuideStep n={3} title="Webhook de WHAAPY hacia FindMed">
        <CopyField label="URL del webhook" value={health?.webhook_url} />
        <p>Eventos: mensajes (recibido, enviado, entregado, leído, fallido) y conversaciones. Ya está configurado; arriba se ve el último evento recibido.</p>
      </GuideStep>
      <GuideStep n={4} title="Antes de operar">
        <ul className="list-disc space-y-1 pl-4">
          <li>Pegar el prompt versionado del agente (docs/findmed-migration/agente).</li>
          <li>
            Automatización "Omitir IA" para botones <code className="rounded bg-muted px-1 font-mono text-xs">confirmar_cita:</code> /{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">cancelar_cita:</code>.
          </li>
          <li>Correos del equipo en WHAAPY iguales a los de FindMed (para "Tomar caso").</li>
          <li>Probar con el número de prueba y revisar esta bitácora.</li>
        </ul>
      </GuideStep>
    </div>
  );
}
