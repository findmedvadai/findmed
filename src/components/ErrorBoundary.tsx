import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Red de seguridad: un error al renderizar (o un módulo que no se pudo
 * descargar) dejaba la pantalla en blanco. Muestra un aviso en español con
 * opciones para recargar o volver al inicio.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Error de interfaz:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-screen items-center justify-center bg-muted px-4">
        <div className="max-w-sm text-center">
          <h1 className="mb-2 text-xl font-semibold text-foreground">Algo salió mal</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            No pudimos mostrar esta pantalla. Recarga la página; si vuelve a pasar, avisa al equipo de soporte.
          </p>
          <div className="flex justify-center gap-2">
            <Button onClick={() => window.location.reload()}>Recargar</Button>
            <Button variant="outline" onClick={() => window.location.assign("/")}>
              Ir al inicio
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
