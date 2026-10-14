// Edita un mensaje de un evento: plantilla de WHAAPY, qué dato va en cada
// variable y qué llevan sus botones. La validación final contra la plantilla
// la hace la Edge Function messaging-admin (save_step).
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SoftBadge } from "@/components/app/StatusBadge";
import { PARAM_LABEL, STATUS_LABEL } from "@/lib/messaging-labels";
import { AlertTriangle, Link2, MessageSquare, Reply } from "lucide-react";

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
  /** Solo en la reserva original: no se envía cuando la cita se reagenda. */
  skip_on_reschedule?: boolean;
}

const NONE = "__none__";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Texto de la plantilla con cada {{n}} resaltado y el dato que lo llena. */
function TemplateBody({ body, params }: { body: string; params: string[] }) {
  const parts = body.split(/(\{\{\d+\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{\{(\d+)\}\}$/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        const param = params[Number(m[1]) - 1];
        return (
          <span key={i} className="rounded bg-primary/10 px-1 font-medium text-primary">
            {param ? PARAM_LABEL[param] ?? param : part}
          </span>
        );
      })}
    </>
  );
}

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
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1 border-b p-4 pr-12 text-left">
          <DialogTitle className="text-base font-semibold">{step.id ? "Editar mensaje" : "Nuevo mensaje"}</DialogTitle>
          <DialogDescription className="text-xs">Plantilla aprobada de WhatsApp y los datos que llena FindMed.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 text-sm">
          {isStatusEvent && (
            <Section title="Cuándo se envía">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Cuando la cita pasa a</Label>
                  <Select value={step.when_status ?? undefined} onValueChange={(v) => setStep({ ...step, when_status: v })}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Elige un estado" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {step.when_status === "cancelled" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Motivo de cancelación</Label>
                    <Select
                      value={step.when_cancel_reason ?? NONE}
                      onValueChange={(v) => setStep({ ...step, when_cancel_reason: v === NONE ? null : v })}
                    >
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Cualquier cancelación</SelectItem>
                        <SelectItem value="patient">Solo si canceló el paciente</SelectItem>
                        <SelectItem value="doctor">Solo si canceló el médico</SelectItem>
                        <SelectItem value="admin">Solo si canceló administración</SelectItem>
                        <SelectItem value="no_confirmation">Solo por falta de confirmación</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </Section>
          )}

          <Section title="Plantilla" description="Solo se pueden elegir plantillas aprobadas por Meta.">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_96px]">
              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs font-medium">Plantilla</Label>
                <Select value={step.template_name || undefined} onValueChange={pickTemplate}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Elige una plantilla" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={`${t.name}-${t.language}`} value={t.name} disabled={t.status.toUpperCase() !== "APPROVED"}>
                        {t.name} {t.status.toUpperCase() !== "APPROVED" ? `(${t.status})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="step-position" className="text-xs font-medium">Orden</Label>
                <Input
                  id="step-position"
                  type="number"
                  min={1}
                  max={20}
                  className="h-9 text-sm"
                  value={step.position}
                  onChange={(e) => setStep({ ...step, position: Number(e.target.value) })}
                />
              </div>
            </div>

            {template && (
              <div className="overflow-hidden rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <MessageSquare className="h-3.5 w-3.5" /> Vista previa
                  </span>
                  <div className="flex items-center gap-1">
                    <SoftBadge tone="neutral">{template.category === "UTILITY" ? "Utilidad" : template.category === "MARKETING" ? "Marketing" : template.category}</SoftBadge>
                    <SoftBadge tone="neutral">{template.language}</SoftBadge>
                  </div>
                </div>
                <div className="p-3">
                  <div className="rounded-lg rounded-tl-none border bg-background px-3 py-2 text-sm leading-relaxed text-foreground shadow-sm">
                    <p className="whitespace-pre-wrap"><TemplateBody body={template.body} params={step.body_params} /></p>
                  </div>
                  {template.buttons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {template.buttons.map((b, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium text-primary">
                          {b.type === "URL" ? <Link2 className="h-3 w-3" /> : b.type === "QUICK_REPLY" ? <Reply className="h-3 w-3" /> : null}
                          {b.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {step.template_name && !template && (
              <p className="flex items-start gap-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                Esta plantilla ya no existe en WHAAPY.
              </p>
            )}
          </Section>

          {step.body_params.length > 0 && (
            <Section title="Variables" description="Qué dato de la cita llena cada espacio de la plantilla.">
              <div className="grid gap-3 sm:grid-cols-2">
                {step.body_params.map((value, i) => (
                  <div key={i} className="space-y-1.5">
                    <Label className="text-xs font-medium">
                      Variable <span className="font-mono">{`{{${i + 1}}}`}</span>
                    </Label>
                    <Select
                      value={value || undefined}
                      onValueChange={(v) => {
                        const next = [...step.body_params];
                        next[i] = v;
                        setStep({ ...step, body_params: next });
                      }}
                    >
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Elige el dato" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(PARAM_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {(hasUrlButton || hasQuickReply) && (
            <Section title="Botones">
              {hasUrlButton && (
                <p className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  <Link2 className="mt-px h-3.5 w-3.5 shrink-0" />
                  El botón de enlace lleva el link seguro de /gestionar de la cita.
                </p>
              )}
              {hasQuickReply && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Botón de respuesta rápida</Label>
                  <Select
                    value={step.quick_reply_action ?? NONE}
                    onValueChange={(v) => setStep({ ...step, quick_reply_action: v === NONE ? null : v })}
                  >
                    <SelectTrigger className="h-9 text-sm sm:w-[280px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin acción (lo atiende el agente)</SelectItem>
                      <SelectItem value="confirm">Confirma la cita</SelectItem>
                      <SelectItem value="cancel">Cancela la cita</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </Section>
          )}

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <span>
              <span className="block text-sm font-medium text-foreground">Activo</span>
              <span className="block text-xs text-muted-foreground">Si lo apagas, el mensaje se guarda pero no se envía.</span>
            </span>
            <Switch checked={step.enabled} onCheckedChange={(v) => setStep({ ...step, enabled: v })} />
          </label>

          {isStatusEvent && (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium text-foreground">No enviar al reagendar</span>
                <span className="block text-xs text-muted-foreground">
                  Solo se manda con la reserva original. Si el paciente, el médico o FindMed cambian la cita de horario, este mensaje no se repite.
                </span>
              </span>
              <Switch
                checked={step.skip_on_reschedule === true}
                onCheckedChange={(v) => setStep({ ...step, skip_on_reschedule: v })}
              />
            </label>
          )}
        </div>

        <DialogFooter className="gap-2 border-t bg-muted/30 px-4 py-3 sm:space-x-0">
          <Button size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button size="sm" disabled={saving || !complete || (isStatusEvent && !step.when_status)} onClick={() => onSave(step)}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
