"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "../../components/shell";
import { fetchOnboarding, saveOnboardingStep } from "../../lib/onboarding-api";
import { ONBOARDING_STEPS, emptyOnboardingData, type OnboardingData, type OnboardingGoal, type OnboardingService, type OnboardingSnapshot, type OnboardingStepKey } from "../../lib/onboarding";
import { readStoredSession } from "../../lib/supabase-auth";
import type { AuthSession } from "../../lib/types";

const STEP_COPY: Record<OnboardingStepKey, { label: string; title: string; description: string }> = {
  business: { label: "Business", title: "Tell us about the business", description: "These details shape your client portal, reports, and connected services." },
  location: { label: "Location", title: "Add the primary location", description: "Use the main office, storefront, or service-area location customers recognize." },
  services: { label: "Services", title: "What does the business provide?", description: "Services help Torres OS organize goals, recommendations, and future automations." },
  goals: { label: "Goals", title: "Choose measurable priorities", description: "Add the outcomes your team wants to improve and report on." },
  review: { label: "Review", title: "Review and activate", description: "Confirm the profile before making it the active source of client workspace details." },
};

function stepIndex(step: OnboardingStepKey) { return ONBOARDING_STEPS.indexOf(step); }

export default function OnboardingPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  const [data, setData] = useState<OnboardingData>(emptyOnboardingData());
  const [activeStep, setActiveStep] = useState<OnboardingStepKey>("business");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [adminMode, setAdminMode] = useState(false);

  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) return;
    const requestedClient = new URLSearchParams(window.location.search).get("client") || "";
    const clientId = requestedClient || stored.profile.client_id || "";
    setAdminMode(Boolean(requestedClient && stored.profile.role !== "customer"));
    setSession(stored);
    if (!clientId) { setError("Choose a client before opening onboarding."); setLoading(false); return; }
    fetchOnboarding(stored, clientId).then((next) => {
      setSnapshot(next);
      setData({ ...next.data, services: next.data.services.length ? next.data.services : emptyOnboardingData().services, goals: next.data.goals.length ? next.data.goals : emptyOnboardingData().goals });
      setActiveStep(next.status === "complete" ? "review" : ONBOARDING_STEPS[Math.max(0, Math.min(4, next.currentStep - 1))]);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Onboarding could not be loaded.")).finally(() => setLoading(false));
  }, []);

  const resolvedSteps = useMemo(() => new Set([...(snapshot?.completedSteps || []), ...(snapshot?.skippedSteps || [])]), [snapshot]);
  const copy = STEP_COPY[activeStep];

  function updateBusiness(field: keyof OnboardingData["business"], value: string) { setData((current) => ({ ...current, business: { ...current.business, [field]: value } })); }
  function updateLocation(field: keyof OnboardingData["location"], value: string) { setData((current) => ({ ...current, location: { ...current.location, [field]: value } })); }
  function updateService(index: number, field: keyof OnboardingService, value: string) { setData((current) => ({ ...current, services: current.services.map((service, row) => row === index ? { ...service, [field]: value } : service) })); }
  function updateGoal(index: number, field: keyof OnboardingGoal, value: string) { setData((current) => ({ ...current, goals: current.goals.map((goal, row) => row === index ? { ...goal, [field]: field === "targetValue" ? (value === "" ? null : Number(value)) : value } as OnboardingGoal : goal) })); }

  async function saveStep(options: { skipped?: boolean; complete?: boolean } = {}) {
    if (!session || !snapshot) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = activeStep === "business" ? data.business : activeStep === "location" ? data.location : activeStep === "services" ? data.services : activeStep === "goals" ? data.goals : undefined;
      const result = await saveOnboardingStep(session, { clientId: snapshot.clientId, step: activeStep, data: payload, skipped: options.skipped, complete: options.complete });
      setSnapshot(result.onboarding);
      setMessage(result.message);
      if (!options.complete) setActiveStep(ONBOARDING_STEPS[Math.min(4, stepIndex(activeStep) + 1)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This step could not be saved.");
    } finally { setBusy(false); }
  }

  if (loading) return <Shell active="Onboarding"><section className="onboarding-loading"><span className="eyebrow">Secure onboarding</span><h1>Opening the business profile…</h1><p>Loading saved progress and workspace permissions.</p></section></Shell>;
  if (!snapshot) return <Shell active="Onboarding"><section className="empty-state"><span className="eyebrow">Onboarding unavailable</span><h1>We couldn’t open this profile</h1><p>{error}</p><Link className="button button-dark" href={adminMode ? "/clients/" : "/portal/"}>Return to workspace</Link></section></Shell>;

  return <Shell active="Onboarding">
    {adminMode && <div className="portal-preview-banner"><strong>Agency editing mode</strong><span>You are completing onboarding for this client. Every saved change is recorded in the workspace audit history.</span><Link href={`/clients/detail/?id=${encodeURIComponent(snapshot.clientId)}`}>Exit onboarding →︎</Link></div>}
    <div className="page-heading onboarding-heading"><div><p className="eyebrow">Guided onboarding</p><h1>{data.business.displayName || "Business setup"}</h1><p className="lede">A clear, resumable setup for the information that powers your workspace.</p></div><div className="onboarding-completion"><strong>{snapshot.completionPercent}%</strong><span>{snapshot.status === "complete" ? "Complete" : "Profile complete"}</span></div></div>

    <div className="onboarding-shell">
      <aside className="onboarding-rail" aria-label="Onboarding steps">
        <div className="onboarding-progress"><span style={{ width: `${snapshot.completionPercent}%` }} /></div>
        {ONBOARDING_STEPS.map((step, index) => <button key={step} type="button" className={`${step === activeStep ? "active" : ""} ${resolvedSteps.has(step) ? "done" : ""}`} onClick={() => setActiveStep(step)}><i>{resolvedSteps.has(step) ? "✓" : index + 1}</i><span><strong>{STEP_COPY[step].label}</strong><small>{step === activeStep ? "Current step" : resolvedSteps.has(step) ? "Saved" : "Not started"}</small></span></button>)}
        <p>Your progress is private to this workspace and saved after each step.</p>
      </aside>

      <section className="onboarding-panel">
        <div className="onboarding-panel-heading"><p className="eyebrow">Step {stepIndex(activeStep) + 1} of {ONBOARDING_STEPS.length}</p><h2>{copy.title}</h2><p>{copy.description}</p></div>

        {activeStep === "business" && <div className="onboarding-form-grid">
          <label className="form-field"><span>Business display name *</span><input value={data.business.displayName} onChange={(event) => updateBusiness("displayName", event.target.value)} /></label>
          <label className="form-field"><span>Legal business name</span><input value={data.business.legalName} onChange={(event) => updateBusiness("legalName", event.target.value)} /></label>
          <label className="form-field"><span>Industry *</span><input value={data.business.vertical} onChange={(event) => updateBusiness("vertical", event.target.value)} /></label>
          <label className="form-field"><span>Website</span><input type="url" value={data.business.website} onChange={(event) => updateBusiness("website", event.target.value)} /></label>
          <label className="form-field"><span>Contact email</span><input type="email" value={data.business.email} onChange={(event) => updateBusiness("email", event.target.value)} /></label>
          <label className="form-field"><span>Phone</span><input type="tel" value={data.business.phone} onChange={(event) => updateBusiness("phone", event.target.value)} /></label>
          <label className="form-field form-field-full"><span>Tagline</span><input value={data.business.tagline} onChange={(event) => updateBusiness("tagline", event.target.value)} /></label>
          <label className="form-field form-field-full"><span>Business description</span><textarea value={data.business.description} onChange={(event) => updateBusiness("description", event.target.value)} /></label>
        </div>}

        {activeStep === "location" && <div className="onboarding-form-grid">
          <label className="form-field"><span>Location name</span><input value={data.location.name} onChange={(event) => updateLocation("name", event.target.value)} /></label>
          <label className="form-field"><span>Street address</span><input value={data.location.streetAddress} onChange={(event) => updateLocation("streetAddress", event.target.value)} /></label>
          <label className="form-field"><span>City *</span><input value={data.location.city} onChange={(event) => updateLocation("city", event.target.value)} /></label>
          <label className="form-field"><span>State / region</span><input value={data.location.region} onChange={(event) => updateLocation("region", event.target.value)} /></label>
          <label className="form-field"><span>Postal code</span><input value={data.location.postalCode} onChange={(event) => updateLocation("postalCode", event.target.value)} /></label>
          <label className="form-field"><span>Country code *</span><input maxLength={2} value={data.location.countryCode} onChange={(event) => updateLocation("countryCode", event.target.value.toUpperCase())} /></label>
          <label className="form-field form-field-full"><span>Service area</span><input value={data.location.serviceArea} onChange={(event) => updateLocation("serviceArea", event.target.value)} /></label>
        </div>}

        {activeStep === "services" && <div className="onboarding-repeater">{data.services.map((service, index) => <div className="onboarding-repeat-row" key={index}><div className="onboarding-repeat-heading"><strong>Service {index + 1}</strong>{data.services.length > 1 && <button type="button" onClick={() => setData((current) => ({ ...current, services: current.services.filter((_, row) => row !== index) }))}>Remove</button>}</div><div className="onboarding-form-grid"><label className="form-field"><span>Service name *</span><input value={service.name} onChange={(event) => updateService(index, "name", event.target.value)} /></label><label className="form-field"><span>Category</span><input value={service.category} onChange={(event) => updateService(index, "category", event.target.value)} /></label><label className="form-field form-field-full"><span>Description</span><textarea value={service.description} onChange={(event) => updateService(index, "description", event.target.value)} /></label></div></div>)}<button className="button button-light" type="button" onClick={() => setData((current) => ({ ...current, services: [...current.services, { name: "", category: "", description: "" }] }))}>+ Add another service</button></div>}

        {activeStep === "goals" && <div className="onboarding-repeater">{data.goals.map((goal, index) => <div className="onboarding-repeat-row" key={index}><div className="onboarding-repeat-heading"><strong>Goal {index + 1}</strong>{data.goals.length > 1 && <button type="button" onClick={() => setData((current) => ({ ...current, goals: current.goals.filter((_, row) => row !== index) }))}>Remove</button>}</div><div className="onboarding-form-grid"><label className="form-field"><span>Goal type</span><select value={goal.goalType} onChange={(event) => updateGoal(index, "goalType", event.target.value)}><option value="leads">Leads</option><option value="revenue">Revenue</option><option value="appointments">Appointments</option><option value="visibility">Visibility</option><option value="reviews">Reviews</option><option value="operations">Operations</option><option value="business">Business</option></select></label><label className="form-field"><span>Goal title *</span><input value={goal.title} onChange={(event) => updateGoal(index, "title", event.target.value)} /></label><label className="form-field"><span>Target value</span><input type="number" value={goal.targetValue ?? ""} onChange={(event) => updateGoal(index, "targetValue", event.target.value)} /></label><label className="form-field"><span>Target unit</span><input value={goal.targetUnit} onChange={(event) => updateGoal(index, "targetUnit", event.target.value)} /></label><label className="form-field"><span>Target date</span><input type="date" value={goal.targetDate} onChange={(event) => updateGoal(index, "targetDate", event.target.value)} /></label></div></div>)}<button className="button button-light" type="button" onClick={() => setData((current) => ({ ...current, goals: [...current.goals, { goalType: "leads", title: "", targetValue: null, targetUnit: "per month", targetDate: "" }] }))}>+ Add another goal</button></div>}

        {activeStep === "review" && <div className="onboarding-review-grid"><article><span>Business</span><strong>{data.business.displayName}</strong><p>{data.business.vertical}{data.business.website ? ` · ${data.business.website}` : ""}</p><button type="button" onClick={() => setActiveStep("business")}>Edit business →︎</button></article><article><span>Primary location</span><strong>{data.location.name}</strong><p>{[data.location.streetAddress, data.location.city, data.location.region, data.location.postalCode].filter(Boolean).join(", ")}</p><button type="button" onClick={() => setActiveStep("location")}>Edit location →︎</button></article><article><span>Services</span><strong>{snapshot.skippedSteps.includes("services") ? "Skipped for now" : `${data.services.filter((item) => item.name).length} added`}</strong><p>{data.services.filter((item) => item.name).map((item) => item.name).join(", ") || "No services added"}</p><button type="button" onClick={() => setActiveStep("services")}>Edit services →︎</button></article><article><span>Goals</span><strong>{snapshot.skippedSteps.includes("goals") ? "Skipped for now" : `${data.goals.filter((item) => item.title).length} added`}</strong><p>{data.goals.filter((item) => item.title).map((item) => item.title).join(", ") || "No goals added"}</p><button type="button" onClick={() => setActiveStep("goals")}>Edit goals →︎</button></article></div>}

        {error && <p className="login-notice error" role="alert">{error}</p>}
        {message && <p className="login-notice success" role="status">{message}</p>}
        <div className="onboarding-actions"><button className="button button-secondary" type="button" disabled={activeStep === "business" || busy} onClick={() => setActiveStep(ONBOARDING_STEPS[Math.max(0, stepIndex(activeStep) - 1)])}>Back</button><div>{(activeStep === "services" || activeStep === "goals") && <button className="button button-light" type="button" disabled={busy} onClick={() => void saveStep({ skipped: true })}>Skip for now</button>}<button className="button button-dark" type="button" disabled={busy} onClick={() => void saveStep(activeStep === "review" ? { complete: true } : {})}>{busy ? "Saving…" : activeStep === "review" ? snapshot.status === "complete" ? "Save reviewed profile" : "Complete onboarding" : "Save and continue"} <span>→︎</span></button></div></div>
      </section>
    </div>
  </Shell>;
}
