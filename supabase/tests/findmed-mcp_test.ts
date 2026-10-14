// R29 / R30: MCP protocol + auth, and the read/link tools on an in-memory DB.
//
//   npm run test:edge

import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleMcpRequest, PROTOCOL_VERSION } from "../functions/findmed-mcp/server.ts";
import { buildTools, TOOLS, type ToolDef } from "../functions/findmed-mcp/tools.ts";
import { FakeDb } from "./fake-supabase.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_test" }));
Deno.env.set("APP_URL", "https://app.example.test");

const TOKEN = "test-mcp-token-0123456789";
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function call(deps: Parameters<typeof handleMcpRequest>[1], body: unknown, opts: { token?: string | null; method?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(opts.headers ?? {}),
  };
  if (opts.token !== null) headers.Authorization = `Bearer ${opts.token ?? TOKEN}`;
  return handleMcpRequest(
    new Request("https://x/functions/v1/findmed-mcp", {
      method: opts.method ?? "POST",
      headers,
      body: opts.method && opts.method !== "POST" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    deps,
  );
}

/** Reads a JSON-RPC message from a JSON or single-event SSE response. */
async function rpc(res: Response) {
  const text = await res.text();
  if ((res.headers.get("Content-Type") ?? "").includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(line!.slice(6));
  }
  return JSON.parse(text);
}

const echoTool: ToolDef = {
  name: "echo",
  description: "test",
  safety: "read_only",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string", minLength: 1 }, tags: { type: "array", items: { type: "string" } } },
  },
  handler: (_sb, args) => Promise.resolve({ ok: true, status: "success", data: { text: args.text } }),
};
const deps = (db = new FakeDb(), tools: ToolDef[] = [echoTool]) => ({
  token: TOKEN,
  supabase: db as unknown as SupabaseClient,
  tools,
  log: () => {},
});
const toolPayload = async (res: Response) => {
  const body = await rpc(res);
  return { body, envelope: JSON.parse(body.result.content[0].text) };
};

// --- R30: auth ---------------------------------------------------------------

Deno.test("R30: missing, wrong or unconfigured token → 401 with no side effects", async () => {
  assertEquals((await call(deps(), { jsonrpc: "2.0", id: 1, method: "ping" }, { token: null })).status, 401);
  assertEquals((await call(deps(), { jsonrpc: "2.0", id: 1, method: "ping" }, { token: "nope" })).status, 401);
  const failClosed = { ...deps(), token: "" };
  assertEquals((await call(failClosed, { jsonrpc: "2.0", id: 1, method: "ping" }, { token: "" })).status, 401);
});

// --- R29: protocol -------------------------------------------------------------

Deno.test("R29: initialize negotiates 2025-06-18 and declares tools", async () => {
  const res = await call(deps(), {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "whaapy-mcp-client", version: "1.0.0" } },
  });
  const body = await rpc(res);
  assertEquals(res.status, 200);
  assertEquals(body.result.protocolVersion, PROTOCOL_VERSION);
  assert(body.result.capabilities.tools);
  assertEquals(body.result.serverInfo.name, "findmed-mcp");
});

Deno.test("R29: notifications → 202 empty; DELETE → 204; GET → 405", async () => {
  const n = await call(deps(), { jsonrpc: "2.0", method: "notifications/initialized" });
  assertEquals(n.status, 202);
  assertEquals(await n.text(), "");
  assertEquals((await call(deps(), null, { method: "DELETE" })).status, 204);
  assertEquals((await call(deps(), null, { method: "GET" })).status, 405);
});

Deno.test("R29: parse error, batch, bad version, unknown method", async () => {
  let r = await call(deps(), "{not json");
  assertEquals((await rpc(r)).error.code, -32700);
  r = await call(deps(), [{ jsonrpc: "2.0", id: 1, method: "ping" }]);
  assertEquals((await rpc(r)).error.code, -32600);
  r = await call(deps(), { jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { "MCP-Protocol-Version": "1999-01-01" } });
  assertEquals(r.status, 400);
  r = await call(deps(), { jsonrpc: "2.0", id: 7, method: "resources/list" });
  const b = await rpc(r);
  assertEquals([b.id, b.error.code], [7, -32601]);
});

