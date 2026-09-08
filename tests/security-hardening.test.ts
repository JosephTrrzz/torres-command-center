import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockedHttpMethod,
  requestBodyLimit,
  requestBodyWithinLimit,
  secureApiResponse,
} from "../functions/_shared/security";

describe("edge request hardening", () => {
  it("blocks legacy tunneling methods and applies narrow body limits", () => {
    expect(blockedHttpMethod("TRACE")).toBe(true);
    expect(blockedHttpMethod("POST")).toBe(false);
    expect(requestBodyLimit("/api/profile")).toBe(1024 * 1024);
    expect(requestBodyLimit("/api/communications/attachments")).toBe(10 * 1024 * 1024);
  });

  it("rejects oversized, malformed, and encoded mutation bodies", async () => {
    expect(await requestBodyWithinLimit(new Request("https://example.com/api/test", { method: "POST", headers: { "Content-Length": "101" }, body: "a" }), 100)).toBe(false);
    expect(await requestBodyWithinLimit(new Request("https://example.com/api/test", { method: "POST", body: "too large" }), 3)).toBe(false);
    expect(await requestBodyWithinLimit(new Request("https://example.com/api/test", { method: "POST", headers: { "Content-Encoding": "gzip" }, body: "a" }), 100)).toBe(false);
    expect(await requestBodyWithinLimit(new Request("https://example.com/api/test", { method: "POST", body: "safe" }), 100)).toBe(true);
  });

  it("adds non-cacheable browser isolation headers to API responses", () => {
    const response = secureApiResponse(Response.json({ ok: true }), "request-1", "/api/profile");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Request-Id")).toBe("request-1");
  });
});

describe("database security migration", () => {
  const sql = readFileSync(join(process.cwd(), "supabase", "security_hardening.sql"), "utf8");
  it("removes the legacy open customer-account policies", () => {
    expect(sql).toContain('drop policy if exists "Authenticated users can view customer accounts"');
    expect(sql).toContain('using (client_id = public.current_client_id())');
    expect(sql).toContain('drop policy if exists "Authenticated users can view client people"');
  });
  it("keeps the receptionist limiter service-only and atomic", () => {
    expect(sql).toContain("on conflict (bucket_hash, window_start) do update");
    expect(sql).toContain("grant execute on function public.claim_receptionist_rate_limit");
    expect(sql).toContain("to service_role");
  });
});

describe("browser hardening configuration", () => {
  const headers = readFileSync(join(process.cwd(), "public", "_headers"), "utf8");
  const login = readFileSync(join(process.cwd(), "app", "login", "page.tsx"), "utf8");
  const auth = readFileSync(join(process.cwd(), "lib", "supabase-auth.ts"), "utf8");
  const data = readFileSync(join(process.cwd(), "lib", "supabase-data.ts"), "utf8");
  const portal = readFileSync(join(process.cwd(), "app", "portal", "page.tsx"), "utf8");

  it("protects static pages and keeps previews out of search", () => {
    expect(headers).toContain("Content-Security-Policy:");
    expect(headers).toContain("! Access-Control-Allow-Origin");
    expect(headers).toContain("Strict-Transport-Security:");
    expect(headers).toContain("X-Frame-Options: DENY");
    expect(headers).toContain("X-Robots-Tag: noindex, nofollow");
  });

  it("passes one-time captcha evidence to Supabase and defaults to session storage", () => {
    expect(login).toContain("<TurnstileChallenge");
    expect(auth).toContain("gotrue_meta_security: { captcha_token: captchaToken }");
    expect(auth).toContain('persistence ?? (window.localStorage.getItem(SESSION_KEY) ? "local" : "session")');
    expect(data).toContain("return readStoredSession()");
    expect(portal).not.toContain('window.localStorage.getItem("torres-auth-session")');
  });
});
