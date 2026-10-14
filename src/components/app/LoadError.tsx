import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./EmptyState";

interface LoadErrorProps {
  /** Qué no se pudo cargar, p. ej. "tu resumen del día". */
  what?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

/**
 * Estado de error de una lectura: en vez de dejar skeletons o un "no hay datos"
 * engañoso, dice qué falló y ofrece reintentar.
 */
export function LoadError({ what = "la información", onRetry, retrying = false, className }: LoadErrorProps) {
  return (
    <EmptyState
      icon={AlertTriangle}
      className={className}
      title={`No se pudo cargar ${what}`}
      description="Revisa tu conexión a internet y vuelve a intentar. Si sigue pasando, recarga la página."
      action={
        onRetry && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onRetry} disabled={retrying}>
            <RefreshCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Reintentar
          </Button>
        )
      }
    />
  );
}
