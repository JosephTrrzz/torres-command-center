"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClientProfileForm } from "../../../components/client-profile-form";
import { PeoplePanel } from "../../../components/people-panel";
import { Shell } from "../../../components/shell";
import { getClient } from "../../../lib/demo-data";
import { fetchClient, fetchClients } from "../../../lib/supabase-data";
import { ClientDetail } from "../../../lib/types";

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export default function ClientDetailPage() {
  const [id, setId] = useState("");
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [status, setStatus] = useState("Loading account…");

  useEffect(() => {
    const currentId = new URLSearchParams(window.location.search).get("id") ?? "";
    setId(currentId);
    const demo = currentId ? getClient(currentId) ?? null : null;
    if (demo) setClient(demo);
    if (!currentId) { setStatus(""); return; }

    (async () => {
      try {
        const row = await fetchClient(currentId);
        if (row) { setClient(row); setStatus(""); return; }
        if (demo) {
          const connectedClients = await fetchClients();
          const demoName = normalizeName(demo.name);
          const connected = connectedClients.find((item) => {
            const connectedName = normalizeName(item.name);
            return connectedName === demoName || connectedName.includes(demoName) || demoName.includes(connectedName);
          });
          if (connected) { setClient({ ...demo, ...connected }); setStatus(""); return; }
        }
        setStatus("Showing the saved account profile.");
      } catch {
        setStatus("Showing the saved account profile.");
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
    <ClientProfileForm client={client} onSaved={(fields) => setClient((current) => current ? { ...current, ...fields } : current)} />
    <PeoplePanel clientId={client.id} />
  </Shell>;
}
