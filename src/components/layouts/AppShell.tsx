// Armazón común de los paneles (admin y doctor): barra lateral con los módulos
// principales, perfil abajo con el engrane de configuración, barra superior con
// el nombre del módulo y área de trabajo. Los submódulos viven dentro de su
// módulo (pestañas) y la configuración se abre desde el engrane.
import { forwardRef, useEffect, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { LogOut, Settings, Stethoscope } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface ShellNavItem {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  /** Número en la barra (pendientes). 0 o undefined = nada. */
  badge?: number;
  /** El módulo ocupa todo el ancho y alto (sin márgenes), p. ej. un iframe. */
  fullBleed?: boolean;
}

export interface ShellSettingsItem {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  description?: string;
}

interface AppShellProps {
  subtitle: string;
  nav: ShellNavItem[];
  settings: ShellSettingsItem[];
  profile: { name: string; email: string; roleLabel: string };
  onSignOut: () => void;
  /** Contenido extra a la derecha de la barra superior. */
  topbarRight?: ReactNode;
}

const initials = (text: string) =>
  text
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

const isActive = (pathname: string, url: string) => pathname === url || pathname.startsWith(`${url}/`);

/**
 * En el celular la barra lateral es una hoja (Sheet) que no se cierra sola al
 * elegir un módulo: quedaba tapando la pantalla nueva. Se cierra al cambiar de ruta.
 */
function CloseMobileSidebarOnNavigate() {
  const { pathname, search } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, search, isMobile, setOpenMobile]);
  return null;
}

/** Enlace del menú: en el celular cierra la hoja aunque el módulo sea el actual. */
const ShellNavLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof Link>>(function ShellNavLink({ onClick, ...props }, ref) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <Link
      ref={ref}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (isMobile) setOpenMobile(false);
      }}
    />
  );
});

/**
 * En el celular la barra lateral se abre como diálogo (Sheet) y Radix exige un
 * título accesible (sin él avisa en consola). Solo existe dentro del Sheet móvil.
 */
function MobileSidebarTitle() {
  const { isMobile } = useSidebar();
  if (!isMobile) return null;
  return (
    <SheetHeader className="sr-only">
      <SheetTitle>Menú</SheetTitle>
      <SheetDescription>Módulos del panel, configuración y cierre de sesión.</SheetDescription>
    </SheetHeader>
  );
}

export default function AppShell({ subtitle, nav, settings, profile, onSignOut, topbarRight }: AppShellProps) {
  const { pathname } = useLocation();

  // Los diálogos y menús se montan fuera del panel (portales): el tema del
  // panel va en <html> mientras esté montado.
  useEffect(() => {
    document.documentElement.classList.add("app-shell");
    return () => document.documentElement.classList.remove("app-shell");
  }, []);

  const current = nav.find((n) => isActive(pathname, n.url));
  const inSettings = settings.some((s) => isActive(pathname, s.url));
  const title = current?.title ?? (inSettings ? "Configuración" : "");

  return (
    <SidebarProvider>
      <CloseMobileSidebarOnNavigate />
      <div className="app-shell flex min-h-screen w-full bg-canvas">
        <Sidebar collapsible="icon" className="border-r">
          <MobileSidebarTitle />
          <SidebarHeader className="px-3 py-4">
            <ShellNavLink to={nav[0]?.url ?? "/"} className="flex items-center gap-2.5 overflow-hidden">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Stethoscope className="h-4 w-4" />
              </div>
              <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="text-sm font-semibold leading-tight text-primary">FindMed</p>
                <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
              </div>
            </ShellNavLink>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Módulos</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {nav.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={isActive(pathname, item.url)} tooltip={item.title} className="h-9">
                        <ShellNavLink to={item.url}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </ShellNavLink>
                      </SidebarMenuButton>
                      {!!item.badge && (
                        <SidebarMenuBadge className="rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground peer-data-[active=true]/menu-button:text-destructive-foreground">
                          {item.badge > 99 ? "99+" : item.badge}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t p-2">
            <div className="flex items-center gap-2 rounded-md p-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary group-data-[collapsible=icon]:hidden">
                {initials(profile.name || profile.email)}
              </div>
              <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-sm font-medium text-foreground">{profile.name || profile.email}</p>
                <p className="truncate text-xs text-muted-foreground">{profile.roleLabel}</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Configuración y perfil"
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                      inSettings && "bg-sidebar-accent text-sidebar-accent-foreground",
                    )}
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" className="w-64">
                  <DropdownMenuLabel className="font-normal">
                    <p className="truncate text-sm font-medium text-foreground">{profile.name || profile.email}</p>
                    {profile.name && <p className="truncate text-xs text-muted-foreground">{profile.email}</p>}
                    <p className="text-xs text-muted-foreground">{profile.roleLabel}</p>
                  </DropdownMenuLabel>
                  {settings.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="py-1 text-xs font-medium text-muted-foreground">Configuración</DropdownMenuLabel>
                      <DropdownMenuGroup>
                        {settings.map((s) => (
                          <DropdownMenuItem key={s.url} asChild className="cursor-pointer gap-2">
                            <Link to={s.url}>
                              <s.icon className="h-4 w-4 text-muted-foreground" />
                              <div className="min-w-0">
                                <p className="text-sm">{s.title}</p>
                                {s.description && <p className="truncate text-xs text-muted-foreground">{s.description}</p>}
                              </div>
                            </Link>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onSignOut} className="cursor-pointer gap-2 text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4" /> Cerrar sesión
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-w-0 bg-canvas">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <SidebarTrigger className="-ml-1 h-8 w-8" />
            <Separator orientation="vertical" className="h-5" />
            <span className="truncate text-sm font-medium text-foreground">{title}</span>
            <div className="ml-auto flex items-center gap-2">{topbarRight}</div>
          </header>
          {current?.fullBleed ? (
            <main className="flex min-h-0 flex-1 flex-col">
              <Outlet />
            </main>
          ) : (
            <main className="flex-1">
              <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-6">
                <Outlet />
              </div>
            </main>
          )}
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
