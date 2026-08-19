import { BillingStatus, ClientDetail, ClientPerson, CustomerAccount, PortalStatus } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function fetchClients(): Promise<ClientDetail[]> {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const response = await fetch(`${url}/rest/v1/clients?select=*&order=created_at.desc`, { headers: headersForRead() });
  if (!response.ok) throw new Error("Unable to load clients.");
  return (await response.json()).map(mapClientRow);
}

function mapClientRow(row: any): ClientDetail {
    const name = row.name as string;
    return { id: row.id, name, initials: name.split(/\s+/).map((part: string) => part[0]).join("").slice(0, 2).toUpperCase(), industry: row.industry ?? "Client account", location: row.location ?? "—", website: row.website ?? "—", email: row.email ?? "", phone: row.phone ?? "", status: (row.health_score ?? 0) >= 80 ? "healthy" : "watch", health: row.health_score ?? 0, metrics: [{ label: "Health score", value: `${row.health_score ?? 0}`, change: "—", trend: "flat" }], traffic: [], opportunities: [], overview: "Client profile connected to the Torres & Co. Command Center.", owner: "Joseph Torres", services: [], lastUpdated: "Today" } as ClientDetail;
}

export async function fetchClient(id: string): Promise<ClientDetail | null> {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const response = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(id)}&select=*`, { headers: headersForRead() });
  if (!response.ok) throw new Error("Unable to load this client.");
  const rows = await response.json();
  return rows[0] ? mapClientRow(rows[0]) : null;
}

export async function createClient(input: { name: string; industry: string; location: string; website: string; email: string; phone: string; health_score: number }) {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const session = getSession();
  const response = await fetch(`${url}/rest/v1/clients`, { method: "POST", headers: { ...headersForWrite(session), "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error("Unable to create client. Check your Supabase permissions.");
  return response.json();
}

function headersForWrite(session: { access_token?: string } | null) {
  return { apikey: key ?? "", Authorization: `Bearer ${session?.access_token ?? key ?? ""}` };
}

export async function updateClient(id: string, input: Record<string, string | number>) {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const session = getSession();
  const response = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { ...headersForWrite(session), "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error("Unable to update client. Check your Supabase permissions.");
}

export async function fetchClientPeople(clientId: string): Promise<ClientPerson[]> {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const response = await fetch(`${url}/rest/v1/client_people?client_id=eq.${encodeURIComponent(clientId)}&select=*&order=created_at.asc`, { headers: headersForRead() });
  if (!response.ok) throw new Error("Unable to load people. Run the client_people.sql setup in Supabase.");
  return response.json();
}

function mapCustomerAccount(row: any): CustomerAccount {
  return { id: row.id, client_id: row.client_id, portal_email: row.portal_email ?? "", portal_enabled: Boolean(row.portal_enabled), portal_status: row.portal_status ?? "invited", billing_email: row.billing_email ?? "", billing_status: row.billing_status ?? "not_connected", square_customer_id: row.square_customer_id ?? null, square_subscription_id: row.square_subscription_id ?? null, created_at: row.created_at, updated_at: row.updated_at };
}

export async function fetchCustomerAccount(clientId: string): Promise<CustomerAccount | null> {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const response = await fetch(`${url}/rest/v1/customer_accounts?client_id=eq.${encodeURIComponent(clientId)}&select=*`, { headers: headersForRead() });
  if (!response.ok) throw new Error("Unable to load customer portal settings. Run customer_accounts.sql in Supabase.");
  const rows = await response.json();
  return rows[0] ? mapCustomerAccount(rows[0]) : null;
}

export async function upsertCustomerAccount(input: { client_id: string; portal_email: string; portal_enabled: boolean; portal_status: PortalStatus; billing_email: string; billing_status: BillingStatus; }) {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const response = await fetch(`${url}/rest/v1/customer_accounts?on_conflict=client_id`, { method: "POST", headers: { ...headersForWrite(getSession()), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error("Unable to save customer portal settings. Check the customer_accounts table and permissions.");
  const rows = await response.json();
  return rows[0] ? mapCustomerAccount(rows[0]) : null;
}

export async function createClientPerson(input: Omit<ClientPerson, "id" | "created_at">) {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const response = await fetch(`${url}/rest/v1/client_people`, { method: "POST", headers: { ...headersForWrite(getSession()), "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error("Unable to add this person. Check the client_people table and permissions.");
  return response.json();
}

export async function updateClientPerson(id: string, input: Partial<Omit<ClientPerson, "id" | "client_id" | "created_at">>) {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const response = await fetch(`${url}/rest/v1/client_people?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { ...headersForWrite(getSession()), "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error("Unable to update this person.");
}

export async function deleteClientPerson(id: string) {
  if (!url || !key) throw new Error("Supabase is not configured yet.");
  const response = await fetch(`${url}/rest/v1/client_people?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: headersForWrite(getSession()) });
  if (!response.ok) throw new Error("Unable to remove this person.");
}

function getSession(): { access_token?: string } | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem("torres-auth-session");
  return raw ? JSON.parse(raw) : null;
}

function headersForRead() {
  const session = getSession();
  return { apikey: key ?? "", Authorization: `Bearer ${session?.access_token ?? key ?? ""}` };
}
