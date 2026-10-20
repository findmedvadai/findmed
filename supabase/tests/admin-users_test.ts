// admin-users — team accounts from Configuración → Usuarios: authorization,
// create (all or nothing, duplicates, password rules, superadmin only by a
// superadmin), password change, enable/disable (never yourself, never the last
// active admin, sessions closed), email change, and the revoke_user_sessions
// migration as each role sees it (PGlite).
//
//   npm run test:edge

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AuthAdminApi,
  type AuthErr,
  BAN_DURATION,
  handleAdminUsers,
  passwordProblem,
} from "../functions/admin-users/handler.ts";
import { FakeDb } from "./fake-supabase.ts";

const ADMIN = "11111111-aaaa-4aaa-8aaa-111111111111";
const ADMIN2 = "22222222-aaaa-4aaa-8aaa-222222222222";
const SUPER = "33333333-aaaa-4aaa-8aaa-333333333333";
const DOCTOR = "44444444-aaaa-4aaa-8aaa-444444444444";
const NOW = new Date("2026-10-20T12:00:00.000Z");
const GOOD_PW = "Clinica2026x";

interface FakeAuthUser {
  id: string;
  email: string;
  password: string;
  email_confirmed: boolean;
  banned_until: string | null;
  last_sign_in_at: string | null;
}

function fakeAuth(seed: Partial<FakeAuthUser>[] = []) {
  const users = new Map<string, FakeAuthUser>();
  for (const s of seed) {
    users.set(s.id!, { email: "", password: "Seed1234", email_confirmed: true, banned_until: null, last_sign_in_at: null, ...s } as FakeAuthUser);
  }
  const notFound: AuthErr = { message: "User not found", code: "user_not_found", status: 404 };
  const view = (u: FakeAuthUser) => ({ id: u.id, email: u.email, banned_until: u.banned_until, last_sign_in_at: u.last_sign_in_at });
  const opts = { failDelete: false };
  const auth: AuthAdminApi = {
    createUser: ({ email, password, email_confirm }) => {
      if ([...users.values()].some((u) => u.email === email)) {
        return Promise.resolve({ data: { user: null }, error: { message: "A user with this email address has already been registered", code: "email_exists", status: 422 } });
      }
      const u: FakeAuthUser = { id: crypto.randomUUID(), email, password, email_confirmed: email_confirm, banned_until: null, last_sign_in_at: null };
      users.set(u.id, u);
      return Promise.resolve({ data: { user: view(u) }, error: null });
    },
    deleteUser: (id) => {
      if (opts.failDelete) return Promise.resolve({ error: { message: "network" } });
      users.delete(id);
      return Promise.resolve({ error: null });
    },
    getUserById: (id) => {
      const u = users.get(id);
      return Promise.resolve(u ? { data: { user: view(u) }, error: null } : { data: { user: null }, error: notFound });
    },
    updateUserById: (id, attrs) => {
      const u = users.get(id);
      if (!u) return Promise.resolve({ data: { user: null }, error: notFound });
      if (attrs.password !== undefined) u.password = attrs.password;
      if (attrs.email !== undefined) u.email = attrs.email;
      if (attrs.ban_duration !== undefined) {
        u.banned_until = attrs.ban_duration === "none" ? null : new Date(NOW.getTime() + 100 * 365 * 86400_000).toISOString();
      }
      return Promise.resolve({ data: { user: view(u) }, error: null });
    },
  };
  return { auth, users, opts };
}

/** FakeDb whose INSERTs into `table` fail (reads and deletes still work, for the rollback). */
function failingInsert(db: FakeDb, table: string): SupabaseClient {
  const err = { data: null, error: { message: "boom", code: "23503" } };
  const failing = () => {
    const q = db.from(table) as unknown as Record<string, unknown>;
    q.insert = () => ({
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(err).then(ok, ko),
    });
    return q;
  };
  return {
    from: (t: string) => (t === table ? failing() : db.from(t)),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
  } as unknown as SupabaseClient;
}

