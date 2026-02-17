import { Outlet } from "react-router-dom";
import { CalendarDays, Settings, ClipboardList, Inbox, LogOut } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const navItems = [
  { title: "Agenda", url: "/doctor/agenda", icon: CalendarDays },
  { title: "Configuración", url: "/doctor/configuracion", icon: Settings },
  { title: "Por Completar", url: "/doctor/por-completar", icon: ClipboardList },
  { title: "Inbox", url: "/doctor/inbox", icon: Inbox },
];

export default function DoctorLayout() {
  const { signOut, doctorId } = useAuth();
  const queryClient = useQueryClient();

  const { data: doctorName } = useQuery({
    queryKey: ["doctor-name", doctorId],
    queryFn: async () => {
      if (!doctorId) return null;
      const { data } = await supabase
        .from("doctors")
        .select("full_name")
        .eq("id", doctorId)
        .maybeSingle();
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

  // Realtime: refresh count when notifications change
  useEffect(() => {
    if (!doctorId) return;
    const channel = supabase
      .channel("doctor-notifications-badge")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["doctor-unread-notifications", doctorId] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [doctorId, queryClient]);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <Sidebar>
          <SidebarHeader className="p-4">
            <h2 className="text-lg font-bold text-primary">FindMed</h2>
            <span className="text-xs text-muted-foreground">
              {doctorName ?? "Portal Doctor"}
            </span>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Navegación</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          className="flex items-center gap-2"
                          activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          {item.url === "/doctor/inbox" && unreadCount > 0 && (
                            <span className="ml-auto h-2 w-2 rounded-full bg-destructive" />
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={signOut}>
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </Button>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="flex h-12 items-center border-b px-4">
            <SidebarTrigger />
          </header>
          <div className="flex-1 p-6">
            <Outlet />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
