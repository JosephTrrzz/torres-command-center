import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "supabase/apple_calendar.sql"), "utf8");
const endpoint = fs.readFileSync(path.join(root, "functions/api/calendar/apple.ts"), "utf8");
const operations = fs.readFileSync(path.join(root, "app/operations/page.tsx"), "utf8");

describe("Apple Calendar subscriptions", () => {
  it("stores only a revocable token hash behind RLS", () => {
    expect(migration).toContain("token_hash text not null unique");
    expect(migration).not.toMatch(/\btoken\s+text\b/);
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.calendar_subscriptions from anon, authenticated");
  });

  it("generates a high-entropy token and publishes an iCalendar response", () => {
    expect(endpoint).toContain("crypto.getRandomValues(new Uint8Array(36))");
    expect(endpoint).toContain('crypto.subtle.digest("SHA-256"');
    expect(endpoint).toContain('"Content-Type": "text/calendar; charset=utf-8"');
    expect(endpoint).toContain('"BEGIN:VCALENDAR"');
  });

  it("keeps internal appointments and tasks out of customer feeds", () => {
    expect(endpoint).toContain("subscription.include_private ? fetch");
    expect(endpoint).toContain("client_visible=eq.true");
    expect(endpoint).toContain('organizationRole !== "client"');
  });

  it("offers explicit Apple handoff, copy, and revocation controls", () => {
    expect(operations).toContain("Connect Apple Calendar");
    expect(operations).toContain("Open in Apple Calendar");
    expect(operations).toContain("Copy private link");
    expect(operations).toContain("Revoke link");
  });
});
