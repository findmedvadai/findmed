// Abre un caso desde la URL (/admin/casos?caso=<id>), p. ej. desde el detalle
// de un formulario post-consulta. Lee el caso por RLS, lo entrega una sola vez
// y quita el parámetro para que cerrar el panel no lo vuelva a abrir.
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PatientCase } from "@/lib/case-actions";

export function useCaseDeepLink(onOpen: (c: PatientCase) => void) {
  const [params, setParams] = useSearchParams();
  const id = params.get("caso");
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const handled = useRef<string | null>(null);

  const { data } = useQuery({
    queryKey: ["patient-case", id],
    enabled: !!id,
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
    if (!data || data.id !== id || handled.current === id) return;
    handled.current = id;
    onOpenRef.current(data);
    const next = new URLSearchParams(params);
    next.delete("caso");
    setParams(next, { replace: true });
  }, [id, data, params, setParams]);
}
