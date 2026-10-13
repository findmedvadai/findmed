import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "findmed_settings_unlocked";
const PASSWORD = "Vadai123!";

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const sessionId = data.session?.access_token ?? null;
      if (!sessionId) return;
      try {
        const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
        if (stored.unlocked && stored.sessionId === sessionId) {
          setUnlocked(true);
        }
      } catch {
        // ignore malformed storage
      }
    }).finally(() => setChecking(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input === PASSWORD) {
      const { data } = await supabase.auth.getSession();
      const sessionId = data.session?.access_token ?? "";
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ unlocked: true, sessionId }));
      setUnlocked(true);
      setError(false);
    } else {
      setError(true);
    }
  };

  if (unlocked) return <>{children}</>;

  // Evita el parpadeo del candado mientras se revisa si ya se desbloqueó en esta sesión.
  if (checking) {
    return (
      <div className="flex justify-center px-4 py-12">
        <Skeleton className="h-[236px] w-full max-w-sm rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center space-y-2 p-6 pb-4 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <CardTitle className="text-base font-semibold">Sección protegida</CardTitle>
          <CardDescription className="text-sm">
            Ingresa la contraseña de configuración para continuar.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="settings-password" className="sr-only">Contraseña</Label>
              <Input
                id="settings-password"
                type="password"
                placeholder="Contraseña"
                className="h-9 text-sm"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError(false);
                }}
                aria-invalid={error}
                aria-describedby={error ? "settings-password-error" : undefined}
                autoFocus
              />
              {error && (
                <p id="settings-password-error" className="text-xs text-destructive">Contraseña incorrecta</p>
              )}
            </div>
            <Button type="submit" size="sm" className="w-full">
              Desbloquear
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