function setup(opts: { failInsertInto?: string } = {}) {
  const db = new FakeDb({
    users: [
      { id: ADMIN, email: "admin@findmed.com.mx", role: "admin", doctor_id: null, created_at: "2026-01-01T00:00:00Z", initial_password: "vieja-expuesta" },
      { id: DOCTOR, email: "dra_ana@findmed.com.mx", role: "doctor", doctor_id: "d1", created_at: "2026-02-01T00:00:00Z", initial_password: "doc123" },
    ],
    user_roles: [
      { id: 1, user_id: ADMIN, role: "admin" },
      { id: 2, user_id: DOCTOR, role: "doctor" },
    ],
  });
  const revoked: string[] = [];
  db.rpcHandlers.revoke_user_sessions = (args) => {
    revoked.push(args._user_id as string);
    return 1;
  };
  const fa = fakeAuth([
    { id: ADMIN, email: "admin@findmed.com.mx", last_sign_in_at: "2026-10-19T23:30:00Z" },
    { id: DOCTOR, email: "dra_ana@findmed.com.mx" },
  ]);
  let caller: string | "anon" | "doctor" = ADMIN;
  const client = opts.failInsertInto ? failingInsert(db, opts.failInsertInto) : (db as unknown as SupabaseClient);
  const call = async (body: Record<string, unknown>) => {
    const res = await handleAdminUsers(new Request("https://x", { method: "POST", body: JSON.stringify(body) }), {
      supabase: client,
      auth: fa.auth,
      authorize: () =>
        Promise.resolve(
          caller === "anon"
            ? { ok: false as const, status: 401, error: "Unauthorized" }
            : caller === "doctor"
            ? { ok: false as const, status: 403, error: "Forbidden" }
            : { ok: true as const, userId: caller },
        ),
      now: () => NOW,
    });
    const text = await res.text();
    return { status: res.status, json: JSON.parse(text), text };
  };
  /** Adds a team account to both tables and Auth. */
  const addTeam = (id: string, email: string, role: "admin" | "superadmin", banned = false) => {
    db.rows("users").push({ id, email, role, doctor_id: null, created_at: "2026-03-01T00:00:00Z", initial_password: null });
    db.rows("user_roles").push({ id: db.rows("user_roles").length + 1, user_id: id, role });
    fa.users.set(id, { id, email, password: "Seed1234", email_confirmed: true, banned_until: banned ? "2126-01-01T00:00:00Z" : null, last_sign_in_at: null });
  };
  return { db, fa, call, revoked, addTeam, as: (who: typeof caller) => (caller = who) };
}

/* ───────── autorización ───────── */

Deno.test("admin-users: sin sesión 401, médico 403, y no se crea nada", async () => {
  const t = setup();
  t.as("anon");
  const anon = await t.call({ action: "create", email: "nuevo@findmed.com.mx", password: GOOD_PW });
  assertEquals([anon.status, anon.json.error], [401, "unauthorized"]);
  t.as("doctor");
  const doc = await t.call({ action: "list" });
  assertEquals([doc.status, doc.json.error], [403, "forbidden"]);
  assertEquals(t.fa.users.size, 2);
  assertEquals(t.db.rows("users").length, 2);
});

Deno.test("acción desconocida o cuerpo inválido → 400 en español", async () => {
  const t = setup();
  assertEquals((await t.call({ action: "drop_all" })).json.error, "invalid_action");
  const res = await handleAdminUsers(new Request("https://x", { method: "POST", body: "{nope" }), {
    supabase: t.db as unknown as SupabaseClient,
    auth: t.fa.auth,
    authorize: () => Promise.resolve({ ok: true as const, userId: ADMIN }),
  });
  assertEquals(res.status, 400);
});

/* ───────── list ───────── */

Deno.test("list: solo cuentas del equipo, con último acceso, estado y 'Tú'", async () => {
  const t = setup();
  t.addTeam(ADMIN2, "recepcion@findmed.com.mx", "admin", true);
  const { status, json } = await t.call({ action: "list" });
  assertEquals(status, 200);
  assertEquals(json.users.map((u: { email: string }) => u.email), ["admin@findmed.com.mx", "recepcion@findmed.com.mx"]);
  const [me, other] = json.users;
  assertEquals([me.is_self, me.status, me.last_sign_in_at], [true, "active", "2026-10-19T23:30:00Z"]);
  assertEquals([other.is_self, other.status], [false, "disabled"]);
  assertEquals(json.viewer, { id: ADMIN, is_superadmin: false });
  assert(!("initial_password" in me), "nunca devuelve contraseñas guardadas");
});

/* ───────── create ───────── */

