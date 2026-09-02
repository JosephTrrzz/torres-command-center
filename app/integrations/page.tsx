"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "../../components/shell";
import { BrandSelect } from "../../components/brand-select";
import { fetchClients } from "../../lib/supabase-data";
import { readStoredSession } from "../../lib/supabase-auth";
import { ClientDetail } from "../../lib/types";

type IntegrationDefinition = { id: string; name: string; category: string; icon: string; description: string; proof: string; unlocks: string[]; requirements: string[] };
type GoogleProperties = { searchConsole: { properties: Array<{ siteUrl: string; permissionLevel?: string }>; error?: string }; analytics: { properties: Array<{ property: string; displayName?: string; account?: string }>; error?: string }; businessProfile: { properties: Array<{ name: string; title?: string; storeCode?: string; websiteUri?: string }>; error?: string } };

const integrations: IntegrationDefinition[] = [
  { id: "gbp", name: "Google Business Profile", category: "Reviews & listings", icon: "G", description: "Prepare reviews, rating, business details, hours, calls, and listing health.", proof: "Reviews, rating, profile completeness", unlocks: ["Review response queue", "Profile actions", "Listing completeness"], requirements: ["Verified Google Business Profile", "Manager access for the client location"] },
  { id: "search-console", name: "Google Search Console", category: "Search visibility", icon: "S", description: "Track clicks, impressions, queries, indexing, and technical search opportunities.", proof: "Clicks, impressions, query opportunities", unlocks: ["Clicks and impressions", "Search query opportunities", "Indexing checks"], requirements: ["Verified site property", "Owner or delegated access"] },
  { id: "analytics", name: "Google Analytics", category: "Traffic", icon: "A", description: "Measure sessions, users, engagement, conversions, and the sources producing leads.", proof: "Traffic sources, engagement, conversions", unlocks: ["Traffic source trends", "Engagement and conversions", "Lead source reporting"], requirements: ["GA4 property", "Analyst access"] },
  { id: "pagespeed", name: "PageSpeed Insights", category: "Website scorecard", icon: "P", description: "Check performance, accessibility, SEO, and Core Web Vitals across mobile and desktop.", proof: "Performance, accessibility, SEO, Core Web Vitals", unlocks: ["Performance scorecard", "Core Web Vitals", "Technical SEO checks"], requirements: ["Public website URL", "Mobile and desktop test targets"] },
  { id: "cloudflare", name: "Cloudflare", category: "Infrastructure", icon: "C", description: "Monitor uptime, DNS, deployments, SSL, and the security posture of the website.", proof: "Deployment health, DNS, SSL, security", unlocks: ["Deployment health", "DNS and SSL visibility", "Security posture"], requirements: ["Cloudflare zone or Worker", "Read-only account access"] },
  { id: "reviews", name: "Review sources", category: "Reputation", icon: "R", description: "Create one reputation view for Google and future review providers as the portfolio grows.", proof: "Rating trends, response needs, source coverage", unlocks: ["Rating trends", "Response needs", "Review source coverage"], requirements: ["Review provider access", "Location or profile mapping"] },
  { id: "square", name: "Square payments", category: "Billing & payments", icon: "$", description: "Prepare customer-linked checkout, invoices, and payment status for Torres & Co. services.", proof: "Payment status, invoices, subscription state", unlocks: ["Customer-linked billing view", "Payment status tracking", "Invoice and subscription readiness"], requirements: ["Square Developer account", "Business owner authorization", "Server-side webhooks for status updates"] },
];

const readinessKey = "torres-command-center-integration-readiness";

function formatGoogleNotice(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("access_denied") || normalized.includes("not verified") || normalized.includes("testing")) {
    return "Google blocked this account because the app is still in Testing. Choose one of the accounts listed under Google Cloud →︎ OAuth consent screen →︎ Test users, then try again.";
  }
  return message;
}

