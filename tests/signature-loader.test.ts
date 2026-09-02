import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(join(process.cwd(), "components", "loading-system.tsx"), "utf8");
const styles = readFileSync(join(process.cwd(), "components", "signature-loader.module.css"), "utf8");
const foundation = readFileSync(join(process.cwd(), "app", "design-foundation.css"), "utf8");
const preview = readFileSync(join(process.cwd(), "app", "logo-loader-concept", "page.tsx"), "utf8");

describe("signature Torres logo-fill loader", () => {
  it("uses optimized layers derived from the official logo", () => {
    for (const asset of ["torres-loader-mark.png", "torres-loader-blue.png", "torres-loader-gold.png"]) {
      expect(existsSync(join(process.cwd(), "public", "brand", asset))).toBe(true);
      expect(component).toContain(`/brand/${asset}`);
    }
    expect(styles).toContain("--logo-blue: #122137");
    expect(styles).toContain("--logo-gold: #b08d57");
  });

  it("plays a finite blue, gold, and light-pass sequence", () => {
    expect(styles).toContain(".blueFill");
    expect(styles).toContain(".goldFill");
    expect(styles).toContain(".lightPass");
    expect(styles).not.toContain("infinite");
  });

  it("supports accessible loading, completion, recovery, and reduced motion", () => {
    expect(component).toContain('role={error ? "alert" : "status"}');
    expect(component).toContain("aria-busy={!complete && !error}");
    expect(component).toContain("prefers-reduced-motion: reduce");
    expect(component).toContain("Try again");
    expect(component).toContain("AppEntryTransition");
  });

  it("keeps a standalone replay surface for the approved entry loader", () => {
    expect(preview).toContain("Approved system · active on first secure entry");
    expect(preview).toContain("TorresLogoLoader");
    expect(preview).toContain("Complete and reveal");
  });

  it("promotes the signature loader to session-scoped authenticated startup", () => {
    const shell = readFileSync(join(process.cwd(), "components", "shell.tsx"), "utf8");
    const login = readFileSync(join(process.cwd(), "app", "login", "page.tsx"), "utf8");
    expect(component).toContain("torres-os-signature-entry-seen");
    expect(component).toContain("markSignatureEntrySeen");
    expect(component).toContain("animate = false");
    expect(component).not.toContain("branded-loader-mark");
    expect(foundation).not.toContain("brand-line");
    expect(shell).toContain("shouldShowSignatureEntry()");
    expect(shell).toContain("SIGNATURE_ENTRY_HANDOFF_MS = 900");
    expect(shell).toContain("<AppEntryTransition");
    expect(login).toContain("<BrandedAppLoader animate");
    expect(login).toContain("markSignatureEntrySeen()");
  });
});
