import {
  authJson,
  getSupabaseUrl,
  hasOrganizationPermission,
  requireAuth,
  type AuthContext,
  type FunctionEnv,
} from "../../_shared/auth";

interface Env extends FunctionEnv {}

type ClientRow = { id: string; organization_id: string | null; name: string };
type ProjectRow = { id: string; organization_id: string; client_id: string; name: string; summary: string; status: string; start_date: string | null; target_date: string | null; progress_percent: number; created_at: string; updated_at: string };
type MilestoneRow = { id: string; project_id: string; title: string; description: string; status: string; due_date: string | null; sort_order: number; completed_at: string | null; created_at: string; updated_at: string };
type DeliverableRow = { id: string; project_id: string; milestone_id: string | null; title: string; description: string; status: string; resource_url: string | null; due_date: string | null; delivered_at: string | null; created_at: string; updated_at: string };
type RequestRow = { id: string; project_id: string | null; client_id: string; title: string; description: string; priority: string; status: string; requested_by: string | null; assigned_to: string | null; resolved_at: string | null; created_at: string; updated_at: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const projectStatuses = new Set(["planned", "active", "blocked", "completed", "archived"]);
const milestoneStatuses = new Set(["not_started", "in_progress", "blocked", "complete"]);
const deliverableStatuses = new Set(["draft", "in_review", "approved", "delivered"]);
const requestStatuses = new Set(["open", "in_progress", "waiting", "resolved", "closed"]);
const requestPriorities = new Set(["low", "normal", "high", "urgent"]);

function serviceHeaders(serviceKey: string, prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function dateValue(value: unknown) {
  const candidate = clean(value, 10);
  return !candidate ? null : /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : undefined;
}

function optionalUrl(value: unknown) {
  const candidate = clean(value, 1000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function resolveClient(url: string, serviceKey: string, context: AuthContext, requestedClientId: string) {
  const filter = requestedClientId
    ? `id=eq.${encodeURIComponent(requestedClientId)}`
    : context.clientId
      ? `id=eq.${encodeURIComponent(context.clientId)}`
      : context.organizationId
        ? `organization_id=eq.${encodeURIComponent(context.organizationId)}`
        : "id=eq.00000000-0000-0000-0000-000000000000";
  const response = await fetch(`${url}/rest/v1/clients?${filter}&select=id,organization_id,name&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as ClientRow[] : [];
  return rows[0] || null;
}

async function readSnapshot(url: string, serviceKey: string, context: AuthContext, client: ClientRow) {
  const projectResponse = await fetch(`${url}/rest/v1/client_projects?client_id=eq.${encodeURIComponent(client.id)}&select=*&order=updated_at.desc`, { headers: serviceHeaders(serviceKey) });
  const requestResponse = await fetch(`${url}/rest/v1/client_requests?client_id=eq.${encodeURIComponent(client.id)}&select=*&order=created_at.desc`, { headers: serviceHeaders(serviceKey) });
  if (!projectResponse.ok || !requestResponse.ok) return null;
  const projects = await projectResponse.json().catch(() => []) as ProjectRow[];
  const requests = await requestResponse.json().catch(() => []) as RequestRow[];
  const projectIds = projects.map((project) => project.id);
  let milestones: MilestoneRow[] = [];
  let deliverables: DeliverableRow[] = [];
  if (projectIds.length) {
    const [milestoneResponse, deliverableResponse] = await Promise.all([
      fetch(`${url}/rest/v1/project_milestones?organization_id=eq.${encodeURIComponent(client.organization_id || "")}&select=*&order=sort_order.asc,due_date.asc`, { headers: serviceHeaders(serviceKey) }),
      fetch(`${url}/rest/v1/project_deliverables?organization_id=eq.${encodeURIComponent(client.organization_id || "")}&select=*&order=due_date.asc,created_at.asc`, { headers: serviceHeaders(serviceKey) }),
    ]);
    if (!milestoneResponse.ok || !deliverableResponse.ok) return null;
    milestones = await milestoneResponse.json().catch(() => []) as MilestoneRow[];
    deliverables = await deliverableResponse.json().catch(() => []) as DeliverableRow[];
  }
  return {
    client: { id: client.id, name: client.name },
    canManage: hasOrganizationPermission(context, "clients.manage") && context.organizationRole !== "client",
    projects: projects.map((project) => ({
      ...project,
      milestones: milestones.filter((milestone) => milestone.project_id === project.id),
      deliverables: deliverables.filter((deliverable) => deliverable.project_id === project.id),
      requests: requests.filter((item) => item.project_id === project.id),
    })),
    unassignedRequests: requests.filter((item) => !item.project_id),
  };
}

async function writeLifecycle(url: string, serviceKey: string, input: { organizationId: string; userId: string; action: string; entityType: string; entityId: string; clientId: string; payload?: Record<string, unknown> }) {
  const metadata = { client_id: input.clientId, ...(input.payload || {}) };
  await Promise.allSettled([
    fetch(`${url}/rest/v1/audit_events`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: input.organizationId, actor_user_id: input.userId, action: input.action, entity_type: input.entityType, entity_id: input.entityId, metadata }) }),
    fetch(`${url}/rest/v1/event_outbox`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: input.organizationId, event_type: input.action, aggregate_type: input.entityType, aggregate_id: input.entityId, payload: metadata }) }),
  ]);
}

async function updateProjectProgress(url: string, serviceKey: string, projectId: string, userId: string) {
  const response = await fetch(`${url}/rest/v1/project_milestones?project_id=eq.${encodeURIComponent(projectId)}&select=status`, { headers: serviceHeaders(serviceKey) });
  if (!response.ok) return false;
  const rows = await response.json().catch(() => []) as Array<{ status?: string }>;
  const progress = rows.length ? Math.round((rows.filter((row) => row.status === "complete").length / rows.length) * 100) : 0;
  const projectResponse = await fetch(`${url}/rest/v1/client_projects?id=eq.${encodeURIComponent(projectId)}&select=status&limit=1`, { headers: serviceHeaders(serviceKey) });
  const projects = projectResponse.ok ? await projectResponse.json().catch(() => []) as Array<{ status?: string }> : [];
  const currentStatus = projects[0]?.status || "planned";
  const status = currentStatus === "blocked" || currentStatus === "archived" ? currentStatus : progress === 100 ? "completed" : currentStatus === "completed" ? "active" : currentStatus;
  const patch = await fetch(`${url}/rest/v1/client_projects?id=eq.${encodeURIComponent(projectId)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ progress_percent: progress, status, updated_by: userId, updated_at: new Date().toISOString() }) });
  return patch.ok;
}

async function authenticatedClient(request: Request, env: Env, requestedClientId: string) {
  const auth = await requireAuth(request, env, { permission: "reports.read" });
  if ("response" in auth) return auth;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return { response: authJson({ error: "Project storage is not configured." }, 500) };
  const client = await resolveClient(url, serviceKey, auth.context, requestedClientId);
  if (!client?.organization_id) return { response: authJson({ error: requestedClientId ? "That client workspace is unavailable." : "Open a client workspace or choose a client first." }, 404) };
  const scopedAuth = await requireAuth(request, env, { clientId: client.id, permission: "reports.read" });
  if ("response" in scopedAuth) return scopedAuth;
  return { context: scopedAuth.context, client, url, serviceKey };
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const requestedClientId = new URL(request.url).searchParams.get("client") || "";
  if (requestedClientId && !uuidPattern.test(requestedClientId)) return authJson({ error: "Choose a valid client." }, 400);
  const resolved = await authenticatedClient(request, env, requestedClientId);
  if ("response" in resolved) return resolved.response;
  const snapshot = await readSnapshot(resolved.url, resolved.serviceKey, resolved.context, resolved.client);
  if (!snapshot) return authJson({ error: "Project storage is not ready. Apply supabase/client_projects.sql first." }, 503);
  return authJson({ snapshot });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = clean(input?.action, 60);
  const requestedClientId = clean(input?.clientId, 36);
  if (!action || (requestedClientId && !uuidPattern.test(requestedClientId))) return authJson({ error: "A valid project action and client are required." }, 400);
  const resolved = await authenticatedClient(request, env, requestedClientId);
  if ("response" in resolved) return resolved.response;
  const { context, client, url, serviceKey } = resolved;
  const organizationId = client.organization_id;
  if (!organizationId) return authJson({ error: "That client is not attached to an organization." }, 409);
  const canManage = hasOrganizationPermission(context, "clients.manage") && context.organizationRole !== "client";
  const now = new Date().toISOString();
  const projectId = clean(input?.projectId, 36);

  const projectResponse = projectId && uuidPattern.test(projectId)
    ? await fetch(`${url}/rest/v1/client_projects?id=eq.${encodeURIComponent(projectId)}&client_id=eq.${encodeURIComponent(client.id)}&select=id,organization_id,start_date,progress_percent&limit=1`, { headers: serviceHeaders(serviceKey) })
    : null;
  const projectRows = projectResponse?.ok ? await projectResponse.json().catch(() => []) as Array<{ id: string; organization_id: string; start_date: string | null; progress_percent: number }> : [];
  const project = projectRows[0] || null;

  let entityId = "";
  let lifecycleAction = "";
  let entityType = "";

  if (action === "create_project") {
    if (!canManage) return authJson({ error: "Only agency staff can create projects." }, 403);
    const name = clean(input?.name, 180);
    const summary = clean(input?.summary, 2000);
    const status = clean(input?.status, 30) || "planned";
    const startDate = dateValue(input?.startDate);
    const targetDate = dateValue(input?.targetDate);
    if (!name || !projectStatuses.has(status) || startDate === undefined || targetDate === undefined || (startDate && targetDate && targetDate < startDate)) return authJson({ error: "Enter a project name and valid date range." }, 400);
    const response = await fetch(`${url}/rest/v1/client_projects`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: client.organization_id, client_id: client.id, name, summary, status, start_date: startDate, target_date: targetDate, owner_user_id: context.userId, created_by: context.userId, updated_by: context.userId }) });
    const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
    entityId = rows[0]?.id || "";
    if (!response.ok || !uuidPattern.test(entityId)) return authJson({ error: "The project could not be created." }, 502);
    lifecycleAction = "project.created"; entityType = "client_project";
  } else if (action === "update_project") {
    if (!canManage || !project) return authJson({ error: "That project cannot be updated." }, canManage ? 404 : 403);
    const requestedStatus = clean(input?.status, 30);
    const name = clean(input?.name, 180);
    const targetDate = dateValue(input?.targetDate);
    if (!projectStatuses.has(requestedStatus) || !name || targetDate === undefined || (project.start_date && targetDate && targetDate < project.start_date)) return authJson({ error: "A project name, valid status, and valid target date are required." }, 400);
    if (requestedStatus === "completed" && project.progress_percent < 100) return authJson({ error: "Complete every milestone before marking the project completed." }, 400);
    const status = project.progress_percent === 100 && requestedStatus !== "blocked" && requestedStatus !== "archived" ? "completed" : requestedStatus;
    const response = await fetch(`${url}/rest/v1/client_projects?id=eq.${encodeURIComponent(project.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ name, summary: clean(input?.summary, 2000), status, target_date: targetDate, updated_by: context.userId, updated_at: now }) });
    if (!response.ok) return authJson({ error: "The project could not be updated." }, 502);
    entityId = project.id; lifecycleAction = "project.updated"; entityType = "client_project";
  } else if (action === "save_milestone") {
    if (!canManage || !project) return authJson({ error: "That milestone cannot be saved." }, canManage ? 404 : 403);
    const milestoneId = clean(input?.milestoneId, 36);
    const status = clean(input?.status, 30) || "not_started";
    const title = clean(input?.title, 180);
    const dueDate = dateValue(input?.dueDate);
    if (!title || !milestoneStatuses.has(status) || dueDate === undefined || (milestoneId && !uuidPattern.test(milestoneId))) return authJson({ error: "Enter a milestone title, status, and valid due date." }, 400);
    const payload = { organization_id: client.organization_id, project_id: project.id, title, description: clean(input?.description, 2000), status, due_date: dueDate, sort_order: Math.max(0, Math.min(10000, Number(input?.sortOrder) || 0)), completed_at: status === "complete" ? now : null, updated_at: now };
    const response = milestoneId
      ? await fetch(`${url}/rest/v1/project_milestones?id=eq.${encodeURIComponent(milestoneId)}&project_id=eq.${encodeURIComponent(project.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify(payload) })
      : await fetch(`${url}/rest/v1/project_milestones`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ ...payload, created_by: context.userId }) });
    const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
    entityId = rows[0]?.id || "";
    if (!response.ok || !uuidPattern.test(entityId) || !await updateProjectProgress(url, serviceKey, project.id, context.userId)) return authJson({ error: "The milestone could not be saved consistently." }, 502);
    lifecycleAction = status === "complete" ? "project.milestone.completed" : "project.milestone.saved"; entityType = "project_milestone";
  } else if (action === "save_deliverable") {
    if (!canManage || !project) return authJson({ error: "That deliverable cannot be saved." }, canManage ? 404 : 403);
    const deliverableId = clean(input?.deliverableId, 36);
    const milestoneId = clean(input?.milestoneId, 36);
    const status = clean(input?.status, 30) || "draft";
    const title = clean(input?.title, 180);
    const dueDate = dateValue(input?.dueDate);
    const resourceUrl = optionalUrl(input?.resourceUrl);
    if (!title || !deliverableStatuses.has(status) || dueDate === undefined || resourceUrl === undefined || (deliverableId && !uuidPattern.test(deliverableId)) || (milestoneId && !uuidPattern.test(milestoneId))) return authJson({ error: "Enter valid deliverable details and an HTTP(S) resource link." }, 400);
    if (milestoneId) {
      const milestoneResponse = await fetch(`${url}/rest/v1/project_milestones?id=eq.${encodeURIComponent(milestoneId)}&project_id=eq.${encodeURIComponent(project.id)}&select=id&limit=1`, { headers: serviceHeaders(serviceKey) });
      const milestoneRows = milestoneResponse.ok ? await milestoneResponse.json().catch(() => []) as Array<{ id?: string }> : [];
      if (!milestoneRows[0]?.id) return authJson({ error: "Choose a milestone from this project." }, 400);
    }
    const payload = { organization_id: client.organization_id, project_id: project.id, milestone_id: milestoneId || null, title, description: clean(input?.description, 2000), status, resource_url: resourceUrl, due_date: dueDate, delivered_at: status === "delivered" ? now : null, updated_at: now };
    const response = deliverableId
      ? await fetch(`${url}/rest/v1/project_deliverables?id=eq.${encodeURIComponent(deliverableId)}&project_id=eq.${encodeURIComponent(project.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify(payload) })
      : await fetch(`${url}/rest/v1/project_deliverables`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ ...payload, created_by: context.userId }) });
    const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
    entityId = rows[0]?.id || "";
    if (!response.ok || !uuidPattern.test(entityId)) return authJson({ error: "The deliverable could not be saved." }, 502);
    lifecycleAction = status === "delivered" ? "project.deliverable.delivered" : "project.deliverable.saved"; entityType = "project_deliverable";
  } else if (action === "create_request") {
    if (projectId && !project) return authJson({ error: "Choose a project that belongs to this client." }, 404);
    const title = clean(input?.title, 180);
    const description = clean(input?.description, 4000);
    const priority = clean(input?.priority, 20) || "normal";
    if (!title || !description || !requestPriorities.has(priority)) return authJson({ error: "Enter a request title, description, and priority." }, 400);
    const response = await fetch(`${url}/rest/v1/client_requests`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: client.organization_id, client_id: client.id, project_id: project?.id || null, title, description, priority, requested_by: context.userId }) });
    const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
    entityId = rows[0]?.id || "";
    if (!response.ok || !uuidPattern.test(entityId)) return authJson({ error: "The request could not be submitted." }, 502);
    lifecycleAction = "client.request.created"; entityType = "client_request";
  } else if (action === "update_request") {
    if (!canManage) return authJson({ error: "Only agency staff can update request status." }, 403);
    const requestId = clean(input?.requestId, 36);
    const status = clean(input?.status, 30);
    if (!uuidPattern.test(requestId) || !requestStatuses.has(status)) return authJson({ error: "Choose a valid request and status." }, 400);
    const response = await fetch(`${url}/rest/v1/client_requests?id=eq.${encodeURIComponent(requestId)}&client_id=eq.${encodeURIComponent(client.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ status, assigned_to: context.userId, resolved_at: status === "resolved" || status === "closed" ? now : null, updated_at: now }) });
    const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
    entityId = rows[0]?.id || "";
    if (!response.ok || !uuidPattern.test(entityId)) return authJson({ error: "The request status could not be updated." }, 502);
    lifecycleAction = "client.request.updated"; entityType = "client_request";
  } else {
    return authJson({ error: "That project action is not supported." }, 400);
  }

  await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: lifecycleAction, entityType, entityId, clientId: client.id, payload: project?.id ? { project_id: project.id } : undefined });
  const snapshot = await readSnapshot(url, serviceKey, context, client);
  if (!snapshot) return authJson({ error: "The change saved, but the refreshed project view is unavailable." }, 502);
  return authJson({ snapshot, message: "Project workspace updated." });
};
