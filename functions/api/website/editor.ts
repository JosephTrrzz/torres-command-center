import { authJson, getSupabaseUrl, requireAuth, type FunctionEnv } from "../../_shared/auth";
import { originalIntro, TORRES_SITE_CLIENT, validIntro } from "../../../lib/website-editor";

export async function onRequest({ request, env }: { request: Request; env: FunctionEnv }) {
  const auth = await requireAuth(request, env, { clientId: TORRES_SITE_CLIENT });
  if ("response" in auth) return auth.response;
  const ctx = auth.context;
  const allowed = ctx.organizationRole ? (["owner", "admin"].includes(ctx.organizationRole) || (ctx.organizationRole === "client" && ctx.clientId === TORRES_SITE_CLIENT))
    : ctx.role === "owner" || (ctx.role === "customer" && ctx.clientId === TORRES_SITE_CLIENT);
  if (!allowed) return authJson({ error: "Website editing is unavailable for this account." }, 403);
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Prefer: "return=representation" };
  let url = getSupabaseUrl(env) + "/rest/v1/website_homepages?client_id=eq." + TORRES_SITE_CLIENT + "&select=draft,revision";
  let options: RequestInit = { headers };
  if (request.method === "POST") {
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) return authJson({ error: "Send a JSON draft." }, 415);
    const length = Number(request.headers.get("Content-Length"));
    if (!length || length > 710000) return authJson({ error: "Choose a smaller image." }, 413);
    const body = await request.json().catch(() => null);
    if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0 || !["save", "publish"].includes(body.action) || !validIntro(body.intro)) return authJson({ error: "Check the text, image type, size, and alternative text." }, 400);
    const { heading, emphasis, description, photo, alt } = body.intro;
    const draft = { heading, emphasis, description, photo, alt };
    url += "&revision=eq." + body.revision;
    options = { method: "PATCH", headers, body: JSON.stringify({ draft, revision: body.revision + 1, ...(body.action === "publish" ? { published: draft } : {}) }) };
  } else if (request.method !== "GET") return authJson({ error: "Unsupported method." }, 405);
  const response = await fetch(url, options);
  if (!response.ok) return authJson({ error: "Website storage is unavailable." }, 503);
  const [row] = await response.json();
  if (!row) return authJson({ error: request.method === "POST" ? "Another edit was saved. Reload before continuing." : "Website editing has not been connected." }, 409);
  return authJson({ intro: row.draft ?? originalIntro, revision: row.revision });
}
