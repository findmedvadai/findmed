// Agente IA (Configuración): estado de la conexión FindMed ↔ WHAAPY y bitácora
// de todo lo que pasa entre el agente de WhatsApp, el paciente y la
// plataforma — herramientas que usa el agente (mcp_requests), mensajes del
// paciente y respuestas de la IA (whaapy_events), plantillas enviadas por
// FindMed (message_deliveries) y movimientos de casos (case_events).
// Sirve para operar el arranque: ver en vivo qué hace el agente y dónde falla.
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Copy,
  LifeBuoy,
  MessageCircle,
  RefreshCw,
  Send,
  Wrench,
  XCircle,
} from "lucide-react";

/* ───────── tipos y helpers ───────── */

interface Health {
  whaapy_api: { configured: boolean; ok: boolean; latency_ms?: number; templates?: number; approved?: number; http_status?: number; error?: string };
  mcp_url: string | null;
  webhook_url: string | null;
  secrets: Record<string, boolean>;
  checked_at: string;
}

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
  template: { label: "Plantilla de FindMed", icon: Send, className: "text-confirmed" },
  receipt: { label: "Recibo de WhatsApp", icon: CheckCircle2, className: "text-muted-foreground" },
  case: { label: "Caso", icon: LifeBuoy, className: "text-amber-600" },
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

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
/** Últimos 10 dígitos: compara +52XXXXXXXXXX, 521XXXXXXXXXX y 52XXXXXXXXXX. */
const samePhone = (a: string | null | undefined, b: string) => {
  const x = digits(a).slice(-10);
  return x.length === 10 && x === digits(b).slice(-10);
};

async function messagingAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await supabase.functions.invoke("messaging-admin", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.error) throw new Error("No se pudo consultar el estado de la integración.");
  return res.data as T;
}

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

/* ───────── página ───────── */

export default function AgenteIA() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Agente IA</h1>
        <p className="text-sm text-muted-foreground">
          Conexión con WHAAPY y bitácora de lo que hace el agente de WhatsApp con los pacientes y con FindMed.
        </p>
      </div>
      <ConnectionPanel />
      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Actividad</TabsTrigger>
          <TabsTrigger value="errors">Errores</TabsTrigger>
          <TabsTrigger value="setup">Cómo conectar</TabsTrigger>
        </TabsList>
        <TabsContent value="activity"><ActivityLog errorsOnly={false} /></TabsContent>
        <TabsContent value="errors"><ActivityLog errorsOnly /></TabsContent>
        <TabsContent value="setup"><SetupGuide /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ───────── estado de la conexión ───────── */

