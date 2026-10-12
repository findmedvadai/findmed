// Applies migration 20261013100000_operation_requests.sql verbatim on PGlite,
// over minimal stubs of what it depends on (auth.uid, role authenticated,
// update_updated_at_column, is_admin_or_superadmin, appointments). Catches SQL
// errors before `db push` and checks the one-live-intent rule.
//
//   npm run test:edge

import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  new URL("../migrations/20261013100000_operation_requests.sql", import.meta.url),
);

const STUBS = `
  CREATE ROLE authenticated;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
  CREATE FUNCTION public.is_admin_or_superadmin(_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
  CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS
    $$BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;
  CREATE TABLE public.appointments (id uuid PRIMARY KEY);
  INSERT INTO public.appointments VALUES ('00000000-0000-0000-0000-000000000001');`;

const ins = (status: string) => `
  INSERT INTO operation_requests (channel, subject_phone, action, appointment_id, payload_hash, status, expires_at)
  VALUES ('mcp', '+525512345678', 'cancel', '00000000-0000-0000-0000-000000000001', 'h', '${status}', now() + interval '15 minutes')`;

Deno.test("operation_requests migration applies and enforces one live intent", async () => {
  const db = await PGlite.create();
  await db.exec(STUBS);
  await db.exec(migration);

  await db.exec(ins("pending_confirmation"));
  const err = await assertRejects(() => db.exec(ins("pending_confirmation"))) as { code?: string };
  assertEquals(err.code, "23505"); // second live intent for the same thing

  await db.exec(ins("succeeded")); // finished ones don't count
  const bad = await assertRejects(() => db.exec(ins("done"))) as { code?: string };
  assertEquals(bad.code, "23514"); // status CHECK

  const rls = await db.query<{ relrowsecurity: boolean }>(
    "SELECT relrowsecurity FROM pg_class WHERE relname = 'operation_requests'",
  );
  assertEquals(rls.rows[0].relrowsecurity, true);
  await db.close();
});

Deno.test("whaapy_events migration applies; dedupe_key is unique; RLS on", async () => {
  const sql = await Deno.readTextFile(new URL("../migrations/20261013110000_whaapy_events.sql", import.meta.url));
  const db = await PGlite.create();
  await db.exec(STUBS);
  await db.exec(sql);
  await db.exec(`INSERT INTO whaapy_events (dedupe_key, event_type, payload) VALUES ('k1', 'message.delivered', '{}')`);
  const dup = await assertRejects(() =>
    db.exec(`INSERT INTO whaapy_events (dedupe_key, event_type, payload) VALUES ('k1', 'message.delivered', '{}')`)
  ) as { code?: string };
  assertEquals(dup.code, "23505");
  const rls = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname = 'whaapy_events'");
  assertEquals(rls.rows[0].relrowsecurity, true);
  await db.close();
});
