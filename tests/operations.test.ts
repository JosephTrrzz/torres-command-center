import { describe, expect, it } from "vitest";
import { buildOperationsSummary, calculateEstimate, labelOperationsValue } from "../lib/operations";

describe("operations workflow calculations", () => {
  it("calculates estimate totals from verified line items", () => {
    expect(calculateEstimate([{ quantity: 2, unitPrice: 125 }, { quantity: 1, unitPrice: 50 }], 0.1)).toEqual({ subtotal: 300, tax: 30, total: 330 });
  });

  it("summarizes active work without counting canceled or completed jobs", () => {
    const summary = buildOperationsSummary([
      { status: "scheduled", priority: "urgent", scheduled_start: "2026-08-28T17:00:00.000Z" },
      { status: "in_progress", priority: "normal", scheduled_start: null },
      { status: "completed", priority: "urgent", scheduled_start: "2026-08-20T17:00:00.000Z" },
    ], [
      { status: "sent", total: 200 },
      { status: "accepted", total: 450 },
    ], [{ client_visible: true }, { client_visible: false }], new Date("2026-08-26T17:00:00.000Z"));

    expect(summary.activeJobs).toBe(2);
    expect(summary.urgentJobs).toBe(1);
    expect(summary.upcomingJobs).toBe(1);
    expect(summary.pendingEstimates).toBe(1);
    expect(summary.acceptedValue).toBe(450);
    expect(summary.sharedDocuments).toBe(1);
  });

  it("renders stored workflow values as readable labels", () => {
    expect(labelOperationsValue("in_progress")).toBe("In Progress");
  });
});
