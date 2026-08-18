import { describe, expect, it } from "vitest";
import { clients, getClient } from "../lib/demo-data";

describe("demo client data", () => {
  it("contains the Phase One portfolio", () => {
    expect(clients).toHaveLength(3);
    expect(clients.every((client) => client.metrics.length > 0)).toBe(true);
  });
  it("resolves a client by stable id", () => {
    expect(getClient("hvac-ministries")?.name).toBe("HVAC Ministries");
    expect(getClient("missing")).toBeUndefined();
  });
});
