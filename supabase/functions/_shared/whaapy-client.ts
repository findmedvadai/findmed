// Minimal WHAAPY REST client for what FindMed owns: handoff (AI pause/resume,
// agent assignment, tag projection) and transactional messaging. Docs:
//   GET   /conversations/v1/by-phone/:phone   → conversation + contact
//   PATCH /conversations/v1/:id/ai            { aiEnabled }  (until changed again)
//   GET   /team/v1                            → agents (id, email, is_available)
//   PATCH /contacts/v1/:id                    { assigned_agent_id | null, add_tags, name, notes,
//                                               custom_fields (se fusionan con los existentes) }
//   POST  /messages/v1                        template or text message
//   GET   /templates/v1, POST /templates/v1/sync
//
// Every call returns a result object (never throws), with a per-call timeout
// so a slow provider can't eat the MCP tool budget (15 s). Errors carry the
// HTTP status and a short provider message; the API key never appears in them.
//
// Secrets: WHAAPY_API_KEY (wha_…), WHAAPY_API_BASE_URL (default https://api.whaapy.com).

export type WhaapyResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export interface WhaapyConversation {
  id: string;
  contact_id: string | null;
  ai_enabled: boolean | null;
  /** Contact snapshot from the same response (by-phone embeds it). Optional for fakes. */
  contact?: WhaapyContactSnapshot | null;
}

export interface WhaapyContactSnapshot {
  name: string | null;
  /** WhatsApp profile name; WHAAPY copies it into `name` when it creates the contact. */
  wa_name: string | null;
  custom_fields: Record<string, unknown>;
}

/** PATCH /contacts/v1/:id body. custom_fields are MERGED by WHAAPY with the existing ones. */
export interface WhaapyContactPatch {
  assigned_agent_id?: string | null;
  add_tags?: string[];
  name?: string;
  notes?: string;
  custom_fields?: Record<string, string | number | boolean | null>;
}

export interface WhaapyAgent {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
  is_available: boolean;
}

export interface WhaapyClient {
  configured: boolean;
  conversationByPhone(phone: string): Promise<WhaapyResult<WhaapyConversation | null>>;
  setAiEnabled(conversationId: string, enabled: boolean): Promise<WhaapyResult<unknown>>;
  listAgents(): Promise<WhaapyResult<WhaapyAgent[]>>;
  updateContact(contactId: string, patch: WhaapyContactPatch): Promise<WhaapyResult<unknown>>;
  /** POST /messages/v1 with any body (template or text). Returns WHAAPY's ids. */
  sendMessage(body: Record<string, unknown>): Promise<WhaapyResult<WhaapySent>>;
  /** GET /templates/v1 (raw WHAAPY objects; messaging-admin normalizes them). */
  listTemplates(): Promise<WhaapyResult<Record<string, unknown>[]>>;
  /** POST /templates/v1/sync — pulls changes made in Meta right away. */
  syncTemplates(): Promise<WhaapyResult<unknown>>;
}

export interface WhaapySent {
  message_id: string | null;
  wamid: string | null;
}

const TIMEOUT_MS = 5000;

export function createWhaapyClient(
  opts: { apiKey?: string | null; baseUrl?: string | null; timeoutMs?: number } = {},
): WhaapyClient {
  const apiKey = opts.apiKey ?? Deno.env.get("WHAAPY_API_KEY") ?? "";
  const baseUrl = (opts.baseUrl ?? Deno.env.get("WHAAPY_API_BASE_URL") ?? "https://api.whaapy.com").replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  async function call<T>(method: string, path: string, body?: unknown): Promise<WhaapyResult<T>> {
    if (!apiKey) return { ok: false, status: 0, error: "not_configured" };
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch { /* non-JSON body */ }
      if (!res.ok) {
        const j = json as { message?: string; error?: string } | null;
        return { ok: false, status: res.status, error: String(j?.message ?? j?.error ?? text.slice(0, 160) ?? "error") };
      }
      return { ok: true, status: res.status, data: json as T };
    } catch (e) {
      const timeout = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, status: 0, error: timeout ? "timeout" : "network_error" };
    }
  }

  return {
    configured: !!apiKey,

    async conversationByPhone(phone) {
      const r = await call<{ data?: Record<string, unknown> }>(
        "GET",
        `/conversations/v1/by-phone/${encodeURIComponent(phone)}`,
      );
      if (!r.ok) return r.status === 404 ? { ok: true, status: 404, data: null } : r;
      const d = r.data?.data;
      if (!d || typeof d.id !== "string") return { ok: true, status: r.status, data: null };
      const contact = d.contact as
        | { id?: string; name?: unknown; waName?: unknown; customFields?: unknown }
        | undefined;
      const settings = d.settings as { aiEnabled?: boolean } | undefined;
      const fields = contact?.customFields;
      return {
        ok: true,
        status: r.status,
        data: {
          id: d.id,
          contact_id: contact?.id ?? null,
          ai_enabled: settings?.aiEnabled ?? null,
          contact: contact
            ? {
              name: typeof contact.name === "string" ? contact.name : null,
              wa_name: typeof contact.waName === "string" ? contact.waName : null,
              custom_fields: fields && typeof fields === "object" && !Array.isArray(fields)
                ? fields as Record<string, unknown>
                : {},
            }
            : null,
        },
      };
    },

    setAiEnabled(conversationId, enabled) {
      return call("PATCH", `/conversations/v1/${encodeURIComponent(conversationId)}/ai`, { aiEnabled: enabled });
    },

    async listAgents() {
      const r = await call<{ agents?: Record<string, unknown>[] }>("GET", "/team/v1");
      if (!r.ok) return r;
      const agents = (r.data?.agents ?? []).map((a) => ({
        id: String(a.id),
        email: typeof a.email === "string" ? a.email : null,
        name: typeof a.name === "string" ? a.name : null,
        role: typeof a.role === "string" ? a.role : null,
        is_available: a.is_available === true,
      }));
      return { ok: true, status: r.status, data: agents };
    },

    updateContact(contactId, patch) {
      return call("PATCH", `/contacts/v1/${encodeURIComponent(contactId)}`, patch);
    },

    async sendMessage(body) {
      const r = await call<{ data?: { id?: string }; messages?: { id?: string; wamid?: string }[] }>(
        "POST",
        "/messages/v1",
        body,
      );
      if (!r.ok) return r;
      const m = r.data?.messages?.[0];
      return { ok: true, status: r.status, data: { message_id: r.data?.data?.id ?? m?.id ?? null, wamid: m?.wamid ?? null } };
    },

    async listTemplates() {
      const r = await call<{ data?: Record<string, unknown>[] }>("GET", "/templates/v1");
      if (!r.ok) return r;
      return { ok: true, status: r.status, data: r.data?.data ?? [] };
    },

    syncTemplates() {
      return call("POST", "/templates/v1/sync");
    },
  };
}
