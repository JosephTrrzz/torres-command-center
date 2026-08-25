import { describe, expect, it } from "vitest";
import { buildTodayPriorities } from "../lib/today";
import type { ClientDetail } from "../lib/types";

function client(id: string, name: string, health: number): ClientDetail {
  return { id, name, health, initials: "TC", industry: "Technology", location: "Portland", status: health >= 80 ? "healthy" : "watch", metrics: [], lastUpdated: "Today", website: "https://example.com", owner: "Joseph", services: [], overview: "", traffic: [], opportunities: [] };
}

describe("today priorities", () => {
  it("shows only evidence-backed actions", () => {
    const result = buildTodayPriorities(
      [client("client-1", "Client One", 72)],
      [{ clientId: "client-1", available: false, errors: ["Save a GA4 property mapping."] }],
      [{ id: "notice-1", title: "Activation ready", detail: "Send the activation link.", time: "Now", tone: "action", read: false, href: "/clients/" }],
    );

    expect(result.map((item) => item.id)).toEqual(["notification-notice-1", "health-client-1", "report-client-1"]);
    expect(result[2].detail).toContain("GA4");
  });

  it("uses a truthful all-clear state when there is no action", () => {
    const result = buildTodayPriorities([client("client-1", "Client One", 100)], [{ clientId: "client-1", available: true }], []);
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe("clear");
  });

  it("does not surface read notifications", () => {
    const result = buildTodayPriorities([], [], [{ id: "notice-1", title: "Old", detail: "Done", time: "Yesterday", tone: "system", read: true }]);
    expect(result[0].id).toBe("all-clear");
  });
});
