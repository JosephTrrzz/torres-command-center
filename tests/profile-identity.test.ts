import { describe, expect, it } from "vitest";
import { normalizeProfileName } from "../functions/api/profile";

describe("account identity", () => {
  it("normalizes display names without accepting control characters", () => {
    expect(normalizeProfileName("  Joseph\n  Torres  ")).toBe("Joseph Torres");
    expect(normalizeProfileName(null)).toBe("");
  });

  it("keeps self-service profile updates limited to the signed-in user", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("functions/api/profile/index.ts", "utf8"));
    expect(source).toContain("auth.context.userId");
    expect(source).not.toContain("body?.userId");
    expect(source).not.toContain("body?.role");
    expect(source).not.toContain("body?.email");
  });

  it("exposes the same editor to administrators and clients", async () => {
    const fs = await import("node:fs/promises");
    const [settings, portal, styles] = await Promise.all([
      fs.readFile("app/settings/page.tsx", "utf8"),
      fs.readFile("app/portal/page.tsx", "utf8"),
      fs.readFile("app/ui-enhancements.css", "utf8"),
    ]);
    expect(settings).toContain("<AccountIdentityEditor />");
    expect(portal).toContain('<AccountIdentityEditor surface="portal" />');
    expect(styles).toContain("flex:0 0 32px");
  });
});
