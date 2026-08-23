import type { AppRole, AuthSession, UserProfile } from "./types";

const SESSION_KEY = "torres-auth-session";

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
    typeof profile.active === "boolean"
  );
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

  const profileResponse = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,full_name,role,client_id,active&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${auth.access_token}`,
      },
    },
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

  return {
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    expires_at: auth.expires_at,
    user: { id: userId, email: auth.user?.email },
    profile,
  };
}

export function storeAuthSession(session: AuthSession) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
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
