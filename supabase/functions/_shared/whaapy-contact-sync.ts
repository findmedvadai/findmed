// Copies what FindMed knows about a patient into the WHAAPY contact (CRM), so
// the team stops typing it by hand (garantía 20-oct-2026: "WHAAPY no jaló los
// datos del paciente de manera automática, los tuvimos que cargar manualmente").
// Before the migration n8n wrote these fields with one tool per field
// (docs/findmed-migration/n8n-nodos.md N008–N012, N018); the MCP saves them in
// FindMed's database, and this helper projects them back to WHAAPY.
//
// Field keys: the business's WHAAPY Field Definitions (GET /contacts/v1/fields,
// read 20-oct-2026). Only keys that exist there are written:
//   findmed_nombre_completo ← patients.full_name (titular, owner of the phone)
//   findmed_aseguradora     ← patients.insurer ("Sin seguro" when has_insurance = false)
//   findmed_numero_poliza   ← patients.policy_number ("" when has_insurance = false)
// FindMed doesn't store vigencia/tiempo/tipo de póliza, so those fields are
// never touched. There is NO field definition for the person attended (the
// beneficiary); appointments.patient_name is not projected until WHAAPY has one.
//
// Contact `name` (the CRM title) is written only when nobody on the team chose
// it: empty, a phone number, equal to the WhatsApp profile name (WHAAPY copies
// wa_name into name when it creates the contact: 96 of 100 contacts on
// 20-oct), or equal to the findmed_nombre_completo FindMed wrote before. A
// name the team typed by hand is never overwritten.
//
// Best-effort by contract: never throws, never blocks the patient flow, logs
// one line with ids and field KEYS only (no names, phones or policy numbers).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { WhaapyClient, WhaapyContactPatch, WhaapyContactSnapshot } from "./whaapy-client.ts";
import { isValidNormalizedPhone, mxPhoneLookupVariants, normalizeMxPhone } from "./phone.ts";
import { cleanPersonName, isPlaceholderName } from "./patient-identity.ts";

export const WHAAPY_CONTACT_FIELDS = {
  fullName: "findmed_nombre_completo",
  insurer: "findmed_aseguradora",
  policyNumber: "findmed_numero_poliza",
} as const;

export const NO_INSURANCE_LABEL = "Sin seguro";

export interface ContactSyncInput {
  /** Contact phone (any format). Defaults to the patient's phone. */
  phone?: string | null;
  /** Patient to project. Without it the patient is looked up by phone. */
  patientId?: string | null;
  /** Name to use only when there is no patient row (e.g. open_case contact_name). */
  fallbackName?: string | null;
}

export type ContactSyncResult =
  | { ok: true; status: "updated" | "unchanged"; contact_id: string; name_written: boolean; fields: string[] }
  | { ok: false; status: "skipped" | "failed"; reason: string };

interface PatientRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  has_insurance: boolean | null;
  insurer: string | null;
  policy_number: string | null;
}

const PATIENT_COLUMNS = "id, full_name, phone, has_insurance, insurer, policy_number";

const same = (a: unknown, b: unknown) =>
  String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** True when nobody on the team chose the contact's name (safe to replace). */
export function contactNameIsAutomatic(contact: WhaapyContactSnapshot): boolean {
  const name = (contact.name ?? "").trim();
  if (isPlaceholderName(name)) return true;
  if (contact.wa_name && same(name, contact.wa_name)) return true;
  const ours = contact.custom_fields?.[WHAAPY_CONTACT_FIELDS.fullName];
  return typeof ours === "string" && ours.trim() !== "" && same(name, ours);
}

/** The PATCH body that brings the contact up to date, or null when nothing changes. */
export function buildContactPatch(
  contact: WhaapyContactSnapshot,
  patient: Pick<PatientRow, "full_name" | "has_insurance" | "insurer" | "policy_number"> | null,
  fallbackName: string | null = null,
): WhaapyContactPatch | null {
  const current = contact.custom_fields ?? {};
  const fields: Record<string, string> = {};
  const want = (key: string, value: string) => {
    const now = current[key];
    if (value === "" ? (now === undefined || now === null || now === "") : now === value) return;
    fields[key] = value;
  };

  const titular = patient && !isPlaceholderName(patient.full_name)
    ? cleanPersonName(patient.full_name)
    : cleanPersonName(fallbackName);
  if (titular && !isPlaceholderName(titular)) want(WHAAPY_CONTACT_FIELDS.fullName, titular);

  if (patient?.has_insurance === true) {
    if (patient.insurer) want(WHAAPY_CONTACT_FIELDS.insurer, patient.insurer);
    if (patient.policy_number) want(WHAAPY_CONTACT_FIELDS.policyNumber, patient.policy_number);
  } else if (patient?.has_insurance === false) {
    want(WHAAPY_CONTACT_FIELDS.insurer, NO_INSURANCE_LABEL);
    want(WHAAPY_CONTACT_FIELDS.policyNumber, "");
  }

  const patch: WhaapyContactPatch = {};
  if (titular && !isPlaceholderName(titular) && contactNameIsAutomatic(contact) && (contact.name ?? "").trim() !== titular) {
    patch.name = titular;
  }
  if (Object.keys(fields).length > 0) patch.custom_fields = fields;
  return Object.keys(patch).length > 0 ? patch : null;
}

