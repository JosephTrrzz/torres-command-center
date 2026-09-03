"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Shell } from "../../components/shell";
import { fetchClient, fetchClients } from "../../lib/supabase-data";
import { ClientDetail } from "../../lib/types";
import { readStoredSession } from "../../lib/supabase-auth";
import { appRoleForOrganizationRole } from "../../lib/access-control";
import { fetchProjects } from "../../lib/projects-api";
import { formatMetricChange, REPORT_METRICS, type ReportMetricKey } from "../../lib/reporting";

type MetricTotals = { analytics?: { totals?: { sessions: number; activeUsers: number; pageViews: number; conversions: number } } | null; searchConsole?: { totals?: { clicks: number; impressions: number } } | null };
type ReportSchedule = { id: string; report_type: string; recipient_email: string; cadence: "weekly" | "monthly"; next_run_at: string; enabled: boolean; last_run_at: string | null };
type ReportData = MetricTotals & { clientId: string; available?: boolean; errors?: string[]; freshness?: { source: "stored" | "live"; syncedAt: string | null }; comparison?: { current: MetricTotals & { range: { startDate: string; endDate: string } }; previous: MetricTotals & { range: { startDate: string; endDate: string } }; coverage: { currentDays: number; previousDays: number } } | null; snapshots?: Array<{ id: string; report_type: string; created_at: string }>; schedules?: ReportSchedule[]; canManageSchedules?: boolean };
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
  const [snapshotState, setSnapshotState] = useState("");
  const [scheduleClientId, setScheduleClientId] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState({ recipientEmail: "", cadence: "monthly", nextRunAt: "" });
  const [scheduleBusy, setScheduleBusy] = useState("");
  const selected = reportDefinitions.find((report) => report.id === selectedId) ?? reportDefinitions[0];
  const averageHealth = useMemo(() => clients.length ? Math.round(clients.reduce((sum, client) => sum + client.health, 0) / clients.length) : null, [clients]);
  const generatedDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date());
  const totals = useMemo(() => reportData.reduce((sum, report) => ({ sessions: sum.sessions + (report.analytics?.totals?.sessions || 0), clicks: sum.clicks + (report.searchConsole?.totals?.clicks || 0), impressions: sum.impressions + (report.searchConsole?.totals?.impressions || 0), conversions: sum.conversions + (report.analytics?.totals?.conversions || 0), connected: sum.connected + (report.available ? 1 : 0) }), { sessions: 0, clicks: 0, impressions: 0, conversions: 0, connected: 0 }), [reportData]);
  const previousTotals = useMemo(() => reportData.reduce((sum, report) => ({ sessions: sum.sessions + (report.comparison?.previous.analytics?.totals?.sessions || 0), clicks: sum.clicks + (report.comparison?.previous.searchConsole?.totals?.clicks || 0), impressions: sum.impressions + (report.comparison?.previous.searchConsole?.totals?.impressions || 0), conversions: sum.conversions + (report.comparison?.previous.analytics?.totals?.conversions || 0) }), { sessions: 0, clicks: 0, impressions: 0, conversions: 0 }), [reportData]);
  const comparisonReady = reportData.some((report) => (report.comparison?.coverage.previousDays || 0) > 0);
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
      setScheduleClientId((current) => loadedClients.some((client) => client.id === current) ? current : loadedClients.find((client) => results.find((report) => report.clientId === client.id)?.available)?.id || loadedClients[0]?.id || "");
    }).catch(() => setError(isCustomer ? "Your tenant-scoped performance data could not be loaded." : "Connect Supabase to load live report data.")).finally(() => { setLoading(false); setMetricsLoading(false); });
  }, []);

  function downloadReport() {
    const rows = clients.map((client) => { const metrics = reportData.find((report) => report.clientId === client.id); return `<tr><td>${client.name}</td><td>${client.industry}</td><td>${client.location}</td><td>${client.health}/100</td><td>${metrics?.analytics?.totals?.sessions ?? "—"}</td><td>${metrics?.searchConsole?.totals?.clicks ?? "—"}</td></tr>`; }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${selected.label} · Torres & Co.</title><style>body{font:15px Arial;color:#18221f;margin:48px}h1{font-size:30px}p{color:#68736e}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{text-align:left;border-bottom:1px solid #ddd;padding:12px}th{color:#68736e;font-size:12px;text-transform:uppercase}</style></head><body><p>TORRES &amp; CO. COMMAND CENTER</p><h1>${selected.label}</h1><p>Prepared ${generatedDate} · ${clients.length} client records</p><h2>Executive summary</h2><p>${selected.description}</p><p>GA4 sessions: ${totals.sessions} · Search clicks: ${totals.clicks}</p><table><thead><tr><th>Client</th><th>Industry</th><th>Location</th><th>Health</th><th>GA4 sessions</th><th>Search clicks</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([html], { type: "text/html" })); link.download = `${selected.id}-report.html`; link.click(); URL.revokeObjectURL(link.href);
  }

  async function saveSnapshot() {
    const session = readStoredSession();
    const eligibleClients = clients.filter((client) => reportData.find((report) => report.clientId === client.id)?.available);
    if (!session || !eligibleClients.length) return;
    setSnapshotState("Saving trusted snapshot…");
    try {
      const responses = await Promise.all(eligibleClients.map((client) => fetch("/api/reports", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, reportType: selected.id }) })));
      const failed = responses.find((response) => !response.ok);
      if (failed) { const body = await failed.json().catch(() => null) as { error?: string } | null; throw new Error(body?.error || "The snapshot could not be saved."); }
      setSnapshotState(`${eligibleClients.length === 1 ? "Snapshot" : `${eligibleClients.length} snapshots`} saved with current calculations.`);
    } catch (reason) { setSnapshotState(reason instanceof Error ? reason.message : "The snapshot could not be saved."); }
  }

  async function changeSchedule(input: Record<string, unknown>) {
    const session = readStoredSession();
    if (!session || !scheduleClientId) return;
    setScheduleBusy(String(input.action || "schedule"));
    setSnapshotState("");
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ clientId: scheduleClientId, reportType: selected.id, ...input }) });
      const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
      if (!response.ok) throw new Error(body?.error || "The schedule could not be updated.");
      const refreshed = await fetch(`/api/reports?client=${encodeURIComponent(scheduleClientId)}`, { cache: "no-store", headers: { Authorization: `Bearer ${session.access_token}` } });
      if (refreshed.ok) { const next = await refreshed.json() as ReportData; setReportData((current) => current.map((report) => report.clientId === scheduleClientId ? next : report)); }
      setSnapshotState(body?.message || "Scheduled delivery updated.");
      return true;
    } catch (reason) { setSnapshotState(reason instanceof Error ? reason.message : "The schedule could not be updated."); return false; }
    finally { setScheduleBusy(""); }
  }

  async function createSchedule(event: FormEvent) {
    event.preventDefault();
    const created = await changeSchedule({ action: "create_schedule", recipientEmail: scheduleDraft.recipientEmail, cadence: scheduleDraft.cadence, nextRunAt: new Date(scheduleDraft.nextRunAt).toISOString() });
    if (created) setScheduleDraft({ recipientEmail: "", cadence: "monthly", nextRunAt: "" });
  }

  async function toggleSchedule(schedule: ReportSchedule) {
    if (!schedule.enabled && window.prompt("Type ENABLE to begin recurring email delivery.") !== "ENABLE") { setSnapshotState("Scheduled delivery remains disabled."); return; }
    await changeSchedule({ action: "set_schedule_enabled", scheduleId: schedule.id, confirmation: schedule.enabled ? "DISABLE" : "ENABLE" });
  }

  return <Shell active="Reports">
    <div className="page-heading"><div><p className="eyebrow">{clientView ? "Private performance" : "Reporting studio"}</p><h1>{clientView ? "Performance" : "Reports"}</h1><p className="lede">{clientView ? "A private, evidence-backed view of your connected website and search performance." : "Review live performance evidence before printing or exporting it for a client or leadership meeting."}</p></div><div className="report-actions"><button className="button button-light" onClick={saveSnapshot} disabled={!totals.connected || snapshotState.startsWith("Saving")}>Save snapshot</button><button className="button button-light" onClick={() => window.print()} disabled={!clients.length}>Print / Save PDF</button><button className="button button-dark" onClick={downloadReport} disabled={!clients.length}>Download report <span>↓︎</span></button></div></div>
    {snapshotState && <p className="integration-notice" role="status">{snapshotState}</p>}
    {error && <p className="integration-notice">{error}</p>}
    <section className="report-grid" aria-label="Report types">{reportDefinitions.map((report, index) => <button className={`report-card ${selectedId === report.id ? "selected" : ""}`} key={report.id} onClick={() => setSelectedId(report.id)}><span className="eyebrow">Report 0{index + 1}</span><h2>{report.label}</h2><p>{report.description}</p><strong>Preview report →︎</strong></button>)}</section>
    {reportData.some((report) => report.canManageSchedules) && <section className="report-delivery" aria-labelledby="report-delivery-heading"><header><div><p className="eyebrow">Scheduled delivery</p><h2 id="report-delivery-heading">Deliver trusted reports automatically.</h2><p>New schedules are saved disabled. Enable one only after reviewing the recipient and first delivery time.</p></div><span>Tracked by Resend</span></header><form onSubmit={createSchedule}><label>Client<select required value={scheduleClientId} onChange={(event) => setScheduleClientId(event.target.value)}>{clients.filter((client) => reportData.find((report) => report.clientId === client.id)?.available).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label>Recipient email<input required type="email" value={scheduleDraft.recipientEmail} onChange={(event) => setScheduleDraft((current) => ({ ...current, recipientEmail: event.target.value }))} /></label><label>Cadence<select value={scheduleDraft.cadence} onChange={(event) => setScheduleDraft((current) => ({ ...current, cadence: event.target.value }))}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label>First delivery<input required type="datetime-local" value={scheduleDraft.nextRunAt} onChange={(event) => setScheduleDraft((current) => ({ ...current, nextRunAt: event.target.value }))} /></label><button className="button button-dark" disabled={Boolean(scheduleBusy)}>{scheduleBusy === "create_schedule" ? "Saving…" : "Save disabled schedule"}</button></form><div className="report-schedule-list">{(reportData.find((report) => report.clientId === scheduleClientId)?.schedules || []).map((schedule) => <article key={schedule.id}><div><strong>{reportDefinitions.find((report) => report.id === schedule.report_type)?.label || "Report"}</strong><span>{schedule.recipient_email}</span><small>{schedule.cadence === "weekly" ? "Weekly" : "Monthly"} · Next {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(schedule.next_run_at))}</small></div><b className={schedule.enabled ? "is-enabled" : ""}>{schedule.enabled ? "Enabled" : "Disabled"}</b><button type="button" onClick={() => void toggleSchedule(schedule)} disabled={Boolean(scheduleBusy)}>{schedule.enabled ? "Disable" : "Enable"}</button><button type="button" onClick={() => window.confirm("Archive this schedule? It will remain in delivery history.") && void changeSchedule({ action: "archive_schedule", scheduleId: schedule.id })} disabled={Boolean(scheduleBusy)}>Archive</button></article>)}{!(reportData.find((report) => report.clientId === scheduleClientId)?.schedules || []).length && <p>No schedules for this client yet.</p>}</div></section>}
    <section className="report-document" aria-label="Report preview"><header className="report-document-header"><div><p className="eyebrow">Torres &amp; Co. Technology</p><h2>{selected.label}</h2><p>Prepared {generatedDate}</p></div><span className="report-document-mark">TC</span></header>
      <div className="report-document-summary"><div><span>Client records</span><strong>{loading ? "—" : clients.length}</strong><small>Live Supabase records</small></div><div><span>Average health</span><strong>{averageHealth === null ? "—" : `${averageHealth}/100`}</strong><small>Across loaded clients</small></div><div><span>Data status</span><strong>{loading || metricsLoading ? "Loading" : totals.connected ? "Current" : "Needs setup"}</strong><small>{totals.connected ? `Last synchronized ${freshnessLabel}` : "Connect a reporting property"}</small></div></div>
      <div className="report-metric-strip">{(["sessions", "clicks", "impressions", "conversions"] as ReportMetricKey[]).map((key) => <div key={key}><span>{REPORT_METRICS[key].label}</span><strong>{metricsLoading ? "—" : totals[key].toLocaleString()}</strong><small>{comparisonReady ? formatMetricChange(totals[key], previousTotals[key]) : "Previous period collecting"}</small></div>)}</div>
      <div className="report-document-body"><p className="eyebrow">Executive summary</p><h3>{selected.description}</h3><p className="report-document-note">This document combines client records with normalized GA4 and Search Console observations for the last 28 days. Connected metrics synchronize automatically every six hours and can be refreshed on demand from Integrations.</p>{clients.length ? <table><thead><tr><th>Client</th><th>Industry</th><th>Location</th><th>Health score</th><th>GA4 sessions</th><th>Search clicks</th></tr></thead><tbody>{clients.map((client) => { const metrics = reportData.find((report) => report.clientId === client.id); return <tr key={client.id}><td><strong>{client.name}</strong></td><td>{client.industry}</td><td>{client.location}</td><td><strong>{client.health}/100</strong></td><td>{metricsLoading ? "—" : metrics?.analytics?.totals?.sessions?.toLocaleString() ?? "—"}</td><td>{metricsLoading ? "—" : metrics?.searchConsole?.totals?.clicks?.toLocaleString() ?? "—"}</td></tr>; })}</tbody></table> : <div className="report-empty"><h3>{loading ? "Loading live records" : "No client records available"}</h3><p>{loading ? "The report will populate when the data connection finishes." : "Add a client or reconnect Supabase before exporting this report."}</p></div>}</div>
      <section className="report-methodology" aria-labelledby="report-methodology-heading"><div><p className="eyebrow">Transparent calculations</p><h3 id="report-methodology-heading">How these numbers are calculated</h3><p>Each total uses daily provider observations for the latest complete 28 days, ending yesterday. Comparisons use the 28 days immediately before that. Partial prior-period data is labeled until all 28 days are stored.</p></div><dl>{Object.entries(REPORT_METRICS).map(([key, metric]) => <div key={key}><dt>{metric.label}<small>{metric.source}</small></dt><dd>{metric.definition}</dd></div>)}</dl></section>
      <footer className="report-document-footer"><span>Torres &amp; Co. Command Center</span><span>Confidential workspace document</span></footer></section>
  </Shell>;
}
