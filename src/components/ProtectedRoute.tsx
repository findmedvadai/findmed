import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface Props {
  allowedRoles: AppRole[];
  children: React.ReactNode;
}

/** Tiempo máximo esperando el rol del usuario antes de mostrar el aviso. */
export const ROLE_TIMEOUT_MS = 10_000;

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Cargando">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

export default function ProtectedRoute({ allowedRoles, children }: Props) {
  const { session, role, loading } = useAuth();
  // Con sesión pero sin rol todavía (useAuth lo lee de public.users después de
  // la sesión): esperar. Antes se pintaba el panel pedido con role = null y un
  // doctor alcanzaba a ver el panel del admin (y a disparar sus consultas) antes
  // de ser redirigido.
  const waitingRole = !loading && !!session && !role;
  const [roleTimedOut, setRoleTimedOut] = useState(false);

  useEffect(() => {
    if (!waitingRole) {
      setRoleTimedOut(false);
      return;
    }
    const t = setTimeout(() => setRoleTimedOut(true), ROLE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [waitingRole]);

  if (loading) return <Spinner />;

  if (!session) return <Navigate to="/login" replace />;

  if (!role) {
    if (!roleTimedOut) return <Spinner />;
    // Cuenta sin rol en public.users (o no se pudo leer): nunca mostrar un panel.
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted px-4">
        <div className="max-w-sm text-center">
          <h1 className="mb-2 text-xl font-semibold text-foreground">No pudimos cargar tu perfil</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Revisa tu conexión e inicia sesión de nuevo. Si el problema sigue, pide al administrador que revise tu cuenta.
          </p>
          <Button asChild>
            <Link to="/login">Iniciar sesión de nuevo</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!allowedRoles.includes(role)) {
    const dest = role === "doctor" ? "/doctor/inicio" : "/admin/inicio";
    return <Navigate to={dest} replace />;
  }

  return <>{children}</>;
}
