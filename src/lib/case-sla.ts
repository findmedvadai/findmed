// Tiempo de respuesta (SLA) de los casos que nadie ha tomado. Misma regla que
// el backend (supabase/functions/_shared/staff-alerts.ts): el SLA depende de la
// prioridad y se cuenta desde que se abrió el caso; los tiempos se configuran
// en Configuración → Alertas (tabla staff_alert_settings).
import type { Tone } from "@/components/app/StatCard";

export interface SlaSettings {
  sla_urgent_minutes: number;
  sla_high_minutes: number;
  sla_normal_minutes: number;
  max_escalations: number;
}

export const DEFAULT_SLA: SlaSettings = {
  sla_urgent_minutes: 10,
  sla_high_minutes: 30,
  sla_normal_minutes: 120,
  max_escalations: 3,
};

/** Estados en los que nadie del equipo ha tomado el caso. */
export const WAITING_STATUSES = ["open", "awaiting_assignment"];

export type SlaState = "on_time" | "due_soon" | "overdue";

export const SLA_STATE: Record<SlaState, { label: string; tone: Tone }> = {
  on_time: { label: "A tiempo", tone: "success" },
  due_soon: { label: "Por vencer", tone: "warning" },
  overdue: { label: "Vencido", tone: "danger" },
};

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2 };
const STATE_RANK: Record<SlaState, number> = { overdue: 0, due_soon: 1, on_time: 2 };

export function slaMinutesFor(priority: string, s: SlaSettings): number {
  return priority === "urgent" ? s.sla_urgent_minutes : priority === "high" ? s.sla_high_minutes : s.sla_normal_minutes;
}

export function waitingMinutes(createdAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
}

/** "8 min", "2 h 5 min", "1 d 3 h". */
export function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return minutes % 60 ? `${h} h ${minutes % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

export interface CaseSla {
  state: SlaState;
  /** Minutos esperando desde que se abrió. */
  minutes: number;
  slaMinutes: number;
  /** Minutos que faltan para vencer (negativo = vencido hace tanto). */
  remaining: number;
}

/**
 * SLA de un caso que espera a alguien del equipo; null si ya lo tomaron o se
 * cerró. "Por vencer" = ya pasó el 75 % del tiempo.
 */
export function caseSla(c: { status: string; priority: string; created_at: string }, s: SlaSettings, now: number): CaseSla | null {
  if (!WAITING_STATUSES.includes(c.status)) return null;
  const minutes = waitingMinutes(c.created_at, now);
  const sla = slaMinutesFor(c.priority, s);
  const state: SlaState = minutes >= sla ? "overdue" : minutes >= sla * 0.75 ? "due_soon" : "on_time";
  return { state, minutes, slaMinutes: sla, remaining: sla - minutes };
}

/** Cola "sin asignar": primero los vencidos más urgentes, luego por vencer, luego a tiempo; dentro, prioridad y antigüedad. */
export function sortBySla<T extends { status: string; priority: string; created_at: string }>(rows: T[], s: SlaSettings, now: number): T[] {
  const rank = (c: T) => STATE_RANK[caseSla(c, s, now)?.state ?? "on_time"];
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
      Date.parse(a.created_at) - Date.parse(b.created_at),
  );
}