Deno.test("create: cuenta confirmada en Auth + public.users (sin contraseña) + user_roles; la respuesta no trae la contraseña", async () => {
  const t = setup();
  const { status, json, text } = await t.call({ action: "create", email: "  Recepcion@FindMed.com.mx ", password: GOOD_PW });
  assertEquals(status, 200);
  assertEquals(json.user.email, "recepcion@findmed.com.mx");
  assertEquals(json.user.role, "admin");
  assert(!text.includes(GOOD_PW));
  const authUser = t.fa.users.get(json.user.id)!;
  assertEquals([authUser.email, authUser.password, authUser.email_confirmed], ["recepcion@findmed.com.mx", GOOD_PW, true]);
  const row = t.db.rows("users").find((u) => u.id === json.user.id)!;
  assertEquals([row.role, row.doctor_id ?? null, row.initial_password ?? null], ["admin", null, null]);
  assertEquals(t.db.rows("user_roles").filter((r) => r.user_id === json.user.id).map((r) => r.role), ["admin"]);
});

Deno.test("create: correo ya usado (también de un médico, sin importar mayúsculas) → 409 claro y nada creado", async () => {
  const t = setup();
  const dup = await t.call({ action: "create", email: "DRA_ANA@findmed.com.mx", password: GOOD_PW });
  assertEquals([dup.status, dup.json.error], [409, "email_taken"]);
  assertStringIncludes(dup.json.message, "Ya existe una cuenta con ese correo");
  assertStringIncludes(dup.json.message, "Doctores");
  // Solo en Auth (cuenta huérfana): Auth lo rechaza y el mensaje es el mismo.
  t.fa.users.set("orphan", { id: "orphan", email: "huerfano@findmed.com.mx", password: "x", email_confirmed: true, banned_until: null, last_sign_in_at: null });
  const orphan = await t.call({ action: "create", email: "huerfano@findmed.com.mx", password: GOOD_PW });
  assertEquals([orphan.status, orphan.json.message], [409, "Ya existe una cuenta con ese correo."]);
  assertEquals(t.db.rows("users").length, 2);
  assertEquals(t.fa.users.size, 3);
});

Deno.test("create: contraseña débil o correo inválido → 400 antes de tocar Auth", async () => {
  const t = setup();
  for (const pw of ["corta1", "sololetrasaqui", "1234567890", " Espacio123", ""]) {
    const r = await t.call({ action: "create", email: "nuevo@findmed.com.mx", password: pw });
    assertEquals([r.status, r.json.error], [400, "weak_password"], pw);
  }
  const badEmail = await t.call({ action: "create", email: "no-es-correo", password: GOOD_PW });
  assertEquals([badEmail.status, badEmail.json.error], [400, "invalid_email"]);
  assertEquals(t.fa.users.size, 2);
  assertEquals(passwordProblem("Ñandú2026"), null);
});

Deno.test("create: si falla user_roles se deshace todo (Auth y public.users) y dice qué paso falló", async () => {
  const t = setup({ failInsertInto: "user_roles" });
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    const r = await t.call({ action: "create", email: "nuevo@findmed.com.mx", password: GOOD_PW });
    assertEquals([r.status, r.json.error], [500, "registration_failed"]);
    assertStringIncludes(r.json.message, "rol de acceso");
    assertStringIncludes(r.json.message, "No se guardó nada");
  } finally {
    console.error = original;
  }
  assertEquals(t.fa.users.size, 2, "la cuenta de Auth se borró: el correo queda libre");
  assertEquals(t.db.rows("users").map((u) => u.id), [ADMIN, DOCTOR]);
  assert(logs.length > 0 && logs.every((l) => !l.includes(GOOD_PW)), "la contraseña nunca va a los logs");
});

Deno.test("create: si el rollback no puede borrar la cuenta de Auth, lo dice con el correo", async () => {
  const t = setup({ failInsertInto: "users" });
  t.fa.opts.failDelete = true;
  const r = await t.call({ action: "create", email: "nuevo@findmed.com.mx", password: GOOD_PW });
  assertEquals([r.status, r.json.error], [500, "incomplete_registration"]);
  assertStringIncludes(r.json.message, "nuevo@findmed.com.mx");
});

