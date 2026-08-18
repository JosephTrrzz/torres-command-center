const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function signInWithPassword(email: string, password: string) {
  if (!supabaseUrl || !supabaseKey) throw new Error("Supabase is not configured yet.");
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.msg || "Unable to sign in.");
  return data;
}

export async function requestPasswordReset(email: string) {
  if (!supabaseUrl || !supabaseKey) throw new Error("Supabase is not configured yet.");
  const response = await fetch(`${supabaseUrl}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error("Unable to request a password reset.");
}
