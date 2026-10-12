// R18 / R25: the appointments exclusion constraint (decision D2).
//
// Runs the REAL "Integrity" section of the migration (read from disk, not
// copied) against an in-process Postgres (PGlite + btree_gist), on a minimal
// appointments table with the same column types. No Docker, no network.
//
// Limitation: PGlite is single-connection, so this proves the constraint's
// semantics, not two truly concurrent sessions; Postgres guarantees exclusion
// constraints under concurrency, and R18 stays "not_run" for the IR variant.
//
//   npx deno test --allow-read --allow-env supabase/tests/booking-constraint_test.ts

import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import { btree_gist } from "npm:@electric-sql/pglite@0.3.15/contrib/btree_gist";
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  new URL("../migrations/20261012120000_booking_integrity_and_cron.sql", import.meta.url),
);
const integrity = migration.slice(
  migration.indexOf("CREATE EXTENSION IF NOT EXISTS btree_gist"),
  migration.indexOf("-- 2. Cron idempotency"),
);

const SCHEMA = `
  CREATE TYPE appointment_status AS ENUM ('scheduled','confirmed','cancelled','completed');
  CREATE TABLE public.appointments (
    id serial PRIMARY KEY, doctor_id uuid NOT NULL, office_id uuid,
    start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
    status appointment_status NOT NULL DEFAULT 'scheduled');`;

const u = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ins = (doctor: number, office: number, start: string, end: string, status = "scheduled") =>
  `INSERT INTO appointments (doctor_id, office_id, start_at, end_at, status)
   VALUES ('${u(doctor)}', '${u(office)}', '2026-11-02 ${start}-06', '2026-11-02 ${end}-06', '${status}')`;

async function freshDb() {
  const db = await PGlite.create({ extensions: { btree_gist } });
  await db.exec(SCHEMA);
  return db;
}

async function rejectsWith(db: PGlite, sql: string, code: string) {
  const err = await assertRejects(() => db.exec(sql)) as { code?: string };
  assertEquals(err.code, code);
}

Deno.test("pre-check aborts the migration when a doctor already has overlapping live appointments", async () => {
  const db = await freshDb();
  await db.exec(ins(1, 1, "10:00", "10:30"));
  await db.exec(ins(1, 2, "10:15", "10:45")); // same doctor, other office
  const err = await assertRejects(() => db.exec(integrity)) as Error;
  assertEquals(String(err.message).includes("appointments_no_overlap_per_doctor"), true);
  await db.close();
});

Deno.test("constraint semantics (R18, R25)", async (t) => {
  const db = await freshDb();
  await db.exec(ins(9, 9, "08:00", "08:30", "cancelled"));
  await db.exec(ins(9, 9, "08:00", "08:30", "completed")); // inactive rows don't block the migration
  await db.exec(integrity);
  await db.exec(ins(1, 1, "10:00", "10:30"));

  await t.step("R25: same doctor, other office, overlapping → 23P01", () =>
    rejectsWith(db, ins(1, 2, "10:15", "10:45"), "23P01"));
  await t.step("R18: same doctor, same slot → 23P01", () =>
    rejectsWith(db, ins(1, 1, "10:00", "10:30"), "23P01"));
  await t.step("adjacent slot is allowed (half-open range)", async () => {
    await db.exec(ins(1, 1, "10:30", "11:00"));
  });
  await t.step("another doctor at the same time is allowed", async () => {
    await db.exec(ins(2, 1, "10:00", "10:30"));
  });
  await t.step("cancelled overlapping row is allowed", async () => {
    await db.exec(ins(1, 1, "10:00", "10:30", "cancelled"));
  });
  await t.step("reactivating a cancelled overlap → 23P01", () =>
    rejectsWith(db, `UPDATE appointments SET status='confirmed' WHERE doctor_id='${u(1)}' AND status='cancelled'`, "23P01"));
  await t.step("rescheduling onto an occupied slot → 23P01", () =>
    rejectsWith(
      db,
      `UPDATE appointments SET start_at='2026-11-02 10:15-06', end_at='2026-11-02 10:45-06'
        WHERE doctor_id='${u(1)}' AND start_at='2026-11-02 10:30-06'`,
      "23P01",
    ));
  await t.step("end_at <= start_at → 23514", () => rejectsWith(db, ins(3, 1, "12:00", "12:00"), "23514"));
  await db.close();
});
