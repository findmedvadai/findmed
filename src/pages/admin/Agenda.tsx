// Módulo Agenda: el calendario y la lista de citas son dos vistas de lo mismo.
import { useSearchParams } from "react-router-dom";
import { CalendarDays, List } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Calendario from "./Calendario";
import Reservas from "./Reservas";

export default function Agenda() {
  const [params, setParams] = useSearchParams();
  const view = params.get("vista") === "lista" ? "lista" : "calendario";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agenda"
        description="Citas de todos los doctores: en calendario o en lista con filtros."
        actions={
          <Tabs value={view} onValueChange={(v) => setParams(v === "lista" ? { vista: "lista" } : {}, { replace: true })}>
            <TabsList className="h-9">
              <TabsTrigger value="calendario" className="gap-1.5 text-sm">
                <CalendarDays className="h-4 w-4" /> Calendario
              </TabsTrigger>
              <TabsTrigger value="lista" className="gap-1.5 text-sm">
                <List className="h-4 w-4" /> Lista
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      {view === "lista" ? <Reservas embedded /> : <Calendario embedded />}
    </div>
  );
}
