// WHAAPY template catalog helpers for the admin messaging center (B7b, D8).
// Pure functions: normalize WHAAPY's template objects and check that a
// message_route_steps row really fits its template before it can be saved or
// before an event is switched to FindMed — a mismatch would otherwise only
// show up as a failed send to a patient.

export interface CatalogButton {
  type: string; // URL | QUICK_REPLY | PHONE_NUMBER | ...
  text: string;
  url?: string;
  button_id?: string;
}

export interface CatalogTemplate {
  name: string;
  category: string;
  language: string;
  status: string;
  body: string;
  body_variables: number;
  buttons: CatalogButton[];
}

/** Body variables are {{1}}, {{2}}, …; counts distinct indexes. */
export function countVariables(text: string): number {
  return new Set([...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])).size;
}

export function normalizeTemplate(raw: Record<string, unknown>): CatalogTemplate {
  const comps = (raw.components as Record<string, unknown>[] | undefined) ?? [];
  const body = String((comps.find((c) => String(c.type).toUpperCase() === "BODY")?.text as string | undefined) ?? raw.content ?? "");
  const buttonsComp = comps.find((c) => String(c.type).toUpperCase() === "BUTTONS");
  const buttons = ((buttonsComp?.buttons as Record<string, unknown>[] | undefined) ?? []).map((b) => ({
    type: String(b.type ?? "").toUpperCase(),
    text: String(b.text ?? ""),
    ...(typeof b.url === "string" ? { url: b.url } : {}),
    ...(typeof b.buttonId === "string" ? { button_id: b.buttonId } : {}),
  }));
  return {
    name: String(raw.name ?? ""),
    category: String(raw.category ?? ""),
    language: String(raw.language ?? ""),
    status: String(raw.status ?? ""),
    body,
    body_variables: countVariables(body),
    buttons,
  };
}

/** Values the worker knows how to fill (messaging.ts buildTemplateRequest). */
export const PARAM_KEYS = [
  "patient_name",
  "start_local",
  "previous_start_local",
  "doctor_name",
  "office_address",
  "min_confirm_hours",
] as const;

export interface StepShape {
  template_name: string;
  language: string;
  body_params: string[];
  url_button_param: string | null;
  quick_reply_action: string | null;
}

/** Problems (in Spanish, for the admin UI) of using `step` with `template`. */
export function validateStep(step: StepShape, template: CatalogTemplate | undefined): string[] {
  if (!template) return [`La plantilla "${step.template_name}" no existe en WHAAPY.`];
  const problems: string[] = [];
  if (template.status.toUpperCase() !== "APPROVED") problems.push(`La plantilla "${template.name}" no está aprobada (${template.status}).`);
  if (template.language !== step.language) problems.push(`Idioma ${step.language} distinto al de la plantilla (${template.language}).`);
  if (step.body_params.length !== template.body_variables) {
    problems.push(`La plantilla tiene ${template.body_variables} variable(s) y el mapeo tiene ${step.body_params.length}.`);
  }
  const unknown = step.body_params.filter((k) => !(PARAM_KEYS as readonly string[]).includes(k));
  if (unknown.length) problems.push(`Variables desconocidas: ${unknown.join(", ")}.`);
  const urlButton = template.buttons.find((b) => b.type === "URL" && /\{\{\s*1\s*\}\}/.test(b.url ?? ""));
  if (step.url_button_param && !urlButton) problems.push("La plantilla no tiene un botón de enlace con parte variable.");
  if (!step.url_button_param && urlButton) problems.push("La plantilla tiene un botón de enlace variable: elige qué enlace lleva.");
  const quick = template.buttons.some((b) => b.type === "QUICK_REPLY");
  if (step.quick_reply_action && !quick) problems.push("La plantilla no tiene botón de respuesta rápida.");
  return problems;
}