Deno.test("R29: tools/list exposes object-rooted schemas for every real tool", async () => {
  const r = await call(deps(new FakeDb(), TOOLS), { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (await rpc(r)).result.tools;
  assertEquals(tools.map((t: { name: string }) => t.name), [
    "suggest_specialty",
    "search_care_options",
    "list_available_slots",
    "create_booking_link",
    "save_patient_insurance",
    "list_my_appointments",
    "prepare_appointment_action",
    "get_operation_status",
    "find_network_hospitals",
    "find_network_laboratories",
    "open_case",
    "request_handoff",
    "get_my_case_status",
  ]);
  for (const t of tools) {
    assertEquals(t.inputSchema.type, "object");
    assertEquals(t.inputSchema.additionalProperties, false);
    assert(t.description.includes("When to use"));
  }
});

Deno.test("R29: tools/call validates arguments (required, types, additionalProperties)", async () => {
  const bad = async (args: unknown) => (await (await rpc(await call(deps(), { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: args } })))).error;
  assertEquals((await bad({})).data, { field: "text", reason: "required" });
  assertEquals((await bad({ text: "x", extra: 1 })).data.reason, "unexpected property");
  assertEquals((await bad({ text: "x", tags: "a,b" })).data, { field: "tags", reason: "expected array" });
  const unknown = await (await rpc(await call(deps(), { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } })));
  assertEquals(unknown.error.code, -32602);
});

Deno.test("R29: tool result is one text block with the JSON envelope", async () => {
  const res = await call(deps(), { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "echo", arguments: { text: "hola" } } });
  const { body, envelope } = await toolPayload(res);
  assertEquals(body.result.isError, false);
  assertEquals(envelope.ok, true);
  assertEquals(envelope.status, "success");
  assertEquals(envelope.data, { text: "hola" });
  assertEquals(envelope.toolName, "echo");
  assert(typeof envelope.trace_id === "string" && typeof envelope.durationMs === "number");
});

// --- Tools on an in-memory DB ---------------------------------------------------

function clinicDb() {
  const now = Date.now();
  return new FakeDb({
    doctors: [{ id: "dddddddd-0000-0000-0000-000000000001", full_name: "Dra. Prueba", is_active: true, is_deleted: false }],
    doctor_offices: [
      { id: "11111111-1111-1111-1111-111111111111", doctor_id: "dddddddd-0000-0000-0000-000000000001", name: "Consultorio Polanco", address: "Calle 1", is_active: true, is_deleted: false },
      { id: "22222222-2222-2222-2222-222222222222", doctor_id: "dddddddd-0000-0000-0000-000000000002", name: "Otro doctor", address: "Calle 2", is_active: true, is_deleted: false },
    ],
    patients: [{ id: "p1", full_name: "Paciente", phone: "+525512345678", created_at: iso(now - 1000) }],
    appointments: [
      { id: "a1", patient_id: "p1", status: "confirmed", start_at: iso(now + 50 * H), end_at: iso(now + 50.5 * H), doctor_id: "dddddddd-0000-0000-0000-000000000001", office_id: "11111111-1111-1111-1111-111111111111" },
    ],
    reservation_sessions: [],
  });
}
const callTool = (db: FakeDb, name: string, args: Record<string, unknown>) =>
  call(deps(db, TOOLS), { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }).then(toolPayload);

