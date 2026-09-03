"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandSelect } from "../../components/brand-select";
import { ButtonLoader, LoadingRegion } from "../../components/loading-system";
import { Shell } from "../../components/shell";
import { FeedbackBanner, PageHeader, StatePanel } from "../../components/ui-foundation";
import { checkIntegration, disconnectIntegration, fetchIntegrations, syncIntegration } from "../../lib/integrations-api";
import { integrationScopeLabel, integrationStatusLabel, type IntegrationProvider, type IntegrationsSnapshot } from "../../lib/integrations";
import { readStoredSession } from "../../lib/supabase-auth";
import { fetchClients } from "../../lib/supabase-data";
import type { ClientDetail } from "../../lib/types";

type GoogleProperties = {
  searchConsole: { properties: Array<{ siteUrl: string; permissionLevel?: string }>; error?: string };
  analytics: { properties: Array<{ property: string; displayName?: string; account?: string }>; error?: string };
  businessProfile: { properties: Array<{ name: string; title?: string; storeCode?: string; websiteUri?: string }>; error?: string };
};

const providerMarks: Record<IntegrationProvider, string> = { google: "G", resend: "R", website_intake: "W", supabase: "S", cloudflare: "C" };

function formatGoogleNotice(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("access_denied") || normalized.includes("not verified") || normalized.includes("testing")) return "Google blocked this account because the app is still in Testing. Add the account under Google Cloud →︎ OAuth consent screen →︎ Test users, then try again.";
  return message;
}

