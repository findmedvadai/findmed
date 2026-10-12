// [CRON-URL] section of 20261013000000: crons must keep calling production in
// production and be inert anywhere else. Runs the real SQL on PGlite over
// stubs of vault (secrets + decrypted view + create_secret) and net.http_post.
//
//   npm run test:edge

import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import { assertEquals } from "jsr:@std/assert@1";

const applied = await Deno.readTextFile(
  new URL("../migrations/20261012120000_booking_integrity_and_cron.sql", import.meta.url),
);
const followUp = await Deno.readTextFile(
  new URL("../migrations/20261013000000_doctor_overlap_and_cron_vault_url.sql", import.meta.url),
);
// The original invoke_edge_function (hard-coded URL), as applied in prod.
const originalFn = applied.slice(
  applied.indexOf("CREATE OR REPLACE FUNCTION public.invoke_edge_function"),
  applied.indexOf("REVOKE ALL ON FUNCTION"),
);
const cronUrl = followUp.slice(followUp.indexOf("-- [CRON-URL] ----"), followUp.indexOf("-- [/CRON-URL]"));

const STUBS = `
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE SCHEMA vault;
  CREATE TABLE vault.secrets (name text PRIMARY KEY, secret text, description text);
  CREATE VIEW vault.decrypted_secrets AS SELECT name, secret AS decrypted_secret FROM vault.secrets;
  CREATE FUNCTION vault.create_secret(s text, n text, d text) RETURNS uuid LANGUAGE sql AS
    $$ INSERT INTO vault.secrets VALUES (n, s, d); SELECT gen_random_uuid(); $$;
  CREATE SCHEMA net;
  CREATE TABLE net.calls (url text, auth text);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS
    $$ INSERT INTO net.calls VALUES (url, headers->>'Authorization'); SELECT 1::bigint; $$;`;

async function setup(withProdKey: boolean) {
  const db = await PGlite.create();
  await db.exec(STUBS);
  await db.exec(originalFn);
  if (withProdKey) await db.exec(`INSERT INTO vault.secrets VALUES ('service_role_key', 'srv-key', '')`);
  await db.exec(cronUrl);
  return db;
}

Deno.test("production: base URL is carried into Vault and crons keep calling the same project", async () => {
  const db = await setup(true);
  const s = await db.query<{ secret: string }>(`SELECT secret FROM vault.secrets WHERE name = 'edge_functions_base_url'`);
  assertEquals(s.rows[0].secret, "https://jyzvdowflblxmlahlupo.supabase.co/functions/v1");
  await db.exec(`SELECT public.invoke_edge_function('auto-complete-appointments')`);
  const calls = await db.query<{ url: string; auth: string }>(`SELECT url, auth FROM net.calls`);
  assertEquals(calls.rows, [{
    url: "https://jyzvdowflblxmlahlupo.supabase.co/functions/v1/auto-complete-appointments",
    auth: "Bearer srv-key",
  }]);
  await db.close();
});

Deno.test("fresh/local database: no Vault credentials → no secret created, crons are no-ops", async () => {
  const db = await setup(false);
  const s = await db.query(`SELECT 1 FROM vault.secrets WHERE name = 'edge_functions_base_url'`);
  assertEquals(s.rows.length, 0);
  const r = await db.query<{ id: number | null }>(`SELECT public.invoke_edge_function('send-day-of-reminders') AS id`);
  assertEquals(r.rows[0].id, null);
  const calls = await db.query(`SELECT 1 FROM net.calls`);
  assertEquals(calls.rows.length, 0); // nothing sent to production
  await db.close();
});
