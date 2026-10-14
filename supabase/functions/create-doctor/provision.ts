// Doctor sign-up (create-doctor) — all or nothing (F11).
//
// Auth and Postgres can't share a transaction from an Edge Function, so the
// sign-up is a sequence with compensation: if ANY step fails, everything
// created so far is removed and the admin gets a clear error. Before, failures
// in roles, specialties, schedule settings, the default office or its hours
// were only logged and the response still said "Doctor creado": the doctor was
// left half-registered (no office or hours → no slots to offer; no specialties
// → invisible to the triage search) and nobody found out.
//
// Steps: auth user → doctors → users → user_roles → doctor_specialties →
// doctor_schedule_settings → "Consultorio principal" → Mon–Fri 09:00–17:00.

// Same supabase-js build as index.ts (pinned), so the client type matches.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export interface DoctorInput {
  email: string;
  password: string;
  full_name: string;
  phone: string | null;
  address: string | null;
  city_id: string | null;
  zone_id: string | null;
  specialty_ids: string[];
}

/** The subset of `supabase.auth.admin` used here (injectable for tests). */
export interface AuthAdmin {
  createUser(attrs: { email: string; password: string; email_confirm: boolean }): Promise<{
    data: { user: { id: string } | null } | null;
    error: { message?: string; code?: string } | null;
  }>;
  deleteUser(id: string): Promise<{ error: unknown }>;
}

export type ProvisionResult =
  | { ok: true; doctorId: string; authUserId: string; officeId: string }
  | { ok: false; status: number; error: string; message: string };

type StepError = { message?: string; code?: string } | null;

/** Runs one write; a thrown exception counts as a failure like a returned error. */
async function attempt(run: () => PromiseLike<{ error: StepError; data?: unknown }>): Promise<{ error: StepError; data: unknown }> {
  try {
    const r = await run();
    return { error: r.error ?? null, data: r.data ?? null };
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : String(err) }, data: null };
  }
}

const STEP_LABEL = {
  doctor: "registro del médico",
  user: "usuario de acceso",
  role: "rol de médico",
  specialties: "especialidades",
  settings: "ajustes de agenda",
  office: "consultorio principal",
  availability: "horario inicial",
} as const;
type Step = keyof typeof STEP_LABEL;

