// Inicio del panel administrativo: lo de hoy, lo que falta resolver en cada
// módulo (casos, mensajes, agente, calendarios, doctores, catálogo de triaje),
// el estado de las conexiones y las notificaciones. Solo lecturas por RLS y el
// chequeo de salud de messaging-admin.
import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addHours, format, startOfDay, addDays, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  AlertTriangle,
  BellRing,
  Bot,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Info,
  LifeBuoy,
  MessageCircle,
  MessageSquareWarning,
  Workflow,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { StatCard, type Tone } from "@/components/app/StatCard";
import { SoftBadge } from "@/components/app/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { messagingAdmin, type IntegrationHealth } from "@/lib/messaging-admin";
import { caseSla, formatWait, type SlaSettings, sortBySla, WAITING_STATUSES } from "@/lib/case-sla";
import { caseTypeLabel } from "@/lib/case-labels";
import { casePath } from "@/lib/staff-alerts";
import { useBrowserAlertPermission } from "@/hooks/useBrowserAlerts";
import { useSlaSettings } from "@/hooks/useStaffAlertSettings";
import AdminInbox from "./Inbox";

const TZ = "America/Mexico_City";
const ACTIVE_CASE = ["open", "awaiting_assignment", "assigned", "awaiting_patient", "awaiting_provider"];

type Severity = "danger" | "warning" | "info";
interface PendingItem {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  to: string;
  cta: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, warning: 1, info: 2 };
