import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "findmed_settings_unlocked";
const PASSWORD = "Vadai123!";

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
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
    });
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

  return (
    <Dialog open={true}>
      <DialogContent className="sm:max-w-sm" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Acceso protegido
          </DialogTitle>
          <DialogDescription>
            Ingresa la contraseña para acceder a esta sección.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            placeholder="Contraseña"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(false);
            }}
            autoFocus
          />
          {error && (
            <p className="text-sm text-destructive">Contraseña incorrecta</p>
          )}
          <Button type="submit" className="w-full">
            Acceder
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
