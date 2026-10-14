// Panel lateral para crear o editar una condición del catálogo de triaje, con
// su historial de cambios. Guarda vía triage-admin (valida contra el
// vocabulario del motor y registra el cambio).
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { es } from "date-fns/locale";
import { History, ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatMx } from "@/lib/timezone";
import {
  CHANGE_ACTION_LABEL,
  FIELD_LABEL,
  LIGHT,
  ORIGEN_LABEL,
  ROUTING,
  changedFields,
  emptyConditionForm,
  formFromCondition,
  formProblems,
  formToPayload,
  triageAdmin,
  TriageAdminError,
  type ConditionForm,
  type TriageCondition,
  type TriageMapping,
  type TriageVocabulary,
} from "@/lib/triage-admin";
import { KeywordPicker } from "./KeywordPicker";
import { invalidateTriage, useConditionHistory } from "./queries";

interface ConditionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = condición nueva. */
  condition: TriageCondition | null;
  mappings: TriageMapping[];
  vocabulary: TriageVocabulary | undefined;
  onSaved?: (c: TriageCondition) => void;
}

const fmtDate = (iso: string | null) => (iso ? formatMx(new Date(iso), "d MMM yyyy, HH:mm", { locale: es }) : "");

export function ConditionSheet({ open, onOpenChange, condition, mappings, vocabulary, onSaved }: ConditionSheetProps) {
  const qc = useQueryClient();
  const fid = useId();
  // El padre monta el panel con una `key` nueva cada vez que lo abre y le pasa
  // la condición tal como estaba al abrir: el formulario no se reinicia si la
  // lista se refresca, y expected_updated_at detecta si otra persona la cambió.
  const [form, setForm] = useState<ConditionForm>(() => (condition ? formFromCondition(condition) : emptyConditionForm()));
  const [tried, setTried] = useState(false);
  const [serverProblems, setServerProblems] = useState<string[]>([]);

  const set = <K extends keyof ConditionForm>(k: K, v: ConditionForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const problems = formProblems(form);
  const isEdit = !!condition;
  const dirty = !condition || JSON.stringify(formFromCondition(condition)) !== JSON.stringify(form);

  const save = useMutation({
    mutationFn: () =>
      triageAdmin<{ condition: TriageCondition; warnings: string[]; unchanged?: boolean }>(
        isEdit
          ? { action: "condition_update", id: condition!.id, expected_updated_at: condition!.updated_at, condition: formToPayload(form) }
          : { action: "condition_create", condition: formToPayload(form) },
      ),
    onSuccess: (res) => {
      invalidateTriage(qc);
      toast({
        title: isEdit ? "Condición actualizada" : "Condición creada",
        description: res.warnings?.length ? res.warnings.join(" ") : "El agente ya usa esta versión.",
      });
      onSaved?.(res.condition);
      onOpenChange(false);
    },
    onError: (e: Error) => {
      if (e instanceof TriageAdminError && e.problems.length) setServerProblems(e.problems);
      if (e instanceof TriageAdminError && e.code === "concurrent_change") invalidateTriage(qc);
      toast({ title: "No se guardó", description: e.message, variant: "destructive" });
    },
  });

  const submit = () => {
    setTried(true);
    setServerProblems([]);
    if (problems.length === 0) save.mutate();
  };

  const showProblems = tried ? [...problems, ...serverProblems] : serverProblems;
  const mappingKeys = mappings.map((m) => m.especialidad);
  const unmapped = form.especialidad && !mappingKeys.includes(form.especialidad);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b p-4 pr-10 text-left">
          <SheetTitle>{isEdit ? "Editar condición" : "Nueva condición"}</SheetTitle>
          <SheetDescription>
            Lo que guardes aquí lo usa el agente de WhatsApp desde su siguiente consulta. El nombre del padecimiento es de uso
            interno: el agente nunca lo dice al paciente.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {showProblems.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
              <ul className="list-disc space-y-0.5 pl-4">
                {showProblems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}

          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`${fid}-pad`}>Padecimiento (uso interno) *</Label>
              <Input id={`${fid}-pad`} className="h-9 text-sm" value={form.padecimiento} onChange={(e) => set("padecimiento", e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label>Especialidad *</Label>
              <Select value={form.especialidad || undefined} onValueChange={(v) => set("especialidad", v)}>
                <SelectTrigger className={cn("h-9 text-sm", tried && !form.especialidad && "border-destructive")}>
                  <SelectValue placeholder="Elegir especialidad" />
                </SelectTrigger>
                <SelectContent>
                  {unmapped && <SelectItem value={form.especialidad}>{form.especialidad} (sin mapeo)</SelectItem>}
                  {mappings.map((m) => (
                    <SelectItem key={m.especialidad} value={m.especialidad}>
                      {m.patient_label} · {m.especialidad}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Si falta una, agrégala primero en Mapeo de especialidades.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Origen</Label>
              <Select value={form.origen || "none"} onValueChange={(v) => set("origen", v === "none" ? "" : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin definir</SelectItem>
                  {(vocabulary?.origenes ?? Object.keys(ORIGEN_LABEL)).map((o) => (
                    <SelectItem key={o} value={o}>{ORIGEN_LABEL[o] ?? o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Semáforo *</Label>
              <Select value={form.semaforo || undefined} onValueChange={(v) => set("semaforo", v)}>
                <SelectTrigger className={cn("h-9 text-sm", tried && !form.semaforo && "border-destructive")}>
                  <SelectValue placeholder="Elegir" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LIGHT).map(([k, l]) => <SelectItem key={k} value={k}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Primera parada *</Label>
              <Select value={form.primera_parada || undefined} onValueChange={(v) => set("primera_parada", v)}>
                <SelectTrigger className={cn("h-9 text-sm", tried && !form.primera_parada && "border-destructive")}>
                  <SelectValue placeholder="Elegir" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROUTING).map(([k, r]) => <SelectItem key={k} value={k}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Las rutas de urgencias nunca agendan una consulta.</p>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Palabras clave</h3>
              <p className="text-xs text-muted-foreground">
                Solo términos del vocabulario del motor. Los marcados con ½ (dolor, inflamación…) cuentan la mitad: ayudan, pero no
                deciden solos.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-kw`}>Términos de la condición *</Label>
              <KeywordPicker id={`${fid}-kw`} vocabulary={vocabulary} value={form.keywords} onChange={(v) => set("keywords", v)} invalid={tried && form.keywords.length === 0} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-todos`}>Requiere todos</Label>
                <KeywordPicker id={`${fid}-todos`} vocabulary={vocabulary} value={form.requiere_todos} onChange={(v) => set("requiere_todos", v)} addLabel="Agregar" emptyText="Ninguno." />
                <p className="text-xs text-muted-foreground">Solo es candidata si el paciente menciona todos.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-alguno`}>Requiere alguno</Label>
                <KeywordPicker id={`${fid}-alguno`} vocabulary={vocabulary} value={form.requiere_alguno} onChange={(v) => set("requiere_alguno", v)} addLabel="Agregar" emptyText="Ninguno." />
                <p className="text-xs text-muted-foreground">Y al menos uno de estos (útil para condiciones urgentes).</p>
              </div>
            </div>
          </section>

          <Separator />

          <section className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-alarma`}>Señales de alarma</Label>
              <Textarea id={`${fid}-alarma`} rows={2} className="text-sm" value={form.si_esto_aparece_subir_a_urgencias} onChange={(e) => set("si_esto_aparece_subir_a_urgencias", e.target.value)} placeholder="Si aparece alguna, el agente sube a urgencias." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-dif`}>Pregunta diferencial</Label>
              <Textarea id={`${fid}-dif`} rows={2} className="text-sm" value={form.pregunta_diferencial} onChange={(e) => set("pregunta_diferencial", e.target.value)} placeholder="La pregunta que desempata con otras condiciones." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-accion`}>Acción operativa (uso interno)</Label>
              <Textarea id={`${fid}-accion`} rows={2} className="text-sm" value={form.accion_operativa} onChange={(e) => set("accion_operativa", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-notas`}>Notas del equipo</Label>
              <Textarea id={`${fid}-notas`} rows={2} className="text-sm" value={form.notas} onChange={(e) => set("notas", e.target.value)} />
            </div>
          </section>

          <div className="flex items-start gap-3 rounded-md border p-3">
            <Switch id={`${fid}-val`} checked={form.validado} onCheckedChange={(v) => set("validado", v)} className="mt-0.5" />
            <div className="space-y-0.5">
              <Label htmlFor={`${fid}-val`} className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-success" /> Validada por responsable clínico
              </Label>
              <p className="text-xs text-muted-foreground">
                {condition?.validado && condition.validated_at
                  ? `Validó ${condition.validated_by_email ?? "un administrador"} el ${fmtDate(condition.validated_at)}. `
                  : ""}
                Si guardas cambios clínicos con el interruptor encendido, quedas registrado como quien validó esta versión.
              </p>
            </div>
          </div>

          {isEdit && <ConditionHistory id={condition!.id} />}
        </div>

        <SheetFooter className="gap-2 border-t p-4 sm:gap-0">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button>
          <Button size="sm" onClick={submit} disabled={save.isPending || !dirty}>
            {save.isPending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear condición"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ConditionHistory({ id }: { id: number }) {
  const { data, isLoading, error } = useConditionHistory(id);
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <History className="h-4 w-4 text-muted-foreground" /> Cambios recientes
      </h3>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : error ? (
        <p className="text-xs text-destructive">No se pudo leer el historial.</p>
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin cambios registrados desde el panel. Las condiciones importadas no tienen historial previo.</p>
      ) : (
        <ol className="space-y-2">
          {data.map((c) => {
            const fields = changedFields(c.before, c.after).map((f) => FIELD_LABEL[f] ?? f);
            return (
              <li key={c.id} className="rounded-md border px-3 py-2 text-xs">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium text-foreground">{CHANGE_ACTION_LABEL[c.action] ?? c.action}</span>
                  <span className="text-muted-foreground">{fmtDate(c.created_at)}</span>
                </div>
                <p className="text-muted-foreground">{c.actor_email ?? "Administrador"}</p>
                {c.action === "update" && fields.length > 0 && <p className="text-muted-foreground">Cambió: {fields.join(", ")}.</p>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
