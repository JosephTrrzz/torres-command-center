"use client";

import { useState } from "react";
import { Shell } from "../../components/shell";

const integrations = [
  { id: "gbp", name: "Google Business Profile", category: "Reviews & listings", icon: "G", description: "Prepare reviews, rating, business details, hours, calls, and listing health.", proof: "Reviews, rating, profile completeness" },
  { id: "search-console", name: "Google Search Console", category: "Search visibility", icon: "G", description: "Prepare clicks, impressions, search queries, indexing, and ranking opportunities.", proof: "Clicks, impressions, search queries" },
  { id: "analytics", name: "Google Analytics", category: "Traffic", icon: "A", description: "Prepare sessions, users, engagement, conversions, and traffic sources.", proof: "Users, sessions, conversions" },
  { id: "pagespeed", name: "PageSpeed Insights", category: "Website scorecard", icon: "P", description: "Prepare performance, accessibility, SEO, and Core Web Vitals evidence.", proof: "Performance and SEO scores" },
  { id: "cloudflare", name: "Cloudflare", category: "Infrastructure", icon: "C", description: "Monitor uptime, DNS, deployment status, security, and site health.", proof: "Uptime, security, deployment status" },
  { id: "reviews", name: "Review sources", category: "Reputation", icon: "★", description: "Keep a single reputation workspace ready for Google and future review providers.", proof: "Rating trends and response needs" },
];

export default function IntegrationsPage() {
  const [notice, setNotice] = useState("");
  return <Shell active="Integrations">
    <div className="page-heading"><div><p className="eyebrow">Data connections</p><h1>Integrations</h1><p className="lede">Connect the evidence behind every client scorecard.</p></div><span className="status-badge watch">6 sources ready</span></div>
    <section className="integration-banner"><div><p className="eyebrow">Command center data layer</p><h2>Bring verified website signals into one workspace.</h2><p>Each connection can power client scorecards, reports, alerts, and recommendations.</p></div><span className="integration-logo">TC</span></section>
    {notice && <div className="integration-notice" role="status">{notice}</div>}
    <div className="section-heading"><div><p className="eyebrow">Available connections</p><h2>Choose what to connect</h2></div></div>
    <section className="integration-grid">{integrations.map((integration) => <article className="integration-card" key={integration.id}><div className="integration-card-top"><span className="integration-logo">{integration.icon}</span><span className="integration-status">Ready for setup</span></div><div><h3>{integration.name}</h3><p className="integration-category">{integration.category}</p></div><p>{integration.description}</p><small className="integration-proof">Proof: {integration.proof}</small><button className="button button-dark" onClick={() => setNotice(`${integration.name} is ready for authorization. The provider account and client sites can be connected in the next setup step.`)}>Connect source <span>→</span></button></article>)}</section>
    <p className="integration-notice"><strong>Live data note:</strong> these connection points are ready in the product. Provider authorization and API credentials are still required before live metrics can be displayed.</p>
  </Shell>;
}
