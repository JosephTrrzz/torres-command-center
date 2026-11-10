import {
  authJson,
  getSupabaseUrl,
  requireAuth,
  type AuthContext,
  type FunctionEnv,
} from "./auth";

export function studioAdministrator(user: AuthContext) {
  return !user.websiteOnly && !user.memberships?.some(m => m.organizationId === user.organizationId && m.kind === "client") && (user.organizationRole
    ? ["owner", "admin"].includes(user.organizationRole)
    : user.role === "owner");
}

export async function studioAccess(
  request: Request,
  env: FunctionEnv,
): Promise<
  | { response: Response }
  | { context: AuthContext; staff: boolean; clientId: string }
> {
  const identity = await requireAuth(request, env);
  if ("response" in identity) return identity;
  const user = identity.context;
  const customer =
    user.websiteOnly ||
    (user.organizationRole
      ? user.organizationRole === "client"
      : user.role === "customer");
  // Client memberships override stale profile assignments. Administrators may
  // select a managed client, but requireAuth must verify that target separately.
  const activeMembership = user.memberships?.find(
    (membership) => membership.organizationId === user.organizationId,
  );
  const assigned = activeMembership?.kind === "client"
    ? activeMembership.legacyClientId
    : customer && user.memberships?.length ? null : user.clientId;
  const requested = new URL(request.url).searchParams.get("client");
  const administrator = studioAdministrator(user);
  const clientId = administrator ? requested || assigned : assigned;
  if (
    !clientId ||
    !/^[0-9a-f-]{36}$/i.test(clientId) ||
    (!administrator && requested && requested !== clientId)
  )
    return {
      response: authJson({ error: "Website access is unavailable." }, 403),
    };
  const result = await requireAuth(request, env, { clientId });
  if ("response" in result) return result;
  const c = result.context;
  const staff = !c.websiteOnly && (c.organizationRole
    ? ["owner", "admin"].includes(c.organizationRole) : c.role === "owner");
  const client = c.organizationRole
    ? c.organizationRole === "client"
    : c.role === "customer";
  if (
    !staff &&
    !(
      client &&
      (c.memberships?.some(
        (m) => m.kind === "client" && m.legacyClientId === clientId,
      ) ||
        c.clientId === clientId)
    )
  )
    return {
      response: authJson({ error: "Website access is unavailable." }, 403),
    } as const;
  return { context: c, staff, clientId } as const;
}
export function studioStore(env: FunctionEnv) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    rest: getSupabaseUrl(env) + "/rest/v1",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
  };
}
