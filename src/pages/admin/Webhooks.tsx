// Webhooks salientes (Configuración): eventos de FindMed firmados con
// HMAC-SHA-256 hacia integraciones externas. Desde el 13-oct los WhatsApp a
// pacientes los envía FindMed desde Automatización (WHAAPY); un evento cuyo
// dueño es FindMed ya no llama a ningún webhook (ver dispatch-webhook).
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Webhook,
} from "lucide-react";
import PasswordGate from "@/components/admin/PasswordGate";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { SoftBadge } from "@/components/app/StatusBadge";
import { cn } from "@/lib/utils";
import { secureRandomString } from "@/lib/secure-random";

const EVENT_GROUPS = [
  {
    label: "Citas — ciclo de vida",
    events: [
      { id: "appointment.created", label: "Cita creada" },
      { id: "appointment.confirmed", label: "Cita confirmada" },
      { id: "appointment.completed", label: "Cita completada" },
      { id: "appointment.status_changed", label: "Cambio de estado" },
    ],
  },
  {
    label: "Citas — cancelaciones",
    events: [
      { id: "appointment.cancelled", label: "Cita cancelada (legacy)" },
      { id: "appointment.cancelled_by_patient", label: "Cita cancelada por paciente" },
      { id: "appointment.cancelled_by_doctor", label: "Cita cancelada por doctor" },
      { id: "appointment.cancelled_by_admin", label: "Cita cancelada por admin" },
      { id: "appointment.auto_cancelled", label: "Cita auto-cancelada" },
    ],
  },
  {
    label: "Citas — reagendamientos",
    events: [
      { id: "appointment.rescheduled", label: "Cita reagendada (paciente)" },
      { id: "appointment.rescheduled_by_staff", label: "Cita reagendada por staff" },
    ],
  },
  {
    label: "Citas — recordatorios",
    events: [
      { id: "appointment.reminder_48h", label: "Recordatorio 48h" },
      { id: "appointment.reminder_day_of", label: "Recordatorio día de cita" },
    ],
  },
  {
    label: "Pacientes",
    events: [
      { id: "patient.created", label: "Paciente creado" },
    ],
  },
  {
    label: "Post-consulta",
    events: [
      { id: "postconsultation.submitted", label: "Post-consulta enviada" },
      { id: "postconsultation.report_sent", label: "Informe enviado" },
    ],
  },
];

