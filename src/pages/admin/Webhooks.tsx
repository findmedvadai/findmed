import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Plus, Trash2, Copy, Webhook, Info, Pencil, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import PasswordGate from "@/components/admin/PasswordGate";

const EVENT_GROUPS = [
  {
    label: "Citas",
    events: [
      { id: "appointment.created", label: "Cita creada" },
      { id: "appointment.confirmed", label: "Cita confirmada" },
      { id: "appointment.cancelled", label: "Cita cancelada (paciente)" },
      { id: "appointment.cancelled_by_doctor", label: "Cita cancelada por doctor" },
      { id: "appointment.auto_cancelled", label: "Cita auto-cancelada" },
      { id: "appointment.rescheduled", label: "Cita reagendada" },
      { id: "appointment.completed", label: "Cita completada" },
      { id: "appointment.reminder_48h", label: "Recordatorio 48h" },
      { id: "appointment.reminder_day_of", label: "Recordatorio día de cita" },
      { id: "appointment.status_changed", label: "Cambio de estado" },
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
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    end_at: "2026-03-15T10:30:00-06:00",
    symptoms: "Dolor de cabeza",
    manage_url: "https://app.example.com/gestionar?token=abc123",
  },
  "appointment.confirmed": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    confirmed_at: "2026-03-13T08:30:00-06:00",
  },
  "appointment.cancelled": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    cancel_reason: "patient",
  },
  "appointment.cancelled_by_doctor": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    cancel_reason: "doctor",
    message: "Tu cita fue cancelada por el doctor",
    reschedule_url: "https://app.example.com/gestionar?token=xyz789",
  },
  "appointment.auto_cancelled": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    cancel_reason: "no_confirmation",
    message: "Tu cita fue cancelada automáticamente porque no fue confirmada a tiempo",
    reschedule_url: "https://app.example.com/gestionar?token=xyz789",
  },
  "appointment.rescheduled": {
    appointment_id: "uuid-new-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    new_start_at: "2026-03-20T11:00:00-06:00",
    old_start_at: "2026-03-15T10:00:00-06:00",
    manage_url: "https://app.example.com/gestionar?token=abc123",
  },
  "appointment.completed": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    completed_at: "2026-03-15T10:35:00-06:00",
    doctor_notes: "Paciente presenta mejoría. Seguimiento en 2 semanas.",
  },
  "appointment.reminder_48h": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    manage_url: "https://app.example.com/gestionar?token=abc123",
    message: "Tu cita es en 48 horas. Puedes confirmar, cancelar o reagendar desde el link.",
  },
  "appointment.reminder_day_of": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    doctor_name: "Dr. Juan Pérez",
    start_at: "2026-03-15T10:00:00-06:00",
    manage_url: "https://app.example.com/gestionar?token=abc123",
    message: "Tu cita es hoy. Si necesitas reagendar o cancelar, usa el siguiente enlace.",
  },
  "appointment.status_changed": {
    appointment_id: "uuid-example",
    patient_name: "Karla Gamez",
    patient_phone: "+521234567890",
    previous_status: "scheduled",
    new_status: "confirmed",
    start_at: "2026-03-15T10:00:00-06:00",
    timestamp: "2026-03-13T08:30:00.000Z",
  },
  "patient.created": {
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
    destination_type: "hospital",
    destination: {
      name: "Hospital General",
      phone: "+525555555555",
      email: "contacto@hospital.com",
      city: "CDMX",
      zone: "Centro",
    },
    observations: "Paciente requiere cirugía.",
    hospitalization: "Hospital General, cirugía programada, urgente",
  },
};

