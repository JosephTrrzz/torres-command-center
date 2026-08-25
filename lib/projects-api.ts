import type { AuthSession } from "./types";
import type { ProjectsSnapshot } from "./projects";

type ProjectResponse = { snapshot?: ProjectsSnapshot; message?: string; error?: string };

async function requestProjects(session: AuthSession, path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({})) as ProjectResponse;
  if (!response.ok || !body.snapshot) throw new Error(body.error || "Project information could not be loaded.");
  return body;
}

export async function fetchProjects(session: AuthSession, clientId?: string) {
  const query = clientId ? `?client=${encodeURIComponent(clientId)}` : "";
  return (await requestProjects(session, `/api/projects/${query}`)).snapshot as ProjectsSnapshot;
}

export async function changeProject(session: AuthSession, input: Record<string, unknown>) {
  return requestProjects(session, "/api/projects/", { method: "POST", body: JSON.stringify(input) });
}
