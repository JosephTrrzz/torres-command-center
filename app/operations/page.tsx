"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AddToCalendar } from "../../components/add-to-calendar";
import { BrandSelect } from "../../components/brand-select";
import { Shell } from "../../components/shell";
import { LoadingRegion } from "../../components/loading-system";
import { appRoleForOrganizationRole } from "../../lib/access-control";
import { changeAppleCalendar } from "../../lib/calendar-api";
import { changeOperations, fetchOperations } from "../../lib/operations-api";
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  JOB_PRIORITIES,
  JOB_STATUSES,
  calculateEstimate,
  labelOperationsValue,
  money,
  type OperationsSnapshot,
  type ServiceJob,
} from "../../lib/operations";
import { readStoredSession } from "../../lib/supabase-auth";
import { fetchClients } from "../../lib/supabase-data";
import type { AuthSession, ClientDetail } from "../../lib/types";

type EstimateDraftItem = { description: string; quantity: string; unitPrice: string };

function dateTimeLabel(value: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function dateOnlyLabel(value: string | null) {
  if (!value) return "No expiration";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function addressLabel(location: OperationsSnapshot["locations"][number]) {
  return [location.address_line_1, location.city, location.region, location.postal_code].filter(Boolean).join(", ") || "Address not added";
}

export default function OperationsPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [appleCalendarUrl, setAppleCalendarUrl] = useState("");
  const [appleCalendarHttpsUrl, setAppleCalendarHttpsUrl] = useState("");
  const [jobForm, setJobForm] = useState({ title: "", description: "", leadId: "", projectId: "", priority: "normal", assignedTo: "", locationId: "", scheduledStart: "", scheduledEnd: "", clientVisible: true });
  const [locationForm, setLocationForm] = useState({ label: "", addressLine1: "", city: "", region: "", postalCode: "", country: "US", accessNotes: "", isPrimary: false });
  const [noteForm, setNoteForm] = useState({ title: "", detail: "", clientVisible: false });
  const [taskForm, setTaskForm] = useState({ title: "", description: "", dueAt: "", priority: "normal", assignedTo: "" });
  const [estimateForm, setEstimateForm] = useState({ title: "", expiresAt: "", taxRate: "0", notes: "" });
  const [estimateItems, setEstimateItems] = useState<EstimateDraftItem[]>([{ description: "", quantity: "1", unitPrice: "0" }]);
  const [documentForm, setDocumentForm] = useState({ title: "", description: "", documentType: "proposal", resourceUrl: "", clientVisible: true });

  const selectedJob = useMemo(() => snapshot?.jobs.find((job) => job.id === selectedJobId) || snapshot?.jobs[0] || null, [snapshot, selectedJobId]);
  const estimatePreview = useMemo(() => calculateEstimate(estimateItems.map((item) => ({ quantity: Number(item.quantity || 0), unitPrice: Number(item.unitPrice || 0) })), Number(estimateForm.taxRate || 0) / 100), [estimateForm.taxRate, estimateItems]);
  const isClient = session ? appRoleForOrganizationRole(session.organization?.role, session.profile.role) === "customer" : false;

  const loadWorkspace = async (activeSession: AuthSession, clientId?: string) => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchOperations(activeSession, clientId || undefined);
      const queryJob = new URLSearchParams(window.location.search).get("job") || "";
      setSnapshot(next);
      setSelectedJobId((current) => next.jobs.some((job) => job.id === queryJob) ? queryJob : next.jobs.some((job) => job.id === current) ? current : next.jobs[0]?.id || "");
    } catch (loadError) {
      setSnapshot(null);
      setError(loadError instanceof Error ? loadError.message : "The operations workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) return;
    setSession(stored);
    const role = appRoleForOrganizationRole(stored.organization?.role, stored.profile.role);
    if (role === "customer") {
      void loadWorkspace(stored);
      return;
    }
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

  const chooseClient = (clientId: string) => {
    if (!session) return;
    setSelectedClientId(clientId);
    setMessage("");
    setAppleCalendarUrl("");
    setAppleCalendarHttpsUrl("");
    const url = new URL(window.location.href);
    url.searchParams.set("client", clientId);
    url.searchParams.delete("job");
    window.history.replaceState({}, "", url);
    void loadWorkspace(session, clientId);
  };

  const updateAppleCalendar = async (action: "create" | "revoke") => {
    if (!session || !snapshot) return;
    setBusy(`apple-calendar-${action}`);
    setError("");
    setMessage("");
    try {
      const response = await changeAppleCalendar(session, snapshot.client.id || selectedClientId, action);
      if (action === "create") {
        setAppleCalendarUrl(response.subscriptionUrl || "");
        setAppleCalendarHttpsUrl(response.httpsUrl || "");
      } else {
        setAppleCalendarUrl("");
        setAppleCalendarHttpsUrl("");
      }
      setMessage(response.message || "Apple Calendar updated.");
    } catch (calendarError) {
      setError(calendarError instanceof Error ? calendarError.message : "Apple Calendar could not be updated.");
    } finally {
      setBusy("");
    }
  };

  const copyAppleCalendarLink = async () => {
    if (!appleCalendarHttpsUrl) return;
    try {
      await navigator.clipboard.writeText(appleCalendarHttpsUrl);
      setMessage("Private Apple Calendar link copied.");
    } catch {
      setError("The private link could not be copied. Select it and copy it manually.");
    }
  };

  const chooseJob = (jobId: string) => {
    setSelectedJobId(jobId);
    const url = new URL(window.location.href);
    url.searchParams.set("job", jobId);
    window.history.replaceState({}, "", url);
  };

  const mutate = async (label: string, input: Record<string, unknown>) => {
    if (!session || !snapshot) return null;
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const response = await changeOperations(session, { clientId: snapshot.client.id || selectedClientId, ...input });
      const next = response.snapshot as OperationsSnapshot;
      setSnapshot(next);
      setSelectedJobId((current) => next.jobs.some((job) => job.id === current) ? current : next.jobs[0]?.id || "");
      setMessage(response.message || "Operations workspace updated.");
      return next;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "That change could not be saved.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const createJob = async (event: FormEvent) => {
    event.preventDefault();
    const next = await mutate("create-job", { action: "create_job", ...jobForm });
    if (next) {
      setJobForm({ title: "", description: "", leadId: "", projectId: "", priority: "normal", assignedTo: "", locationId: "", scheduledStart: "", scheduledEnd: "", clientVisible: true });
      setSelectedJobId(next.jobs[0]?.id || "");
    }
  };

  const createLocation = async (event: FormEvent) => {
    event.preventDefault();
    if (await mutate("location", { action: "create_location", ...locationForm })) setLocationForm({ label: "", addressLine1: "", city: "", region: "", postalCode: "", country: "US", accessNotes: "", isPrimary: false });
  };

  const updateJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedJob) return;
    const form = new FormData(event.currentTarget);
    await mutate("update-job", { action: "update_job", jobId: selectedJob.id, status: form.get("status"), priority: form.get("priority"), assignedTo: form.get("assignedTo"), locationId: form.get("locationId"), scheduledStart: form.get("scheduledStart"), scheduledEnd: form.get("scheduledEnd"), clientVisible: form.get("clientVisible") === "on" });
  };

  const addNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedJob) return;
    if (await mutate("note", { action: "add_job_note", jobId: selectedJob.id, ...noteForm })) setNoteForm({ title: "", detail: "", clientVisible: false });
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedJob) return;
    if (await mutate("task", { action: "create_job_task", jobId: selectedJob.id, ...taskForm })) setTaskForm({ title: "", description: "", dueAt: "", priority: "normal", assignedTo: "" });
  };

  const createEstimate = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedJob) return;
    const items = estimateItems.map((item) => ({ description: item.description, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) }));
    if (await mutate("estimate", { action: "create_estimate", jobId: selectedJob.id, ...estimateForm, taxRate: Number(estimateForm.taxRate || 0) / 100, items })) {
      setEstimateForm({ title: "", expiresAt: "", taxRate: "0", notes: "" });
      setEstimateItems([{ description: "", quantity: "1", unitPrice: "0" }]);
    }
  };

  const createDocument = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedJob) return;
    if (await mutate("document", { action: "add_document", jobId: selectedJob.id, ...documentForm })) setDocumentForm({ title: "", description: "", documentType: "proposal", resourceUrl: "", clientVisible: true });
  };

  return <Shell active="Operations">
    <div className="page-heading operations-heading">
      <div><p className="eyebrow">Service delivery</p><h1>Operations</h1><p className="lede">Turn won work into scheduled service, clear approvals, shared documents, and a client-visible record.</p></div>
      {clients.length > 0 && snapshot?.canManage && <BrandSelect label="Client" value={selectedClientId} onChange={chooseClient} options={clients.map((client) => ({ value: client.id, label: client.name, description: [client.industry, client.location].filter(Boolean).join(" · ") || "Client workspace" }))} />}
    </div>

    {error && <p className="integration-notice operations-error" role="alert">{error}</p>}
    {message && <p className="integration-notice operations-success" role="status">{message}</p>}
    {loading ? <LoadingRegion active label="Loading operations workspace" variant="operations" /> : !snapshot ? <section className="empty-state"><h2>Operations workspace unavailable</h2><p>Choose a client or apply the Phase 3 operations migration.</p></section> : <>
      <section className="operations-summary" aria-label="Operations summary">
        <div><span>Active jobs</span><strong>{snapshot.summary.activeJobs}</strong><small>In the delivery queue</small></div>
        <div><span>Upcoming</span><strong>{snapshot.summary.upcomingJobs}</strong><small>Scheduled service</small></div>
        <div><span>Awaiting approval</span><strong>{snapshot.summary.pendingEstimates}</strong><small>Sent estimates</small></div>
        <div><span>Accepted value</span><strong>{money(snapshot.summary.acceptedValue)}</strong><small>Approved estimates</small></div>
        <div><span>Shared files</span><strong>{snapshot.summary.sharedDocuments}</strong><small>Client-visible documents</small></div>
        <div className={snapshot.summary.urgentJobs ? "urgent" : ""}><span>Urgent</span><strong>{snapshot.summary.urgentJobs}</strong><small>Needs attention</small></div>
      </section>

      <section className="customer-360 operations-panel">
        <div className="operations-section-heading operations-customer-heading">
          <div>
            <p className="eyebrow">Customer 360</p>
            <h2>{snapshot.client.name}</h2>
            <p>{[snapshot.client.industry, snapshot.client.location].filter(Boolean).join(" · ") || "Customer profile"}</p>
          </div>
          {snapshot.client.website && <a className="operations-website-link" href={snapshot.client.website} target="_blank" rel="noreferrer">Open website <span aria-hidden="true">↗︎</span></a>}
        </div>

        <div className="operations-customer-grid">
          <article className="operations-overview-card">
            <header><div><span>People</span><h3>Contacts</h3></div><strong>{snapshot.contacts.length}</strong></header>
            <div className="operations-detail-list">
              {snapshot.contacts.length ? snapshot.contacts.map((contact) => <div key={contact.id}><b>{contact.name}</b><small>{[contact.role, contact.email, contact.phone].filter(Boolean).join(" · ") || "Contact details not added"}</small></div>) : <p>No contacts have been added yet.</p>}
            </div>
          </article>

          <article className="operations-overview-card">
            <header><div><span>Service footprint</span><h3>Locations</h3></div><strong>{snapshot.locations.length}</strong></header>
            <div className="operations-detail-list">
              {snapshot.locations.length ? snapshot.locations.map((location) => <div key={location.id}><b>{location.label}{location.is_primary ? <em>Primary</em> : null}</b><small>{addressLabel(location) || "Address not added"}</small></div>) : <p>No service locations have been added yet.</p>}
            </div>
          </article>

          <article className="operations-overview-card operations-pipeline-card">
            <header><div><span>Sales to delivery</span><h3>Pipeline handoff</h3></div></header>
            <div className="operations-handoff-metrics">
              <div><strong>{snapshot.leads.length}</strong><span>Won leads</span><small>Ready to convert into service work</small></div>
              <div><strong>{snapshot.projects.length}</strong><span>Linked projects</span><small>Connected to this customer record</small></div>
            </div>
          </article>
        </div>

        {snapshot.canManage && <div className="operations-next-actions">
          <div className="operations-next-actions-heading"><div><p className="eyebrow">Next actions</p><h3>Move this customer into delivery</h3></div><p>Add another service address or open a job with scheduling, approvals, and documents.</p></div>
          <div className="operations-quick-actions">
            <details className="operations-composer"><summary><span><small>Customer record</small><strong>Add customer location</strong></span><b aria-hidden="true">＋</b></summary><form className="operations-form" onSubmit={createLocation}><label>Location name<input required value={locationForm.label} onChange={(event) => setLocationForm({ ...locationForm, label: event.target.value })} placeholder="Main office" /></label><label>Street address<input value={locationForm.addressLine1} onChange={(event) => setLocationForm({ ...locationForm, addressLine1: event.target.value })} /></label><label>City<input value={locationForm.city} onChange={(event) => setLocationForm({ ...locationForm, city: event.target.value })} /></label><label>State / region<input value={locationForm.region} onChange={(event) => setLocationForm({ ...locationForm, region: event.target.value })} /></label><label>Postal code<input value={locationForm.postalCode} onChange={(event) => setLocationForm({ ...locationForm, postalCode: event.target.value })} /></label><label>Country<input maxLength={2} value={locationForm.country} onChange={(event) => setLocationForm({ ...locationForm, country: event.target.value.toUpperCase() })} /></label><label className="operations-form-wide">Access or service notes<textarea value={locationForm.accessNotes} onChange={(event) => setLocationForm({ ...locationForm, accessNotes: event.target.value })} /></label><label className="operations-check"><input type="checkbox" checked={locationForm.isPrimary} onChange={(event) => setLocationForm({ ...locationForm, isPrimary: event.target.checked })} /> Primary location</label><button className="button button-dark" disabled={busy === "location"}>Save location →︎</button></form></details>
            <details className="operations-composer operations-job-composer"><summary><span><small>Service delivery</small><strong>Create a service job</strong></span><b aria-hidden="true">＋</b></summary><form className="operations-form" onSubmit={createJob}><label>Job title<input required value={jobForm.title} onChange={(event) => setJobForm({ ...jobForm, title: event.target.value })} placeholder="Website support and optimization" /></label><label>Won lead<select value={jobForm.leadId} onChange={(event) => setJobForm({ ...jobForm, leadId: event.target.value })}><option value="">No lead handoff</option>{snapshot.leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.full_name} · {lead.service_interest}</option>)}</select></label><label>Project<select value={jobForm.projectId} onChange={(event) => setJobForm({ ...jobForm, projectId: event.target.value })}><option value="">No linked project</option>{snapshot.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><label>Priority<select value={jobForm.priority} onChange={(event) => setJobForm({ ...jobForm, priority: event.target.value })}>{JOB_PRIORITIES.map((priority) => <option value={priority} key={priority}>{labelOperationsValue(priority)}</option>)}</select></label><label>Assignee<select value={jobForm.assignedTo} onChange={(event) => setJobForm({ ...jobForm, assignedTo: event.target.value })}><option value="">Unassigned</option>{snapshot.team.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label><label>Service location<select value={jobForm.locationId} onChange={(event) => setJobForm({ ...jobForm, locationId: event.target.value })}><option value="">No location</option>{snapshot.locations.map((location) => <option value={location.id} key={location.id}>{location.label}</option>)}</select></label><label>Starts<input type="datetime-local" value={jobForm.scheduledStart} onChange={(event) => setJobForm({ ...jobForm, scheduledStart: event.target.value })} /></label><label>Ends<input type="datetime-local" value={jobForm.scheduledEnd} onChange={(event) => setJobForm({ ...jobForm, scheduledEnd: event.target.value })} /></label><label className="operations-form-wide">Scope and service notes<textarea value={jobForm.description} onChange={(event) => setJobForm({ ...jobForm, description: event.target.value })} /></label><label className="operations-check"><input type="checkbox" checked={jobForm.clientVisible} onChange={(event) => setJobForm({ ...jobForm, clientVisible: event.target.checked })} /> Show this job to the client</label><button className="button button-dark" disabled={busy === "create-job"}>{busy === "create-job" ? "Creating…" : "Create service job →︎"}</button></form></details>
          </div>
        </div>}
      </section>

      {snapshot.jobs.length === 0 ? <section className="empty-state operations-empty"><p className="eyebrow">No service jobs</p><h2>{snapshot.canManage ? "Create the first delivery record." : "No service work has been shared yet."}</h2><p>{snapshot.canManage ? "Convert a won lead or create a job directly to begin scheduling and approvals." : "Your active service, estimates, and documents will appear here when they are published."}</p></section> : <div className="operations-layout">
        <aside className="operations-job-list" aria-label="Service jobs">{snapshot.jobs.map((job) => <button type="button" className={job.id === selectedJob?.id ? "active" : ""} onClick={() => chooseJob(job.id)} key={job.id}><span><b>{job.job_number}</b><em>{labelOperationsValue(job.status)}</em></span><strong>{job.title}</strong><small>{dateTimeLabel(job.scheduled_start)}</small><i className={`priority-${job.priority}`}>{labelOperationsValue(job.priority)}</i></button>)}</aside>
        {selectedJob && <JobWorkspace job={selectedJob} snapshot={snapshot} busy={busy} noteForm={noteForm} setNoteForm={setNoteForm} taskForm={taskForm} setTaskForm={setTaskForm} estimateForm={estimateForm} setEstimateForm={setEstimateForm} estimateItems={estimateItems} setEstimateItems={setEstimateItems} estimatePreview={estimatePreview} documentForm={documentForm} setDocumentForm={setDocumentForm} updateJob={updateJob} addNote={addNote} createTask={createTask} createEstimate={createEstimate} createDocument={createDocument} mutate={mutate} />}
      </div>}

      <section className="operations-panel operations-calendar">
        <div className="operations-section-heading"><div><p className="eyebrow">Shared calendar</p><h2>Upcoming delivery schedule</h2></div><span>{snapshot.calendar.length} scheduled items</span></div>
        {isClient ? <div className="single-event-calendar-panel">
          <span className="apple-calendar-mark" aria-hidden="true">Cal</span><div><strong>Your calendar, your choice</strong><p>Add only the appointments you want. No account connection or full calendar subscription is required.</p></div>
        </div> : <div className="apple-calendar-panel">
          <div><span className="apple-calendar-mark" aria-hidden="true">Cal</span><div><strong>Apple Calendar</strong><p>Subscribe to this live schedule. Apple controls refresh timing, and your private link stays active until you revoke it.</p></div></div>
          {!appleCalendarUrl ? <button className="button button-dark" type="button" disabled={busy.startsWith("apple-calendar-")} onClick={() => void updateAppleCalendar("create")}>{busy === "apple-calendar-create" ? "Preparing…" : "Connect Apple Calendar"}</button> : <div className="apple-calendar-actions">
            <a className="button button-dark" href={appleCalendarUrl}>Open in Apple Calendar</a>
            <button className="text-button" type="button" onClick={() => void copyAppleCalendarLink()}>Copy private link</button>
            <button className="text-button danger-link" type="button" disabled={busy === "apple-calendar-revoke"} onClick={() => void updateAppleCalendar("revoke")}>{busy === "apple-calendar-revoke" ? "Revoking…" : "Revoke link"}</button>
          </div>}
          {appleCalendarHttpsUrl && <label className="apple-calendar-link">Private subscription URL<input readOnly value={appleCalendarHttpsUrl} onFocus={(event) => event.currentTarget.select()} /></label>}
        </div>}
        {snapshot.calendar.length ? <div className="calendar-agenda">{snapshot.calendar.slice(0, 20).map((item) => { const job = item.job_id ? snapshot.jobs.find((candidate) => candidate.id === item.job_id) : null; const location = job?.location_id ? snapshot.locations.find((candidate) => candidate.id === job.location_id) : null; return <article key={`${item.kind}-${item.id}`}><time>{dateTimeLabel(item.starts_at)}</time><span>{labelOperationsValue(item.kind)}</span><strong>{item.title}</strong><small>{labelOperationsValue(item.status)}</small>{item.status !== "canceled" && <AddToCalendar compact event={{ id: `${item.kind}-${item.id}`, title: item.title, startsAt: item.starts_at, endsAt: item.ends_at, description: job?.description || `Scheduled with ${snapshot.client.name}.`, location: location ? addressLabel(location) : "" }} />}</article>; })}</div> : <p className="operations-inline-empty">Nothing is scheduled yet. Add a job date, appointment, or task deadline.</p>}
      </section>
    </>}
  </Shell>;
}

