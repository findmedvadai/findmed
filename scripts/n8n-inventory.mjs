#!/usr/bin/env node
// Generates docs/findmed-migration/n8n-nodos.md from the n8n export.
//
// Usage: node scripts/n8n-inventory.mjs <path-to-export.json> [out.md]
//
// The export itself is NOT versioned (it contains prompts and business data);
// only this derived inventory is. The script never prints header values,
// credentials or full URLs — only the host of each HTTP call.

import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath = "docs/findmed-migration/n8n-nodos.md"] = process.argv;
if (!inPath) {
  console.error("Usage: node scripts/n8n-inventory.mjs <export.json> [out.md]");
  process.exit(1);
}

const wf = JSON.parse(readFileSync(inPath, "utf8"));
const nodes = wf.nodes;
const conns = wf.connections ?? {};
const shortType = (t) => t.split(".").pop();

// ---------------------------------------------------------------------------
// Graph: outgoing edges per node and reachability from real entry points.
// ai_* edges (tool/model/memory) attach dependencies to an agent; they count
// as "reachable" when the agent they serve is reachable.
// ---------------------------------------------------------------------------
const out = new Map(); // name -> [{kind, index, to}]
const aiOwners = new Map(); // dependency name -> agent names
for (const [from, byKind] of Object.entries(conns)) {
  for (const [kind, outputs] of Object.entries(byKind)) {
    outputs.forEach((targets, index) => {
      for (const t of targets ?? []) {
        if (!out.has(from)) out.set(from, []);
        out.get(from).push({ kind, index, to: t.node });
        if (kind.startsWith("ai_")) {
          if (!aiOwners.has(from)) aiOwners.set(from, []);
          aiOwners.get(from).push(t.node);
        }
      }
    });
  }
}

const entryTypes = new Set(["whaapyTrigger", "webhook"]);
const reachable = new Set();
const stack = nodes.filter((n) => entryTypes.has(shortType(n.type))).map((n) => n.name);
while (stack.length) {
  const name = stack.pop();
  if (reachable.has(name)) continue;
  reachable.add(name);
  for (const e of out.get(name) ?? []) if (e.kind === "main") stack.push(e.to);
}
for (const [dep, agents] of aiOwners) if (agents.some((a) => reachable.has(a))) reachable.add(dep);

// ---------------------------------------------------------------------------
// Destination per node. Decisions: conservar | reemplazar | consolidar |
// retirar | pendiente. Each row links to the requirement IDs it traces to.
// ---------------------------------------------------------------------------
const EV_BY_PATH = {
  "findmed-CambioEstado": "EV01",
  "findmed-cancelacionDoctor": "EV02",
  "findmed-Confirmacion": "EV03",
  "findmed-Autocancelacion": "EV04",
  "findmed-Recordatorio8am": "EV05",
  "findmed-Formulario_doc": "EV06",
  "findmed-Envio_informe": "EV07",
  "findmed-reagendado": "EV08",
};
const EV_BY_TEMPLATE = {
  reservada_estado_cita: "EV01",
  confirmada_estado_cita: "EV01",
  cancelada_paciente: "EV01",
  cita_completada: "EV01",
  canceladadoc_estado_cita: "EV02",
  dosdias_pre_confirmacion: "EV03",
  autocancelada_estado_cita: "EV04",
  cita_manana_recordatorio: "EV05",
  cita_reagendada_staff: "EV08",
};

function host(url) {
  if (!url) return "";
  const m = String(url).replace(/^=\s*/, "").trim().match(/^https?:\/\/[^/]+/);
  return m ? m[0] : "(expresión)";
}

