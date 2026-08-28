import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail } from "../lib/email";

describe("email persistence helpers", () => {
  it("normalizes saved addresses consistently", () => {
    expect(normalizeEmail("  Joseph@TorresCoTechnology.com  ")).toBe("joseph@torrescotechnology.com");
  });

  it("accepts valid business addresses", () => {
    expect(isValidEmail("admin@torrescotechnology.com")).toBe(true);
  });

  it("rejects incomplete addresses before a Supabase write", () => {
    expect(isValidEmail("joseph@localhost")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
  });
});
