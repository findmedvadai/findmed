import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Plus, Trash2, Copy, Webhook, Info } from "lucide-react";
import PasswordGate from "@/components/admin/PasswordGate";

const EVENT_GROUPS = [
  {
    label: "Citas",
    events: [
      { id: "appointment.created", label: "Cita creada" },
      { id: "appointment.confirmed", label: "Cita confirmada" },
      { id: "appointment.cancelled", label: "Cita cancelada" },
      { id: "appointment.rescheduled", label: "Cita reagendada" },
      { id: "appointment.completed", label: "Cita completada" },
    ],
  },
  {
    label: "Pacientes",
    events: [
      { id: "patient.created", label: "Paciente creado" },
    ],
  },
];

const ALL_EVENTS = EVENT_GROUPS.flatMap((g) => g.events.map((e) => e.id));

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

function WebhooksContent() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

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
    setName("");
    setUrl("");
    setDescription("");
    setSelectedEvents([]);
  };

  const toggleEvent = (eventId: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId]
    );
  };

  const toggleGroup = (groupEvents: string[]) => {
    const allSelected = groupEvents.every((e) => selectedEvents.includes(e));
    if (allSelected) {
      setSelectedEvents((prev) => prev.filter((e) => !groupEvents.includes(e)));
    } else {
      setSelectedEvents((prev) => [...new Set([...prev, ...groupEvents])]);
    }
  };

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
            <DialogDescription>
              Configura un nuevo webhook para recibir eventos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nombre *</label>
              <Input
                placeholder="Ej: n8n Producción"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">URL *</label>
              <Input
                placeholder="https://n8n.example.com/webhook/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descripción</label>
              <Textarea
                placeholder="Descripción opcional..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium">Eventos *</label>
              {EVENT_GROUPS.map((group) => {
                const groupEventIds = group.events.map((e) => e.id);
                const allSelected = groupEventIds.every((e) => selectedEvents.includes(e));
                return (
                  <div key={group.label} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={() => toggleGroup(groupEventIds)}
                      />
                      <span className="text-sm font-medium text-muted-foreground">
                        {group.label}
                      </span>
                    </div>
                    <div className="ml-6 space-y-1.5">
                      {group.events.map((ev) => (
                        <div key={ev.id} className="flex items-center gap-2">
                          <Checkbox
                            checked={selectedEvents.includes(ev.id)}
                            onCheckedChange={() => toggleEvent(ev.id)}
                          />
                          <span className="text-sm">{ev.label}</span>
                          <Badge variant="outline" className="text-[10px] ml-auto">
                            {ev.id}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-start gap-2 rounded-md border p-3 text-xs text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Se generará un secret para verificar firmas HMAC. Los webhooks incluyen el header{" "}
                <code className="bg-muted px-1 rounded">X-FindMed-Signature</code>.
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { resetForm(); setCreateOpen(false); }}>
                Cancelar
              </Button>
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

      {/* Secret reveal dialog */}
      <Dialog open={!!revealedSecret} onOpenChange={() => setRevealedSecret(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Secret del Webhook</DialogTitle>
            <DialogDescription>
              Copia este secret ahora. No se volverá a mostrar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted p-2 rounded text-sm break-all">
              {revealedSecret}
            </code>
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