async function loadPatient(supabase: SupabaseClient, input: ContactSyncInput): Promise<PatientRow | null> {
  if (input.patientId) {
    const { data } = await supabase.from("patients").select(PATIENT_COLUMNS).eq("id", input.patientId).maybeSingle();
    return (data as PatientRow | null) ?? null;
  }
  if (!input.phone) return null;
  const canonical = normalizeMxPhone(input.phone);
  if (!isValidNormalizedPhone(canonical)) return null;
  const { data } = await supabase
    .from("patients")
    .select(PATIENT_COLUMNS)
    .in("phone", mxPhoneLookupVariants(canonical))
    .order("created_at", { ascending: true })
    .limit(1);
  return (data as PatientRow[] | null)?.[0] ?? null;
}

function log(result: ContactSyncResult, patientId: string | null) {
  console.log(JSON.stringify({ event: "whaapy_contact_sync", patient_id: patientId, ...result }));
}

export async function syncWhaapyContact(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  input: ContactSyncInput,
): Promise<ContactSyncResult> {
  let patientId: string | null = input.patientId ?? null;
  const done = (r: ContactSyncResult) => {
    log(r, patientId);
    return r;
  };
  try {
    if (!whaapy?.configured) return done({ ok: false, status: "skipped", reason: "whaapy_not_configured" });
    const patient = await loadPatient(supabase, input);
    patientId = patient?.id ?? patientId;
    const fallbackName = cleanPersonName(input.fallbackName);
    if (!patient && !fallbackName) return done({ ok: false, status: "skipped", reason: "no_patient" });

    const rawPhone = input.phone ?? patient?.phone ?? null;
    const phone = rawPhone ? normalizeMxPhone(rawPhone) : null;
    if (!phone || !isValidNormalizedPhone(phone)) return done({ ok: false, status: "skipped", reason: "no_phone" });

    const conv = await whaapy.conversationByPhone(phone);
    if (!conv.ok) return done({ ok: false, status: "failed", reason: `lookup_${conv.status || conv.error}` });
    const contactId = conv.data?.contact_id ?? null;
    if (!contactId) return done({ ok: false, status: "skipped", reason: "no_contact" });

    const snapshot: WhaapyContactSnapshot = conv.data?.contact ?? { name: null, wa_name: null, custom_fields: {} };
    const patch = buildContactPatch(snapshot, patient, fallbackName);
    if (!patch) {
      return done({ ok: true, status: "unchanged", contact_id: contactId, name_written: false, fields: [] });
    }
    const r = await whaapy.updateContact(contactId, patch);
    if (!r.ok) return done({ ok: false, status: "failed", reason: `update_${r.status || r.error}` });
    return done({
      ok: true,
      status: "updated",
      contact_id: contactId,
      name_written: patch.name !== undefined,
      fields: Object.keys(patch.custom_fields ?? {}),
    });
  } catch (e) {
    return done({ ok: false, status: "failed", reason: e instanceof Error ? e.name : "exception" });
  }
}

/**
 * Runs a best-effort task without making the caller wait when the Supabase
 * Edge runtime is there (EdgeRuntime.waitUntil keeps the worker alive after the
 * response). Elsewhere (tests, local scripts) the returned promise resolves when
 * the task ends, so callers `await` it and tests stay deterministic. Never rejects.
 */
export function runInBackground(task: Promise<unknown>): Promise<void> {
  const safe = task.then(() => undefined, () => undefined);
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof rt?.waitUntil === "function") {
    rt.waitUntil(safe);
    return Promise.resolve();
  }
  return safe;
}

/** syncWhaapyContact in the background (see runInBackground). Never throws. */
export function scheduleWhaapyContactSync(
  supabase: SupabaseClient,
  whaapy: WhaapyClient | null | undefined,
  input: ContactSyncInput,
): Promise<void> {
  if (!whaapy) return Promise.resolve();
  return runInBackground(syncWhaapyContact(supabase, whaapy, input));
}
