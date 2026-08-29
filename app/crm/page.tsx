"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
  type CrmLead,
  type CrmSnapshot,
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

const blankLead = { fullName: "", email: "", phone: "", company: "", serviceInterest: "", message: "", source: "website", assignedTo: "" };

export default function CrmPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [clientId, setClientId] = useState("");
  const [snapshot, setSnapshot] = useState<CrmSnapshot | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [leadForm, setLeadForm] = useState(blankLead);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedLead = useMemo(
    () => snapshot?.leads.find((lead) => lead.id === selectedLeadId) || snapshot?.leads[0] || null,
    [snapshot, selectedLeadId],
  );
  const teamById = useMemo(() => new Map(snapshot?.team.map((member) => [member.id, member.name]) || []), [snapshot]);
  const selectedActivities = snapshot?.activities.filter((activity) => activity.lead_id === selectedLead?.id).slice(0, 8) || [];
  const selectedTasks = snapshot?.tasks.filter((task) => task.lead_id === selectedLead?.id) || [];
  const selectedAppointments = snapshot?.appointments.filter((appointment) => appointment.lead_id === selectedLead?.id) || [];

  const load = async (activeSession: AuthSession, requestedClient: string) => {
    if (!requestedClient) { setLoading(false); return; }
    setLoading(true); setError(""); setMessage("");
    try {
      const next = await fetchCrm(activeSession, requestedClient);
      setSnapshot(next);
      setSelectedLeadId((current) => next.leads.some((lead) => lead.id === current) ? current : next.leads[0]?.id || "");
    } catch (loadError) {
      setSnapshot(null);
      setError(loadError instanceof Error ? loadError.message : "The CRM workspace could not be loaded.");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) return;
    setSession(stored);
    void fetchClients().then((rows) => {
      setClients(rows);
      const queryClient = new URLSearchParams(window.location.search).get("client") || "";
      const initial = rows.some((client) => client.id === queryClient) ? queryClient : rows[0]?.id || "";
      setClientId(initial);
      if (initial) void load(stored, initial); else setLoading(false);
    }).catch(() => { setLoading(false); setError("Client records could not be loaded."); });
  }, []);

  const chooseClient = (nextClientId: string) => {
    if (!session) return;
    setClientId(nextClientId); setSelectedLeadId("");
    const url = new URL(window.location.href);
    url.searchParams.set("client", nextClientId);
    window.history.replaceState({}, "", url);
    void load(session, nextClientId);
  };

  const mutate = async (label: string, input: Record<string, unknown>) => {
    if (!session || !clientId) return null;
    setBusy(label); setError(""); setMessage("");
    try {
      const response = await changeCrm(session, { clientId, ...input });
      const next = response.snapshot as CrmSnapshot;
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
    if (next) { setLeadForm(blankLead); setSelectedLeadId(next.leads[0]?.id || ""); }
  };

  const updateLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedLead) return;
    const form = new FormData(event.currentTarget);
    await mutate("lead-update", { action: "update_lead", leadId: selectedLead.id, status: form.get("status"), assignedTo: form.get("assignedTo") });
  };

  const scheduleAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedLead) return;
    const form = new FormData(event.currentTarget);
    const next = await mutate("appointment", {
      action: "schedule_appointment", leadId: selectedLead.id, title: form.get("title"), startsAt: form.get("startsAt"), endsAt: form.get("endsAt"),
      location: form.get("location"), notes: form.get("notes"), assignedTo: form.get("assignedTo"), taskTitle: form.get("taskTitle"), taskDueAt: form.get("taskDueAt"), priority: form.get("priority"),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (next) event.currentTarget.reset();
  };

  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const followUp = new Date(end.getTime() + 24 * 60 * 60 * 1000);

  return <Shell active="CRM">
    <div className="page-heading crm-heading">
      <div><p className="eyebrow">Lead operations</p><h1>CRM</h1><p className="lede">Capture every inquiry, assign ownership, schedule the next conversation, and close the follow-up loop.</p></div>
      {clients.length > 0 && <BrandSelect label="Client" value={clientId} onChange={chooseClient} options={clients.map((client) => ({ value: client.id, label: client.name, description: [client.industry, client.location].filter(Boolean).join(" · ") || "Client account" }))} />}
    </div>

    {error && <p className="integration-notice crm-error" role="alert">{error}</p>}
    {message && <p className="integration-notice crm-success" role="status">{message}</p>}
    {loading ? <section className="crm-loading"><strong>Loading client pipeline…</strong><span>Checking assignments, appointments, tasks, and activity.</span></section> : !snapshot ? <section className="empty-state"><h2>Choose a client to open CRM</h2><p>The lead pipeline is kept separate for every client account.</p></section> : <>
      <section className="crm-summary" aria-label="CRM summary">
        <article><span>Active leads</span><strong>{snapshot.summary.activeLeads}</strong><small>{snapshot.summary.wonLeads} won</small></article>
        <article><span>Unassigned</span><strong>{snapshot.summary.unassigned}</strong><small>Needs an owner</small></article>
        <article><span>Appointments</span><strong>{snapshot.summary.upcomingAppointments}</strong><small>Upcoming</small></article>
        <article><span>Open tasks</span><strong>{snapshot.summary.openTasks}</strong><small className={snapshot.summary.overdueTasks ? "crm-warning" : ""}>{snapshot.summary.overdueTasks} overdue</small></article>
      </section>

      {snapshot.canManage && <details className="crm-composer"><summary><span><b>Capture a lead</b><small>Add a real inquiry and assign the first response.</small></span><i>＋</i></summary><form onSubmit={createLead}>
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

      {snapshot.leads.length === 0 ? <section className="empty-state crm-empty"><p className="eyebrow">Pipeline ready</p><h2>No leads yet</h2><p>Use “Capture a lead” when the first real inquiry arrives. No demo contacts are inserted.</p></section> : <div className="crm-layout">
        <aside className="crm-pipeline" aria-label="Lead pipeline">
          <div className="crm-section-title"><div><p className="eyebrow">Pipeline</p><h2>Leads</h2></div><span>{snapshot.leads.length}</span></div>
          {LEAD_STATUSES.map((status) => {
            const leads = snapshot.leads.filter((lead) => lead.status === status);
            if (!leads.length) return null;
            return <section className="crm-stage" key={status}><header><strong>{labelCrmValue(status)}</strong><span>{leads.length}</span></header>{leads.map((lead) => <button key={lead.id} type="button" className={lead.id === selectedLead?.id ? "active" : ""} onClick={() => setSelectedLeadId(lead.id)}><span className="crm-lead-avatar">{lead.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span><strong>{lead.full_name}</strong><small>{lead.email || lead.phone || lead.service_interest || lead.company || labelCrmValue(lead.source)}</small></span><i>{lead.assigned_to ? teamById.get(lead.assigned_to)?.split(" ")[0] || "Assigned" : "Unassigned"}</i></button>)}</section>;
          })}
        </aside>

        {selectedLead && <main className="crm-workspace">
          <section className="crm-lead-hero"><div><p className="eyebrow">{labelCrmValue(selectedLead.source)} lead</p><h2>{selectedLead.full_name}</h2><p>{contactLine(selectedLead)}</p><small>{[selectedLead.company, selectedLead.service_interest].filter(Boolean).join(" · ") || "No company or service noted"}</small></div><span className={`crm-stage-pill ${selectedLead.status}`}>{labelCrmValue(selectedLead.status)}</span></section>

          {selectedLead.message && <section className="crm-note"><p className="eyebrow">Inquiry</p><p>{selectedLead.message}</p></section>}

          {snapshot.canManage && <form className="crm-control-row" key={selectedLead.id} onSubmit={updateLead}><label>Pipeline stage<select name="status" defaultValue={selectedLead.status}>{LEAD_STATUSES.map((status) => <option key={status} value={status}>{labelCrmValue(status)}</option>)}</select></label><label>Owner<select name="assignedTo" defaultValue={selectedLead.assigned_to || ""}><option value="">Unassigned</option>{snapshot.team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><button className="button button-dark" disabled={busy === "lead-update"}>{busy === "lead-update" ? "Saving…" : "Update lead →"}</button></form>}

          <div className="crm-work-grid">
            <section className="crm-panel"><div className="crm-section-title"><div><p className="eyebrow">Appointments</p><h3>Next conversations</h3></div><span>{selectedAppointments.length}</span></div>{selectedAppointments.length ? selectedAppointments.map((appointment) => <article className="crm-list-item" key={appointment.id}><div><strong>{appointment.title}</strong><p>{dateTimeLabel(appointment.starts_at)}{appointment.location ? ` · ${appointment.location}` : ""}</p><small>{labelCrmValue(appointment.status)} · {appointment.assigned_to ? teamById.get(appointment.assigned_to) || "Assigned" : "Unassigned"}</small></div>{snapshot.canManage && appointment.status === "scheduled" && <div className="crm-row-actions"><button disabled={busy === appointment.id} onClick={() => void mutate(appointment.id, { action: "update_appointment", appointmentId: appointment.id, status: "completed" })}>Complete</button><button disabled={busy === appointment.id} onClick={() => void mutate(appointment.id, { action: "update_appointment", appointmentId: appointment.id, status: "canceled" })}>Cancel</button></div>}</article>) : <p className="crm-inline-empty">No appointment scheduled.</p>}</section>
            <section className="crm-panel"><div className="crm-section-title"><div><p className="eyebrow">Follow-up</p><h3>Tasks</h3></div><span>{selectedTasks.filter((task) => !["completed", "canceled"].includes(task.status)).length}</span></div>{selectedTasks.length ? selectedTasks.map((task) => <article className="crm-list-item" key={task.id}><div><strong>{task.title}</strong><p>{dateTimeLabel(task.due_at)}</p><small>{labelCrmValue(task.priority)} · {task.assigned_to ? teamById.get(task.assigned_to) || "Assigned" : "Unassigned"}</small></div>{snapshot.canManage && <select aria-label={`Status for ${task.title}`} disabled={busy === task.id} value={task.status} onChange={(event) => void mutate(task.id, { action: "update_task", taskId: task.id, status: event.target.value })}>{TASK_STATUSES.map((status) => <option key={status} value={status}>{labelCrmValue(status)}</option>)}</select>}</article>) : <p className="crm-inline-empty">No follow-up tasks yet.</p>}</section>
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
