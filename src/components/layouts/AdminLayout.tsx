import { Outlet } from "react-router-dom";
import { Calendar, BookOpen, UserCog, Layers, Inbox, LogOut, Webhook, Key } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
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
  { title: "Calendario", url: "/admin/calendario", icon: Calendar },
  { title: "Reservas", url: "/admin/reservas", icon: BookOpen },
  { title: "Doctores", url: "/admin/doctores", icon: UserCog },
  { title: "Catálogos", url: "/admin/catalogos", icon: Layers },
  { title: "Inbox", url: "/admin/inbox", icon: Inbox },
];

const settingsItems = [
  { title: "Webhooks", url: "/admin/webhooks", icon: Webhook },
  { title: "API Keys", url: "/admin/api-keys", icon: Key },
];

export default function AdminLayout() {
  const { signOut } = useAuth();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <Sidebar>
          <SidebarHeader className="p-4">
            <h2 className="text-lg font-bold text-primary">FindMed</h2>
            <span className="text-xs text-muted-foreground">Panel Administrativo</span>
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
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Configuración</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {settingsItems.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          className="flex items-center gap-2"
                          activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
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
