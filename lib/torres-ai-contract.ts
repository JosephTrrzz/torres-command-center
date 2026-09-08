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
  grounded: boolean;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export function validEvidenceHref(value: string) {
  return /^\/[a-z0-9/_?=&%.-]*$/i.test(value) && !value.startsWith("//");
}

export function postgrestExactCount(contentRange: string | null) {
  const match = contentRange?.match(/\/(\d+)$/);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function verifiedCitationIds(ids: unknown, evidence: TorresAiEvidence[]) {
  const allowed = new Set(evidence.map((item) => item.id));
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && allowed.has(id)))).slice(0, 8);
}

export function cleanAiAnswer(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 12000) : "";
}

function parseStructuredAiCandidate(candidateValue: unknown): Record<string, unknown> | null {
  let value = candidateValue;
  for (let attempt = 0; attempt < 2 && typeof value === "string"; attempt += 1) {
    const candidate = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try {
      value = JSON.parse(candidate) as unknown;
    } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      try {
        value = JSON.parse(candidate.slice(start, end + 1)) as unknown;
      } catch {
        const recovered = recoverJsonShapedAiResponse(candidate.slice(start, end + 1));
        if (!recovered) return null;
        value = recovered;
      }
    }
  }

  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function recoverJsonShapedAiResponse(value: string): Record<string, unknown> | null {
  const answerKey = value.search(/["']?answer["']?\s*:/i);
  const citationsKey = value.search(/["']?citationIds["']?\s*:/i);
  const confidenceKey = value.search(/["']?confidence["']?\s*:/i);
  if (answerKey < 0 || citationsKey < 0) return null;
  const keyPositions = [answerKey, citationsKey, confidenceKey].filter((position) => position >= 0).sort((left, right) => left - right);

  const fieldValue = (start: number) => {
    const nextKey = keyPositions.find((position) => position > start);
    const end = nextKey ?? (value.lastIndexOf("}") >= 0 ? value.lastIndexOf("}") : value.length);
    const colon = value.indexOf(":", start);
    return colon < 0 ? "" : value.slice(colon + 1, end).trim().replace(/,$/, "").trim();
  };
  const unwrap = (input: string) => {
    const trimmed = input.trim();
    const unquoted = trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
      ? trimmed.slice(1, -1)
      : trimmed;
    return unquoted.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
  };

  const answer = unwrap(fieldValue(answerKey));
  const citationText = fieldValue(citationsKey);
  const citationBody = citationText.slice(Math.max(0, citationText.indexOf("[") + 1), citationText.lastIndexOf("]") >= 0 ? citationText.lastIndexOf("]") : citationText.length);
  const citationIds = citationBody.split(",").map((item) => unwrap(item)).filter(Boolean);
  const confidence = confidenceKey >= 0 ? unwrap(fieldValue(confidenceKey)) : "low";
  return answer && citationIds.length && ["low", "medium", "high"].includes(confidence)
    ? { answer, citationIds, confidence }
    : null;
}

export function structuredAiResponse(raw: unknown): Record<string, unknown> | null {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const firstChoice = record && Array.isArray(record.choices) ? record.choices[0] : null;
  const message = firstChoice && typeof firstChoice === "object" && "message" in firstChoice
    ? (firstChoice as { message?: unknown }).message
    : null;
  const choiceContent = message && typeof message === "object" && "content" in message
    ? (message as { content?: unknown }).content
    : undefined;
  const candidates = record && ("response" in record || "choices" in record)
    ? [record.response, choiceContent, "answer" in record ? record : undefined]
    : [choiceContent, raw];

  for (const candidate of candidates) {
    const parsed = parseStructuredAiCandidate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

export function isDisallowedAiPrompt(prompt: string) {
  return /(reveal|show|print|repeat|ignore|override|bypass|disable).{0,40}(system prompt|developer message|secret|api key|token|credential|security rule|tenant boundary)/i.test(prompt)
    || /(run|execute).{0,30}(sql|database command|shell command)/i.test(prompt);
}