const SEVERITY_ICON = { danger: CircleAlert, warning: AlertTriangle, info: Info };
const SEVERITY_CLASS: Record<Severity, string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function greeting(now: Date) {
  const h = toZonedTime(now, TZ).getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

function todayBoundsUtc(now: Date) {
  const localStart = startOfDay(toZonedTime(now, TZ));
  return { start: fromZonedTime(localStart, TZ), end: fromZonedTime(addDays(localStart, 1), TZ) };
}

async function count(q: PromiseLike<{ count: number | null; error: unknown }>) {
  const { count: n, error } = await q;
  if (error) throw error;
  return n ?? 0;
}

function useOverview() {
  return useQuery({
    queryKey: ["admin-home-overview"],
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const now = new Date();
      const { start, end } = todayBoundsUtc(now);
      const head = { count: "exact" as const, head: true };

      const [
        todayCount,
        toConfirm48h,
        cases,
        failedDeliveries,
        failedOutbox,
        agentErrors,
        lastAgentRequest,
        offices,
        availability,
        doctors,
        disconnects,
        pendingForms,
        routes,
        steps,
        triagePending,
        docsPending48h,
      ] = await Promise.all([
        count(supabase.from("appointments").select("id", head).in("status", ["scheduled", "confirmed"]).gte("start_at", start.toISOString()).lt("start_at", end.toISOString())),
        count(supabase.from("appointments").select("id", head).eq("status", "scheduled").gte("start_at", now.toISOString()).lt("start_at", addHours(now, 48).toISOString())),
        supabase.from("patient_cases").select("id, status, priority, request_type, summary, created_at").in("status", ACTIVE_CASE),
        // Mensajes a pacientes; las alertas al equipo se cuentan aparte (staffAlertFailures).
        count(supabase.from("message_deliveries").select("id", head).neq("source", "staff_alert").in("status", ["failed", "uncertain"]).gte("created_at", subDays(now, 7).toISOString())),
        count(supabase.from("domain_outbox").select("id", head).in("status", ["failed", "uncertain"])),
        count(supabase.from("mcp_requests").select("id", head).eq("ok", false).gte("created_at", subDays(now, 1).toISOString())),
        supabase.from("mcp_requests").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("doctor_offices").select("id, doctor_id, name, google_calendar_connected, outlook_calendar_connected").eq("is_active", true).eq("is_deleted", false),
        supabase.from("doctor_weekly_availability").select("office_id").eq("is_enabled", true),
        supabase.from("doctors").select("id, full_name"),
        supabase.from("calendar_connection_events").select("office_id, occurred_at").eq("event_type", "auto_disconnect").gte("occurred_at", subDays(now, 30).toISOString()),
        count(supabase.from("post_consultation_forms").select("id", head).eq("review_status", "pending")),
        supabase.from("message_routes").select("event_type, owner, description"),
        supabase.from("message_route_steps").select("event_type, when_status, when_cancel_reason, enabled"),
        count(supabase.from("triage_findmed").select("id", head).eq("validado", false)),
        // Citas de las próximas 48 h a las que ya se les pidieron documentos y no los han enviado.
        // Si falla (p. ej. migración aún no aplicada) no tumba el resto de Inicio.
        count(
          supabase.from("appointments").select("id", head).in("status", ["scheduled", "confirmed"])
            .gte("start_at", now.toISOString()).lt("start_at", addHours(now, 48).toISOString())
            .not("documents_requested_at", "is", null).is("documents_received_at", null),
        ).catch(() => 0),
      ]);

      // Alertas al equipo (Configuración → Alertas): WhatsApp fallidos en 7 días y
      // números de guardia activos. Si fallan (migración sin aplicar) no tumban Inicio.
      const [alertFailures, alertRecipients] = await Promise.all([
        supabase
          .from("message_deliveries")
          .select("id, error_message, created_at")
          .eq("source", "staff_alert")
          .in("status", ["failed", "uncertain"])
          .gte("created_at", subDays(now, 7).toISOString())
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.from("staff_alert_recipients").select("id", head).eq("is_active", true),
      ]);

      const activeCases = cases.data ?? [];
      const officeRows = offices.data ?? [];
      const withAvailability = new Set((availability.data ?? []).map((a) => a.office_id));
      const doctorsWithOffice = new Set(officeRows.map((o) => o.doctor_id));
      const disconnectedOffices = new Set(
        (disconnects.data ?? [])
          .map((d) => d.office_id)
          .filter((id) => officeRows.some((o) => o.id === id && !o.google_calendar_connected && !o.outlook_calendar_connected)),
      );
      const routeRows = routes.data ?? [];
      const stepRows = steps.data ?? [];

      return {
        todayCount,
        toConfirm48h,
        awaitingCases: activeCases.filter((c) => c.status === "awaiting_assignment").length,
        urgentCases: activeCases.filter((c) => c.priority === "urgent").length,
        activeCases: activeCases.length,
        failedDeliveries,
        failedOutbox,
        agentErrors,
        lastAgentRequestAt: lastAgentRequest.data?.created_at ?? null,
        officesTotal: officeRows.length,
        officesWithCalendar: officeRows.filter((o) => o.google_calendar_connected || o.outlook_calendar_connected).length,
        officesWithoutAvailability: officeRows.filter((o) => !withAvailability.has(o.id)).length,
        doctorsWithoutOffice: (doctors.data ?? []).filter((d) => !doctorsWithOffice.has(d.id)).length,
        disconnectedCalendars: disconnectedOffices.size,
        pendingForms,
        eventsTotal: routeRows.length,
        eventsByFindmed: routeRows.filter((r) => r.owner === "findmed").length,
        eventsByN8n: routeRows.filter((r) => r.owner === "n8n").length,
        adminCancelWithoutMessage: !stepRows.some(
          (s) => s.enabled && s.event_type === "appointment.status_changed" && s.when_status === "cancelled" && (!s.when_cancel_reason || s.when_cancel_reason === "admin"),
        ),
        triagePending,
        docsPending48h,
        waitingCases: activeCases.filter((c) => WAITING_STATUSES.includes(c.status)),
        staffAlertFailures: alertFailures.error ? 0 : (alertFailures.data ?? []).length,
        staffAlertLastError: alertFailures.error ? null : (alertFailures.data ?? []).find((d) => d.error_message)?.error_message ?? null,
        activeRecipients: alertRecipients.error ? null : alertRecipients.count ?? 0,
      };
    },
  });
}