const PAYLOAD_EXAMPLES: Record<string, object> = {
  "appointment.created": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_id: "uuid-example",
    doctor_name: "Dr. Juan Pérez",
    office_id: "uuid-example",
    office_name: "Bosques",
    office_address: "Av. Bosques 123, CDMX",
    start_at: "2026-03-15T10:00:00-06:00",
    end_at: "2026-03-15T10:30:00-06:00",
    symptoms: "Dolor de cabeza",
    manage_token: "abc123",
    manage_url: "https://app.example.com/gestionar?token=abc123",
  },
  "appointment.confirmed": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    start_at: "2026-03-15T10:00:00-06:00",
    confirmed_at: "2026-03-13T08:30:00-06:00",
    manage_url: "https://app.example.com/gestionar?token=abc123",
  },
  "appointment.cancelled": {
    // LEGACY — ya no se emite. Reemplazado por appointment.cancelled_by_patient.
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    cancel_reason: "patient",
  },
  "appointment.cancelled_by_patient": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_id: "uuid-example",
    start_at: "2026-03-15T10:00:00-06:00",
    cancel_reason: "patient",
    manage_url: "https://app.example.com/gestionar?token=abc123",
  },
  "appointment.cancelled_by_admin": {
    appointment_id: "uuid-example",
    source: "admin",
    previous_status: "scheduled",
    cancel_reason: "admin",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_id: "uuid-example",
    doctor_name: "Dr. Juan Pérez",
    office_id: "uuid-example",
    office_name: "Bosques",
    office_address: "Av. Bosques 123, CDMX",
    start_at: "2026-03-15T10:00:00-06:00",
    end_at: "2026-03-15T10:30:00-06:00",
    notify_patient: true,
    notify_doctor: true,
    manage_url: "https://app.example.com/gestionar?token=abc123",
  },
  "appointment.cancelled_by_doctor": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    cancel_reason: "doctor",
    message: "Tu cita fue cancelada por el doctor",
    manage_url: "https://app.example.com/gestionar?token=xyz789",
  },
  "appointment.auto_cancelled": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    cancel_reason: "no_confirmation",
    message: "Tu cita fue cancelada automáticamente porque no fue confirmada a tiempo",
    manage_url: "https://app.example.com/gestionar?token=xyz789",
  },
  "appointment.rescheduled": {
    // Emitido cuando el paciente reagenda vía /gestionar. manage-reschedule
    // crea una fila nueva y cancela la vieja, por eso old_/new_appointment_id.
    old_appointment_id: "uuid-old",
    new_appointment_id: "uuid-new",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    new_start_at: "2026-03-20T11:00:00-06:00",
    old_start_at: "2026-03-15T10:00:00-06:00",
    end_at: "2026-03-20T11:30:00-06:00",
    manage_url: "https://app.example.com/gestionar?token=abc123",
  },
  "appointment.rescheduled_by_staff": {
    appointment_id: "uuid-example",
    doctor_id: "uuid-example",
    doctor_name: "Dr. Juan Pérez",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    office_id: "uuid-example",
    office_name: "Bosques",
    office_address: "Av. Bosques 123, CDMX",
    previous_start_at: "2026-03-15T10:00:00-06:00",
    previous_end_at: "2026-03-15T10:30:00-06:00",
    start_at: "2026-03-20T11:00:00-06:00",
    end_at: "2026-03-20T11:30:00-06:00",
    manage_url: "https://app.example.com/gestionar?token=abc123",
    source: "admin",
    timestamp: "2026-03-13T08:30:00.000Z",
  },
  "appointment.completed": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_id: "uuid-example",
    doctor_name: "Dr. Juan Pérez",
    office_id: "uuid-example",
    office_name: "Bosques",
    start_at: "2026-03-15T10:00:00-06:00",
    end_at: "2026-03-15T10:30:00-06:00",
    completed_at: "2026-03-15T10:35:00-06:00",
    manage_url: "https://app.example.com/gestionar?token=abc123",
  },
  "appointment.reminder_48h": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    office_id: "uuid-example",
    office_name: "Bosques",
    office_address: "Av. Bosques 123, CDMX",
    start_at: "2026-03-15T10:00:00-06:00",
    manage_url: "https://app.example.com/gestionar?token=abc123",
    min_confirm_hours_before: 24,
    message: "Tu cita es en 48 horas. Puedes confirmar, cancelar o reagendar desde el link.",
  },
  "appointment.reminder_day_of": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    office_id: "uuid-example",
    office_name: "Bosques",
    office_address: "Av. Bosques 123, CDMX",
    start_at: "2026-03-15T10:00:00-06:00",
    manage_url: "https://app.example.com/gestionar?token=abc123",
    message: "Tu cita es hoy. Si necesitas reagendar o cancelar, usa el siguiente enlace.",
  },
  "appointment.status_changed": {
    // Shape mínimo común. Algunos emisores agregan campos adicionales como
    // doctor_id, office_id, end_at, source, notify_patient, etc.
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    previous_status: "scheduled",
    new_status: "confirmed",
    start_at: "2026-03-15T10:00:00-06:00",
    timestamp: "2026-03-13T08:30:00.000Z",
    manage_url: "https://app.example.com/gestionar?token=abc123",
  },
  "patient.created": {
    // Evento aspiracional — todavía no hay emisor en el backend.
    patient_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    created_at: "2026-03-13T08:00:00-06:00",
  },
  "postconsultation.submitted": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    end_at: "2026-03-15T10:30:00-06:00",
    symptoms: "Dolor de cabeza intenso",
    observations: "Paciente presenta mejoría general.",
    prescribed_medications: "Ibuprofeno 400mg cada 8 horas",
    imaging_studies: null,
    lab_tests: "Biometría hemática completa",
    specialist_referral: null,
    hospitalization: null,
  },
  "postconsultation.report_sent": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    form: {
      id: "uuid-example",
      appointment_id: "uuid-example",
      doctor_id: "uuid-example",
      observations: "Paciente requiere cirugía.",
      prescribed_medications: "Ibuprofeno 400mg cada 8 horas",
      imaging_studies: null,
      lab_tests: "Biometría hemática completa",
      specialist_referral: null,
      hospitalization: "Hospital General, cirugía programada, urgente",
      review_status: "report_sent",
      report_destination_type: "hospital",
      report_destination_id: "uuid-example",
      report_sent_at: "2026-03-10T20:05:41.848Z",
      created_at: "2026-03-10T18:00:00.000Z",
    },
    destination_type: "hospital",
    destination: {
      name: "Hospital General",
      phone: "+525555555555",
      email: "contacto@hospital.com",
      city: "CDMX",
      zone: "Centro",
    },
  },
};

