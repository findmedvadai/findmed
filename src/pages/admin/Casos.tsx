// Cola de casos y canalización humana (bloque B6).
// Los casos los abre el agente de WhatsApp (open_case / request_handoff) y el
// equipo los toma, les da seguimiento y los cierra con motivo aquí. Todas las
// escrituras pasan por la Edge Function case-actions (que también apaga/
// reactiva la IA y asigna en WHAAPY); esta página solo lee por RLS.
import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import { formatMx, MEXICO_TZ } from "@/lib/timezone";
import { fromZonedTime } from "date-fns-tz";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/PageHeader";
import { FilterBar, SearchInput } from "@/components/app/FilterBar";
import { EmptyState } from "@/components/app/EmptyState";
import { SoftBadge } from "@/components/app/StatusBadge";
import type { Tone } from "@/components/app/StatCard";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { extractEdgeFunctionError, toastFromEdgeFunctionError } from "@/lib/edge-function-error";
import { AlertTriangle, Bot, BotOff, CheckCircle2, Hand, LifeBuoy, MapPin, Phone, Plus, SearchX, UserRound } from "lucide-react";
import { CASE_TYPE_LABEL, caseEventLabel } from "@/lib/case-labels";
import NewCaseDialog from "@/components/admin/cases/NewCaseDialog";
import CaseOriginCard from "@/components/admin/cases/CaseOriginCard";
import CasePatientContact from "@/components/admin/cases/CasePatientContact";
import CaseReimbursementPanel from "@/components/admin/cases/CaseReimbursementPanel";
import { useCaseDeepLink } from "@/components/admin/cases/useCaseDeepLink";
import { type CaseSla, caseSla, formatWait, SLA_STATE, sortBySla } from "@/lib/case-sla";
import { useSlaSettings } from "@/hooks/useStaffAlertSettings";

type PatientCase = Tables<"patient_cases">;
type CaseEvent = Tables<"case_events">;
type Bucket = "pending" | "active" | "closed";
type View = "unassigned" | "mine" | "active" | "waiting" | "closed";

const BUCKETS: Record<Bucket, string[]> = {
  pending: ["open", "awaiting_assignment"],
  active: ["assigned", "awaiting_patient", "awaiting_provider"],
  closed: ["resolved", "closed"],
};

const WAITING = ["awaiting_patient", "awaiting_provider"];

/** Vistas de la cola: Sin asignar = bucket pending; Míos/En curso/En espera = bucket active acotado en el cliente; Resueltos = bucket closed. */
const VIEWS: { value: View; label: string }[] = [
  { value: "unassigned", label: "Sin asignar" },
  { value: "mine", label: "Míos" },
  { value: "active", label: "En curso" },
  { value: "waiting", label: "En espera" },
  { value: "closed", label: "Resueltos" },
];

// Incluye los tipos de la Etapa 2 (procedimiento, referencia, reembolso): src/lib/case-labels.ts.
const TYPE_LABEL: Record<string, string> = CASE_TYPE_LABEL;

const STATUS_LABEL: Record<string, string> = {
  open: "Abierto",
  awaiting_assignment: "Sin asignar",
  assigned: "Asignado",
  awaiting_patient: "Esperando al paciente",
  awaiting_provider: "Esperando al proveedor",
  resolved: "Resuelto",
  closed: "Cerrado",
};

const STATUS_TONE: Record<string, Tone> = {
  open: "info",
  awaiting_assignment: "danger",
  assigned: "info",
  awaiting_patient: "warning",
  awaiting_provider: "warning",
  resolved: "success",
  closed: "neutral",
};

const PRIORITY: Record<string, { label: string; tone: Tone }> = {
  urgent: { label: "Urgente", tone: "danger" },
  high: { label: "Alta", tone: "warning" },
  normal: { label: "Normal", tone: "neutral" },
};

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2 };

