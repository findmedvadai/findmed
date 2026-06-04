import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  CalendarSync,
  LayoutDashboard,
  ShieldCheck,
  Lock,
  Cloud,
  FileCheck2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Footer from "@/components/Footer";

/**
 * Landing page pública de FindMed — ruta raíz "/".
 *
 * Requisito de la verificación OAuth de Google: la homepage debe ser accesible
 * sin login y explicar qué hace la app. Por eso esta página:
 *  - NO está dentro de ProtectedRoute (ver App.tsx) y es accesible sin sesión.
 *  - Es 100% estática: NO importa useAuth, NO lee contexto de autenticación y
 *    NO hace fetch a Supabase. Pinta de inmediato para que Googlebot la indexe.
 *
 * CTA: SIEMPRE "Iniciar sesión" → /login, sin importar el estado de auth. La
 * landing nunca da acceso directo a rutas autenticadas. Si el usuario ya tiene
 * sesión, el propio /login (comportamiento estándar de la app) lo redirige a su
 * dashboard. No duplicamos esa lógica aquí (ver ERRORES.md 2026-06-04: el CTA
 * "Ir al dashboard" bypaseaba el login).
 *
 * Nota sobre "server-rendered": FindMed es un SPA con Vite (no hay SSR). El
 * snapshot estático para crawlers vive en los meta tags de index.html (title +
 * description en español). Aquí solo se refuerza el document.title en runtime.
 */

const FEATURES = [
  {
    step: "01",
    icon: LayoutDashboard,
    title: "Gestión centralizada",
    description:
      "Agenda, confirma, cancela y da seguimiento a tus consultas y citas desde una sola interfaz, sin papeles ni hojas de cálculo.",
  },
  {
    step: "02",
    icon: CalendarSync,
    title: "Sincronización con tu calendario",
    description:
      "Conexión bidireccional con Google Calendar y Outlook Calendar: tus citas y tus eventos personales siempre en un mismo lugar.",
  },
  {
    step: "03",
    icon: Building2,
    title: "Múltiples consultorios",
    description:
      "Administra varios consultorios con su propia dirección, horario y calendario, todo bajo un mismo perfil de doctor.",
  },
];

const TRUST_ITEMS = [
  {
    icon: FileCheck2,
    title: "Cumplimiento normativo",
    description:
      "Alineado con la Ley General de Salud (Capítulo VI Bis, salud digital) y la LFPDPPP.",
  },
  {
    icon: Lock,
    title: "Datos encriptados",
    description: "Información clínica y personal cifrada en tránsito y en reposo.",
  },
  {
    icon: Cloud,
    title: "Respaldos en la nube",
    description: "Backups automáticos sobre infraestructura segura y redundante.",
  },
  {
    icon: ShieldCheck,
    title: "Privacidad del paciente",
    description: "Acceso por roles y tokens temporales; sin exponer datos sensibles.",
  },
];

