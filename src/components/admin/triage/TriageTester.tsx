// "Probar triaje": manda palabras clave al motor real (suggestSpecialty de
// _shared/triage.ts, vía triage-admin) y muestra lo mismo que recibe el agente,
// más el nombre interno de cada condición. Sin copia del motor en el navegador.
import { useId, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FlaskConical, Lightbulb, Play, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SoftBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { cn } from "@/lib/utils";
import {
  LIGHT,
  ROUTING,
  keywordLabel,
  suggestKeywords,
  triageAdmin,
  type EngineCandidate,
  type TriageTestResponse,
  type TriageVocabulary,
} from "@/lib/triage-admin";
import { KeywordPicker } from "./KeywordPicker";

export function TriageTester({ vocabulary }: { vocabulary: TriageVocabulary | undefined }) {
  const fid = useId();
  const [text, setText] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const allTerms = useMemo(() => Object.values(vocabulary?.keywords ?? {}).flat(), [vocabulary]);
  const suggestions = useMemo(() => suggestKeywords(text, allTerms).filter((k) => !keywords.includes(k)), [text, allTerms, keywords]);

  const run = useMutation({
    mutationFn: () => triageAdmin<TriageTestResponse>({ action: "test", keywords }),
  });
  const names = new Map((run.data?.conditions ?? []).map((c) => [c.id, c]));
  const res = run.data?.result;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card className="space-y-4 p-4">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold text-foreground">Probar triaje</h2>
          <p className="text-xs text-muted-foreground">
            Elige las palabras clave como las elegiría el agente y mira qué responde el motor con el catálogo actual (solo las
            condiciones activas).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-text`}>Síntomas en palabras del paciente (opcional)</Label>
          <Textarea id={`${fid}-text`} rows={2} className="text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Me duele la rodilla desde que me caí" />
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lightbulb className="h-3.5 w-3.5" /> Términos sugeridos:</span>
              {suggestions.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKeywords((v) => [...v, k])}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs text-foreground hover:bg-accent"
                >
                  <Plus className="h-3 w-3" /> {keywordLabel(k)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-kw`}>Palabras clave que recibe el motor</Label>
          <KeywordPicker id={`${fid}-kw`} vocabulary={vocabulary} value={keywords} onChange={setKeywords} emptyText="Elige al menos una." />
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => run.mutate()} disabled={keywords.length === 0 || run.isPending}>
            <Play className="h-3.5 w-3.5" /> {run.isPending ? "Probando…" : "Probar"}
          </Button>
          {(keywords.length > 0 || text) && (
            <Button size="sm" variant="ghost" onClick={() => { setKeywords([]); setText(""); run.reset(); }}>Limpiar</Button>
          )}
        </div>
      </Card>

      <Card className="p-4">
        {run.isError ? (
          <p className="text-sm text-destructive">{(run.error as Error).message}</p>
        ) : !res ? (
          <EmptyState icon={FlaskConical} title="Sin prueba todavía" description="El resultado aparece aquí: especialidad, primera parada, puntaje, empates y la pregunta que desempata." className="border-0" />
        ) : res.result === "none" ? (
          <div className="space-y-2">
            <SoftBadge tone="warning">Sin coincidencias</SoftBadge>
            <p className="text-sm text-muted-foreground">
              Ninguna condición activa coincide, ni ampliando la búsqueda ({res.keywords_used.map(keywordLabel).join(", ")}). El agente
              pediría más detalles o pasaría a una persona.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {res.result === "tie" ? <SoftBadge tone="warning">Empate: el agente hace la pregunta diferencial</SoftBadge> : <SoftBadge tone="success">Una recomendación</SoftBadge>}
              {res.broadened && <SoftBadge tone="info">Búsqueda ampliada</SoftBadge>}
              <span className="text-xs text-muted-foreground">Términos usados: {res.keywords_used.map(keywordLabel).join(", ")}</span>
            </div>
            <CandidateCard title="Mejor resultado" c={res.best} name={names.get(res.best.catalog_id ?? -1)} highlight />
            {res.candidates.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{res.result === "tie" ? "Empatadas con el mejor resultado" : "Siguientes candidatas"}</p>
                {res.candidates.map((c, i) => (
                  <CandidateCard key={`${c.catalog_id}-${i}`} c={c} name={names.get(c.catalog_id ?? -1)} />
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function CandidateCard({ c, name, title, highlight }: { c: EngineCandidate; name?: { padecimiento: string | null; validado: boolean }; title?: string; highlight?: boolean }) {
  const route = ROUTING[c.routing];
  const light = LIGHT[c.semaforo ?? ""];
  return (
    <div className={cn("space-y-2 rounded-md border p-3", highlight && "border-primary/30 bg-primary/5")}>
      {title && <p className="text-xs font-medium text-muted-foreground">{title}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{c.patient_label}</span>
        {route && <SoftBadge tone={route.tone}>{route.label}</SoftBadge>}
        {light && <SoftBadge tone={light.tone} dot>{light.label}</SoftBadge>}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">Puntaje {c.score}</span>
      </div>
      <dl className="grid gap-1 text-xs sm:grid-cols-[140px_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Condición (interna)</dt>
        <dd className="text-foreground">
          {name?.padecimiento ?? `#${c.catalog_id}`} {name && !name.validado && <span className="text-warning">· sin validar</span>}
        </dd>
        <dt className="text-muted-foreground">Busca en FindMed</dt>
        <dd className="text-foreground">{c.search_specialties.length ? c.search_specialties.join(", ") : "Nada: pasa a una persona"}</dd>
        {c.alarm_signals && (
          <>
            <dt className="text-muted-foreground">Señales de alarma</dt>
            <dd className="text-foreground">{c.alarm_signals}</dd>
          </>
        )}
        {c.pregunta_diferencial && (
          <>
            <dt className="text-muted-foreground">Pregunta diferencial</dt>
            <dd className="text-foreground">{c.pregunta_diferencial}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