function JobWorkspace({ job, snapshot, busy, noteForm, setNoteForm, taskForm, setTaskForm, estimateForm, setEstimateForm, estimateItems, setEstimateItems, estimatePreview, documentForm, setDocumentForm, updateJob, addNote, createTask, createEstimate, createDocument, mutate }: {
  job: ServiceJob;
  snapshot: OperationsSnapshot;
  busy: string;
  noteForm: { title: string; detail: string; clientVisible: boolean };
  setNoteForm: (value: { title: string; detail: string; clientVisible: boolean }) => void;
  taskForm: { title: string; description: string; dueAt: string; priority: string; assignedTo: string };
  setTaskForm: (value: { title: string; description: string; dueAt: string; priority: string; assignedTo: string }) => void;
  estimateForm: { title: string; expiresAt: string; taxRate: string; notes: string };
  setEstimateForm: (value: { title: string; expiresAt: string; taxRate: string; notes: string }) => void;
  estimateItems: EstimateDraftItem[];
  setEstimateItems: (value: EstimateDraftItem[]) => void;
  estimatePreview: ReturnType<typeof calculateEstimate>;
  documentForm: { title: string; description: string; documentType: string; resourceUrl: string; clientVisible: boolean };
  setDocumentForm: (value: { title: string; description: string; documentType: string; resourceUrl: string; clientVisible: boolean }) => void;
  updateJob: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  addNote: (event: FormEvent) => Promise<void>;
  createTask: (event: FormEvent) => Promise<void>;
  createEstimate: (event: FormEvent) => Promise<void>;
  createDocument: (event: FormEvent) => Promise<void>;
  mutate: (label: string, input: Record<string, unknown>) => Promise<OperationsSnapshot | null>;
}) {
  const assignee = snapshot.team.find((member) => member.id === job.assigned_to);
  const location = snapshot.locations.find((item) => item.id === job.location_id);
  return <section className="operations-workspace">
    <header className="operations-job-hero"><div><p className="eyebrow">{job.job_number} · {labelOperationsValue(job.priority)} priority</p><h2>{job.title}</h2><p>{job.description || "No service scope has been added yet."}</p></div><span className={`operations-status ${job.status}`}>{labelOperationsValue(job.status)}</span></header>
    <div className="job-facts"><span>Schedule<strong>{dateTimeLabel(job.scheduled_start)}</strong></span><span>Assigned to<strong>{assignee?.name || "Unassigned"}</strong></span><span>Location<strong>{location?.label || "No location"}</strong></span><span>Client access<strong>{job.client_visible ? "Visible" : "Internal"}</strong></span></div>

    {snapshot.canManage && <details className="operations-composer"><summary>Update job plan <span>＋</span></summary><form key={job.id} className="operations-form" onSubmit={updateJob}><label>Status<select name="status" defaultValue={job.status}>{JOB_STATUSES.map((status) => <option value={status} key={status}>{labelOperationsValue(status)}</option>)}</select></label><label>Priority<select name="priority" defaultValue={job.priority}>{JOB_PRIORITIES.map((priority) => <option value={priority} key={priority}>{labelOperationsValue(priority)}</option>)}</select></label><label>Assignee<select name="assignedTo" defaultValue={job.assigned_to || ""}><option value="">Unassigned</option>{snapshot.team.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label><label>Location<select name="locationId" defaultValue={job.location_id || ""}><option value="">No location</option>{snapshot.locations.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label>Starts<input name="scheduledStart" type="datetime-local" defaultValue={localDateTime(job.scheduled_start)} /></label><label>Ends<input name="scheduledEnd" type="datetime-local" defaultValue={localDateTime(job.scheduled_end)} /></label><label className="operations-check"><input name="clientVisible" type="checkbox" defaultChecked={job.client_visible} /> Visible to client</label><button className="button button-dark" disabled={busy === "update-job"}>Save job plan →︎</button></form></details>}

    <div className="operations-section-heading"><div><p className="eyebrow">Activity</p><h3>Service timeline</h3></div><span>{job.activities.length} entries</span></div>
    <div className="operations-timeline">{job.activities.length ? job.activities.map((activity) => <article key={activity.id}><i /><div><span>{dateTimeLabel(activity.created_at)}{activity.client_visible ? " · Shared" : ""}</span><strong>{activity.title}</strong><p>{activity.detail}</p></div></article>) : <p className="operations-inline-empty">No activity has been recorded yet.</p>}</div>
    {snapshot.canManage && <details className="operations-composer"><summary>Add service note <span>＋</span></summary><form className="operations-form" onSubmit={addNote}><label>Note title<input value={noteForm.title} onChange={(event) => setNoteForm({ ...noteForm, title: event.target.value })} /></label><label className="operations-form-wide">Detail<textarea required value={noteForm.detail} onChange={(event) => setNoteForm({ ...noteForm, detail: event.target.value })} /></label><label className="operations-check"><input type="checkbox" checked={noteForm.clientVisible} onChange={(event) => setNoteForm({ ...noteForm, clientVisible: event.target.checked })} /> Share with client</label><button className="button button-dark" disabled={busy === "note"}>Save note →︎</button></form></details>}

    {snapshot.canManage && <><div className="operations-section-heading"><div><p className="eyebrow">Execution</p><h3>Job tasks</h3></div><span>{job.tasks.filter((task) => task.status !== "completed").length} open</span></div><div className="operations-task-list">{job.tasks.length ? job.tasks.map((task) => <article key={task.id}><div><span>{labelOperationsValue(task.priority)} · {dateTimeLabel(task.due_at)}</span><strong>{task.title}</strong><p>{task.description}</p></div><select aria-label={`Status for ${task.title}`} value={task.status} disabled={busy === task.id} onChange={(event) => void mutate(task.id, { action: "update_job_task", taskId: task.id, status: event.target.value })}>{["open", "in_progress", "completed", "canceled"].map((status) => <option value={status} key={status}>{labelOperationsValue(status)}</option>)}</select></article>) : <p className="operations-inline-empty">No execution tasks yet.</p>}</div><details className="operations-composer"><summary>Add job task <span>＋</span></summary><form className="operations-form" onSubmit={createTask}><label>Task title<input required value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} /></label><label>Due date and time<input type="datetime-local" value={taskForm.dueAt} onChange={(event) => setTaskForm({ ...taskForm, dueAt: event.target.value })} /></label><label>Priority<select value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })}>{JOB_PRIORITIES.map((priority) => <option value={priority} key={priority}>{labelOperationsValue(priority)}</option>)}</select></label><label>Assignee<select value={taskForm.assignedTo} onChange={(event) => setTaskForm({ ...taskForm, assignedTo: event.target.value })}><option value="">Use job assignee</option>{snapshot.team.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label><label className="operations-form-wide">Instructions<textarea value={taskForm.description} onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })} /></label><button className="button button-dark" disabled={busy === "task"}>Create task →︎</button></form></details></>}

    <div className="operations-section-heading"><div><p className="eyebrow">Commercial approval</p><h3>Estimates</h3></div><span>{job.estimates.length} versions</span></div>
    <div className="estimate-list">{job.estimates.length ? job.estimates.map((estimate) => <article key={estimate.id}><header><div><span>{estimate.estimate_number} · {labelOperationsValue(estimate.status)}</span><h4>{estimate.title}</h4><small>Expires {dateOnlyLabel(estimate.expires_at)}</small></div><strong>{money(estimate.total, estimate.currency)}</strong></header><div className="estimate-lines">{estimate.items.map((item) => <div key={item.id}><span>{item.description}<small>{item.quantity} × {money(item.unit_price, estimate.currency)}</small></span><b>{money(item.amount, estimate.currency)}</b></div>)}</div><footer><span>Subtotal <b>{money(estimate.subtotal, estimate.currency)}</b></span><span>Tax <b>{money(estimate.tax, estimate.currency)}</b></span><span>Total <b>{money(estimate.total, estimate.currency)}</b></span></footer>{estimate.notes && <p>{estimate.notes}</p>}{snapshot.canManage && estimate.status === "draft" && <button type="button" className="button button-dark" disabled={busy === estimate.id} onClick={() => void mutate(estimate.id, { action: "send_estimate", estimateId: estimate.id })}>Send for client approval →︎</button>}{snapshot.canRespondToEstimates && estimate.status === "sent" && <div className="estimate-actions"><button type="button" disabled={busy === `${estimate.id}-accepted`} onClick={() => void mutate(`${estimate.id}-accepted`, { action: "respond_estimate", estimateId: estimate.id, response: "accepted" })}>Accept estimate</button><button type="button" disabled={busy === `${estimate.id}-rejected`} onClick={() => void mutate(`${estimate.id}-rejected`, { action: "respond_estimate", estimateId: estimate.id, response: "rejected" })}>Decline</button></div>}</article>) : <p className="operations-inline-empty">No estimates have been created for this job.</p>}</div>
    {snapshot.canManage && <details className="operations-composer"><summary>Build an estimate <span>＋</span></summary><form className="operations-form estimate-form" onSubmit={createEstimate}><label>Estimate title<input required value={estimateForm.title} onChange={(event) => setEstimateForm({ ...estimateForm, title: event.target.value })} /></label><label>Expires<input type="date" value={estimateForm.expiresAt} onChange={(event) => setEstimateForm({ ...estimateForm, expiresAt: event.target.value })} /></label><label>Tax rate (%)<input type="number" min="0" max="100" step="0.01" value={estimateForm.taxRate} onChange={(event) => setEstimateForm({ ...estimateForm, taxRate: event.target.value })} /></label><div className="operations-form-wide estimate-builder"><span>Line items</span>{estimateItems.map((item, index) => <div key={index}><input aria-label={`Description ${index + 1}`} required placeholder="Service or deliverable" value={item.description} onChange={(event) => setEstimateItems(estimateItems.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} /><input aria-label={`Quantity ${index + 1}`} required type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => setEstimateItems(estimateItems.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} /><input aria-label={`Unit price ${index + 1}`} required type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => setEstimateItems(estimateItems.map((row, rowIndex) => rowIndex === index ? { ...row, unitPrice: event.target.value } : row))} />{estimateItems.length > 1 && <button type="button" onClick={() => setEstimateItems(estimateItems.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>}</div>)}<button type="button" onClick={() => setEstimateItems([...estimateItems, { description: "", quantity: "1", unitPrice: "0" }])}>＋ Add line item</button><strong>Draft total: {money(estimatePreview.total)}</strong></div><label className="operations-form-wide">Terms or notes<textarea value={estimateForm.notes} onChange={(event) => setEstimateForm({ ...estimateForm, notes: event.target.value })} /></label><button className="button button-dark" disabled={busy === "estimate"}>Save estimate draft →︎</button></form></details>}

    <div className="operations-section-heading"><div><p className="eyebrow">Documents</p><h3>Preview before download</h3></div><span>{job.documents.length} files</span></div>
    <div className="document-list">{job.documents.length ? job.documents.map((document) => <article key={document.id}><div><span>{labelOperationsValue(document.document_type)} · v{document.version}</span><strong>{document.title}</strong><p>{document.description || "No description added."}</p></div><a href={document.resource_url} rel="noreferrer" target="_blank">Preview document ↗︎</a>{snapshot.canManage && <div><select aria-label={`Status for ${document.title}`} value={document.status} onChange={(event) => void mutate(document.id, { action: "update_document", documentId: document.id, status: event.target.value, clientVisible: document.client_visible })}>{DOCUMENT_STATUSES.map((status) => <option value={status} key={status}>{labelOperationsValue(status)}</option>)}</select><label className="operations-check"><input type="checkbox" checked={document.client_visible} onChange={(event) => void mutate(`${document.id}-visibility`, { action: "update_document", documentId: document.id, status: event.target.checked && document.status === "draft" ? "shared" : document.status, clientVisible: event.target.checked })} /> Client visible</label></div>}</article>) : <p className="operations-inline-empty">No documents have been linked yet.</p>}</div>
    {snapshot.canManage && <details className="operations-composer"><summary>Add document link <span>＋</span></summary><form className="operations-form" onSubmit={createDocument}><label>Document title<input required value={documentForm.title} onChange={(event) => setDocumentForm({ ...documentForm, title: event.target.value })} /></label><label>Type<select value={documentForm.documentType} onChange={(event) => setDocumentForm({ ...documentForm, documentType: event.target.value })}>{DOCUMENT_TYPES.map((type) => <option value={type} key={type}>{labelOperationsValue(type)}</option>)}</select></label><label className="operations-form-wide">Secure HTTPS link<input required type="url" pattern="https://.*" value={documentForm.resourceUrl} onChange={(event) => setDocumentForm({ ...documentForm, resourceUrl: event.target.value })} placeholder="https://" /></label><label className="operations-form-wide">Description<textarea value={documentForm.description} onChange={(event) => setDocumentForm({ ...documentForm, description: event.target.value })} /></label><label className="operations-check"><input type="checkbox" checked={documentForm.clientVisible} onChange={(event) => setDocumentForm({ ...documentForm, clientVisible: event.target.checked })} /> Share immediately</label><button className="button button-dark" disabled={busy === "document"}>Add document →︎</button></form></details>}
  </section>;
}