function generateSecret(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return secureRandomString(chars, 32);
}

type WebhookRow = Tables<"webhooks">;

const EVENT_LABEL: Record<string, string> = Object.fromEntries(
  EVENT_GROUPS.flatMap((g) => g.events.map((e) => [e.id, e.label] as const)),
);

const HTTP_HEADERS = [
  "Content-Type: application/json",
  "X-FindMed-Signature: <hmac-sha256 del body>",
  "X-FindMed-Event: <event_type>",
];

function urlHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast({ title: "Copiado al portapapeles" }),
    () => toast({ title: "No se pudo copiar", variant: "destructive" }),
  );
}

export default function Webhooks() {
  return (
    <PasswordGate>
      <WebhooksContent />
    </PasswordGate>
  );
}

/* ───────── formulario (crear / editar) ───────── */

function Field({ id, label, hint, children }: { id?: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function WebhookFields({
  idPrefix,
  name,
  onName,
  url,
  onUrl,
  description,
  onDescription,
}: {
  idPrefix: string;
  name: string;
  onName: (v: string) => void;
  url: string;
  onUrl: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Field id={`${idPrefix}-name`} label="Nombre">
        <Input id={`${idPrefix}-name`} className="h-9 text-sm" placeholder="Ej: CRM Producción" value={name} onChange={(e) => onName(e.target.value)} />
      </Field>
      <Field id={`${idPrefix}-url`} label="URL de destino" hint="FindMed hace un POST a esta URL por cada evento suscrito.">
        <Input
          id={`${idPrefix}-url`}
          className="h-9 font-mono text-sm"
          placeholder="https://ejemplo.com/webhooks/findmed"
          value={url}
          onChange={(e) => onUrl(e.target.value)}
        />
      </Field>
      <Field id={`${idPrefix}-description`} label="Descripción (opcional)">
        <Textarea
          id={`${idPrefix}-description`}
          className="min-h-[60px] text-sm"
          placeholder="Para qué sistema es y quién lo mantiene"
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          rows={2}
        />
      </Field>
    </div>
  );
}

function EventChecklist({
  selectedEvents,
  onToggleEvent,
  onToggleGroup,
}: {
  selectedEvents: string[];
  onToggleEvent: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-foreground">Eventos</Label>
        <span className="text-xs text-muted-foreground">
          {selectedEvents.length === 0 ? "Elige al menos uno" : `${selectedEvents.length} seleccionados`}
        </span>
      </div>
      <div className="space-y-2">
        {EVENT_GROUPS.map((group) => {
          const groupEventIds = group.events.map((e) => e.id);
          const selectedInGroup = groupEventIds.filter((e) => selectedEvents.includes(e)).length;
          const allSelected = selectedInGroup === groupEventIds.length;
          return (
            <div key={group.label} className="overflow-hidden rounded-md border">
              <label className="flex cursor-pointer items-center gap-2 border-b bg-muted/40 px-3 py-2">
                <Checkbox checked={allSelected} onCheckedChange={() => onToggleGroup(groupEventIds)} />
                <span className="flex-1 text-xs font-semibold text-foreground">{group.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {selectedInGroup}/{groupEventIds.length}
                </span>
              </label>
              <div className="grid gap-x-3 gap-y-0.5 p-1.5 sm:grid-cols-2">
                {group.events.map((ev) => (
                  <label key={ev.id} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1.5 hover:bg-accent/40">
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedEvents.includes(ev.id)}
                      onCheckedChange={() => onToggleEvent(ev.id)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm leading-tight text-foreground">{ev.label}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{ev.id}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PayloadBlock({
  eventId,
  label,
  override,
  onSave,
}: {
  eventId: string;
  label: string;
  override?: object | null;
  onSave: (eventId: string, json: object) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const example = PAYLOAD_EXAMPLES[eventId];
  if (!example) return null;

  const currentData = override ?? example;
  const fullPayload = {
    event: eventId,
    data: currentData,
    timestamp: new Date().toISOString(),
  };
  const json = JSON.stringify(fullPayload, null, 2);

  const startEditing = () => {
    setDraft(JSON.stringify({ event: eventId, data: currentData, timestamp: new Date().toISOString() }, null, 2));
    setJsonError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setJsonError(null);
  };

  const saveEditing = () => {
    try {
      const parsed = JSON.parse(draft);
      const dataToSave = parsed.data ?? parsed;
      onSave(eventId, dataToSave);
      setEditing(false);
      setJsonError(null);
    } catch {
      setJsonError("JSON inválido. Revisa la sintaxis.");
    }
  };

  return (
    <div className="overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{label}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">{eventId}</span>
        </span>
        {override && <SoftBadge tone="info">Personalizado</SoftBadge>}
      </button>
      {open && (
        <div className="border-t">
          {editing ? (
            <div className="space-y-2 p-3">
              <Textarea
                className="min-h-[220px] resize-y font-mono text-[11px] leading-relaxed"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                aria-label={`Payload de ${label}`}
              />
              {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={cancelEditing}>Cancelar</Button>
                <Button size="sm" onClick={saveEditing}>Guardar payload</Button>
              </div>
            </div>
          ) : (
            <div className="relative">
              <pre className="max-h-80 overflow-auto bg-muted/30 p-3 pr-20 font-mono text-[11px] leading-relaxed">{json}</pre>
              <div className="absolute right-2 top-2 flex gap-0.5 rounded-md border bg-card shadow-sm">
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Editar payload" onClick={startEditing}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Copiar payload"
                  onClick={() => {
                    navigator.clipboard.writeText(json);
                    toast({ title: "Copiado al portapapeles" });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────── lista ───────── */

function EventsCountBadge({ events }: { events: string[] }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <SoftBadge tone="neutral">{events.length === 1 ? "1 evento" : `${events.length} eventos`}</SoftBadge>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ul className="space-y-0.5 text-xs">
          {events.map((ev) => (
            <li key={ev}>{EVENT_LABEL[ev] ?? ev}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

function WebhooksTableSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="h-9 border-b bg-muted/40" />
      <div className="space-y-2 p-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    </Card>
  );
}

function WebhooksContent() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookRow | null>(null);
  const [editTab, setEditTab] = useState("config");
  const [regenerateOpen, setRegenerateOpen] = useState(false);

  // Create form state
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editEvents, setEditEvents] = useState<string[]>([]);
  const [editActive, setEditActive] = useState(true);
  const [editPayloadOverrides, setEditPayloadOverrides] = useState<Record<string, object>>({});

  const { data: webhooks, isLoading } = useQuery({
    queryKey: ["webhooks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhooks")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const openEdit = (wh: WebhookRow) => {
    setSelectedWebhook(wh);
    setEditName(wh.name);
    setEditUrl(wh.url);
    setEditDescription(wh.description ?? "");
    setEditEvents(wh.events as string[]);
    setEditActive(wh.is_active);
    setEditPayloadOverrides({});
    setEditTab("config");
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const secret = generateSecret();
      const { error } = await supabase.from("webhooks").insert({
        name: name.trim(),
        url: url.trim(),
        description: description.trim() || null,
        events: selectedEvents,
        secret,
      });
      if (error) throw error;
      return secret;
    },
    onSuccess: (secret) => {
      setRevealedSecret(secret);
      setCreateOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      toast({ title: "Webhook creado" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!selectedWebhook) return;
      const { error } = await supabase
        .from("webhooks")
        .update({
          name: editName.trim(),
          url: editUrl.trim(),
          description: editDescription.trim() || null,
          events: editEvents,
          is_active: editActive,
        })
        .eq("id", selectedWebhook.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      setSelectedWebhook(null);
      toast({ title: "Webhook actualizado" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const regenerateMut = useMutation({
    mutationFn: async () => {
      if (!selectedWebhook) return "";
      const newSecret = generateSecret();
      const { error } = await supabase
        .from("webhooks")
        .update({ secret: newSecret })
        .eq("id", selectedWebhook.id);
      if (error) throw error;
      return newSecret;
    },
    onSuccess: (newSecret) => {
      setRegenerateOpen(false);
      setSelectedWebhook(null);
      setRevealedSecret(newSecret ?? null);
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      toast({ title: "Secret regenerado" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("webhooks")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("webhooks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      toast({ title: "Webhook eliminado" });
    },
  });

  const resetForm = () => {
    setName(""); setUrl(""); setDescription(""); setSelectedEvents([]);
  };

  const toggleEvent = (id: string) =>
    setSelectedEvents((prev) => prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]);

  const toggleGroup = (ids: string[]) => {
    const allSelected = ids.every((e) => selectedEvents.includes(e));
    setSelectedEvents((prev) => allSelected ? prev.filter((e) => !ids.includes(e)) : [...new Set([...prev, ...ids])]);
  };

  const toggleEditEvent = (id: string) =>
    setEditEvents((prev) => prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]);

  const toggleEditGroup = (ids: string[]) => {
    const allSelected = ids.every((e) => editEvents.includes(e));
    setEditEvents((prev) => allSelected ? prev.filter((e) => !ids.includes(e)) : [...new Set([...prev, ...ids])]);
  };

  const list = webhooks ?? [];
  const activeCount = list.filter((wh) => wh.is_active).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Webhooks"
        description="Envía eventos de FindMed, firmados con HMAC, a integraciones externas."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Nuevo webhook
          </Button>
        }
      />

      <div className="flex items-start gap-3 rounded-lg border border-info/25 bg-info/5 p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium text-foreground">Los WhatsApp a pacientes ya no salen por webhooks</p>
          <p className="text-muted-foreground">
            Desde el 13 de octubre FindMed los envía desde Automatización por WHAAPY, y los 8 webhooks que apuntaban a n8n
            quedaron pausados. Un evento que envía FindMed ya no se manda a ningún webhook: úsalos solo para integraciones externas.
          </p>
          <Link to="/admin/automatizacion" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Ir a Automatización <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {isLoading ? (
        <WebhooksTableSkeleton />
      ) : list.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Webhooks configurados</h2>
            <span className="text-xs text-muted-foreground">
              {list.length} en total · {activeCount} {activeCount === 1 ? "activo" : "activos"}
            </span>
          </div>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="h-9 text-xs">Nombre</TableHead>
                  <TableHead className="hidden h-9 text-xs md:table-cell">Destino</TableHead>
                  <TableHead className="hidden h-9 text-xs sm:table-cell">Eventos</TableHead>
                  <TableHead className="hidden h-9 text-xs lg:table-cell">Actualizado</TableHead>
                  <TableHead className="h-9 text-xs">Estado</TableHead>
                  <TableHead className="h-9 w-[84px] text-xs"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((wh) => (
                  <TableRow key={wh.id} className={cn(!wh.is_active && "text-muted-foreground")}>
                    <TableCell className="py-2.5">
                      <div className="min-w-0 max-w-[130px] sm:max-w-[220px] lg:max-w-[260px]">
                        <button
                          type="button"
                          onClick={() => openEdit(wh)}
                          className="block max-w-full truncate text-left text-sm font-medium text-foreground hover:underline"
                        >
                          {wh.name}
                        </button>
                        {wh.description && <p className="truncate text-xs text-muted-foreground">{wh.description}</p>}
                        <p className="truncate font-mono text-xs text-muted-foreground md:hidden" title={wh.url}>{urlHost(wh.url)}</p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden py-2.5 md:table-cell">
                      <span className="block max-w-[240px] truncate font-mono text-xs text-muted-foreground" title={wh.url}>
                        {urlHost(wh.url)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden py-2.5 sm:table-cell">
                      <EventsCountBadge events={wh.events as string[]} />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap py-2.5 text-xs text-muted-foreground lg:table-cell">
                      {format(parseISO(wh.updated_at ?? wh.created_at), "d MMM yyyy", { locale: es })}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={wh.is_active}
                          onCheckedChange={(checked) =>
                            toggleMut.mutate({ id: wh.id, is_active: checked })
                          }
                          className="scale-90"
                          aria-label={wh.is_active ? `Pausar ${wh.name}` : `Activar ${wh.name}`}
                        />
                        <span className="hidden text-xs sm:inline">{wh.is_active ? "Activo" : "Pausado"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(wh)}
                          aria-label={`Editar ${wh.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              aria-label={`Eliminar ${wh.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>¿Eliminar "{wh.name}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Dejará de recibir eventos y su secret se pierde. Esta acción no se puede deshacer; si solo quieres detenerlo, usa el interruptor.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMut.mutate(wh.id)}>
                                Eliminar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      ) : (
        <EmptyState
          icon={Webhook}
          title="Sin webhooks"
          description="Crea uno para mandar eventos de FindMed a un sistema externo (CRM, reportes, etc.)."
          action={
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Nuevo webhook
            </Button>
          }
        />
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) resetForm(); setCreateOpen(open); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo webhook</DialogTitle>
            <DialogDescription>FindMed enviará por POST los eventos que elijas, firmados con HMAC.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <WebhookFields
              idPrefix="wh-new"
              name={name}
              onName={setName}
              url={url}
              onUrl={setUrl}
              description={description}
              onDescription={setDescription}
            />
            <EventChecklist selectedEvents={selectedEvents} onToggleEvent={toggleEvent} onToggleGroup={toggleGroup} />
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Se generará un secret para verificar la firma; se muestra una sola vez. Cada envío incluye el header{" "}
                <code className="rounded bg-muted px-1 font-mono">X-FindMed-Signature</code>.
              </span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button size="sm" variant="outline" onClick={() => { resetForm(); setCreateOpen(false); }}>Cancelar</Button>
            <Button
              size="sm"
              onClick={() => createMut.mutate()}
              disabled={!name.trim() || !url.trim() || selectedEvents.length === 0 || createMut.isPending}
            >
              {createMut.isPending ? "Creando…" : "Crear webhook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!selectedWebhook} onOpenChange={(open) => { if (!open) setSelectedWebhook(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
              <span className="truncate">{selectedWebhook?.name}</span>
              {selectedWebhook && (
                <SoftBadge tone={selectedWebhook.is_active ? "success" : "neutral"} dot>
                  {selectedWebhook.is_active ? "Activo" : "Pausado"}
                </SoftBadge>
              )}
            </DialogTitle>
            <DialogDescription>
              Creado el {selectedWebhook ? format(new Date(selectedWebhook.created_at), "d 'de' MMMM yyyy", { locale: es }) : ""}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={editTab} onValueChange={setEditTab}>
            <TabsList className="h-9">
              <TabsTrigger value="config" className="text-sm">Configuración</TabsTrigger>
              <TabsTrigger value="payload" className="text-sm">Payload de ejemplo</TabsTrigger>
            </TabsList>

            <TabsContent value="config" className="mt-4 space-y-5">
              <WebhookFields
                idPrefix="wh-edit"
                name={editName}
                onName={setEditName}
                url={editUrl}
                onUrl={setEditUrl}
                description={editDescription}
                onDescription={setEditDescription}
              />
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{editActive ? "Activo" : "Pausado"}</span>
                  <span className="block text-xs text-muted-foreground">Mientras esté pausado no recibe ningún evento.</span>
                </span>
                <Switch checked={editActive} onCheckedChange={setEditActive} aria-label="Webhook activo" />
              </label>
              <EventChecklist selectedEvents={editEvents} onToggleEvent={toggleEditEvent} onToggleGroup={toggleEditGroup} />
              <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-muted-foreground"
                  onClick={() => setRegenerateOpen(true)}
                >
                  <RefreshCw className="h-4 w-4" />
                  Regenerar secret
                </Button>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelectedWebhook(null)}>Cancelar</Button>
                  <Button
                    size="sm"
                    onClick={() => updateMut.mutate()}
                    disabled={!editName.trim() || !editUrl.trim() || editEvents.length === 0 || updateMut.isPending}
                  >
                    {updateMut.isPending ? "Guardando…" : "Guardar cambios"}
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="payload" className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Headers HTTP enviados</p>
                <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                  {HTTP_HEADERS.map((h) => (
                    <code key={h} className="block font-mono text-xs text-foreground">{h}</code>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Ejemplos por evento suscrito</p>
                {editEvents.length === 0 ? (
                  <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No hay eventos seleccionados.</p>
                ) : (
                  editEvents.map((ev) => (
                    <PayloadBlock
                      key={ev}
                      eventId={ev}
                      label={EVENT_LABEL[ev] ?? ev}
                      override={
                        editPayloadOverrides[ev] ??
                        (selectedWebhook?.payload_overrides as Record<string, object> | null)?.[ev] ??
                        null
                      }
                      onSave={(eventId, data) => {
                        const newOverrides = {
                          ...(selectedWebhook?.payload_overrides as Record<string, object> ?? {}),
                          ...editPayloadOverrides,
                          [eventId]: data,
                        };
                        setEditPayloadOverrides(newOverrides);
                        // Persist immediately
                        supabase
                          .from("webhooks")
                          .update({ payload_overrides: newOverrides as Json })
                          .eq("id", selectedWebhook.id)
                          .then(({ error }) => {
                            if (error) {
                              toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
                            } else {
                              queryClient.invalidateQueries({ queryKey: ["webhooks"] });
                              toast({ title: "Payload guardado" });
                            }
                          });
                      }}
                    />
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Regenerate secret confirm */}
      <AlertDialog open={regenerateOpen} onOpenChange={setRegenerateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Regenerar secret?</AlertDialogTitle>
            <AlertDialogDescription>
              El secret anterior dejará de funcionar inmediatamente. Tendrás que actualizar tu integración con el nuevo secret.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => regenerateMut.mutate()}
              disabled={regenerateMut.isPending}
            >
              {regenerateMut.isPending ? "Regenerando…" : "Sí, regenerar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Secret reveal dialog */}
      <Dialog open={!!revealedSecret} onOpenChange={() => setRevealedSecret(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Secret del webhook</DialogTitle>
            <DialogDescription>Cópialo ahora y guárdalo en tu integración: no se volverá a mostrar.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
            <code className="min-w-0 flex-1 break-all px-1 font-mono text-sm text-foreground">{revealedSecret}</code>
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => copyToClipboard(revealedSecret ?? "")}>
              <Copy className="h-3.5 w-3.5" /> Copiar
            </Button>
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
            Para verificar cada envío, calcula el HMAC-SHA256 del body con este secret y compáralo con el header X-FindMed-Signature.
          </p>
          <DialogFooter>
            <Button size="sm" onClick={() => setRevealedSecret(null)}>Listo, ya lo guardé</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
