"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BrandSelect } from "../../components/brand-select";
import { Shell } from "../../components/shell";
import { changeCrm, fetchCrm } from "../../lib/crm-api";
import {
  APPOINTMENT_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  labelCrmValue,
  sortCrmLeads,
  type CrmLead,
  type CrmSnapshot,
  type CrmWebsiteChat,
} from "../../lib/crm";
import { readStoredSession } from "../../lib/supabase-auth";
import { fetchClients } from "../../lib/supabase-data";
import type { AuthSession, ClientDetail } from "../../lib/types";

function localInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function dateTimeLabel(value: string | null) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function contactLine(lead: CrmLead) {
  return [lead.email, lead.phone].filter(Boolean).join(" · ") || "No contact method";
}

function WebsiteChatPanel({ chat, displayName, canManage, busy, archiving, reply, onReplyChange, onRefresh, onArchive, onSubmit }: {
  chat: CrmWebsiteChat;
  displayName: string;
  canManage: boolean;
  busy: boolean;
  archiving: boolean;
  reply: string;
  onReplyChange: (value: string) => void;
  onRefresh: () => void;
  onArchive: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <section className="crm-chat" aria-label={`Website chat with ${displayName}`}>
    <header><div><p className="eyebrow">Website chat</p><h3>{displayName}</h3><small>{chat.archivedAt ? "Archived securely — history is preserved" : chat.aiEnabled ? "AI receptionist is assisting" : "Joseph and the team own this reply"}</small></div><div className="crm-chat-header-actions"><button type="button" onClick={onRefresh} aria-label="Refresh website chat">Refresh ↻</button>{canManage && <button type="button" className={`crm-chat-archive ${chat.archivedAt ? "restore" : ""}`} onClick={onArchive} disabled={archiving}>{archiving ? "Saving…" : chat.archivedAt ? "Restore" : "Archive"}</button>}</div></header>
    <div className="crm-chat-contact">
      <span>{chat.leadId ? "Qualified lead" : "Contact details pending"}</span>
      <small>{[chat.visitorEmail, chat.visitorPhone].filter(Boolean).join(" · ") || "The visitor has not shared an email or phone yet."}</small>
    </div>
    <div className="crm-chat-messages" role="log" aria-live="polite">
      {chat.messages.length ? chat.messages.map((chatMessage) => <article className={`crm-chat-message ${chatMessage.direction}`} key={chatMessage.id}><div><strong>{chatMessage.sender_name || (chatMessage.direction === "inbound" ? displayName : "Joseph")}</strong><time>{dateTimeLabel(chatMessage.created_at)}</time></div><p>{chatMessage.body}</p><small>{chatMessage.status}</small></article>) : <p className="crm-inline-empty">The visitor has not sent a message yet.</p>}
    </div>
    {chat.archivedAt ? <p className="crm-chat-archived-notice">Restore this conversation before sending another reply.</p> : canManage && <form className="crm-chat-composer" onSubmit={onSubmit}><label htmlFor={`crm-chat-reply-${chat.conversationId}`}>Reply as Joseph</label><textarea id={`crm-chat-reply-${chat.conversationId}`} maxLength={2000} required value={reply} onChange={(event) => onReplyChange(event.target.value)} placeholder="Write a helpful reply to the website visitor…" /><div><small>Replies appear in the visitor’s current website chat. Sending pauses the AI receptionist for this conversation.</small><button className="button button-dark" disabled={busy}>{busy ? "Sending…" : "Send reply →"}</button></div></form>}
  </section>;
}

const blankLead = { clientId: "", fullName: "", email: "", phone: "", company: "", serviceInterest: "", message: "", source: "website", assignedTo: "" };

export default function CrmPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [clientId, setClientId] = useState("");
  const [snapshot, setSnapshot] = useState<CrmSnapshot | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [leadForm, setLeadForm] = useState(blankLead);
  const [chatReply, setChatReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const allWebsiteChats = useMemo(() => [...(snapshot?.websiteChats || []), ...(snapshot?.archivedWebsiteChats || [])], [snapshot]);
  const conversationSelection = useMemo(
    () => allWebsiteChats.find((chat) => chat.conversationId === selectedConversationId) || null,
    [allWebsiteChats, selectedConversationId],
  );
  const selectedLead = useMemo(() => {
    if (conversationSelection && !conversationSelection.leadId) return null;
    const requestedLeadId = conversationSelection?.leadId || selectedLeadId;
    return snapshot?.leads.find((lead) => lead.id === requestedLeadId) || snapshot?.leads[0] || null;
  }, [conversationSelection, selectedLeadId, snapshot]);
  const selectedWebsiteChat = useMemo(
    () => conversationSelection || allWebsiteChats.find((chat) => chat.leadId === selectedLead?.id) || null,
    [allWebsiteChats, conversationSelection, selectedLead?.id],
  );
  const teamById = useMemo(() => new Map(snapshot?.team.map((member) => [member.id, member.name]) || []), [snapshot]);
  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const selectedActivities = snapshot?.activities.filter((activity) => activity.lead_id === selectedLead?.id).slice(0, 8) || [];
  const selectedTasks = snapshot?.tasks.filter((task) => task.lead_id === selectedLead?.id) || [];
  const selectedAppointments = snapshot?.appointments.filter((appointment) => appointment.lead_id === selectedLead?.id) || [];

  const load = useCallback(async (activeSession: AuthSession, requestedClient = "", requestedLead = "", quiet = false) => {
    if (!quiet) { setLoading(true); setError(""); setMessage(""); }
    try {
      const next = await fetchCrm(activeSession, requestedClient);
      setSnapshot(next);
      setLastUpdatedAt(new Date());
      setSelectedLeadId((current) => {
        if (requestedLead && next.leads.some((lead) => lead.id === requestedLead)) return requestedLead;
        return next.leads.some((lead) => lead.id === current) ? current : next.leads[0]?.id || "";
      });
    } catch (loadError) {
      if (!quiet) {
        setSnapshot(null);
        setError(loadError instanceof Error ? loadError.message : "The CRM workspace could not be loaded.");
      }
    } finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) return;
    setSession(stored);
    void fetchClients().then((rows) => {
      setClients(rows);
      const queryClient = new URLSearchParams(window.location.search).get("client") || "";
      const queryLead = new URLSearchParams(window.location.search).get("lead") || "";
      const queryConversation = new URLSearchParams(window.location.search).get("conversation") || "";
      const initial = rows.some((client) => client.id === queryClient) ? queryClient : "";
      setClientId(initial);
      setSelectedConversationId(queryConversation);
      setLeadForm((current) => ({ ...current, clientId: initial || rows[0]?.id || "" }));
      void load(stored, initial, queryLead);
    }).catch(() => { setLoading(false); setError("Client records could not be loaded."); });
  }, [load]);

  useEffect(() => {
    if (!session || !selectedWebsiteChat?.conversationId) return;
    const timer = window.setInterval(() => {
      void load(session, clientId, selectedWebsiteChat.leadId || "", true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [clientId, load, selectedWebsiteChat?.conversationId, selectedWebsiteChat?.leadId, session]);

  useEffect(() => {
    if (!session) return;
    const refreshVisiblePipeline = () => {
      if (document.visibilityState === "visible") void load(session, clientId, selectedLeadId, true);
    };
    const timer = window.setInterval(refreshVisiblePipeline, 15000);
    window.addEventListener("focus", refreshVisiblePipeline);
    document.addEventListener("visibilitychange", refreshVisiblePipeline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisiblePipeline);
      document.removeEventListener("visibilitychange", refreshVisiblePipeline);
    };
  }, [clientId, load, selectedLeadId, session]);

  const refreshPipeline = async () => {
    if (!session || refreshing) return;
    setRefreshing(true);
    await load(session, clientId, selectedLeadId, true);
    setRefreshing(false);
  };

  const chooseClient = (nextClientId: string) => {
    if (!session) return;
    setClientId(nextClientId); setSelectedLeadId(""); setSelectedConversationId(""); setChatReply("");
    setLeadForm((current) => ({ ...current, clientId: nextClientId || current.clientId || clients[0]?.id || "" }));
    const url = new URL(window.location.href);
    if (nextClientId) url.searchParams.set("client", nextClientId); else url.searchParams.delete("client");
    url.searchParams.delete("lead");
    url.searchParams.delete("conversation");
    window.history.replaceState({}, "", url);
    void load(session, nextClientId);
  };

  const chooseLead = (nextLeadId: string) => {
    setSelectedLeadId(nextLeadId);
    const linkedChat = allWebsiteChats.find((chat) => chat.leadId === nextLeadId);
    setSelectedConversationId(linkedChat?.conversationId || "");
    setChatReply("");
    const url = new URL(window.location.href);
    if (nextLeadId) url.searchParams.set("lead", nextLeadId); else url.searchParams.delete("lead");
    if (linkedChat) url.searchParams.set("conversation", linkedChat.conversationId); else url.searchParams.delete("conversation");
    window.history.replaceState({}, "", url);
  };

  const chooseWebsiteChat = (chat: CrmWebsiteChat) => {
    setSelectedConversationId(chat.conversationId);
    setSelectedLeadId(chat.leadId || "");
    setChatReply("");
    const url = new URL(window.location.href);
    url.searchParams.set("conversation", chat.conversationId);
    if (chat.leadId) url.searchParams.set("lead", chat.leadId); else url.searchParams.delete("lead");
    window.history.replaceState({}, "", url);
  };

  const mutate = async (label: string, input: Record<string, unknown>) => {
    if (!session) return null;
    const mutationClientId = typeof input.clientId === "string" && input.clientId ? input.clientId : clientId;
    if (!mutationClientId) { setError("Choose the account this CRM record belongs to."); return null; }
    setBusy(label); setError(""); setMessage("");
    try {
      const response = await changeCrm(session, { ...input, clientId: mutationClientId });
      const next = await fetchCrm(session, clientId || undefined);
      setSnapshot(next);
      setMessage(response.message || "CRM workflow updated.");
      return next;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "That CRM change could not be saved.");
      return null;
    } finally { setBusy(""); }
  };

  const createLead = async (event: FormEvent) => {
    event.preventDefault();
    const next = await mutate("new-lead", { action: "create_lead", ...leadForm });
    if (next) { setLeadForm({ ...blankLead, clientId: clientId || leadForm.clientId || clients[0]?.id || "" }); setSelectedLeadId(next.leads[0]?.id || ""); }
  };

  const updateLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedLead) return;
    const form = new FormData(event.currentTarget);
    await mutate("lead-update", { action: "update_lead", clientId: selectedLead.client_id, leadId: selectedLead.id, status: form.get("status"), assignedTo: form.get("assignedTo") });
  };

  const sendLeadEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedLead?.email) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const subject = String(form.get("subject") || "").trim();
    const body = String(form.get("body") || "").trim();
    if (!subject || !body) return;
    const next = await mutate("lead-email", {
      action: "send_lead_email",
      clientId: selectedLead.client_id,
      leadId: selectedLead.id,
      subject,
      body,
      requestId: crypto.randomUUID(),
    });
    if (next) formElement.reset();
  };

  const scheduleAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedLead) return;
    const form = new FormData(event.currentTarget);
    const next = await mutate("appointment", {
      action: "schedule_appointment", clientId: selectedLead.client_id, leadId: selectedLead.id, title: form.get("title"), startsAt: form.get("startsAt"), endsAt: form.get("endsAt"),
      location: form.get("location"), notes: form.get("notes"), assignedTo: form.get("assignedTo"), taskTitle: form.get("taskTitle"), taskDueAt: form.get("taskDueAt"), priority: form.get("priority"),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (next) event.currentTarget.reset();
  };

  const replyToWebsiteChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWebsiteChat || !chatReply.trim()) return;
    const next = await mutate("website-chat-reply", { action: "reply_to_website_chat", clientId: selectedWebsiteChat.clientId, leadId: selectedWebsiteChat.leadId || "", conversationId: selectedWebsiteChat.conversationId, body: chatReply });
    if (next) setChatReply("");
  };

  const toggleLeadPin = async () => {
    if (!selectedLead) return;
    await mutate("lead-pin", { action: "toggle_lead_pin", clientId: selectedLead.client_id, leadId: selectedLead.id, pinned: !selectedLead.is_pinned });
  };

  const setWebsiteChatArchived = async () => {
    if (!selectedWebsiteChat) return;
    await mutate("website-chat-archive", { action: "set_website_chat_archived", clientId: selectedWebsiteChat.clientId, conversationId: selectedWebsiteChat.conversationId, archived: !selectedWebsiteChat.archivedAt });
  };

  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const followUp = new Date(end.getTime() + 24 * 60 * 60 * 1000);

  return <Shell active="CRM">
    <div className="page-heading crm-heading">
      <div><p className="eyebrow">Lead operations</p><h1>CRM</h1><p className="lede">Capture every inquiry, assign ownership, schedule the next conversation, and close the follow-up loop.</p></div>
      <div className="crm-heading-actions">
        {clients.length > 0 && <BrandSelect label="View" value={clientId} onChange={chooseClient} options={[{ value: "", label: "All leads", description: "Entire Torres & Co. pipeline" }, ...clients.map((client) => ({ value: client.id, label: client.name, description: [client.industry, client.location].filter(Boolean).join(" · ") || "Client account" }))]} />}
        <div className="crm-live-control">
          <span><i aria-hidden="true" />{lastUpdatedAt ? `Updated ${lastUpdatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Connecting…"}</span>
          <button type="button" onClick={() => void refreshPipeline()} disabled={!session || refreshing} aria-label="Refresh CRM leads">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
            {refreshing ? "Refreshing…" : "Refresh leads"}
          </button>
        </div>
      </div>
    </div>

    {error && <p className="integration-notice crm-error" role="alert">{error}</p>}
    {message && <p className="integration-notice crm-success" role="status">{message}</p>}
    {loading ? <section className="crm-loading"><strong>Loading agency pipeline…</strong><span>Checking assignments, appointments, tasks, and activity.</span></section> : !snapshot ? <section className="empty-state"><h2>CRM is unavailable</h2><p>The agency pipeline could not be loaded.</p></section> : <>
      <section className="crm-summary" aria-label="CRM summary">
        <article><span>Active leads</span><strong>{snapshot.summary.activeLeads}</strong><small>{snapshot.summary.wonLeads} won</small></article>
        <article><span>Unassigned</span><strong>{snapshot.summary.unassigned}</strong><small>Needs an owner</small></article>
        <article><span>Appointments</span><strong>{snapshot.summary.upcomingAppointments}</strong><small>Upcoming</small></article>
        <article><span>Open tasks</span><strong>{snapshot.summary.openTasks}</strong><small className={snapshot.summary.overdueTasks ? "crm-warning" : ""}>{snapshot.summary.overdueTasks} overdue</small></article>
      </section>

      {snapshot.canManage && <details className="crm-composer"><summary><span><b>Capture a lead</b><small>Add a real inquiry and assign the first response.</small></span><i>＋</i></summary><form onSubmit={createLead}>
        <label>Account<select required value={leadForm.clientId} onChange={(event) => setLeadForm({ ...leadForm, clientId: event.target.value })}><option value="">Choose an account</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label>Full name<input required maxLength={180} value={leadForm.fullName} onChange={(event) => setLeadForm({ ...leadForm, fullName: event.target.value })} /></label>
        <label>Email<input type="email" maxLength={320} value={leadForm.email} onChange={(event) => setLeadForm({ ...leadForm, email: event.target.value })} /></label>
        <label>Phone<input type="tel" maxLength={60} value={leadForm.phone} onChange={(event) => setLeadForm({ ...leadForm, phone: event.target.value })} /></label>
        <label>Company<input maxLength={180} value={leadForm.company} onChange={(event) => setLeadForm({ ...leadForm, company: event.target.value })} /></label>
        <label>Service interest<input maxLength={240} value={leadForm.serviceInterest} onChange={(event) => setLeadForm({ ...leadForm, serviceInterest: event.target.value })} /></label>
        <label>Source<select value={leadForm.source} onChange={(event) => setLeadForm({ ...leadForm, source: event.target.value })}>{LEAD_SOURCES.map((source) => <option key={source} value={source}>{labelCrmValue(source)}</option>)}</select></label>
        <label>Assign to<select value={leadForm.assignedTo} onChange={(event) => setLeadForm({ ...leadForm, assignedTo: event.target.value })}><option value="">Unassigned</option>{snapshot.team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="crm-wide">Inquiry details<textarea maxLength={4000} value={leadForm.message} onChange={(event) => setLeadForm({ ...leadForm, message: event.target.value })} /></label>
        <p className="crm-form-note">A name and either email or phone are required.</p><button className="button button-dark" disabled={busy === "new-lead"}>{busy === "new-lead" ? "Saving…" : "Add lead →"}</button>
      </form></details>}

      {snapshot.websiteChats.length > 0 && <section className="crm-chat-queue" aria-label="Website conversations">
        <div className="crm-section-title"><div><p className="eyebrow">Website intake</p><h2>Website conversations</h2><p>New widget chats stay visible here while contact details are being collected.</p></div><span>{snapshot.websiteChats.length}</span></div>
        <div className="crm-chat-queue-grid">{snapshot.websiteChats.map((chat) => <button type="button" key={chat.conversationId} className={chat.conversationId === selectedWebsiteChat?.conversationId ? "active" : ""} onClick={() => chooseWebsiteChat(chat)}><span className="crm-chat-queue-avatar">{chat.visitorName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "WV"}</span><span><strong>{chat.visitorName}</strong><small>{clientById.get(chat.clientId) || "Website chat"}</small><em>{chat.latestMessage}</em></span><span className={chat.leadId ? "qualified" : "pending"}>{chat.leadId ? "Lead" : "Needs contact"}</span><time>{dateTimeLabel(chat.lastMessageAt)}</time></button>)}</div>
      </section>}

      {snapshot.archivedWebsiteChats.length > 0 && <details className="crm-chat-queue is-archived">
        <summary><span>Archived website conversations</span><b>{snapshot.archivedWebsiteChats.length}</b></summary>
        <div className="crm-chat-queue-grid">{snapshot.archivedWebsiteChats.map((chat) => <button type="button" key={chat.conversationId} className={chat.conversationId === selectedWebsiteChat?.conversationId ? "active" : ""} onClick={() => chooseWebsiteChat(chat)}><span className="crm-chat-queue-avatar">{chat.visitorName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "WV"}</span><span><strong>{chat.visitorName}</strong><small>{clientById.get(chat.clientId) || "Website chat"}</small><em>{chat.latestMessage}</em></span><span className="pending">Archived</span><time>{dateTimeLabel(chat.lastMessageAt)}</time></button>)}</div>
      </details>}

      {snapshot.leads.length === 0 && allWebsiteChats.length === 0 ? <section className="empty-state crm-empty"><p className="eyebrow">Pipeline ready</p><h2>No leads yet</h2><p>Form submissions and website conversations will appear here automatically.</p></section> : <div className="crm-layout">
        <aside className="crm-pipeline" aria-label="Lead pipeline">
          <div className="crm-section-title"><div><p className="eyebrow">Pipeline</p><h2>Leads</h2></div><span>{snapshot.leads.length}</span></div>
          {!snapshot.leads.length && <p className="crm-inline-empty">No visitor has shared enough contact information to become a lead yet.</p>}
          {LEAD_STATUSES.map((status) => {
            const leads = sortCrmLeads(snapshot.leads.filter((lead) => lead.status === status));
            if (!leads.length) return null;
            return <section className="crm-stage" key={status}><header><strong>{labelCrmValue(status)}</strong><span>{leads.length}</span></header>{leads.map((lead) => <button key={lead.id} type="button" className={lead.id === selectedLead?.id ? "active" : ""} onClick={() => chooseLead(lead.id)}><span className="crm-lead-avatar">{lead.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span><strong>{lead.full_name}{lead.is_pinned && <em className="crm-lead-pinned-marker" aria-label="Pinned lead">★</em>}</strong><small>{clientById.get(lead.client_id) || lead.email || lead.phone || "Client account"}</small></span><i>{lead.assigned_to ? teamById.get(lead.assigned_to)?.split(" ")[0] || "Assigned" : "Unassigned"}</i></button>)}</section>;
          })}
        </aside>

        {selectedWebsiteChat && !selectedLead && <main className="crm-workspace crm-chat-workspace">
          <section className="crm-lead-hero"><div><p className="eyebrow">{clientById.get(selectedWebsiteChat.clientId) || "Website"} · pre-qualification chat</p><h2>{selectedWebsiteChat.visitorName}</h2><p>Contact details have not been provided yet.</p><small>Keep the conversation here until the visitor shares an email or phone; the system will then create the formal CRM lead.</small></div><span className="crm-stage-pill">Website chat</span></section>
          <WebsiteChatPanel chat={selectedWebsiteChat} displayName={selectedWebsiteChat.visitorName} canManage={snapshot.canManage} busy={busy === "website-chat-reply"} archiving={busy === "website-chat-archive"} reply={chatReply} onReplyChange={setChatReply} onRefresh={() => session && void load(session, clientId, "", true)} onArchive={() => void setWebsiteChatArchived()} onSubmit={replyToWebsiteChat} />
        </main>}

        {selectedLead && <main className="crm-workspace">
          <section className="crm-lead-hero"><div><p className="eyebrow">{clientById.get(selectedLead.client_id) || "Client account"} · {labelCrmValue(selectedLead.source)} lead</p><h2>{selectedLead.full_name}</h2><p>{contactLine(selectedLead)}</p><small>{[selectedLead.company, selectedLead.service_interest].filter(Boolean).join(" · ") || "No company or service noted"}</small></div><div className="crm-lead-hero-actions">{snapshot.canManage && <button type="button" className={`crm-pin-button ${selectedLead.is_pinned ? "active" : ""}`} onClick={() => void toggleLeadPin()} disabled={busy === "lead-pin"}>{busy === "lead-pin" ? "Saving…" : selectedLead.is_pinned ? "★ Pinned" : "☆ Pin lead"}</button>}<span className={`crm-stage-pill ${selectedLead.status}`}>{labelCrmValue(selectedLead.status)}</span></div></section>

          {selectedLead.message && <section className="crm-note"><p className="eyebrow">Inquiry</p><p>{selectedLead.message}</p></section>}

          {selectedWebsiteChat && <WebsiteChatPanel chat={selectedWebsiteChat} displayName={selectedLead.full_name} canManage={snapshot.canManage} busy={busy === "website-chat-reply"} archiving={busy === "website-chat-archive"} reply={chatReply} onReplyChange={setChatReply} onRefresh={() => session && void load(session, clientId, selectedLead.id, true)} onArchive={() => void setWebsiteChatArchived()} onSubmit={replyToWebsiteChat} />}

          {snapshot.canManage && selectedLead.email && <section className="crm-email-composer">
            <div className="crm-email-composer-heading">
              <div><p className="eyebrow">Direct email</p><h3>Reply from the CRM</h3><p>Send a tracked response to {selectedLead.email} without leaving the lead record.</p></div>
              <span>Provider tracked</span>
            </div>
            <form key={selectedLead.id} onSubmit={sendLeadEmail}>
              <label>Subject<input name="subject" required maxLength={160} defaultValue={`Re: ${selectedLead.service_interest || "your inquiry"}`} /></label>
              <label>Message<textarea name="body" required maxLength={6000} rows={7} placeholder={`Hi ${selectedLead.full_name.split(" ")[0]},\n\n`} /></label>
              <div className="crm-email-composer-actions">
                <small>The Torres &amp; Co. signature and confidentiality notice are added automatically. Customer replies return to the configured reply-to inbox.</small>
                <button className="button button-dark" disabled={busy === "lead-email"}>{busy === "lead-email" ? "Sending…" : "Send email →"}</button>
              </div>
            </form>
          </section>}

          {snapshot.canManage && <form className="crm-control-row" key={selectedLead.id} onSubmit={updateLead}><label>Pipeline stage<select name="status" defaultValue={selectedLead.status}>{LEAD_STATUSES.map((status) => <option key={status} value={status}>{labelCrmValue(status)}</option>)}</select></label><label>Owner<select name="assignedTo" defaultValue={selectedLead.assigned_to || ""}><option value="">Unassigned</option>{snapshot.team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><button className="button button-dark" disabled={busy === "lead-update"}>{busy === "lead-update" ? "Saving…" : "Update lead →"}</button></form>}

          <div className="crm-work-grid">
            <section className="crm-panel"><div className="crm-section-title"><div><p className="eyebrow">Appointments</p><h3>Next conversations</h3></div><span>{selectedAppointments.length}</span></div>{selectedAppointments.length ? selectedAppointments.map((appointment) => <article className="crm-list-item" key={appointment.id}><div><strong>{appointment.title}</strong><p>{dateTimeLabel(appointment.starts_at)}{appointment.location ? ` · ${appointment.location}` : ""}</p><small>{labelCrmValue(appointment.status)} · {appointment.assigned_to ? teamById.get(appointment.assigned_to) || "Assigned" : "Unassigned"}</small></div>{snapshot.canManage && appointment.status === "scheduled" && <div className="crm-row-actions"><button disabled={busy === appointment.id} onClick={() => void mutate(appointment.id, { action: "update_appointment", clientId: selectedLead.client_id, appointmentId: appointment.id, status: "completed" })}>Complete</button><button disabled={busy === appointment.id} onClick={() => void mutate(appointment.id, { action: "update_appointment", clientId: selectedLead.client_id, appointmentId: appointment.id, status: "canceled" })}>Cancel</button></div>}</article>) : <p className="crm-inline-empty">No appointment scheduled.</p>}</section>
            <section className="crm-panel"><div className="crm-section-title"><div><p className="eyebrow">Follow-up</p><h3>Tasks</h3></div><span>{selectedTasks.filter((task) => !["completed", "canceled"].includes(task.status)).length}</span></div>{selectedTasks.length ? selectedTasks.map((task) => <article className="crm-list-item" key={task.id}><div><strong>{task.title}</strong><p>{dateTimeLabel(task.due_at)}</p><small>{labelCrmValue(task.priority)} · {task.assigned_to ? teamById.get(task.assigned_to) || "Assigned" : "Unassigned"}</small></div>{snapshot.canManage && <select aria-label={`Status for ${task.title}`} disabled={busy === task.id} value={task.status} onChange={(event) => void mutate(task.id, { action: "update_task", clientId: selectedLead.client_id, taskId: task.id, status: event.target.value })}>{TASK_STATUSES.map((status) => <option key={status} value={status}>{labelCrmValue(status)}</option>)}</select>}</article>) : <p className="crm-inline-empty">No follow-up tasks yet.</p>}</section>
          </div>

          {snapshot.canManage && <details className="crm-appointment-form"><summary>Schedule appointment and follow-up <span>＋</span></summary><form onSubmit={scheduleAppointment}>
            <label>Appointment title<input name="title" required defaultValue={`Discovery call with ${selectedLead.full_name}`} /></label><label>Owner<select name="assignedTo" defaultValue={selectedLead.assigned_to || snapshot.team[0]?.id || ""} required><option value="">Choose an owner</option>{snapshot.team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
            <label>Starts<input name="startsAt" type="datetime-local" required defaultValue={localInputValue(start)} /></label><label>Ends<input name="endsAt" type="datetime-local" required defaultValue={localInputValue(end)} /></label><label>Location / meeting link<input name="location" maxLength={500} /></label><label>Follow-up task<input name="taskTitle" defaultValue="Send recap and next steps" required /></label><label>Task due<input name="taskDueAt" type="datetime-local" defaultValue={localInputValue(followUp)} /></label><label>Priority<select name="priority" defaultValue="normal">{TASK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{labelCrmValue(priority)}</option>)}</select></label><label className="crm-wide">Appointment notes<textarea name="notes" maxLength={4000} /></label><button className="button button-dark" disabled={busy === "appointment"}>{busy === "appointment" ? "Scheduling…" : "Schedule and create follow-up →"}</button>
          </form></details>}

          <section className="crm-panel crm-activity"><div className="crm-section-title"><div><p className="eyebrow">Activity trail</p><h3>What happened</h3></div><span>{selectedActivities.length}</span></div>{selectedActivities.length ? selectedActivities.map((activity) => <article key={activity.id}><i aria-hidden="true" /><div><strong>{activity.title}</strong><p>{activity.detail}</p></div><time>{dateTimeLabel(activity.created_at)}</time></article>) : <p className="crm-inline-empty">Activity appears as the team advances this lead.</p>}</section>
        </main>}
      </div>}
    </>}
  </Shell>;
}
