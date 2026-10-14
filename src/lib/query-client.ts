// QueryClient de la app. Avisa en español cuando una lectura falla y la
// pantalla no tiene datos que mostrar (primera carga): antes la mayoría de las
// vistas quedaban vacías ("no hay citas", "no hay doctores") o con skeletons,
// sin decir que en realidad la consulta había fallado.
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const QUERY_ERROR_TOAST_ID = "query-load-error";

interface QueryLike {
  queryHash: string;
  state: { data: unknown };
  meta?: Record<string, unknown>;
}

/** Crea el manejador; guarda qué lecturas siguen fallando para quitar el aviso cuando se recuperan. */
export function createQueryErrorNotifier() {
  const failing = new Set<string>();
  return {
    onError(_error: unknown, query: QueryLike) {
      // Con datos previos (refresco en segundo plano) la pantalla sigue siendo útil:
      // no se interrumpe con un aviso. Las consultas con su propio manejo lo piden con meta.
      if (query.state.data !== undefined) return;
      if (query.meta?.silentError) return;
      failing.add(query.queryHash);
      // Fijo hasta que se recupere o la persona lo cierre: un aviso de 4 s dejaba
      // otra vez una pantalla vacía sin explicación.
      toast.error("No se pudo cargar la información", {
        id: QUERY_ERROR_TOAST_ID,
        description: "Revisa tu conexión a internet y vuelve a intentar. Si sigue pasando, recarga la página.",
        duration: Infinity,
        closeButton: true,
      });
    },
    onSuccess(_data: unknown, query: QueryLike) {
      if (!failing.delete(query.queryHash)) return;
      if (failing.size === 0) toast.dismiss(QUERY_ERROR_TOAST_ID);
    },
  };
}

export function createQueryClient() {
  const notifier = createQueryErrorNotifier();
  return new QueryClient({ queryCache: new QueryCache({ onError: notifier.onError, onSuccess: notifier.onSuccess }) });
}
