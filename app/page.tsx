"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ClientCard } from "../components/client-card";
import { Shell } from "../components/shell";
import { fetchClients } from "../lib/supabase-data";
import { ClientDetail } from "../lib/types";

export default function DashboardPage() {
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const healthy = clients.filter((client) => client.status === "healthy").length;
  const averageHealth = useMemo(() => clients.length ? Math.round(clients.reduce((sum, client) => sum + client.health, 0) / clients.length) : null, [clients]);

  useEffect(() => {
    fetchClients().then(setClients).catch(() => setError("Connect Supabase to load your live client portfolio.")).finally(() => setLoading(false));
  }, []);

  const dateLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date());

  return <Shell active="Overview">
    <div className="page-heading"><div><p className="eyebrow">{dateLabel}</p><h1>Good morning, Joseph.</h1><p className="lede">Here’s what’s happening across your client portfolio.</p></div><Link className="button button-dark" href="/clients">View all clients <span>→</span></Link></div>
    <section className="stat-grid" aria-label="Portfolio summary"><div className="stat-card"><span>Portfolio health</span><strong>{averageHealth ?? "—"}<span className="muted">{averageHealth === null ? "" : "/100"}</span></strong><small className="neutral">Live client health scores</small></div><div className="stat-card"><span>Organic traffic</span><strong>—</strong><small className="neutral">Connect Google Analytics</small></div><div className="stat-card"><span>Open opportunities</span><strong>—</strong><small className="neutral">Connect reporting to populate</small></div><div className="stat-card"><span>Clients monitored</span><strong>{clients.length}</strong><small className="positive">{healthy} healthy <em>right now</em></small></div></section>
    <section className="integration-banner"><div><p className="eyebrow">Proof layer</p><h2>Connect the signals behind every client scorecard.</h2><p>Bring reviews, traffic, search visibility, and website performance into one place.</p></div><Link className="button button-dark" href="/integrations/">Manage integrations <span>→</span></Link></section>
    <div className="section-heading"><div><p className="eyebrow">Your portfolio</p><h2>Client health</h2></div><Link className="text-link" href="/clients">See all clients →</Link></div>
    {error ? <p className="integration-notice">{error}</p> : loading ? <p className="integration-notice">Loading live client records…</p> : clients.length ? <section className="client-grid">{clients.map((client) => <ClientCard client={client} key={client.id} />)}</section> : <section className="empty-state"><h2>No client records yet</h2><p>Add your first client to begin onboarding and connect reporting.</p><Link className="button button-dark" href="/clients/">Add a client <span>→</span></Link></section>}
    <section className="activity-panel"><div className="section-heading"><div><p className="eyebrow">Live feed</p><h2>Recent activity</h2></div></div><p className="integration-notice">Connect a reporting integration to populate live activity for this workspace.</p></section>
  </Shell>;
}
