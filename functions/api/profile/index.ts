import { authJson, getSupabaseUrl, requireAuth, type FunctionEnv } from "../../_shared/auth";

type Env = FunctionEnv & { SUPABASE_SERVICE_ROLE_KEY?: string };

export function normalizeProfileName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export const onRequestPatch = async ({ request, env }: { request: Request; env: Env }) => {
  const auth = await requireAuth(request, env);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null) as { fullName?: unknown } | null;
  const fullName = normalizeProfileName(body?.fullName);
  if (fullName.length < 2 || fullName.length > 120) {
    return authJson({ error: "Enter a name between 2 and 120 characters." }, 400);
  }

  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(auth.context.userId)}`, {
    method: "PATCH",
    headers: { ...serviceHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ full_name: fullName, updated_at: new Date().toISOString() }),
  });
  const rows = await profileResponse.json().catch(() => []) as Array<{ full_name?: unknown }>;
  if (!profileResponse.ok || typeof rows[0]?.full_name !== "string") {
    return authJson({ error: "Supabase could not confirm your profile update." }, 502);
  }

  if (auth.context.organizationId) {
    await fetch(`${url}/rest/v1/audit_events`, {
      method: "POST",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        organization_id: auth.context.organizationId,
        actor_user_id: auth.context.userId,
        action: "profile.display_name.updated",
        entity_type: "profile",
        entity_id: auth.context.userId,
        metadata: { fields: ["full_name"] },
      }),
    });
  }

  return authJson({ profile: { full_name: rows[0].full_name }, message: "Your display name was saved to Supabase." });
};
