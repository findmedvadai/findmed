// Inicio del doctor: citas de hoy, lo que tiene pendiente (notas post-consulta,
// consultorios sin horarios o sin calendario) y sus notificaciones.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, addHours, format, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, ChevronRight, ClipboardList, Clock, Info, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/app/PageHeader";
import { StatCard } from "@/components/app/StatCard";
import { AppointmentStatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import DoctorInbox from "./DoctorInbox";

const TZ = "America/Mexico_City";

function greeting(now: Date) {
  const h = toZonedTime(now, TZ).getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

export default function DoctorInicio() {
  const { doctorId } = useAuth();
  const now = new Date();

  const { data, isLoading } = useQuery({
    queryKey: ["doctor-home", doctorId],
    enabled: !!doctorId,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const n = new Date();
      const localStart = startOfDay(toZonedTime(n, TZ));
      const start = fromZonedTime(localStart, TZ).toISOString();
      const end = fromZonedTime(addDays(localStart, 1), TZ).toISOString();
      const head = { count: "exact" as const, head: true };
      const [today, toConfirm, toComplete, offices, availability] = await Promise.all([
        supabase
          .from("appointments")
          .select("id, start_at, end_at, status, symptoms, patients(full_name), doctor_offices(name)")
          .eq("doctor_id", doctorId!)
          .in("status", ["scheduled", "confirmed", "completed"])
          .gte("start_at", start)
          .lt("start_at", end)
          .order("start_at"),
        supabase.from("appointments").select("id", head).eq("doctor_id", doctorId!).eq("status", "scheduled").gte("start_at", n.toISOString()).lt("start_at", addHours(n, 48).toISOString()),
        supabase
          .from("appointments")
          .select("id", head)
          .eq("doctor_id", doctorId!)
          .is("doctor_notes", null)
          .or(`status.eq.completed,and(status.eq.confirmed,end_at.lt.${n.toISOString()})`),
        supabase.from("doctor_offices").select("id, name, google_calendar_connected, outlook_calendar_connected").eq("doctor_id", doctorId!).eq("is_active", true).eq("is_deleted", false),
        supabase.from("doctor_weekly_availability").select("office_id").eq("doctor_id", doctorId!).eq("is_enabled", true),
      ]);
      if (today.error) throw today.error;
      const officeRows = offices.data ?? [];
      const withAvailability = new Set((availability.data ?? []).map((a) => a.office_id));
      return {
        today: today.data ?? [],
        toConfirm: toConfirm.count ?? 0,
        toComplete: toComplete.count ?? 0,
        officesWithoutAvailability: officeRows.filter((o) => !withAvailability.has(o.id)).map((o) => o.name),
        officesWithoutCalendar: officeRows.filter((o) => !o.google_calendar_connected && !o.outlook_calendar_connected).map((o) => o.name),
        noOffices: officeRows.length === 0,
      };
    },
  });

  const pending = data
    ? [
        data.toComplete > 0 && {
          id: "complete",
          tone: "warning" as const,
          title: `${data.toComplete} consulta${data.toComplete === 1 ? "" : "s"} sin notas post-consulta`,
          detail: "FindMed necesita tus notas para dar seguimiento al paciente.",
          to: "/doctor/por-completar",
          cta: "Completar",
        },
        data.noOffices && {
          id: "no-office",
          tone: "warning" as const,
          title: "No tienes consultorios activos",
          detail: "Sin consultorio no se te pueden agendar citas.",
          to: "/doctor/configuracion",
          cta: "Configurar",
        },
        data.officesWithoutAvailability.length > 0 && {
          id: "availability",
          tone: "warning" as const,
          title: "Consultorio sin horarios",
          detail: `${data.officesWithoutAvailability.join(", ")}: los pacientes no ven horarios disponibles.`,
          to: "/doctor/configuracion",
          cta: "Configurar",
        },
        data.officesWithoutCalendar.length > 0 && {
          id: "calendar",
          tone: "info" as const,
          title: "Calendario sin conectar",
          detail: `${data.officesWithoutCalendar.join(", ")}: conecta Google u Outlook para evitar choques con tus otros compromisos.`,
          to: "/doctor/configuracion",
          cta: "Conectar",
        },
      ].filter(Boolean) as { id: string; tone: "warning" | "info"; title: string; detail: string; to: string; cta: string }[]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting(now)} 👋`}
        description={`${format(toZonedTime(now, TZ), "EEEE d 'de' MMMM", { locale: es })} · tu día en FindMed.`}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {isLoading || !data ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[84px] rounded-lg" />)
        ) : (
          <>
            <StatCard label="Citas hoy" value={data.today.filter((a) => a.status !== "completed").length} icon={CalendarDays} tone="info" to="/doctor/agenda" />
            <StatCard label="Por confirmar (48 h)" value={data.toConfirm} hint="El paciente aún no confirma" icon={CalendarClock} tone={data.toConfirm ? "warning" : "neutral"} to="/doctor/agenda" />
            <StatCard label="Por completar" value={data.toComplete} hint="Notas post-consulta" icon={ClipboardList} tone={data.toComplete ? "warning" : "success"} to="/doctor/por-completar" />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
            <CardTitle className="text-sm font-semibold">Citas de hoy</CardTitle>
            <Link to="/doctor/agenda" className="text-xs font-medium text-primary hover:underline">Ver agenda</Link>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            {isLoading || !data ? (
              <div className="space-y-2 p-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-md" />)}</div>
            ) : data.today.length === 0 ? (
              <EmptyState icon={CalendarDays} title="Sin citas hoy" description="Cuando un paciente reserve contigo para hoy, aparecerá aquí." className="m-2 border-none bg-transparent" />
            ) : (
              <ul className="divide-y">
                {data.today.map((a) => {
                  const p = a.patients as { full_name: string } | null;
                  const off = a.doctor_offices as { name: string } | null;
                  const t = toZonedTime(new Date(a.start_at), TZ);
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-2 py-3">
                      <div className="flex w-14 shrink-0 flex-col items-center rounded-md bg-muted py-1">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-semibold text-foreground">{format(t, "HH:mm")}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{p?.full_name ?? "Paciente"}</p>
                        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          {off?.name && (<><MapPin className="h-3 w-3" /> {off.name}</>)}
                          {a.symptoms && <span className="truncate">{off?.name ? " · " : ""}{a.symptoms}</span>}
                        </p>
                      </div>
                      <AppointmentStatusBadge status={a.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-semibold">Pendientes</CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            {isLoading || !data ? (
              <Skeleton className="m-2 h-14 rounded-md" />
            ) : pending.length === 0 ? (
              <div className="flex items-center gap-3 p-3 text-sm text-muted-foreground">
                <CheckCircle2 className="h-5 w-5 text-success" /> Todo al día.
              </div>
            ) : (
              <ul className="divide-y">
                {pending.map((p) => {
                  const Icon = p.tone === "warning" ? AlertTriangle : Info;
                  return (
                    <li key={p.id}>
                      <Link to={p.to} className="flex items-start gap-3 rounded-md px-2 py-3 transition-colors hover:bg-accent/60">
                        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", p.tone === "warning" ? "bg-warning/10 text-warning" : "bg-info/10 text-info")}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">{p.title}</p>
                          <p className="text-xs text-muted-foreground">{p.detail}</p>
                        </div>
                        <span className="flex shrink-0 items-center text-xs font-medium text-primary">
                          {p.cta} <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Notificaciones</h2>
        <DoctorInbox embedded />
      </section>
    </div>
  );
}
