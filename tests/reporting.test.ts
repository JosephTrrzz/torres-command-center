import { describe, expect, it } from "vitest";
import { formatMetricChange, metricChange } from "../lib/reporting";

describe("report comparisons", () => {
  it("calculates a signed period change", () => expect(metricChange(120, 100)).toEqual({ delta: 20, percent: 0.2 }));
  it("does not manufacture a percentage from a zero baseline", () => expect(formatMetricChange(8, 0)).toBe("New activity"));
  it("describes stable values plainly", () => expect(formatMetricChange(0, 0)).toBe("No change"));
});
