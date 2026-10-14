import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ClipboardList, Home, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import AppShell, { type ShellNavItem, type ShellSettingsItem } from "./AppShell";

const settings: ShellSettingsItem[] = [
  {
    title: "Mi configuración",
    url: "/doctor/configuracion",
    icon: SlidersHorizontal,
    description: "Consultorios, horarios y calendarios",
  },
];

export default function DoctorLayout() {
  const { signOut, doctorId, user } = useAuth();
  const queryClient = useQueryClient();

  const { data: doctorName } = useQuery({
    queryKey: ["doctor-name", doctorId],
    queryFn: async () => {
      if (!doctorId) return null;
      const { data } = await supabase.from("doctors").select("full_name").eq("id", doctorId).maybeSingle();
      return data?.full_name ?? null;
    },
    enabled: !!doctorId,
  });

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["doctor-unread-notifications", doctorId],
    queryFn: async () => {
      if (!doctorId) return 0;
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("doctor_id", doctorId)
        .eq("recipient_role", "doctor")
        .eq("is_read", false);
      return count ?? 0;
    },
    enabled: !!doctorId,
  });

  // Consultas atendidas sin notas post-consulta (mismo criterio que "Por completar").
  const { data: toComplete = 0 } = useQuery({
    queryKey: ["doctor-to-complete-count", doctorId],
    queryFn: async () => {
      if (!doctorId) return 0;
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("appointments")
        .select("id, post_consultation_forms(id)")
        .eq("doctor_id", doctorId)
        .is("doctor_notes", null)
        .or(`status.eq.completed,and(status.eq.confirmed,end_at.lt.${nowIso})`);
      // Las que ya tienen formulario (enviado sin observaciones) no cuentan.
      return (data ?? []).filter((a) => !a.post_consultation_forms?.length).length;
    },
    enabled: !!doctorId,
    refetchInterval: 60_000,
  });

  // Realtime: refresh count when notifications change
  useEffect(() => {
    if (!doctorId) return;
    const channel = supabase
      .channel("doctor-notifications-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        queryClient.invalidateQueries({ queryKey: ["doctor-unread-notifications", doctorId] });
        queryClient.invalidateQueries({ queryKey: ["doctor-notifications", doctorId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [doctorId, queryClient]);

  const nav: ShellNavItem[] = [
    { title: "Inicio", url: "/doctor/inicio", icon: Home, badge: unreadCount },
    { title: "Agenda", url: "/doctor/agenda", icon: CalendarDays },
    { title: "Por completar", url: "/doctor/por-completar", icon: ClipboardList, badge: toComplete },
  ];

  return (
    <AppShell
      subtitle={doctorName ?? "Portal del doctor"}
      nav={nav}
      settings={settings}
      profile={{ name: doctorName ?? "", email: user?.email ?? "", roleLabel: "Doctor" }}
      onSignOut={signOut}
    />
  );
}
