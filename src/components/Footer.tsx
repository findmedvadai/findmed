import { Link } from "react-router-dom";

/**
 * Footer global para páginas públicas (landing, login y páginas legales).
 * Expone los links a los documentos legales requeridos para la verificación
 * OAuth de Google/Microsoft (Aviso de Privacidad y Términos), un acceso a la
 * landing y al login, y la razón social del operador.
 *
 * Se separa visualmente del resto de la página con un fondo y border-top
 * distintos, y organiza los enlaces en columnas en desktop.
 */
export default function Footer() {
  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="container py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          {/* Marca + razón social */}
          <div className="flex max-w-sm flex-col gap-2">
            <Link to="/" className="text-lg font-bold tracking-tight text-primary">
              FindMed
            </Link>
            <p className="text-sm text-muted-foreground">
              Plataforma SaaS de agendamiento médico para doctores en México.
            </p>
          </div>

          {/* Columnas de enlaces */}
          <div className="grid grid-cols-2 gap-8 sm:gap-16">
            <nav className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                Plataforma
              </span>
              <Link
                to="/"
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Inicio
              </Link>
              <Link
                to="/login"
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Iniciar sesión
              </Link>
            </nav>

            <nav className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                Legal
              </span>
              <Link
                to="/privacidad"
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Aviso de Privacidad
              </Link>
              <Link
                to="/terminos"
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Términos y Condiciones
              </Link>
            </nav>
          </div>
        </div>

        {/* Línea inferior: copyright + razón social */}
        <div className="mt-8 flex flex-col gap-1 border-t border-border pt-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} FindMed</p>
          <p className="text-xs text-muted-foreground">
            LMVM Operadora de Asistencias y Servicios de Salud, S. de R.L. de C.V.
          </p>
        </div>
      </div>
    </footer>
  );
}
