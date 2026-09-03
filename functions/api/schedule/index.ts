import { authJson, getSupabaseUrl, requireAuth, type FunctionEnv } from "../../_shared/auth";

type ClientRow = { id: string; name: string; industry: string; location: string; organization_id: string };
type ScheduledRow = { id: string; title: string; status: string; assigned_to: string | null };
type JobRow = ScheduledRow & { scheduled_start: string; scheduled_end: string | null };
type AppointmentRow = ScheduledRow & { starts_at: string; ends_at: string | null };
type TaskRow = ScheduledRow & { due_at: string; job_id: string | null };

function serviceHeaders(serviceKey: string) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
}

export const onRequestGet = async ({ request, env }: { request: Request; env: FunctionEnv }) => {
  const auth = await requireAuth(request, env, { staffOnly: true, permission: "operations.read" });
  if ("response" in auth) return auth.response;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return authJson({ error: "Schedule storage is not configured." }, 500);

  const activeMembership = auth.context.memberships?.find((membership) => membership.organizationId === auth.context.organizationId);
  const candidateAgencyId = activeMembership?.kind === "agency" ? activeMembership.organizationId : activeMembership?.parentOrganizationId;
  const selectedAgency = auth.context.memberships?.find((membership) => membership.kind === "agency" && membership.organizationId === candidateAgencyId && membership.role !== "client");
  const agencyId = selectedAgency?.organizationId || "";
  if (!agencyId) return authJson({ error: "Choose an agency workspace you belong to before opening Schedule." }, 403);

  const organizationResponse = await fetch(`${url}/rest/v1/organizations?parent_organization_id=eq.${encodeURIComponent(agencyId)}&kind=eq.client&status=eq.active&select=id`, { headers: serviceHeaders(serviceKey) });
  if (!organizationResponse.ok) return authJson({ error: "Client organizations could not be loaded." }, 502);
  const organizations = await organizationResponse.json().catch(() => []) as Array<{ id?: string }>;
  const organizationIds = organizations.map((organization) => organization.id).filter((id): id is string => Boolean(id));
  if (!organizationIds.length) return authJson({ clients: [], events: [], canManage: auth.context.permissions.includes("operations.manage") });

  const clientResponse = await fetch(`${url}/rest/v1/clients?organization_id=in.(${organizationIds.join(",")})&select=id,name,industry,location,organization_id&order=name.asc`, { headers: serviceHeaders(serviceKey) });
  if (!clientResponse.ok) return authJson({ error: "Client schedule scopes could not be loaded." }, 502);
  const clients = await clientResponse.json().catch(() => []) as ClientRow[];
  const clientIds = clients.map((client) => client.id);
  if (!clientIds.length) return authJson({ clients: [], events: [], canManage: auth.context.permissions.includes("operations.manage") });

  const clientFilter = clientIds.join(",");
  const [jobsResponse, appointmentsResponse, tasksResponse] = await Promise.all([
    fetch(`${url}/rest/v1/service_jobs?client_id=in.(${clientFilter})&scheduled_start=not.is.null&select=id,client_id,title,status,assigned_to,scheduled_start,scheduled_end`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/crm_appointments?client_id=in.(${clientFilter})&select=id,client_id,title,status,assigned_to,starts_at,ends_at`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/crm_tasks?client_id=in.(${clientFilter})&due_at=not.is.null&select=id,client_id,title,status,assigned_to,due_at,job_id`, { headers: serviceHeaders(serviceKey) }),
  ]);
  if (!jobsResponse.ok || !appointmentsResponse.ok || !tasksResponse.ok) return authJson({ error: "Scheduled work could not be loaded." }, 502);

  const jobs = await jobsResponse.json().catch(() => []) as Array<JobRow & { client_id: string }>;
  const appointments = await appointmentsResponse.json().catch(() => []) as Array<AppointmentRow & { client_id: string }>;
  const tasks = await tasksResponse.json().catch(() => []) as Array<TaskRow & { client_id: string }>;
  const assigneeIds = Array.from(new Set([...jobs, ...appointments, ...tasks].map((item) => item.assigned_to).filter((id): id is string => Boolean(id))));
  let profiles: Array<{ id: string; full_name: string; email: string }> = [];
  if (assigneeIds.length) {
    const profileResponse = await fetch(`${url}/rest/v1/profiles?id=in.(${assigneeIds.join(",")})&select=id,full_name,email`, { headers: serviceHeaders(serviceKey) });
    if (profileResponse.ok) profiles = await profileResponse.json().catch(() => []) as typeof profiles;
  }
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const assigneeNames = new Map(profiles.map((profile) => [profile.id, profile.full_name?.trim() || profile.email]));
  const common = (item: ScheduledRow & { client_id: string }) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    assigned_to: item.assigned_to,
    client_id: item.client_id,
    client_name: clientNames.get(item.client_id) || "Client",
    assignee_name: item.assigned_to ? assigneeNames.get(item.assigned_to) || "" : "",
  });
  const events = [
    ...jobs.map((item) => ({ ...common(item), kind: "job", starts_at: item.scheduled_start, ends_at: item.scheduled_end, job_id: item.id })),
    ...appointments.map((item) => ({ ...common(item), kind: "appointment", starts_at: item.starts_at, ends_at: item.ends_at, job_id: null })),
    ...tasks.map((item) => ({ ...common(item), kind: "task", starts_at: item.due_at, ends_at: null, job_id: item.job_id })),
  ].sort((left, right) => left.starts_at.localeCompare(right.starts_at));

  return authJson({
    clients: clients.map((client) => ({ id: client.id, name: client.name, industry: client.industry || "", location: client.location || "" })),
    events,
    canManage: auth.context.permissions.includes("operations.manage"),
  });
};
