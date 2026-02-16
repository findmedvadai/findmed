import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, Copy, Key } from "lucide-react";
import PasswordGate from "@/components/admin/PasswordGate";

function generateApiKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz0123456789";
  let key = "fm_";
  for (let i = 0; i < 40; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function ApiKeys() {
  return (
    <PasswordGate>
      <ApiKeysContent />
    </PasswordGate>
  );
}

function ApiKeysContent() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const { data: apiKeys, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const rawKey = generateApiKey();
      const hash = await hashKey(rawKey);
      const { error } = await supabase.from("api_keys").insert({
        name: keyName.trim(),
        key_hash: hash,
        key_prefix: rawKey.substring(0, 10),
      } as any);
      if (error) throw error;
      return rawKey;
    },
    onSuccess: (key) => {
      setRevealedKey(key);
      setCreateOpen(false);
      setKeyName("");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast({ title: "API Key creada" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("api_keys")
        .update({ is_active } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("api_keys").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast({ title: "API Key revocada" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Key className="h-6 w-6" />
            API Keys
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestiona las claves de acceso a la API de la plataforma.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Crear API Key
        </Button>
      </div>

      {apiKeys && apiKeys.length > 0 ? (
        <div className="space-y-3">
          {apiKeys.map((ak: any) => (
            <Card key={ak.id}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{ak.name}</p>
                    <Badge variant={ak.is_active ? "default" : "secondary"} className="text-[10px]">
                      {ak.is_active ? "Activa" : "Inactiva"}
                    </Badge>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground">
                    {ak.key_prefix}•••••••••
                  </p>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>Creada: {format(parseISO(ak.created_at), "d MMM yyyy", { locale: es })}</span>
                    {ak.last_used_at && (
                      <span>Último uso: {format(parseISO(ak.last_used_at), "d MMM yyyy", { locale: es })}</span>
                    )}
                  </div>
                </div>
                <Switch
                  checked={ak.is_active}
                  onCheckedChange={(checked) =>
                    toggleMut.mutate({ id: ak.id, is_active: checked })
                  }
                />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Revocar API Key?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción no se puede deshacer. Los servicios que usen esta clave dejarán de funcionar.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteMut.mutate(ak.id)}>
                        Revocar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Key className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-lg font-medium text-muted-foreground">Sin API Keys</p>
            <p className="text-sm text-muted-foreground/70">
              Crea una API Key para integrar servicios externos.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Crear API Key</DialogTitle>
            <DialogDescription>
              Asigna un nombre descriptivo a esta clave.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Ej: n8n Producción"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => createMut.mutate()}
                disabled={!keyName.trim() || createMut.isPending}
              >
                {createMut.isPending ? "Creando…" : "Crear"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Key reveal dialog */}
      <Dialog open={!!revealedKey} onOpenChange={() => setRevealedKey(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tu API Key</DialogTitle>
            <DialogDescription>
              Copia esta clave ahora. No se volverá a mostrar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted p-2 rounded text-sm break-all font-mono">
              {revealedKey}
            </code>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(revealedKey ?? "");
                toast({ title: "Copiado al portapapeles" });
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
