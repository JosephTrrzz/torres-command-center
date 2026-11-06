import { getSupabaseUrl, type FunctionEnv } from "../../_shared/auth";
import { TORRES_SITE_CLIENT } from "../../../lib/website-editor";

// Public contract exposes only the explicitly published homepage of the Torres website.
export async function onRequestGet({ env }: { env: FunctionEnv }) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(getSupabaseUrl(env) + "/rest/v1/website_homepages?select=published&client_id=eq." + TORRES_SITE_CLIENT, { headers: { apikey: key, Authorization: "Bearer " + key } });
  if (!res.ok) return new Response(null, { status: 503 });
  const [row] = await res.json();
  return Response.json(row?.published ?? null, { headers: { "Cache-Control": "public, max-age=30", "Access-Control-Allow-Origin": "*" } });
}
