export interface ReceptionistAiBinding {
  run(model: string, input: { messages: Array<{ role: "system" | "user"; content: string }>; max_tokens?: number; temperature?: number }): Promise<unknown>;
}

export interface KnowledgeEntry {
  title: string;
  content: string;
  keywords: string[];
}

export interface ReceptionistAnswer {
  body: string;
  matched: boolean;
  source: string;
}

export const DEFAULT_RECEPTIONIST_KNOWLEDGE: KnowledgeEntry[] = [
  {
    title: "Services",
    keywords: ["service", "services", "help", "offer", "it support", "computer", "network", "wifi", "cybersecurity", "website", "web design", "seo", "smart home"],
    content: "Torres & Co. Technology provides small-business IT support, networking and Wi-Fi, cybersecurity guidance, website design, local SEO, technology consulting, and residential technology support.",
  },
  {
    title: "Service area",
    keywords: ["area", "location", "where", "portland", "gresham", "clackamas", "beaverton", "oregon"],
    content: "The team is based in the Portland, Oregon area and serves Portland and surrounding communities. Remote support may also be available depending on the service.",
  },
  {
    title: "Consultations",
    keywords: ["consultation", "appointment", "book", "schedule", "call", "quote", "estimate", "price", "pricing", "cost"],
    content: "A team member can review your needs and follow up about scope, availability, and pricing. I can collect your contact details, but I cannot confirm an appointment or price in chat.",
  },
  {
    title: "Process",
    keywords: ["process", "next", "start", "work", "onboarding", "timeline", "how long"],
    content: "The usual next step is a short consultation to understand your goals, current setup, timing, and budget. The team then recommends a practical scope before any work begins.",
  },
  {
    title: "Contact",
    keywords: ["contact", "email", "phone", "human", "person", "representative", "team"],
    content: "I can send your request to the Torres & Co. team. Use the contact form in this chat and include the best email or phone number for the follow-up.",
  },
];

export function cleanReceptionistText(value: unknown, maxLength = 1200) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength)
    : "";
}

export function validReceptionistEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function validReceptionistPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return "";
  }
}

export function allowedReceptionistOrigins(configured = "") {
  const defaults = ["https://torrescotechnology.com", "https://www.torrescotechnology.com"];
  return new Set([...defaults, ...configured.split(",")].map((value) => normalizeOrigin(value.trim())).filter(Boolean));
}

export function receptionistCorsHeaders(origin: string, configured = "") {
  const normalized = normalizeOrigin(origin);
  if (!allowedReceptionistOrigins(configured).has(normalized)) return null;
  return {
    "Access-Control-Allow-Origin": normalized,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createReceptionistToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function scoreKnowledge(message: string, entry: KnowledgeEntry) {
  const lower = message.toLowerCase();
  return entry.keywords.reduce((score, keyword) => score + (lower.includes(keyword.toLowerCase()) ? Math.max(1, keyword.split(" ").length) : 0), 0);
}

export function answerFromApprovedKnowledge(message: string, entries: KnowledgeEntry[], fallback: string): ReceptionistAnswer {
  const ranked = entries
    .map((entry) => ({ entry, score: scoreKnowledge(message, entry) }))
    .sort((left, right) => right.score - left.score);
  if (!ranked[0] || ranked[0].score === 0) return { body: fallback, matched: false, source: "fallback" };
  return { body: ranked[0].entry.content, matched: true, source: ranked[0].entry.title };
}

function extractAiText(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.response === "string") return cleanReceptionistText(record.response, 1200);
  if (typeof record.result === "string") return cleanReceptionistText(record.result, 1200);
  return "";
}

export async function answerReceptionist(input: {
  message: string;
  knowledge: KnowledgeEntry[];
  fallback: string;
  ai?: ReceptionistAiBinding;
}) {
  const deterministic = answerFromApprovedKnowledge(input.message, input.knowledge, input.fallback);
  if (!input.ai || !deterministic.matched) return deterministic;
  const context = input.knowledge.map((entry) => `${entry.title}: ${entry.content}`).join("\n");
  try {
    const result = await input.ai.run("@cf/meta/llama-3.1-8b-instruct", {
      temperature: 0.1,
      max_tokens: 220,
      messages: [
        {
          role: "system",
          content: `You are the clearly disclosed automated receptionist for Torres & Co. Technology. Answer only from APPROVED KNOWLEDGE below. Do not invent prices, availability, appointments, guarantees, policies, or technical claims. Do not request passwords, payment details, government IDs, or secrets. If the answer is not in the knowledge, respond exactly: ${input.fallback}\n\nAPPROVED KNOWLEDGE:\n${context}`,
        },
        { role: "user", content: input.message },
      ],
    });
    const body = extractAiText(result);
    return body ? { body, matched: true, source: `ai:${deterministic.source}` } : deterministic;
  } catch {
    return deterministic;
  }
}
