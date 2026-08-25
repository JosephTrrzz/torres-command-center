import type { AuthSession } from "./types";
import type { OnboardingSnapshot, OnboardingStepKey } from "./onboarding";

type OnboardingResponse = { onboarding?: OnboardingSnapshot; message?: string; error?: string };

async function onboardingRequest(session: AuthSession, path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({})) as OnboardingResponse;
  if (!response.ok || !body.onboarding) throw new Error(body.error || "Onboarding could not be loaded.");
  return { onboarding: body.onboarding, message: body.message || "" };
}

export async function fetchOnboarding(session: AuthSession, clientId?: string) {
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  return (await onboardingRequest(session, `/api/onboarding/${query}`)).onboarding;
}

export async function saveOnboardingStep(session: AuthSession, input: {
  clientId: string;
  step: OnboardingStepKey;
  data?: unknown;
  skipped?: boolean;
  complete?: boolean;
}) {
  return onboardingRequest(session, "/api/onboarding/", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
