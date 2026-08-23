interface Env {
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const clientId = new URL(request.url).searchParams.get("client");
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return json({ connected: false }, 400);

  const supabaseUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  if (!supabaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ connected: false, configured: false }, 200);

  const response = await fetch(`${supabaseUrl}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(clientId)}&select=google_email,updated_at`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) return json({ connected: false, configured: false }, 200);
  const rows = await response.json() as Array<{ google_email?: string; updated_at?: string }>;
  return json({
    connected: Boolean(rows[0]),
    googleEmail: rows[0]?.google_email || null,
    updatedAt: rows[0]?.updated_at || null,
  });
};
