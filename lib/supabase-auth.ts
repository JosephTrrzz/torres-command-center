import { ROLE_PERMISSIONS } from "./organization-access";
import type { AppRole, AuthSession, AuthUser, OrganizationAccess, OrganizationKind, OrganizationRole, UserProfile } from "./types";

const SESSION_KEY = "torres-auth-session";
export const AUTH_SESSION_EVENT = "torres-auth-session-changed";

function getConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase authentication is not configured.");
  }

  return { url: url.replace(/\/$/, ""), key };
}

async function parseError(response: Response) {
  const payload = await response.json().catch(() => null);
  return (
    payload?.msg ||
    payload?.message ||
    payload?.error_description ||
    "Unable to complete this request."
  );
}

function isRole(value: unknown): value is AppRole {
  return value === "owner" || value === "employee" || value === "customer";
}

function isProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<UserProfile>;
  return (
    typeof profile.id === "string" &&
    typeof profile.email === "string" &&
    typeof profile.full_name === "string" &&
    isRole(profile.role) &&
    (typeof profile.client_id === "string" || profile.client_id === null) &&
    (typeof profile.default_organization_id === "string" || profile.default_organization_id === null || profile.default_organization_id === undefined) &&
    typeof profile.active === "boolean"
  );
}

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return ["owner", "admin", "operator", "member", "viewer", "client"].includes(String(value));
}

function isOrganizationKind(value: unknown): value is OrganizationKind {
  return value === "agency" || value === "client";
}

type MembershipRow = {
  organization_id?: unknown;
  role?: unknown;
  status?: unknown;
  organizations?: {
    id?: unknown;
    name?: unknown;
    slug?: unknown;
    kind?: unknown;
    status?: unknown;
  } | null;
};

function organizationsFromMemberships(rows: MembershipRow[]): OrganizationAccess[] {
  const active = rows.filter((row) => row.status === "active" && isOrganizationRole(row.role) && row.organizations?.status === "active");
  return active.flatMap((row) => {
    const organization = row.organizations;
    if (!organization || typeof organization.id !== "string" || typeof organization.name !== "string" || typeof organization.slug !== "string" || !isOrganizationKind(organization.kind) || !isOrganizationRole(row.role)) return [];
    return [{
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      kind: organization.kind,
      role: row.role,
      permissions: [...ROLE_PERMISSIONS[row.role]],
    }];
  }).sort((left, right) => Number(right.kind === "agency") - Number(left.kind === "agency") || left.name.localeCompare(right.name));
}

function selectedOrganization(organizations: OrganizationAccess[], defaultOrganizationId?: string | null) {
  return organizations.find((organization) => organization.id === defaultOrganizationId)
    ?? organizations.find((organization) => organization.kind === "agency")
    ?? organizations[0];
}

export async function createAuthSession(
  email: string,
  password: string,
): Promise<AuthSession> {
  const { url, key } = getConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) throw new Error(await parseError(response));
  const auth = await response.json();
  const userId = auth.user?.id;

  if (!auth.access_token || !userId) {
    throw new Error("Supabase did not return a valid sign-in session.");
  }

  return createAuthSessionFromTokens(auth.access_token, auth.refresh_token, auth.expires_at, { id: userId, email: auth.user?.email });
}

export async function createAuthSessionFromTokens(
  accessToken: string,
  refreshToken: string | undefined,
  expiresAt: number | undefined,
  user: AuthUser,
): Promise<AuthSession> {
  const { url, key } = getConfig();
  const profileResponse = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,full_name,role,client_id,default_organization_id,active&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${accessToken}` } },
  );

  if (!profileResponse.ok) throw new Error(await parseError(profileResponse));
  const profiles = await profileResponse.json();
  const profile = profiles?.[0];

  if (!isProfile(profile)) {
    throw new Error("This account has not been assigned an access profile yet.");
  }
  if (!profile.active) {
    throw new Error("This account is inactive. Contact Torres & Co. for access.");
  }

  let organization: OrganizationAccess | undefined;
  let organizations: OrganizationAccess[] = [];
  const membershipResponse = await fetch(
    `${url}/rest/v1/organization_memberships?user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&select=organization_id,role,status,organizations!inner(id,name,slug,kind,status)`,
    { headers: { apikey: key, Authorization: `Bearer ${accessToken}` } },
  );
  if (membershipResponse.ok) {
    const memberships = await membershipResponse.json().catch(() => []) as MembershipRow[];
    organizations = organizationsFromMemberships(memberships);
    organization = selectedOrganization(organizations, profile.default_organization_id);
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    user,
    profile,
    organization,
    organizations,
  };
}

export async function switchOrganization(session: AuthSession, organizationId: string): Promise<AuthSession> {
  const response = await fetch("/api/workspace/switch", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  const selected = (session.organizations || []).find((organization) => organization.id === organizationId);
  if (!selected) throw new Error("That workspace is not available in this session.");
  return {
    ...session,
    organization: selected,
    profile: { ...session.profile, default_organization_id: selected.id },
  };
}

export function storeAuthSession(session: AuthSession) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.dispatchEvent(new CustomEvent<AuthSession>(AUTH_SESSION_EVENT, { detail: session }));
  }
}

export function readStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    if (
      !parsed ||
      typeof parsed.access_token !== "string" ||
      !parsed.user?.id ||
      !isProfile(parsed.profile)
    ) {
      return null;
    }
    if (parsed.expires_at && parsed.expires_at * 1000 <= Date.now()) {
      clearAuthSession();
      return null;
    }

    return parsed as AuthSession;
  } catch {
    return null;
  }
}

export function clearAuthSession() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem("torres-demo-session");
  }
}

export async function requestPasswordReset(email: string) {
  const { url, key } = getConfig();
  const redirectTo =
    typeof window === "undefined" ? undefined : `${window.location.origin}/login/`;
  const response = await fetch(`${url}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, redirect_to: redirectTo }),
  });
  if (!response.ok) throw new Error(await parseError(response));
}
