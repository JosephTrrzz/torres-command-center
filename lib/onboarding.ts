export const ONBOARDING_STEPS = ["business", "location", "services", "goals", "review"] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStatus = "not_started" | "in_progress" | "complete";

export interface OnboardingBusiness {
  legalName: string;
  displayName: string;
  vertical: string;
  tagline: string;
  description: string;
  website: string;
  email: string;
  phone: string;
}

export interface OnboardingLocation {
  name: string;
  streetAddress: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
  serviceArea: string;
}

export interface OnboardingService {
  name: string;
  description: string;
  category: string;
}

export interface OnboardingGoal {
  goalType: "leads" | "revenue" | "appointments" | "visibility" | "reviews" | "operations" | "business";
  title: string;
  targetValue: number | null;
  targetUnit: string;
  targetDate: string;
}

export interface OnboardingData {
  business: OnboardingBusiness;
  location: OnboardingLocation;
  services: OnboardingService[];
  goals: OnboardingGoal[];
}

export interface OnboardingSnapshot {
  clientId: string;
  organizationId: string;
  status: OnboardingStatus;
  currentStep: number;
  completedSteps: OnboardingStepKey[];
  skippedSteps: OnboardingStepKey[];
  completionPercent: number;
  data: OnboardingData;
  updatedAt: string | null;
  completedAt: string | null;
}

export function isOnboardingStep(value: unknown): value is OnboardingStepKey {
  return typeof value === "string" && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

export function orderedOnboardingSteps(values: readonly string[]) {
  const selected = new Set(values.filter(isOnboardingStep));
  return ONBOARDING_STEPS.filter((step) => selected.has(step));
}

export function onboardingCompletion(completedSteps: readonly string[], skippedSteps: readonly string[] = []) {
  const resolved = new Set([...completedSteps, ...skippedSteps].filter(isOnboardingStep));
  return Math.round((resolved.size / ONBOARDING_STEPS.length) * 100);
}

export function nextOnboardingStep(completedSteps: readonly string[], skippedSteps: readonly string[] = []) {
  const resolved = new Set([...completedSteps, ...skippedSteps].filter(isOnboardingStep));
  const firstOpenIndex = ONBOARDING_STEPS.findIndex((step) => !resolved.has(step));
  return firstOpenIndex === -1 ? ONBOARDING_STEPS.length : firstOpenIndex + 1;
}

export function canCompleteOnboarding(completedSteps: readonly string[], skippedSteps: readonly string[] = []) {
  const completed = new Set(completedSteps.filter(isOnboardingStep));
  const skipped = new Set(skippedSteps.filter(isOnboardingStep));
  return completed.has("business")
    && completed.has("location")
    && (completed.has("services") || skipped.has("services"))
    && (completed.has("goals") || skipped.has("goals"));
}

export function emptyOnboardingData(): OnboardingData {
  return {
    business: { legalName: "", displayName: "", vertical: "", tagline: "", description: "", website: "", email: "", phone: "" },
    location: { name: "Primary location", streetAddress: "", city: "", region: "", postalCode: "", countryCode: "US", serviceArea: "" },
    services: [{ name: "", description: "", category: "" }],
    goals: [{ goalType: "leads", title: "", targetValue: null, targetUnit: "per month", targetDate: "" }],
  };
}