function formatDate(value: string | null) {
  if (!value) return "Not checked yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not checked yet";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export default function IntegrationsPage() {
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [snapshot, setSnapshot] = useState<IntegrationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingProvider, setWorkingProvider] = useState<IntegrationProvider | null>(null);
  const [syncingMetrics, setSyncingMetrics] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; title: string; detail: string } | null>(null);
  const [googleProperties, setGoogleProperties] = useState<GoogleProperties | null>(null);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertySelection, setPropertySelection] = useState({ businessProfile: "", searchConsole: "", analytics: "" });

  const selectedClient = useMemo(() => clients.find((client) => client.id === selectedClientId), [clients, selectedClientId]);
  const googleConnection = snapshot?.connections.find((connection) => connection.provider === "google");

  const loadSnapshot = useCallback(async (clientId: string, quiet = false) => {
    const session = readStoredSession();
    if (!session || !clientId) return;
    if (!quiet) setLoading(true);
    try {
      setSnapshot(await fetchIntegrations(session, clientId));
    } catch (error) {
      setSnapshot(null);
      setNotice({ tone: "error", title: "Connections could not load", detail: error instanceof Error ? error.message : "Try refreshing the page." });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    let clientId = query.get("client") || "";
    if (!clientId) {
      try { clientId = window.sessionStorage.getItem("torres-command-center-selected-client") || ""; } catch { /* storage is optional */ }
    }
    setSelectedClientId(clientId);
    if (query.get("connected") === "google") setNotice({ tone: "success", title: "Google connected", detail: "Authorization was saved. Run a connection check, then map this client’s properties." });
    if (query.get("error")) setNotice({ tone: "error", title: "Google could not connect", detail: formatGoogleNotice(query.get("error") || "Google authorization failed.") });
    fetchClients().then((list) => {
      setClients(list);
      if (!clientId && list[0]) setSelectedClientId(list[0].id);
    }).catch(() => setNotice({ tone: "error", title: "Clients could not load", detail: "Refresh the page or sign in again." }));
  }, []);

  useEffect(() => {
    if (selectedClientId) void loadSnapshot(selectedClientId);
    else setLoading(false);
  }, [loadSnapshot, selectedClientId]);

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    setSnapshot(null);
    setGoogleProperties(null);
    setNotice(null);
    try { window.sessionStorage.setItem("torres-command-center-selected-client", clientId); } catch { /* storage is optional */ }
    const url = new URL(window.location.href);
    if (clientId) url.searchParams.set("client", clientId);
    else url.searchParams.delete("client");
    url.searchParams.delete("connected");
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url);
  };

  const connectGoogle = () => {
    if (!selectedClientId) return;
    const session = readStoredSession();
    setWorkingProvider("google");
    void fetch(`/api/google/start?client=${encodeURIComponent(selectedClientId)}`, { headers: { Authorization: `Bearer ${session?.access_token || ""}`, Accept: "application/json" }, credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { authorizationUrl?: string; error?: string };
        if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error || "Google authorization could not be started.");
        window.location.assign(payload.authorizationUrl);
      })
      .catch((error) => {
        setWorkingProvider(null);
        setNotice({ tone: "error", title: "Google could not connect", detail: error instanceof Error ? error.message : "Try again." });
      });
  };

  const runHealthCheck = async (provider: IntegrationProvider) => {
    const session = readStoredSession();
    if (!session || !selectedClientId) return;
    setWorkingProvider(provider);
    setNotice(null);
    try {
      const result = await checkIntegration(session, selectedClientId, provider);
      const providerName = snapshot?.connections.find((item) => item.provider === provider)?.name || "Connection";
      setNotice({ tone: "success", title: `${providerName} checked`, detail: result.message || "Provider health is current." });
      await loadSnapshot(selectedClientId, true);
    } catch (error) {
      setNotice({ tone: "error", title: "Connection check failed", detail: error instanceof Error ? error.message : "Try again." });
    } finally {
      setWorkingProvider(null);
    }
  };

  const runMetricSync = async () => {
    const session = readStoredSession();
    if (!session || !selectedClientId) return;
    setSyncingMetrics(true);
    setNotice(null);
    try {
      const result = await syncIntegration(session, selectedClientId, "google");
      setNotice({ tone: "success", title: "Google metrics synchronized", detail: result.message || "The normalized client snapshot is current." });
      await loadSnapshot(selectedClientId, true);
    } catch (error) {
      setNotice({ tone: "error", title: "Google metrics could not synchronize", detail: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSyncingMetrics(false);
    }
  };

  const disconnectGoogle = async () => {
    if (!window.confirm("Disconnect Google for this client? This removes its authorization and saved property mappings. Reports will stop receiving Google data until it is reconnected.")) return;
    const session = readStoredSession();
    if (!session || !selectedClientId) return;
    setWorkingProvider("google");
    try {
      const result = await disconnectIntegration(session, selectedClientId, "google");
      setGoogleProperties(null);
      setNotice({ tone: "warning", title: "Google disconnected", detail: result.message || "The connection was removed." });
      await loadSnapshot(selectedClientId, true);
    } catch (error) {
      setNotice({ tone: "error", title: "Google could not disconnect", detail: error instanceof Error ? error.message : "Try again." });
    } finally {
      setWorkingProvider(null);
    }
  };

  const discoverGoogleProperties = async () => {
    if (!selectedClientId) return;
    const session = readStoredSession();
    setPropertiesLoading(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/google/properties?client=${encodeURIComponent(selectedClientId)}`, { cache: "no-store", headers: { Authorization: `Bearer ${session?.access_token || ""}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Google properties could not be loaded.");
      setGoogleProperties(payload);
      setNotice({ tone: "success", title: "Google resources discovered", detail: "Choose the resources that belong to this client, then save the mapping." });
    } catch (error) {
      setNotice({ tone: "error", title: "Google resources could not load", detail: error instanceof Error ? error.message : "Try reconnecting Google." });
    } finally {
      setPropertiesLoading(false);
    }
  };

  const saveGoogleProperties = async () => {
    if (!selectedClientId) return;
    const session = readStoredSession();
    setPropertiesLoading(true);
    try {
      const response = await fetch("/api/google/properties", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ clientId: selectedClientId, ...propertySelection }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Google property selections could not be saved.");
      setNotice({ tone: "success", title: "Property mapping saved", detail: "Reports can now use these Google resources during metric refresh." });
      await loadSnapshot(selectedClientId, true);
    } catch (error) {
      setNotice({ tone: "error", title: "Property mapping could not save", detail: error instanceof Error ? error.message : "Try again." });
    } finally {
      setPropertiesLoading(false);
    }
  };

  return <Shell active="Integrations">
    <PageHeader eyebrow="Connection control" title="Integrations" description="See what is connected, verify provider health, and keep every client’s data sources properly scoped." actions={<span className="health-badge healthy">Automated health</span>} className="integrations-page-heading" />
    <section className="integration-controls detail-card"><div><p className="eyebrow">Client scope</p><h2>Connection workspace</h2><p>Client-owned resources stay separate while agency and platform services remain clearly labeled.</p></div><BrandSelect label="Client" onChange={handleClientChange} options={clients.map((client) => ({ value: client.id, label: client.name, description: [client.industry, client.location].filter(Boolean).join(" · ") || "Client account" }))} placeholder="Choose a client" value={selectedClientId} /></section>
    {notice && <FeedbackBanner tone={notice.tone} title={notice.title}><p>{notice.detail}</p></FeedbackBanner>}
    {loading ? <LoadingRegion active label="Loading integration control center" variant="settings" /> : !selectedClientId ? <StatePanel state="empty" title="Choose a client workspace" description="Connections and provider health are always reviewed within an explicit client scope." /> : !snapshot ? <StatePanel state="error" title="Integration control is unavailable" description="Refresh the page or sign in again." /> : <>
      {!snapshot.registryReady && <FeedbackBanner tone="warning" title="Provider history needs its Phase 5 migration"><p>Live configuration is shown below, but health checks cannot be saved until <strong>supabase/integration_control.sql</strong> is applied.</p></FeedbackBanner>}
      <section className="integration-summary" aria-label="Connection summary"><div><span>Connected</span><strong>{snapshot.summary.connected}/{snapshot.connections.length}</strong><small>providers responding</small></div><div><span>Open alerts</span><strong>{snapshot.summary.openAlerts}</strong><small>{snapshot.summary.openAlerts ? "admin action required" : "no unresolved failures"}</small></div><div><span>Checked today</span><strong>{snapshot.summary.checkedRecently}</strong><small>durable health checks</small></div><div><span>Automation</span><strong>{snapshot.summary.automated}/{snapshot.connections.length}</strong><small>six-hour provider checks</small></div></section>
      <FeedbackBanner tone="info" title="Automatic monitoring is active"><p>Provider health is checked every six hours. Connected Google reporting data synchronizes during the same run. An admin alert opens after two consecutive failures and resolves automatically after recovery.</p></FeedbackBanner>
      <div className="section-heading integration-section-heading"><div><p className="eyebrow">Provider registry</p><h2>Connected systems</h2><p>Health is verified on demand and stored without copying provider secrets into this registry.</p></div><button className="button button-light" type="button" onClick={() => void loadSnapshot(selectedClientId)} disabled={loading}>Refresh view <span aria-hidden="true">→︎</span></button></div>
      <section className="integration-control-grid">{snapshot.connections.map((connection) => <article className="integration-control-card" key={connection.provider}>
        <header><span className="integration-provider-mark" aria-hidden="true">{providerMarks[connection.provider]}</span><div><p>{connection.category}</p><h3>{connection.name}</h3></div><span className={`integration-health integration-health-${connection.status}`}><i aria-hidden="true" />{integrationStatusLabel(connection.status)}</span></header>
        <p className="integration-control-description">{connection.description}</p>
        <div className="integration-connection-meta"><span><small>Scope</small><strong>{integrationScopeLabel(connection.scope)}</strong></span><span><small>Last verified</small><strong>{formatDate(connection.lastCheckedAt)}</strong></span><span><small>Next automatic check</small><strong>{connection.automationEnabled ? formatDate(connection.nextCheckAt) : "Paused"}</strong></span>{connection.accountLabel && <span><small>Account</small><strong>{connection.accountLabel}</strong></span>}</div>
        <p className="integration-health-detail">{connection.statusDetail}</p>{connection.alertOpen && <p className="integration-alert-message"><strong>Admin alert open</strong> · {connection.consecutiveFailures} consecutive failed checks</p>}<div className="integration-capabilities">{connection.capabilities.length ? connection.capabilities.map((capability) => <span key={capability}>{capability}</span>) : <span>No resources mapped</span>}<span>{connection.lastTrigger === "scheduled" ? "Last checked automatically" : connection.lastTrigger === "manual" ? "Last checked manually" : "Monitoring ready"}</span></div>
        <footer>{connection.provider === "google" && connection.status === "disconnected" ? <button className="button button-dark" type="button" onClick={connectGoogle} disabled={!snapshot.canManage || workingProvider === "google" || syncingMetrics}>{workingProvider === "google" && <ButtonLoader />}Connect Google <span aria-hidden="true">→︎</span></button> : <button className="button button-light" type="button" onClick={() => void runHealthCheck(connection.provider)} disabled={!snapshot.canManage || !snapshot.registryReady || workingProvider !== null || syncingMetrics}>{workingProvider === connection.provider && <ButtonLoader />}Check connection</button>}{connection.provider === "google" && connection.status === "connected" && <button className="button button-dark" type="button" onClick={() => void runMetricSync()} disabled={!snapshot.canManage || !snapshot.registryReady || workingProvider !== null || syncingMetrics}>{syncingMetrics && <ButtonLoader />}Sync report data</button>}{connection.provider === "google" && connection.status !== "disconnected" && <button className="text-button" type="button" onClick={connectGoogle} disabled={!snapshot.canManage || syncingMetrics}>Reconnect</button>}{connection.canDisconnect && connection.status !== "disconnected" && <button className="text-button danger-link" type="button" onClick={() => void disconnectGoogle()} disabled={!snapshot.canManage || !snapshot.registryReady || workingProvider !== null || syncingMetrics}>Disconnect</button>}</footer>
      </article>)}</section>
      {googleConnection?.status === "connected" && <section className="google-property-panel detail-card"><div className="section-heading"><div><p className="eyebrow">Google resources</p><h2>Map this client’s properties</h2><p>Authorization is confirmed{googleConnection.accountLabel ? ` for ${googleConnection.accountLabel}` : ""}. Only select resources owned by {selectedClient?.name || "this client"}.</p></div><button className="button button-light" type="button" onClick={() => void discoverGoogleProperties()} disabled={propertiesLoading}>{propertiesLoading && <ButtonLoader />}{propertiesLoading ? "Checking" : "Discover properties"}</button></div>{googleProperties && <div className="google-property-grid"><label>Business Profile<select value={propertySelection.businessProfile} onChange={(event) => setPropertySelection({ ...propertySelection, businessProfile: event.target.value })}><option value="">Choose a location</option>{googleProperties.businessProfile.properties.map((property) => <option key={property.name} value={property.name}>{property.title || property.name}{property.websiteUri ? ` · ${property.websiteUri}` : ""}</option>)}</select>{googleProperties.businessProfile.error && <small>{googleProperties.businessProfile.error}</small>}</label><label>Search Console<select value={propertySelection.searchConsole} onChange={(event) => setPropertySelection({ ...propertySelection, searchConsole: event.target.value })}><option value="">Choose a site</option>{googleProperties.searchConsole.properties.map((property) => <option key={property.siteUrl} value={property.siteUrl}>{property.siteUrl}</option>)}</select>{googleProperties.searchConsole.error && <small>{googleProperties.searchConsole.error}</small>}</label><label>Google Analytics<select value={propertySelection.analytics} onChange={(event) => setPropertySelection({ ...propertySelection, analytics: event.target.value })}><option value="">Choose a property</option>{googleProperties.analytics.properties.map((property) => <option key={property.property} value={property.property}>{property.displayName || property.property}{property.account ? ` · ${property.account}` : ""}</option>)}</select>{googleProperties.analytics.error && <small>{googleProperties.analytics.error}</small>}</label><button className="button button-dark" type="button" onClick={() => void saveGoogleProperties()} disabled={propertiesLoading}>Save mapping <span aria-hidden="true">→︎</span></button></div>}</section>}
      <section className="integration-history detail-card"><div className="section-heading"><div><p className="eyebrow">Activity ledger</p><h2>Recent provider activity</h2></div><Link className="text-link" href="/settings/#admin-console">Workspace settings <span aria-hidden="true">→︎</span></Link></div>{snapshot.runs.length ? <div className="integration-run-list">{snapshot.runs.map((run) => <article key={run.id}><span className={`integration-run-mark ${run.status}`} aria-hidden="true" /><div><strong>{snapshot.connections.find((connection) => connection.provider === run.provider)?.name || run.provider}</strong><p>{run.operation === "health_check" ? `${run.trigger === "scheduled" ? "Automatic" : "Manual"} connection check` : run.operation === "metrics_sync" ? `${run.trigger === "scheduled" ? "Automatic" : "Manual"} report sync · ${run.recordsWritten} normalized metrics` : "Provider disconnected"}{run.errorMessage ? ` · ${run.errorMessage}` : ""}</p></div><time dateTime={run.startedAt}>{formatDate(run.startedAt)}</time><b>{run.status === "succeeded" ? "Complete" : "Needs attention"}</b></article>)}</div> : <StatePanel state="empty" title="No provider activity recorded" description="Automatic monitoring will create the first durable record, or run a manual check now." />}</section>
    </>}
  </Shell>;
}