const AI_STATE: Record<string, { label: string; icon: typeof Bot; className: string }> = {
  not_requested: { label: "IA activa", icon: Bot, className: "text-muted-foreground" },
  paused: { label: "IA apagada", icon: BotOff, className: "text-primary" },
  pause_failed: { label: "No se pudo apagar la IA", icon: AlertTriangle, className: "text-destructive" },
  resumed: { label: "IA reactivada", icon: Bot, className: "text-muted-foreground" },
  resume_failed: { label: "No se pudo reactivar la IA", icon: AlertTriangle, className: "text-destructive" },
};

const EMPTY_COPY: Record<View, { title: string; description: string }> = {
  unassigned: { title: "No hay casos sin asignar", description: "Cuando el agente de WhatsApp canalice a un paciente, aparecerá aquí para que alguien del equipo lo tome." },
  mine: { title: "No tienes casos asignados", description: "Toma un caso desde \"Sin asignar\" para darle seguimiento." },
  active: { title: "No hay casos en curso", description: "Los casos que el equipo ya tomó aparecen aquí hasta cerrarse." },
  waiting: { title: "Nada en espera", description: "Aquí aparecen los casos que esperan respuesta del paciente o de un proveedor." },
  closed: { title: "Sin casos resueltos recientes", description: "Se muestran los últimos 50 casos resueltos o cerrados." },
};

async function invokeCaseAction(body: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await supabase.functions.invoke("case-actions", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.error) throw res.error;
  return res.data as { case: PatientCase; warnings: string[] };
}

const ago = (iso: string) => formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: es });

/** Antigüedad compacta para la tabla: "hace 5 min", "hace 2 h", "hace 3 d". */
function shortAgo(iso: string) {
  const mins = Math.floor((Date.now() - parseISO(iso).getTime()) / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return formatMx(parseISO(iso), "d MMM", { locale: es });
}

const caseLocation = (c: PatientCase) => (c.city ? `${c.city}${c.zone ? `, ${c.zone}` : ""}` : null);
const isOverdue = (c: PatientCase) =>
  !!c.due_at && !BUCKETS.closed.includes(c.status) && parseISO(c.due_at).getTime() < Date.now();

function useCaseBucket(bucket: Bucket, enabled = true) {
  return useQuery({
    queryKey: ["patient-cases", bucket],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_cases")
        .select("*")
        .in("status", BUCKETS[bucket])
        .order("created_at", { ascending: bucket !== "closed" })
        .limit(bucket === "closed" ? 50 : 200);
      if (error) throw error;
      const rows = data ?? [];
      // Pendientes y en curso: urgentes primero, luego el más antiguo.
      return bucket === "closed"
        ? rows
        : [...rows].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
    },
    refetchInterval: 20_000,
    placeholderData: keepPreviousData,
  });
}

