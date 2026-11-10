import { readStoredSession } from "./supabase-auth";
export function studioUrl(path: string) {
  const client =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("client");
  return (
    "/api/website/" +
    path +
    (client
      ? (path.includes("?") ? "&" : "?") +
        "client=" +
        encodeURIComponent(client)
      : "")
  );
}
export async function studioRequest<T>(
  path: string,
  payload?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const token = readStoredSession()?.access_token;
  if (!token)
    throw Error("Your session has expired. Sign in again to continue.");
  const res = await fetch(studioUrl(path), {
    method: payload ? "POST" : "GET",
    cache: "no-store",
    signal,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json();
  if (!res.ok)
    throw Object.assign(
      Error(data.error || "The request failed. Please try again."),
      { status: res.status },
    );
  return data;
}