Deno.test("create: superadmin solo lo crea un superadmin", async () => {
  const t = setup();
  const denied = await t.call({ action: "create", email: "jefe@findmed.com.mx", password: GOOD_PW, role: "superadmin" });
  assertEquals([denied.status, denied.json.error], [403, "forbidden"]);
  assertEquals(t.fa.users.size, 2);
  const invalid = await t.call({ action: "create", email: "x@findmed.com.mx", password: GOOD_PW, role: "doctor" });
  assertEquals([invalid.status, invalid.json.error], [400, "invalid_role"]);

  t.addTeam(SUPER, "super@findmed.com.mx", "superadmin");
  t.as(SUPER);
  const ok = await t.call({ action: "create", email: "jefe@findmed.com.mx", password: GOOD_PW, role: "superadmin" });
  assertEquals(ok.status, 200);
  assertEquals(t.db.rows("user_roles").find((r) => r.user_id === ok.json.user.id)?.role, "superadmin");
});

/* ───────── set_password ───────── */

Deno.test("set_password: cambia en Auth, borra la copia vieja de initial_password; débil → 400; médico → 404", async () => {
  const t = setup();
  t.addTeam(ADMIN2, "recepcion@findmed.com.mx", "admin");
  const ok = await t.call({ action: "set_password", user_id: ADMIN, password: "NuevaClave99" });
  assertEquals(ok.status, 200);
  assertEquals(t.fa.users.get(ADMIN)!.password, "NuevaClave99");
  assertEquals(t.db.rows("users").find((u) => u.id === ADMIN)!.initial_password, null);

  const weak = await t.call({ action: "set_password", user_id: ADMIN2, password: "abc" });
  assertEquals([weak.status, weak.json.error], [400, "weak_password"]);
  assertEquals(t.fa.users.get(ADMIN2)!.password, "Seed1234");

  const doctor = await t.call({ action: "set_password", user_id: DOCTOR, password: "NuevaClave99" });
  assertEquals([doctor.status, doctor.json.error], [404, "user_not_found"]);
  assertEquals(t.fa.users.get(DOCTOR)!.password, "Seed1234");
});

Deno.test("set_password: un admin no toca la cuenta de un superadmin", async () => {
  const t = setup();
  t.addTeam(SUPER, "super@findmed.com.mx", "superadmin");
  const r = await t.call({ action: "set_password", user_id: SUPER, password: "NuevaClave99" });
  assertEquals([r.status, r.json.error], [403, "forbidden"]);
  assertEquals(t.fa.users.get(SUPER)!.password, "Seed1234");
});

/* ───────── set_active ───────── */

Deno.test("set_active: desactivar = ban largo + cierre de sesiones; reactivar quita el ban", async () => {
  const t = setup();
  t.addTeam(ADMIN2, "recepcion@findmed.com.mx", "admin");
  const off = await t.call({ action: "set_active", user_id: ADMIN2, active: false });
  assertEquals(off.status, 200);
  assertEquals([off.json.active, off.json.sessions_closed], [false, true]);
  assert(t.fa.users.get(ADMIN2)!.banned_until, "queda baneado en Auth");
  assertEquals(t.revoked, [ADMIN2]);
  assertEquals(BAN_DURATION, "876000h");

  const on = await t.call({ action: "set_active", user_id: ADMIN2, active: true });
  assertEquals([on.status, on.json.active], [200, true]);
  assertEquals(t.fa.users.get(ADMIN2)!.banned_until, null);
  assertEquals(t.revoked, [ADMIN2], "reactivar no toca sesiones");
});

Deno.test("set_active: nadie se desactiva a sí mismo", async () => {
  const t = setup();
  t.addTeam(ADMIN2, "recepcion@findmed.com.mx", "admin");
  const r = await t.call({ action: "set_active", user_id: ADMIN, active: false });
  assertEquals([r.status, r.json.error], [409, "cannot_disable_self"]);
  assertEquals(t.fa.users.get(ADMIN)!.banned_until, null);
});

Deno.test("set_active: no deja al sistema sin ningún admin activo", async () => {
  const t = setup();
  t.addTeam(ADMIN2, "recepcion@findmed.com.mx", "admin");
  // Quien llama ya está desactivado (su token aún no expira): ADMIN2 es el último activo.
  t.fa.users.get(ADMIN)!.banned_until = "2126-01-01T00:00:00Z";
  const r = await t.call({ action: "set_active", user_id: ADMIN2, active: false });
  assertEquals([r.status, r.json.error], [409, "last_admin"]);
  assertEquals(t.fa.users.get(ADMIN2)!.banned_until, null);
  assertEquals(t.revoked, []);
});

