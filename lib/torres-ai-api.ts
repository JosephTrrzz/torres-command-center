import type { AuthSession } from "./types";

export type TorresAiKind = "answer" | "daily_briefing" | "weekly_summary";

export interface TorresAiCitationView {
  id: string;
  sourceType: string;
  label: string;
  href: string;
  observedAt: string | null;
}

export interface TorresAiMessageView {
  id: string;
  role: "user" | "assistant";
  kind: TorresAiKind;
  content: string;
  confidence: "low" | "medium" | "high" | null;
  createdAt: string;
  citations: TorresAiCitationView[];
}

export interface TorresAiThreadView {
  id: string;
  title: string;
  status: "active" | "archived";
  lastMessageAt: string | null;
  createdAt: string;
}

export interface TorresAiSnapshot {
  threads: TorresAiThreadView[];
  selectedThreadId: string | null;
  messages: TorresAiMessageView[];
  readOnly: true;
  privacy: string;
}

async function requestAi(session: AuthSession, init?: RequestInit) {
  const response = await fetch("/api/ai/", {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({})) as { snapshot?: TorresAiSnapshot; error?: string };
  if (!response.ok || !body.snapshot) throw new Error(body.error || "Torres AI could not be reached.");
  return body.snapshot;
}

export function fetchTorresAi(session: AuthSession, threadId?: string) {
  return requestAi(session, threadId ? { headers: { "X-Torres-AI-Thread": threadId } } : undefined);
}

export function askTorresAi(session: AuthSession, input: { threadId?: string; createNew?: boolean; prompt: string; kind?: TorresAiKind }) {
  return requestAi(session, { method: "POST", body: JSON.stringify({ action: "ask", ...input }) });
}

export function archiveTorresAiThread(session: AuthSession, threadId: string) {
  return requestAi(session, { method: "POST", body: JSON.stringify({ action: "archive", threadId }) });
}
