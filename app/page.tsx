"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ClientCard } from "../components/client-card";
import { Shell } from "../components/shell";
import { LoadingRegion } from "../components/loading-system";
import { fetchClients } from "../lib/supabase-data";
import { ClientDetail } from "../lib/types";
import { readStoredSession } from "../lib/supabase-auth";

type OverviewReport = { clientId: string; analytics?: { totals?: { sessions: number } } | null; searchConsole?: { totals?: { clicks: number; impressions: number } } | null };

export default function DashboardPage() {
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportData, setReportData] = useState<OverviewReport[]>([]);
  const healthy = clients.filter((client) => client.status === "healthy").length;
  const averageHealth = useMemo(() => clients.length ? Math.round(clients.reduce((sum, client) => sum + client.health, 0) / clients.length) : null, [clients]);
  const totals = useMemo(() => reportData.reduce((sum, report) => ({ sessions: sum.sessions + (report.analytics?.totals?.sessions || 0), clicks: sum.clicks + (report.searchConsole?.totals?.clicks || 0), impressions: sum.impressions + (report.searchConsole?.totals?.impressions || 0) }), { sessions: 0, clicks: 0, impressions: 0 }), [reportData]);

  useEffect(() => {
    const session = readStoredSession();
    fetchClients().then(async (loadedClients) => {
      setClients(loadedClients);
      const results = await Promise.all(loadedClients.map(async (client) => {
        try { const response = await fetch(`/api/reports?client=${encodeURIComponent(client.id)}`, { cache: "no-store", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } }); return response.ok ? await response.json() as OverviewReport : { clientId: client.id }; }
        catch { return { clientId: client.id }; }
      }));
      setReportData(results);
    }).catch(() => setError("Connect Supabase to load your live client portfolio.")).finally(() => setLoading(false));
  }, []);

  const dateLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date());

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return <Shell active="Overview">
    <div className="page-heading"><div><p className="eyebrow">{dateLabel}</p><h1>{greeting}, Joseph.</h1><p className="lede">Here’s what’s happening across your client portfolio.</p></div><Link className="button button-dark" href="/clients">View all clients <span>→︎</span></Link></div>
    <section className="stat-grid" aria-label="Portfolio summary"><div className="stat-card"><span>Portfolio health</span><strong>{averageHealth ?? "—"}<span className="muted">{averageHealth === null ? "" : "/100"}</span></strong><small className="neutral">Live client health scores</small></div><div className="stat-card"><span>GA4 sessions</span><strong>{loading ? "—" : totals.sessions.toLocaleString()}</strong><small className={totals.sessions ? "positive" : "neutral"}>{totals.sessions ? "Last 28 days" : "Awaiting a mapped property"}</small></div><div className="stat-card"><span>Search clicks</span><strong>{loading ? "—" : totals.clicks.toLocaleString()}</strong><small className={totals.clicks ? "positive" : "neutral"}>{totals.clicks ? `${totals.impressions.toLocaleString()} impressions` : "Awaiting Search Console data"}</small></div><div className="stat-card"><span>Clients monitored</span><strong>{clients.length}</strong><small className="positive">{healthy} healthy <em>right now</em></small></div></section>
    <section className="integration-banner"><div><p className="eyebrow">Proof layer</p><h2>Connect the signals behind every client scorecard.</h2><p>Bring reviews, traffic, search visibility, and website performance into one place.</p></div><Link className="button button-dark" href="/integrations/">Manage integrations <span>→︎</span></Link></section>
    <div className="section-heading"><div><p className="eyebrow">Your portfolio</p><h2>Client health</h2></div><Link className="text-link" href="/clients">See all clients →︎</Link></div>
    {error ? <p className="integration-notice">{error}</p> : loading ? <LoadingRegion active label="Loading live client portfolio" variant="clients" /> : clients.length ? <section className="client-grid">{clients.map((client) => <ClientCard client={client} key={client.id} />)}</section> : <section className="empty-state"><h2>No client records yet</h2><p>Add your first client to begin onboarding and connect reporting.</p><Link className="button button-dark" href="/clients/">Add a client <span>→︎</span></Link></section>}
    <section className="activity-panel"><div className="section-heading"><div><p className="eyebrow">Workspace flow</p><h2>Next actions</h2></div></div><div className="action-grid"><Link href="/clients/"><strong>1. Add or invite a client</strong><span>Create the account record and send an activation link.</span><b>Open Clients →︎</b></Link><Link href="/integrations/"><strong>2. Map reporting properties</strong><span>Choose the matching Google resources for each client.</span><b>Open Integrations →︎</b></Link><Link href="/reports/"><strong>3. Review before sharing</strong><span>Preview live metrics, then print or download the report.</span><b>Open Reports →︎</b></Link></div></section>
  </Shell>;
}
