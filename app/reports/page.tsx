"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "../../components/shell";
import { fetchClient, fetchClients } from "../../lib/supabase-data";
import { ClientDetail } from "../../lib/types";
import { readStoredSession } from "../../lib/supabase-auth";
import { appRoleForOrganizationRole } from "../../lib/access-control";
import { fetchProjects } from "../../lib/projects-api";

type ReportData = { clientId: string; available?: boolean; analytics?: { totals?: { sessions: number; activeUsers: number; pageViews: number; conversions: number } } | null; searchConsole?: { totals?: { clicks: number; impressions: number } } | null; errors?: string[]; freshness?: { source: "stored" | "live"; syncedAt: string | null } };
const reportDefinitions = [
  { id: "portfolio", label: "Portfolio health", description: "A leadership view of client health scores and account coverage." },
  { id: "performance", label: "Client performance", description: "A client-by-client review of current health and connected evidence." },
  { id: "opportunities", label: "SEO opportunities", description: "A prioritized workspace for opportunities returned by connected sources." },
];

export default function ReportsPage() {
  const [selectedId, setSelectedId] = useState("portfolio");
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [reportData, setReportData] = useState<ReportData[]>([]);
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [error, setError] = useState("");
  const [clientView, setClientView] = useState(false);
  const selected = reportDefinitions.find((report) => report.id === selectedId) ?? reportDefinitions[0];
  const averageHealth = useMemo(() => clients.length ? Math.round(clients.reduce((sum, client) => sum + client.health, 0) / clients.length) : null, [clients]);
  const generatedDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date());
  const totals = useMemo(() => reportData.reduce((sum, report) => ({ sessions: sum.sessions + (report.analytics?.totals?.sessions || 0), clicks: sum.clicks + (report.searchConsole?.totals?.clicks || 0), impressions: sum.impressions + (report.searchConsole?.totals?.impressions || 0), conversions: sum.conversions + (report.analytics?.totals?.conversions || 0), connected: sum.connected + (report.available ? 1 : 0) }), { sessions: 0, clicks: 0, impressions: 0, conversions: 0, connected: 0 }), [reportData]);
  const latestMetricSync = useMemo(() => reportData.reduce<Date | null>((latest, report) => {
    const synced = report.freshness?.syncedAt ? new Date(report.freshness.syncedAt) : null;
    return synced && !Number.isNaN(synced.getTime()) && (!latest || synced > latest) ? synced : latest;
  }, null), [reportData]);
  const freshnessLabel = latestMetricSync ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(latestMetricSync) : "Not synchronized";

  useEffect(() => {
    const session = readStoredSession();
    const isCustomer = Boolean(session && appRoleForOrganizationRole(session.organization?.role, session.profile.role) === "customer");
    setClientView(isCustomer);
    const loadPermittedClients = async () => {
      if (!session || !isCustomer) return fetchClients();
      const clientId = session.profile.client_id || (await fetchProjects(session)).client.id;
      const customer = await fetchClient(clientId);
      return customer ? [customer] : [];
    };
    loadPermittedClients().then(async (loadedClients) => {
      setClients(loadedClients);
      const results = await Promise.all(loadedClients.map(async (client) => {
        try { const response = await fetch(`/api/reports?client=${encodeURIComponent(client.id)}`, { cache: "no-store", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } }); return response.ok ? await response.json() as ReportData : { clientId: client.id, errors: ["Report metrics could not be loaded."] }; }
        catch { return { clientId: client.id, errors: ["Report metrics could not be loaded."] }; }
      }));
      setReportData(results);
    }).catch(() => setError(isCustomer ? "Your tenant-scoped performance data could not be loaded." : "Connect Supabase to load live report data.")).finally(() => { setLoading(false); setMetricsLoading(false); });
  }, []);

  function downloadReport() {
    const rows = clients.map((client) => { const metrics = reportData.find((report) => report.clientId === client.id); return `<tr><td>${client.name}</td><td>${client.industry}</td><td>${client.location}</td><td>${client.health}/100</td><td>${metrics?.analytics?.totals?.sessions ?? "—"}</td><td>${metrics?.searchConsole?.totals?.clicks ?? "—"}</td></tr>`; }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${selected.label} · Torres & Co.</title><style>body{font:15px Arial;color:#18221f;margin:48px}h1{font-size:30px}p{color:#68736e}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{text-align:left;border-bottom:1px solid #ddd;padding:12px}th{color:#68736e;font-size:12px;text-transform:uppercase}</style></head><body><p>TORRES &amp; CO. COMMAND CENTER</p><h1>${selected.label}</h1><p>Prepared ${generatedDate} · ${clients.length} client records</p><h2>Executive summary</h2><p>${selected.description}</p><p>GA4 sessions: ${totals.sessions} · Search clicks: ${totals.clicks}</p><table><thead><tr><th>Client</th><th>Industry</th><th>Location</th><th>Health</th><th>GA4 sessions</th><th>Search clicks</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([html], { type: "text/html" })); link.download = `${selected.id}-report.html`; link.click(); URL.revokeObjectURL(link.href);
  }

  return <Shell active="Reports">
    <div className="page-heading"><div><p className="eyebrow">{clientView ? "Private performance" : "Reporting studio"}</p><h1>{clientView ? "Performance" : "Reports"}</h1><p className="lede">{clientView ? "A private, evidence-backed view of your connected website and search performance." : "Review live performance evidence before printing or exporting it for a client or leadership meeting."}</p></div><div className="report-actions"><button className="button button-light" onClick={() => window.print()} disabled={!clients.length}>Print / Save PDF</button><button className="button button-dark" onClick={downloadReport} disabled={!clients.length}>Download report <span>↓︎</span></button></div></div>
    {error && <p className="integration-notice">{error}</p>}
    <section className="report-grid" aria-label="Report types">{reportDefinitions.map((report, index) => <button className={`report-card ${selectedId === report.id ? "selected" : ""}`} key={report.id} onClick={() => setSelectedId(report.id)}><span className="eyebrow">Report 0{index + 1}</span><h2>{report.label}</h2><p>{report.description}</p><strong>Preview report →︎</strong></button>)}</section>
    <section className="report-document" aria-label="Report preview"><header className="report-document-header"><div><p className="eyebrow">Torres &amp; Co. Technology</p><h2>{selected.label}</h2><p>Prepared {generatedDate}</p></div><span className="report-document-mark">TC</span></header>
      <div className="report-document-summary"><div><span>Client records</span><strong>{loading ? "—" : clients.length}</strong><small>Live Supabase records</small></div><div><span>Average health</span><strong>{averageHealth === null ? "—" : `${averageHealth}/100`}</strong><small>Across loaded clients</small></div><div><span>Data status</span><strong>{loading || metricsLoading ? "Loading" : totals.connected ? "Current" : "Needs setup"}</strong><small>{totals.connected ? `Last synchronized ${freshnessLabel}` : "Connect a reporting property"}</small></div></div>
      <div className="report-metric-strip"><div><span>GA4 sessions</span><strong>{metricsLoading ? "—" : totals.sessions.toLocaleString()}</strong><small>Last 28 days</small></div><div><span>Search clicks</span><strong>{metricsLoading ? "—" : totals.clicks.toLocaleString()}</strong><small>Last 28 days</small></div><div><span>Impressions</span><strong>{metricsLoading ? "—" : totals.impressions.toLocaleString()}</strong><small>Search Console</small></div><div><span>Conversions</span><strong>{metricsLoading ? "—" : totals.conversions.toLocaleString()}</strong><small>GA4</small></div></div>
      <div className="report-document-body"><p className="eyebrow">Executive summary</p><h3>{selected.description}</h3><p className="report-document-note">This document combines client records with normalized GA4 and Search Console observations for the last 28 days. Connected metrics synchronize automatically every six hours and can be refreshed on demand from Integrations.</p>{clients.length ? <table><thead><tr><th>Client</th><th>Industry</th><th>Location</th><th>Health score</th><th>GA4 sessions</th><th>Search clicks</th></tr></thead><tbody>{clients.map((client) => { const metrics = reportData.find((report) => report.clientId === client.id); return <tr key={client.id}><td><strong>{client.name}</strong></td><td>{client.industry}</td><td>{client.location}</td><td><strong>{client.health}/100</strong></td><td>{metricsLoading ? "—" : metrics?.analytics?.totals?.sessions?.toLocaleString() ?? "—"}</td><td>{metricsLoading ? "—" : metrics?.searchConsole?.totals?.clicks?.toLocaleString() ?? "—"}</td></tr>; })}</tbody></table> : <div className="report-empty"><h3>{loading ? "Loading live records" : "No client records available"}</h3><p>{loading ? "The report will populate when the data connection finishes." : "Add a client or reconnect Supabase before exporting this report."}</p></div>}</div>
      <footer className="report-document-footer"><span>Torres &amp; Co. Command Center</span><span>Confidential workspace document</span></footer></section>
  </Shell>;
}
