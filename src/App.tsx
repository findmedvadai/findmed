import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminLayout from "@/components/layouts/AdminLayout";
import DoctorLayout from "@/components/layouts/DoctorLayout";
import Index from "./pages/Index";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

// Admin pages
import Calendario from "./pages/admin/Calendario";
import Reservas from "./pages/admin/Reservas";
import Doctores from "./pages/admin/Doctores";
import Catalogos from "./pages/admin/Catalogos";
import AdminInbox from "./pages/admin/Inbox";
import Webhooks from "./pages/admin/Webhooks";
import ApiKeysPage from "./pages/admin/ApiKeys";

// Doctor pages
import Agenda from "./pages/doctor/Agenda";
import Configuracion from "./pages/doctor/Configuracion";
import PorCompletar from "./pages/doctor/PorCompletar";
import DoctorInbox from "./pages/doctor/DoctorInbox";

// Patient pages
import Reserva from "./pages/patient/Reserva";
import Gestionar from "./pages/patient/Gestionar";

// Utility pages
import GoogleCalendarSuccess from "./pages/GoogleCalendarSuccess";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/reserva" element={<Reserva />} />
            <Route path="/gestionar" element={<Gestionar />} />
            <Route path="/google-calendar-success" element={<GoogleCalendarSuccess />} />

            {/* Admin routes */}
            <Route
              element={
                <ProtectedRoute allowedRoles={["admin", "superadmin"]}>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/admin/calendario" element={<Calendario />} />
              <Route path="/admin/reservas" element={<Reservas />} />
              <Route path="/admin/doctores" element={<Doctores />} />
              <Route path="/admin/catalogos" element={<Catalogos />} />
              <Route path="/admin/inbox" element={<AdminInbox />} />
              <Route path="/admin/webhooks" element={<Webhooks />} />
              <Route path="/admin/api-keys" element={<ApiKeysPage />} />
            </Route>

            {/* Doctor routes */}
            <Route
              element={
                <ProtectedRoute allowedRoles={["doctor"]}>
                  <DoctorLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/doctor/agenda" element={<Agenda />} />
              <Route path="/doctor/configuracion" element={<Configuracion />} />
              <Route path="/doctor/por-completar" element={<PorCompletar />} />
              <Route path="/doctor/inbox" element={<DoctorInbox />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
