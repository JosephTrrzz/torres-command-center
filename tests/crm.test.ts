import { describe, expect, it } from "vitest";
import { buildCrmSummary, labelCrmValue } from "../lib/crm";

describe("CRM workflow summaries", () => {
  const now = new Date("2026-08-25T17:00:00.000Z");

  it("separates active, won, and unassigned leads honestly", () => {
    const summary = buildCrmSummary([
      { status: "new", assigned_to: null },
      { status: "qualified", assigned_to: "user-1" },
      { status: "won", assigned_to: null },
      { status: "lost", assigned_to: null },
    ], [], [], now);

    expect(summary.activeLeads).toBe(2);
    expect(summary.unassigned).toBe(1);
    expect(summary.wonLeads).toBe(1);
  });

  it("counts overdue work and only future scheduled appointments", () => {
    const summary = buildCrmSummary([], [
      { status: "open", due_at: "2026-08-24T17:00:00.000Z" },
      { status: "in_progress", due_at: "2026-08-26T17:00:00.000Z" },
      { status: "completed", due_at: "2026-08-20T17:00:00.000Z" },
    ], [
      { status: "scheduled", starts_at: "2026-08-26T17:00:00.000Z" },
      { status: "scheduled", starts_at: "2026-08-24T17:00:00.000Z" },
      { status: "canceled", starts_at: "2026-08-27T17:00:00.000Z" },
    ], now);

    expect(summary.openTasks).toBe(2);
    expect(summary.overdueTasks).toBe(1);
    expect(summary.upcomingAppointments).toBe(1);
  });

  it("turns stored CRM values into readable labels", () => {
    expect(labelCrmValue("appointment_scheduled")).toBe("Appointment Scheduled");
    expect(labelCrmValue("in_progress")).toBe("In Progress");
  });
});
