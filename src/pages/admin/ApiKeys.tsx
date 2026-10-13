// API Keys (Configuración): llaves `fm_` con las que sistemas externos llaman
// a los endpoints de FindMed. Solo se guarda el hash SHA-256 y el prefijo; la
// llave completa se muestra una sola vez al crearla.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { AlertTriangle, Copy, Key, Plus, Trash2 } from "lucide-react";
import PasswordGate from "@/components/admin/PasswordGate";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { SoftBadge } from "@/components/app/StatusBadge";
import { cn } from "@/lib/utils";
import { secureRandomString } from "@/lib/secure-random";

function generateApiKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz0123456789";
  return "fm_" + secureRandomString(chars, 40);
}

async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const fmtDate = (iso: string) => format(parseISO(iso), "d MMM yyyy", { locale: es });

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
      });
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
        .update({ is_active })
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

  const canCreate = !!keyName.trim() && !createMut.isPending;
  const keys = apiKeys ?? [];
  const activeCount = keys.filter((k) => k.is_active).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="API Keys"
        description={
          <>
            Llaves <code className="rounded bg-muted px-1 font-mono text-xs">fm_</code> para que sistemas externos llamen a la API de
            FindMed. Solo se guarda su hash: la llave completa se ve una sola vez.
          </>
        }
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Nueva API key
          </Button>
        }
      />

      {isLoading ? (
        <Card className="overflow-hidden">
          <div className="h-9 border-b bg-muted/40" />
          <div className="space-y-2 p-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        </Card>
      ) : keys.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Llaves emitidas</h2>
            <span className="text-xs text-muted-foreground">
              {keys.length} en total · {activeCount} {activeCount === 1 ? "activa" : "activas"}
            </span>
          </div>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="h-9 text-xs">Nombre</TableHead>
                  <TableHead className="hidden h-9 text-xs sm:table-cell">Llave</TableHead>
                  <TableHead className="hidden h-9 text-xs md:table-cell">Creada</TableHead>
                  <TableHead className="hidden h-9 text-xs md:table-cell">Último uso</TableHead>
                  <TableHead className="h-9 text-xs">Estado</TableHead>
                  <TableHead className="h-9 w-[52px] text-xs"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((ak) => (
                  <TableRow key={ak.id} className={cn(!ak.is_active && "text-muted-foreground")}>
                    <TableCell className="py-2.5">
                      <div className="min-w-0 max-w-[150px] sm:max-w-[200px] lg:max-w-[240px]">
                        <p className={cn("truncate text-sm font-medium", ak.is_active ? "text-foreground" : "text-muted-foreground")}>{ak.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground sm:hidden">{ak.key_prefix}•••</p>
                        <p className="truncate text-xs text-muted-foreground md:hidden">
                          {ak.last_used_at ? `Último uso ${fmtDate(ak.last_used_at)}` : "Sin uso"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden py-2.5 sm:table-cell">
                      <code className="whitespace-nowrap rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {ak.key_prefix}•••••••••
                      </code>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap py-2.5 text-xs text-muted-foreground md:table-cell">
                      {fmtDate(ak.created_at)}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap py-2.5 text-xs text-muted-foreground md:table-cell">
                      {ak.last_used_at ? fmtDate(ak.last_used_at) : <span className="text-muted-foreground/70">Nunca</span>}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={ak.is_active}
                          onCheckedChange={(checked) =>
                            toggleMut.mutate({ id: ak.id, is_active: checked })
                          }
                          className="scale-90"
                          aria-label={ak.is_active ? `Desactivar ${ak.name}` : `Activar ${ak.name}`}
                        />
                        <SoftBadge tone={ak.is_active ? "success" : "neutral"} className="hidden sm:inline-flex">
                          {ak.is_active ? "Activa" : "Inactiva"}
                        </SoftBadge>
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5 text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            aria-label={`Revocar ${ak.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Revocar "{ak.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta acción no se puede deshacer. Los servicios que usen esta clave dejarán de funcionar. Si solo quieres
                              suspenderla, usa el interruptor.
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      ) : (
        <EmptyState
          icon={Key}
          title="Sin API keys"
          description="Crea una para que un sistema externo (bot, n8n u otro orquestador) pueda llamar a FindMed."
          action={
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Nueva API key
            </Button>
          }
        />
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva API key</DialogTitle>
            <DialogDescription>
              Ponle un nombre que diga qué sistema la usa. La llave se muestra una sola vez al crearla.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canCreate) createMut.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="api-key-name" className="text-xs font-medium text-foreground">Nombre</Label>
              <Input
                id="api-key-name"
                className="h-9 text-sm"
                placeholder="Ej: n8n Producción"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                autoFocus
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={!canCreate}>
                {createMut.isPending ? "Creando…" : "Crear API key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Key reveal dialog */}
      <Dialog open={!!revealedKey} onOpenChange={() => setRevealedKey(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tu nueva API key</DialogTitle>
            <DialogDescription>
              Cópiala ahora y guárdala en el sistema que la va a usar: no se volverá a mostrar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
            <code className="min-w-0 flex-1 break-all px-1 font-mono text-sm text-foreground">
              {revealedKey}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={() => {
                navigator.clipboard.writeText(revealedKey ?? "");
                toast({ title: "Copiado al portapapeles" });
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copiar
            </Button>
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
            Se envía como <code className="rounded bg-muted px-1 font-mono">Authorization: Bearer fm_…</code>. Si la pierdes, revócala y crea otra.
          </p>
          <DialogFooter>
            <Button size="sm" onClick={() => setRevealedKey(null)}>Listo, ya la guardé</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
