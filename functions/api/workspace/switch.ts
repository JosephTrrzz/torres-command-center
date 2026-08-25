import { authJson, canSwitchOrganization, getSupabaseUrl, requireAuth, type FunctionEnv } from "../../_shared/auth";

interface Env extends FunctionEnv {}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const auth = await requireAuth(request, env);
  if ("response" in auth) return auth.response;

  const input = await request.json().catch(() => null) as { organizationId?: string } | null;
  const organizationId = input?.organizationId?.trim() || "";
  if (!UUID_PATTERN.test(organizationId)) return authJson({ error: "Choose a valid workspace." }, 400);
  if (!canSwitchOrganization(auth.context.memberships, organizationId)) return authJson({ error: "You do not have an active membership in that workspace." }, 403);

  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return authJson({ error: "Workspace switching is not configured." }, 500);
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const now = new Date().toISOString();
  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(auth.context.userId)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ default_organization_id: organizationId, updated_at: now }),
  });
  if (!profileResponse.ok) return authJson({ error: "The workspace preference could not be saved." }, 502);

  await fetch(`${url}/rest/v1/audit_events`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      organization_id: organizationId,
      actor_user_id: auth.context.userId,
      action: "organization.workspace.switched",
      entity_type: "organization",
      entity_id: organizationId,
      metadata: { previous_organization_id: auth.context.organizationId },
    }),
  }).catch(() => undefined);

  return authJson({ switched: true, organizationId });
};
