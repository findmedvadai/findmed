// Configuración → Usuarios: las cuentas del equipo que entran al panel de
// administración. Se crean aquí con la contraseña que define el admin (el
// registro público está desactivado; no hay invitaciones por correo). Lectura y
// escrituras por la Edge Function admin-users. Los médicos se gestionan en Doctores.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Copy, Eye, EyeOff, KeyRound, MoreHorizontal, Power, Sparkles, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { LoadError } from "@/components/app/LoadError";
import { SoftBadge } from "@/components/app/StatusBadge";
import type { Tone } from "@/components/app/StatCard";
import { toast } from "@/hooks/use-toast";
import { userErrorMessage } from "@/lib/edge-function-error";
import { formatMx } from "@/lib/timezone";
import {
  accessShareText,
  ADMIN_USERS_KEY,
  adminUsersAction,
  generatePassword,
  isValidEmail,
  LOGIN_URL,
  passwordProblem,
  ROLE_LABEL,
  type TeamRole,
  type TeamUser,
  type TeamUsersList,
} from "@/lib/admin-users";

const STATUS: Record<TeamUser["status"], { label: string; tone: Tone }> = {
  active: { label: "Activo", tone: "success" },
  disabled: { label: "Desactivado", tone: "danger" },
  unknown: { label: "Sin verificar", tone: "warning" },
};

const lastAccess = (iso: string | null) => (iso ? formatMx(parseISO(iso), "d MMM yyyy, HH:mm", { locale: es }) : "Nunca");
const onError = (title: string) => (e: Error) =>
  toast({ title, description: userErrorMessage(e, "No se pudo completar la acción."), variant: "destructive" });

interface SharedAccess {
  email: string;
  password: string;
  title: string;
}

