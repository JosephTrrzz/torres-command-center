"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "../../components/shell";
import { fetchClients } from "../../lib/supabase-data";
import { ClientDetail } from "../../lib/types";

const reportDefinitions = [
  { id: "portfolio", label: "Portfolio health", description: "A leadership view of client health scores and account coverage." },
  { id: "performance", label: "Client performance", description: "A client-by-client review of current health and connected evidence." },
  { id: "opportunities", label: "SEO opportunities", description: "A prioritized workspace for opportunities returned by connected sources." },
];

export default function ReportsPage() {
  const [selectedId, setSelectedId] = useState("portfolio");
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const selected = reportDefinitions.find((report) => report.id === selectedId) ?? reportDefinitions[0];
  const averageHealth = useMemo(() => clients.length ? Math.round(clients.reduce((sum, client) => sum + client.health, 0) / clients.length) : null, [clients]);
  const generatedDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date());

  useEffect(() => {
    fetchClients().then(setClients).catch(() => setError("Connect Supabase to load live report data.")).finally(() => setLoading(false));
  }, []);

  function printReport() { window.print(); }

  function downloadReport() {
    const rows = clients.map((client) => `<tr><td>${client.name}</td><td>${client.industry}</td><td>${client.location}</td><td>${client.health}/100</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${selected.label} · Torres & Co.</title><style>body{font:15px Arial;color:#18221f;margin:48px}h1{font-size:30px}p{color:#68736e}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{text-align:left;border-bottom:1px solid #ddd;padding:12px}th{color:#68736e;font-size:12px;text-transform:uppercase}</style></head><body><p>TORRES &amp; CO. COMMAND CENTER</p><h1>${selected.label}</h1><p>Prepared ${generatedDate} · ${clients.length} client records</p><h2>Executive summary</h2><p>${selected.description}</p><p>Average portfolio health: ${averageHealth === null ? "Not available" : `${averageHealth}/100`}</p><table><thead><tr><th>Client</th><th>Industry</th><th>Location</th><th>Health</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    link.download = `${selected.id}-report.html`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return <Shell active="Reports">
    <div className="page-heading"><div><p className="eyebrow">Reporting studio</p><h1>Reports</h1><p className="lede">Review the document before printing or exporting it for a client or leadership meeting.</p></div><div className="report-actions"><button className="button button-light" onClick={printReport} disabled={!clients.length}>Print / Save PDF</button><button className="button button-dark" onClick={downloadReport} disabled={!clients.length}>Download report <span>↓</span></button></div></div>
    {error && <p className="integration-notice">{error}</p>}
    <section className="report-grid" aria-label="Report types">{reportDefinitions.map((report, index) => <button className={`report-card ${selectedId === report.id ? "selected" : ""}`} key={report.id} onClick={() => setSelectedId(report.id)}><span className="eyebrow">Report 0{index + 1}</span><h2>{report.label}</h2><p>{report.description}</p><strong>Preview report →</strong></button>)}</section>
    <section className="report-document" aria-label="Report preview"><header className="report-document-header"><div><p className="eyebrow">Torres &amp; Co. Technology</p><h2>{selected.label}</h2><p>Prepared {generatedDate}</p></div><span className="report-document-mark">TC</span></header><div className="report-document-summary"><div><span>Client records</span><strong>{loading ? "—" : clients.length}</strong><small>Live Supabase records</small></div><div><span>Average health</span><strong>{averageHealth === null ? "—" : `${averageHealth}/100`}</strong><small>Across loaded clients</small></div><div><span>Data status</span><strong>{loading ? "Loading" : error ? "Check" : clients.length ? "Current" : "Empty"}</strong><small>Source connection</small></div></div><div className="report-document-body"><p className="eyebrow">Executive summary</p><h3>{selected.description}</h3><p className="report-document-note">This document is generated from the client records currently available to the Command Center. Provider metrics appear after their integrations are authorized.</p>{clients.length ? <table><thead><tr><th>Client</th><th>Industry</th><th>Location</th><th>Health score</th></tr></thead><tbody>{clients.map((client) => <tr key={client.id}><td><strong>{client.name}</strong></td><td>{client.industry}</td><td>{client.location}</td><td><strong>{client.health}/100</strong></td></tr>)}</tbody></table> : <div className="report-empty"><h3>{loading ? "Loading live records" : "No client records available"}</h3><p>{loading ? "The report will populate when the data connection finishes." : "Add a client or reconnect Supabase before exporting this report."}</p></div>}</div><footer className="report-document-footer"><span>Torres &amp; Co. Command Center</span><span>Confidential workspace document</span></footer></section>
  </Shell>;
}
