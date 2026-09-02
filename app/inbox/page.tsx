"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandSelect } from "../../components/brand-select";
import { Shell } from "../../components/shell";
import { ButtonLoader, LoadingRegion } from "../../components/loading-system";
import { appRoleForOrganizationRole } from "../../lib/access-control";
import {
  changeCommunications,
  deleteCommunicationAttachment,
  downloadCommunicationAttachment,
  fetchCommunications,
  uploadCommunicationAttachment,
} from "../../lib/communications-api";
import {
  COMMUNICATION_CHANNELS,
  CONVERSATION_CATEGORIES,
  CONVERSATION_PRIORITIES,
  CONVERSATION_STATUSES,
  communicationDeliveryLabel,
  conversationCategoryLabel,
  labelCommunicationValue,
  type CommunicationAttachment,
  type CommunicationMessage,
  type CommunicationsSnapshot,
  type Conversation,
} from "../../lib/communications";
import { readStoredSession } from "../../lib/supabase-auth";
import { fetchClients } from "../../lib/supabase-data";
import type { AuthSession, ClientDetail } from "../../lib/types";

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function relativeDateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat("en-US", sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" }).format(date);
}

function fileSizeLabel(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function lastMessage(conversation: Conversation) {
  return conversation.messages[conversation.messages.length - 1] || null;
}

type WorkspaceLoadMode = "initial" | "manual" | "background";

function ConversationListItem({ conversation, active, onChoose }: { conversation: Conversation; active: boolean; onChoose: (id: string) => void }) {
  const latest = lastMessage(conversation);
  return (
    <button className={`conversation-list-item ${active ? "active" : ""} ${conversation.archived_at ? "is-archived" : ""}`} onClick={() => onChoose(conversation.id)} type="button">
      <span className="conversation-list-topline">
        <span className={`conversation-channel channel-${conversation.channel}`}>{communicationDeliveryLabel(conversation.channel)}</span>
        <time dateTime={conversation.last_message_at}>{relativeDateLabel(conversation.last_message_at)}</time>
      </span>
      <strong>{conversation.subject}</strong>
      <span className="conversation-preview">{latest?.body || "No messages yet"}</span>
      <span className="conversation-list-footer">
        <span className="conversation-category">{conversationCategoryLabel(conversation.category)}</span>
        <span>{conversation.archived_at ? "Archived" : labelCommunicationValue(conversation.status)}</span>
      </span>
    </button>
  );
}

function MessageBubble({ message, clientView, onDownload, downloadingId }: {
  message: CommunicationMessage;
  clientView: boolean;
  onDownload: (attachment: CommunicationAttachment) => void;
  downloadingId: string;
}) {
  const ownMessage = clientView ? message.direction === "inbound" : message.direction === "outbound";
  return (
    <article className={`message-bubble ${ownMessage ? "is-own" : "is-other"} is-${message.status}`}>
      <header>
        <div>
          <strong>{message.sender_name || "Workspace member"}</strong>
          <span>{labelCommunicationValue(message.channel)}</span>
        </div>
        <time dateTime={message.created_at}>{dateTimeLabel(message.created_at)}</time>
      </header>
      {message.recipients.length > 0 && <p className="message-recipients"><b>To:</b> {message.recipients.join(", ")}</p>}
      <p className="message-body">{message.body}</p>
      {message.attachments.length > 0 && (
        <div className="message-attachment-list" aria-label="Email attachments">
          {message.attachments.map((attachment) => (
            <button type="button" key={attachment.id} onClick={() => onDownload(attachment)} disabled={downloadingId === attachment.id}>
              <span aria-hidden="true">↧</span>
              <span><strong>{attachment.file_name}</strong><small>{fileSizeLabel(attachment.byte_size)}</small></span>
            </button>
          ))}
        </div>
      )}
      {message.status === "failed" && message.error_detail && <p className="message-error-detail" role="alert"><strong>Delivery failed:</strong> {message.error_detail}</p>}
      <footer>
        <span>{message.client_visible ? "Visible to client" : "Staff only"}</span>
        <strong>{message.status === "draft" ? "Draft — not sent" : labelCommunicationValue(message.status)}</strong>
      </footer>
    </article>
  );
}

export default function InboxPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [snapshot, setSnapshot] = useState<CommunicationsSnapshot | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [newThread, setNewThread] = useState({ subject: "", channel: "internal", category: "general", recipients: "", body: "" });
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived">("active");
  const [consentForm, setConsentForm] = useState({ channel: "sms", address: "", status: "pending", evidence: "" });
  const [replyBody, setReplyBody] = useState("");
  const loadSequence = useRef(0);

  const filteredConversations = useMemo(() => snapshot?.conversations.filter((conversation) => (
    (archiveFilter === "archived" ? Boolean(conversation.archived_at) : !conversation.archived_at)
    && (categoryFilter === "all" || conversation.category === categoryFilter)
  )) || [], [archiveFilter, categoryFilter, snapshot]);
  const selectedConversation = filteredConversations.find((conversation) => conversation.id === selectedConversationId)
    || filteredConversations[0]
    || null;
  const activeConversationCount = snapshot?.conversations.filter((conversation) => !conversation.archived_at).length || 0;
  const archivedConversationCount = snapshot?.conversations.filter((conversation) => Boolean(conversation.archived_at)).length || 0;
  const canWrite = Boolean(snapshot?.canManage || snapshot?.isClient);

  const loadWorkspace = useCallback(async (activeSession: AuthSession, clientId?: string, mode: WorkspaceLoadMode = "initial") => {
    const requestId = ++loadSequence.current;
    if (mode === "initial") setLoading(true);
    if (mode === "manual") setRefreshing(true);
    if (mode !== "background") setError("");
    try {
      const next = await fetchCommunications(activeSession, clientId);
      if (requestId !== loadSequence.current) return;
      const requestedConversation = new URLSearchParams(window.location.search).get("conversation") || "";
      setSnapshot(next);
      setLastRefreshedAt(new Date());
      setSelectedConversationId((current) => next.conversations.some((conversation) => conversation.id === requestedConversation)
        ? requestedConversation
        : next.conversations.some((conversation) => conversation.id === current)
          ? current
          : next.conversations[0]?.id || "");
    } catch (loadError) {
      if (requestId !== loadSequence.current || mode === "background") return;
      if (mode === "initial") setSnapshot(null);
      setError(loadError instanceof Error ? loadError.message : "The inbox could not be loaded.");
    } finally {
      if (mode === "initial") setLoading(false);
      if (mode === "manual") setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) {
      setLoading(false);
      return;
    }
    setSession(stored);
    const role = appRoleForOrganizationRole(stored.organization?.role, stored.profile.role);
    if (role === "customer") {
      void loadWorkspace(stored);
      return;
    }
    void fetchClients().then((rows) => {
      setClients(rows);
      const requestedClient = new URLSearchParams(window.location.search).get("client") || "";
      const initialClient = rows.some((client) => client.id === requestedClient) ? requestedClient : rows[0]?.id || "";
      setSelectedClientId(initialClient);
      if (initialClient) void loadWorkspace(stored, initialClient);
      else setLoading(false);
    }).catch(() => {
      setLoading(false);
      setError("Client workspaces could not be loaded.");
    });
  }, [loadWorkspace]);

  useEffect(() => {
    if (!session || !snapshot) return;
    const clientId = snapshot.isClient ? undefined : selectedClientId;
    const refreshVisibleInbox = () => {
      if (document.visibilityState === "visible" && !busy && !refreshing) {
        void loadWorkspace(session, clientId, "background");
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshVisibleInbox();
    };
    const intervalId = window.setInterval(refreshVisibleInbox, 3000);
    window.addEventListener("focus", refreshVisibleInbox);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshVisibleInbox);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [busy, loadWorkspace, refreshing, selectedClientId, session, snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    if (!filteredConversations.some((conversation) => conversation.id === selectedConversationId)) {
      setSelectedConversationId(filteredConversations[0]?.id || "");
    }
  }, [archiveFilter, categoryFilter, filteredConversations, selectedConversationId, snapshot]);

  function chooseClient(clientId: string) {
    if (!session) return;
    setSelectedClientId(clientId);
    setMessage("");
    setNewThreadOpen(false);
    setCategoryFilter("all");
    setArchiveFilter("active");
    const url = new URL(window.location.href);
    url.searchParams.set("client", clientId);
    url.searchParams.delete("conversation");
    window.history.replaceState({}, "", url);
    void loadWorkspace(session, clientId);
  }

  function chooseConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    setNewThreadOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("conversation", conversationId);
    window.history.replaceState({}, "", url);
  }

  async function mutate(label: string, input: Record<string, unknown>) {
    if (!session || !snapshot) return null;
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const response = await changeCommunications(session, { clientId: snapshot.client.id || selectedClientId, ...input });
      if (!response.snapshot) throw new Error("The inbox returned an incomplete response.");
      setSnapshot(response.snapshot);
      setLastRefreshedAt(new Date());
      setSelectedConversationId((current) => response.snapshot?.conversations.some((conversation) => conversation.id === current)
        ? current
        : response.snapshot?.conversations[0]?.id || "");
      setMessage(response.message || "Inbox updated.");
      return response.snapshot;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "That change could not be saved.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function createConversation(event: FormEvent) {
    event.preventDefault();
    const recipients = newThread.recipients.split(",").map((recipient) => recipient.trim()).filter(Boolean);
    const next = await mutate("new-thread", { action: "create_conversation", ...newThread, recipients });
    if (next) {
      setNewThread({ subject: "", channel: "internal", category: "general", recipients: "", body: "" });
      setCategoryFilter("all");
      setArchiveFilter("active");
      setNewThreadOpen(false);
      setSelectedConversationId(next.conversations[0]?.id || "");
    }
  }

  async function addReply(event: FormEvent) {
    event.preventDefault();
    if (!selectedConversation) return;
    if (await mutate("reply", { action: "add_message", conversationId: selectedConversation.id, channel: selectedConversation.channel, body: replyBody })) setReplyBody("");
  }

  async function updateConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConversation) return;
    const form = new FormData(event.currentTarget);
    await mutate("conversation-status", {
      action: "update_conversation",
      conversationId: selectedConversation.id,
      status: form.get("status"),
      priority: form.get("priority"),
      category: form.get("category"),
    });
  }

  async function archiveConversation() {
    if (!selectedConversation) return;
    const archiving = !selectedConversation.archived_at;
    const next = await mutate("conversation-archive", {
      action: "archive_conversation",
      conversationId: selectedConversation.id,
      archived: archiving,
    });
    if (!next) return;
    setArchiveFilter(archiving ? "archived" : "active");
    const nextList = next.conversations.filter((conversation) => archiving ? Boolean(conversation.archived_at) : !conversation.archived_at);
    setSelectedConversationId(nextList[0]?.id || "");
  }

  async function sendEmail(messageId: string) {
    await mutate(`send-${messageId}`, { action: "send_email", messageId });
  }

  async function sendSms(messageId: string) {
    await mutate(`send-${messageId}`, { action: "send_sms", messageId });
  }

  async function saveChannelConsent(event: FormEvent) {
    event.preventDefault();
    const next = await mutate("channel-consent", { action: "set_channel_consent", ...consentForm });
    if (next) setConsentForm((current) => ({ ...current, address: "", evidence: "" }));
  }

  async function reloadAfterAttachmentChange() {
    if (!session || !snapshot) return;
    await loadWorkspace(session, snapshot.isClient ? undefined : selectedClientId, "background");
  }

  async function uploadAttachments(messageId: string, files: File[]) {
    if (!session || !snapshot || !files.length) return;
    setBusy(`attach-${messageId}`);
    setError("");
    setMessage("");
    try {
      for (const file of files) {
        await uploadCommunicationAttachment(session, { clientId: snapshot.client.id, messageId, file });
      }
      await reloadAfterAttachmentChange();
      setMessage(`${files.length} ${files.length === 1 ? "file" : "files"} attached securely.`);
    } catch (uploadError) {
      await reloadAfterAttachmentChange();
      setError(uploadError instanceof Error ? uploadError.message : "The files could not be attached.");
    } finally {
      setBusy("");
    }
  }

  async function removeAttachment(attachmentId: string) {
    if (!session || !snapshot) return;
    setBusy(`remove-${attachmentId}`);
    setError("");
    setMessage("");
    try {
      const response = await deleteCommunicationAttachment(session, { clientId: snapshot.client.id, attachmentId });
      await reloadAfterAttachmentChange();
      setMessage(response.message || "Attachment removed.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "The attachment could not be removed.");
    } finally {
      setBusy("");
    }
  }

  async function downloadAttachment(attachment: CommunicationAttachment) {
    if (!session || !snapshot) return;
    setBusy(`download-${attachment.id}`);
    setError("");
    try {
      await downloadCommunicationAttachment(session, { clientId: snapshot.client.id, attachment });
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "The attachment could not be downloaded.");
    } finally {
      setBusy("");
    }
  }

  function refreshInbox() {
    if (!session || !snapshot) return;
    void loadWorkspace(session, snapshot.isClient ? undefined : selectedClientId, "manual");
  }

  return (
    <Shell active="Inbox">
      <div className="page-heading communications-heading">
        <div>
          <p className="eyebrow">Communications</p>
          <h1>Shared inbox</h1>
          <p className="lede">Keep client questions, delivery updates, and future outbound campaigns attached to the correct account.</p>
        </div>
        {snapshot && (
          <div className="communications-heading-actions">
            {clients.length > 0 && snapshot?.canManage && <BrandSelect label="Client" value={selectedClientId} onChange={chooseClient} options={clients.map((client) => ({ value: client.id, label: client.name, description: [client.industry, client.location].filter(Boolean).join(" · ") || "Client workspace" }))} />}
            <div className="inbox-live-control">
              <span className="inbox-live-status">
                <i aria-hidden="true" />
                <span>{lastRefreshedAt ? `Updated ${lastRefreshedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })} · Live every 3 sec` : "Live updates every 3 sec"}</span>
              </span>
              <button className="inbox-refresh-button" type="button" onClick={refreshInbox} disabled={refreshing || loading} aria-label="Refresh inbox messages">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5M18.1 9A7 7 0 0 0 6.4 6.4L4 9m16 6-2.4 2.6A7 7 0 0 1 5.9 15" /></svg>
                <span>Refresh</span>{refreshing && <ButtonLoader />}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="communications-feedback" aria-live="polite">
        {error && <p className="integration-notice operations-error" role="alert">{error}</p>}
        {message && <p className="integration-notice operations-success" role="status">{message}</p>}
      </div>

      {loading ? (
        <LoadingRegion active label="Loading secure conversations" variant="inbox" />
      ) : !snapshot ? (
        <section className="empty-state"><h2>Inbox unavailable</h2><p>Choose a client or apply the Phase 4 communications migration.</p></section>
      ) : (
        <>
          <section className="communications-summary" aria-label="Inbox summary">
            <div><span>Open</span><strong>{snapshot.summary.openConversations}</strong><small>Active conversations</small></div>
            <div><span>Pending</span><strong>{snapshot.summary.pendingConversations}</strong><small>Waiting on a response</small></div>
            <div><span>Shared</span><strong>{snapshot.summary.sharedMessages}</strong><small>Client-visible messages</small></div>
            <div><span>Email drafts</span><strong>{snapshot.summary.emailDrafts}</strong><small>Saved, never marked sent</small></div>
          </section>

          <section className="communications-readiness" aria-label="Channel readiness">
            <div><span className="readiness-mark is-ready">✓</span><p><strong>Secure inbox</strong><small>Ready for staff and client updates.</small></p></div>
            <div><span className={`readiness-mark ${snapshot.delivery.email === "ready" ? "is-ready" : ""}`}>{snapshot.delivery.email === "ready" ? "✓" : "✉"}</span><p><strong>Email</strong><small>{snapshot.delivery.email === "ready" ? "Provider connected. Draft, send, and track delivery." : "Draft-only until a delivery provider is connected."}</small></p></div>
            <div><span className={`readiness-mark ${snapshot.delivery.sms === "ready" ? "is-ready" : ""}`}>{snapshot.delivery.sms === "ready" ? "✓" : "S"}</span><p><strong>SMS</strong><small>{snapshot.delivery.sms === "ready" ? `Twilio connected${snapshot.smsVoice.senderAddress ? ` · ${snapshot.smsVoice.senderAddress}` : ""}.` : snapshot.delivery.sms === "migration_required" ? "Storage migration required." : "Consent records are ready; provider setup remains."}</small></p></div>
            <div><span className={`readiness-mark ${snapshot.delivery.voice === "ready" ? "is-ready" : ""}`}>{snapshot.delivery.voice === "ready" ? "✓" : "V"}</span><p><strong>Voice</strong><small>{snapshot.delivery.voice === "ready" ? "Call records and provider are ready." : snapshot.delivery.voice === "migration_required" ? "Storage migration required." : "Call history is ready; provider setup remains."}</small></p></div>
          </section>

          {snapshot.canManage && snapshot.smsVoice.migrationReady && (
            <section className="communications-provider-foundation" aria-label="SMS and voice controls">
              <header>
                <div><p className="eyebrow">SMS &amp; voice foundation</p><h2>Consent first, delivery second.</h2><p>Record permission for each mobile number before sending. Opt-outs suppress future messages automatically.</p></div>
                <span className={snapshot.delivery.sms === "ready" ? "is-ready" : ""}>{snapshot.delivery.sms === "ready" ? "SMS connected" : "Provider setup required"}</span>
              </header>
              <div className="communications-provider-grid">
                <form className="communications-form consent-form" onSubmit={saveChannelConsent}>
                  <strong>Record communication consent</strong>
                  <div>
                    <label>Channel<select value={consentForm.channel} onChange={(event) => setConsentForm({ ...consentForm, channel: event.target.value })}><option value="sms">SMS</option><option value="voice">Voice</option></select></label>
                    <label>Mobile number<input required type="tel" value={consentForm.address} onChange={(event) => setConsentForm({ ...consentForm, address: event.target.value })} placeholder="+15035551234" /></label>
                    <label>Status<select value={consentForm.status} onChange={(event) => setConsentForm({ ...consentForm, status: event.target.value })}><option value="pending">Pending</option><option value="granted">Granted</option><option value="revoked">Revoked</option></select></label>
                  </div>
                  <label>Evidence or note<input required={consentForm.status === "granted"} value={consentForm.evidence} onChange={(event) => setConsentForm({ ...consentForm, evidence: event.target.value })} placeholder="How and when consent was recorded" /></label>
                  <button className="button button-dark" disabled={busy === "channel-consent"}>{busy === "channel-consent" ? "Saving…" : "Save consent →︎"}</button>
                </form>
                <div className="communications-consent-list">
                  <strong>Recorded permissions</strong>
                  {snapshot.smsVoice.consents.length ? snapshot.smsVoice.consents.map((consent) => (
                    <article key={consent.id}>
                      <span><b>{consent.address}</b><small>{consent.channel.toUpperCase()} · {consent.source.replaceAll("_", " ")}</small></span>
                      <em className={`consent-${consent.status}`}>{labelCommunicationValue(consent.status)}</em>
                    </article>
                  )) : <p>No SMS or voice consent has been recorded for this client.</p>}
                </div>
                <div className="communications-activity-list">
                  <strong>Recent provider activity</strong>
                  {[...snapshot.smsVoice.recentSmsEvents.map((event) => ({ id: event.id, type: "SMS", title: `${event.direction === "inbound" ? event.from_address : event.to_address}`, status: event.status, date: event.occurred_at })), ...snapshot.smsVoice.recentCalls.map((call) => ({ id: call.id, type: "Call", title: `${call.direction === "inbound" ? call.from_address : call.to_address}`, status: `${call.status}${call.duration_seconds ? ` · ${call.duration_seconds}s` : ""}`, date: call.created_at }))].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).slice(0, 8).map((activity) => (
                    <article key={`${activity.type}-${activity.id}`}><span><b>{activity.type} · {activity.title || "Unknown number"}</b><small>{dateTimeLabel(activity.date)}</small></span><em>{labelCommunicationValue(activity.status)}</em></article>
                  ))}
                  {!snapshot.smsVoice.recentSmsEvents.length && !snapshot.smsVoice.recentCalls.length && <p>No SMS delivery events or calls have been recorded yet.</p>}
                </div>
              </div>
            </section>
          )}

          <section className="communications-workspace">
            <aside className="conversation-panel" aria-label="Conversations">
              <div className="conversation-panel-heading">
                <div><p className="eyebrow">{snapshot.client.name}</p><h2>Conversations</h2></div>
                {canWrite && <button className="conversation-new-button" onClick={() => setNewThreadOpen((current) => !current)} type="button" aria-expanded={newThreadOpen}>＋ New</button>}
              </div>

              <div className="conversation-panel-filters">
                {!snapshot.isClient && (
                  <div className="conversation-filter-tabs" role="group" aria-label="Conversation state">
                    <button className={archiveFilter === "active" ? "active" : ""} type="button" onClick={() => setArchiveFilter("active")}>Active <span>{activeConversationCount}</span></button>
                    <button className={archiveFilter === "archived" ? "active" : ""} type="button" onClick={() => setArchiveFilter("archived")}>Archived <span>{archivedConversationCount}</span></button>
                  </div>
                )}
                <label className="conversation-category-filter">Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{CONVERSATION_CATEGORIES.map((category) => <option key={category} value={category}>{conversationCategoryLabel(category)}</option>)}</select></label>
              </div>

              {newThreadOpen && canWrite && (
                <form className="communications-form new-conversation-form" onSubmit={createConversation}>
                  <div className="communications-form-heading"><strong>Start a conversation</strong><button type="button" onClick={() => setNewThreadOpen(false)} aria-label="Close new conversation form">×</button></div>
                  <label>Subject<input required value={newThread.subject} onChange={(event) => setNewThread({ ...newThread, subject: event.target.value })} placeholder="What does the client need?" /></label>
                  <label>Category<select value={newThread.category} onChange={(event) => setNewThread({ ...newThread, category: event.target.value })}>{CONVERSATION_CATEGORIES.map((category) => <option key={category} value={category}>{conversationCategoryLabel(category)}</option>)}</select></label>
                  {!snapshot.isClient && <label>Channel<select value={newThread.channel} onChange={(event) => setNewThread({ ...newThread, channel: event.target.value })}>{COMMUNICATION_CHANNELS.filter((channel) => channel === "internal" || channel === "email" || (channel === "sms" && snapshot.smsVoice.migrationReady)).map((channel) => <option key={channel} value={channel}>{communicationDeliveryLabel(channel)}</option>)}</select></label>}
                  {newThread.channel === "email" && !snapshot.isClient && <label>Email recipient(s)<input required type="text" value={newThread.recipients} onChange={(event) => setNewThread({ ...newThread, recipients: event.target.value })} placeholder="client@example.com" /><small>Separate multiple addresses with commas.</small></label>}
                  {newThread.channel === "sms" && !snapshot.isClient && <label>Mobile recipient<input required type="tel" value={newThread.recipients} onChange={(event) => setNewThread({ ...newThread, recipients: event.target.value })} placeholder="+15035551234" /><small>Use one mobile number with country code. Active consent is required before sending.</small></label>}
                  <label>Message<textarea required value={newThread.body} onChange={(event) => setNewThread({ ...newThread, body: event.target.value })} placeholder={newThread.channel === "email" ? "Write the email draft…" : newThread.channel === "sms" ? "Write the SMS draft…" : "Write the first shared update…"} /></label>
                  {newThread.channel === "email" && <p className="draft-warning"><strong>{snapshot.delivery.email === "ready" ? "Review before sending." : "Draft only."}</strong> {snapshot.delivery.email === "ready" ? "This saves a draft. Open the thread and send it when the recipient and content are correct." : "This will be saved for review and will not be sent."}</p>}
                  {newThread.channel === "sms" && <p className="draft-warning"><strong>{snapshot.delivery.sms === "ready" ? "Review consent before sending." : "Draft only."}</strong> {snapshot.delivery.sms === "ready" ? "The Send action will remain protected until this exact number has granted consent." : "Connect Twilio after saving; this draft cannot leave the workspace yet."}</p>}
                  <button className="button button-dark" disabled={busy === "new-thread"}>{busy === "new-thread" ? "Saving…" : newThread.channel === "email" ? "Save email draft →︎" : newThread.channel === "sms" ? "Save SMS draft →︎" : "Share conversation →︎"}</button>
                </form>
              )}

              <div className="conversation-list">
                {filteredConversations.length ? filteredConversations.map((conversation) => <ConversationListItem key={conversation.id} conversation={conversation} active={conversation.id === selectedConversation?.id} onChoose={chooseConversation} />) : <div className="conversation-empty"><span aria-hidden="true">✉</span><strong>{archiveFilter === "archived" ? "No archived conversations" : categoryFilter === "all" ? "No conversations yet" : `No ${conversationCategoryLabel(categoryFilter).toLowerCase()} conversations`}</strong><p>{archiveFilter === "archived" ? "Archived threads will stay here until you restore them." : canWrite ? "Start a conversation or choose another category." : "No messages have been shared with this account."}</p></div>}
              </div>
            </aside>

            <div className="conversation-detail-panel">
              {selectedConversation ? (
                <>
                  <header className="conversation-detail-heading">
                    <div>
                      <div className="conversation-detail-badges"><span className={`conversation-channel channel-${selectedConversation.channel}`}>{communicationDeliveryLabel(selectedConversation.channel)}</span><span className="conversation-category">{conversationCategoryLabel(selectedConversation.category)}</span>{selectedConversation.archived_at && <span className="conversation-archived-badge">Archived</span>}</div>
                      <h2>{selectedConversation.subject}</h2>
                      <p>{selectedConversation.channel === "webchat" ? "Live website conversation" : selectedConversation.client_visible ? "Visible in the client workspace" : "Internal staff record"} · Started {dateTimeLabel(selectedConversation.created_at)}</p>
                    </div>
                    <span className={`conversation-priority priority-${selectedConversation.priority}`}>{labelCommunicationValue(selectedConversation.priority)}</span>
                  </header>

                  {snapshot.canManage && (
                    <form className="conversation-controls" onSubmit={updateConversation}>
                      <label>Category<select name="category" defaultValue={selectedConversation.category} key={`category-${selectedConversation.id}-${selectedConversation.category}`}>{CONVERSATION_CATEGORIES.map((category) => <option value={category} key={category}>{conversationCategoryLabel(category)}</option>)}</select></label>
                      <label>Status<select name="status" defaultValue={selectedConversation.status} key={`status-${selectedConversation.id}-${selectedConversation.status}`}>{CONVERSATION_STATUSES.map((status) => <option value={status} key={status}>{labelCommunicationValue(status)}</option>)}</select></label>
                      <label>Priority<select name="priority" defaultValue={selectedConversation.priority} key={`priority-${selectedConversation.id}-${selectedConversation.priority}`}>{CONVERSATION_PRIORITIES.map((priority) => <option value={priority} key={priority}>{labelCommunicationValue(priority)}</option>)}</select></label>
                      <button className="button button-light" disabled={busy === "conversation-status"}>Update</button>
                      <button className="button button-light conversation-archive-button" type="button" onClick={() => void archiveConversation()} disabled={busy === "conversation-archive"}>{busy === "conversation-archive" ? "Saving…" : selectedConversation.archived_at ? "Restore" : "Archive"}</button>
                    </form>
                  )}

                  <div className="message-timeline" aria-label="Message history">
                    {selectedConversation.messages.map((conversationMessage) => (
                      <MessageBubble
                        key={conversationMessage.id}
                        message={conversationMessage}
                        clientView={snapshot.isClient}
                        onDownload={(attachment) => void downloadAttachment(attachment)}
                        downloadingId={busy.startsWith("download-") ? busy.slice(9) : ""}
                      />
                    ))}
                  </div>

                  {selectedConversation.archived_at ? (
                    <div className="conversation-archived-notice"><strong>This conversation is archived.</strong><p>Restore it to add replies, send drafts, or change its active status.</p></div>
                  ) : canWrite && (selectedConversation.channel === "internal" || selectedConversation.channel === "webchat") ? (
                    <form className="communications-form reply-form" onSubmit={addReply}>
                      <label>{selectedConversation.channel === "webchat" ? "Reply to the website visitor" : "Reply to this conversation"}<textarea required value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder={selectedConversation.channel === "webchat" ? "Write a live response…" : "Write a secure update…"} /></label>
                      <div className="reply-form-footer"><small>{selectedConversation.channel === "webchat" ? "Your first reply transfers this chat to staff and pauses automated responses." : "This reply is shared with the client workspace."}</small><button className="button button-dark" disabled={busy === "reply"}>{busy === "reply" ? "Sending…" : selectedConversation.channel === "webchat" ? "Send live reply →︎" : "Share reply →︎"}</button></div>
                    </form>
                  ) : selectedConversation.channel === "email" ? snapshot.delivery.email === "ready" && snapshot.canManage ? (
                    <div className="email-draft-boundary is-ready">
                      <strong>Transactional email is ready.</strong>
                      <p>Review the recipient, message, and files before sending. The Torres &amp; Co. signature and confidentiality notice are added automatically to every delivered email.</p>
                      <div className="email-delivery-actions">
                        {selectedConversation.messages.filter((emailMessage) => emailMessage.channel === "email" && (emailMessage.status === "draft" || emailMessage.status === "failed") && !emailMessage.provider_message_id).map((emailMessage) => (
                          <div className="email-draft-card" key={emailMessage.id}>
                            <div className="email-draft-recipient"><span><strong>{emailMessage.status === "failed" ? "Ready to retry" : "Ready for review"}</strong><small>To: {emailMessage.recipients.join(", ")}</small></span><b>{emailMessage.attachments.length}/5 files</b></div>
                            {emailMessage.attachments.length > 0 && (
                              <div className="email-attachment-list" aria-label="Draft attachments">
                                {emailMessage.attachments.map((attachment) => (
                                  <div key={attachment.id}>
                                    <span><strong>{attachment.file_name}</strong><small>{fileSizeLabel(attachment.byte_size)}</small></span>
                                    <button type="button" onClick={() => void removeAttachment(attachment.id)} disabled={busy === `remove-${attachment.id}`} aria-label={`Remove ${attachment.file_name}`}>{busy === `remove-${attachment.id}` ? "…" : "×"}</button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="email-draft-controls">
                              <label className="email-attachment-picker">
                                <span aria-hidden="true">＋</span> {busy === `attach-${emailMessage.id}` ? "Uploading…" : "Add files"}
                                <input
                                  type="file"
                                  multiple
                                  accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.docx,.xlsx,application/pdf,image/jpeg,image/png,image/webp,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                  disabled={Boolean(busy) || emailMessage.attachments.length >= 5}
                                  onChange={(event) => {
                                    const files = Array.from(event.currentTarget.files || []);
                                    event.currentTarget.value = "";
                                    void uploadAttachments(emailMessage.id, files);
                                  }}
                                />
                              </label>
                              <button className="email-delivery-action" type="button" onClick={() => void sendEmail(emailMessage.id)} disabled={Boolean(busy)}>
                                <span><strong>{emailMessage.status === "failed" ? "Retry email" : "Send email"}</strong><small>{emailMessage.attachments.length ? `${emailMessage.attachments.length} secure ${emailMessage.attachments.length === 1 ? "attachment" : "attachments"}` : "No attachments"}</small></span>
                                <b>{busy === `send-${emailMessage.id}` ? "Sending…" : "→︎"}</b>
                              </button>
                            </div>
                            <small className="email-attachment-help">PDF, images, TXT, CSV, Word, or Excel · 10 MB each · 20 MB total</small>
                          </div>
                        ))}
                        {!selectedConversation.messages.some((emailMessage) => emailMessage.channel === "email" && (emailMessage.status === "draft" || emailMessage.status === "failed") && !emailMessage.provider_message_id) && <small className="email-delivery-empty">No drafts are waiting to send. Delivery status will continue updating automatically.</small>}
                      </div>
                    </div>
                  ) : (
                    <div className="email-draft-boundary"><strong>Email delivery is not connected.</strong><p>These messages remain reviewable drafts. Add the verified provider configuration before the app will offer a Send action.</p></div>
                  ) : selectedConversation.channel === "sms" && snapshot.canManage ? (
                    <div className={`email-draft-boundary ${snapshot.delivery.sms === "ready" ? "is-ready" : ""}`}>
                      <strong>{snapshot.delivery.sms === "ready" ? "SMS delivery is ready." : "SMS drafts are protected."}</strong>
                      <p>{snapshot.delivery.sms === "ready" ? "A message can be sent only when its exact recipient has granted consent and is not suppressed." : "Connect Twilio to enable sending. Drafts, consent, and opt-out records remain safely stored meanwhile."}</p>
                      <div className="email-delivery-actions">
                        {selectedConversation.messages.filter((smsMessage) => smsMessage.channel === "sms" && (smsMessage.status === "draft" || smsMessage.status === "failed") && !smsMessage.provider_message_id).map((smsMessage) => {
                          const recipient = smsMessage.recipients[0] || "";
                          const consent = snapshot.smsVoice.consents.find((item) => item.channel === "sms" && item.address === recipient);
                          const canSend = snapshot.delivery.sms === "ready" && consent?.status === "granted";
                          return (
                            <button className="email-delivery-action" key={smsMessage.id} type="button" onClick={() => void sendSms(smsMessage.id)} disabled={Boolean(busy) || !canSend}>
                              <span><strong>{canSend ? (smsMessage.status === "failed" ? "Retry SMS" : "Send SMS") : `Consent ${consent?.status || "not recorded"}`}</strong><small>To: {recipient || "No recipient"}</small></span>
                              <b>{busy === `send-${smsMessage.id}` ? "Sending…" : canSend ? "→︎" : "—"}</b>
                            </button>
                          );
                        })}
                        {!selectedConversation.messages.some((smsMessage) => smsMessage.channel === "sms" && (smsMessage.status === "draft" || smsMessage.status === "failed") && !smsMessage.provider_message_id) && <small className="email-delivery-empty">No SMS drafts are waiting. Delivery receipts and inbound replies will appear automatically.</small>}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="conversation-detail-empty"><span aria-hidden="true">✉</span><h2>Select a conversation</h2><p>Choose a thread from the queue or start a new secure client conversation.</p></div>
              )}
            </div>
          </section>
        </>
      )}
    </Shell>
  );
}
