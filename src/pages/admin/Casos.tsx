// Cola de casos y canalización humana (bloque B6).
// Los casos los abre el agente de WhatsApp (open_case / request_handoff) y el
// equipo los toma, les da seguimiento y los cierra con motivo aquí. Todas las
// escrituras pasan por la Edge Function case-actions (que también apaga/
// reactiva la IA y asigna en WHAAPY); esta página solo lee por RLS.
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { extractEdgeFunctionError, toastFromEdgeFunctionError } from "@/lib/edge-function-error";
import { AlertTriangle, Bot, BotOff, Hand, LifeBuoy, Phone, RefreshCw } from "lucide-react";

type PatientCase = Tables<"patient_cases">;
type CaseEvent = Tables<"case_events">;
type Bucket = "pending" | "active" | "closed";

const BUCKETS: Record<Bucket, string[]> = {
  pending: ["open", "awaiting_assignment"],
  active: ["assigned", "awaiting_patient", "awaiting_provider"],
  closed: ["resolved", "closed"],
};

const TYPE_LABEL: Record<string, string> = {
  appointment_help: "Cita",
  hospital: "Hospital",
  studies: "Estudios",
  urgency: "Urgencia",
  follow_up: "Seguimiento",
  other: "Otro",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Abierto",
  awaiting_assignment: "Sin asignar",
  assigned: "Asignado",
  awaiting_patient: "Esperando al paciente",
  awaiting_provider: "Esperando al proveedor",
  resolved: "Resuelto",
  closed: "Cerrado",
};

const PRIORITY_BADGE: Record<string, { label: string; className: string }> = {
  urgent: { label: "Urgente", className: "bg-destructive text-destructive-foreground" },
  high: { label: "Alta", className: "bg-amber-500 text-white" },
  normal: { label: "Normal", className: "bg-muted text-muted-foreground" },
};

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2 };

const EVENT_LABEL: Record<string, string> = {
  created: "Caso abierto por el agente",
  deduplicated: "El paciente repitió la solicitud",
  handoff_requested: "Se pidió atención humana",
  handoff_retried: "Se volvió a pedir atención humana",
  ai_paused: "IA apagada en WhatsApp",
  ai_pause_failed: "No se pudo apagar la IA",
  ai_resumed: "IA reactivada",
  ai_resume_failed: "No se pudo reactivar la IA",
  conversation_lookup_failed: "No se pudo consultar la conversación en WHAAPY",
  conversation_not_found: "No existe conversación en WHAAPY para este número",
  whaapy_not_configured: "WHAAPY no está configurado",
  tags_added: "Etiquetas agregadas en WHAAPY",
  tags_failed: "No se pudieron agregar etiquetas en WHAAPY",
  assigned: "Caso tomado",
  whaapy_assigned: "Asignado también en WHAAPY",
  whaapy_assign_failed: "WHAAPY rechazó la asignación",
  whaapy_no_matching_agent: "Sin agente de WHAAPY con ese correo",
  whaapy_released: "Asignación liberada en WHAAPY",
  whaapy_release_failed: "No se pudo liberar la asignación en WHAAPY",
  updated: "Seguimiento actualizado",
  note: "Nota",
  resolved: "Resuelto",
  closed: "Cerrado",
};

