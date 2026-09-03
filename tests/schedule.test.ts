import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { calendarDays, dateKey, filterScheduleEvents, moveScheduleDate, parseScheduleDate, type ScheduleEvent } from "../lib/schedule";
import { canAccessPath } from "../lib/access-control";

const events: ScheduleEvent[] = [
  { id: "one", kind: "job", title: "Quarterly review", starts_at: "2026-09-08T17:00:00.000Z", ends_at: null, status: "scheduled", assigned_to: "user-a", job_id: "one", client_id: "client-a", client_name: "Alpine", assignee_name: "Joseph" },
  { id: "two", kind: "appointment", title: "Discovery call", starts_at: "2026-09-09T17:00:00.000Z", ends_at: null, status: "scheduled", assigned_to: null, job_id: null, client_id: "client-b", client_name: "Beacon", assignee_name: "" },
];

describe("agency schedule", () => {
  const endpoint = fs.readFileSync(path.join(process.cwd(), "functions/api/schedule/index.ts"), "utf8");

  it("keeps the agency schedule staff-only", () => {
    expect(canAccessPath("owner", "/schedule/")).toBe(true);
    expect(canAccessPath("employee", "/schedule/")).toBe(true);
    expect(canAccessPath("customer", "/schedule/")).toBe(false);
  });

  it("builds stable month, week, and agenda ranges", () => {
    const date = parseScheduleDate("2026-09-15");
    expect(calendarDays(date, "month")).toHaveLength(42);
    expect(calendarDays(date, "week")).toHaveLength(7);
    expect(calendarDays(date, "agenda")).toHaveLength(31);
    expect(dateKey(moveScheduleDate(date, "week", 1))).toBe("2026-09-22");
  });

  it("filters by client, category, and searchable ownership", () => {
    expect(filterScheduleEvents(events, { query: "joseph", clientId: "", categories: ["job", "appointment", "task"] })).toHaveLength(1);
    expect(filterScheduleEvents(events, { query: "", clientId: "client-b", categories: ["appointment"] }).map((event) => event.id)).toEqual(["two"]);
  });

  it("rejects impossible URL dates", () => {
    expect(dateKey(parseScheduleDate("2026-02-31", new Date(2026, 0, 5)))).toBe("2026-01-05");
  });

  it("aggregates through one staff-only authenticated boundary", () => {
    expect(endpoint).toContain('staffOnly: true, permission: "operations.read"');
    expect(endpoint).toContain("parent_organization_id=eq.");
    expect(endpoint).toContain("service_jobs?client_id=in.");
    expect(endpoint).toContain("crm_appointments?client_id=in.");
    expect(endpoint).toContain("crm_tasks?client_id=in.");
  });
});