export default function Usuarios() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ADMIN_USERS_KEY,
    queryFn: () => adminUsersAction<TeamUsersList>({ action: "list" }),
    placeholderData: keepPreviousData,
    meta: { silentError: true },
  });
  const [creating, setCreating] = useState(false);
  const [passwordFor, setPasswordFor] = useState<TeamUser | null>(null);
  const [toggleFor, setToggleFor] = useState<TeamUser | null>(null);
  const [shared, setShared] = useState<SharedAccess | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY });

  const toggle = useMutation({
    mutationFn: (u: TeamUser) =>
      adminUsersAction<{ active: boolean; sessions_closed: boolean }>({ action: "set_active", user_id: u.id, active: u.status === "disabled" }),
    onSuccess: (res) => {
      refresh();
      toast(
        res.active
          ? { title: "Acceso reactivado", description: "Puede volver a entrar con su contraseña actual." }
          : {
              title: "Acceso desactivado",
              description: res.sessions_closed
                ? "Ya no puede entrar al panel y sus sesiones abiertas se cerraron."
                : "Ya no puede entrar al panel. Si tenía una sesión abierta, se cerrará sola en máximo 1 hora.",
            },
      );
    },
    onError: onError("No se pudo cambiar el acceso"),
    onSettled: () => setToggleFor(null),
  });

  const users = data?.users;
  const viewerIsSuper = data?.viewer.is_superadmin ?? false;
  const canManage = (u: TeamUser) => u.role !== "superadmin" || viewerIsSuper || u.is_self;
  const disabling = toggleFor?.status !== "disabled";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios del equipo"
        description={
          <>
            Cuentas que entran al panel de administración. Tú defines la contraseña y la compartes con la persona. Los médicos se gestionan en{" "}
            <Link to="/admin/doctores" className="font-medium text-primary underline-offset-4 hover:underline">
              Doctores
            </Link>
            .
          </>
        }
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)} disabled={!data}>
            <UserPlus className="h-4 w-4" /> Nuevo usuario
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError && !data ? (
        <LoadError what="los usuarios del equipo" onRetry={() => refetch()} retrying={isFetching} />
      ) : !users || users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Aún no hay usuarios del equipo"
          description="Crea una cuenta para cada persona que necesite entrar al panel."
          action={
            <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
              <UserPlus className="h-4 w-4" /> Nuevo usuario
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Último acceso</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    <span className="break-all">{u.email ?? "Sin correo"}</span>
                    {u.is_self && (
                      <SoftBadge tone="info" className="ml-2">
                        Tú
                      </SoftBadge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{ROLE_LABEL[u.role] ?? u.role}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{lastAccess(u.last_sign_in_at)}</TableCell>
                  <TableCell>
                    <SoftBadge tone={STATUS[u.status].tone} dot>
                      {STATUS[u.status].label}
                    </SoftBadge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage(u) && (
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Acciones para ${u.email ?? "usuario"}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem className="gap-2" onClick={() => setPasswordFor(u)}>
                            <KeyRound className="h-4 w-4" /> Cambiar contraseña
                          </DropdownMenuItem>
                          {!u.is_self && (
                            <DropdownMenuItem
                              className={u.status === "disabled" ? "gap-2" : "gap-2 text-destructive focus:text-destructive"}
                              onClick={() => setToggleFor(u)}
                            >
                              <Power className="h-4 w-4" /> {u.status === "disabled" ? "Reactivar acceso" : "Desactivar acceso"}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateUserDialog
        open={creating}
        allowSuperadmin={viewerIsSuper}
        onClose={() => setCreating(false)}
        onCreated={(email, password) => {
          refresh();
          setCreating(false);
          setShared({ email, password, title: "Usuario creado" });
        }}
      />

      <ChangePasswordDialog
        user={passwordFor}
        onClose={() => setPasswordFor(null)}
        onChanged={(email, password) => {
          setPasswordFor(null);
          setShared({ email, password, title: "Contraseña actualizada" });
        }}
      />

      <ShareAccessDialog access={shared} onClose={() => setShared(null)} />

      <AlertDialog open={!!toggleFor} onOpenChange={(o) => !o && !toggle.isPending && setToggleFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{disabling ? "¿Desactivar el acceso?" : "¿Reactivar el acceso?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {disabling
                ? `${toggleFor?.email ?? "Esta persona"} ya no podrá entrar al panel y sus sesiones abiertas se cerrarán. Su cuenta no se borra: puedes reactivarla cuando quieras.`
                : `${toggleFor?.email ?? "Esta persona"} podrá volver a entrar al panel con su contraseña actual.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggle.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={disabling ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              disabled={toggle.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (toggleFor) toggle.mutate(toggleFor);
              }}
            >
              {toggle.isPending ? "Guardando…" : disabling ? "Desactivar acceso" : "Reactivar acceso"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────── Contraseña con mostrar/ocultar, generar y confirmación ───────── */

interface PasswordState {
  password: string;
  confirm: string;
  visible: boolean;
}
const EMPTY_PASSWORD: PasswordState = { password: "", confirm: "", visible: false };

function passwordErrors(p: PasswordState): { password: string | null; confirm: string | null } {
  return {
    password: passwordProblem(p.password),
    confirm: p.confirm && p.confirm !== p.password ? "Las contraseñas no coinciden." : !p.confirm ? "Confirma la contraseña." : null,
  };
}

function PasswordFields({ value, onChange, showErrors }: { value: PasswordState; onChange: (v: PasswordState) => void; showErrors: boolean }) {
  const errors = passwordErrors(value);
  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="team-password">Contraseña</Label>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto gap-1 p-0 text-xs"
            onClick={() => {
              const generated = generatePassword();
              onChange({ password: generated, confirm: generated, visible: true });
            }}
          >
            <Sparkles className="h-3.5 w-3.5" /> Generar
          </Button>
        </div>
        <div className="relative">
          <Input
            id="team-password"
            type={value.visible ? "text" : "password"}
            autoComplete="new-password"
            className="pr-10 font-mono"
            value={value.password}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full w-10 text-muted-foreground"
            aria-label={value.visible ? "Ocultar contraseña" : "Mostrar contraseña"}
            onClick={() => onChange({ ...value, visible: !value.visible })}
          >
            {value.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
        <FieldHint error={showErrors ? errors.password : null}>Al menos 8 caracteres, con letras y números.</FieldHint>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="team-password-confirm">Confirmar contraseña</Label>
        <Input
          id="team-password-confirm"
          type={value.visible ? "text" : "password"}
          autoComplete="new-password"
          className="font-mono"
          value={value.confirm}
          onChange={(e) => onChange({ ...value, confirm: e.target.value })}
        />
        {showErrors && errors.confirm && <p className="text-xs text-destructive">{errors.confirm}</p>}
      </div>
    </>
  );
}

function FieldHint({ error, children }: { error: string | null; children: ReactNode }) {
  return <p className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{error ?? children}</p>;
}

/* ───────── Nuevo usuario ───────── */

function CreateUserDialog({
  open,
  allowSuperadmin,
  onClose,
  onCreated,
}: {
  open: boolean;
  allowSuperadmin: boolean;
  onClose: () => void;
  onCreated: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("admin");
  const [pw, setPw] = useState<PasswordState>(EMPTY_PASSWORD);
  const [submitted, setSubmitted] = useState(false);

  const reset = () => {
    setEmail("");
    setRole("admin");
    setPw(EMPTY_PASSWORD);
    setSubmitted(false);
  };

  const create = useMutation({
    mutationFn: (v: { email: string; password: string; role: TeamRole }) =>
      adminUsersAction<{ user: { email: string } }>({ action: "create", ...v }),
    onSuccess: (res, v) => {
      onCreated(res.user.email, v.password);
      reset();
    },
    onError: onError("No se pudo crear el usuario"),
  });

  const emailError = !isValidEmail(email) ? "Escribe un correo válido (ej. nombre@findmed.com.mx)." : null;
  const errors = passwordErrors(pw);
  const valid = !emailError && !errors.password && !errors.confirm;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !create.isPending) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo usuario del equipo</DialogTitle>
          <DialogDescription>Podrá entrar al panel de administración con este correo y contraseña. No se envía ningún correo.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (valid) create.mutate({ email: email.trim().toLowerCase(), password: pw.password, role });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="team-email">Correo</Label>
            <Input id="team-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            {submitted && emailError && <p className="text-xs text-destructive">{emailError}</p>}
          </div>
          {allowSuperadmin && (
            <div className="space-y-1.5">
              <Label htmlFor="team-role">Rol</Label>
              <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
                <SelectTrigger id="team-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{ROLE_LABEL.admin}</SelectItem>
                  <SelectItem value="superadmin">{ROLE_LABEL.superadmin}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <PasswordFields value={pw} onChange={setPw} showErrors={submitted} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={create.isPending}
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creando…" : "Crear usuario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ───────── Cambiar contraseña ───────── */

function ChangePasswordDialog({
  user,
  onClose,
  onChanged,
}: {
  user: TeamUser | null;
  onClose: () => void;
  onChanged: (email: string, password: string) => void;
}) {
  const [pw, setPw] = useState<PasswordState>(EMPTY_PASSWORD);
  const [submitted, setSubmitted] = useState(false);
  const reset = () => {
    setPw(EMPTY_PASSWORD);
    setSubmitted(false);
  };

  const change = useMutation({
    mutationFn: (v: { user: TeamUser; password: string }) =>
      adminUsersAction({ action: "set_password", user_id: v.user.id, password: v.password }),
    onSuccess: (_r, v) => {
      onChanged(v.user.email ?? "", v.password);
      reset();
    },
    onError: onError("No se pudo cambiar la contraseña"),
  });
  const errors = passwordErrors(pw);
  const valid = !errors.password && !errors.confirm;

  return (
    <Dialog
      open={!!user}
      onOpenChange={(o) => {
        if (!o && !change.isPending) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar contraseña</DialogTitle>
          <DialogDescription>
            {user?.is_self
              ? "Tu nueva contraseña aplica la próxima vez que inicies sesión."
              : `${user?.email ?? "Esta persona"} tendrá que usar la nueva contraseña la próxima vez que inicie sesión.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (valid && user) change.mutate({ user, password: pw.password });
          }}
        >
          <PasswordFields value={pw} onChange={setPw} showErrors={submitted} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={change.isPending}
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? "Guardando…" : "Guardar contraseña"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ───────── Datos de acceso para compartir (se muestran una sola vez) ───────── */

function ShareAccessDialog({ access, onClose }: { access: SharedAccess | null; onClose: () => void }) {
  const copy = () => {
    if (!access) return;
    navigator.clipboard.writeText(accessShareText(access.email, access.password)).then(
      () => toast({ title: "Datos de acceso copiados" }),
      () => toast({ title: "No se pudo copiar", description: "Selecciona el texto y cópialo manualmente.", variant: "destructive" }),
    );
  };
  return (
    <Dialog open={!!access} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{access?.title}</DialogTitle>
          <DialogDescription>Comparte estos datos de acceso con la persona por un canal privado.</DialogDescription>
        </DialogHeader>
        {access && (
          <dl className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Correo</dt>
              <dd className="break-all font-medium">{access.email}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Contraseña</dt>
              <dd className="break-all font-mono font-medium">{access.password}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Entrar en</dt>
              <dd className="break-all">{LOGIN_URL}</dd>
            </div>
          </dl>
        )}
        <p className="text-xs text-muted-foreground">Por seguridad, esta contraseña no se vuelve a mostrar. Si se pierde, cámbiala desde esta pantalla.</p>
        <DialogFooter>
          <Button variant="outline" className="gap-1.5" onClick={copy}>
            <Copy className="h-4 w-4" /> Copiar datos
          </Button>
          <Button onClick={onClose}>Listo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
