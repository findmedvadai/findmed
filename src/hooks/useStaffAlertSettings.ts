import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SLA, type SlaSettings } from "@/lib/case-sla";

/** Fila de configuración de alertas (SLA, re-avisos, plantilla). Solo admins (RLS). */
export function useStaffAlertSettings() {
  return useQuery({
    queryKey: ["staff-alert-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_alert_settings").select("*").eq("id", true).maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** SLA vigentes; mientras cargan (o si fallan) se usan los valores por defecto. Referencia estable. */
export function useSlaSettings(): SlaSettings {
  const { data } = useStaffAlertSettings();
  return useMemo(
    () =>
      data
        ? {
            sla_urgent_minutes: data.sla_urgent_minutes,
            sla_high_minutes: data.sla_high_minutes,
            sla_normal_minutes: data.sla_normal_minutes,
            max_escalations: data.max_escalations,
          }
        : DEFAULT_SLA,
    [data],
  );
}
