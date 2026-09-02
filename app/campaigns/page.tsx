"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { BrandSelect } from "../../components/brand-select";
import { Shell } from "../../components/shell";
import { changeMarketing, fetchMarketing } from "../../lib/marketing-api";
import {
  CAMPAIGN_TYPES,
  campaignCanSend,
  labelMarketingValue,
  type CampaignType,
  type MarketingCampaign,
  type MarketingSnapshot,
} from "../../lib/marketing";
import { readStoredSession } from "../../lib/supabase-auth";
import { fetchClients } from "../../lib/supabase-data";
import type { AuthSession, ClientDetail } from "../../lib/types";

const emptyDraft = {
  campaignType: "announcement" as CampaignType,
  name: "",
  subject: "",
  previewText: "",
  body: "",
  reviewUrl: "",
  serviceJobId: "",
  consentBasis: "business_relationship",
  contactIds: [] as string[],
};

function dateLabel(value: string | null) {
  if (!value) return "Not sent";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function recipientSummary(campaign: MarketingCampaign) {
  const counts = campaign.recipients.reduce<Record<string, number>>((summary, recipient) => {
    summary[recipient.status] = (summary[recipient.status] || 0) + 1;
    return summary;
  }, {});
  return Object.entries(counts).map(([status, count]) => `${count} ${labelMarketingValue(status)}`).join(" · ") || "No recipients";
}

export default function CampaignsPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [snapshot, setSnapshot] = useState<MarketingSnapshot | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [draft, setDraft] = useState(emptyDraft);
  const [composerOpen, setComposerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedCampaign = useMemo(() => snapshot?.campaigns.find((campaign) => campaign.id === selectedCampaignId) || snapshot?.campaigns[0] || null, [selectedCampaignId, snapshot]);
  const eligibleContacts = snapshot?.contacts.filter((contact) => contact.email && !contact.suppressed) || [];

  async function loadWorkspace(activeSession: AuthSession, clientId: string) {
    setLoading(true);
    setError("");
    try {
      const next = await fetchMarketing(activeSession, clientId);
      const requestedCampaign = new URLSearchParams(window.location.search).get("campaign") || "";
      setSnapshot(next);
      setSelectedCampaignId((current) => next.campaigns.some((campaign) => campaign.id === requestedCampaign)
        ? requestedCampaign
        : next.campaigns.some((campaign) => campaign.id === current)
          ? current
          : next.campaigns[0]?.id || "");
    } catch (loadError) {
      setSnapshot(null);
      setError(loadError instanceof Error ? loadError.message : "The Campaigns workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) {
      setLoading(false);
      return;
    }
    setSession(stored);
    void fetchClients().then((rows) => {
      setClients(rows);
      const requested = new URLSearchParams(window.location.search).get("client") || "";
      const initial = rows.some((client) => client.id === requested) ? requested : rows[0]?.id || "";
      setSelectedClientId(initial);
      if (initial) void loadWorkspace(stored, initial);
      else setLoading(false);
    }).catch(() => {
      setLoading(false);
      setError("Client workspaces could not be loaded.");
    });
  }, []);

  function chooseClient(clientId: string) {
    if (!session) return;
    setSelectedClientId(clientId);
    setMessage("");
    setComposerOpen(false);
    setDraft(emptyDraft);
    const url = new URL(window.location.href);
    url.searchParams.set("client", clientId);
    url.searchParams.delete("campaign");
    window.history.replaceState({}, "", url);
    void loadWorkspace(session, clientId);
  }

  function chooseCampaign(campaignId: string) {
    setSelectedCampaignId(campaignId);
    const url = new URL(window.location.href);
    url.searchParams.set("campaign", campaignId);
    window.history.replaceState({}, "", url);
  }

  async function mutate(label: string, input: Record<string, unknown>) {
    if (!session || !snapshot) return null;
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const response = await changeMarketing(session, { clientId: snapshot.client.id || selectedClientId, ...input });
      if (response.snapshot) {
        setSnapshot(response.snapshot);
        setSelectedCampaignId((current) => response.snapshot?.campaigns.some((campaign) => campaign.id === current) ? current : response.snapshot?.campaigns[0]?.id || "");
      }
      setMessage(response.message || "Campaign workspace updated.");
      return response.snapshot || null;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "That campaign action could not be completed.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    const next = await mutate("create", { action: "create_campaign", ...draft });
    if (next) {
      setDraft(emptyDraft);
      setComposerOpen(false);
      setSelectedCampaignId(next.campaigns[0]?.id || "");
    }
  }

  async function sendCampaign(campaign: MarketingCampaign) {
    const confirmation = window.prompt(`Send “${campaign.name}” to ${campaign.recipients.filter((recipient) => recipient.status === "pending").length} eligible recipient(s)? Type SEND to confirm.`);
    if (confirmation !== "SEND") {
      setMessage("Campaign delivery canceled. No email was sent.");
      return;
    }
    await mutate("send", { action: "send_campaign", campaignId: campaign.id, confirmation });
  }

  return <Shell active="Campaigns">
    <div className="page-heading marketing-heading">
      <div>
        <p className="eyebrow">Communications</p>
        <h1>Campaigns</h1>
        <p className="lede">Create careful client updates, newsletters, and review requests with recipient consent and delivery history attached.</p>
      </div>
      {clients.length > 0 && <BrandSelect label="Client" value={selectedClientId} onChange={chooseClient} options={clients.map((client) => ({ value: client.id, label: client.name, description: [client.industry, client.location].filter(Boolean).join(" · ") || "Client workspace" }))} />}
    </div>

    {error && <p className="integration-notice marketing-error" role="alert">{error}</p>}
    {message && <p className="integration-notice marketing-success" role="status">{message}</p>}

    {loading ? <section className="marketing-loading"><strong>Loading campaigns…</strong><span>Checking contacts, consent, delivery, and completed service records.</span></section> : !snapshot ? <section className="empty-state"><h2>Campaigns workspace unavailable</h2><p>Choose a client or apply the Phase 4 marketing migration.</p></section> : <>
      <section className="marketing-summary" aria-label="Campaign summary">
        <div><span>Drafts</span><strong>{snapshot.summary.drafts}</strong><small>Waiting for review</small></div>
        <div><span>Sent</span><strong>{snapshot.summary.sentCampaigns}</strong><small>Completed campaigns</small></div>
        <div><span>Eligible</span><strong>{snapshot.summary.eligibleContacts}</strong><small>Contacts with email</small></div>
        <div><span>Delivered</span><strong>{snapshot.summary.deliveredRecipients}</strong><small>Provider confirmed</small></div>
        <div className={snapshot.summary.suppressedContacts ? "attention" : ""}><span>Suppressed</span><strong>{snapshot.summary.suppressedContacts}</strong><small>Never included in sends</small></div>
      </section>

      <section className={`marketing-readiness ${snapshot.delivery === "ready" ? "is-ready" : ""}`}>
        <span aria-hidden="true">{snapshot.delivery === "ready" ? "✓" : "!"}</span>
        <div><strong>{snapshot.delivery === "ready" ? "Email delivery is ready" : "Email delivery needs configuration"}</strong><p>{snapshot.delivery === "ready" ? "Resend is available. Always send a test and review recipients before delivery." : "Drafts are safe to create, but campaigns cannot be sent until Resend is configured in Cloudflare."}</p></div>
        {snapshot.canManage && <button type="button" className="button" onClick={() => setComposerOpen((open) => !open)}>{composerOpen ? "Close composer" : "+ New campaign"}</button>}
      </section>

      {composerOpen && snapshot.canManage && <form className="marketing-composer" onSubmit={createCampaign}>
        <div className="marketing-section-heading"><div><p className="eyebrow">New draft</p><h2>Build the message before you send.</h2><p>No email leaves the system while this form is being completed.</p></div><span>Draft only</span></div>
        <div className="marketing-form-grid">
          <label>Campaign type<select value={draft.campaignType} onChange={(event) => setDraft((current) => ({ ...current, campaignType: event.target.value as CampaignType }))}>{CAMPAIGN_TYPES.map((type) => <option key={type} value={type}>{labelMarketingValue(type)}</option>)}</select></label>
          <label>Internal name<input required maxLength={140} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="September client update" /></label>
          <label className="form-field-full">Email subject<input required maxLength={998} value={draft.subject} onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} placeholder="A clear, specific subject line" /></label>
          <label className="form-field-full">Preview text<input maxLength={240} value={draft.previewText} onChange={(event) => setDraft((current) => ({ ...current, previewText: event.target.value }))} placeholder="Short inbox preview shown after the subject" /></label>
          <label className="form-field-full">Message<textarea required maxLength={12000} value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} placeholder="Write the client update in plain language…" /></label>
          {draft.campaignType === "review_request" && <label className="form-field-full">Review link<input required type="url" value={draft.reviewUrl} onChange={(event) => setDraft((current) => ({ ...current, reviewUrl: event.target.value }))} placeholder="https://g.page/r/…/review" /></label>}
          <label>Consent basis<select value={draft.consentBasis} onChange={(event) => setDraft((current) => ({ ...current, consentBasis: event.target.value }))}><option value="business_relationship">Existing business relationship</option><option value="explicit_opt_in">Explicit opt-in</option></select><small>Only choose a basis you can support. Unsubscribed contacts are always excluded.</small></label>
          <label>Completed service job<select value={draft.serviceJobId} onChange={(event) => setDraft((current) => ({ ...current, serviceJobId: event.target.value }))}><option value="">No linked job</option>{snapshot.completedJobs.map((job) => <option key={job.id} value={job.id}>{job.job_number} · {job.title}</option>)}</select><small>Recommended for review requests so the request is tied to delivered work.</small></label>
        </div>

        <fieldset className="marketing-contact-fieldset">
          <legend>Recipients <span>{draft.contactIds.length} selected</span></legend>
          <p>Select only people who should receive this message. Suppressed and missing-email contacts cannot be selected.</p>
          <div className="marketing-contact-grid">
            {snapshot.contacts.length ? snapshot.contacts.map((contact) => {
              const disabled = !contact.email || contact.suppressed;
              return <label className={disabled ? "is-disabled" : ""} key={contact.id}>
                <input type="checkbox" checked={draft.contactIds.includes(contact.id)} disabled={disabled} onChange={(event) => setDraft((current) => ({ ...current, contactIds: event.target.checked ? [...current.contactIds, contact.id] : current.contactIds.filter((id) => id !== contact.id) }))} />
                <span><strong>{contact.name || "Unnamed contact"}</strong><small>{contact.email || "Email not added"}</small></span>
                <b>{contact.suppressed ? `Suppressed · ${labelMarketingValue(contact.suppression_reason)}` : contact.role || "Contact"}</b>
              </label>;
            }) : <p className="marketing-no-contacts">Add client contacts with valid email addresses before creating a campaign.</p>}
          </div>
        </fieldset>
        <div className="marketing-form-actions"><button className="button" type="submit" disabled={busy === "create" || !draft.contactIds.length}>{busy === "create" ? "Creating draft…" : "Create campaign draft"}</button><small>{eligibleContacts.length} eligible contact{eligibleContacts.length === 1 ? "" : "s"} available for this client.</small></div>
      </form>}

      <section className="marketing-workspace">
        <aside className="marketing-campaign-panel">
          <div className="marketing-panel-heading"><div><p className="eyebrow">Campaign history</p><h2>Messages</h2></div><span>{snapshot.campaigns.length}</span></div>
          <div className="marketing-campaign-list">
            {snapshot.campaigns.length ? snapshot.campaigns.map((campaign) => <button type="button" key={campaign.id} className={campaign.id === selectedCampaign?.id ? "active" : ""} onClick={() => chooseCampaign(campaign.id)}>
              <span><b>{labelMarketingValue(campaign.campaign_type)}</b><time dateTime={campaign.updated_at}>{dateLabel(campaign.updated_at)}</time></span>
              <strong>{campaign.name}</strong>
              <small>{recipientSummary(campaign)}</small>
              <em className={`campaign-status status-${campaign.status}`}>{labelMarketingValue(campaign.status)}</em>
            </button>) : <div className="marketing-list-empty"><span aria-hidden="true">✉</span><strong>No campaigns yet</strong><p>Create a draft when you have a client update or a completed job ready for a review request.</p></div>}
          </div>
        </aside>

        <div className="marketing-detail-panel">
          {!selectedCampaign ? <div className="marketing-detail-empty"><span aria-hidden="true">◫</span><h2>Build a clear, consent-based message.</h2><p>Drafts, test sends, recipient status, and suppressions will stay together in this workspace.</p></div> : <>
            <header className="marketing-detail-heading"><div><span className={`campaign-status status-${selectedCampaign.status}`}>{labelMarketingValue(selectedCampaign.status)}</span><h2>{selectedCampaign.name}</h2><p>{labelMarketingValue(selectedCampaign.campaign_type)} · {selectedCampaign.sent_at ? `Sent ${dateLabel(selectedCampaign.sent_at)}` : `Updated ${dateLabel(selectedCampaign.updated_at)}`}</p></div>{snapshot.canManage && <div className="marketing-detail-actions"><button type="button" className="button secondary" disabled={Boolean(busy)} onClick={() => void mutate("test", { action: "send_test", campaignId: selectedCampaign.id })}>{busy === "test" ? "Sending test…" : "Send test to me"}</button><button type="button" className="button" disabled={Boolean(busy) || snapshot.delivery !== "ready" || !campaignCanSend(selectedCampaign)} onClick={() => void sendCampaign(selectedCampaign)}>{busy === "send" ? "Sending…" : "Review & send"}</button></div>}</header>
            <div className="marketing-detail-body">
              <article className="marketing-email-preview"><p className="eyebrow">Email preview</p><small>{selectedCampaign.preview_text || "No preview text"}</small><h3>{selectedCampaign.subject}</h3><p>{selectedCampaign.body}</p>{selectedCampaign.campaign_type === "review_request" && selectedCampaign.review_url && <a href={selectedCampaign.review_url} target="_blank" rel="noreferrer">Leave a review →︎</a>}<footer><strong>Team at Torres &amp; Co. Technology LLC</strong><span>Signature, legal notice, and unsubscribe controls are added automatically.</span></footer></article>
              <section className="marketing-recipient-section"><div className="marketing-recipient-heading"><div><p className="eyebrow">Recipient review</p><h3>{selectedCampaign.recipients.length} recipient{selectedCampaign.recipients.length === 1 ? "" : "s"}</h3></div><span>{recipientSummary(selectedCampaign)}</span></div><div className="marketing-recipient-list">{selectedCampaign.recipients.map((recipient) => <article key={recipient.id}><span><strong>{recipient.display_name || recipient.email}</strong><small>{recipient.display_name ? recipient.email : labelMarketingValue(recipient.consent_basis)}</small></span><span><b className={`campaign-status recipient-${recipient.status}`}>{labelMarketingValue(recipient.status)}</b><small>{recipient.delivered_at ? dateLabel(recipient.delivered_at) : recipient.sent_at ? dateLabel(recipient.sent_at) : recipient.error_detail || "Waiting for send"}</small></span></article>)}</div></section>
            </div>
          </>}
        </div>
      </section>
    </>}
  </Shell>;
}
