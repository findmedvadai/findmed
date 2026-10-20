// Team accounts (Configuración → Usuarios): the people who use the admin panel.
// Doctors are NOT managed here (Doctores → create-doctor / update-doctor-credentials).
//
// Public sign-up is disabled in Supabase Auth (disable_signup = true), so every
// team account is created here through the Auth admin API with the password the
// admin chooses (no invitations, no Google). Separate from index.ts so tests can
// inject the database, the Auth admin API and the auth check.
//
// POST { action, ... } → 200 { ... } | 4xx/5xx { error, message }
//   list                                  → { users: TeamUser[], viewer: { id, is_superadmin } }
//   create        { email, password, role? } → { user: { id, email, role } }
//   set_password  { user_id, password }   → { success }
//   set_active    { user_id, active }     → { success, active, sessions_closed }
//   update_email  { user_id, email }      → { success, no_changes? }
//
// Rules:
// - Only admins/superadmins call this (requireAdmin). Creating a superadmin, or
//   touching an existing superadmin account, requires the caller to be one.
// - create is all or nothing: Auth user → public.users → user_roles; if a step
//   fails everything created is removed and the response names the step.
// - Passwords: ≥ 8 characters with a letter and a number. They are never
//   returned, logged, or stored in public.users.initial_password for team
//   accounts (changing one also clears any legacy value there).
// - Deactivating = long ban in Auth + closing open sessions
//   (public.revoke_user_sessions). Nobody can deactivate themselves and the
//   system always keeps at least one active admin.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

export const TEAM_ROLES = ["admin", "superadmin"] as const;
export type TeamRole = typeof TEAM_ROLES[number];

/** ~100 years: Auth has no "forever"; "none" lifts the ban. */
export const BAN_DURATION = "876000h";
export const MIN_PASSWORD = 8;
/** bcrypt (Auth) ignores everything after 72 bytes. */
export const MAX_PASSWORD = 72;

export interface AuthUser {
  id: string;
  email?: string | null;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
}
export interface AuthErr {
  message?: string;
  code?: string;
  status?: number;
}
type AuthUserResult = Promise<{ data: { user: AuthUser | null } | null; error: AuthErr | null }>;

/** The subset of `supabase.auth.admin` used here (injectable for tests). */
export interface AuthAdminApi {
  createUser(attrs: { email: string; password: string; email_confirm: boolean }): AuthUserResult;
  deleteUser(id: string): Promise<{ error: unknown }>;
  getUserById(id: string): AuthUserResult;
  updateUserById(
    id: string,
    attrs: { password?: string; email?: string; email_confirm?: boolean; ban_duration?: string },
  ): AuthUserResult;
}

export interface AdminUsersDeps {
  supabase: SupabaseClient;
  auth: AuthAdminApi;
  authorize: (req: Request) => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;
  now?: () => Date;
}

export interface TeamUser {
  id: string;
  email: string | null;
  role: TeamRole;
  created_at: string | null;
  last_sign_in_at: string | null;
  /** active: can sign in · disabled: banned · unknown: Auth didn't answer / no Auth account. */
  status: "active" | "disabled" | "unknown";
  is_self: boolean;
}

type Row = Record<string, unknown>;
type StepError = { message?: string; code?: string } | null;

const bad = (error: string, message: string, status = 400) => jsonResponse({ error, message }, status);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_TAKEN = "Ya existe una cuenta con ese correo.";
const NOT_FOUND = "No encontramos ese usuario del equipo. Recarga la página.";
const SUPER_ONLY = "Solo un superadministrador puede modificar la cuenta de otro superadministrador.";

