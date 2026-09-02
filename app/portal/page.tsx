"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "../../components/shell";
import { LoadingRegion } from "../../components/loading-system";
import { fetchClient, fetchClientPeople, fetchCustomerAccount, fetchCustomerAccountByEmail } from "../../lib/supabase-data";
import { readStoredSession } from "../../lib/supabase-auth";
import { fetchOnboarding } from "../../lib/onboarding-api";
import type { OnboardingSnapshot } from "../../lib/onboarding";
import { ClientDetail, ClientPerson, CustomerAccount } from "../../lib/types";

type PortalSession = { user?: { email?: string | null }; email?: string | null };

function readPortalEmail() {
  try {
    const raw = window.localStorage.getItem("torres-auth-session");
    if (!raw) return "";
    const session = JSON.parse(raw) as PortalSession;
    return session.user?.email ?? session.email ?? "";
  } catch {
    return "";
  }
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function PortalPage() {
  const [previewClientId, setPreviewClientId] = useState("");
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [people, setPeople] = useState<ClientPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [onboarding, setOnboarding] = useState<OnboardingSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPortal() {
      const requestedPreviewClientId = new URLSearchParams(window.location.search).get("previewClient") || "";
      setPreviewClientId(requestedPreviewClientId);
      const session = readStoredSession();
      if (requestedPreviewClientId) {
        if (!session || session.profile.role === "customer") {
          if (!cancelled) {
            setMessage("Client preview is available to workspace administrators only.");
            setLoading(false);
          }
          return;
        }
        try {
          const customer = await fetchClient(requestedPreviewClientId);
          const customerAccount = await fetchCustomerAccount(requestedPreviewClientId);
          if (!customer || !customerAccount) {
            if (!cancelled) setMessage("Set up this client’s customer portal account before previewing it.");
            return;
          }
          const contacts = await fetchClientPeople(customer.id).catch(() => []);
          if (!cancelled) {
            setAccount(customerAccount);
            setClient(customer);
            setPeople(contacts);
          }
          fetchOnboarding(session, customer.id).then((result) => { if (!cancelled) setOnboarding(result); }).catch(() => undefined);
        } catch (error) {
          if (!cancelled) setMessage(error instanceof Error ? error.message : "Unable to load the client preview.");
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }
      const email = readPortalEmail();
      if (!email) {
        if (!cancelled) {
          setMessage("Please sign in with the email assigned to your customer portal.");
          setLoading(false);
        }
        return;
      }

      try {
        if (session?.profile.role === "customer") {
          await fetch("/api/customer-activate", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
        }
        const customerAccount = await fetchCustomerAccountByEmail(email);
        if (!customerAccount) {
          if (!cancelled) setMessage("Your customer portal is not active yet. Please contact Torres & Co. Technology.");
          return;
        }
      const customer = await fetchClient(customerAccount.client_id);
      if (!customer) {
        if (!cancelled) setMessage("We couldn’t find the company connected to this portal.");
        return;
      }
      const contacts = await fetchClientPeople(customer.id).catch(() => []);
        if (!cancelled) {
          setAccount(customerAccount);
          setClient(customer);
          setPeople(contacts);
        }
        if (session) fetchOnboarding(session, customer.id).then((result) => { if (!cancelled) setOnboarding(result); }).catch(() => undefined);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Unable to load your customer portal.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPortal();
    return () => { cancelled = true; };
  }, []);

  return (
    <Shell active="Portal">
      {loading ? (
        <LoadingRegion active label="Loading the secure customer portal" variant="dashboard" />
      ) : message ? (
        <section className="portal-empty"><span className="eyebrow">Customer portal</span><h1>Your workspace is almost ready</h1><p>{message}</p><Link className="button button-dark" href="/login/?returnTo=/portal/">Sign in to customer portal</Link></section>
      ) : client && account ? (
        <>
          {previewClientId && <div className="portal-preview-banner"><strong>Admin preview</strong><span>The portal content below is client-facing. Your admin navigation stays visible so you can exit safely.</span><Link href="/clients/">Exit preview →︎</Link></div>}
          {onboarding && onboarding.status !== "complete" && <div className="onboarding-portal-banner"><div><span className="eyebrow">Finish account setup</span><strong>Your business profile is {onboarding.completionPercent}% complete.</strong><p>Complete the guided steps so reports, recommendations, and workspace details use accurate business information.</p></div><Link className="button button-dark" href={`/onboarding/${previewClientId ? `?client=${encodeURIComponent(client.id)}` : ""}`}>Continue onboarding <span>→︎</span></Link></div>}
          <section className="portal-hero">
            <div><span className="eyebrow">Customer portal</span><h1>Welcome to {client.name}</h1><p>Your private workspace for business health, website performance, contacts, and billing status.</p></div>
            <span className="portal-badge">Portal active</span>
          </section>

          <div className="portal-grid">
            <section className="portal-card portal-project-card"><span className="eyebrow">Project delivery</span><h2>Track work in progress</h2><p>See the same milestones, deliverables, target dates, and request statuses your Torres &amp; Co. team uses.</p><Link className="button button-dark" href={previewClientId ? `/projects/?client=${encodeURIComponent(client.id)}` : "/projects/"}>Open projects <span>→︎</span></Link></section>

            <section className="portal-card portal-operations-card"><span className="eyebrow">Service &amp; approvals</span><h2>Jobs, estimates, and documents</h2><p>Follow scheduled work, review client-visible updates, approve estimates, and open the latest shared documents in one place.</p><Link className="button button-dark" href={previewClientId ? `/operations/?client=${encodeURIComponent(client.id)}` : "/operations/"}>Open service workspace <span>→︎</span></Link></section>

            <section className="portal-card portal-inbox-card"><span className="eyebrow">Messages &amp; updates</span><h2>Your shared inbox</h2><p>Ask questions, respond to project updates, and keep decisions attached to your company record instead of scattered across separate email threads.</p><Link className="button button-dark" href={previewClientId ? `/inbox/?client=${encodeURIComponent(client.id)}` : "/inbox/"}>Open shared inbox <span>→︎</span></Link></section>

            <section className="portal-card portal-company-card"><div className="section-heading"><div><span className="eyebrow">Your company</span><h2>Business profile</h2></div><span className="portal-initials">{client.initials}</span></div><div className="portal-details"><div><span>Industry</span><strong>{client.industry}</strong></div><div><span>Location</span><strong>{client.location}</strong></div><div><span>Website</span><strong>{client.website}</strong></div><div><span>Account owner</span><strong>{client.owner}</strong></div></div><p className="portal-explanation">This information helps Torres &amp; Co. keep your reports, recommendations, and connected services associated with the correct business.</p></section>

            <section className="portal-card"><span className="eyebrow">At a glance</span><h2>Your performance summary</h2><div className="portal-stat-grid"><div className="portal-stat"><span>Health score</span><strong>{client.health}<small>/100</small></strong><p>Overall website and marketing readiness.</p></div><div className="portal-stat"><span>Contacts</span><strong>{people.length}</strong><p>People connected to this company.</p></div></div><div className="portal-metrics">{client.metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.change}</small></div>)}</div></section>

            <section className="portal-card"><span className="eyebrow">Billing</span><h2>Payment connection</h2><div className="portal-connection" data-state={account.billing_status === "active" ? "ready" : "pending"}><div><span className="portal-connection-dot" /> <strong>Square billing: {formatStatus(account.billing_status)}</strong></div><p>Payment details are managed securely by Square. This portal does not store card numbers.</p>{account.billing_status === "active" ? <small>Your billing connection is active.</small> : <small>Contact Torres &amp; Co. to connect or update your payment details.</small>}</div><p className="portal-explanation">When billing is connected, Square remains the secure payment provider while this account keeps the billing status linked to your company profile.</p></section>

            <section className="portal-card"><div className="section-heading"><div><span className="eyebrow">Your team</span><h2>Company contacts</h2></div><span className="portal-count">{people.length}</span></div>{people.length ? <div className="portal-people">{people.map((person) => <div className="portal-person" key={person.id}><span className="portal-person-avatar">{person.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><strong>{person.name}</strong><span>{person.role}</span><a href={`mailto:${person.email}`}>{person.email}</a>{person.phone && <a href={`tel:${person.phone}`}>{person.phone}</a>}</div></div>)}</div> : <p className="portal-empty-inline">No contacts have been added to this company yet.</p>}</section>
          </div>
        </>
      ) : null}
    </Shell>
  );
}
