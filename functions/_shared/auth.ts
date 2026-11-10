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
  | "crm.read"
  | "crm.manage"
  | "operations.read"
  | "operations.manage"
  | "communications.read"
  | "communications.manage"
  | "marketing.read"
  | "marketing.manage"
  | "integrations.read"
  | "integrations.manage"
  | "reports.read"
  | "reports.export"
  | "audit.read"
  | "automation.manage";

export interface AuthOrganizationMembership {
  organizationId: string;
  role: OrganizationRole;
  kind: "agency" | "client";
  parentOrganizationId: string | null;
  legacyClientId: string | null;
}

export interface AuthContext {
  websiteOnly?: boolean;
  userId: string;
  email: string | null;
  fullName: string | null;
  role: AppRole;
  clientId: string | null;
  organizationId: string | null;
  organizationRole: OrganizationRole | null;
  permissions: OrganizationPermission[];
  memberships: AuthOrganizationMembership[];
  authorizationSource: "organization" | "legacy";
}

const ROLE_PERMISSIONS: Record<OrganizationRole, readonly OrganizationPermission[]> = {
  owner: ["organization.manage", "clients.read", "clients.manage", "crm.read", "crm.manage", "operations.read", "operations.manage", "communications.read", "communications.manage", "marketing.read", "marketing.manage", "integrations.read", "integrations.manage", "reports.read", "reports.export", "audit.read", "automation.manage"],
  admin: ["organization.manage", "clients.read", "clients.manage", "crm.read", "crm.manage", "operations.read", "operations.manage", "communications.read", "communications.manage", "marketing.read", "marketing.manage", "integrations.read", "integrations.manage", "reports.read", "reports.export", "audit.read", "automation.manage"],
  operator: ["clients.read", "clients.manage", "crm.read", "crm.manage", "operations.read", "operations.manage", "communications.read", "communications.manage", "marketing.read", "marketing.manage", "integrations.read", "integrations.manage", "reports.read", "reports.export"],
  member: ["clients.read", "crm.read", "operations.read", "communications.read", "communications.manage", "marketing.read", "integrations.read", "reports.read", "reports.export"],
  viewer: ["clients.read", "crm.read", "operations.read", "communications.read", "marketing.read", "integrations.read", "reports.read"],
  client: ["operations.read", "communications.read", "communications.manage", "integrations.read", "reports.read", "reports.export"],
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
  return typeof value === "string" && ["owner", "admin", "operator", "member", "viewer", "client"].includes(value);
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
        && membership.kind === "agency" && membership.role !== "client"),
    );
  }
  if (context.clientId === requestedClientId) return true;
  return context.role !== "customer";
}

export function hasOrganizationPermission(context: Pick<AuthContext, "permissions">, permission: OrganizationPermission) {
  return context.permissions.includes(permission);
}