/** Ilustración SVG de un calendario médico, con los colores de marca. */
function HeroIllustration() {
  return (
    <svg
      viewBox="0 0 480 400"
      role="img"
      aria-label="Ilustración de un calendario de citas médicas"
      className="h-auto w-full max-w-md drop-shadow-xl"
    >
      {/* Halo de fondo */}
      <circle cx="360" cy="90" r="70" className="fill-cta/10" />
      <circle cx="90" cy="330" r="56" className="fill-primary/10" />

      {/* Tarjeta principal del calendario */}
      <rect x="60" y="60" width="320" height="280" rx="20" className="fill-white" stroke="hsl(var(--border))" strokeWidth="2" />

      {/* Encabezado del calendario */}
      <rect x="60" y="60" width="320" height="56" rx="20" className="fill-primary" />
      <rect x="60" y="96" width="320" height="20" className="fill-primary" />
      <circle cx="92" cy="88" r="9" className="fill-white/90" />
      <path d="M92 83 v10 M87 88 h10" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="116" y="82" width="120" height="12" rx="6" className="fill-white/80" />

      {/* Etiquetas de días */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={`d${i}`} x={84 + i * 40} y="134" width="22" height="8" rx="4" className="fill-muted-foreground/40" />
      ))}

      {/* Cuadrícula de fechas */}
      {Array.from({ length: 21 }).map((_, i) => {
        const col = i % 7;
        const row = Math.floor(i / 7);
        const x = 82 + col * 40;
        const y = 158 + row * 42;
        return <rect key={`c${i}`} x={x} y={y} width="28" height="30" rx="8" className="fill-secondary" />;
      })}

      {/* Slots destacados: confirmado (azul) y urgente (rojo) */}
      <rect x="162" y="200" width="28" height="30" rx="8" className="fill-primary" />
      <rect x="282" y="242" width="28" height="30" rx="8" className="fill-cta" />

      {/* Chip flotante de cita confirmada */}
      <g className="drop-shadow-lg">
        <rect x="250" y="280" width="180" height="74" rx="16" className="fill-white" stroke="hsl(var(--border))" strokeWidth="2" />
        <rect x="262" y="292" width="6" height="50" rx="3" className="fill-confirmed" />
        <circle cx="292" cy="306" r="13" className="fill-primary/15" />
        <path d="M286 306 l4 4 l8 -9" stroke="hsl(var(--confirmed))" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="314" y="300" width="100" height="10" rx="5" className="fill-foreground/80" />
        <rect x="314" y="320" width="70" height="8" rx="4" className="fill-muted-foreground/50" />
      </g>
    </svg>
  );
}

export default function Landing() {
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
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="text-xl font-bold tracking-tight text-primary">
            FindMed
          </Link>
          <Button asChild variant="outline">
            <Link to="/login">Iniciar sesión</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-secondary/40 to-background">
          <div className="container grid items-center gap-12 py-20 md:grid-cols-2 md:py-28">
            <div className="flex flex-col items-start gap-6 text-left">
              <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                Plataforma SaaS de agendamiento médico
              </span>
              <h1 className="text-4xl font-bold leading-tight tracking-tight text-primary sm:text-5xl">
                Agendamiento médico inteligente para doctores
              </h1>
              <p className="max-w-xl text-lg text-muted-foreground">
                FindMed es una plataforma SaaS de agendamiento médico para doctores en México.
              </p>
              <Button
                asChild
                size="lg"
                className="bg-cta text-cta-foreground shadow-sm hover:bg-cta/90"
              >
                <Link to="/login">Iniciar sesión</Link>
              </Button>
            </div>
            <div className="flex justify-center md:justify-end">
              <HeroIllustration />
            </div>
          </div>
        </section>

        {/* Funcionalidades */}
        <section className="container py-16 md:py-24">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
              Todo lo que necesitas para gestionar tus citas
            </h2>
            <p className="mt-3 text-muted-foreground">
              Una sola herramienta para tu agenda, tus consultorios y tu calendario.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, description, step }) => (
              <Card
                key={title}
                className="group relative h-full border-border transition-all duration-200 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg"
              >
                <span className="pointer-events-none absolute right-5 top-5 text-3xl font-bold text-primary/10">
                  {step}
                </span>
                <CardHeader className="gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm transition-transform duration-200 group-hover:scale-105">
                    <Icon className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-lg text-primary">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Confianza y seguridad */}
        <section className="bg-primary text-primary-foreground">
          <div className="container py-16 md:py-20">
            <div className="mx-auto mb-10 max-w-2xl text-center">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Confianza y seguridad
              </h2>
              <p className="mt-3 text-primary-foreground/80">
                Construido para proteger la información clínica y cumplir con la
                normativa mexicana de salud digital y protección de datos.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {TRUST_ITEMS.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/5 p-5"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-foreground/10">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-primary-foreground/75">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
