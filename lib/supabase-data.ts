import { ClientDetail } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function fetchClients(): Promise<ClientDetail[]> {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const raw = typeof window !== "undefined" ? window.localStorage.getItem("torres-auth-session") : null;
  const session = raw ? JSON.parse(raw) : null;
  const response = await fetch(`${url}/rest/v1/clients?select=*&order=created_at.desc`, { headers: { apikey: key, Authorization: `Bearer ${session?.access_token ?? key}` } });
  if (!response.ok) throw new Error("Unable to load clients.");
  return (await response.json()).map((row: any) => {
    const name = row.name as string;
    return { id: row.id, name, initials: name.split(/\s+/).map((part: string) => part[0]).join("").slice(0, 2).toUpperCase(), industry: row.industry ?? "Client account", location: row.location ?? "—", website: row.website ?? "—", email: row.email ?? "", phone: row.phone ?? "", status: (row.health_score ?? 0) >= 80 ? "healthy" : "watch", health: row.health_score ?? 0, metrics: [{ label: "Health score", value: `${row.health_score ?? 0}`, change: "—", trend: "flat" }], traffic: [], opportunities: [], overview: "Client profile connected to the Torres & Co. Command Center.", owner: "Joseph Torres", services: [], lastUpdated: "Today" } as ClientDetail;
  });
}

export async function createClient(input: { name: string; industry: string; location: string; website: string; email: string; phone: string; health_score: number }) {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const raw = typeof window !== "undefined" ? window.localStorage.getItem("torres-auth-session") : null;
  const session = raw ? JSON.parse(raw) : null;
  const response = await fetch(`${url}/rest/v1/clients`, { method: "POST", headers: { ...headersForWrite(session), "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error("Unable to create client. Check your Supabase permissions.");
  return response.json();
}

function headersForWrite(session: { access_token?: string } | null) {
  return { apikey: key ?? "", Authorization: `Bearer ${session?.access_token ?? key ?? ""}` };
}

export async function updateClient(id: string, input: Record<string, string | number>) {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const raw = window.localStorage.getItem("torres-auth-session");
  const session = raw ? JSON.parse(raw) : null;
  const response = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { ...headersForWrite(session), "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error("Unable to update client. Check your Supabase permissions.");
}
