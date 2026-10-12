// MCP server for WHAAPY (block B5). Transport: Streamable HTTP, stateless,
// JSON responses (WHAAPY sends `Accept: application/json, text/event-stream`).
// Protocol: JSON-RPC 2.0, MCP 2025-06-18 — initialize, notifications/*,
// ping, tools/list, tools/call. See docs/findmed-migration/decisiones.md A1.
//
// Kept free of Deno.serve and env access so it can be tested in-process.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/service-auth.ts";
import { validate } from "./schema.ts";
import type { ToolDef } from "./tools.ts";

export const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = new Set(["2025-06-18", "2025-03-26"]);
const SERVER_INFO = { name: "findmed-mcp", version: "1.0.0" };
// WHAAPY cuts tools/call at 30 s; answer before that with a clear status.
const TOOL_TIMEOUT_MS = 25_000;

export interface ServerDeps {
  /** Shared secret configured in WHAAPY as the bearer token. Empty = fail closed. */
  token: string;
  supabase: SupabaseClient;
  tools: ToolDef[];
  log?: (entry: Record<string, unknown>) => void;
}

type JsonRpcId = string | number | null;

const json = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });

interface Reply {
  result(id: JsonRpcId, result: unknown): Response;
  error(id: JsonRpcId, code: number, message: string, data?: unknown, status?: number): Response;
}

/**
 * JSON-RPC responder. Always JSON (WHAAPY documents JSON replies), even though
 * WHAAPY also accepts text/event-stream. An apparent gateway problem with that
 * Accept header turned out to be TLS interception by local antivirus (N28).
 */
function makeReply(): Reply {
  const send = (body: unknown, status = 200) => json(status, body);
  return {
    result: (id, result) => send({ jsonrpc: "2.0", id, result }),
    error: (id, code, message, data, status = 200) =>
      send({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } }, status),
  };
}

export async function handleMcpRequest(req: Request, deps: ServerDeps): Promise<Response> {
  // --- Auth (before anything else, including protocol details) ---
  const auth = req.headers.get("Authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!deps.token || !presented || !timingSafeEqual(presented, deps.token)) {
    return json(401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
  }

  // --- Transport ---
  if (req.method === "DELETE") return new Response(null, { status: 204 }); // stateless: nothing to close
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST, DELETE" });

  const version = req.headers.get("MCP-Protocol-Version");
  if (version && !SUPPORTED_VERSIONS.has(version)) {
    return json(400, { error: "unsupported_protocol_version", supported: [...SUPPORTED_VERSIONS] });
  }
  const reply = makeReply();

  let msg: unknown;
  try {
    msg = await req.json();
  } catch {
    return reply.error(null, -32700, "Parse error", undefined, 400);
  }
  if (Array.isArray(msg)) return reply.error(null, -32600, "Batching is not supported", undefined, 400);
  if (typeof msg !== "object" || msg === null || (msg as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
    return reply.error(null, -32600, "Invalid Request", undefined, 400);
  }
  const m = msg as { id?: JsonRpcId; method?: unknown; params?: unknown };

  // Notifications and client responses carry no id to answer → 202, no body.
  if (m.id === undefined) return new Response(null, { status: 202 });
  const id = m.id;
  if (typeof m.method !== "string") return reply.error(id, -32600, "Invalid Request");

  switch (m.method) {
    case "initialize": {
      const requested = (m.params as { protocolVersion?: string } | undefined)?.protocolVersion;
      return reply.result(id, {
        protocolVersion: requested && SUPPORTED_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Herramientas de FindMed para orientar, buscar médico/consultorio, consultar horarios, generar el enlace de reserva y consultar citas. Mapea siempre el campo phone a {{contact.phoneNumber}}.",
      });
    }
    case "ping":
      return reply.result(id, {});
    case "tools/list":
      return reply.result(id, {
        tools: deps.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case "tools/call":
      return await callTool(id, m.params, deps, reply);
    default:
      return reply.error(id, -32601, "Method not found", { method: m.method });
  }
}

async function callTool(id: JsonRpcId, params: unknown, deps: ServerDeps, reply: Reply): Promise<Response> {
  const p = params as { name?: unknown; arguments?: unknown } | undefined;
  const tool = deps.tools.find((t) => t.name === p?.name);
  if (!tool) return reply.error(id, -32602, "Unknown tool", { name: p?.name ?? null });

  const args = (p?.arguments ?? {}) as Record<string, unknown>;
  const invalid = validate(tool.inputSchema, args);
  if (invalid) return reply.error(id, -32602, "Invalid arguments", invalid);

  const traceId = crypto.randomUUID();
  const started = performance.now();
  let outcome;
  try {
    outcome = await Promise.race([
      tool.handler(deps.supabase, args),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TOOL_TIMEOUT_MS)),
    ]);
  } catch (err) {
    const timedOut = err instanceof Error && err.message === "timeout";
    console.error(`[findmed-mcp] ${tool.name} ${timedOut ? "timed out" : "threw"} (trace ${traceId}):`, err);
    outcome = {
      ok: false,
      status: "failed" as const,
      errors: [{
        code: timedOut ? "timeout" : "internal_error",
        message_es: timedOut
          ? "La operación tardó demasiado. Puede haberse completado; consulta antes de reintentar."
          : "Ocurrió un error interno. Ofrece canalizar con un asesor.",
        // A timed-out mutation may have happened: never blind-retry it.
        retryable: timedOut && tool.safety !== "mutation_limited",
      }],
    };
  }
  const durationMs = Math.round(performance.now() - started);

  // Operational log without patient data (no args, no results).
  (deps.log ?? ((e) => console.log(JSON.stringify(e))))({
    event: "mcp_tool_call",
    tool: tool.name,
    status: outcome.status,
    ok: outcome.ok,
    durationMs,
    trace_id: traceId,
  });

  const envelope = { ...outcome, toolName: tool.name, safety: tool.safety, durationMs, trace_id: traceId };
  return reply.result(id, { content: [{ type: "text", text: JSON.stringify(envelope) }], isError: !outcome.ok });
}