function buildPending(o: NonNullable<ReturnType<typeof useOverview>["data"]>, sla: SlaSettings, nowMs: number): PendingItem[] {
  const items: PendingItem[] = [];
  // Casos que nadie tomó dentro de su tiempo de respuesta: uno por uno, los más urgentes primero.
  const overdue = sortBySla(o.waitingCases, sla, nowMs).filter((c) => caseSla(c, sla, nowMs)?.state === "overdue");
  for (const c of overdue.slice(0, 3)) {
    const s = caseSla(c, sla, nowMs)!;
    const summary = c.summary.length > 90 ? `${c.summary.slice(0, 89)}…` : c.summary;
    items.push({
      id: `overdue-${c.id}`,
      severity: "danger",
      title: `${c.priority === "urgent" ? "Urgencia" : "Caso"} sin tomar: ${formatWait(s.minutes)} esperando`,
      detail: `${caseTypeLabel(c.request_type)} · ${summary} (debía tomarse en ${formatWait(s.slaMinutes)})`,
      to: casePath(c.id),
      cta: "Tomar",
    });
  }
  if (overdue.length > 3) items.push({ id: "overdue-more", severity: "danger", title: plural(overdue.length - 3, "caso vencido más", "casos vencidos más"), detail: "También superaron su tiempo de respuesta sin que nadie los tomara.", to: "/admin/casos", cta: "Ver cola" });
  if (o.staffAlertFailures) items.push({ id: "staff-alerts", severity: "danger", title: plural(o.staffAlertFailures, "alerta de WhatsApp al equipo falló", "alertas de WhatsApp al equipo fallaron"), detail: o.staffAlertLastError ?? "Revisa la plantilla y los números de guardia (últimos 7 días).", to: "/admin/configuracion/alertas", cta: "Revisar" });
  if (o.activeRecipients === 0) items.push({ id: "no-recipients", severity: "warning", title: "Sin números de guardia para alertas", detail: "Los casos urgentes y las canalizaciones solo avisan en el panel: agrega quién recibe el WhatsApp.", to: "/admin/configuracion/alertas", cta: "Configurar" });
  if (o.urgentCases) items.push({ id: "urgent", severity: "danger", title: plural(o.urgentCases, "caso urgente abierto", "casos urgentes abiertos"), detail: "Pacientes canalizados por urgencia desde WhatsApp.", to: "/admin/casos", cta: "Atender" });
  if (o.awaitingCases) items.push({ id: "awaiting", severity: "danger", title: plural(o.awaitingCases, "caso sin asignar", "casos sin asignar"), detail: "Nadie del equipo los ha tomado todavía.", to: "/admin/casos", cta: "Tomar casos" });
  if (o.failedOutbox) items.push({ id: "outbox", severity: "danger", title: plural(o.failedOutbox, "evento sin enviar", "eventos sin enviar"), detail: "Mensajes automáticos que fallaron y esperan reintento.", to: "/admin/automatizacion?tab=envios", cta: "Revisar" });
  if (o.failedDeliveries) items.push({ id: "deliveries", severity: "warning", title: plural(o.failedDeliveries, "mensaje con problema", "mensajes con problema"), detail: "Fallidos o inciertos en los últimos 7 días.", to: "/admin/automatizacion?tab=envios", cta: "Ver envíos" });
  if (o.agentErrors) items.push({ id: "agent", severity: "warning", title: plural(o.agentErrors, "error del agente IA", "errores del agente IA"), detail: "Llamadas fallidas del agente de WhatsApp en las últimas 24 h.", to: "/admin/configuracion/agente-ia", cta: "Ver actividad" });
  if (o.disconnectedCalendars) items.push({ id: "calendars", severity: "warning", title: plural(o.disconnectedCalendars, "calendario desconectado", "calendarios desconectados"), detail: "Consultorios que perdieron su Google/Outlook en los últimos 30 días.", to: "/admin/doctores", cta: "Reconectar" });
  if (o.officesWithoutAvailability) items.push({ id: "availability", severity: "warning", title: plural(o.officesWithoutAvailability, "consultorio sin horarios", "consultorios sin horarios"), detail: "Activos pero sin disponibilidad semanal: no aparecen al agendar.", to: "/admin/doctores", cta: "Configurar" });
  if (o.doctorsWithoutOffice) items.push({ id: "no-office", severity: "warning", title: plural(o.doctorsWithoutOffice, "doctor sin consultorio activo", "doctores sin consultorio activo"), detail: "No se les pueden agendar citas.", to: "/admin/doctores", cta: "Revisar" });
  if (o.eventsByN8n) items.push({ id: "n8n", severity: "warning", title: plural(o.eventsByN8n, "evento todavía lo envía n8n", "eventos todavía los envía n8n"), detail: "Pásalos a FindMed para que todo salga por WHAAPY.", to: "/admin/automatizacion", cta: "Revisar" });
  if (o.adminCancelWithoutMessage) items.push({ id: "admin-cancel", severity: "info", title: "Cancelaciones del equipo sin aviso", detail: "Cuando FindMed cancela una cita, el paciente no recibe WhatsApp: falta una plantilla.", to: "/admin/automatizacion", cta: "Configurar" });
  if (o.pendingForms) items.push({ id: "forms", severity: "info", title: plural(o.pendingForms, "reporte post-consulta por revisar", "reportes post-consulta por revisar"), detail: "Formularios de los doctores que aún no se revisan.", to: "#notificaciones", cta: "Ver" });
  if (o.triagePending) items.push({ id: "triage", severity: "info", title: "Catálogo de triaje sin validar", detail: `${o.triagePending} condiciones esperan la revisión del responsable clínico.`, to: "/admin/configuracion/agente-ia", cta: "Ver" });
  if (o.docsPending48h) items.push({ id: "documents", severity: "warning", title: plural(o.docsPending48h, "cita en las próximas 48 h sin documentos", "citas en las próximas 48 h sin documentos"), detail: "Se les pidió póliza e INE por WhatsApp y aún no los envían.", to: "/admin/agenda?vista=lista", cta: "Ver citas" });
  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function ConnectionRow({ icon: Icon, label, status, tone, detail, to }: { icon: typeof Bot; label: string; status: string; tone: Tone; detail?: string; to: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent/60">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
      </div>
      <SoftBadge tone={tone} dot>{status}</SoftBadge>
    </Link>
  );
}

const REMINDER_KEY = "fm-browser-alerts-reminder-hidden";

/** Recordatorio discreto para activar los avisos del navegador (alertas de casos). */
function BrowserAlertsReminder() {
  const { permission, request } = useBrowserAlertPermission();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(REMINDER_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (hidden || (permission !== "default" && permission !== "denied")) return null;
  const hide = () => {
    try {
      localStorage.setItem(REMINDER_KEY, "1");
    } catch {
      /* sin almacenamiento: solo se oculta en esta visita */
    }
    setHidden(true);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed bg-card px-3 py-2">
      <BellRing className="h-4 w-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {permission === "denied"
          ? "Los avisos del navegador están bloqueados: no te enterarás de casos nuevos si estás en otra pestaña."
          : "Activa los avisos del navegador para enterarte de casos nuevos y urgencias aunque estés en otra pestaña."}
      </p>
      {permission === "default" ? (
        <Button size="sm" variant="outline" className="h-8" onClick={() => void request()}>
          Activar avisos
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="h-8" asChild>
          <Link to="/admin/configuracion/alertas">Cómo activarlos</Link>
        </Button>
      )}
      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={hide} aria-label="Ocultar recordatorio">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function Inicio() {
  const now = new Date();
  const { data: o, isLoading } = useOverview();
  const { data: health, isError: healthError } = useQuery({
    queryKey: ["integration-health"],
    queryFn: () => messagingAdmin<IntegrationHealth>({ action: "health" }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const slaSettings = useSlaSettings();
  const pending = o ? buildPending(o, slaSettings, now.getTime()) : [];
  const whaapyOk = health?.whaapy_api.ok === true;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting(now)} 👋`}
        description={`${format(toZonedTime(now, TZ), "EEEE d 'de' MMMM", { locale: es })} · lo de hoy y lo que falta resolver.`}
      />

      <BrowserAlertsReminder />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !o ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[84px] rounded-lg" />)
        ) : (
          <>
            <StatCard label="Citas hoy" value={o.todayCount} hint="Agendadas o confirmadas" icon={CalendarDays} tone="info" to="/admin/agenda" />
            <StatCard label="Por confirmar (48 h)" value={o.toConfirm48h} hint="Se cancelan solas si no confirman" icon={CalendarClock} tone={o.toConfirm48h ? "warning" : "neutral"} to="/admin/agenda?vista=lista" />
            <StatCard label="Casos activos" value={o.activeCases} hint={o.awaitingCases ? `${o.awaitingCases} sin asignar` : "Todos asignados"} icon={LifeBuoy} tone={o.awaitingCases ? "danger" : "success"} to="/admin/casos" />
            <StatCard label="Mensajes con problema" value={o.failedDeliveries + o.failedOutbox} hint="Últimos 7 días" icon={MessageSquareWarning} tone={o.failedDeliveries + o.failedOutbox ? "warning" : "success"} to="/admin/automatizacion?tab=envios" />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
            <CardTitle className="text-sm font-semibold">Por resolver</CardTitle>
            {o && <span className="text-xs text-muted-foreground">{pending.length ? plural(pending.length, "pendiente", "pendientes") : ""}</span>}
          </CardHeader>
          <CardContent className="p-2 pt-0">
            {isLoading || !o ? (
              <div className="space-y-2 p-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-md" />)}</div>
            ) : pending.length === 0 ? (
              <div className="flex items-center gap-3 rounded-md p-4 text-sm text-muted-foreground">
                <CheckCircle2 className="h-5 w-5 text-success" /> Todo en orden: no hay pendientes en ningún módulo.
              </div>
            ) : (
              <ul className="divide-y">
                {pending.map((p) => {
                  const Icon = SEVERITY_ICON[p.severity];
                  const inner = (
                    <>
                      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", SEVERITY_CLASS[p.severity])}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{p.title}</p>
                        <p className="text-xs text-muted-foreground">{p.detail}</p>
                      </div>
                      <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary">
                        {p.cta} <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </>
                  );
                  return (
                    <li key={p.id}>
                      {p.to.startsWith("#") ? (
                        <a href={p.to} className="flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-accent/60">{inner}</a>
                      ) : (
                        <Link to={p.to} className="flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-accent/60">{inner}</Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-semibold">Conexiones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0.5 p-2 pt-0">
            <ConnectionRow
              icon={MessageCircle}
              label="WhatsApp (WHAAPY)"
              to="/admin/whatsapp"
              status={health ? (whaapyOk ? "Conectado" : "Con error") : healthError ? "Sin verificar" : "Verificando…"}
              tone={health ? (whaapyOk ? "success" : "danger") : "neutral"}
              detail={whaapyOk ? `${health?.whaapy_api.approved ?? 0} plantillas aprobadas` : health?.whaapy_api.error ?? undefined}
            />
            <ConnectionRow
              icon={Bot}
              label="Agente IA"
              to="/admin/configuracion/agente-ia"
              status={!o ? "…" : o.agentErrors ? `${o.agentErrors} errores 24 h` : o.lastAgentRequestAt ? "Activo" : "Sin actividad"}
              tone={!o ? "neutral" : o.agentErrors ? "warning" : o.lastAgentRequestAt ? "success" : "neutral"}
              detail={o?.lastAgentRequestAt ? `Última actividad ${format(new Date(o.lastAgentRequestAt), "d MMM, HH:mm", { locale: es })}` : undefined}
            />
            <ConnectionRow
              icon={Workflow}
              label="Mensajes automáticos"
              to="/admin/automatizacion"
              status={!o ? "…" : o.eventsByN8n ? `${o.eventsByN8n} en n8n` : "FindMed"}
              tone={!o ? "neutral" : o.eventsByN8n ? "warning" : "success"}
              detail={o ? `${o.eventsByFindmed} de ${o.eventsTotal} eventos los envía FindMed` : undefined}
            />
            <ConnectionRow
              icon={CalendarCheck}
              label="Calendarios de doctores"
              to="/admin/doctores"
              status={!o ? "…" : o.disconnectedCalendars ? `${o.disconnectedCalendars} desconectados` : `${o.officesWithCalendar}/${o.officesTotal}`}
              tone={!o ? "neutral" : o.disconnectedCalendars ? "warning" : "success"}
              detail={o ? `${o.officesWithCalendar} de ${o.officesTotal} consultorios con Google u Outlook` : undefined}
            />
          </CardContent>
        </Card>
      </div>

      <section id="notificaciones" className="scroll-mt-20 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Notificaciones</h2>
        <AdminInbox embedded />
      </section>
    </div>
  );
}
