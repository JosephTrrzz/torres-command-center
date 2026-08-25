import { describe, expect, it } from "vitest";
import { canCompleteOnboarding, nextOnboardingStep, onboardingCompletion, orderedOnboardingSteps } from "../lib/onboarding";

describe("client onboarding progress", () => {
  it("orders and deduplicates saved steps", () => {
    expect(orderedOnboardingSteps(["goals", "business", "goals", "invalid"])).toEqual(["business", "goals"]);
  });

  it("counts saved and intentionally skipped steps", () => {
    expect(onboardingCompletion(["business", "location"], ["services"])).toBe(60);
    expect(nextOnboardingStep(["business", "location"], ["services"])).toBe(4);
  });

  it("requires identity and location while allowing optional steps to be skipped", () => {
    expect(canCompleteOnboarding(["business", "location"], ["services", "goals"])).toBe(true);
    expect(canCompleteOnboarding(["business"], ["services", "goals"])).toBe(false);
  });

  it("finishes at the review step once all prior steps resolve", () => {
    expect(nextOnboardingStep(["business", "location", "services", "goals"])).toBe(5);
    expect(onboardingCompletion(["business", "location", "services", "goals", "review"])).toBe(100);
  });
});
