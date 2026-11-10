import {
  authJson,
  getSupabaseUrl,
  requireAuth,
  type AuthContext,
  type FunctionEnv,
} from "./auth";

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
  // Client memberships are authoritative over stale profile assignments. Agency
  // administrators must also have an explicit profile website assignment; their
  // broader agency-management role never grants editor access to every client.
  const activeMembership = user.memberships?.find(
    (membership) => membership.organizationId === user.organizationId,
  );
  const assigned = activeMembership?.kind === "client"
    ? activeMembership.legacyClientId
    : customer && user.memberships?.length ? null : user.clientId;
  const requested = new URL(request.url).searchParams.get("client");
  const clientId = assigned;
  if (
    !clientId ||
    !/^[0-9a-f-]{36}$/i.test(clientId) ||
    (requested && requested !== clientId)
  )
    return {
      response: authJson({ error: "Website access is unavailable." }, 403),
    };
  const result = await requireAuth(request, env, { clientId });
  if ("response" in result) return result;
  const c = result.context;
  const staff =
    !c.websiteOnly &&
    (c.organizationRole
      ? ["owner", "admin"].includes(c.organizationRole)
      : c.role === "owner");
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
