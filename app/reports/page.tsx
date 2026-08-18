"use client";
import { useState } from "react";
import { Shell } from "../../components/shell";

export default function ReportsPage() {
  const [selected, setSelected] = useState("Portfolio health");
  function download() {
    const blob = new Blob(["Torres & Co. Command Center\nPortfolio health: 91/100\nClients monitored: 3\nOpen opportunities: 12\n"], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "torres-command-center-summary.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return <Shell active="Reports"><div className="page-heading"><div><p className="eyebrow">Workspace</p><h1>Reports</h1><p className="lede">Review and export the latest portfolio summaries.</p></div><button className="button button-dark" onClick={download}>Export summary</button></div><section className="report-grid">{["Portfolio health", "Client performance", "SEO opportunities"].map((report, i) => <button className={`report-card ${selected === report ? "selected" : ""}`} key={report} onClick={() => setSelected(report)}><span className="eyebrow">Report 0{i + 1}</span><h2>{report}</h2><p>{i === 0 ? "91/100 overall health across your managed accounts." : i === 1 ? "Compare traffic, health, and account activity." : "12 opportunities are ready for review."}</p><strong>Open report →</strong></button>)}</section><section className="detail-card report-preview"><p className="eyebrow">Selected report</p><h2>{selected}</h2><p>This report workspace is ready for live Google and Cloudflare data when those integrations are connected.</p><button className="button button-outline" onClick={download}>Download snapshot</button></section></Shell>;
}