Deno.test("list_my_appointments returns only the caller's upcoming appointments", async () => {
  const { envelope } = await callTool(clinicDb(), "list_my_appointments", { phone: "+52 55 1234 5678" });
  assertEquals(envelope.ok, true);
  assertEquals(envelope.data.appointments.length, 1);
  assertEquals(envelope.data.appointments[0].appointment_id, "a1");
  assertEquals(envelope.data.appointments[0].office_name, "Consultorio Polanco");
  assert(String(envelope.data.appointments[0].manage_url).startsWith("https://app.example.test/gestionar?token="));
  const other = await callTool(clinicDb(), "list_my_appointments", { phone: "5599999999" });
  assertEquals(other.envelope.data.appointments, []);
});

Deno.test("X12: create_booking_link creates a session, never an appointment", async () => {
  const db = clinicDb();
  const { envelope } = await callTool(db, "create_booking_link", {
    phone: "5512345678",
    patient_name: "Paciente Prueba",
    doctor_id: "dddddddd-0000-0000-0000-000000000001",
    office_id: "11111111-1111-1111-1111-111111111111",
  });
  assertEquals(envelope.ok, true);
  assertEquals(envelope.data.link_created, true);
  assertEquals(envelope.data.appointment_created, false);
  assert(String(envelope.data.reserve_url).startsWith("https://app.example.test/reserva?token="));
  assertEquals(db.rows("reservation_sessions").length, 1);
  assertEquals(db.rows("appointments").length, 1); // unchanged
});

Deno.test("R17: create_booking_link rejects an office of another doctor", async () => {
  const db = clinicDb();
  const { body, envelope } = await callTool(db, "create_booking_link", {
    phone: "5512345678",
    patient_name: "Paciente Prueba",
    doctor_id: "dddddddd-0000-0000-0000-000000000001",
    office_id: "22222222-2222-2222-2222-222222222222",
  });
  assertEquals(body.result.isError, true);
  assertEquals(envelope.errors[0].code, "office_not_found");
  assertEquals(db.rows("reservation_sessions").length, 0);
});

Deno.test("A4: commit_appointment_action is only published behind the feature flag", () => {
  assertEquals(TOOLS.some((t) => t.name === "commit_appointment_action"), false);
  assertEquals(buildTools({ chatActions: true }).some((t) => t.name === "commit_appointment_action"), true);
});

Deno.test("N28: replies are JSON even when the client also accepts text/event-stream (WHAAPY)", async () => {
  const msg = { jsonrpc: "2.0", id: 1, method: "ping" };
  const res = await call(deps(), msg); // default Accept: application/json, text/event-stream
  assertEquals(res.headers.get("Content-Type"), "application/json");
  assertEquals((await res.json()).result, {});
});

Deno.test("AI dashboard: every request is recorded (auth failures, connection tests, tool calls)", async () => {
  const { toRow } = await import("../functions/findmed-mcp/recorder.ts");
  const rows: Record<string, unknown>[] = [];
  const d = { ...deps(clinicDb(), TOOLS), record: (e: Parameters<typeof toRow>[0]) => void rows.push(toRow(e)) };

  await call(d, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { token: "wrong" });
  await call(d, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await call(d, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  await call(d, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_my_appointments", arguments: { phone: "+52 1 55 1234 5678" } } });
  await call(d, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_my_appointments", arguments: {} } });

  assertEquals(rows.map((r) => [r.kind, r.ok, r.error_code]), [
    ["auth_failed", false, "wrong_token"],
    ["initialize", true, null],
    ["tools/list", true, null],
    ["tools/call", true, null],
    ["tools/call", false, "invalid_arguments"],
  ]);
  assertEquals(rows[3].subject_phone, "+525512345678"); // canonical, for the per-patient timeline
  assertEquals(rows[3].tool_name, "list_my_appointments");
  assert((rows[3].result as { toolName: string }).toolName === "list_my_appointments");

  // A failing recorder never breaks the agent's answer.
  const broken = { ...deps(clinicDb(), TOOLS), record: () => Promise.reject(new Error("db down")) };
  const r = await call(broken, { jsonrpc: "2.0", id: 5, method: "tools/list" });
  assertEquals(r.status, 200);
});
