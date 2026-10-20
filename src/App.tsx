import { Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import { createQueryClient } from "@/lib/query-client";
import { lazyWithReload } from "@/lib/lazy-with-reload";

// Puntos de entrada en el bundle principal: la landing (homepage pública,
// tiene que cargar al instante), el login y el 404. Todo lo demás se carga
// por ruta (code-splitting) para no bajar el panel completo en cada visita.
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const AdminLayout = lazyWithReload(() => import("@/components/layouts/AdminLayout"));
const DoctorLayout = lazyWithReload(() => import("@/components/layouts/DoctorLayout"));

// Admin pages (módulos: Inicio, Agenda, Doctores, Casos, WhatsApp,
// Automatización; Configuración se abre desde el engrane)
const AdminInicio = lazyWithReload(() => import("./pages/admin/Inicio"));
const AdminAgenda = lazyWithReload(() => import("./pages/admin/Agenda"));
const Doctores = lazyWithReload(() => import("./pages/admin/Doctores"));
const Casos = lazyWithReload(() => import("./pages/admin/Casos"));
const WhatsApp = lazyWithReload(() => import("./pages/admin/WhatsApp"));
const Automatizacion = lazyWithReload(() => import("./pages/admin/Automatizacion"));
const AdminConfiguracion = lazyWithReload(() => import("./pages/admin/Configuracion"));

// Doctor pages
const DoctorInicio = lazyWithReload(() => import("./pages/doctor/Inicio"));
const Agenda = lazyWithReload(() => import("./pages/doctor/Agenda"));
const Configuracion = lazyWithReload(() => import("./pages/doctor/Configuracion"));
const PorCompletar = lazyWithReload(() => import("./pages/doctor/PorCompletar"));

// Patient pages
const Reserva = lazyWithReload(() => import("./pages/patient/Reserva"));
const Gestionar = lazyWithReload(() => import("./pages/patient/Gestionar"));

// Legal pages (públicas, sin auth)
const Privacidad = lazyWithReload(() => import("./pages/legal/Privacidad"));
const Terminos = lazyWithReload(() => import("./pages/legal/Terminos"));

// Utility pages
const GoogleCalendarSuccess = lazyWithReload(() => import("./pages/GoogleCalendarSuccess"));
const OutlookCalendarSuccess = lazyWithReload(() => import("./pages/OutlookCalendarSuccess"));

// Avisa en español cuando una lectura falla sin datos que mostrar (src/lib/query-client.ts).
const queryClient = createQueryClient();

function RouteFallback({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2 text-sm text-muted-foreground ${
        fullScreen ? "min-h-screen bg-background" : "min-h-[50vh]"
      }`}
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span>Cargando…</span>
    </div>
  );
}

// Each page gets its own boundary so that, inside a layout, only the content
// area shows the loader while the sidebar stays on screen.
const page = (node: ReactNode) => <Suspense fallback={<RouteFallback />}>{node}</Suspense>;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      {/* Con un diálogo modal abierto Radix pone pointer-events:none en el body: sin esto,
          el aviso de caso ("Ver caso") no se podía pulsar mientras hubiera una ventana abierta. */}
      <Sonner style={{ pointerEvents: "auto" }} />
      <BrowserRouter>
        <AuthProvider>
          {/* Un error al renderizar ya no deja la pantalla en blanco. */}
          <ErrorBoundary>
          <Suspense fallback={<RouteFallback fullScreen />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/reserva" element={page(<Reserva />)} />
              <Route path="/gestionar" element={page(<Gestionar />)} />
              <Route path="/privacidad" element={page(<Privacidad />)} />
              <Route path="/terminos" element={page(<Terminos />)} />
              <Route path="/google-calendar-success" element={page(<GoogleCalendarSuccess />)} />
              <Route path="/outlook-calendar-success" element={page(<OutlookCalendarSuccess />)} />

              {/* Admin routes */}
              <Route
                element={
                  <ProtectedRoute allowedRoles={["admin", "superadmin"]}>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/admin/inicio" element={page(<AdminInicio />)} />
                <Route path="/admin/agenda" element={page(<AdminAgenda />)} />
                <Route path="/admin/doctores" element={page(<Doctores />)} />
                <Route path="/admin/casos" element={page(<Casos />)} />
                <Route path="/admin/whatsapp" element={page(<WhatsApp />)} />
                <Route path="/admin/automatizacion" element={page(<Automatizacion />)} />
                <Route path="/admin/configuracion/:tab" element={page(<AdminConfiguracion />)} />
                {/* Rutas anteriores (enlaces guardados) */}
                <Route path="/admin" element={<Navigate to="/admin/inicio" replace />} />
                <Route path="/admin/inbox" element={<Navigate to="/admin/inicio" replace />} />
                <Route path="/admin/calendario" element={<Navigate to="/admin/agenda" replace />} />
                <Route path="/admin/reservas" element={<Navigate to="/admin/agenda?vista=lista" replace />} />
                <Route path="/admin/mensajeria" element={<Navigate to="/admin/automatizacion" replace />} />
                <Route path="/admin/configuracion" element={<Navigate to="/admin/configuracion/agente-ia" replace />} />
                <Route path="/admin/agente-ia" element={<Navigate to="/admin/configuracion/agente-ia" replace />} />
                <Route path="/admin/catalogos" element={<Navigate to="/admin/configuracion/catalogos" replace />} />
                <Route path="/admin/webhooks" element={<Navigate to="/admin/configuracion/webhooks" replace />} />
                <Route path="/admin/api-keys" element={<Navigate to="/admin/configuracion/api-keys" replace />} />
                <Route path="/admin/usuarios" element={<Navigate to="/admin/configuracion/usuarios" replace />} />
              </Route>

              {/* Doctor routes */}
              <Route
                element={
                  <ProtectedRoute allowedRoles={["doctor"]}>
                    <DoctorLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/doctor/inicio" element={page(<DoctorInicio />)} />
                <Route path="/doctor/agenda" element={page(<Agenda />)} />
                <Route path="/doctor/por-completar" element={page(<PorCompletar />)} />
                <Route path="/doctor/configuracion" element={page(<Configuracion />)} />
                <Route path="/doctor" element={<Navigate to="/doctor/inicio" replace />} />
                <Route path="/doctor/inbox" element={<Navigate to="/doctor/inicio" replace />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
