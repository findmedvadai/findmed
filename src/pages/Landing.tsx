import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Building2, CalendarSync, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import Footer from "@/components/Footer";

/**
 * Landing page pública de FindMed — ruta raíz "/".
 *
 * Requisito de la verificación OAuth de Google: la homepage debe ser accesible
 * sin login y explicar qué hace la app. Por eso esta página:
 *  - NO está dentro de ProtectedRoute (ver App.tsx) y es accesible sin sesión.
 *  - NO hace fetch a Supabase ni depende del estado de carga del auth para
 *    renderizar; pinta de inmediato para que Googlebot la indexe rápido.
 *
 * Nota sobre "server-rendered": FindMed es un SPA con Vite (no hay SSR). El
 * snapshot estático para crawlers vive en los meta tags de index.html (title +
 * description en español). Aquí solo se refuerza el document.title en runtime.
 *
 * El estado de auth se lee de forma opcional (sin bloquear el render) solo para
 * decidir si el CTA dice "Iniciar sesión" o "Ir al dashboard".
 */

const FEATURES = [
  {
    icon: LayoutDashboard,
    title: "Gestión centralizada",
    description:
      "Agenda, confirma, cancela y da seguimiento a tus consultas y citas desde una sola interfaz, sin papeles ni hojas de cálculo.",
  },
  {
    icon: CalendarSync,
    title: "Sincronización con tu calendario",
    description:
      "Conexión bidireccional con Google Calendar y Outlook Calendar: tus citas y tus eventos personales siempre en un mismo lugar.",
  },
  {
    icon: Building2,
    title: "Múltiples consultorios",
    description:
      "Administra varios consultorios con su propia dirección, horario y calendario, todo bajo un mismo perfil de doctor.",
  },
];

export default function Landing() {
  const { session, role } = useAuth();
  const isAuthenticated = Boolean(session && role);
  const dashboardPath = role === "doctor" ? "/doctor/agenda" : "/admin/calendario";

  useEffect(() => {
    const previous = document.title;
    document.title = "FindMed — Agendamiento médico inteligente para doctores";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="text-xl font-bold text-primary">
            FindMed
          </Link>
          {isAuthenticated ? (
            <Button asChild variant="outline">
              <Link to={dashboardPath}>Ir al dashboard</Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to="/login">Iniciar sesión</Link>
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-secondary/30">
          <div className="container flex flex-col items-center gap-6 py-20 text-center md:py-28">
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-primary sm:text-5xl">
              Agendamiento médico inteligente para doctores
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              FindMed es una plataforma SaaS de agendamiento médico para doctores en México.
            </p>
            <Button
              asChild
              size="lg"
              className="bg-cta text-cta-foreground hover:bg-cta/90"
            >
              <Link to={isAuthenticated ? dashboardPath : "/login"}>
                {isAuthenticated ? "Ir al dashboard" : "Iniciar sesión"}
              </Link>
            </Button>
          </div>
        </section>

        {/* Funcionalidades */}
        <section className="container py-16 md:py-20">
          <h2 className="mb-10 text-center text-2xl font-bold text-primary sm:text-3xl">
            Todo lo que necesitas para gestionar tus citas
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <Card key={title} className="h-full border-border">
                <CardHeader className="gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-lg text-primary">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