export function authDisplayName(
  context: Pick<AuthContext, "fullName" | "email">,
  fallback = "Workspace member",
) {
  const fullName = context.fullName?.trim();
  if (fullName) return fullName;
  const localPart = context.email?.split("@")[0]?.trim() || "";
  if (!localPart) return fallback;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function canSwitchOrganization(memberships: AuthOrganizationMembership[], organizationId: string) {
  return memberships.some((membership) => membership.organizationId === organizationId);
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

  const authorized = await authorizeVerifiedUser({ id: user.id, email: user.email }, env, options);
  if ("response" in authorized) return authorized;
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const websitePaths = ["/api/website/publish", "/api/website/canvas-drafts", "/api/website/workspace", "/api/website/revisions", "/api/website/assets", "/api/website/reviews", "/api/customer-activate", "/api/invitation-accept"];
  if (authorized.context.websiteOnly && !websitePaths.includes(path))
    return { response: json({ error: "This account has access to Website only." }, 403) };
  return authorized;
}

// Internal server helper: only call with an identity verified by Auth or a
// short-lived, server-authenticated OAuth transaction. Never accept a request user id.
export async function authorizeVerifiedUser(
  user: { id: string; email?: string },
  env: FunctionEnv,
  options: { staffOnly?: boolean; clientId?: string; permission?: OrganizationPermission } = {},
): Promise<{ context: AuthContext } | { response: Response }> {
  const url = supabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return { response: json({ error: "Authentication storage is not configured." }, 500) };
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,client_id,default_organization_id,full_name,active,website_only&limit=1`, {
    headers: serviceHeaders,
  });
  const profiles = await profileResponse.json().catch(() => []) as Array<{ role?: unknown; client_id?: unknown; default_organization_id?: unknown; full_name?: unknown; active?: unknown; website_only?: unknown }>;
  const profile = profiles[0];
  if (!profileResponse.ok || !profile || !isRole(profile.role) || profile.active !== true) return { response: json({ error: "This account is not authorized for the requested action." }, 403) };

  const membershipResponse = await fetch(
    `${url}/rest/v1/organization_memberships?user_id=eq.${encodeURIComponent(user.id)}&select=organization_id,role,status,organizations!inner(id,kind,parent_organization_id,legacy_client_id,status)`,
    { headers: serviceHeaders },
  ).catch(() => null);
  if (!membershipResponse?.ok) return { response: json({ error: "Workspace access could not be verified. Please try again." }, 503) };
  const membershipData: unknown = await membershipResponse.json().catch(() => null);
  if (!Array.isArray(membershipData)) return { response: json({ error: "Workspace access could not be verified. Please try again." }, 503) };
  type MembershipRow = {
    organization_id: string;
    role: OrganizationRole;
    status: string;
    organizations: { id: string; kind: "agency" | "client"; status: string; parent_organization_id?: string | null; legacy_client_id?: string | null };
  };
  const validRow = (value: unknown): value is MembershipRow => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    if (!row.organizations || typeof row.organizations !== "object" || Array.isArray(row.organizations)) return false;
    const organization = row.organizations as Record<string, unknown>;
    return typeof row.organization_id === "string" && Boolean(row.organization_id)
      && organization.id === row.organization_id && isOrganizationRole(row.role)
      && typeof row.status === "string" && ["active", "invited", "suspended", "revoked"].includes(row.status)
      && (organization.kind === "agency" || organization.kind === "client")
      && typeof organization.status === "string" && ["active", "invited", "paused", "archived"].includes(organization.status)
      && [organization.parent_organization_id, organization.legacy_client_id].every((id) => id == null || (typeof id === "string" && Boolean(id)));
  };
  if (!membershipData.every(validRow)) return { response: json({ error: "Workspace access could not be verified. Please try again." }, 503) };
  const membershipRows = membershipData;
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
  // Compatibility is only for users who have never entered the membership model.
  // Revoked memberships or paused organizations must not resurrect a legacy role.
  if (membershipRows.length && !memberships.length) return { response: json({ error: "This account has no active workspace access." }, 403) };
  const defaultOrganizationId = typeof profile.default_organization_id === "string" ? profile.default_organization_id : null;
  const selectedMembership = memberships.find((membership) => membership.organizationId === defaultOrganizationId)
    ?? memberships.find((membership) => membership.kind === "agency")
    ?? memberships[0];
  const fallbackOrganizationRole = legacyOrganizationRole(profile.role);
  const organizationRole = selectedMembership?.role ?? null;
  const permissions = permissionsForOrganizationRole(organizationRole ?? fallbackOrganizationRole);
  const context: AuthContext = {
    websiteOnly: profile.website_only === true,
    userId: user.id,
    email: user.email?.toLowerCase() || null,
    fullName: typeof profile.full_name === "string" && profile.full_name.trim() ? profile.full_name.trim() : null,
    role: profile.role,
    clientId: typeof profile.client_id === "string" ? profile.client_id : null,
    organizationId: selectedMembership?.organizationId ?? defaultOrganizationId,
    organizationRole,
    permissions,
    memberships,
    authorizationSource: selectedMembership ? "organization" : "legacy",
  };

  if (!options.clientId && options.staffOnly && (context.organizationRole === "client" || (!context.organizationRole && context.role === "customer"))) return { response: json({ error: "Only workspace staff can manage this resource." }, 403) };
  if (!options.clientId && options.permission && !hasOrganizationPermission(context, options.permission)) return { response: json({ error: "Your organization role does not allow this action." }, 403) };
  if (options.clientId) {
    const clientResponse = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(options.clientId)}&select=id,organization_id&limit=1`, { headers: serviceHeaders });
    if (!clientResponse.ok) return { response: json({ error: "Client access could not be verified. Please try again." }, 503) };
    const clientData: unknown = await clientResponse.json().catch(() => null);
    if (!Array.isArray(clientData)) return { response: json({ error: "Client access could not be verified. Please try again." }, 503) };
    const clientRows = clientData as Array<{ id?: unknown; organization_id?: unknown }>;
    if (!clientRows[0] || clientRows[0].id !== options.clientId) return { response: json({ error: "This client could not be found." }, 404) };
    const organizationId = typeof clientRows[0]?.organization_id === "string" ? clientRows[0].organization_id : null;
    let targetOrganization: ClientOrganization | null = null;
    if (organizationId) {
      const organizationResponse = await fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(organizationId)}&select=id,parent_organization_id,legacy_client_id,status&limit=1`, { headers: serviceHeaders });
      if (!organizationResponse.ok) return { response: json({ error: "Client workspace access could not be verified. Please try again." }, 503) };
      const organizationData: unknown = await organizationResponse.json().catch(() => null);
      if (!Array.isArray(organizationData)) return { response: json({ error: "Client workspace access could not be verified. Please try again." }, 503) };
      const organizationRows = organizationData as Array<{ id?: unknown; parent_organization_id?: unknown; legacy_client_id?: unknown; status?: unknown }>;
      const row = organizationRows[0];
      if (row?.id !== organizationId || row.status !== "active") return { response: json({ error: "This client workspace is not active." }, 403) };
      if (typeof row?.id === "string") targetOrganization = { id: row.id, parentOrganizationId: typeof row.parent_organization_id === "string" ? row.parent_organization_id : null, legacyClientId: typeof row.legacy_client_id === "string" ? row.legacy_client_id : null };
    }
    if (memberships.length && targetOrganization) {
      const applicable = memberships.filter((membership) => membership.organizationId === targetOrganization.id
        || (membership.organizationId === targetOrganization.parentOrganizationId && membership.kind === "agency" && membership.role !== "client"));
      const permitted = applicable.filter((membership) => (!options.staffOnly || membership.role !== "client")
        && (!options.permission || permissionsForOrganizationRole(membership.role).includes(options.permission)));
      const targetMembership = permitted.find((membership) => membership.organizationId === selectedMembership?.organizationId) ?? permitted[0];
      if (!targetMembership) return { response: json({ error: "Your role does not allow access to this client resource." }, 403) };
      context.organizationId = targetMembership.organizationId;
      context.organizationRole = targetMembership.role;
      context.permissions = permissionsForOrganizationRole(targetMembership.role);
    }
    if (options.staffOnly && (context.organizationRole === "client" || (!context.organizationRole && context.role === "customer"))) return { response: json({ error: "Only workspace staff can manage this resource." }, 403) };
    if (options.permission && !hasOrganizationPermission(context, options.permission)) return { response: json({ error: "Your organization role does not allow this action." }, 403) };
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
