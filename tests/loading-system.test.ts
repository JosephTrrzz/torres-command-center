import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(join(process.cwd(), "components", "loading-system.tsx"), "utf8");
const foundation = readFileSync(join(process.cwd(), "app", "design-foundation.css"), "utf8");
const design = readFileSync(join(process.cwd(), "DESIGN.md"), "utf8");

describe("luxury loading system", () => {
  it("uses delayed, stable loading timing without blocking completed content", () => {
    expect(component).toContain("delay: 180");
    expect(component).toContain("minimumVisible: 360");
    expect(component).toContain("longWait: 1500");
    expect(component).toContain("useDelayedLoading(active)");
    expect(component).toContain("useLongLoading(active)");
    expect(component).toContain("loading-long-wait");
    expect(design).toContain("Real content always wins");
  });

  it("provides reusable patterns for each major product shape", () => {
    for (const pattern of [
      "MetricCardSkeleton",
      "ChartSkeleton",
      "TableSkeleton",
      "CardGridSkeleton",
      "ActivityFeedSkeleton",
      "MessageSkeleton",
      "DetailPanelSkeleton",
      "SettingsFormSkeleton",
      "CalendarSkeleton",
      "DocumentListSkeleton",
      "InvoiceListSkeleton",
      "SearchResultsSkeleton",
      "ProfileSkeleton",
      "BrandedAppLoader",
      "ButtonLoader",
      "RefreshIndicator",
    ]) expect(component).toContain(`function ${pattern}`);
  });

  it("announces loading semantics and hides decorative placeholders", () => {
    expect(component).toContain("aria-busy={active}");
    expect(component).toContain('aria-hidden="true"');
    expect(component).toContain('className="sr-only"');
    expect(component).toContain('size="small"');
  });

  it("uses restrained motion tokens and disables movement when requested", () => {
    expect(foundation).toContain("--motion-micro:150ms");
    expect(foundation).toContain("--motion-component:220ms");
    expect(foundation).toContain("--motion-dialog:280ms");
    expect(foundation).toContain("--motion-route:320ms");
    expect(foundation).toContain("@media(prefers-reduced-motion:reduce)");
    expect(foundation).toContain(".skeleton::after{display:none}");
  });
});