export default function Casos() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const me = user?.id ?? null;
  const [view, setView] = useState<View>("unassigned");
  const [selected, setSelected] = useState<PatientCase | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  // /admin/casos?caso=<id> abre ese caso (enlace desde el detalle post-consulta).
  useCaseDeepLink(setSelected);

  // Pendientes y en curso siempre (alimentan los contadores); cerrados solo al verlos.
  const pending = useCaseBucket("pending");
  const active = useCaseBucket("active");
  const closed = useCaseBucket("closed", view === "closed");

  const { data: staff } = useQuery({
    queryKey: ["case-staff"],
    queryFn: async () => {
      const { data, error } = await supabase.from("users").select("id, email").in("role", ["admin", "superadmin"]);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((u) => [u.id, u.email ?? "—"]));
    },
  });

  const pendingRows = pending.data ?? [];
  const activeRows = active.data ?? [];
  const closedRows = closed.data ?? [];
  // SLA de los casos sin tomar (Configuración → Alertas); se recalcula en cada refresco de la cola.
  const slaSettings = useSlaSettings();
  const nowMs = Date.now();

  const rowsFor = (v: View): PatientCase[] => {
    // Sin asignar: primero los vencidos más urgentes.
    if (v === "unassigned") return sortBySla(pendingRows, slaSettings, nowMs);
    if (v === "closed") return closedRows;
    if (v === "mine") return activeRows.filter((c) => !!me && c.assigned_user_id === me);
    if (v === "waiting") return activeRows.filter((c) => WAITING.includes(c.status));
    return activeRows;
  };

  const counts: Partial<Record<View, number>> = {
    unassigned: pending.data ? pendingRows.length : undefined,
    mine: active.data ? rowsFor("mine").length : undefined,
    active: active.data ? activeRows.length : undefined,
    waiting: active.data ? rowsFor("waiting").length : undefined,
  };
  const urgentOpen = [...pendingRows, ...activeRows].filter((c) => c.priority === "urgent").length;

  const source = view === "unassigned" ? pending : view === "closed" ? closed : active;
  const term = search.trim().toLowerCase();
  const rows = rowsFor(view).filter((c) => {
    if (typeFilter !== "all" && c.request_type !== typeFilter) return false;
    if (priorityFilter !== "all" && c.priority !== priorityFilter) return false;
    if (!term) return true;
    return [c.contact_name, c.subject_phone, c.summary, c.city, c.zone, TYPE_LABEL[c.request_type]]
      .some((v) => (v ?? "").toLowerCase().includes(term));
  });
  const filtersActive = !!term || typeFilter !== "all" || priorityFilter !== "all";
  const clearFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setPriorityFilter("all");
  };

  // El caso abierto se refresca con los datos más nuevos aunque cambie de bucket.
  const current = selected
    ? [...pendingRows, ...activeRows, ...closedRows].find((c) => c.id === selected.id) ?? selected
    : null;
  const staffName = (id: string | null) => (id ? (id === me ? "Tú" : staff?.[id] ?? "—") : null);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Casos"
        description="Solicitudes que necesitan a una persona: hospital, estudios, urgencias, seguimiento post-consulta, reembolsos y canalizaciones del agente de WhatsApp."
        actions={
          <>
            {urgentOpen > 0 && <SoftBadge tone="danger" dot>{urgentOpen === 1 ? "1 urgente abierto" : `${urgentOpen} urgentes abiertos`}</SoftBadge>}
            <Button size="sm" className="gap-1.5" onClick={() => setNewCaseOpen(true)}>
              <Plus className="h-4 w-4" /> Nuevo caso
            </Button>
          </>
        }
      />

      <NewCaseDialog
        open={newCaseOpen}
        onOpenChange={setNewCaseOpen}
        onCreated={(c) => {
          queryClient.invalidateQueries({ queryKey: ["patient-cases"] });
          setSelected(c);
        }}
      />

      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="h-9 w-max">
            {VIEWS.map((v) => {
              const n = counts[v.value];
              return (
                <TabsTrigger key={v.value} value={v.value} className="gap-1.5 text-sm">
                  {v.label}
                  {n !== undefined && (
                    <span
                      className={cn(
                        "min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums leading-[18px]",
                        v.value === "unassigned" && n > 0 ? "bg-destructive/10 text-destructive" : "bg-foreground/[0.06] text-muted-foreground",
                      )}
                    >
                      {n}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar paciente, teléfono, ciudad…" />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 min-w-[140px] flex-1 text-sm sm:w-[170px] sm:flex-none"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="h-9 min-w-[140px] flex-1 text-sm sm:w-[170px] sm:flex-none"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las prioridades</SelectItem>
            {Object.entries(PRIORITY).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button size="sm" variant="ghost" className="h-9 px-2.5 text-muted-foreground" onClick={clearFilters}>
            Limpiar
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {source.data ? (rows.length === 1 ? "1 caso" : `${rows.length} casos`) : ""}
        </span>
      </FilterBar>

      {source.isPending ? (
        <Card className="overflow-hidden">
          <div className="h-9 border-b bg-muted/40" />
          <div className="divide-y">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="hidden h-4 w-48 md:block" />
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </Card>
      ) : source.isError && !source.data ? (
        <EmptyState
          icon={AlertTriangle}
          title="No se pudieron cargar los casos"
          description="Revisa tu conexión e inténtalo de nuevo."
          action={<Button size="sm" variant="outline" onClick={() => source.refetch()}>Reintentar</Button>}
        />
      ) : rows.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={SearchX}
            title="Sin resultados con estos filtros"
            description="Prueba con otra búsqueda o quita los filtros."
            action={<Button size="sm" variant="outline" onClick={clearFilters}>Limpiar filtros</Button>}
          />
        ) : (
          <EmptyState icon={view === "closed" ? CheckCircle2 : LifeBuoy} title={EMPTY_COPY[view].title} description={EMPTY_COPY[view].description} />
        )
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="hidden h-9 w-[112px] text-xs sm:table-cell">Prioridad</TableHead>
                <TableHead className="h-9 text-xs">Paciente</TableHead>
                <TableHead className="hidden h-9 text-xs sm:table-cell">Solicitud</TableHead>
                <TableHead className="hidden h-9 text-xs lg:table-cell">Ciudad</TableHead>
                <TableHead className="hidden h-9 text-xs md:table-cell">Estado</TableHead>
                <TableHead className="hidden h-9 text-xs xl:table-cell">Responsable</TableHead>
                <TableHead className="h-9 text-right text-xs">{view === "unassigned" ? "Esperando" : "Recibido"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <CaseRow
                  key={c.id}
                  c={c}
                  selected={current?.id === c.id}
                  assignee={staffName(c.assigned_user_id)}
                  sla={caseSla(c, slaSettings, nowMs)}
                  onOpen={() => setSelected(c)}
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <CaseSheet
        caseRow={current}
        staff={staff ?? {}}
        me={me}
        onClose={() => setSelected(null)}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ["patient-cases"] })}
      />
    </div>
  );
}

function CaseRow({
  c,
  selected,
  assignee,
  sla,
  onOpen,
}: {
  c: PatientCase;
  selected: boolean;
  assignee: string | null;
  /** Solo para casos que nadie ha tomado (open / awaiting_assignment). */
  sla: CaseSla | null;
  onOpen: () => void;
}) {
  const prio = PRIORITY[c.priority] ?? PRIORITY.normal;
  const ai = AI_STATE[c.ai_state] ?? AI_STATE.not_requested;
  const isClosed = BUCKETS.closed.includes(c.status);
  const overdue = isOverdue(c);
  const where = caseLocation(c);

  return (
    <TableRow
      tabIndex={0}
      data-state={selected ? "selected" : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none",
        c.priority === "urgent" && !isClosed && "bg-destructive/[0.03]",
      )}
    >
      <TableCell className="hidden py-2.5 sm:table-cell">
        <SoftBadge tone={prio.tone} dot>{prio.label}</SoftBadge>
      </TableCell>
      <TableCell className="py-2.5">
        <p className="max-w-[240px] truncate font-medium text-foreground">{c.contact_name ?? "Sin nombre"}</p>
        <p className="text-xs text-muted-foreground">
          {c.subject_phone}
          {where && <span className="lg:hidden"> · {where}</span>}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1 md:hidden">
          {c.priority !== "normal" && <SoftBadge tone={prio.tone} dot className="sm:hidden">{prio.label}</SoftBadge>}
          <SoftBadge tone="neutral" className="sm:hidden">{TYPE_LABEL[c.request_type] ?? c.request_type}</SoftBadge>
          <SoftBadge tone={STATUS_TONE[c.status] ?? "neutral"}>{STATUS_LABEL[c.status] ?? c.status}</SoftBadge>
          {overdue && <SoftBadge tone="danger">Vencido</SoftBadge>}
        </div>
      </TableCell>
      <TableCell className="hidden py-2.5 sm:table-cell">
        <p className="text-sm font-medium text-foreground">{TYPE_LABEL[c.request_type] ?? c.request_type}</p>
        <p className="line-clamp-1 max-w-[360px] text-xs text-muted-foreground">{c.summary}</p>
      </TableCell>
      <TableCell className="hidden py-2.5 text-sm text-muted-foreground lg:table-cell">{where ?? "—"}</TableCell>
      <TableCell className="hidden py-2.5 md:table-cell">
        <div className="flex flex-wrap items-center gap-1">
          <SoftBadge tone={STATUS_TONE[c.status] ?? "neutral"} dot>{STATUS_LABEL[c.status] ?? c.status}</SoftBadge>
          {overdue && <SoftBadge tone="danger">Vencido</SoftBadge>}
        </div>
        {!isClosed && (
          <p className={cn("mt-1 flex items-center gap-1 text-[11px]", ai.className)}>
            <ai.icon className="h-3 w-3" /> {ai.label}
          </p>
        )}
      </TableCell>
      <TableCell className="hidden py-2.5 xl:table-cell">
        <span className={cn("block max-w-[200px] truncate text-sm", assignee ? "text-foreground" : "text-muted-foreground")}>
          {assignee ?? "Sin asignar"}
        </span>
      </TableCell>
      <TableCell
        className="whitespace-nowrap py-2.5 text-right text-xs text-muted-foreground"
        title={formatMx(parseISO(c.created_at), "d MMM yyyy, HH:mm", { locale: es })}
      >
        {sla ? (
          <div className="flex flex-col items-end gap-1">
            <span className={cn("font-medium tabular-nums", sla.state === "overdue" ? "text-destructive" : "text-foreground")}>{formatWait(sla.minutes)}</span>
            <SoftBadge tone={SLA_STATE[sla.state].tone} dot>{SLA_STATE[sla.state].label}</SoftBadge>
          </div>
        ) : (
          shortAgo(c.created_at)
        )}
      </TableCell>
    </TableRow>
  );
}

function InfoItem({ icon: Icon, label, children }: { icon: ComponentType<{ className?: string }>; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm text-foreground">{children}</dd>
      </div>
    </div>
  );
}

function eventDot(type: string) {
  if (type.endsWith("_failed") || type === "conversation_not_found" || type === "whaapy_not_configured" || type === "whaapy_no_matching_agent") {
    return "bg-destructive";
  }
  if (type === "resolved" || type === "closed") return "bg-success";
  if (type === "note") return "bg-info";
  if (type === "escalated" || type === "staff_alert_skipped") return "bg-warning";
  if (type === "staff_alert_sent") return "bg-info";
  if (type === "created" || type === "assigned") return "bg-primary";
  return "bg-muted-foreground/40";
}

export function CaseSheet({
  caseRow,
  staff,
  me,
  onClose,
  onChanged,
}: {
  caseRow: PatientCase | null;
  staff: Record<string, string>;
  me: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const slaSettings = useSlaSettings();
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [reason, setReason] = useState("");
  const [resumeAi, setResumeAi] = useState(true);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Rellenar el formulario al abrir otro caso.
  if (caseRow && loadedFor !== caseRow.id) {
    setLoadedFor(caseRow.id);
    setNextAction(caseRow.next_action ?? "");
    setDueAt(caseRow.due_at ? formatMx(parseISO(caseRow.due_at), "yyyy-MM-dd'T'HH:mm") : "");
    setNote("");
    setReason("");
    setResumeAi(true);
  }

  const { data: events, isPending: eventsPending } = useQuery({
    queryKey: ["case-events", caseRow?.id],
    enabled: !!caseRow,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_events")
        .select("*")
        .eq("case_id", caseRow!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CaseEvent[];
    },
    placeholderData: keepPreviousData,
  });

  const action = useMutation({
    mutationFn: (body: Record<string, unknown>) => invokeCaseAction({ case_id: caseRow!.id, ...body }),
    onSuccess: (res, body) => {
      onChanged();
      queryClient.invalidateQueries({ queryKey: ["case-events", caseRow?.id] });
      if (body.action === "note") setNote("");
      if (res.warnings.length > 0) {
        toast({ title: "Hecho, con avisos", description: res.warnings.join(" "), variant: "destructive" });
      } else {
        toast({ title: "Caso actualizado" });
      }
      if (body.action === "resolve") onClose();
    },
    onError: async (err) => {
      const parsed = await extractEdgeFunctionError(err);
      const { title, description } = toastFromEdgeFunctionError(parsed, "No se pudo actualizar el caso");
      toast({ title, description, variant: "destructive" });
    },
  });

  if (!caseRow) return null;
  const closed = caseRow.status === "resolved" || caseRow.status === "closed";
  const busy = action.isPending;
  const ai = AI_STATE[caseRow.ai_state] ?? AI_STATE.not_requested;
  const prio = PRIORITY[caseRow.priority] ?? PRIORITY.normal;
  const overdue = isOverdue(caseRow);
  const sla = caseSla(caseRow, slaSettings, Date.now());
  // Con keepPreviousData puede llegar el historial del caso anterior mientras carga.
  const caseEvents = (events ?? []).filter((e) => e.case_id === caseRow.id);
  const assignee = caseRow.assigned_user_id
    ? caseRow.assigned_user_id === me
      ? "Tú"
      : staff[caseRow.assigned_user_id] ?? "—"
    : "Sin asignar";
  const canPauseAi = caseRow.ai_state === "pause_failed" || caseRow.ai_state === "not_requested" || caseRow.ai_state === "resumed";

  return (
    <Sheet open={!!caseRow} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-2 border-b p-4 pr-12 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <SoftBadge tone={prio.tone} dot>{prio.label}</SoftBadge>
            <SoftBadge tone="neutral">{TYPE_LABEL[caseRow.request_type] ?? caseRow.request_type}</SoftBadge>
            <SoftBadge tone={STATUS_TONE[caseRow.status] ?? "neutral"}>{STATUS_LABEL[caseRow.status] ?? caseRow.status}</SoftBadge>
            {overdue && <SoftBadge tone="danger">Vencido</SoftBadge>}
            {sla && <SoftBadge tone={SLA_STATE[sla.state].tone} dot>{SLA_STATE[sla.state].label}</SoftBadge>}
          </div>
          <div className="space-y-0.5">
            <SheetTitle className="text-base font-semibold leading-tight">{caseRow.contact_name ?? "Sin nombre"}</SheetTitle>
            <SheetDescription className="text-xs">
              Abierto {ago(caseRow.created_at)} · {formatMx(parseISO(caseRow.created_at), "d MMM yyyy, HH:mm", { locale: es })}
            </SheetDescription>
            {sla && (
              <p className={cn("text-xs", sla.state === "overdue" ? "font-medium text-destructive" : "text-muted-foreground")}>
                Esperando a alguien del equipo: {formatWait(sla.minutes)} (tiempo de respuesta: {formatWait(sla.slaMinutes)})
                {caseRow.alert_level > 0 && ` · ${caseRow.alert_level} de ${slaSettings.max_escalations} re-avisos enviados`}
              </p>
            )}
          </div>
        </SheetHeader>

        {!closed && (
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <Button
              size="sm"
              variant={caseRow.assigned_user_id ? "outline" : "default"}
              className="gap-1.5"
              disabled={busy}
              onClick={() => action.mutate({ action: "take", reassign: !!caseRow.assigned_user_id })}
            >
              <Hand className="h-4 w-4" /> {caseRow.assigned_user_id ? "Reasignarme el caso" : "Tomar caso"}
            </Button>
            {canPauseAi && (
              <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => action.mutate({ action: "retry_pause" })}>
                <BotOff className="h-4 w-4" /> Apagar IA en WhatsApp
              </Button>
            )}
            <Select
              value={["awaiting_assignment", "assigned", "awaiting_patient", "awaiting_provider"].includes(caseRow.status) ? caseRow.status : undefined}
              onValueChange={(v) => action.mutate({ action: "update", status: v })}
              disabled={busy}
            >
              <SelectTrigger className="h-9 w-full text-sm sm:ml-auto sm:w-[210px]" aria-label="Estado del caso">
                <SelectValue placeholder="Cambiar estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="awaiting_assignment">Sin asignar</SelectItem>
                {/* case-actions exige que alguien tome el caso antes (409 take_first). */}
                <SelectItem value="assigned" disabled={!caseRow.assigned_user_id}>Asignado</SelectItem>
                <SelectItem value="awaiting_patient" disabled={!caseRow.assigned_user_id}>Esperando al paciente</SelectItem>
                <SelectItem value="awaiting_provider" disabled={!caseRow.assigned_user_id}>Esperando al proveedor</SelectItem>
              </SelectContent>
            </Select>
            {!caseRow.assigned_user_id && (
              <p className="w-full text-xs text-muted-foreground sm:text-right">
                Toma el caso para cambiarlo a «Asignado» o «Esperando…».
              </p>
            )}
          </div>
        )}

        <Tabs defaultValue="detalle" className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-4 py-2">
            <TabsList className="grid h-9 w-full grid-cols-2">
              <TabsTrigger value="detalle" className="text-sm">Detalle</TabsTrigger>
              <TabsTrigger value="historial" className="gap-1.5 text-sm">
                Historial
                {caseEvents.length > 0 && (
                  <span className="rounded-full bg-foreground/[0.06] px-1.5 text-[11px] font-semibold tabular-nums leading-[18px] text-muted-foreground">
                    {caseEvents.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="detalle" className="mt-0 min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <dl className="grid gap-x-4 gap-y-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
              <InfoItem icon={Phone} label="Teléfono">{caseRow.subject_phone}</InfoItem>
              <InfoItem icon={MapPin} label="Ubicación">{caseLocation(caseRow) ?? "—"}</InfoItem>
              <InfoItem icon={UserRound} label="Responsable">{assignee}</InfoItem>
              <InfoItem icon={ai.icon} label="Asistente de WhatsApp">
                <span className={ai.className}>{ai.label}</span>
              </InfoItem>
            </dl>

            <section className="space-y-1.5">
              <h3 className="text-sm font-semibold text-foreground">Solicitud</h3>
              <p className="whitespace-pre-wrap text-sm text-foreground">{caseRow.summary}</p>
              {caseRow.handoff_reason && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Motivo de canalización:</span> {caseRow.handoff_reason}
                </p>
              )}
              {caseRow.resolution_reason && (
                <div className="mt-2 rounded-md border border-success/25 bg-success/5 px-3 py-2">
                  <p className="text-xs font-medium text-success">Cierre</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{caseRow.resolution_reason}</p>
                </div>
              )}
            </section>

            {/* Garantía 20-oct: nombre del titular y teléfono, editables (y se copian a WHAAPY). */}
            {caseRow.patient_id && <CasePatientContact patientId={caseRow.patient_id} />}

            {/* Etapa 2: origen post-consulta (tipo de manejo, cita) y reembolsos. */}
            <CaseOriginCard caseRow={caseRow} />
            <CaseReimbursementPanel
              caseRow={caseRow}
              closed={closed}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["case-events", caseRow.id] })}
            />

            {!closed && (
              <>
                <section className="space-y-3 rounded-lg border p-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Seguimiento</h3>
                    <p className="text-xs text-muted-foreground">Qué sigue y para cuándo.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
                    <div className="space-y-1.5">
                      <Label htmlFor="next-action" className="text-xs font-medium">Próxima acción</Label>
                      <Input
                        id="next-action"
                        className="h-9 text-sm"
                        value={nextAction}
                        maxLength={500}
                        placeholder="Ej. Llamar al hospital para confirmar cupo"
                        onChange={(e) => setNextAction(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="due-at" className="text-xs font-medium">Vence</Label>
                      <Input id="due-at" type="datetime-local" className="h-9 text-sm" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className={cn("text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
                      {overdue ? "La próxima acción ya venció." : ""}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        action.mutate({
                          action: "update",
                          next_action: nextAction.trim() || null,
                          // "Vence" se captura y se muestra en hora de CDMX.
                          due_at: dueAt ? fromZonedTime(dueAt, MEXICO_TZ).toISOString() : null,
                        })}
                    >
                      Guardar seguimiento
                    </Button>
                  </div>
                </section>

                <section className="space-y-2">
                  <div>
                    <Label htmlFor="note" className="text-sm font-semibold">Nota interna</Label>
                    <p className="text-xs text-muted-foreground">Solo la ve el equipo; queda en el historial del caso.</p>
                  </div>
                  <Textarea id="note" rows={3} className="resize-none text-sm" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => action.mutate({ action: "note", text: note })}>
                      Agregar nota
                    </Button>
                  </div>
                </section>

                <section className="space-y-3 rounded-lg border p-3">
                  <div>
                    <Label htmlFor="reason" className="text-sm font-semibold">Cerrar caso</Label>
                    <p className="text-xs text-muted-foreground">El motivo es obligatorio y queda registrado en el historial.</p>
                  </div>
                  <Textarea
                    id="reason"
                    rows={2}
                    className="resize-none text-sm"
                    value={reason}
                    maxLength={500}
                    placeholder="Qué se resolvió o por qué se cierra"
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox checked={resumeAi} onCheckedChange={(v) => setResumeAi(v === true)} />
                    Reactivar la IA en la conversación de WhatsApp
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="outline" disabled={busy || reason.trim().length < 3} onClick={() => action.mutate({ action: "resolve", outcome: "closed", reason, resume_ai: resumeAi })}>
                      Cerrar sin resolver
                    </Button>
                    <Button size="sm" className="gap-1.5" disabled={busy || reason.trim().length < 3} onClick={() => action.mutate({ action: "resolve", outcome: "resolved", reason, resume_ai: resumeAi })}>
                      <CheckCircle2 className="h-4 w-4" /> Marcar como resuelto
                    </Button>
                  </div>
                </section>
              </>
            )}
          </TabsContent>

          <TabsContent value="historial" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4">
            {eventsPending && caseEvents.length === 0 ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="mt-1 h-3 w-3 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            ) : caseEvents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Sin movimientos todavía.</p>
            ) : (
              <ol>
                {caseEvents.map((e, i) => {
                  const detail = (e.detail ?? {}) as Record<string, unknown>;
                  const text = typeof detail.text === "string"
                    ? detail.text
                    : typeof detail.reason === "string"
                    ? detail.reason
                    : e.event_type === "deduplicated" && typeof detail.summary === "string"
                    ? detail.summary
                    : null;
                  const failed = e.event_type.endsWith("_failed");
                  return (
                    <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                      {i < caseEvents.length - 1 && <span className="absolute -bottom-1.5 left-[5px] top-[17px] w-px bg-border" aria-hidden />}
                      <span className={cn("mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-4 ring-background", eventDot(e.event_type))} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-medium", failed ? "text-destructive" : "text-foreground")}>
                          {caseEventLabel(e)}
                          {e.actor_user_id && <span className="font-normal text-muted-foreground"> · {e.actor_user_id === me ? "tú" : staff[e.actor_user_id] ?? "equipo"}</span>}
                        </p>
                        {text && <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/60 px-2.5 py-1.5 text-sm text-foreground">{text}</p>}
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatMx(parseISO(e.created_at), "d MMM yyyy, HH:mm", { locale: es })}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