export default function IntegrationsPage() {
  const [notice, setNotice] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [clientList, setClientList] = useState<ClientDetail[]>([]);
  const [activeIntegration, setActiveIntegration] = useState<IntegrationDefinition | null>(null);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleProperties, setGoogleProperties] = useState<GoogleProperties | null>(null);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesMessage, setPropertiesMessage] = useState("");
  const [propertySelection, setPropertySelection] = useState({ businessProfile: "", searchConsole: "", analytics: "" });

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    setNotice("");
    try { window.sessionStorage.setItem("torres-command-center-selected-client", clientId); } catch { /* browser storage may be unavailable */ }
    const url = new URL(window.location.href);
    if (clientId) url.searchParams.set("client", clientId);
    else url.searchParams.delete("client");
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url);
  };

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    let clientId = query.get("client") ?? "";
    if (!clientId) {
      try { clientId = window.sessionStorage.getItem("torres-command-center-selected-client") ?? ""; } catch { /* browser storage may be unavailable */ }
    }
    setSelectedClientId(clientId);
    if (query.get("connected") === "google") setNotice("Google was connected for this client.");
    if (query.get("error")) setNotice(formatGoogleNotice(query.get("error") ?? "Unable to connect Google."));
    try { setReady(JSON.parse(window.localStorage.getItem(readinessKey) ?? "{}")); } catch { setReady({}); }
    fetchClients().then(setClientList).catch(() => setClientList([]));
  }, []);

  useEffect(() => {
    if (!selectedClientId) {
      setGoogleConnected(false);
      setGoogleEmail("");
      return;
    }
    let active = true;
    setGoogleLoading(true);
    setGoogleProperties(null);
    const session = readStoredSession();
    fetch(`/api/google/status?client=${encodeURIComponent(selectedClientId)}`, { cache: "no-store", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } })
      .then((response) => response.ok ? response.json() : { connected: false })
      .then((status: { connected?: boolean; googleEmail?: string }) => {
        if (!active) return;
        setGoogleConnected(Boolean(status.connected));
        setGoogleEmail(status.googleEmail || "");
      })
      .catch(() => { if (active) setGoogleConnected(false); })
      .finally(() => { if (active) setGoogleLoading(false); });
    return () => { active = false; };
  }, [selectedClientId]);

  const discoverGoogleProperties = async () => {
    if (!selectedClientId) return;
    setPropertiesLoading(true);
    setPropertiesMessage("");
    try {
      const session = readStoredSession();
      const response = await fetch(`/api/google/properties?client=${encodeURIComponent(selectedClientId)}`, { cache: "no-store", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Google properties could not be loaded.");
      setGoogleProperties(payload);
      setPropertiesMessage("Google properties loaded. Choose the resources that belong to this client, then save the mapping.");
    } catch (error) {
      setPropertiesMessage(error instanceof Error ? error.message : "Google properties could not be loaded.");
    } finally {
      setPropertiesLoading(false);
    }
  };

  const saveGoogleProperties = async () => {
    if (!selectedClientId) return;
    setPropertiesLoading(true);
    try {
      const session = readStoredSession();
      const response = await fetch("/api/google/properties", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` }, body: JSON.stringify({ clientId: selectedClientId, ...propertySelection }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Google property selections could not be saved.");
      setPropertiesMessage("Google property mapping saved. Reports can use these resources after metric sync is enabled.");
    } catch (error) {
      setPropertiesMessage(error instanceof Error ? error.message : "Google property selections could not be saved.");
    } finally {
      setPropertiesLoading(false);
    }
  };

  const selectedClient = useMemo(() => clientList.find((client) => client.id === selectedClientId), [clientList, selectedClientId]);
  const readyCount = integrations.filter((integration) => ready[`${selectedClientId}:${integration.id}`]).length;

  const markReady = () => {
    if (!activeIntegration || !selectedClientId) return;
    const key = `${selectedClientId}:${activeIntegration.id}`;
    const next = { ...ready, [key]: true };
    setReady(next);
    window.localStorage.setItem(readinessKey, JSON.stringify(next));
    setNotice(`${activeIntegration.name} is marked ready for ${selectedClient?.name ?? "this client"}. Live provider authorization is still required before data appears.`);
    setActiveIntegration(null);
  };
  const connectGoogle = () => {
    if (!selectedClientId) { setNotice("Choose a client first so Google is connected to the correct account."); return; }
    const session = readStoredSession();
    void fetch(`/api/google/start?client=${encodeURIComponent(selectedClientId)}`, { headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, Accept: "application/json" }, credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { authorizationUrl?: string; error?: string };
        if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error || "Google authorization could not be started.");
        window.location.assign(payload.authorizationUrl);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "Google authorization could not be started."));
  };

  return <Shell active="Integrations">
      <div className="page-heading integrations-page-heading"><div><p className="eyebrow">Data connections</p><h1>Integrations</h1><p className="lede">Organize the proof behind every client website, campaign, and growth recommendation.</p></div><span className="health-badge watch">{selectedClient ? `${readyCount}/${integrations.length} prepared` : "Choose a client"}</span></div>
    <section className="integration-banner"><div><p className="eyebrow">Torres & Co. evidence layer</p><h2>One setup hub for every client connection.</h2><p>Prepare the accounts and permissions that turn dashboard estimates into verified business results. Provider authorization is kept separate until each connection is approved.</p></div><div className="integration-logo">TC</div></section>
    <section className="integration-controls detail-card">
      <div>
        <p className="eyebrow">Client scope</p>
        <h2>Whose connections are you preparing?</h2>
        <p>Readiness is tracked per client so accounts never get mixed together.</p>
      </div>
      <BrandSelect
        label="Client"
        onChange={handleClientChange}
        options={clientList.map((client) => ({
          value: client.id,
          label: client.name,
          description:
            [client.industry, client.location].filter(Boolean).join(" · ") ||
            "Client account",
        }))}
        placeholder="Choose a client"
        value={selectedClientId}
      />
    </section>
    <div className="integration-summary"><div><span>Prepared</span><strong>{selectedClient ? readyCount : "—"}</strong><small>connections ready for review</small></div><div><span>Available</span><strong>{integrations.length}</strong><small>connection types</small></div><div><span>Live data</span><strong>{googleLoading ? "Checking" : googleConnected ? "On" : "Off"}</strong><small>{googleConnected ? `Google${googleEmail ? ` · ${googleEmail}` : ""} connected` : "authorization still required"}</small></div></div>
    {notice && <p className="integration-notice">{notice}</p>}
    {selectedClient && googleConnected && <section className="google-property-panel detail-card"><div className="section-heading"><div><p className="eyebrow">Google resources</p><h2>Choose the properties for this client</h2><p>Authorization is confirmed for {googleEmail || "this account"}. Select the matching resources before metrics are added to Reports.</p></div><button className="button button-light" type="button" onClick={discoverGoogleProperties} disabled={propertiesLoading}>{propertiesLoading ? "Checking…" : "Discover properties"}</button></div>{propertiesMessage && <p className="integration-notice">{propertiesMessage}</p>}{googleProperties && <div className="google-property-grid"><label>Business Profile<select value={propertySelection.businessProfile} onChange={(event) => setPropertySelection({ ...propertySelection, businessProfile: event.target.value })}><option value="">Choose a location</option>{googleProperties.businessProfile.properties.map((property) => <option key={property.name} value={property.name}>{property.title || property.name}{property.websiteUri ? ` · ${property.websiteUri}` : ""}</option>)}</select>{googleProperties.businessProfile.error && <small>{googleProperties.businessProfile.error}</small>}</label><label>Search Console<select value={propertySelection.searchConsole} onChange={(event) => setPropertySelection({ ...propertySelection, searchConsole: event.target.value })}><option value="">Choose a site</option>{googleProperties.searchConsole.properties.map((property) => <option key={property.siteUrl} value={property.siteUrl}>{property.siteUrl}</option>)}</select>{googleProperties.searchConsole.error && <small>{googleProperties.searchConsole.error}</small>}</label><label>Google Analytics<select value={propertySelection.analytics} onChange={(event) => setPropertySelection({ ...propertySelection, analytics: event.target.value })}><option value="">Choose a property</option>{googleProperties.analytics.properties.map((property) => <option key={property.property} value={property.property}>{property.displayName || property.property}{property.account ? ` · ${property.account}` : ""}</option>)}</select>{googleProperties.analytics.error && <small>{googleProperties.analytics.error}</small>}</label><button className="button button-dark" type="button" onClick={saveGoogleProperties} disabled={propertiesLoading}>Save property mapping <span>→︎</span></button></div>}</section>}
    <div className="section-heading"><div><p className="eyebrow">Connection catalog</p><h2>Choose what to set up next</h2></div><Link className="button button-light" href="/clients/">View clients <span>→︎</span></Link></div>
    <div className="integration-grid">{integrations.map((integration) => { const isReady = Boolean(ready[`${selectedClientId}:${integration.id}`]); const isGoogle = ["gbp", "search-console", "analytics"].includes(integration.id); const status = isGoogle && googleConnected ? "Connected" : isReady ? "Prepared" : "Not connected"; return <article className="integration-card" key={integration.id}><div className="integration-card-top"><div><div className="integration-logo">{integration.icon}</div><p className="integration-category">{integration.category}</p></div><span className={`integration-status${status === "Connected" ? " integration-status-connected" : ""}`}>{status}</span></div><h3>{integration.name}</h3><p>{integration.description}</p><div className="integration-proof"><strong>Proof:</strong> {integration.proof}</div><div className="integration-unlocks">{integration.unlocks.map((item) => <span key={item}>{item}</span>)}</div><div className="integration-card-actions"><button className="button button-light" type="button" onClick={() => selectedClientId ? setActiveIntegration(integration) : setNotice("Choose a client first so this connection is scoped correctly.")}>{selectedClientId ? (isReady ? "Review setup" : "Prepare connection") : "Choose client"} <span>→︎</span></button>{isGoogle && <button className="text-button integration-connect" type="button" onClick={googleConnected ? () => setNotice(`Google is connected for ${googleEmail || "this client"}.`) : connectGoogle}>{googleConnected ? "Google connected" : "Connect Google"}</button>}</div></article>; })}</div>
    <p className="integration-notice">This catalog prepares the workflow and explains what each provider will supply. It does not claim live Google, Cloudflare, or review data until the provider authorization step is completed.</p>
    {activeIntegration && <div className="modal-backdrop" role="presentation" onClick={() => setActiveIntegration(null)}><section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label="Close" onClick={() => setActiveIntegration(null)}>×</button><p className="eyebrow">Connection setup</p><h2 id="setup-title">{activeIntegration.name}</h2><p>{activeIntegration.description}</p><div className="setup-modal-grid"><div><span>Client</span><strong>{selectedClient?.name}</strong></div><div><span>Status</span><strong>{ready[`${selectedClientId}:${activeIntegration.id}`] ? "Prepared" : "Not connected"}</strong></div></div><h3>What this unlocks</h3><ul>{activeIntegration.unlocks.map((item) => <li key={item}>{item}</li>)}</ul><h3>Before authorization</h3><ul>{activeIntegration.requirements.map((item) => <li key={item}>{item}</li>)}</ul><div className="modal-actions"><button className="button button-light" type="button" onClick={() => setActiveIntegration(null)}>Cancel</button><button className="button button-dark" type="button" onClick={markReady}>Mark ready for authorization <span>→︎</span></button></div></section></div>}
  </Shell>;
}
