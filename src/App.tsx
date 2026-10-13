import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminLayout from "@/components/layouts/AdminLayout";
import DoctorLayout from "@/components/layouts/DoctorLayout";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

// Admin pages (módulos: Inicio, Agenda, Doctores, Casos, WhatsApp,
// Automatización; Configuración se abre desde el engrane)
import AdminInicio from "./pages/admin/Inicio";
import AdminAgenda from "./pages/admin/Agenda";
import Doctores from "./pages/admin/Doctores";
import Casos from "./pages/admin/Casos";
import WhatsApp from "./pages/admin/WhatsApp";
import Automatizacion from "./pages/admin/Automatizacion";
import AdminConfiguracion from "./pages/admin/Configuracion";

// Doctor pages
import DoctorInicio from "./pages/doctor/Inicio";
import Agenda from "./pages/doctor/Agenda";
import Configuracion from "./pages/doctor/Configuracion";
import PorCompletar from "./pages/doctor/PorCompletar";

// Patient pages
import Reserva from "./pages/patient/Reserva";
import Gestionar from "./pages/patient/Gestionar";

// Legal pages (públicas, sin auth)
import Privacidad from "./pages/legal/Privacidad";
import Terminos from "./pages/legal/Terminos";

// Utility pages
import GoogleCalendarSuccess from "./pages/GoogleCalendarSuccess";
import OutlookCalendarSuccess from "./pages/OutlookCalendarSuccess";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/reserva" element={<Reserva />} />
            <Route path="/gestionar" element={<Gestionar />} />
            <Route path="/privacidad" element={<Privacidad />} />
            <Route path="/terminos" element={<Terminos />} />
            <Route path="/google-calendar-success" element={<GoogleCalendarSuccess />} />
            <Route path="/outlook-calendar-success" element={<OutlookCalendarSuccess />} />

            {/* Admin routes */}
            <Route
              element={
                <ProtectedRoute allowedRoles={["admin", "superadmin"]}>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/admin/inicio" element={<AdminInicio />} />
              <Route path="/admin/agenda" element={<AdminAgenda />} />
              <Route path="/admin/doctores" element={<Doctores />} />
              <Route path="/admin/casos" element={<Casos />} />
              <Route path="/admin/whatsapp" element={<WhatsApp />} />
              <Route path="/admin/automatizacion" element={<Automatizacion />} />
              <Route path="/admin/configuracion/:tab" element={<AdminConfiguracion />} />
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
            </Route>

            {/* Doctor routes */}
            <Route
              element={
                <ProtectedRoute allowedRoles={["doctor"]}>
                  <DoctorLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/doctor/inicio" element={<DoctorInicio />} />
              <Route path="/doctor/agenda" element={<Agenda />} />
              <Route path="/doctor/por-completar" element={<PorCompletar />} />
              <Route path="/doctor/configuracion" element={<Configuracion />} />
              <Route path="/doctor" element={<Navigate to="/doctor/inicio" replace />} />
              <Route path="/doctor/inbox" element={<Navigate to="/doctor/inicio" replace />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