/** Normalized email or null when it isn't one (Auth stores emails in lower case). */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Spanish reason why a password is rejected, or null when it is valid. */
export function passwordProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return "Escribe la contraseña.";
  if (raw.trim() !== raw) return "La contraseña no puede empezar ni terminar con espacios.";
  if (raw.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres, con letras y números.`;
  if (new TextEncoder().encode(raw).length > MAX_PASSWORD) return `La contraseña no puede pasar de ${MAX_PASSWORD} caracteres.`;
  if (!/\p{L}/u.test(raw) || !/\d/.test(raw)) return "La contraseña debe combinar letras y números.";
  return null;
}

/** ILIKE pattern that matches the text literally (emails often contain "_"). */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const isEmailExists = (e: AuthErr | null) => {
  const msg = (e?.message ?? "").toLowerCase();
  return e?.code === "email_exists" || msg.includes("already") || msg.includes("registered") || msg.includes("exists");
};
const isWeakPassword = (e: AuthErr | null) => e?.code === "weak_password" || (e?.message ?? "").toLowerCase().includes("password");
const isNotFound = (e: AuthErr | null) => e?.status === 404 || e?.code === "user_not_found" || (e?.message ?? "").toLowerCase().includes("not found");

/** Runs one write; a thrown exception counts as a failure like a returned error. */
async function attempt(run: () => PromiseLike<{ error: StepError; data?: unknown }>): Promise<{ error: StepError; data: unknown }> {
  try {
    const r = await run();
    return { error: r.error ?? null, data: r.data ?? null };
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : String(err) }, data: null };
  }
}

export async function handleAdminUsers(req: Request, deps: AdminUsersDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad("method_not_allowed", "Método no permitido", 405);

  const authz = await deps.authorize(req);
  if (!authz.ok) {
    return authz.status === 403
      ? bad("forbidden", "Solo un administrador puede gestionar los usuarios del equipo.", 403)
      : bad("unauthorized", "Sesión inválida o expirada. Vuelve a iniciar sesión.", 401);
  }
  const callerId = authz.userId;

  let body: Row;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Row;
  } catch {
    return bad("invalid_json", "Solicitud inválida.");
  }

  const action = typeof body.action === "string" ? body.action : "";
  try {
    const ctx = new Ctx(deps, callerId);
    switch (action) {
      case "list":
        return await listUsers(ctx);
      case "create":
        return await createUser(ctx, body);
      case "set_password":
        return await setPassword(ctx, body);
      case "set_active":
        return await setActive(ctx, body);
      case "update_email":
        return await updateEmail(ctx, body);
      default:
        return bad("invalid_action", "Acción no reconocida.");
    }
  } catch (err) {
    // Never echo the body (it may carry a password); only the action and the error.
    console.error(`[admin-users] ${action} failed:`, err instanceof Error ? err.message : err);
    return bad("internal_error", "Ocurrió un error inesperado. Intenta de nuevo en unos segundos.", 500);
  }
}

interface TeamRow {
  id: string;
  email: string | null;
  role: TeamRole;
  created_at: string | null;
  initial_password: string | null;
}

class Ctx {
  private superCache = new Map<string, boolean>();
  constructor(readonly deps: AdminUsersDeps, readonly callerId: string) {}

  get db() {
    return this.deps.supabase;
  }
  get auth() {
    return this.deps.auth;
  }
  now() {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** Superadmin by role row (what RLS uses) or by public.users.role. */
  async isSuperadmin(userId: string, usersRole?: string | null): Promise<boolean> {
    if (usersRole === "superadmin") return true;
    const cached = this.superCache.get(userId);
    if (cached !== undefined) return cached;
    const { data, error } = await this.db.from("user_roles").select("role").eq("user_id", userId);
    if (error) throw new Error(`user_roles read failed: ${error.message}`);
    const value = ((data ?? []) as { role: string }[]).some((r) => r.role === "superadmin");
    this.superCache.set(userId, value);
    return value;
  }

  async callerIsSuperadmin(): Promise<boolean> {
    const { data } = await this.db.from("users").select("role").eq("id", this.callerId).maybeSingle();
    return this.isSuperadmin(this.callerId, (data as { role?: string } | null)?.role ?? null);
  }

  /** A team account (admin/superadmin) by id, or null (doctors and unknown ids). */
  async teamMember(userId: unknown): Promise<TeamRow | null> {
    if (typeof userId !== "string" || !UUID_RE.test(userId)) return null;
    const { data, error } = await this.db
      .from("users")
      .select("id, email, role, created_at, initial_password")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(`users read failed: ${error.message}`);
    const row = data as TeamRow | null;
    if (!row || !(TEAM_ROLES as readonly string[]).includes(row.role)) return null;
    return row;
  }

  async allTeam(): Promise<TeamRow[]> {
    const { data, error } = await this.db
      .from("users")
      .select("id, email, role, created_at, initial_password")
      .in("role", [...TEAM_ROLES])
      .order("created_at", { ascending: true });
    if (error) throw new Error(`users list failed: ${error.message}`);
    return (data ?? []) as TeamRow[];
  }

  /** Auth view of one account; never throws. */
  async authStatus(userId: string): Promise<{ status: TeamUser["status"]; last_sign_in_at: string | null }> {
    try {
      const { data, error } = await this.auth.getUserById(userId);
      const user = data?.user ?? null;
      if (error || !user) return { status: "unknown", last_sign_in_at: null };
      const banned = !!user.banned_until && new Date(user.banned_until).getTime() > this.now().getTime();
      return { status: banned ? "disabled" : "active", last_sign_in_at: user.last_sign_in_at ?? null };
    } catch {
      return { status: "unknown", last_sign_in_at: null };
    }
  }

  /** Who else is in public.users with this email (case-insensitive), if anyone. */
  async emailOwner(email: string, exceptId?: string): Promise<{ id: string; role: string } | null> {
    let q = this.db.from("users").select("id, role").ilike("email", likeLiteral(email));
    if (exceptId) q = q.neq("id", exceptId);
    const { data, error } = await q.limit(1);
    if (error) throw new Error(`users email lookup failed: ${error.message}`);
    return ((data ?? []) as { id: string; role: string }[])[0] ?? null;
  }

  /** 403 when the target is a superadmin and the caller isn't one. */
  async guardSuperTarget(target: TeamRow): Promise<Response | null> {
    if (target.id === this.callerId) return null;
    if (!(await this.isSuperadmin(target.id, target.role))) return null;
    if (await this.callerIsSuperadmin()) return null;
    return bad("forbidden", SUPER_ONLY, 403);
  }
}

/* ───────── list ───────── */

async function listUsers(ctx: Ctx): Promise<Response> {
  const rows = await ctx.allTeam();
  const users: TeamUser[] = await Promise.all(
    rows.map(async (r) => {
      const a = await ctx.authStatus(r.id);
      return {
        id: r.id,
        email: r.email,
        role: r.role,
        created_at: r.created_at,
        last_sign_in_at: a.last_sign_in_at,
        status: a.status,
        is_self: r.id === ctx.callerId,
      };
    }),
  );
  return jsonResponse({ users, viewer: { id: ctx.callerId, is_superadmin: await ctx.callerIsSuperadmin() } });
}

/* ───────── create ───────── */

const STEP_LABEL = { user: "perfil del usuario", role: "rol de acceso" } as const;

async function createUser(ctx: Ctx, body: Row): Promise<Response> {
  const email = normalizeEmail(body.email);
  if (!email) return bad("invalid_email", "Escribe un correo válido (ej. nombre@findmed.com.mx).");
  const pwProblem = passwordProblem(body.password);
  if (pwProblem) return bad("weak_password", pwProblem);
  const password = body.password as string;

  const role = body.role === undefined || body.role === null ? "admin" : body.role;
  if (role !== "admin" && role !== "superadmin") return bad("invalid_role", "El rol debe ser Administrador o Superadministrador.");
  if (role === "superadmin" && !(await ctx.callerIsSuperadmin())) {
    return bad("forbidden", "Solo un superadministrador puede crear otro superadministrador.", 403);
  }

  const owner = await ctx.emailOwner(email);
  if (owner) {
    const hint = owner.role === "doctor" ? " Es la cuenta de un médico: se gestiona en Doctores." : "";
    return bad("email_taken", EMAIL_TAKEN + hint, 409);
  }

  // 1. Auth user (confirmed: there's no invitation email).
  let authUserId: string;
  {
    const { data, error } = await ctx.auth.createUser({ email, password, email_confirm: true });
    if (error || !data?.user) {
      if (isEmailExists(error)) return bad("email_taken", EMAIL_TAKEN, 409);
      if (isWeakPassword(error)) {
        return bad("weak_password", `La contraseña no cumple los requisitos de seguridad. Usa al menos ${MIN_PASSWORD} caracteres con letras y números.`);
      }
      console.error("[admin-users] create: auth.createUser failed:", error?.code ?? error?.status ?? "", error?.message ?? "");
      return bad("internal_error", "No se pudo crear la cuenta de acceso. Intenta de nuevo en unos segundos.", 500);
    }
    authUserId = data.user.id;
  }

  /** Undo everything created so far and explain which step failed. */
  const fail = async (step: keyof typeof STEP_LABEL, error: StepError): Promise<Response> => {
    console.error(`[admin-users] create: step "${step}" failed:`, error?.code ?? "", error?.message ?? "");
    const leftovers: string[] = [];
    for (const [table, run] of [
      ["user_roles", () => ctx.db.from("user_roles").delete().eq("user_id", authUserId)],
      ["users", () => ctx.db.from("users").delete().eq("id", authUserId)],
    ] as [string, () => PromiseLike<{ error: StepError }>][]) {
      const r = await attempt(run);
      if (r.error) leftovers.push(table);
    }
    try {
      const { error: delErr } = await ctx.auth.deleteUser(authUserId);
      if (delErr) leftovers.push("auth.users");
    } catch {
      leftovers.push("auth.users");
    }
    const what = STEP_LABEL[step];
    if (leftovers.length === 0) {
      return bad(
        "registration_failed",
        `No se pudo crear el usuario (falló: ${what}). No se guardó nada, puedes intentarlo de nuevo.`,
        500,
      );
    }
    console.error("[admin-users] create: rollback incomplete:", leftovers.join(", "));
    return bad(
      "incomplete_registration",
      `La creación del usuario falló (${what}) y no se pudo deshacer por completo` +
        (leftovers.includes("auth.users") ? `: el correo ${email} quedó registrado sin acceso al panel.` : ".") +
        " Avisa a soporte antes de volver a intentarlo.",
      500,
    );
  };

  // 2. public.users (useAuth reads the role here). No initial_password for team accounts.
  const user = await attempt(() => ctx.db.from("users").insert({ id: authUserId, email, role, doctor_id: null }));
  if (user.error) return fail("user", user.error);

  // 3. user_roles (is_admin_or_superadmin / RLS read it).
  const roleRow = await attempt(() => ctx.db.from("user_roles").insert({ user_id: authUserId, role }));
  if (roleRow.error) return fail("role", roleRow.error);

  return jsonResponse({ user: { id: authUserId, email, role } });
}

/* ───────── set_password ───────── */

async function setPassword(ctx: Ctx, body: Row): Promise<Response> {
  const target = await ctx.teamMember(body.user_id);
  if (!target) return bad("user_not_found", NOT_FOUND, 404);
  const denied = await ctx.guardSuperTarget(target);
  if (denied) return denied;
  const pwProblem = passwordProblem(body.password);
  if (pwProblem) return bad("weak_password", pwProblem);

  const { error } = await ctx.auth.updateUserById(target.id, { password: body.password as string });
  if (error) {
    if (isNotFound(error)) return bad("user_not_found", "Esta cuenta no tiene acceso registrado en Auth. Avisa a soporte.", 404);
    if (isWeakPassword(error)) {
      return bad("weak_password", `La contraseña no cumple los requisitos de seguridad. Usa al menos ${MIN_PASSWORD} caracteres con letras y números.`);
    }
    console.error("[admin-users] set_password: auth update failed:", error.code ?? error.status ?? "", error.message ?? "");
    return bad("internal_error", "No se pudo cambiar la contraseña. Intenta de nuevo en unos segundos.", 500);
  }

  // Legacy copy in public.users (from before this screen) is now stale: clear it.
  if (target.initial_password !== null && target.initial_password !== undefined) {
    const r = await attempt(() => ctx.db.from("users").update({ initial_password: null }).eq("id", target.id));
    if (r.error) console.error("[admin-users] set_password: could not clear initial_password:", r.error.code ?? "");
  }
  return jsonResponse({ success: true });
}

/* ───────── set_active ───────── */

async function setActive(ctx: Ctx, body: Row): Promise<Response> {
  if (typeof body.active !== "boolean") return bad("invalid_input", "Indica si el acceso queda activo o desactivado.");
  const active = body.active;
  const target = await ctx.teamMember(body.user_id);
  if (!target) return bad("user_not_found", NOT_FOUND, 404);
  if (!active && target.id === ctx.callerId) {
    return bad("cannot_disable_self", "No puedes desactivar tu propio acceso. Pide a otro administrador que lo haga.", 409);
  }
  const denied = await ctx.guardSuperTarget(target);
  if (denied) return denied;

  if (!active) {
    // Never leave the panel without an admin who can sign in.
    const others = (await ctx.allTeam()).filter((r) => r.id !== target.id);
    const statuses = await Promise.all(others.map((r) => ctx.authStatus(r.id)));
    if (!statuses.some((s) => s.status === "active")) {
      return bad("last_admin", "Debe quedar al menos un administrador con acceso activo.", 409);
    }
  }

  const { error } = await ctx.auth.updateUserById(target.id, { ban_duration: active ? "none" : BAN_DURATION });
  if (error) {
    if (isNotFound(error)) return bad("user_not_found", "Esta cuenta no tiene acceso registrado en Auth. Avisa a soporte.", 404);
    console.error("[admin-users] set_active: auth update failed:", error.code ?? error.status ?? "", error.message ?? "");
    return bad("internal_error", "No se pudo cambiar el acceso. Intenta de nuevo en unos segundos.", 500);
  }

  let sessionsClosed = true;
  if (!active) {
    // Best effort: the ban already blocks sign-in and token refresh.
    try {
      const { error: rpcErr } = await ctx.db.rpc("revoke_user_sessions", { _user_id: target.id });
      if (rpcErr) {
        sessionsClosed = false;
        console.error("[admin-users] set_active: revoke_user_sessions failed:", rpcErr.code ?? "", rpcErr.message ?? "");
      }
    } catch (err) {
      sessionsClosed = false;
      console.error("[admin-users] set_active: revoke_user_sessions threw:", err instanceof Error ? err.message : err);
    }
  }
  return jsonResponse({ success: true, active, sessions_closed: sessionsClosed });
}

/* ───────── update_email ───────── */

async function updateEmail(ctx: Ctx, body: Row): Promise<Response> {
  const email = normalizeEmail(body.email);
  if (!email) return bad("invalid_email", "Escribe un correo válido (ej. nombre@findmed.com.mx).");
  const target = await ctx.teamMember(body.user_id);
  if (!target) return bad("user_not_found", NOT_FOUND, 404);
  const denied = await ctx.guardSuperTarget(target);
  if (denied) return denied;
  if ((target.email ?? "").toLowerCase() === email) return jsonResponse({ success: true, no_changes: true });
  if (await ctx.emailOwner(email, target.id)) return bad("email_taken", EMAIL_TAKEN, 409);

  // Same order as update-doctor-credentials: our table first (trivial to undo),
  // then Auth; if Auth refuses, public.users goes back to the previous email.
  const pub = await attempt(() => ctx.db.from("users").update({ email }).eq("id", target.id));
  if (pub.error) {
    if (pub.error.code === "23505") return bad("email_taken", EMAIL_TAKEN, 409);
    console.error("[admin-users] update_email: users update failed:", pub.error.code ?? "", pub.error.message ?? "");
    return bad("internal_error", "No se pudo cambiar el correo. Intenta de nuevo en unos segundos.", 500);
  }
  const { error } = await ctx.auth.updateUserById(target.id, { email, email_confirm: true });
  if (error) {
    const undo = await attempt(() => ctx.db.from("users").update({ email: target.email }).eq("id", target.id));
    if (undo.error) console.error("[admin-users] update_email: rollback failed:", undo.error.code ?? "");
    if (isEmailExists(error)) return bad("email_taken", EMAIL_TAKEN, 409);
    console.error("[admin-users] update_email: auth update failed:", error.code ?? error.status ?? "", error.message ?? "");
    return bad("internal_error", "No se pudo cambiar el correo. Intenta de nuevo en unos segundos.", 500);
  }
  return jsonResponse({ success: true });
}
