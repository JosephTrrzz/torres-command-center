import { describe, expect, it } from "vitest";
import { buildOperationsSummary, calculateEstimate, labelOperationsValue } from "../lib/operations";
import { estimateDecisionEmail, estimateReviewEmail, normalizeEmailRecipients, operationsSignInLink, productionAppOrigin } from "../functions/_shared/operations-email";

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

describe("operations email workflow", () => {
  it("normalizes, validates, and deduplicates client recipients", () => {
    expect(normalizeEmailRecipients([" Client@Example.com ", "client@example.com", "invalid", null])).toEqual(["client@example.com"]);
  });

  it("builds a production sign-in link back to the scoped estimate", () => {
    const link = operationsSignInLink("https://preview.pages.dev/api/operations", "https://admin.example.com/", {
      clientId: "client-id",
      jobId: "job-id",
    });
    expect(link).toBe("https://admin.example.com/login/?returnTo=%2Foperations%2F%3Fclient%3Dclient-id%26job%3Djob-id");
    expect(productionAppOrigin("https://preview.pages.dev/api/operations", "http://localhost:3000")).toBe("https://preview.pages.dev");
  });

  it("escapes estimate content and includes only the secure action", () => {
    const review = estimateReviewEmail({
      clientName: "Client <One>",
      estimateNumber: "EST-100",
      estimateTitle: "Launch & support",
      total: 1250,
      currency: "USD",
      expiresAt: "2026-09-15",
      actionUrl: "https://admin.example.com/login/?returnTo=%2Foperations%2F",
    });
    expect(review.subject).toBe("EST-100 is ready for review");
    expect(review.html).toContain("Client &lt;One&gt;");
    expect(review.html).toContain("$1,250.00");
    expect(review.html).not.toContain("Client <One>");

    const decision = estimateDecisionEmail({
      clientName: "Client One",
      estimateNumber: "EST-100",
      estimateTitle: "Launch",
      response: "accepted",
      responder: "client@example.com",
      actionUrl: "https://admin.example.com/operations/",
    });
    expect(decision.subject).toContain("accepted EST-100");
    expect(decision.text).toContain("Response recorded by client@example.com");
  });
});
