export interface FunctionEnv {
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export type AppRole = "owner" | "employee" | "customer";

export interface AuthContext {
  userId: string;
  role: AppRole;
  clientId: string | null;
}

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

export function canAccessClient(context: Pick<AuthContext, "role" | "clientId">, requestedClientId: string) {
  return context.role !== "customer" || context.clientId === requestedClientId;
}

export async function requireAuth(
  request: Request,
  env: FunctionEnv,
  options: { staffOnly?: boolean; clientId?: string } = {},
): Promise<{ context: AuthContext } | { response: Response }> {
  const url = supabaseUrl(env);
  const anonKey = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const authorization = request.headers.get("Authorization") || "";
  if (!url || !anonKey || !serviceKey) return { response: json({ error: "Authentication storage is not configured." }, 500) };
  if (!authorization.startsWith("Bearer ")) return { response: json({ error: "Sign in before continuing." }, 401) };

  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
  if (!userResponse.ok) return { response: json({ error: "Your session has expired. Sign in again." }, 401) };
  const user = await userResponse.json() as { id?: string };
  if (!user.id) return { response: json({ error: "Unable to verify the signed-in user." }, 401) };

  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,client_id,active&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const profiles = await profileResponse.json().catch(() => []) as Array<{ role?: unknown; client_id?: unknown; active?: unknown }>;
  const profile = profiles[0];
  if (!profileResponse.ok || !profile || !isRole(profile.role) || profile.active !== true) return { response: json({ error: "This account is not authorized for the requested action." }, 403) };

  const context: AuthContext = {
    userId: user.id,
    role: profile.role,
    clientId: typeof profile.client_id === "string" ? profile.client_id : null,
  };
  if (options.staffOnly && context.role === "customer") return { response: json({ error: "Only workspace staff can manage this resource." }, 403) };
  if (options.clientId && !canAccessClient(context, options.clientId)) return { response: json({ error: "You do not have access to this client." }, 403) };
  return { context };
}

export function getSupabaseUrl(env: FunctionEnv) {
  return supabaseUrl(env);
}

export function authJson(data: Record<string, unknown>, status = 200) {
  return json(data, status);
}