const AI_STATE: Record<string, { label: string; icon: typeof Bot; className: string }> = {
  not_requested: { label: "IA activa", icon: Bot, className: "text-muted-foreground" },
  paused: { label: "IA apagada", icon: BotOff, className: "text-primary" },
  pause_failed: { label: "No se pudo apagar la IA", icon: AlertTriangle, className: "text-destructive" },
  resumed: { label: "IA reactivada", icon: Bot, className: "text-muted-foreground" },
  resume_failed: { label: "No se pudo reactivar la IA", icon: AlertTriangle, className: "text-destructive" },
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

export default function Casos() {
  const queryClient = useQueryClient();
  const [bucket, setBucket] = useState<Bucket>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: cases, isLoading } = useQuery({
    queryKey: ["patient-cases", bucket],
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

  const { data: staff } = useQuery({
    queryKey: ["case-staff"],
    queryFn: async () => {
      const { data, error } = await supabase.from("users").select("id, email").in("role", ["admin", "superadmin"]);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((u) => [u.id, u.email ?? "—"]));
    },
  });

  const selected = cases?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Casos</h1>
          <p className="text-sm text-muted-foreground">
            Solicitudes que necesitan a una persona: hospital, estudios, urgencias y canalizaciones del agente de WhatsApp.
          </p>
        </div>
        <Tabs value={bucket} onValueChange={(v) => setBucket(v as Bucket)}>
          <TabsList>
            <TabsTrigger value="pending">Pendientes</TabsTrigger>
            <TabsTrigger value="active">En curso</TabsTrigger>
            <TabsTrigger value="closed">Cerrados</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : cases && cases.length > 0 ? (
        <div className="space-y-2">
          {cases.map((c) => {
            const prio = PRIORITY_BADGE[c.priority] ?? PRIORITY_BADGE.normal;
            const ai = AI_STATE[c.ai_state] ?? AI_STATE.not_requested;
            const overdue = c.due_at && bucket !== "closed" && parseISO(c.due_at).getTime() < Date.now();
            return (
              <Card
                key={c.id}
                className={`cursor-pointer transition-all hover:bg-accent/50 ${c.priority === "urgent" && bucket !== "closed" ? "border-l-4 border-l-destructive" : ""}`}
                onClick={() => setSelectedId(c.id)}
              >
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={prio.className}>{prio.label}</Badge>
                    <Badge variant="outline">{TYPE_LABEL[c.request_type] ?? c.request_type}</Badge>
                    <Badge variant="secondary">{STATUS_LABEL[c.status] ?? c.status}</Badge>
                    {overdue && <Badge variant="destructive">Vencido</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">{ago(c.created_at)}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {c.contact_name ?? "Sin nombre"} <span className="font-normal text-muted-foreground">· {c.subject_phone}</span>
                    {c.city && <span className="font-normal text-muted-foreground"> · {c.city}{c.zone ? `, ${c.zone}` : ""}</span>}
                  </p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{c.summary}</p>
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <span className={`flex items-center gap-1 ${ai.className}`}>
                      <ai.icon className="h-3.5 w-3.5" /> {ai.label}
                    </span>
                    {c.assigned_user_id && (
                      <span className="text-muted-foreground">Lo lleva: {staff?.[c.assigned_user_id] ?? "—"}</span>
                    )}
                    {c.next_action && <span className="text-muted-foreground">Próximo: {c.next_action}</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
            <LifeBuoy className="h-8 w-8" />
            <p>{bucket === "pending" ? "No hay casos pendientes." : bucket === "active" ? "No hay casos en curso." : "No hay casos cerrados recientes."}</p>
          </CardContent>
        </Card>
      )}

      <CaseSheet
        caseRow={selected}
        staff={staff ?? {}}
        onClose={() => setSelectedId(null)}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ["patient-cases"] })}
      />
    </div>
  );
}

function CaseSheet({
  caseRow,
  staff,
  onClose,
  onChanged,
}: {
  caseRow: PatientCase | null;
  staff: Record<string, string>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
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
    setDueAt(caseRow.due_at ? format(parseISO(caseRow.due_at), "yyyy-MM-dd'T'HH:mm") : "");
    setNote("");
    setReason("");
    setResumeAi(true);
  }

  const { data: events } = useQuery({
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

  return (
    <Sheet open={!!caseRow} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {TYPE_LABEL[caseRow.request_type] ?? caseRow.request_type} · {caseRow.contact_name ?? "Sin nombre"}
          </SheetTitle>
          <SheetDescription>
            {STATUS_LABEL[caseRow.status]} · abierto {ago(caseRow.created_at)}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5 text-sm">
          <section className="space-y-1">
            <p className="flex items-center gap-2"><Phone className="h-4 w-4" /> {caseRow.subject_phone}</p>
            {caseRow.city && <p className="text-muted-foreground">{caseRow.city}{caseRow.zone ? `, ${caseRow.zone}` : ""}</p>}
            <p className="whitespace-pre-wrap">{caseRow.summary}</p>
            {caseRow.handoff_reason && <p className="text-muted-foreground">Motivo de canalización: {caseRow.handoff_reason}</p>}
            {caseRow.resolution_reason && <p className="text-muted-foreground">Cierre: {caseRow.resolution_reason}</p>}
            <p className={`flex items-center gap-1 ${ai.className}`}><ai.icon className="h-4 w-4" /> {ai.label}</p>
            {caseRow.assigned_user_id && <p className="text-muted-foreground">Lo lleva: {staff[caseRow.assigned_user_id] ?? "—"}</p>}
          </section>

          {!closed && (
            <>
              <section className="flex flex-wrap gap-2">
                <Button size="sm" className="gap-2" disabled={busy} onClick={() => action.mutate({ action: "take", reassign: !!caseRow.assigned_user_id })}>
                  <Hand className="h-4 w-4" /> {caseRow.assigned_user_id ? "Reasignarme el caso" : "Tomar caso"}
                </Button>
                {(caseRow.ai_state === "pause_failed" || caseRow.ai_state === "not_requested" || caseRow.ai_state === "resumed") && (
                  <Button size="sm" variant="outline" className="gap-2" disabled={busy} onClick={() => action.mutate({ action: "retry_pause" })}>
                    <RefreshCw className="h-4 w-4" /> Apagar IA en WhatsApp
                  </Button>
                )}
              </section>

              <section className="space-y-2">
                <Label>Estado</Label>
                <Select
                  value={["awaiting_assignment", "assigned", "awaiting_patient", "awaiting_provider"].includes(caseRow.status) ? caseRow.status : undefined}
                  onValueChange={(v) => action.mutate({ action: "update", status: v })}
                  disabled={busy}
                >
                  <SelectTrigger><SelectValue placeholder="Cambiar estado" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="awaiting_assignment">Sin asignar</SelectItem>
                    <SelectItem value="assigned">Asignado</SelectItem>
                    <SelectItem value="awaiting_patient">Esperando al paciente</SelectItem>
                    <SelectItem value="awaiting_provider">Esperando al proveedor</SelectItem>
                  </SelectContent>
                </Select>
              </section>

              <section className="space-y-2">
                <Label htmlFor="next-action">Próxima acción y vencimiento</Label>
                <Input id="next-action" value={nextAction} maxLength={500} placeholder="Ej. Llamar al hospital para confirmar cupo" onChange={(e) => setNextAction(e.target.value)} />
                <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    action.mutate({
                      action: "update",
                      next_action: nextAction.trim() || null,
                      due_at: dueAt ? new Date(dueAt).toISOString() : null,
                    })}
                >
                  Guardar seguimiento
                </Button>
              </section>

              <section className="space-y-2">
                <Label htmlFor="note">Nota interna</Label>
                <Textarea id="note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
                <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => action.mutate({ action: "note", text: note })}>
                  Agregar nota
                </Button>
              </section>

              <section className="space-y-2 rounded-lg border p-3">
                <Label htmlFor="reason">Cerrar caso</Label>
                <Textarea id="reason" value={reason} maxLength={500} placeholder="Motivo (obligatorio): qué se resolvió o por qué se cierra" onChange={(e) => setReason(e.target.value)} />
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={resumeAi} onCheckedChange={(v) => setResumeAi(v === true)} />
                  Reactivar la IA en la conversación de WhatsApp
                </label>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy || reason.trim().length < 3} onClick={() => action.mutate({ action: "resolve", outcome: "resolved", reason, resume_ai: resumeAi })}>
                    Resuelto
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy || reason.trim().length < 3} onClick={() => action.mutate({ action: "resolve", outcome: "closed", reason, resume_ai: resumeAi })}>
                    Cerrar sin resolver
                  </Button>
                </div>
              </section>
            </>
          )}

          <section className="space-y-2">
            <h3 className="font-medium">Historial</h3>
            <ol className="space-y-2 border-l pl-4">
              {(events ?? []).map((e) => {
                const detail = (e.detail ?? {}) as Record<string, unknown>;
                const text = typeof detail.text === "string" ? detail.text : typeof detail.reason === "string" ? detail.reason : null;
                return (
                  <li key={e.id} className="space-y-0.5">
                    <p className={e.event_type.endsWith("_failed") ? "text-destructive" : ""}>
                      {EVENT_LABEL[e.event_type] ?? e.event_type}
                      {e.actor_user_id && <span className="text-muted-foreground"> · {staff[e.actor_user_id] ?? "equipo"}</span>}
                    </p>
                    {text && <p className="whitespace-pre-wrap text-muted-foreground">{text}</p>}
                    <p className="text-xs text-muted-foreground">{format(parseISO(e.created_at), "d MMM yyyy, HH:mm", { locale: es })}</p>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
