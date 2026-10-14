// Configuración → Catálogos → Triaje (?catalogo=triaje&vista=…): el catálogo
// con el que el agente de WhatsApp orienta por síntomas (suggest_specialty).
// Vistas: Condiciones, Mapeo de especialidades y Probar triaje. Los cambios se
// guardan vía triage-admin y aplican al agente en su siguiente consulta (el
// motor lee la base en cada llamada, sin caché).
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConditionsView } from "./ConditionsView";
import { SpecialtyMapView } from "./SpecialtyMapView";
import { TriageTester } from "./TriageTester";
import { useTriageConditions, useTriageMap, useTriageVocabulary } from "./queries";

const VIEWS = [
  { value: "condiciones", label: "Condiciones" },
  { value: "mapeo", label: "Mapeo de especialidades" },
  { value: "probar", label: "Probar triaje" },
] as const;

export function TriageCatalogTab() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("vista");
  const view = VIEWS.some((v) => v.value === requested) ? (requested as string) : VIEWS[0].value;
  const conditions = useTriageConditions();
  const mappings = useTriageMap();
  const vocabulary = useTriageVocabulary();

  const onView = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === VIEWS[0].value) next.delete("vista");
    else next.set("vista", v);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      {(conditions.error || mappings.error || vocabulary.error) && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          No se pudo leer el catálogo de triaje: {((conditions.error || mappings.error || vocabulary.error) as Error).message}
        </p>
      )}
      <Tabs value={view} onValueChange={onView}>
        <TabsList className="h-auto flex-wrap">
          {VIEWS.map((v) => <TabsTrigger key={v.value} value={v.value} className="text-sm">{v.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="condiciones" className="mt-4">
          <ConditionsView conditions={conditions.data} loading={conditions.isLoading} mappings={mappings.data ?? []} vocabulary={vocabulary.data} />
        </TabsContent>
        <TabsContent value="mapeo" className="mt-4">
          <SpecialtyMapView mappings={mappings.data} loading={mappings.isLoading} conditions={conditions.data ?? []} />
        </TabsContent>
        <TabsContent value="probar" className="mt-4">
          <TriageTester vocabulary={vocabulary.data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
