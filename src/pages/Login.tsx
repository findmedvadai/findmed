import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

export default function Login() {
  const { session, role, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Gates the post-login redirect: only flips true after the on-mount session
  // check completes (and a forced signOut runs if there was a stale session).
  // Prevents the redirect effect from firing immediately on mount with the
  // persisted session, which would defeat the forced re-auth.
  const [readyToRedirect, setReadyToRedirect] = useState(false);

  // Force re-authentication on mount. Anyone landing on /login must enter
  // credentials, even if a session is persisted in localStorage. Security
  // guarantee for shared computers.
  useEffect(() => {
    if (loading) return;

    if (session) {
      signOut()
        .catch((err) => console.error("Forced signOut on /login failed:", err))
        .finally(() => {
          toast.info("Sesión cerrada. Ingresa tus credenciales para continuar.");
          setReadyToRedirect(true);
        });
    } else {
      setReadyToRedirect(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Redirect after a successful login. Gated on readyToRedirect so the
  // on-mount session never triggers it.
  useEffect(() => {
    if (!readyToRedirect) return;
    if (session && role) {
      navigate(role === "doctor" ? "/doctor/agenda" : "/admin/calendario", { replace: true });
    }
  }, [readyToRedirect, session, role, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError("Credenciales inválidas. Intenta de nuevo.");
      setSubmitting(false);
    }
    // redirect handled by useEffect above once role loads
  };

  // Show spinner during initial auth check or while the forced signOut runs.
  if (loading || (session && !readyToRedirect)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/30 px-4">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="items-center gap-1 pb-2">
          <h1 className="text-2xl font-bold text-primary">FindMed</h1>
          <p className="text-sm text-muted-foreground">Inicia sesión en tu cuenta</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                required
                autoComplete="email"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              disabled={submitting}
              className="bg-cta text-cta-foreground hover:bg-cta/90"
            >
              {submitting ? "Ingresando…" : "Iniciar Sesión"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
