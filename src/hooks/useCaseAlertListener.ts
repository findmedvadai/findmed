// Alertas de casos en el panel del admin: cuando llega por Realtime una
// notificación de caso (nuevo, canalización o vencido) muestra un aviso fijo
// con "Ver caso", suena un tono y, si el navegador tiene permiso, muestra una
// notificación del sistema. Se monta una vez en AdminLayout.
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { claimAlertOnce, playAlertSound, primeAlertSound, showBrowserAlert } from "@/lib/browser-alerts";
import { CASE_NOTIFICATION_TYPES, casePath } from "@/lib/staff-alerts";

type NotificationRow = Tables<"notifications">;

const isCaseAlert = (n: Partial<NotificationRow> | null | undefined): n is NotificationRow & { case_id: string } =>
  !!n?.case_id && !!n.type && (CASE_NOTIFICATION_TYPES as readonly string[]).includes(n.type);

export function useCaseAlertListener() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const navigateRef = useRef(navigate);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => primeAlertSound(), []);

  useEffect(() => {
    const open = (n: NotificationRow & { case_id: string }) => {
      navigateRef.current(casePath(n.case_id));
      void supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", n.id)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["admin-unread-notifications"] });
          queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
        });
    };

    const announce = async (n: NotificationRow & { case_id: string }) => {
      const { data } = await supabase.from("patient_cases").select("priority").eq("id", n.case_id).maybeSingle();
      const urgent = data?.priority === "urgent";
      const show = urgent || n.type === "case_overdue" ? toast.error : toast.warning;
      // Un aviso por caso: la canalización reemplaza al de "caso nuevo".
      show(n.title, {
        id: `case-alert-${n.case_id}`,
        description: n.body ?? undefined,
        duration: Infinity,
        closeButton: true,
        action: { label: "Ver caso", onClick: () => open(n) },
      });
      // Sonido y aviso del sistema en una sola pestaña (la visible tiene prioridad).
      const visible = document.visibilityState === "visible";
      if (!visible) await new Promise((r) => setTimeout(r, 400));
      if (!claimAlertOnce(n.id)) return;
      playAlertSound(urgent);
      if (!visible || !document.hasFocus()) {
        showBrowserAlert({ title: n.title, body: n.body ?? undefined, tag: `case-${n.case_id}`, urgent, onClick: () => open(n) });
      }
    };

    const channel = supabase
      .channel("admin-case-alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
        const n = payload.new as Partial<NotificationRow>;
        if (!isCaseAlert(n)) return;
        queryClient.invalidateQueries({ queryKey: ["patient-cases"] });
        queryClient.invalidateQueries({ queryKey: ["admin-pending-cases"] });
        queryClient.invalidateQueries({ queryKey: ["admin-home-overview"] });
        void announce(n);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
