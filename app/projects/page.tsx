"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BrandSelect } from "../../components/brand-select";
import { Shell } from "../../components/shell";
import { LoadingRegion } from "../../components/loading-system";
import { appRoleForOrganizationRole } from "../../lib/access-control";
import { changeProject, fetchProjects } from "../../lib/projects-api";
import {
  DELIVERABLE_STATUSES,
  MILESTONE_STATUSES,
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  labelProjectValue,
  type ClientProject,
  type ProjectsSnapshot,
} from "../../lib/projects";
import { readStoredSession } from "../../lib/supabase-auth";
import { fetchClients } from "../../lib/supabase-data";
import type { AuthSession, ClientDetail } from "../../lib/types";

function dateLabel(value: string | null) {
  if (!value) return "No date set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function openRequestCount(project: ClientProject) {
  return project.requests.filter((request) => !["resolved", "closed"].includes(request.status)).length;
}

export default function ProjectsPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [snapshot, setSnapshot] = useState<ProjectsSnapshot | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [projectForm, setProjectForm] = useState({ name: "", summary: "", startDate: "", targetDate: "" });
  const [milestoneForm, setMilestoneForm] = useState({ title: "", description: "", dueDate: "" });
  const [deliverableForm, setDeliverableForm] = useState({ title: "", description: "", dueDate: "", resourceUrl: "", milestoneId: "" });
  const [requestForm, setRequestForm] = useState({ title: "", description: "", priority: "normal" });

  const selectedProject = useMemo(
    () => snapshot?.projects.find((project) => project.id === selectedProjectId) || snapshot?.projects[0] || null,
    [snapshot, selectedProjectId],
  );

  const loadWorkspace = async (activeSession: AuthSession, clientId?: string) => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchProjects(activeSession, clientId || undefined);
      setSnapshot(next);
      setSelectedProjectId((current) => next.projects.some((project) => project.id === current) ? current : next.projects[0]?.id || "");
    } catch (loadError) {
      setSnapshot(null);
      setError(loadError instanceof Error ? loadError.message : "The project workspace could not be loaded.");
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
      const queryClient = new URLSearchParams(window.location.search).get("client") || "";
      const initialClient = rows.some((client) => client.id === queryClient) ? queryClient : rows[0]?.id || "";
      setSelectedClientId(initialClient);
      if (initialClient) void loadWorkspace(stored, initialClient);
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
    const url = new URL(window.location.href);
    if (clientId) url.searchParams.set("client", clientId);
    else url.searchParams.delete("client");
    window.history.replaceState({}, "", url);
    if (clientId) void loadWorkspace(session, clientId);
  };

  const mutate = async (label: string, input: Record<string, unknown>) => {
    if (!session) return null;
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const response = await changeProject(session, { clientId: selectedClientId || undefined, ...input });
      setSnapshot(response.snapshot as ProjectsSnapshot);
      setMessage(response.message || "Project workspace updated.");
      return response.snapshot as ProjectsSnapshot;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "That change could not be saved.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    const next = await mutate("project", { action: "create_project", ...projectForm, status: "active" });
    if (next) {
      setProjectForm({ name: "", summary: "", startDate: "", targetDate: "" });
      setSelectedProjectId(next.projects[0]?.id || "");
    }
  };

  const createMilestone = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject) return;
    if (await mutate("milestone", { action: "save_milestone", projectId: selectedProject.id, ...milestoneForm, status: "not_started", sortOrder: selectedProject.milestones.length })) {
      setMilestoneForm({ title: "", description: "", dueDate: "" });
    }
  };

  const updateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProject) return;
    const form = new FormData(event.currentTarget);
    await mutate("project-edit", {
      action: "update_project",
      projectId: selectedProject.id,
      name: form.get("name"),
      summary: form.get("summary"),
      status: form.get("status"),
      targetDate: form.get("targetDate"),
    });
  };

  const createDeliverable = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject) return;
    if (await mutate("deliverable", { action: "save_deliverable", projectId: selectedProject.id, ...deliverableForm, status: "draft" })) {
      setDeliverableForm({ title: "", description: "", dueDate: "", resourceUrl: "", milestoneId: "" });
    }
  };

  const createRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (await mutate("request", { action: "create_request", projectId: selectedProject?.id || "", ...requestForm })) {
      setRequestForm({ title: "", description: "", priority: "normal" });
    }
  };

  const completedMilestones = snapshot?.projects.reduce((total, project) => total + project.milestones.filter((milestone) => milestone.status === "complete").length, 0) || 0;
  const deliverableCount = snapshot?.projects.reduce((total, project) => total + project.deliverables.length, 0) || 0;
  const openRequests = (snapshot?.projects.reduce((total, project) => total + openRequestCount(project), 0) || 0) + (snapshot?.unassignedRequests.filter((request) => !["resolved", "closed"].includes(request.status)).length || 0);

  return <Shell active="Projects">
    <div className="page-heading projects-heading">
      <div><p className="eyebrow">Delivery workspace</p><h1>Projects</h1><p className="lede">Keep scope, milestones, deliverables, and client requests in one shared source of truth.</p></div>
      {snapshot?.canManage && clients.length > 0 && <BrandSelect label="Client" value={selectedClientId} onChange={chooseClient} options={clients.map((client) => ({ value: client.id, label: client.name, description: [client.industry, client.location].filter(Boolean).join(" · ") || "Client workspace" }))} />}
    </div>

    {error && <p className="integration-notice projects-error" role="alert">{error}</p>}
    {message && <p className="integration-notice projects-success" role="status">{message}</p>}
    {loading ? <LoadingRegion active label="Loading project workspace" variant="projects" /> : !snapshot ? <section className="empty-state"><h2>Project workspace unavailable</h2><p>Choose a client or retry after the project database migration is applied.</p></section> : <>
      <section className="project-summary" aria-label="Project workspace summary">
        <div><span>Projects</span><strong>{snapshot.projects.length}</strong><small>Live client records</small></div>
        <div><span>Milestones complete</span><strong>{completedMilestones}</strong><small>Measured checkpoints</small></div>
        <div><span>Deliverables</span><strong>{deliverableCount}</strong><small>Shared project outputs</small></div>
        <div><span>Open requests</span><strong>{openRequests}</strong><small>Awaiting resolution</small></div>
      </section>

      {snapshot.canManage && <details className="project-composer detail-card"><summary>Start a client project <span>＋</span></summary><form className="project-form" onSubmit={createProject}><label>Project name<input required maxLength={180} value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} placeholder="Website launch" /></label><label className="project-form-wide">Summary<textarea maxLength={2000} value={projectForm.summary} onChange={(event) => setProjectForm({ ...projectForm, summary: event.target.value })} placeholder="Define the outcome, scope, and client-facing objective." /></label><label>Start date<input type="date" value={projectForm.startDate} onChange={(event) => setProjectForm({ ...projectForm, startDate: event.target.value })} /></label><label>Target date<input type="date" value={projectForm.targetDate} onChange={(event) => setProjectForm({ ...projectForm, targetDate: event.target.value })} /></label><button className="button button-dark" disabled={busy === "project"} type="submit">{busy === "project" ? "Creating…" : "Create project"} <span>→︎</span></button></form></details>}

      {snapshot.projects.length === 0 ? <section className="empty-state projects-empty"><p className="eyebrow">No projects yet</p><h2>{snapshot.canManage ? "Create the first real client project." : "Your project workspace is ready."}</h2><p>{snapshot.canManage ? "Start with a name, outcome, and target date. Progress will begin at 0% until measurable milestones are completed." : "Your agency has not published a project here yet. New work will appear automatically when it is assigned."}</p></section> : <div className="projects-layout">
        <aside className="project-list" aria-label="Client projects">{snapshot.projects.map((project) => <button type="button" className={project.id === selectedProject?.id ? "active" : ""} onClick={() => setSelectedProjectId(project.id)} key={project.id}><span><b>{labelProjectValue(project.status)}</b><em>{project.progress_percent}%</em></span><strong>{project.name}</strong><small>{project.milestones.filter((milestone) => milestone.status === "complete").length} of {project.milestones.length} milestones complete</small><i><span style={{ width: `${project.progress_percent}%` }} /></i></button>)}</aside>

        {selectedProject && <section className="project-workspace">
          <header className="project-hero"><div><p className="eyebrow">{labelProjectValue(selectedProject.status)} project</p><h2>{selectedProject.name}</h2><p>{selectedProject.summary || "No project summary has been added yet."}</p><div className="project-dates"><span>Started <strong>{dateLabel(selectedProject.start_date)}</strong></span><span>Target <strong>{dateLabel(selectedProject.target_date)}</strong></span></div></div><div className="project-progress-ring" style={{ "--project-progress": `${selectedProject.progress_percent * 3.6}deg` } as React.CSSProperties}><strong>{selectedProject.progress_percent}%</strong><span>complete</span></div></header>

          {snapshot.canManage && <details className="project-inline-form project-editor"><summary>Edit project details <span>＋</span></summary><form key={selectedProject.id} onSubmit={updateProject}><label>Project name<input name="name" required defaultValue={selectedProject.name} /></label><label>Status<select name="status" defaultValue={selectedProject.status}>{["planned", "active", "blocked", "completed", "archived"].map((status) => <option value={status} key={status}>{labelProjectValue(status)}</option>)}</select></label><label>Target date<input name="targetDate" type="date" defaultValue={selectedProject.target_date || ""} /></label><label className="project-form-wide">Summary<textarea name="summary" defaultValue={selectedProject.summary} /></label><button className="button button-dark" disabled={busy === "project-edit"}>{busy === "project-edit" ? "Saving…" : "Save project details →︎"}</button></form></details>}

          <div className="project-section-heading"><div><p className="eyebrow">Milestones</p><h3>Measured progress</h3></div><span>{selectedProject.milestones.filter((item) => item.status === "complete").length}/{selectedProject.milestones.length} complete</span></div>
          <div className="milestone-list">{selectedProject.milestones.length ? selectedProject.milestones.map((milestone) => <article key={milestone.id}><div className={`milestone-state ${milestone.status}`} aria-hidden="true">{milestone.status === "complete" ? "✓" : milestone.sort_order + 1}</div><div><strong>{milestone.title}</strong><p>{milestone.description || "No description added."}</p><small>{dateLabel(milestone.due_date)}</small></div>{snapshot.canManage ? <select aria-label={`Status for ${milestone.title}`} value={milestone.status} disabled={busy === milestone.id} onChange={(event) => void mutate(milestone.id, { action: "save_milestone", projectId: selectedProject.id, milestoneId: milestone.id, title: milestone.title, description: milestone.description, dueDate: milestone.due_date || "", sortOrder: milestone.sort_order, status: event.target.value })}>{MILESTONE_STATUSES.map((status) => <option value={status} key={status}>{labelProjectValue(status)}</option>)}</select> : <span className="project-status-pill">{labelProjectValue(milestone.status)}</span>}</article>) : <p className="project-inline-empty">No milestones have been published yet.</p>}</div>
          {snapshot.canManage && <details className="project-inline-form"><summary>Add milestone <span>＋</span></summary><form onSubmit={createMilestone}><label>Title<input required value={milestoneForm.title} onChange={(event) => setMilestoneForm({ ...milestoneForm, title: event.target.value })} /></label><label>Due date<input type="date" value={milestoneForm.dueDate} onChange={(event) => setMilestoneForm({ ...milestoneForm, dueDate: event.target.value })} /></label><label className="project-form-wide">Description<textarea value={milestoneForm.description} onChange={(event) => setMilestoneForm({ ...milestoneForm, description: event.target.value })} /></label><button className="button button-dark" disabled={busy === "milestone"}>Save milestone →︎</button></form></details>}

          <div className="project-section-heading"><div><p className="eyebrow">Deliverables</p><h3>Reviewable work</h3></div><span>{selectedProject.deliverables.length} items</span></div>
          <div className="deliverable-grid">{selectedProject.deliverables.length ? selectedProject.deliverables.map((deliverable) => <article key={deliverable.id}><span>{labelProjectValue(deliverable.status)}</span><h4>{deliverable.title}</h4><p>{deliverable.description || "No description added."}</p><small>Due {dateLabel(deliverable.due_date)}</small>{deliverable.resource_url && <a href={deliverable.resource_url} rel="noreferrer" target="_blank">Open deliverable ↗︎</a>}{snapshot.canManage && <select aria-label={`Status for ${deliverable.title}`} value={deliverable.status} disabled={busy === deliverable.id} onChange={(event) => void mutate(deliverable.id, { action: "save_deliverable", projectId: selectedProject.id, deliverableId: deliverable.id, milestoneId: deliverable.milestone_id || "", title: deliverable.title, description: deliverable.description, resourceUrl: deliverable.resource_url || "", dueDate: deliverable.due_date || "", status: event.target.value })}>{DELIVERABLE_STATUSES.map((status) => <option value={status} key={status}>{labelProjectValue(status)}</option>)}</select>}</article>) : <p className="project-inline-empty">No deliverables have been shared yet.</p>}</div>
          {snapshot.canManage && <details className="project-inline-form"><summary>Add deliverable <span>＋</span></summary><form onSubmit={createDeliverable}><label>Title<input required value={deliverableForm.title} onChange={(event) => setDeliverableForm({ ...deliverableForm, title: event.target.value })} /></label><label>Milestone<select value={deliverableForm.milestoneId} onChange={(event) => setDeliverableForm({ ...deliverableForm, milestoneId: event.target.value })}><option value="">No linked milestone</option>{selectedProject.milestones.map((milestone) => <option value={milestone.id} key={milestone.id}>{milestone.title}</option>)}</select></label><label>Due date<input type="date" value={deliverableForm.dueDate} onChange={(event) => setDeliverableForm({ ...deliverableForm, dueDate: event.target.value })} /></label><label>Resource link<input type="url" value={deliverableForm.resourceUrl} onChange={(event) => setDeliverableForm({ ...deliverableForm, resourceUrl: event.target.value })} placeholder="https://" /></label><label className="project-form-wide">Description<textarea value={deliverableForm.description} onChange={(event) => setDeliverableForm({ ...deliverableForm, description: event.target.value })} /></label><button className="button button-dark" disabled={busy === "deliverable"}>Save deliverable →︎</button></form></details>}

          <div className="project-section-heading"><div><p className="eyebrow">Client requests</p><h3>Questions and change requests</h3></div><span>{openRequestCount(selectedProject)} open</span></div>
          <div className="request-list">{selectedProject.requests.length ? selectedProject.requests.map((request) => <article key={request.id}><div><span>{labelProjectValue(request.priority)} priority</span><strong>{request.title}</strong><p>{request.description}</p><small>Submitted {dateLabel(request.created_at.slice(0, 10))}</small></div>{snapshot.canManage ? <select aria-label={`Status for ${request.title}`} value={request.status} disabled={busy === request.id} onChange={(event) => void mutate(request.id, { action: "update_request", requestId: request.id, status: event.target.value })}>{REQUEST_STATUSES.map((status) => <option value={status} key={status}>{labelProjectValue(status)}</option>)}</select> : <span className="project-status-pill">{labelProjectValue(request.status)}</span>}</article>) : <p className="project-inline-empty">No requests have been submitted for this project.</p>}</div>
          <details className="project-inline-form request-composer"><summary>Submit a request <span>＋</span></summary><form onSubmit={createRequest}><label>Request title<input required value={requestForm.title} onChange={(event) => setRequestForm({ ...requestForm, title: event.target.value })} /></label><label>Priority<select value={requestForm.priority} onChange={(event) => setRequestForm({ ...requestForm, priority: event.target.value })}>{REQUEST_PRIORITIES.map((priority) => <option value={priority} key={priority}>{labelProjectValue(priority)}</option>)}</select></label><label className="project-form-wide">What do you need?<textarea required value={requestForm.description} onChange={(event) => setRequestForm({ ...requestForm, description: event.target.value })} /></label><button className="button button-dark" disabled={busy === "request"}>Submit request →︎</button></form></details>
        </section>}
      </div>}

      {(snapshot.unassignedRequests.length > 0 || !selectedProject) && <section className="project-workspace project-unassigned">
        <div className="project-section-heading"><div><p className="eyebrow">Workspace requests</p><h3>Requests awaiting project assignment</h3></div><span>{snapshot.unassignedRequests.filter((request) => !["resolved", "closed"].includes(request.status)).length} open</span></div>
        <div className="request-list">{snapshot.unassignedRequests.length ? snapshot.unassignedRequests.map((request) => <article key={request.id}><div><span>{labelProjectValue(request.priority)} priority</span><strong>{request.title}</strong><p>{request.description}</p><small>Submitted {dateLabel(request.created_at.slice(0, 10))}</small></div>{snapshot.canManage ? <select aria-label={`Status for ${request.title}`} value={request.status} disabled={busy === request.id} onChange={(event) => void mutate(request.id, { action: "update_request", requestId: request.id, status: event.target.value })}>{REQUEST_STATUSES.map((status) => <option value={status} key={status}>{labelProjectValue(status)}</option>)}</select> : <span className="project-status-pill">{labelProjectValue(request.status)}</span>}</article>) : <p className="project-inline-empty">No workspace requests have been submitted yet.</p>}</div>
        {!selectedProject && <details className="project-inline-form request-composer"><summary>Submit a request <span>＋</span></summary><form onSubmit={createRequest}><label>Request title<input required value={requestForm.title} onChange={(event) => setRequestForm({ ...requestForm, title: event.target.value })} /></label><label>Priority<select value={requestForm.priority} onChange={(event) => setRequestForm({ ...requestForm, priority: event.target.value })}>{REQUEST_PRIORITIES.map((priority) => <option value={priority} key={priority}>{labelProjectValue(priority)}</option>)}</select></label><label className="project-form-wide">What do you need?<textarea required value={requestForm.description} onChange={(event) => setRequestForm({ ...requestForm, description: event.target.value })} /></label><button className="button button-dark" disabled={busy === "request"}>Submit request →︎</button></form></details>}
      </section>}
    </>}
  </Shell>;
}
