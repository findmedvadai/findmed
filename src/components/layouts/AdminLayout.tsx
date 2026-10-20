import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Bot, CalendarDays, Home, Key, Layers, LifeBuoy, MessageCircle, UserCog, Users, Webhook, Workflow } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCaseAlertListener } from "@/hooks/useCaseAlertListener";
import { supabase } from "@/integrations/supabase/client";
import AppShell, { type ShellNavItem, type ShellSettingsItem } from "./AppShell";

const settings: ShellSettingsItem[] = [
  { title: "Usuarios", url: "/admin/configuracion/usuarios", icon: Users, description: "Accesos del equipo" },
  { title: "Agente IA", url: "/admin/configuracion/agente-ia", icon: Bot, description: "Conexión, actividad y errores del agente" },
  { title: "Alertas", url: "/admin/configuracion/alertas", icon: BellRing, description: "Avisos de casos, números de guardia y tiempos" },
  { title: "Catálogos", url: "/admin/configuracion/catalogos", icon: Layers, description: "Especialidades, ciudades, hospitales…" },
  { title: "Webhooks", url: "/admin/configuracion/webhooks", icon: Webhook, description: "Integraciones salientes" },
  { title: "API Keys", url: "/admin/configuracion/api-keys", icon: Key, description: "Acceso de sistemas externos" },
];

export default function AdminLayout() {
  const { signOut, user, role } = useAuth();
  const queryClient = useQueryClient();
  // Casos nuevos, canalizaciones y casos vencidos: aviso fijo + sonido + aviso del navegador.
  useCaseAlertListener();

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["admin-unread-notifications"],
    queryFn: async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .in("recipient_role", ["admin", "superadmin"])
        .eq("is_read", false);
      return count ?? 0;
    },
  });

  // Casos esperando que alguien los tome (los mismos de "Sin asignar" en Casos).
  const { data: pendingCases = 0 } = useQuery({
    queryKey: ["admin-pending-cases"],
    queryFn: async () => {
      const { count } = await supabase
        .from("patient_cases")
        .select("id", { count: "exact", head: true })
        .in("status", ["open", "awaiting_assignment"]);
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });

  // Realtime: refresh count when notifications change
  useEffect(() => {
    const channel = supabase
      .channel("admin-notifications-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-unread-notifications"] });
        queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const nav: ShellNavItem[] = [
    { title: "Inicio", url: "/admin/inicio", icon: Home, badge: unreadCount },
    { title: "Agenda", url: "/admin/agenda", icon: CalendarDays },
    { title: "Doctores", url: "/admin/doctores", icon: UserCog },
    { title: "Casos", url: "/admin/casos", icon: LifeBuoy, badge: pendingCases },
    { title: "WhatsApp", url: "/admin/whatsapp", icon: MessageCircle, fullBleed: true },
    { title: "Automatización", url: "/admin/automatizacion", icon: Workflow },
  ];

  return (
    <AppShell
      subtitle="Panel administrativo"
      nav={nav}
      settings={settings}
      profile={{
        name: "",
        email: user?.email ?? "",
        roleLabel: role === "superadmin" ? "Superadministrador" : "Administrador",
      }}
      onSignOut={signOut}
    />
  );
}