function StatusLine({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string | null }) {
  const Icon = ok === null ? AlertTriangle : ok ? CheckCircle2 : XCircle;
  const cls = ok === null ? "text-amber-600" : ok ? "text-confirmed" : "text-destructive";
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls}`} />
      <div>
        <p>{label}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}

const ago = (iso: string | null | undefined) =>
  iso ? formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: es }) : "nunca";

function ConnectionPanel() {
  const { data: health, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ["agent-health"],
    queryFn: () => messagingAdmin<Health>({ action: "health" }),
    refetchInterval: 60_000,
    retry: false,
  });

  const { data: stats } = useQuery({
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

  const api = health?.whaapy_api;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          Estado de la conexión {health && `· revisado ${ago(health.checked_at)}`}
        </h2>
        <Button size="sm" variant="ghost" className="gap-2" disabled={isFetching} onClick={() => refetch()}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Revisar
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">FindMed → WHAAPY (API)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? <Skeleton className="h-12 w-full" /> : (
              <>
                <StatusLine ok={api?.configured ?? false} label="Llave de API configurada" />
                <StatusLine
                  ok={api ? api.ok : null}
                  label={api?.ok ? "WHAAPY responde" : "WHAAPY no responde"}
                  detail={api?.ok ? `${api.approved} plantillas aprobadas de ${api.templates} · ${api.latency_ms} ms` : api?.error ? `HTTP ${api.http_status}: ${api.error}` : null}
                />
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Agente → FindMed (MCP)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <StatusLine ok={health ? !!health.secrets.FINDMED_MCP_TOKEN : null} label="Token del MCP configurado" />
            <StatusLine
              ok={stats ? !!stats.lastConnection : null}
              label={`Última prueba de conexión: ${ago(stats?.lastConnection)}`}
              detail={`Última herramienta usada: ${ago(stats?.lastCall)}`}
            />
            <StatusLine
              ok={stats ? stats.errors24h === 0 && stats.authFails24h === 0 : null}
              label={`${stats?.calls24h ?? 0} llamadas en 24 h`}
              detail={`${stats?.errors24h ?? 0} con error · ${stats?.authFails24h ?? 0} con token rechazado`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">WHAAPY → FindMed (webhook)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <StatusLine ok={health ? !!health.secrets.WHAAPY_WEBHOOK_SECRET : null} label="Secreto del webhook configurado" />
            <StatusLine
              ok={stats ? !!stats.lastEvent : null}
              label={`Último evento recibido: ${ago(stats?.lastEvent)}`}
              detail={`${stats?.events24h ?? 0} eventos en 24 h · ${stats?.eventErrors24h ?? 0} con error al procesar`}
            />
            <StatusLine
              ok={stats ? stats.stuckOutbox === 0 : null}
              label={`Mensajes de FindMed: ${stats?.owners.findmed ?? 0} eventos propios, ${stats?.owners.n8n ?? 0} en n8n`}
              detail={stats?.stuckOutbox ? `${stats.stuckOutbox} envío(s) fallidos o inciertos en Mensajería` : null}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ───────── bitácora ───────── */

function ActivityLog({ errorsOnly }: { errorsOnly: boolean }) {
  const [range, setRange] = useState("24h");
  const [phone, setPhone] = useState("");
  const [showReceipts, setShowReceipts] = useState(false);
  const [selected, setSelected] = useState<ActivityItem | null>(null);

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-56" placeholder="Filtrar por teléfono (10 dígitos)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1h">Última hora</SelectItem>
            <SelectItem value="24h">Últimas 24 h</SelectItem>
            <SelectItem value="7d">Últimos 7 días</SelectItem>
            <SelectItem value="30d">Últimos 30 días</SelectItem>
          </SelectContent>
        </Select>
        {!errorsOnly && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showReceipts} onCheckedChange={setShowReceipts} /> Mostrar recibos de entrega
          </label>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{visible.length} registros · se actualiza cada 15 s</span>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {errorsOnly ? "Sin errores en este periodo." : "Sin actividad en este periodo."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {visible.map((i) => {
            const s = SOURCE[i.source];
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => setSelected(i)}
                className={`flex w-full items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent/50 ${i.ok ? "" : "border-destructive/50 bg-destructive/5"}`}
              >
                <s.icon className={`mt-0.5 h-4 w-4 shrink-0 ${i.ok ? s.className : "text-destructive"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-xs">{s.label}</Badge>
                    {i.phone && <span className="text-xs text-muted-foreground">{i.phone}</span>}
                    <span className="ml-auto text-xs text-muted-foreground">{format(parseISO(i.at), "d MMM, HH:mm:ss", { locale: es })}</span>
                  </div>
                  <p className="mt-1 line-clamp-2">{i.title}</p>
                  {i.detail && <p className={`text-xs ${i.ok ? "text-muted-foreground" : "text-destructive"}`}>{i.detail}</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{selected?.title}</DialogTitle></DialogHeader>
          <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
            {selected ? JSON.stringify(selected.raw, null, 2) : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────── guía de conexión ───────── */

function SetupGuide() {
  const { data: health } = useQuery({
    queryKey: ["agent-health"],
    queryFn: () => messagingAdmin<Health>({ action: "health" }),
    retry: false,
  });
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast({ title: "Copiado" }),
      () => toast({ title: "No se pudo copiar", variant: "destructive" }),
    );
  };
  const Field = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{value ?? "—"}</code>
        {value && (
          <Button size="icon" variant="ghost" onClick={() => copy(value)} aria-label="Copiar"><Copy className="h-4 w-4" /></Button>
        )}
      </div>
    </div>
  );
  const tools = ["create_booking_link", "list_my_appointments", "prepare_appointment_action", "get_operation_status", "open_case", "request_handoff", "get_my_case_status"];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">1 · Conector MCP en el agente de WHAAPY</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label="URL del servidor MCP" value={health?.mcp_url} />
          <p>Autenticación: <strong>Bearer</strong> con el token del MCP (secreto <code>FINDMED_MCP_TOKEN</code>; por seguridad no se muestra en la plataforma).</p>
          <p>Después usa "Probar conexión" en WHAAPY: aquí debe aparecer "WHAAPY probó la conexión con el MCP" y las 10 herramientas.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">2 · Campo de teléfono en cada herramienta</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>En estas herramientas, el campo <code>phone</code> va fijo a <code>{"{{contact.phoneNumber}}"}</code> (nunca lo llena la IA):</p>
          <div className="flex flex-wrap gap-1">{tools.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}</div>
          <p className="text-muted-foreground">Así el agente solo puede ver y tocar datos del paciente que está escribiendo.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">3 · Webhook de WHAAPY hacia FindMed</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label="URL del webhook" value={health?.webhook_url} />
          <p>Eventos: mensajes (recibido, enviado, entregado, leído, fallido) y conversaciones. Ya está configurado; aquí se ve el último evento recibido.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">4 · Antes de operar</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>• Pegar el prompt versionado del agente (docs/findmed-migration/agente).</p>
          <p>• Automatización "Omitir IA" para botones <code>confirmar_cita:</code> / <code>cancelar_cita:</code>.</p>
          <p>• Correos del equipo en WHAAPY iguales a los de FindMed (para "Tomar caso").</p>
          <p>• Probar con el número de prueba y revisar esta bitácora.</p>
        </CardContent>
      </Card>
    </div>
  );
}
