// Inicio del panel administrativo: lo de hoy, lo que falta resolver en cada
// módulo (casos, mensajes, agente, calendarios, doctores, catálogo de triaje),
// el estado de las conexiones y las notificaciones. Solo lecturas por RLS y el
// chequeo de salud de messaging-admin.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addHours, format, startOfDay, addDays, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  AlertTriangle,
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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { StatCard, type Tone } from "@/components/app/StatCard";
import { SoftBadge } from "@/components/app/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { messagingAdmin, type IntegrationHealth } from "@/lib/messaging-admin";
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
      ] = await Promise.all([
        count(supabase.from("appointments").select("id", head).in("status", ["scheduled", "confirmed"]).gte("start_at", start.toISOString()).lt("start_at", end.toISOString())),
        count(supabase.from("appointments").select("id", head).eq("status", "scheduled").gte("start_at", now.toISOString()).lt("start_at", addHours(now, 48).toISOString())),
        supabase.from("patient_cases").select("id, status, priority").in("status", ACTIVE_CASE),
        count(supabase.from("message_deliveries").select("id", head).in("status", ["failed", "uncertain"]).gte("created_at", subDays(now, 7).toISOString())),
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
      };
    },
  });
}

function buildPending(o: NonNullable<ReturnType<typeof useOverview>["data"]>): PendingItem[] {
  const items: PendingItem[] = [];
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

export default function Inicio() {
  const now = new Date();
  const { data: o, isLoading } = useOverview();
  const { data: health, isError: healthError } = useQuery({
    queryKey: ["integration-health"],
    queryFn: () => messagingAdmin<IntegrationHealth>({ action: "health" }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const pending = o ? buildPending(o) : [];
  const whaapyOk = health?.whaapy_api.ok === true;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting(now)} 👋`}
        description={`${format(toZonedTime(now, TZ), "EEEE d 'de' MMMM", { locale: es })} · lo de hoy y lo que falta resolver.`}
      />

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
