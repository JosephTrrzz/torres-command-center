"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchOnboarding } from "../lib/onboarding-api";
import { readStoredSession } from "../lib/supabase-auth";
import type { OnboardingSnapshot } from "../lib/onboarding";

export function OnboardingStatusPanel({ clientId }: { clientId: string }) {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const session = readStoredSession();
    if (!session) return;
    fetchOnboarding(session, clientId).then(setSnapshot).catch((reason) => setError(reason instanceof Error ? reason.message : "Onboarding status is unavailable."));
  }, [clientId]);

  return <section className="detail-card onboarding-status-card">
    <div>
      <p className="eyebrow">Client onboarding</p>
      <h2>{snapshot?.status === "complete" ? "Business profile complete" : "Activation details in progress"}</h2>
      <p>{error || (snapshot ? `${snapshot.completionPercent}% complete · progress is saved after every step.` : "Loading the client’s onboarding progress…")}</p>
    </div>
    {snapshot && <div className="onboarding-status-progress" aria-label={`${snapshot.completionPercent}% onboarding complete`}><span style={{ width: `${snapshot.completionPercent}%` }} /></div>}
    <Link className="button button-dark" href={`/onboarding/?client=${encodeURIComponent(clientId)}`}>{snapshot?.status === "complete" ? "Review onboarding" : "Open onboarding"} <span>→︎</span></Link>
  </section>;
}