function classify(n, isReachable) {
  const t = shortType(n.type);
  const name = n.name;
  const p = n.parameters ?? {};
  const h = host(p.url);
  const tpl = p.templateName;

  if (t === "stickyNote") return ["retirar", "Nota visual del lienzo; se conserva solo como referencia en este inventario.", "—"];
  if (!isReachable)
    return ["retirar", "Respaldo desconectado del recorrido principal; histórico, no se reproduce.", "§7.4"];
  if (t === "agent") return ["reemplazar", "Agente nativo WHAAPY (colme-2) + tools MCP de FindMed; prompt versionado sin METADATA.", "B8, F05, F06"];
  if (t === "postgresTool") return ["reemplazar", "Tool MCP parametrizada `suggest_specialty` sobre catálogo migrado; sin SQL libre.", "M02, F09, F10"];
  if (t === "lmChatOpenRouter") return ["reemplazar", "Modelo configurado en WHAAPY. El export nombra 'Gemini 2.5 flash' pero usa otro modelo (N22).", "B8, N22"];
  if (t === "memoryPostgresChat") return ["reemplazar", "Memoria conversacional nativa de WHAAPY; no migrar historiales de pacientes.", "B8"];
  if (t === "httpRequestTool")
    return [
      "consolidar",
      "Campo de contacto nativo WHAAPY (herramienta nativa de campos) con nombre canónico; sin tool MCP por campo.",
      name === "findmed_urgencia" ? "F07, B8" : "B8, §7.3",
    ];
  if (t === "code" || name === "IF Flujo Terminado" || name === "If hay mensaje")
    return ["retirar", "Parser de <<<METADATA>>> y bifurcación invertida; los resultados de tools son estructurados.", "F06, R12"];
  if (t === "whaapyTrigger") return ["reemplazar", "El agente nativo pasa a ser el único dueño de la conversación al corte.", "B10, R38"];
  if (t === "webhook") {
    const ev = EV_BY_PATH[p.path] ?? "EV?";
    const empty = !(out.get(name) ?? []).some((e) => e.kind === "main");
    return [
      empty ? "pendiente" : "reemplazar",
      empty
        ? `${ev}: el export no tiene consumidor (main vacío). Definir recorrido antes de migrar.`
        : `${ev}: outbox \`domain_outbox\` + worker que envía template por API WHAAPY con dueño único.`,
      empty ? `${ev}, F18` : `${ev}, B7, F19`,
    ];
  }
  if (t === "wait") return ["retirar", "Espera artificial; seguimiento durable solo con regla aprobada.", "B7"];
  if (t === "httpRequest" && h.includes("supabase.co")) {
    if (name === "Búsqueda Tabla Doctores") return ["reemplazar", "MCP `search_care_options` (none/one/many, office_id, alias de ciudad) contra el proyecto vigente.", "M01, F01, F02, F04"];
    if (name === "Triage_Webhook") return ["reemplazar", "MCP `create_booking_link` con doctor_id + office_id elegidos; el enlace no es una cita.", "M04, F02, F03, F08"];
    if (name === "Cancelar Cita" || name === "Confirmar Cita")
      return ["reemplazar", "Botón con payload {acción, appointment_id} → `whaapy-inbound` / MCP prepare+commit; nunca 'primera cita del teléfono'.", "M05, M06, M07, F02, F14, N24"];
    return ["pendiente", "Llamada a Supabase no clasificada.", "—"];
  }
  if (t === "httpRequest" && h.includes("whaapy")) {
    if (/apoyo_asesor|urgencia/.test(name)) return ["reemplazar", "MCP `open_case` + `request_handoff` (caso, asignación y pausa verificables); etiqueta solo como proyección.", "M09, M10, F05"];
    if (/ambulancia/.test(name)) return ["pendiente", "Solicitud de ambulancia: abrir caso con responsable. Alcance del servicio de ambulancias por confirmar con FindMed.", "M09, §12"];
    if (/reservada/.test(name)) return ["reemplazar", "Etapa/etiqueta derivada de cita persistida (evento appointment.created), no del enlace enviado.", "F08, R13"];
    return ["consolidar", "Acción nativa WHAAPY de etiqueta/embudo, proyectada desde estado de dominio con un solo dueño.", "§7.3"];
  }
  if (t === "switch") {
    if (name === "Switch1") return ["reemplazar", "Decisión none/one/many dentro de `search_care_options` + selección explícita del paciente.", "F01, R03"];
    if (name === "Switch Estado") return ["consolidar", "Mapeo evento→template en el worker de eventos.", "EV01, B7"];
    if (name === "Switch Valor Botón") return ["consolidar", "Payloads de botón (confirmar/cancelar/menú) manejados por `whaapy-inbound` y automatizaciones WHAAPY.", "N24, B7"];
    return ["consolidar", "Ruteo absorbido por agente nativo / estados de dominio.", "B8"];
  }
  if (t === "set") {
    if (name === "Set Link Agendamiento") return ["reemplazar", "Propagar la opción elegida (doctor_id+office_id); no `doctors[0]`.", "F03, R04"];
    return ["consolidar", "Adaptación de contexto; la identidad viene de `{{contact.phoneNumber}}` mapeado, no de texto libre.", "N21, B5"];
  }
  if (t === "whaapy") {
    if (tpl) {
      const ev = EV_BY_TEMPLATE[tpl];
      if (tpl === "pedir_documentos") return ["pendiente", `Template \`${tpl}\`: definir qué documentos, dónde se guardan y quién accede.`, "§7.2"];
      if (/^boton_/.test(tpl)) return ["reemplazar", `Template \`${tpl}\`: botón con payload ligado a appointment_id (allowButtonIdOverride).`, "N24, F14, B7"];
      return ["reemplazar", `Template \`${tpl}\` enviado por el worker con dueño único${ev ? ` (${ev})` : ""}.`, `${ev ?? "EV?"}, B7`];
    }
    const op = p.operation ?? (p.resource === "contact" ? "get" : "send");
    if (p.resource === "contact" && op === "get") return ["consolidar", "Lectura de contacto: contexto fijo de WHAAPY / API por teléfono en el worker.", "N21, B7"];
    if (p.resource === "contact" && op === "update") return ["reemplazar", "Etapa de embudo proyectada desde estado persistido (cita/caso), no optimista.", "F08, §7.3"];
    if (/Ambulancia|Emergencia|Evento|Traslado|Info General/.test(name))
      return ["pendiente", "Mensaje estático del servicio de ambulancias: conservar como automatización/knowledge WHAAPY si FindMed lo confirma.", "§12, R08"];
    if (/Mensaje Inicial|Volver al Inicio/.test(name))
      return ["pendiente", "Menú de bienvenida (Ambulancia / Cita Médica): decidir si lo da el agente o una automatización con 'Omitir IA'.", "B8"];
    if (/No Match|Match Parcial|Match Doctor/.test(name)) return ["reemplazar", "Respuesta del agente según resultado none/one/many de `search_care_options`.", "F01, M01, M04"];
    return ["retirar", "Envío de texto del agente n8n; el agente nativo responde directamente.", "B8"];
  }
  return ["pendiente", "Tipo no clasificado.", "—"];
}