Deno.test("set_active: un admin no desactiva a un superadmin; médicos e ids raros → 404; 'active' obligatorio", async () => {
  const t = setup();
  t.addTeam(SUPER, "super@findmed.com.mx", "superadmin");
  assertEquals((await t.call({ action: "set_active", user_id: SUPER, active: false })).status, 403);
  assertEquals(t.fa.users.get(SUPER)!.banned_until, null);
  assertEquals((await t.call({ action: "set_active", user_id: DOCTOR, active: false })).status, 404);
  assertEquals((await t.call({ action: "set_active", user_id: "'; drop table users", active: false })).status, 404);
  assertEquals((await t.call({ action: "set_active", user_id: SUPER })).json.error, "invalid_input");
});

Deno.test("set_active: si cerrar sesiones falla, el acceso igual queda desactivado y se informa", async () => {
  const t = setup();
  t.addTeam(ADMIN2, "recepcion@findmed.com.mx", "admin");
  delete t.db.rpcHandlers.revoke_user_sessions; // función no desplegada → error
  const r = await t.call({ action: "set_active", user_id: ADMIN2, active: false });
  assertEquals([r.status, r.json.sessions_closed], [200, false]);
  assert(t.fa.users.get(ADMIN2)!.banned_until);
});

/* ───────── update_email ───────── */

Deno.test("update_email: cambia en public.users y Auth; duplicado → 409", async () => {
  const t = setup();
  t.addTeam(ADMIN2, "recepcion@findmed.com.mx", "admin");
  const ok = await t.call({ action: "update_email", user_id: ADMIN2, email: "Caja@FindMed.com.mx" });
  assertEquals(ok.status, 200);
  assertEquals(t.db.rows("users").find((u) => u.id === ADMIN2)!.email, "caja@findmed.com.mx");
  assertEquals(t.fa.users.get(ADMIN2)!.email, "caja@findmed.com.mx");
  const dup = await t.call({ action: "update_email", user_id: ADMIN2, email: "admin@findmed.com.mx" });
  assertEquals([dup.status, dup.json.error], [409, "email_taken"]);
  assertEquals((await t.call({ action: "update_email", user_id: ADMIN2, email: "caja@findmed.com.mx" })).json.no_changes, true);
});

/* ───────── migración revoke_user_sessions ───────── */

Deno.test("migración 20261020120000: solo service_role cierra sesiones; borra sesiones y refresh tokens del usuario", async () => {
  const migration = await Deno.readTextFile(new URL("../migrations/20261020120000_revoke_user_sessions.sql", import.meta.url));
  const pg = new PGlite();
  await pg.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL);
    CREATE TABLE auth.refresh_tokens (id serial PRIMARY KEY, user_id varchar(255), session_id uuid REFERENCES auth.sessions(id) ON DELETE CASCADE);
    INSERT INTO auth.sessions VALUES ('${ADMIN}', '${ADMIN2}'), ('${SUPER}', '${ADMIN2}'), ('${DOCTOR}', '${ADMIN}');
    INSERT INTO auth.refresh_tokens (user_id, session_id) VALUES
      ('${ADMIN2}', '${ADMIN}'), ('${ADMIN2}', '${SUPER}'), ('${ADMIN2}', NULL), ('${ADMIN}', '${DOCTOR}');
  `);
  await pg.exec(migration);

  for (const role of ["anon", "authenticated"]) {
    await pg.exec(`SET ROLE ${role}`);
    let denied = false;
    try {
      await pg.query(`SELECT public.revoke_user_sessions('${ADMIN2}')`);
    } catch (e) {
      denied = /permission denied/i.test(String(e));
    }
    await pg.exec("RESET ROLE");
    assert(denied, `${role} no puede ejecutarla`);
  }

  await pg.exec("SET ROLE service_role");
  const r = await pg.query<{ n: number }>(`SELECT public.revoke_user_sessions('${ADMIN2}') AS n`);
  await pg.exec("RESET ROLE");
  assertEquals(r.rows[0].n, 2);
  const left = await pg.query<{ user_id: string }>("SELECT user_id::text FROM auth.sessions UNION ALL SELECT user_id FROM auth.refresh_tokens");
  assertEquals(left.rows.map((x) => x.user_id).sort(), [ADMIN, ADMIN]);
  await pg.close();
});
