import { describe, expect, it } from "vitest";
import {
  validWebsiteSubmissionId,
  verifyWebsiteIntakeSecret,
  websiteIntakeConfigured,
} from "../functions/_shared/website-intake";

describe("first-party website intake", () => {
  it("requires both server-only settings", () => {
    expect(websiteIntakeConfigured({ WEBSITE_INTAKE_SECRET: "secret", WEBSITE_LEADS_CLIENT_ID: "client" })).toBe(true);
    expect(websiteIntakeConfigured({ WEBSITE_INTAKE_SECRET: "replace-with-secret", WEBSITE_LEADS_CLIENT_ID: "client" })).toBe(false);
    expect(websiteIntakeConfigured({ WEBSITE_INTAKE_SECRET: "secret" })).toBe(false);
  });

  it("compares the intake secret without exposing it", async () => {
    await expect(verifyWebsiteIntakeSecret({ WEBSITE_INTAKE_SECRET: "server-secret" }, "server-secret")).resolves.toBe(true);
    await expect(verifyWebsiteIntakeSecret({ WEBSITE_INTAKE_SECRET: "server-secret" }, "wrong-secret")).resolves.toBe(false);
    await expect(verifyWebsiteIntakeSecret({ WEBSITE_INTAKE_SECRET: "server-secret" }, null)).resolves.toBe(false);
  });

  it("accepts only UUID submission identifiers", () => {
    expect(validWebsiteSubmissionId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(validWebsiteSubmissionId("mrennqzo")).toBe(false);
    expect(validWebsiteSubmissionId(undefined)).toBe(false);
  });
});