export async function provisionDoctor(
  db: SupabaseClient,
  auth: AuthAdmin,
  input: DoctorInput,
): Promise<ProvisionResult> {
  // 1. Auth user — common failures: email_exists, weak_password.
  let authUserId: string;
  try {
    const { data, error } = await auth.createUser({ email: input.email, password: input.password, email_confirm: true });
    if (error || !data?.user) {
      const msg = (error?.message ?? "").toLowerCase();
      const code = error?.code ?? "";
      if (code === "email_exists" || msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return { ok: false, status: 409, error: "email_taken", message: "Ese email ya está registrado en el sistema" };
      }
      if (code === "weak_password" || msg.includes("password")) {
        return { ok: false, status: 400, error: "weak_password", message: "La contraseña no cumple los requisitos mínimos" };
      }
      console.error("[create-doctor] auth.admin.createUser failed:", error);
      return { ok: false, status: 500, error: "internal_error", message: "No se pudo crear la cuenta de acceso del médico. Intenta de nuevo." };
    }
    authUserId = data.user.id;
  } catch (err) {
    console.error("[create-doctor] auth.admin.createUser threw:", err);
    return { ok: false, status: 500, error: "internal_error", message: "No se pudo crear la cuenta de acceso del médico. Intenta de nuevo." };
  }

  let doctorId: string | null = null;

  /** Undo everything created so far and build the error for the admin. */
  const fail = async (step: Step, error: StepError): Promise<ProvisionResult> => {
    console.error(`[create-doctor] step "${step}" failed:`, error);
    const leftovers: string[] = [];
    if (doctorId) {
      const id = doctorId;
      // Explicit order (children first) instead of relying on cascades; users
      // references doctors without ON DELETE CASCADE.
      const deletes: [string, () => PromiseLike<{ error: StepError }>][] = [
        ["doctor_weekly_availability", () => db.from("doctor_weekly_availability").delete().eq("doctor_id", id)],
        ["doctor_offices", () => db.from("doctor_offices").delete().eq("doctor_id", id)],
        ["doctor_schedule_settings", () => db.from("doctor_schedule_settings").delete().eq("doctor_id", id)],
        ["doctor_specialties", () => db.from("doctor_specialties").delete().eq("doctor_id", id)],
        ["user_roles", () => db.from("user_roles").delete().eq("user_id", authUserId)],
        ["users", () => db.from("users").delete().eq("id", authUserId)],
        ["doctors", () => db.from("doctors").delete().eq("id", id)],
      ];
      for (const [table, run] of deletes) {
        const r = await attempt(run);
        if (r.error) {
          console.error(`[create-doctor] rollback ${table} failed:`, r.error);
          leftovers.push(table);
        }
      }
    }
    try {
      const { error: delErr } = await auth.deleteUser(authUserId);
      if (delErr) {
        console.error("[create-doctor] rollback auth user failed:", delErr);
        leftovers.push("auth.users");
      }
    } catch (err) {
      console.error("[create-doctor] rollback auth user threw:", err);
      leftovers.push("auth.users");
    }

    const what = STEP_LABEL[step];
    if (leftovers.length === 0) {
      const hint = step === "specialties"
        ? " Revisa que las especialidades elegidas sigan activas en Catálogos."
        : "";
      return {
        ok: false,
        status: 500,
        error: "registration_failed",
        message: `No se pudo completar el alta del médico (falló: ${what}). No se guardó nada, puedes intentarlo de nuevo.${hint}`,
      };
    }
    return {
      ok: false,
      status: 500,
      error: "incomplete_registration",
      message:
        `El alta del médico falló (${what}) y no se pudo deshacer por completo` +
        (leftovers.includes("auth.users") ? `: el correo ${input.email} quedó registrado sin médico.` : ".") +
        " Avisa a soporte antes de volver a intentarlo.",
    };
  };

  // 2. doctors row
  const doc = await attempt(() =>
    db.from("doctors").insert({
      full_name: input.full_name,
      phone: input.phone,
      address: input.address,
      city_id: input.city_id,
      zone_id: input.zone_id,
    }).select("id").single()
  );
  const newDoctorId = (doc.data as { id?: string } | null)?.id ?? null;
  if (doc.error || !newDoctorId) return fail("doctor", doc.error);
  doctorId = newDoctorId;

  // 3. users row (login → role + doctor_id)
  const user = await attempt(() =>
    db.from("users").insert({
      id: authUserId,
      role: "doctor",
      doctor_id: newDoctorId,
      email: input.email,
      initial_password: input.password,
    })
  );
  if (user.error) return fail("user", user.error);

  // 4. user_roles row
  const role = await attempt(() => db.from("user_roles").insert({ user_id: authUserId, role: "doctor" }));
  if (role.error) return fail("role", role.error);

  // 5. specialties (search/triage finds doctors by specialty)
  if (input.specialty_ids.length > 0) {
    const spec = await attempt(() =>
      db.from("doctor_specialties").insert(input.specialty_ids.map((sid) => ({ doctor_id: newDoctorId, specialty_id: sid })))
    );
    if (spec.error) return fail("specialties", spec.error);
  }

  // 6. default schedule settings
  const settings = await attempt(() => db.from("doctor_schedule_settings").insert({ doctor_id: newDoctorId }));
  if (settings.error) return fail("settings", settings.error);

  // 7. default office. Since Mejora 2 everything (availability, calendars,
  // duration) hangs off doctor_offices.
  const office = await attempt(() =>
    db.from("doctor_offices").insert({
      doctor_id: newDoctorId,
      name: "Consultorio principal",
      address: input.address,
      city_id: input.city_id,
      zone_id: input.zone_id,
      appointment_duration_minutes: 30,
    }).select("id").single()
  );
  const officeId = (office.data as { id?: string } | null)?.id ?? null;
  if (office.error || !officeId) return fail("office", office.error);

  // 8. default Mon–Fri 09:00–17:00 on that office
  const avail = await attempt(() =>
    db.from("doctor_weekly_availability").insert(
      [1, 2, 3, 4, 5].map((wd) => ({
        doctor_id: newDoctorId,
        office_id: officeId,
        weekday: wd,
        start_time: "09:00",
        end_time: "17:00",
        is_enabled: true,
      })),
    )
  );
  if (avail.error) return fail("availability", avail.error);

  return { ok: true, doctorId: newDoctorId, authUserId, officeId };
}
