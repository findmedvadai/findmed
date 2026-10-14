// Abre un caso desde la URL (/admin/casos?caso=<id>), p. ej. desde el detalle
// de un formulario post-consulta. Lee el caso por RLS, lo entrega una sola vez
// y quita el parámetro para que cerrar el panel no lo vuelva a abrir.
// Si el caso no existe (enlace viejo o mal copiado) avisa y limpia la URL.
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { PatientCase } from "@/lib/case-actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useCaseDeepLink(onOpen: (c: PatientCase) => void) {
  const [params, setParams] = useSearchParams();
  const id = params.get("caso");
  const validId = !!id && UUID_RE.test(id);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const handled = useRef<string | null>(null);

  const { data, isSuccess, isError } = useQuery({
    queryKey: ["patient-case", id],
    // Tiene su propio aviso (abajo): sin el toast genérico de lectura fallida.
    meta: { silentError: true },
    enabled: validId,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.from("patient_cases").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!id) {
      handled.current = null;
      return;
    }
    if (handled.current === id) return;
    const clear = () => {
      const next = new URLSearchParams(params);
      next.delete("caso");
      setParams(next, { replace: true });
    };
    if (validId && data && data.id === id) {
      handled.current = id;
      onOpenRef.current(data);
      clear();
      return;
    }
    const notFound = !validId || (isSuccess && !data);
    if (notFound || isError) {
      handled.current = id;
      toast({
        title: notFound ? "No encontramos ese caso" : "No se pudo abrir el caso",
        description: notFound
          ? "El enlace es incorrecto o el caso ya no existe."
          : "Revisa tu conexión e inténtalo de nuevo desde la lista.",
        variant: "destructive",
      });
      clear();
    }
  }, [id, validId, data, isSuccess, isError, params, setParams]);
}
