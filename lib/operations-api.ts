import type { AuthSession } from "./types";
import type { OperationsSnapshot } from "./operations";

type OperationsResponse = { snapshot?: OperationsSnapshot; message?: string; error?: string };

async function requestOperations(session: AuthSession, path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({})) as OperationsResponse;
  if (!response.ok || !body.snapshot) throw new Error(body.error || "Operations information could not be loaded.");
  return body;
}

export async function fetchOperations(session: AuthSession, clientId?: string) {
  const query = clientId ? `?client=${encodeURIComponent(clientId)}` : "";
  return (await requestOperations(session, `/api/operations/${query}`)).snapshot as OperationsSnapshot;
}

export async function changeOperations(session: AuthSession, input: Record<string, unknown>) {
  return requestOperations(session, "/api/operations/", { method: "POST", body: JSON.stringify(input) });
}