const rows = nodes.map((n, i) => {
  const isReachable = reachable.has(n.name);
  const [decision, destino, req] = classify(n, isReachable);
  const edges = (out.get(n.name) ?? [])
    .map((e) => (e.kind === "main" ? `main[${e.index}]→${e.to}` : `${e.kind}→${e.to}`))
    .join("; ");
  const p = n.parameters ?? {};
  const extra = [
    host(p.url) ? `host ${host(p.url)}` : "",
    p.path ? `path /${p.path}` : "",
    p.templateName ? `template ${p.templateName}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return {
    id: `N${String(i + 1).padStart(3, "0")}`,
    name: n.name,
    type: shortType(n.type),
    route: shortType(n.type) === "stickyNote" ? "nota" : isReachable ? "principal" : "desconectado",
    edges: edges || "—",
    extra: extra || "—",
    decision,
    destino,
    req,
  };
});

const count = (k, v) => rows.filter((r) => r[k] === v).length;
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const typeCounts = rows.reduce((a, r) => ((a[r.type] = (a[r.type] ?? 0) + 1), a), {});

let md = `# Inventario de nodos n8n (export de referencia)\n\n`;
md += `> Generado por \`scripts/n8n-inventory.mjs\` desde \`FINDMED-N8N-Referencia-Sin-Secretos.json\` (no versionado).\n`;
md += `> Solo se muestran hosts; ninguna credencial, header ni URL completa. Regenerar si cambia el export.\n\n`;
md += `**Totales:** ${rows.length} nodos · ruta principal ${count("route", "principal")} · desconectados ${count("route", "desconectado")} · notas ${count("route", "nota")}.\n\n`;
md += `**Por tipo:** ${Object.entries(typeCounts).map(([k, v]) => `${k} ${v}`).join(" · ")}.\n\n`;
md += `**Por decisión:** ${["conservar", "reemplazar", "consolidar", "retirar", "pendiente"].map((d) => `${d} ${count("decision", d)}`).join(" · ")}.\n\n`;
md += `Estado de ejecución de cada fila: ver la columna de requisito en \`cobertura.md\`. Una fila "reemplazar" solo se cierra cuando su requisito queda **validado**.\n\n`;
md += `| ID | Nodo | Tipo | Ruta | Conexiones salientes | Datos | Decisión | Destino | Requisitos |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) {
  md += `| ${r.id} | ${esc(r.name)} | ${r.type} | ${r.route} | ${esc(r.edges)} | ${esc(r.extra)} | ${r.decision} | ${esc(r.destino)} | ${r.req} |\n`;
}
writeFileSync(outPath, md);
console.log(`${rows.length} nodos → ${outPath}`);
console.log(`principal ${count("route", "principal")}, desconectados ${count("route", "desconectado")}, notas ${count("route", "nota")}`);
console.log(["conservar", "reemplazar", "consolidar", "retirar", "pendiente"].map((d) => `${d}=${count("decision", d)}`).join(" "));
