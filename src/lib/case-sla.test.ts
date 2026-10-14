import { describe, expect, it } from "vitest";
import { caseSla, DEFAULT_SLA, formatWait, slaMinutesFor, sortBySla } from "./case-sla";

const T0 = Date.parse("2026-10-14T15:00:00Z");
const MIN = 60_000;
const at = (minutesAgo: number) => new Date(T0 - minutesAgo * MIN).toISOString();

describe("case SLA", () => {
  it("uses the minutes of each priority", () => {
    expect([slaMinutesFor("urgent", DEFAULT_SLA), slaMinutesFor("high", DEFAULT_SLA), slaMinutesFor("normal", DEFAULT_SLA)]).toEqual([10, 30, 120]);
  });

  it("is on time, due soon (75 %) or overdue; null once someone took the case", () => {
    const c = (minutesAgo: number, priority = "urgent", status = "awaiting_assignment") => ({ status, priority, created_at: at(minutesAgo) });
    expect(caseSla(c(5), DEFAULT_SLA, T0)?.state).toBe("on_time");
    expect(caseSla(c(8), DEFAULT_SLA, T0)?.state).toBe("due_soon");
    expect(caseSla(c(10), DEFAULT_SLA, T0)).toEqual({ state: "overdue", minutes: 10, slaMinutes: 10, remaining: 0 });
    expect(caseSla(c(1200), DEFAULT_SLA, T0)?.minutes).toBe(1200);
    expect(caseSla(c(60, "normal", "open"), DEFAULT_SLA, T0)?.state).toBe("on_time");
    expect(caseSla(c(60, "urgent", "assigned"), DEFAULT_SLA, T0)).toBeNull();
    expect(caseSla(c(9), { ...DEFAULT_SLA, sla_urgent_minutes: 5 }, T0)?.state).toBe("overdue");
  });

  it("puts the most urgent overdue cases first", () => {
    const rows = [
      { id: "normal-new", status: "open", priority: "normal", created_at: at(5) },
      { id: "high-overdue", status: "awaiting_assignment", priority: "high", created_at: at(45) },
      { id: "urgent-ontime", status: "awaiting_assignment", priority: "urgent", created_at: at(2) },
      { id: "normal-overdue-old", status: "open", priority: "normal", created_at: at(500) },
      { id: "urgent-overdue", status: "awaiting_assignment", priority: "urgent", created_at: at(20) },
      { id: "high-due-soon", status: "awaiting_assignment", priority: "high", created_at: at(25) },
    ];
    expect(sortBySla(rows, DEFAULT_SLA, T0).map((r) => r.id)).toEqual([
      "urgent-overdue",
      "high-overdue",
      "normal-overdue-old",
      "high-due-soon",
      "urgent-ontime",
      "normal-new",
    ]);
  });

  it("formats the waiting time", () => {
    expect([formatWait(0), formatWait(59), formatWait(60), formatWait(125), formatWait(1200), formatWait(1500)]).toEqual([
      "0 min",
      "59 min",
      "1 h",
      "2 h 5 min",
      "20 h",
      "1 d 1 h",
    ]);
  });
});