function generateSecret(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function Webhooks() {
  return (
    <PasswordGate>
      <WebhooksContent />
    </PasswordGate>
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
    <div className="space-y-3">
      {EVENT_GROUPS.map((group) => {
        const groupEventIds = group.events.map((e) => e.id);
        const allSelected = groupEventIds.every((e) => selectedEvents.includes(e));
        return (
          <div key={group.label} className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={() => onToggleGroup(groupEventIds)}
              />
              <span className="text-sm font-medium text-muted-foreground">{group.label}</span>
            </div>
            <div className="ml-6 space-y-1.5">
              {group.events.map((ev) => (
                <div key={ev.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedEvents.includes(ev.id)}
                    onCheckedChange={() => onToggleEvent(ev.id)}
                  />
                  <span className="text-sm">{ev.label}</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">{ev.id}</Badge>
                </div>
              ))}
            </div>
          </div>
        );
      })}
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
    <div className="border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium bg-muted/50 hover:bg-muted transition-colors"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {label}
          <Badge variant="outline" className="text-[10px]">{eventId}</Badge>
          {override && <Badge variant="secondary" className="text-[10px]">Personalizado</Badge>}
        </span>
      </button>
      {open && (
        <div className="relative">
          {editing ? (
            <div className="p-3 space-y-2">
              <textarea
                className="w-full text-[11px] bg-background border rounded p-2 font-mono leading-relaxed min-h-[200px] resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
              {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={cancelEditing}>Cancelar</Button>
                <Button size="sm" onClick={saveEditing}>Guardar</Button>
              </div>
            </div>
          ) : (
            <>
              <pre className="text-[11px] bg-muted p-3 overflow-x-auto leading-relaxed">{json}</pre>
              <div className="absolute top-2 right-2 flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Editar payload"
                  onClick={startEditing}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    navigator.clipboard.writeText(json);
                    toast({ title: "Copiado al portapapeles" });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function WebhooksContent() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [selectedWebhook, setSelectedWebhook] = useState<any | null>(null);
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

  const openEdit = (wh: any) => {
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
      } as any);
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
        } as any)
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
        .update({ secret: newSecret } as any)
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
        .update({ is_active } as any)
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

  // Find labels for subscribed events
  const allEventMap = EVENT_GROUPS.flatMap((g) => g.events).reduce<Record<string, string>>(
    (acc, ev) => ({ ...acc, [ev.id]: ev.label }),
    {}
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Webhook className="h-6 w-6" />
            Webhooks
          </h1>
          <p className="text-sm text-muted-foreground">
            Configura webhooks para integrar con n8n y otros servicios.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Crear Webhook
        </Button>
      </div>

      {/* Webhook list */}
      {webhooks && webhooks.length > 0 ? (
        <div className="space-y-3">
          {webhooks.map((wh: any) => (
            <Card key={wh.id}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{wh.name}</p>
                    <Switch
                      checked={wh.is_active}
                      onCheckedChange={(checked) =>
                        toggleMut.mutate({ id: wh.id, is_active: checked })
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{wh.url}</p>
                  <div className="flex flex-wrap gap-1">
                    {(wh.events as string[]).map((ev) => (
                      <Badge key={ev} variant="secondary" className="text-[10px]">
                        {ev}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEdit(wh)}
                    title="Ver/Editar webhook"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar webhook?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta acción no se puede deshacer.
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
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Webhook className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-lg font-medium text-muted-foreground">Sin webhooks</p>
            <p className="text-sm text-muted-foreground/70">
              Crea un webhook para recibir eventos en tiempo real.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) resetForm(); setCreateOpen(open); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear Webhook</DialogTitle>
            <DialogDescription>Configura un nuevo webhook para recibir eventos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nombre *</label>
              <Input placeholder="Ej: n8n Producción" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">URL *</label>
              <Input placeholder="https://n8n.example.com/webhook/..." value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descripción</label>
              <Textarea placeholder="Descripción opcional..." value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium">Eventos *</label>
              <EventChecklist selectedEvents={selectedEvents} onToggleEvent={toggleEvent} onToggleGroup={toggleGroup} />
            </div>
            <div className="flex items-start gap-2 rounded-md border p-3 text-xs text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Se generará un secret para verificar firmas HMAC. Los webhooks incluyen el header{" "}
                <code className="bg-muted px-1 rounded">X-FindMed-Signature</code>.
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { resetForm(); setCreateOpen(false); }}>Cancelar</Button>
              <Button
                onClick={() => createMut.mutate()}
                disabled={!name.trim() || !url.trim() || selectedEvents.length === 0 || createMut.isPending}
              >
                {createMut.isPending ? "Creando…" : "Crear Webhook"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!selectedWebhook} onOpenChange={(open) => { if (!open) setSelectedWebhook(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedWebhook?.name}</DialogTitle>
            <DialogDescription>
              Creado el {selectedWebhook ? format(new Date(selectedWebhook.created_at), "d 'de' MMMM yyyy", { locale: es }) : ""}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={editTab} onValueChange={setEditTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="config">Configuración</TabsTrigger>
              <TabsTrigger value="payload">Payload de ejemplo</TabsTrigger>
            </TabsList>

            <TabsContent value="config" className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nombre *</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">URL *</label>
                <Input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Descripción</label>
                <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={2} />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={editActive} onCheckedChange={setEditActive} />
                <span className="text-sm">{editActive ? "Activo" : "Inactivo"}</span>
              </div>
              <div className="space-y-3">
                <label className="text-sm font-medium">Eventos *</label>
                <EventChecklist selectedEvents={editEvents} onToggleEvent={toggleEditEvent} onToggleGroup={toggleEditGroup} />
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-muted-foreground"
                  onClick={() => setRegenerateOpen(true)}
                >
                  <RefreshCw className="h-4 w-4" />
                  Regenerar secret
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setSelectedWebhook(null)}>Cancelar</Button>
                  <Button
                    onClick={() => updateMut.mutate()}
                    disabled={!editName.trim() || !editUrl.trim() || editEvents.length === 0 || updateMut.isPending}
                  >
                    {updateMut.isPending ? "Guardando…" : "Guardar cambios"}
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="payload" className="space-y-4 pt-2">
              {/* HTTP Headers */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Headers HTTP enviados</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {[
                    "Content-Type: application/json",
                    "X-FindMed-Signature: <hmac-sha256 del body>",
                    "X-FindMed-Event: <event_type>",
                  ].map((h) => (
                    <code key={h} className="block text-xs bg-muted px-2 py-1 rounded">{h}</code>
                  ))}
                </CardContent>
              </Card>

              {/* Payload examples */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Ejemplos por evento suscrito</p>
                {editEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay eventos seleccionados.</p>
                ) : (
                  editEvents.map((ev) => (
                    <PayloadBlock
                      key={ev}
                      eventId={ev}
                      label={allEventMap[ev] ?? ev}
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
                          .update({ payload_overrides: newOverrides } as any)
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Secret del Webhook</DialogTitle>
            <DialogDescription>Copia este secret ahora. No se volverá a mostrar.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted p-2 rounded text-sm break-all">{revealedSecret}</code>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(revealedSecret ?? "");
                toast({ title: "Copiado al portapapeles" });
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
