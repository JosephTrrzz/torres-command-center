export interface FunctionEnv {
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export type AppRole = "owner" | "employee" | "customer";
export type OrganizationRole = "owner" | "admin" | "operator" | "member" | "viewer" | "client";
export type OrganizationPermission =
  | "organization.manage"
  | "clients.read"
  | "clients.manage"
  | "integrations.read"
  | "integrations.manage"
  | "reports.read"
  | "reports.export"
  | "audit.read"
  | "automation.manage"
  | "ai.use";

export interface AuthOrganizationMembership {
  organizationId: string;
  role: OrganizationRole;
  kind: "agency" | "client";
  parentOrganizationId: string | null;
  legacyClientId: string | null;
}

export interface AuthContext {
  userId: string;
  email: string | null;
  role: AppRole;
  clientId: string | null;
  organizationId: string | null;
  organizationRole: OrganizationRole | null;
  permissions: OrganizationPermission[];
  memberships: AuthOrganizationMembership[];
  authorizationSource: "organization" | "legacy";
}

const ROLE_PERMISSIONS: Record<OrganizationRole, readonly OrganizationPermission[]> = {
  owner: ["organization.manage", "clients.read", "clients.manage", "integrations.read", "integrations.manage", "reports.read", "reports.export", "audit.read", "automation.manage", "ai.use"],
  admin: ["organization.manage", "clients.read", "clients.manage", "integrations.read", "integrations.manage", "reports.read", "reports.export", "audit.read", "automation.manage", "ai.use"],
  operator: ["clients.read", "clients.manage", "integrations.read", "integrations.manage", "reports.read", "reports.export", "ai.use"],
  member: ["clients.read", "integrations.read", "reports.read", "reports.export", "ai.use"],
  viewer: ["clients.read", "integrations.read", "reports.read"],
  client: ["integrations.read", "reports.read", "reports.export", "ai.use"],
};

type ClientOrganization = { id: string; parentOrganizationId: string | null; legacyClientId: string | null };

function supabaseUrl(env: FunctionEnv) {
  return (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
}

function json(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isRole(value: unknown): value is AppRole {
  return value === "owner" || value === "employee" || value === "customer";
}

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return ["owner", "admin", "operator", "member", "viewer", "client"].includes(String(value));
}

function legacyOrganizationRole(role: AppRole): OrganizationRole {
  return role === "owner" ? "owner" : role === "employee" ? "operator" : "client";
}

export function permissionsForOrganizationRole(role: OrganizationRole) {
  return [...ROLE_PERMISSIONS[role]];
}

export function canAccessClient(
  context: Pick<AuthContext, "role" | "clientId"> & Partial<Pick<AuthContext, "memberships">>,
  requestedClientId: string,
  targetOrganization?: ClientOrganization | null,
) {
  const memberships = context.memberships || [];
  if (memberships.length) {
    if (!targetOrganization) return false;
    return memberships.some((membership) =>
      membership.organizationId === targetOrganization.id
      || (targetOrganization.parentOrganizationId !== null
        && membership.organizationId === targetOrganization.parentOrganizationId
        && membership.role !== "client"),
    );
  }
  if (context.clientId === requestedClientId) return true;
  return context.role !== "customer";
}

export function hasOrganizationPermission(context: Pick<AuthContext, "permissions">, permission: OrganizationPermission) {
  return context.permissions.includes(permission);
}

export async function requireAuth(
  request: Request,
  env: FunctionEnv,
  options: { staffOnly?: boolean; clientId?: string; permission?: OrganizationPermission } = {},
): Promise<{ context: AuthContext } | { response: Response }> {
  const url = supabaseUrl(env);
  const anonKey = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const authorization = request.headers.get("Authorization") || "";
  if (!url || !anonKey || !serviceKey) return { response: json({ error: "Authentication storage is not configured." }, 500) };
  if (!authorization.startsWith("Bearer ")) return { response: json({ error: "Sign in before continuing." }, 401) };

  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
  if (!userResponse.ok) return { response: json({ error: "Your session has expired. Sign in again." }, 401) };
  const user = await userResponse.json() as { id?: string; email?: string };
  if (!user.id) return { response: json({ error: "Unable to verify the signed-in user." }, 401) };

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,client_id,default_organization_id,active&limit=1`, {
    headers: serviceHeaders,
  });
  const profiles = await profileResponse.json().catch(() => []) as Array<{ role?: unknown; client_id?: unknown; default_organization_id?: unknown; active?: unknown }>;
  const profile = profiles[0];
  if (!profileResponse.ok || !profile || !isRole(profile.role) || profile.active !== true) return { response: json({ error: "This account is not authorized for the requested action." }, 403) };

  const membershipResponse = await fetch(
    `${url}/rest/v1/organization_memberships?user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&select=organization_id,role,status,organizations!inner(id,kind,parent_organization_id,legacy_client_id,status)`,
    { headers: serviceHeaders },
  );
  const membershipRows = membershipResponse.ok
    ? await membershipResponse.json().catch(() => []) as Array<{
      organization_id?: unknown;
      role?: unknown;
      status?: unknown;
      organizations?: { id?: unknown; kind?: unknown; parent_organization_id?: unknown; legacy_client_id?: unknown; status?: unknown } | null;
    }>
    : [];
  const memberships: AuthOrganizationMembership[] = membershipRows.flatMap((row) => {
    const organization = row.organizations;
    if (row.status !== "active" || organization?.status !== "active" || typeof row.organization_id !== "string" || typeof organization.id !== "string" || !isOrganizationRole(row.role) || (organization.kind !== "agency" && organization.kind !== "client")) return [];
    return [{
      organizationId: row.organization_id,
      role: row.role,
      kind: organization.kind,
      parentOrganizationId: typeof organization.parent_organization_id === "string" ? organization.parent_organization_id : null,
      legacyClientId: typeof organization.legacy_client_id === "string" ? organization.legacy_client_id : null,
    }];
  });
  const defaultOrganizationId = typeof profile.default_organization_id === "string" ? profile.default_organization_id : null;
  const selectedMembership = memberships.find((membership) => membership.organizationId === defaultOrganizationId)
    ?? memberships.find((membership) => membership.kind === "agency")
    ?? memberships[0];
  const fallbackOrganizationRole = legacyOrganizationRole(profile.role);
  const organizationRole = selectedMembership?.role ?? null;
  const permissions = permissionsForOrganizationRole(organizationRole ?? fallbackOrganizationRole);
  const context: AuthContext = {
    userId: user.id,
    email: user.email?.toLowerCase() || null,
    role: profile.role,
    clientId: typeof profile.client_id === "string" ? profile.client_id : null,
    organizationId: selectedMembership?.organizationId ?? defaultOrganizationId,
    organizationRole,
    permissions,
    memberships,
    authorizationSource: selectedMembership ? "organization" : "legacy",
  };

  if (options.staffOnly && (context.organizationRole === "client" || (!context.organizationRole && context.role === "customer"))) return { response: json({ error: "Only workspace staff can manage this resource." }, 403) };
  if (options.permission && !hasOrganizationPermission(context, options.permission)) return { response: json({ error: "Your organization role does not allow this action." }, 403) };
  if (options.clientId) {
    const clientResponse = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(options.clientId)}&select=id,organization_id&limit=1`, { headers: serviceHeaders });
    const clientRows = await clientResponse.json().catch(() => []) as Array<{ id?: unknown; organization_id?: unknown }>;
    const organizationId = typeof clientRows[0]?.organization_id === "string" ? clientRows[0].organization_id : null;
    let targetOrganization: ClientOrganization | null = null;
    if (organizationId) {
      const organizationResponse = await fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(organizationId)}&select=id,parent_organization_id,legacy_client_id&limit=1`, { headers: serviceHeaders });
      const organizationRows = await organizationResponse.json().catch(() => []) as Array<{ id?: unknown; parent_organization_id?: unknown; legacy_client_id?: unknown }>;
      const row = organizationRows[0];
      if (typeof row?.id === "string") targetOrganization = { id: row.id, parentOrganizationId: typeof row.parent_organization_id === "string" ? row.parent_organization_id : null, legacyClientId: typeof row.legacy_client_id === "string" ? row.legacy_client_id : null };
    }
    if (!canAccessClient(context, options.clientId, targetOrganization)) return { response: json({ error: "You do not have access to this client." }, 403) };
  }
  return { context };
}

export function getSupabaseUrl(env: FunctionEnv) {
  return supabaseUrl(env);
}

export function authJson(data: Record<string, unknown>, status = 200) {
  return json(data, status);
}
