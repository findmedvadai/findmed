// Security hardening migration (20261014160000): privileges and RLS as each role sees them.
//
// Replays the REAL migration file over a minimal copy of the production schema (same
// policies as pg_policies on 14-oct-2026, Supabase-style default grants) in PGlite, then
// runs statements as anon / a doctor / an admin / service_role with SET ROLE and a stubbed
// auth.uid(). No network, no Docker.
//
//   npx deno test --allow-read --allow-env supabase/tests/security-hardening_test.ts

import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  new URL("../migrations/20261014160000_security_hardening.sql", import.meta.url),
);

const u = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN_USER = u(1);
const DOC1_USER = u(2);
const DOC2_USER = u(3);
const DOC1 = u(11);
const DOC2 = u(12);
const OFFICE1 = u(21);
const APPT1 = u(31); // doctor 1
const APPT2 = u(32); // doctor 2
const PATIENT = u(41);

// Minimal production-like schema with the policies that existed before the migration.
const SCHEMA = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

  CREATE TYPE app_role AS ENUM ('superadmin','admin','doctor');
  CREATE TYPE appointment_status AS ENUM ('scheduled','confirmed','cancelled','completed');
  CREATE TYPE notification_type AS ENUM ('appointment_scheduled','postconsultation_submitted','case_handoff');
  CREATE TYPE post_consultation_status AS ENUM ('pending','read','report_sent');

  CREATE TABLE users (id uuid PRIMARY KEY, email text, role app_role NOT NULL, doctor_id uuid, initial_password text);
  CREATE TABLE user_roles (id serial PRIMARY KEY, user_id uuid NOT NULL, role app_role NOT NULL);
  CREATE TABLE doctors (
    id uuid PRIMARY KEY, full_name text NOT NULL, phone text, address text, is_active boolean DEFAULT true,
    is_deleted boolean DEFAULT false, google_calendar_connected boolean DEFAULT false,
    google_refresh_token_ref text, google_calendar_id text, outlook_refresh_token_ref text,
    outlook_calendar_id text, outlook_calendar_connected boolean DEFAULT false,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
  CREATE TABLE doctor_offices (
    id uuid PRIMARY KEY, doctor_id uuid NOT NULL, name text NOT NULL, google_calendar_connected boolean DEFAULT false,
    google_refresh_token_ref text, outlook_refresh_token_ref text, is_deleted boolean DEFAULT false);
  CREATE TABLE patients (id uuid PRIMARY KEY, full_name text, phone text);
  CREATE TABLE appointments (
    id uuid PRIMARY KEY, doctor_id uuid NOT NULL, patient_id uuid, start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL, status appointment_status NOT NULL DEFAULT 'scheduled', cancel_reason text,
    doctor_notes text, doctor_notes_updated_at timestamptz, reminder_48h_sent_at timestamptz,
    updated_at timestamptz DEFAULT now());
  CREATE TABLE notifications (
    id serial PRIMARY KEY, recipient_role app_role NOT NULL, doctor_id uuid, title text, body text,
    type notification_type NOT NULL, appointment_id uuid, is_read boolean DEFAULT false, case_id uuid);
  CREATE TABLE post_consultation_forms (
    id serial PRIMARY KEY, appointment_id uuid NOT NULL, doctor_id uuid NOT NULL, observations text,
    review_status post_consultation_status NOT NULL DEFAULT 'pending', report_sent_at timestamptz,
    report_destination_id uuid);
  CREATE TABLE webhooks (id serial PRIMARY KEY, url text, secret text);

  CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS
    $$BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;
  CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  CREATE TRIGGER update_doctors_updated_at BEFORE UPDATE ON doctors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  CREATE FUNCTION public.get_doctor_id_for_user(_user_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public AS $$ SELECT doctor_id FROM public.users WHERE id = _user_id $$;
  CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
  CREATE FUNCTION public.is_admin_or_superadmin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','superadmin')) $$;

  -- Supabase default grants.
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

  DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['users','user_roles','doctors','doctor_offices','patients','appointments',
                             'notifications','post_consultation_forms','webhooks'] LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP; END $$;

  CREATE POLICY "Admin can manage users" ON users FOR ALL TO authenticated
    USING (is_admin_or_superadmin(auth.uid())) WITH CHECK (is_admin_or_superadmin(auth.uid()));
  CREATE POLICY "User can read own record" ON users FOR SELECT TO authenticated USING (id = auth.uid());
  CREATE POLICY "Admin can manage roles" ON user_roles FOR ALL TO authenticated
    USING (is_admin_or_superadmin(auth.uid())) WITH CHECK (is_admin_or_superadmin(auth.uid()));
  CREATE POLICY "Admin can manage doctors" ON doctors FOR ALL TO authenticated
    USING (is_admin_or_superadmin(auth.uid())) WITH CHECK (is_admin_or_superadmin(auth.uid()));
  CREATE POLICY "Doctor can read own profile" ON doctors FOR SELECT TO authenticated
    USING (id = get_doctor_id_for_user(auth.uid()));
  CREATE POLICY "Doctor can update own profile" ON doctors FOR UPDATE TO authenticated
    USING (id = get_doctor_id_for_user(auth.uid())) WITH CHECK (id = get_doctor_id_for_user(auth.uid()));
  CREATE POLICY "Admin can manage doctor_offices" ON doctor_offices FOR ALL TO authenticated
    USING (is_admin_or_superadmin(auth.uid())) WITH CHECK (is_admin_or_superadmin(auth.uid()));
  CREATE POLICY "Doctor can manage own offices" ON doctor_offices FOR ALL TO authenticated
    USING (doctor_id = get_doctor_id_for_user(auth.uid())) WITH CHECK (doctor_id = get_doctor_id_for_user(auth.uid()));
  CREATE POLICY "Admin can manage patients" ON patients FOR ALL TO authenticated
    USING (is_admin_or_superadmin(auth.uid())) WITH CHECK (is_admin_or_superadmin(auth.uid()));
  CREATE POLICY "Doctor can read own patients" ON patients FOR SELECT
    USING (id IN (SELECT patient_id FROM appointments WHERE doctor_id = get_doctor_id_for_user(auth.uid())));
  CREATE POLICY "Admin can manage appointments" ON appointments FOR ALL TO authenticated
    USING (is_admin_or_superadmin(auth.uid())) WITH CHECK (is_admin_or_superadmin(auth.uid()));
  CREATE POLICY "Doctor can read own appointments" ON appointments FOR SELECT TO authenticated
    USING (doctor_id = get_doctor_id_for_user(auth.uid()));
  CREATE POLICY "Doctor can update own appointment notes" ON appointments FOR UPDATE TO authenticated
    USING (doctor_id = get_doctor_id_for_user(auth.uid())) WITH CHECK (doctor_id = get_doctor_id_for_user(auth.uid()));
  CREATE POLICY "Doctor can insert admin notifications" ON notifications FOR INSERT
    WITH CHECK (recipient_role = ANY (ARRAY['admin'::app_role,'superadmin'::app_role])
                AND doctor_id = get_doctor_id_for_user(auth.uid()));
  CREATE POLICY "Admin can read admin notifications" ON notifications FOR SELECT TO authenticated
    USING (is_admin_or_superadmin(auth.uid()));
  CREATE POLICY "Doctor can read own notifications" ON notifications FOR SELECT TO authenticated
    USING (recipient_role = 'doctor' AND doctor_id = get_doctor_id_for_user(auth.uid()));
  CREATE POLICY "Admin can update admin notifications" ON notifications FOR UPDATE TO authenticated
    USING (is_admin_or_superadmin(auth.uid()));
  CREATE POLICY "Doctor can update own notifications" ON notifications FOR UPDATE TO authenticated
    USING (recipient_role = 'doctor' AND doctor_id = get_doctor_id_for_user(auth.uid()));
  CREATE POLICY "Doctor can insert own forms" ON post_consultation_forms FOR INSERT TO authenticated
    WITH CHECK (doctor_id = get_doctor_id_for_user(auth.uid()));
  CREATE POLICY "Doctor can read own forms" ON post_consultation_forms FOR SELECT TO authenticated
    USING (doctor_id = get_doctor_id_for_user(auth.uid()));
  CREATE POLICY "Admin can manage webhooks" ON webhooks FOR ALL
    USING (is_admin_or_superadmin(auth.uid())) WITH CHECK (is_admin_or_superadmin(auth.uid()));

  INSERT INTO users VALUES ('${ADMIN_USER}', 'a@x', 'admin', NULL, NULL),
                           ('${DOC1_USER}', 'd1@x', 'doctor', '${DOC1}', NULL),
                           ('${DOC2_USER}', 'd2@x', 'doctor', '${DOC2}', NULL);
  INSERT INTO user_roles (user_id, role) VALUES ('${ADMIN_USER}', 'admin'), ('${DOC1_USER}', 'doctor'), ('${DOC2_USER}', 'doctor');
  INSERT INTO doctors (id, full_name, google_refresh_token_ref) VALUES ('${DOC1}', 'Dra. Uno', 'legacy-token'), ('${DOC2}', 'Dr. Dos', NULL);
  INSERT INTO doctor_offices (id, doctor_id, name, google_refresh_token_ref) VALUES ('${OFFICE1}', '${DOC1}', 'Roma', 'refresh-token-1');
  INSERT INTO patients VALUES ('${PATIENT}', 'Paciente', '+525500000000');
  INSERT INTO appointments (id, doctor_id, patient_id, start_at, end_at) VALUES
    ('${APPT1}', '${DOC1}', '${PATIENT}', '2026-11-02 10:00-06', '2026-11-02 10:30-06'),
    ('${APPT2}', '${DOC2}', '${PATIENT}', '2026-11-02 11:00-06', '2026-11-02 11:30-06');
  INSERT INTO notifications (recipient_role, doctor_id, title, type) VALUES ('doctor', '${DOC1}', 'Hola', 'appointment_scheduled');
  INSERT INTO webhooks (url, secret) VALUES ('https://n8n.example', 'whsec');
`;

async function freshDb() {
  const db = await PGlite.create();
  await db.exec(SCHEMA);
  await db.exec(migration);
  return db;
}

/** Runs `sql` as `role` with auth.uid() = `uid`, always restoring the superuser session. */
async function as(db: PGlite, role: string, uid: string | null, sql: string) {
  await db.exec(`SET ROLE ${role}; SELECT set_config('test.uid', '${uid ?? ""}', false);`);
  try {
    return await db.query<Record<string, unknown>>(sql);
  } finally {
    await db.exec("RESET ROLE; SELECT set_config('test.uid', '', false);");
  }
}

async function denied(db: PGlite, role: string, uid: string | null, sql: string) {
  const err = await assertRejects(() => as(db, role, uid, sql)) as { code?: string };
  assertEquals(err.code, "42501", `expected 42501 for: ${sql}`);
}

Deno.test("migration is idempotent", async () => {
  const db = await freshDb();
  await db.exec(migration);
  await db.close();
});

Deno.test("anon: no table privileges and no role oracle via RPC", async (t) => {
  const db = await freshDb();
  for (const table of ["patients", "appointments", "users", "webhooks", "doctor_offices", "notifications"]) {
    await t.step(`SELECT ${table} → 42501`, () => denied(db, "anon", null, `SELECT * FROM ${table} LIMIT 1`));
  }
  await t.step("is_admin_or_superadmin → 42501", () =>
    denied(db, "anon", null, `SELECT is_admin_or_superadmin('${ADMIN_USER}')`));
  await t.step("get_doctor_id_for_user → 42501", () =>
    denied(db, "anon", null, `SELECT get_doctor_id_for_user('${DOC1_USER}')`));
  await t.step("has_role → 42501", () => denied(db, "anon", null, `SELECT has_role('${ADMIN_USER}', 'admin')`));
  await t.step("a table created later is not readable by anon either", async () => {
    await db.exec("CREATE TABLE public.future_table (id int); INSERT INTO future_table VALUES (1);");
    await denied(db, "anon", null, "SELECT * FROM future_table");
  });
  await db.close();
});

Deno.test("refresh tokens are not readable from the browser (N13)", async (t) => {
  const db = await freshDb();
  await t.step("doctor cannot read own office token", () =>
    denied(db, "authenticated", DOC1_USER, "SELECT google_refresh_token_ref FROM doctor_offices"));
  await t.step("admin cannot read office tokens either", () =>
    denied(db, "authenticated", ADMIN_USER, "SELECT outlook_refresh_token_ref FROM doctor_offices"));
  await t.step("select * is denied (column privileges)", () =>
    denied(db, "authenticated", DOC1_USER, "SELECT * FROM doctor_offices"));
  await t.step("legacy doctors tokens are hidden", () =>
    denied(db, "authenticated", DOC1_USER, "SELECT google_refresh_token_ref FROM doctors"));
  await t.step("presence flag is readable instead", async () => {
    const r = await as(db, "authenticated", DOC1_USER,
      "SELECT id, name, google_token_stored, outlook_token_stored FROM doctor_offices");
    assertEquals(r.rows, [{ id: OFFICE1, name: "Roma", google_token_stored: true, outlook_token_stored: false }]);
  });
  await t.step("doctor cannot write offices directly (only doctor-office-* functions)", async () => {
    await denied(db, "authenticated", DOC1_USER, `UPDATE doctor_offices SET google_refresh_token_ref = 'x' WHERE id = '${OFFICE1}'`);
    await denied(db, "authenticated", DOC1_USER, `DELETE FROM doctor_offices WHERE id = '${OFFICE1}'`);
    await denied(db, "authenticated", DOC1_USER,
      `INSERT INTO doctor_offices (id, doctor_id, name) VALUES ('${u(99)}', '${DOC1}', 'Otra')`);
  });
  await t.step("service role still reads tokens", async () => {
    const r = await as(db, "service_role", null, "SELECT google_refresh_token_ref FROM doctor_offices");
    assertEquals(r.rows.length, 1);
  });
  await db.close();
});

Deno.test("doctor can only edit notes / complete own appointments (N13)", async (t) => {
  const db = await freshDb();
  await t.step("notes + complete (PorCompletar / AppointmentDetailDialog) works", async () => {
    const r = await as(db, "authenticated", DOC1_USER,
      `UPDATE appointments SET doctor_notes = 'ok', doctor_notes_updated_at = now(), status = 'completed' WHERE id = '${APPT1}'`);
    assertEquals(r.affectedRows, 1);
  });
  await t.step("re-saving notes on a completed appointment works", async () => {
    const r = await as(db, "authenticated", DOC1_USER,
      `UPDATE appointments SET doctor_notes = 'ok 2', status = 'completed' WHERE id = '${APPT1}'`);
    assertEquals(r.affectedRows, 1);
  });
  await t.step("moving start_at is rejected", () =>
    denied(db, "authenticated", DOC1_USER, `UPDATE appointments SET start_at = start_at + interval '1 day' WHERE id = '${APPT1}'`));
  await t.step("clearing a cron marker is rejected", () =>
    denied(db, "authenticated", DOC1_USER, `UPDATE appointments SET reminder_48h_sent_at = now() WHERE id = '${APPT1}'`));
  await t.step("cancel/uncomplete via table is rejected", () =>
    denied(db, "authenticated", DOC1_USER, `UPDATE appointments SET status = 'scheduled' WHERE id = '${APPT1}'`));
  await t.step("another doctor's appointment is invisible (0 rows)", async () => {
    const r = await as(db, "authenticated", DOC1_USER, `UPDATE appointments SET doctor_notes = 'x' WHERE id = '${APPT2}'`);
    assertEquals(r.affectedRows, 0);
  });
  await t.step("admin keeps full update rights", async () => {
    const r = await as(db, "authenticated", ADMIN_USER,
      `UPDATE appointments SET start_at = start_at + interval '1 hour', end_at = end_at + interval '1 hour' WHERE id = '${APPT2}'`);
    assertEquals(r.affectedRows, 1);
  });
  await t.step("service role (Edge Functions) is not affected", async () => {
    const r = await as(db, "service_role", null, `UPDATE appointments SET status = 'cancelled', cancel_reason = 'admin' WHERE id = '${APPT2}'`);
    assertEquals(r.affectedRows, 1);
  });
  await t.step("authenticated cannot TRUNCATE (bypasses RLS)", () =>
    denied(db, "authenticated", ADMIN_USER, "TRUNCATE appointments"));
  await db.close();
});

Deno.test("doctor profile: name/phone only; admin manages status (N13)", async (t) => {
  const db = await freshDb();
  await t.step("doctor edits name and phone", async () => {
    const r = await as(db, "authenticated", DOC1_USER, `UPDATE doctors SET full_name = 'Dra. Uno B', phone = '55' WHERE id = '${DOC1}'`);
    assertEquals(r.affectedRows, 1);
  });
  await t.step("doctor cannot reactivate / undelete himself", async () => {
    await as(db, "service_role", null, `UPDATE doctors SET is_active = false, is_deleted = true WHERE id = '${DOC1}'`);
    await denied(db, "authenticated", DOC1_USER, `UPDATE doctors SET is_active = true WHERE id = '${DOC1}'`);
    await denied(db, "authenticated", DOC1_USER, `UPDATE doctors SET is_deleted = false WHERE id = '${DOC1}'`);
  });
  await t.step("nobody writes doctor tokens from the browser", () =>
    denied(db, "authenticated", ADMIN_USER, `UPDATE doctors SET google_refresh_token_ref = 'x' WHERE id = '${DOC1}'`));
  await t.step("admin deactivates / soft-deletes (Doctores.tsx)", async () => {
    const r = await as(db, "authenticated", ADMIN_USER,
      `UPDATE doctors SET is_active = false, is_deleted = true, address = 'x' WHERE id = '${DOC2}'`);
    assertEquals(r.affectedRows, 1);
  });
  await t.step("admin cannot hard-delete or insert doctors from the browser", async () => {
    await denied(db, "authenticated", ADMIN_USER, `DELETE FROM doctors WHERE id = '${DOC2}'`);
    await denied(db, "authenticated", ADMIN_USER, `INSERT INTO doctors (id, full_name) VALUES ('${u(98)}', 'X')`);
  });
  await db.close();
});

Deno.test("roles cannot be changed from the browser (N13: admin → superadmin)", async (t) => {
  const db = await freshDb();
  await t.step("admin cannot grant superadmin in user_roles", () =>
    denied(db, "authenticated", ADMIN_USER, `INSERT INTO user_roles (user_id, role) VALUES ('${ADMIN_USER}', 'superadmin')`));
  await t.step("admin cannot change users.role", () =>
    denied(db, "authenticated", ADMIN_USER, `UPDATE users SET role = 'superadmin' WHERE id = '${ADMIN_USER}'`));
  await t.step("admin still reads users (Casos, Doctores)", async () => {
    const r = await as(db, "authenticated", ADMIN_USER, "SELECT id, email FROM users");
    assertEquals(r.rows.length, 3);
  });
  await t.step("doctor still resolves own role (useAuth)", async () => {
    const r = await as(db, "authenticated", DOC1_USER, "SELECT role, doctor_id FROM users");
    assertEquals(r.rows, [{ role: "doctor", doctor_id: DOC1 }]);
  });
  await db.close();
});

Deno.test("notifications and post-consultation inserts are scoped to the doctor's own appointments", async (t) => {
  const db = await freshDb();
  const notif = (appt: string, type = "postconsultation_submitted") =>
    `INSERT INTO notifications (doctor_id, appointment_id, recipient_role, type, title, body)
     VALUES ('${DOC1}', '${appt}', 'admin', '${type}', 'Formulario', 'x')`;
  await t.step("PorCompletar notification for own appointment works", async () => {
    await as(db, "authenticated", DOC1_USER, notif(APPT1));
  });
  await t.step("notification about another doctor's appointment is rejected", () =>
    denied(db, "authenticated", DOC1_USER, notif(APPT2)));
  await t.step("doctor cannot fake a case alert", () =>
    denied(db, "authenticated", DOC1_USER, notif(APPT1, "case_handoff")));
  await t.step("mark as read works; rewriting the text does not", async () => {
    const r = await as(db, "authenticated", DOC1_USER, "UPDATE notifications SET is_read = true WHERE recipient_role = 'doctor'");
    assertEquals(r.affectedRows, 1);
    await denied(db, "authenticated", DOC1_USER, "UPDATE notifications SET title = 'x' WHERE recipient_role = 'doctor'");
  });
  const form = (appt: string, extra = "") =>
    `INSERT INTO post_consultation_forms (appointment_id, doctor_id, observations${extra ? ", review_status" : ""})
     VALUES ('${appt}', '${DOC1}', 'obs'${extra ? `, '${extra}'` : ""})`;
  await t.step("form for own appointment works", async () => {
    await as(db, "authenticated", DOC1_USER, form(APPT1));
  });
  await t.step("form for another doctor's appointment is rejected", () =>
    denied(db, "authenticated", DOC1_USER, form(APPT2)));
  await t.step("form cannot be born as 'report_sent'", () =>
    denied(db, "authenticated", DOC1_USER, form(APPT1, "report_sent")));
  await t.step("doctor still reads own patients; anon does not", async () => {
    const r = await as(db, "authenticated", DOC1_USER, "SELECT id FROM patients");
    assertEquals(r.rows.length, 1);
    await denied(db, "anon", null, "SELECT id FROM patients");
  });
  await t.step("webhooks: admin only", async () => {
    const r = await as(db, "authenticated", ADMIN_USER, "SELECT url FROM webhooks");
    assertEquals(r.rows.length, 1);
    const d = await as(db, "authenticated", DOC1_USER, "SELECT url FROM webhooks");
    assertEquals(d.rows.length, 0);
  });
  await db.close();
});
