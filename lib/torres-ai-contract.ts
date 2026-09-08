export const TORRES_AI_MAX_PROMPT_CHARACTERS = 2000;
export const TORRES_AI_MAX_HISTORY_MESSAGES = 8;
export const TORRES_AI_MAX_EVIDENCE_ITEMS = 40;

export const TORRES_AI_SOURCE_TYPES = ["client", "crm_lead", "project", "service_job", "report_snapshot", "notification"] as const;
export type TorresAiSourceType = typeof TORRES_AI_SOURCE_TYPES[number];

export interface TorresAiEvidence {
  id: string;
  sourceType: TorresAiSourceType;
  sourceId: string;
  label: string;
  fact: string;
  href: string;
  observedAt: string | null;
}

export interface TorresAiHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TorresAiAgentRequest {
  version: 1;
  requestId: string;
  organizationId: string;
  userId: string;
  threadId: string;
  prompt: string;
  kind: "answer" | "daily_briefing" | "weekly_summary";
  history: TorresAiHistoryMessage[];
  evidence: TorresAiEvidence[];
}

export interface TorresAiAgentResponse {
  answer: string;
  citationIds: string[];
  confidence: "low" | "medium" | "high";
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export function validEvidenceHref(value: string) {
  return /^\/[a-z0-9/_?=&%.-]*$/i.test(value) && !value.startsWith("//");
}

export function verifiedCitationIds(ids: unknown, evidence: TorresAiEvidence[]) {
  const allowed = new Set(evidence.map((item) => item.id));
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && allowed.has(id)))).slice(0, 8);
}

export function cleanAiAnswer(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 12000) : "";
}

export function isDisallowedAiPrompt(prompt: string) {
  return /(reveal|show|print|repeat|ignore|override|bypass|disable).{0,40}(system prompt|developer message|secret|api key|token|credential|security rule|tenant boundary)/i.test(prompt)
    || /(run|execute).{0,30}(sql|database command|shell command)/i.test(prompt);
}
