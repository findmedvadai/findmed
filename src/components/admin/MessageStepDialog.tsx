// Edita un mensaje de un evento: plantilla de WHAAPY, qué dato va en cada
// variable y qué llevan sus botones. La validación final contra la plantilla
// la hace la Edge Function messaging-admin (save_step).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PARAM_LABEL, STATUS_LABEL } from "@/lib/messaging-labels";

export interface CatalogTemplate {
  name: string;
  category: string;
  language: string;
  status: string;
  body: string;
  body_variables: number;
  buttons: { type: string; text: string; url?: string; button_id?: string }[];
}

export interface StepDraft {
  id?: string;
  event_type: string;
  when_status: string | null;
  when_cancel_reason: string | null;
  position: number;
  template_name: string;
  language: string;
  body_params: string[];
  url_button_param: string | null;
  quick_reply_action: string | null;
  enabled: boolean;
}

const NONE = "__none__";

export default function MessageStepDialog({
  open,
  draft,
  templates,
  saving,
  onCancel,
  onSave,
}: {
  open: boolean;
  draft: StepDraft | null;
  templates: CatalogTemplate[];
  saving: boolean;
  onCancel: () => void;
  onSave: (step: StepDraft) => void;
}) {
  const [step, setStep] = useState<StepDraft | null>(draft);
  const [loadedFor, setLoadedFor] = useState<StepDraft | null>(draft);
  // Reiniciar el formulario cuando se abre con otro mensaje.
  if (draft !== loadedFor) {
    setLoadedFor(draft);
    setStep(draft);
  }
  if (!step) return null;

  const template = templates.find((t) => t.name === step.template_name);
  const hasUrlButton = !!template?.buttons.some((b) => b.type === "URL" && (b.url ?? "").includes("{{"));
  const hasQuickReply = !!template?.buttons.some((b) => b.type === "QUICK_REPLY");
  const isStatusEvent = step.event_type === "appointment.status_changed";

  const pickTemplate = (name: string) => {
    const t = templates.find((x) => x.name === name);
    setStep({
      ...step,
      template_name: name,
      language: t?.language ?? step.language,
      body_params: Array.from({ length: t?.body_variables ?? 0 }, (_, i) => step.body_params[i] ?? ""),
      url_button_param: t?.buttons.some((b) => b.type === "URL" && (b.url ?? "").includes("{{")) ? "manage_token" : null,
      quick_reply_action: t?.buttons.some((b) => b.type === "QUICK_REPLY") ? step.quick_reply_action : null,
    });
  };

  const complete = !!template && step.body_params.every(Boolean);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{step.id ? "Editar mensaje" : "Nuevo mensaje"}</DialogTitle>
          <DialogDescription>Plantilla aprobada de WhatsApp y los datos que llena FindMed.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {isStatusEvent && (
            <div className="space-y-1">
              <Label>Cuando la cita pasa a</Label>
              <Select value={step.when_status ?? undefined} onValueChange={(v) => setStep({ ...step, when_status: v })}>
                <SelectTrigger><SelectValue placeholder="Elige un estado" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              {step.when_status === "cancelled" && (
                <Select
                  value={step.when_cancel_reason ?? NONE}
                  onValueChange={(v) => setStep({ ...step, when_cancel_reason: v === NONE ? null : v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Cualquier cancelación</SelectItem>
                    <SelectItem value="patient">Solo si canceló el paciente</SelectItem>
                    <SelectItem value="doctor">Solo si canceló el médico</SelectItem>
                    <SelectItem value="admin">Solo si canceló administración</SelectItem>
                    <SelectItem value="no_confirmation">Solo por falta de confirmación</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="step-position">Orden</Label>
            <Input
              id="step-position"
              type="number"
              min={1}
              max={20}
              value={step.position}
              onChange={(e) => setStep({ ...step, position: Number(e.target.value) })}
            />
          </div>

          <div className="space-y-1">
            <Label>Plantilla</Label>
            <Select value={step.template_name || undefined} onValueChange={pickTemplate}>
              <SelectTrigger><SelectValue placeholder="Elige una plantilla" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={`${t.name}-${t.language}`} value={t.name} disabled={t.status.toUpperCase() !== "APPROVED"}>
                    {t.name} {t.status.toUpperCase() !== "APPROVED" ? `(${t.status})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {template && <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-muted-foreground">{template.body}</p>}
            {step.template_name && !template && (
              <p className="text-destructive">Esta plantilla ya no existe en WHAAPY.</p>
            )}
          </div>

          {step.body_params.map((value, i) => (
            <div key={i} className="space-y-1">
              <Label>Variable {`{{${i + 1}}}`}</Label>
              <Select
                value={value || undefined}
                onValueChange={(v) => {
                  const next = [...step.body_params];
                  next[i] = v;
                  setStep({ ...step, body_params: next });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Elige el dato" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PARAM_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}

          {hasUrlButton && (
            <p className="text-muted-foreground">El botón de enlace lleva el link seguro de /gestionar de la cita.</p>
          )}
          {hasQuickReply && (
            <div className="space-y-1">
              <Label>Botón de respuesta rápida</Label>
              <Select
                value={step.quick_reply_action ?? NONE}
                onValueChange={(v) => setStep({ ...step, quick_reply_action: v === NONE ? null : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin acción (lo atiende el agente)</SelectItem>
                  <SelectItem value="confirm">Confirma la cita</SelectItem>
                  <SelectItem value="cancel">Cancela la cita</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <label className="flex items-center gap-2">
            <Switch checked={step.enabled} onCheckedChange={(v) => setStep({ ...step, enabled: v })} />
            Activo
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button disabled={saving || !complete || (isStatusEvent && !step.when_status)} onClick={() => onSave(step)}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
