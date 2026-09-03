import { requireAuth, getSupabaseUrl } from "../../_shared/auth";
import { fetchGoogleMetrics, loadGoogleConnection, readStoredGoogleMetrics, type GoogleMetricsEnv } from "../../_shared/google-metrics";

type Env = GoogleMetricsEnv;

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const clientId = new URL(request.url).searchParams.get("client");
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "Choose a valid client first." }, 400);
  const auth = await requireAuth(request, env, { clientId, permission: "reports.read" });
  if ("response" in auth) return auth.response;
  const supabaseUrl = getSupabaseUrl(env);
  if (!supabaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Report storage is not configured." }, 500);
  const connection = await loadGoogleConnection(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, clientId);
  if (!connection?.access_token) return json({ clientId, available: false, error: "Connect Google before loading report metrics." });
  const stored = await readStoredGoogleMetrics(env, clientId, connection);
  if (stored) return json(stored);
  const live = await fetchGoogleMetrics(connection, clientId, env);
  return json(live.snapshot);
};
