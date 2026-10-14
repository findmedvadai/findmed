import { useId, type KeyboardEvent } from "react";
import { ExternalLink, MapPin, MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SoftBadge } from "@/components/app/StatusBadge";
import { checkCoordinates, hasCoordinates, mapUrl } from "@/lib/geo-coords";
import { cn } from "@/lib/utils";

/**
 * Latitud y longitud aproximadas de una zona o ciudad (diálogo de edición de
 * Catálogos). El agente de WhatsApp las usa para ofrecer los consultorios más
 * cercanos al paciente.
 */
export function CoordinateFields({
  latitude,
  longitude,
  onChange,
  onSubmit,
}: {
  latitude: string;
  longitude: string;
  onChange: (next: { latitude: string; longitude: string }) => void;
  onSubmit?: () => void;
}) {
  const id = useId();
  const check = checkCoordinates(latitude, longitude);
  // (tsconfig sin strictNullChecks no estrecha la unión por `ok`.)
  const error = "message" in check ? check : null;
  const point = "message" in check ? null : check;
  const invalid = (field: "latitude" | "longitude") => !!error && (error.field === field || error.field === "both");
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && check.ok) onSubmit?.();
  };

  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Ubicación aproximada</legend>
      <p className="text-xs text-muted-foreground">
        Centro aproximado de la zona, en grados decimales. Sirve para ofrecer al paciente los consultorios más cercanos.
        Déjalo vacío si no aplica.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-lat`} className="text-sm">Latitud</Label>
          <Input
            id={`${id}-lat`}
            inputMode="decimal"
            placeholder="19.4170"
            className={cn("h-9 text-sm", invalid("latitude") && "border-destructive")}
            aria-invalid={invalid("latitude")}
            aria-describedby={`${id}-msg`}
            value={latitude}
            onChange={(e) => onChange({ latitude: e.target.value, longitude })}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-lon`} className="text-sm">Longitud</Label>
          <Input
            id={`${id}-lon`}
            inputMode="decimal"
            placeholder="-99.1600"
            className={cn("h-9 text-sm", invalid("longitude") && "border-destructive")}
            aria-invalid={invalid("longitude")}
            aria-describedby={`${id}-msg`}
            value={longitude}
            onChange={(e) => onChange({ latitude, longitude: e.target.value })}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
      <div id={`${id}-msg`} className="min-h-[1rem] text-xs" aria-live="polite">
        {error ? (
          <span className="text-destructive">{error.message}</span>
        ) : point && point.latitude !== null && point.longitude !== null ? (
          <a
            href={mapUrl(point.latitude, point.longitude)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
          >
            <MapPin className="h-3.5 w-3.5" /> Ver en mapa <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-muted-foreground">Sin coordenadas: el agente no podrá calcular distancias desde aquí.</span>
        )}
      </div>
    </fieldset>
  );
}

/** Indicador de la barra de filtros: cuántos registros no tienen coordenadas; al tocarlo filtra solo esos. */
export function MissingCoordinatesFilter({ count, active, onToggle }: { count: number; active: boolean; onToggle: () => void }) {
  if (count === 0 && !active) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "outline"}
      className={cn("h-9 gap-1.5 text-xs", !active && "border-warning/40 text-warning hover:text-warning")}
      aria-pressed={active}
      onClick={onToggle}
    >
      <MapPinOff className="h-3.5 w-3.5" />
      {active ? "Ver todas" : `${count} sin coordenadas`}
    </Button>
  );
}

/** Celda de la tabla: enlace al mapa o aviso "Sin coordenadas". */
export function CoordinatesCell({ latitude, longitude }: { latitude: number | null; longitude: number | null }) {
  if (!hasCoordinates({ latitude, longitude })) return <SoftBadge tone="warning">Sin coordenadas</SoftBadge>;
  return (
    <a
      href={mapUrl(latitude as number, longitude as number)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
      title={`${latitude}, ${longitude}`}
    >
      <MapPin className="h-3.5 w-3.5" /> Ver en mapa
    </a>
  );
}
