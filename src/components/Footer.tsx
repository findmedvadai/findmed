import { Link } from "react-router-dom";

/**
 * Footer global para páginas públicas (landing y páginas legales).
 * Expone los links a los documentos legales requeridos para la verificación
 * OAuth de Google/Microsoft: Aviso de Privacidad y Términos y Condiciones.
 */
export default function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container flex flex-col items-center gap-3 py-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <p className="text-sm text-muted-foreground">
          © {new Date().getFullYear()} FindMed
        </p>
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
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
    </footer>
  );
}
