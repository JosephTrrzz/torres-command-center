import { describe, expect, it } from "vitest";
import { nextReportRun } from "../lib/report-schedules";

describe("scheduled report dates", () => {
  it("advances a weekly delivery by seven days", () => expect(nextReportRun("2026-09-02T16:00:00.000Z", "weekly")).toBe("2026-09-09T16:00:00.000Z"));
  it("keeps the monthly day when possible", () => expect(nextReportRun("2026-09-15T16:00:00.000Z", "monthly")).toBe("2026-10-15T16:00:00.000Z"));
  it("clamps month-end deliveries", () => expect(nextReportRun("2026-01-31T16:00:00.000Z", "monthly")).toBe("2026-02-28T16:00:00.000Z"));
});
