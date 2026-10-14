import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  hasValidSettingsUnlock,
  saveSettingsUnlock,
  settingsUnlockErrorMessage,
} from "@/lib/settings-unlock";

/**
 * Pide al admin conectado que confirme la contraseña de SU cuenta antes de
 * entrar a una sección sensible (webhooks, API keys). Ya no hay una contraseña
 * compartida en el código: la verifica Supabase Auth. El desbloqueo dura 30
 * minutos en esta pestaña (ver lib/settings-unlock.ts) y se revisa al entrar a
 * la sección: si vence con la sección abierta no se cierra a media edición.
 */
export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const email = user?.email ?? null;

  // Cuenta para la que esta vista quedó desbloqueada.
  const [unlockedUserId, setUnlockedUserId] = useState<string | null>(() =>
    userId && hasValidSettingsUnlock(userId) ? userId : null
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Si la cuenta llega después del primer render (o cambia), revisar su desbloqueo.
  useEffect(() => {
    if (userId && unlockedUserId !== userId && hasValidSettingsUnlock(userId)) {
      setUnlockedUserId(userId);
    }
  }, [userId, unlockedUserId]);

  const unlocked = !!userId && unlockedUserId === userId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifying || !password) return;
    if (!userId || !email) {
      setError("Tu cuenta no tiene un correo para confirmar. Cierra sesión y vuelve a entrar.");
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      // Re-autenticación con la cuenta ya conectada: si la contraseña es
      // correcta Supabase renueva la sesión del mismo usuario.
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError || data.user?.id !== userId) {
        setError(settingsUnlockErrorMessage(authError));
        return;
      }
      saveSettingsUnlock(userId);
      setUnlockedUserId(userId);
      setPassword("");
    } catch {
      setError(settingsUnlockErrorMessage(null));
    } finally {
      setVerifying(false);
    }
  };

  if (unlocked) return <>{children}</>;

  return (
    <div className="flex justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center space-y-2 p-6 pb-4 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <CardTitle className="text-base font-semibold">Sección protegida</CardTitle>
          <CardDescription className="text-sm">
            Confirma tu contraseña para entrar a esta sección.
          </CardDescription>
          {email && (
            <p className="text-xs text-muted-foreground">
              Cuenta: <span className="font-medium text-foreground">{email}</span>
            </p>
          )}
        </CardHeader>
        <CardContent className="p-6 pt-0">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="settings-password" className="sr-only">Tu contraseña</Label>
              <Input
                id="settings-password"
                type="password"
                autoComplete="current-password"
                placeholder="Tu contraseña"
                className="h-9 text-sm"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                disabled={verifying}
                aria-invalid={!!error}
                aria-describedby={error ? "settings-password-error" : undefined}
                autoFocus
              />
              {error && (
                <p id="settings-password-error" role="alert" className="text-xs text-destructive">{error}</p>
              )}
            </div>
            <Button type="submit" size="sm" className="w-full" disabled={verifying || !password}>
              {verifying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verificando…
                </>
              ) : (
                "Desbloquear"
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              El acceso se mantiene 30 minutos en esta pestaña.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
