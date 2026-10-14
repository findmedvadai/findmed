// F11 — doctor sign-up is all or nothing: any failing step undoes everything
// and the admin gets a clear Spanish message (before, failures after the users
// row were only logged and the response said "Doctor creado").
//
//   npm run test:edge

import { assert, assertEquals } from "jsr:@std/assert@1";
import { type AuthAdmin, type DoctorInput, provisionDoctor } from "../functions/create-doctor/provision.ts";
import { FakeDb } from "./fake-supabase.ts";

/** The client type create-doctor uses (its pinned supabase-js build). */
type SupabaseClient = Parameters<typeof provisionDoctor>[0];

const INPUT: DoctorInput = {
  email: "doctora@example.com",
  password: "secreta123",
  full_name: "Dra. Prueba",
  phone: null,
  address: "Calle 1",
  city_id: null,
  zone_id: null,
  specialty_ids: ["s1", "s2"],
};
const TABLES = ["doctors", "users", "user_roles", "doctor_specialties", "doctor_schedule_settings", "doctor_offices", "doctor_weekly_availability"];

function fakeAuth(opts: { createError?: { message: string; code?: string }; deleteError?: unknown } = {}) {
  const users = new Set<string>();
  const auth: AuthAdmin = {
    createUser: ({ email }) => {
      if (opts.createError) return Promise.resolve({ data: { user: null }, error: opts.createError });
      const id = `auth-${email}`;
      users.add(id);
      return Promise.resolve({ data: { user: { id } }, error: null });
    },
    deleteUser: (id) => {
      if (opts.deleteError) return Promise.resolve({ error: opts.deleteError });
      users.delete(id);
      return Promise.resolve({ error: null });
    },
  };
  return { auth, users };
}

/** FakeDb whose INSERTs into `table` fail (deletes still work, for the rollback). */
function failingInsert(db: FakeDb, table: string, failDeletesToo = false): SupabaseClient {
  const err = { data: null, error: { message: "boom", code: "23503" } };
  const failing = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["insert", "select", "single", "eq"]) q[m] = () => q;
    q.delete = () => (failDeletesToo ? q : db.from(table).delete());
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(err).then(ok, ko);
    return q;
  };
  return { from: (t: string) => (t === table ? failing() : db.from(t)) } as unknown as SupabaseClient;
}

const empty = () => new FakeDb(Object.fromEntries(TABLES.map((t) => [t, []])));
const counts = (db: FakeDb) => Object.fromEntries(TABLES.map((t) => [t, db.rows(t).length]));

Deno.test("happy path: user, role, specialties, settings, default office and Mon–Fri 9–17", async () => {
  const db = empty();
  const { auth, users } = fakeAuth();
  const r = await provisionDoctor(db as unknown as SupabaseClient, auth, INPUT);
  assert(r.ok);
  assertEquals(counts(db), {
    doctors: 1, users: 1, user_roles: 1, doctor_specialties: 2, doctor_schedule_settings: 1, doctor_offices: 1, doctor_weekly_availability: 5,
  });
  assertEquals(db.rows("doctor_offices")[0].name, "Consultorio principal");
  assertEquals(db.rows("doctor_weekly_availability").every((a) => a.office_id === r.officeId), true);
  assertEquals(users.size, 1);
});

for (const table of ["user_roles", "doctor_specialties", "doctor_schedule_settings", "doctor_offices", "doctor_weekly_availability"]) {
  Deno.test(`failure in ${table} → everything undone, clear error (no half-created doctor)`, async () => {
    const db = empty();
    const { auth, users } = fakeAuth();
    const r = await provisionDoctor(failingInsert(db, table), auth, INPUT);
    assert(!r.ok);
    assertEquals([r.status, r.error], [500, "registration_failed"]);
    assert(r.message.startsWith("No se pudo completar el alta del médico"));
    assert(r.message.includes("No se guardó nada"));
    assertEquals(Object.values(counts(db)).every((n) => n === 0), true, JSON.stringify(counts(db)));
    assertEquals(users.size, 0); // the email is free again for a retry
  });
}

Deno.test("specialties failure explains what to check", async () => {
  const r = await provisionDoctor(failingInsert(empty(), "doctor_specialties"), fakeAuth().auth, INPUT);
  assert(!r.ok && r.message.includes("especialidades"));
});

Deno.test("rollback that can't remove the auth user says the email stayed registered", async () => {
  const db = empty();
  const { auth } = fakeAuth({ deleteError: { message: "network" } });
  const r = await provisionDoctor(failingInsert(db, "doctor_offices"), auth, INPUT);
  assert(!r.ok);
  assertEquals(r.error, "incomplete_registration");
  assert(r.message.includes(INPUT.email));
  assert(r.message.includes("Avisa a soporte"));
});

Deno.test("auth errors are mapped before anything is written", async () => {
  const db = empty();
  const taken = await provisionDoctor(db as unknown as SupabaseClient, fakeAuth({ createError: { message: "User already registered", code: "email_exists" } }).auth, INPUT);
  assert(!taken.ok);
  assertEquals([taken.status, taken.error], [409, "email_taken"]);
  assertEquals(Object.values(counts(db)).every((n) => n === 0), true);
});

Deno.test("no specialties selected is valid (nothing to insert)", async () => {
  const db = empty();
  const r = await provisionDoctor(db as unknown as SupabaseClient, fakeAuth().auth, { ...INPUT, specialty_ids: [] });
  assert(r.ok);
  assertEquals(db.rows("doctor_specialties").length, 0);
});
