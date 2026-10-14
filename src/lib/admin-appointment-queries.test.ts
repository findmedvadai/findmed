import { describe, it, expect } from "vitest";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { invalidateAdminAppointmentViews } from "./admin-appointment-queries";

function seed(client: QueryClient, keys: QueryKey[]) {
  for (const key of keys) client.setQueryData(key, []);
}

const invalidated = (client: QueryClient, key: QueryKey) => client.getQueryState(key)?.isInvalidated;

describe("invalidateAdminAppointmentViews", () => {
  it("marca como viejas la lista y el calendario de la Agenda (todas las semanas)", async () => {
    const client = new QueryClient();
    const listKey = ["admin-reservas-appointments"];
    const weekKeys = [
      ["admin-calendar-appointments", "2026-10-11"],
      ["admin-calendar-appointments", "2026-10-18"],
    ];
    const externalKeys = [
      ["admin-calendar-google-events", "doc-1", "2026-10-11"],
      ["admin-calendar-outlook-events", "doc-1", "2026-10-11"],
    ];
    const detailKey = ["admin-appointment-detail", "appt-1"];
    const homeKey = ["admin-home-overview"];
    seed(client, [listKey, ...weekKeys, ...externalKeys, detailKey, homeKey]);

    await invalidateAdminAppointmentViews(client);

    for (const key of [listKey, ...weekKeys, ...externalKeys, detailKey, homeKey]) {
      expect(invalidated(client, key), JSON.stringify(key)).toBe(true);
    }
  });

  it("no toca consultas que no muestran citas", async () => {
    const client = new QueryClient();
    const unrelated: QueryKey[] = [["admin-cities"], ["all-doctors-for-filter"], ["admin-notifications", "all", "all"]];
    seed(client, unrelated);

    await invalidateAdminAppointmentViews(client);

    for (const key of unrelated) expect(invalidated(client, key), JSON.stringify(key)).toBe(false);
  });
});
