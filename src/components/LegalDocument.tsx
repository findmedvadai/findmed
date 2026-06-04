import { useEffect } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Footer from "@/components/Footer";

interface LegalDocumentProps {
  /** Título de la pestaña del navegador (document.title). */
  pageTitle: string;
  /** Contenido markdown crudo del documento legal. */
  content: string;
}

/**
 * Renderiza un documento legal (Aviso de Privacidad / Términos) a partir de su
 * markdown crudo. Ruta pública: no requiere autenticación ni guard de rol.
 *
 * El contenido se renderea fielmente con react-markdown + remark-gfm (tablas,
 * negritas, cursivas, jerarquía de encabezados y el bloque de Limited Use en
 * inglés). No se altera el texto: solo se formatea visualmente con el design
 * system (Tailwind + @tailwindcss/typography).
 */
export default function LegalDocument({ pageTitle, content }: LegalDocumentProps) {
  useEffect(() => {
    const previous = document.title;
    document.title = pageTitle;
    return () => {
      document.title = previous;
    };
  }, [pageTitle]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Encabezado simple con marca y vínculo de regreso al inicio */}
      <header className="border-b border-border">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="text-xl font-bold text-primary">
            FindMed
          </Link>
        </div>
      </header>

      <main className="container flex-1 py-10">
        <article
          className="prose prose-slate mx-auto max-w-3xl
            prose-headings:text-foreground prose-h1:text-3xl prose-h1:font-bold
            prose-h2:mt-10 prose-h2:border-b prose-h2:border-border prose-h2:pb-2
            prose-p:text-foreground prose-li:text-foreground
            prose-strong:text-foreground prose-em:text-muted-foreground
            prose-a:text-primary prose-a:break-words"
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Tabla con scroll horizontal para que sea legible en mobile.
              table: ({ children }) => (
                <div className="not-prose my-6 w-full overflow-x-auto">
                  <table className="w-full min-w-[36rem] border-collapse text-sm">
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-muted">{children}</thead>
              ),
              th: ({ children }) => (
                <th className="border border-border px-3 py-2 text-left font-semibold text-foreground align-top">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-border px-3 py-2 text-foreground align-top">
                  {children}
                </td>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      </main>

      <Footer />
    </div>
  );
}
