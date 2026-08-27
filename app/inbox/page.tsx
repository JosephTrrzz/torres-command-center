"use client";

import { type FormEvent, useEffect, useState } from "react";
import { BrandSelect } from "../../components/brand-select";
import { Shell } from "../../components/shell";
import { appRoleForOrganizationRole } from "../../lib/access-control";
import { changeCommunications, fetchCommunications } from "../../lib/communications-api";
import {
  COMMUNICATION_CHANNELS,
  CONVERSATION_PRIORITIES,
  CONVERSATION_STATUSES,
  communicationDeliveryLabel,
  labelCommunicationValue,
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

function lastMessage(conversation: Conversation) {
  return conversation.messages[conversation.messages.length - 1] || null;
}

function ConversationListItem({ conversation, active, onChoose }: { conversation: Conversation; active: boolean; onChoose: (id: string) => void }) {
  const latest = lastMessage(conversation);
  return (
    <button className={`conversation-list-item ${active ? "active" : ""}`} onClick={() => onChoose(conversation.id)} type="button">
      <span className="conversation-list-topline">
        <span className={`conversation-channel channel-${conversation.channel}`}>{communicationDeliveryLabel(conversation.channel)}</span>
        <time dateTime={conversation.last_message_at}>{relativeDateLabel(conversation.last_message_at)}</time>
      </span>
      <strong>{conversation.subject}</strong>
      <span className="conversation-preview">{latest?.body || "No messages yet"}</span>
      <span className="conversation-list-footer">
        <span className={`conversation-priority priority-${conversation.priority}`}>{labelCommunicationValue(conversation.priority)}</span>
        <span>{labelCommunicationValue(conversation.status)}</span>
      </span>
    </button>
  );
}

function MessageBubble({ message, clientView }: { message: CommunicationMessage; clientView: boolean }) {
  const ownMessage = clientView ? message.direction === "inbound" : message.direction === "outbound";
  return (
    <article className={`message-bubble ${ownMessage ? "is-own" : "is-other"} ${message.status === "draft" ? "is-draft" : ""}`}>
      <header>
        <div>
          <strong>{message.sender_name || "Workspace member"}</strong>
          <span>{labelCommunicationValue(message.channel)}</span>
        </div>
        <time dateTime={message.created_at}>{dateTimeLabel(message.created_at)}</time>
      </header>
      {message.recipients.length > 0 && <p className="message-recipients"><b>To:</b> {message.recipients.join(", ")}</p>}
      <p className="message-body">{message.body}</p>
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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [newThread, setNewThread] = useState({ subject: "", channel: "internal", recipients: "", body: "" });
  const [replyBody, setReplyBody] = useState("");

  const selectedConversation = snapshot?.conversations.find((conversation) => conversation.id === selectedConversationId)
    || snapshot?.conversations[0]
    || null;
  const canWrite = Boolean(snapshot?.canManage || snapshot?.isClient);

  async function loadWorkspace(activeSession: AuthSession, clientId?: string) {
    setLoading(true);
    setError("");
    try {
      const next = await fetchCommunications(activeSession, clientId);
      const requestedConversation = new URLSearchParams(window.location.search).get("conversation") || "";
      setSnapshot(next);
      setSelectedConversationId((current) => next.conversations.some((conversation) => conversation.id === requestedConversation)
        ? requestedConversation
        : next.conversations.some((conversation) => conversation.id === current)
          ? current
          : next.conversations[0]?.id || "");
    } catch (loadError) {
      setSnapshot(null);
      setError(loadError instanceof Error ? loadError.message : "The inbox could not be loaded.");
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
  }, []);

  function chooseClient(clientId: string) {
    if (!session) return;
    setSelectedClientId(clientId);
    setMessage("");
    setNewThreadOpen(false);
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
      setNewThread({ subject: "", channel: "internal", recipients: "", body: "" });
      setNewThreadOpen(false);
      setSelectedConversationId(next.conversations[0]?.id || "");
    }
  }

  async function addReply(event: FormEvent) {
    event.preventDefault();
    if (!selectedConversation) return;
    if (await mutate("reply", { action: "add_message", conversationId: selectedConversation.id, channel: "internal", body: replyBody })) setReplyBody("");
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
    });
  }

  return (
    <Shell active="Inbox">
      <div className="page-heading communications-heading">
        <div>
          <p className="eyebrow">Communications</p>
          <h1>Shared inbox</h1>
          <p className="lede">Keep client questions, delivery updates, and future outbound campaigns attached to the correct account.</p>
        </div>
        {clients.length > 0 && snapshot?.canManage && <BrandSelect label="Client" value={selectedClientId} onChange={chooseClient} options={clients.map((client) => ({ value: client.id, label: client.name, description: [client.industry, client.location].filter(Boolean).join(" · ") || "Client workspace" }))} />}
      </div>

      <div className="communications-feedback" aria-live="polite">
        {error && <p className="integration-notice operations-error" role="alert">{error}</p>}
        {message && <p className="integration-notice operations-success" role="status">{message}</p>}
      </div>

      {loading ? (
        <section className="operations-loading"><strong>Loading shared inbox…</strong><span>Checking secure client conversations and message history.</span></section>
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
            <div><span className="readiness-mark">✉</span><p><strong>Email</strong><small>Draft-only until a delivery provider is connected.</small></p></div>
            <div><span className="readiness-mark">·</span><p><strong>SMS &amp; voice</strong><small>Planned for a later Phase 4 connection.</small></p></div>
          </section>

          <section className="communications-workspace">
            <aside className="conversation-panel" aria-label="Conversations">
              <div className="conversation-panel-heading">
                <div><p className="eyebrow">{snapshot.client.name}</p><h2>Conversations</h2></div>
                {canWrite && <button className="conversation-new-button" onClick={() => setNewThreadOpen((current) => !current)} type="button" aria-expanded={newThreadOpen}>＋ New</button>}
              </div>

              {newThreadOpen && canWrite && (
                <form className="communications-form new-conversation-form" onSubmit={createConversation}>
                  <div className="communications-form-heading"><strong>Start a conversation</strong><button type="button" onClick={() => setNewThreadOpen(false)} aria-label="Close new conversation form">×</button></div>
                  <label>Subject<input required value={newThread.subject} onChange={(event) => setNewThread({ ...newThread, subject: event.target.value })} placeholder="What does the client need?" /></label>
                  {!snapshot.isClient && <label>Channel<select value={newThread.channel} onChange={(event) => setNewThread({ ...newThread, channel: event.target.value })}>{COMMUNICATION_CHANNELS.filter((channel) => channel === "internal" || channel === "email").map((channel) => <option key={channel} value={channel}>{communicationDeliveryLabel(channel)}</option>)}</select></label>}
                  {newThread.channel === "email" && !snapshot.isClient && <label>Email recipient(s)<input required type="text" value={newThread.recipients} onChange={(event) => setNewThread({ ...newThread, recipients: event.target.value })} placeholder="client@example.com" /><small>Separate multiple addresses with commas.</small></label>}
                  <label>Message<textarea required value={newThread.body} onChange={(event) => setNewThread({ ...newThread, body: event.target.value })} placeholder={newThread.channel === "email" ? "Write the email draft…" : "Write the first shared update…"} /></label>
                  {newThread.channel === "email" && <p className="draft-warning"><strong>Draft only.</strong> This will be saved for review and will not be sent.</p>}
                  <button className="button button-dark" disabled={busy === "new-thread"}>{busy === "new-thread" ? "Saving…" : newThread.channel === "email" ? "Save email draft →" : "Share conversation →"}</button>
                </form>
              )}

              <div className="conversation-list">
                {snapshot.conversations.length ? snapshot.conversations.map((conversation) => <ConversationListItem key={conversation.id} conversation={conversation} active={conversation.id === selectedConversation?.id} onChoose={chooseConversation} />) : <div className="conversation-empty"><span aria-hidden="true">✉</span><strong>No conversations yet</strong><p>{canWrite ? "Start the first client conversation to create a shared record." : "No messages have been shared with this account."}</p></div>}
              </div>
            </aside>

            <div className="conversation-detail-panel">
              {selectedConversation ? (
                <>
                  <header className="conversation-detail-heading">
                    <div>
                      <span className={`conversation-channel channel-${selectedConversation.channel}`}>{communicationDeliveryLabel(selectedConversation.channel)}</span>
                      <h2>{selectedConversation.subject}</h2>
                      <p>{selectedConversation.client_visible ? "Visible in the client workspace" : "Internal staff record"} · Started {dateTimeLabel(selectedConversation.created_at)}</p>
                    </div>
                    <span className={`conversation-priority priority-${selectedConversation.priority}`}>{labelCommunicationValue(selectedConversation.priority)}</span>
                  </header>

                  {snapshot.canManage && (
                    <form className="conversation-controls" onSubmit={updateConversation}>
                      <label>Status<select name="status" defaultValue={selectedConversation.status} key={`status-${selectedConversation.id}-${selectedConversation.status}`}>{CONVERSATION_STATUSES.map((status) => <option value={status} key={status}>{labelCommunicationValue(status)}</option>)}</select></label>
                      <label>Priority<select name="priority" defaultValue={selectedConversation.priority} key={`priority-${selectedConversation.id}-${selectedConversation.priority}`}>{CONVERSATION_PRIORITIES.map((priority) => <option value={priority} key={priority}>{labelCommunicationValue(priority)}</option>)}</select></label>
                      <button className="button button-light" disabled={busy === "conversation-status"}>Update</button>
                    </form>
                  )}

                  <div className="message-timeline" aria-label="Message history">
                    {selectedConversation.messages.map((conversationMessage) => <MessageBubble key={conversationMessage.id} message={conversationMessage} clientView={snapshot.isClient} />)}
                  </div>

                  {canWrite && selectedConversation.channel === "internal" ? (
                    <form className="communications-form reply-form" onSubmit={addReply}>
                      <label>Reply to this conversation<textarea required value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="Write a secure update…" /></label>
                      <div className="reply-form-footer"><small>This reply is shared with the client workspace.</small><button className="button button-dark" disabled={busy === "reply"}>{busy === "reply" ? "Sharing…" : "Share reply →"}</button></div>
                    </form>
                  ) : selectedConversation.channel === "email" ? (
                    <div className="email-draft-boundary"><strong>Email delivery is not connected.</strong><p>These messages remain reviewable drafts. A future provider connection will add sending, delivery, bounce, and reply tracking.</p></div>
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
