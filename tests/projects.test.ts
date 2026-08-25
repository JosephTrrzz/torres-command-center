import { describe, expect, it } from "vitest";
import {
  calculateProjectProgress,
  labelProjectValue,
  projectStatusFromProgress,
} from "../lib/projects";

describe("project delivery calculations", () => {
  it("uses persisted milestone completion to calculate progress", () => {
    expect(calculateProjectProgress([])).toBe(0);
    expect(calculateProjectProgress([
      { status: "complete" },
      { status: "in_progress" },
    ])).toBe(50);
    expect(calculateProjectProgress([
      { status: "complete" },
      { status: "complete" },
      { status: "not_started" },
    ])).toBe(67);
  });

  it("keeps project status aligned with milestone progress", () => {
    expect(projectStatusFromProgress("planned", 100)).toBe("completed");
    expect(projectStatusFromProgress("completed", 75)).toBe("active");
    expect(projectStatusFromProgress("blocked", 100)).toBe("blocked");
    expect(projectStatusFromProgress("archived", 25)).toBe("archived");
  });

  it("turns machine values into readable labels", () => {
    expect(labelProjectValue("in_review")).toBe("In Review");
    expect(labelProjectValue("not_started")).toBe("Not Started");
  });
});
