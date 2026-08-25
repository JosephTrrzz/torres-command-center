"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClientProfileForm } from "../../../components/client-profile-form";
import { CustomerAccountPanel } from "../../../components/customer-account-panel";
import { PeoplePanel } from "../../../components/people-panel";
import { OnboardingStatusPanel } from "../../../components/onboarding-status-panel";
import { Shell } from "../../../components/shell";
import { fetchClient } from "../../../lib/supabase-data";
import { ClientDetail } from "../../../lib/types";

export default function ClientDetailPage() {
  const [id, setId] = useState("");
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [status, setStatus] = useState("Loading account…");

  useEffect(() => {
    const currentId = new URLSearchParams(window.location.search).get("id") ?? "";
    setId(currentId);
    if (!currentId) { setStatus(""); return; }

    (async () => {
      try {
        const row = await fetchClient(currentId);
        if (row) { setClient(row); setStatus(""); return; }
        setStatus("This client record is not available.");
      } catch {
        setStatus("Unable to load this client record.");
      }
    })();
  }, []);

  if (!id || !client) {
    return <Shell active="Clients"><div className="detail-card"><h1>{id ? "Client not found" : "Loading account…"}</h1><Link className="text-link" href="/clients/">← Back to clients</Link></div></Shell>;
  }

  return <Shell active="Clients">
    <Link className="back-link" href="/clients/">← Back to clients</Link>
    <div className="detail-hero">
      <div><p className="eyebrow">Client account</p><h1>{client.name}</h1><p className="lede">{client.industry} · {client.location}</p>{status && <small className="updated">{status}</small>}</div>
      <span className={`health-badge ${client.status}`}>{client.status} · {client.health}/100</span>
    </div>
    <div className="detail-layout">
      <section className="detail-card"><p className="eyebrow">Business information</p><h2>Account overview</h2><p>{client.overview}</p><div className="contact-list">{client.email && <a href={`mailto:${client.email}`}>✉ {client.email}</a>}{client.phone && <a href={`tel:${client.phone}`}>☎ {client.phone}</a>}{client.website && <a href={client.website.startsWith("http") ? client.website : `https://${client.website}`} target="_blank" rel="noreferrer">↗ {client.website}</a>}</div></section>
      <section className="detail-card"><p className="eyebrow">Performance</p><h2>Health score</h2><div className="large-score">{client.health}</div><div className="health-track"><span style={{ width: `${client.health}%` }} /></div><div className="metric-list">{client.metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}</div></section>
    </div>
    <OnboardingStatusPanel clientId={client.id} />
    <section className="detail-card integration-preview">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Delivery workspace</p>
          <h2>Projects, milestones, and requests</h2>
          <p>Publish measurable progress, share deliverables, and respond to this client’s requests.</p>
        </div>
        <Link className="button button-dark" href={`/projects/?client=${encodeURIComponent(client.id)}`}>
          Open projects <span>→</span>
        </Link>
      </div>
    </section>
    <section className="detail-card integration-preview">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Evidence connections</p>
          <h2>Connect this client’s proof</h2>
          <p>Set up Google, website, traffic, and infrastructure sources for this account.</p>
        </div>
        <Link className="button button-dark" href={`/integrations/?client=${encodeURIComponent(client.id)}`}>
          Manage connections <span>→</span>
        </Link>
      </div>
      <div className="integration-preview-list">
        <span>Google Business Profile</span>
        <span>Search visibility</span>
        <span>Website scorecard</span>
      </div>
    </section>
    <ClientProfileForm client={client} onSaved={(fields) => setClient((current) => current ? { ...current, ...fields } : current)} />
        <CustomerAccountPanel clientId={client.id} clientName={client.name} defaultEmail={client.email ?? ""} />
        <PeoplePanel clientId={client.id} />
  </Shell>;
}
