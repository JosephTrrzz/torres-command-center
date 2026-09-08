import { authJson, getSupabaseUrl, requireAuth, type AuthContext, type FunctionEnv } from "../../_shared/auth";
import {
  TORRES_AI_MAX_EVIDENCE_ITEMS,
  TORRES_AI_MAX_HISTORY_MESSAGES,
  TORRES_AI_MAX_PROMPT_CHARACTERS,
  cleanAiAnswer,
  isDisallowedAiPrompt,
  validEvidenceHref,
  verifiedCitationIds,
  type TorresAiAgentRequest,
  type TorresAiAgentResponse,
  type TorresAiEvidence,
} from "../../../lib/torres-ai-contract";

interface AiServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface Env extends FunctionEnv {
  TORRES_AI?: AiServiceBinding;
  TORRES_AI_INTERNAL_SECRET?: string;
}

type ThreadRow = { id: string; title: string; status: "active" | "archived"; last_message_at: string | null; created_at: string };
type MessageRow = { id: string; role: "user" | "assistant"; kind: "answer" | "daily_briefing" | "weekly_summary"; content: string; confidence: "low" | "medium" | "high" | null; created_at: string };
type CitationRow = { id: string; message_id: string; source_type: string; label: string; href: string; observed_at: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVACY_COPY = "Answers use only records available to your signed-in workspace. Torres AI is read-only and does not receive provider credentials.";

function headers(serviceKey: string, prefer?: string) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) };
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function titleFromPrompt(prompt: string) {
  return prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "New conversation";
}

function persistenceFailureCode(value: unknown) {
  const code = value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : "";
  if (code === "PGRST202" || code === "42883") return "rpc_missing";
  if (code === "42501") return "rpc_permission_denied";
  if (code === "23503") return "rpc_foreign_key_rejected";
  if (code === "23505") return "rpc_duplicate_rejected";
  if (code === "23514") return "rpc_constraint_rejected";
  if (code === "P0001") return "rpc_validation_rejected";
  return code ? "rpc_database_rejected" : "rpc_transport_failed";
}

function iso(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function notificationHref(value: string | null, clientUser: boolean) {
  if (!value || !validEvidenceHref(value)) return "/today/";
  if (!clientUser) return value;
  const allowed = ["/today", "/assistant", "/onboarding", "/projects", "/operations", "/inbox", "/reports", "/portal"];
  return allowed.some((root) => value === root || value === `${root}/` || value.startsWith(`${root}/`) || value.startsWith(`${root}?`)) ? value : "/today/";
}

async function hmac(secret: string, timestamp: string, nonce: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${nonce}.${body}`));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rest<T>(url: string, serviceKey: string, path: string): Promise<T[]> {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: headers(serviceKey) });
  if (!response.ok) throw new Error("storage_read_failed");
  return response.json().catch(() => []) as Promise<T[]>;
}

async function scopeFor(context: AuthContext, url: string, serviceKey: string) {
  const organizationId = context.organizationId || "";
  const active = context.memberships.find((membership) => membership.organizationId === organizationId);
  if (!active) throw new Error("organization_scope_missing");
  if (active.kind === "client" || active.role === "client") {
    const clients = await rest<{ id: string; name: string; organization_id: string }>(url, serviceKey, `clients?organization_id=eq.${encodeURIComponent(active.organizationId)}&select=id,name,organization_id&limit=1`);
    return { organizationId, organizationIds: [active.organizationId], clientIds: clients.map((row) => row.id), clientUser: true };
  }
  const organizations = await rest<{ id: string }>(url, serviceKey, `organizations?parent_organization_id=eq.${encodeURIComponent(active.organizationId)}&kind=eq.client&status=eq.active&select=id`);
  const organizationIds = organizations.map((row) => row.id).filter((id) => UUID.test(id));
  const clientRows = organizationIds.length
    ? await rest<{ id: string }>(url, serviceKey, `clients?organization_id=in.(${organizationIds.join(",")})&select=id`)
    : [];
  return { organizationId, organizationIds, clientIds: clientRows.map((row) => row.id).filter((id) => UUID.test(id)), clientUser: false };
}

function evidenceItem(sourceType: TorresAiEvidence["sourceType"], sourceId: string, label: string, fact: string, href: string, observedAt: unknown): TorresAiEvidence | null {
  const item = { id: `${sourceType}:${sourceId}`, sourceType, sourceId, label: clean(label, 180), fact: clean(fact, 1200), href, observedAt: iso(observedAt) };
  return item.label && item.fact && validEvidenceHref(item.href) ? item : null;
}

async function authorizedEvidence(context: AuthContext, url: string, serviceKey: string) {
  const scope = await scopeFor(context, url, serviceKey);
  if (!scope.organizationIds.length || !scope.clientIds.length) return [];
  const organizationFilter = scope.organizationIds.join(",");
  const clientFilter = scope.clientIds.join(",");
  const requests: Array<Promise<TorresAiEvidence[]>> = [
    rest<{ id: string; name: string; industry: string; location: string }>(url, serviceKey, `clients?id=in.(${clientFilter})&select=id,name,industry,location&order=name.asc&limit=8`).then((rows) => rows.flatMap((row) => evidenceItem("client", row.id, row.name, `${row.name} is a ${clean(row.industry, 100) || "client"} account${row.location ? ` in ${clean(row.location, 180)}` : ""}.`, scope.clientUser ? "/portal/" : `/clients/?client=${row.id}`, null) || [])),
    rest<{ id: string; name: string; status: string; progress_percent: number; target_date: string | null; updated_at: string }>(url, serviceKey, `client_projects?organization_id=in.(${organizationFilter})&select=id,name,status,progress_percent,target_date,updated_at&order=updated_at.desc&limit=8`).then((rows) => rows.flatMap((row) => evidenceItem("project", row.id, row.name, `Project status: ${row.status}; progress: ${row.progress_percent}%; target: ${row.target_date || "not set"}.`, `/projects/`, row.updated_at) || [])),
    rest<{ id: string; title: string; status: string; priority: string; scheduled_start: string | null; updated_at: string }>(url, serviceKey, `service_jobs?organization_id=in.(${organizationFilter})${scope.clientUser ? "&client_visible=eq.true" : ""}&select=id,title,status,priority,scheduled_start,updated_at&order=updated_at.desc&limit=8`).then((rows) => rows.flatMap((row) => evidenceItem("service_job", row.id, row.title, `Service status: ${row.status}; priority: ${row.priority}; scheduled: ${row.scheduled_start || "not scheduled"}.`, `/operations/`, row.updated_at) || [])),
    rest<{ id: string; report_type: string; period_start: string; period_end: string; created_at: string }>(url, serviceKey, `report_snapshots?organization_id=in.(${organizationFilter})&select=id,report_type,period_start,period_end,created_at&order=created_at.desc&limit=6`).then((rows) => rows.flatMap((row) => evidenceItem("report_snapshot", row.id, `${row.report_type} report`, `Verified report snapshot covers ${row.period_start} through ${row.period_end}.`, `/reports/`, row.created_at) || [])),
    rest<{ id: string; title: string; body: string; href: string | null; created_at: string }>(url, serviceKey, `notifications?user_id=eq.${encodeURIComponent(context.userId)}&select=id,title,body,href,created_at&order=created_at.desc&limit=6`).then((rows) => rows.flatMap((row) => evidenceItem("notification", row.id, row.title, row.body, notificationHref(row.href, scope.clientUser), row.created_at) || [])),
  ];
  if (!scope.clientUser) {
    requests.push(rest<{ id: string; full_name: string; company: string; service_interest: string; status: string; source: string; updated_at: string }>(url, serviceKey, `crm_leads?client_id=in.(${clientFilter})&select=id,full_name,company,service_interest,status,source,updated_at&order=updated_at.desc&limit=8`).then((rows) => rows.flatMap((row) => evidenceItem("crm_lead", row.id, row.full_name, `Lead${row.company ? ` from ${clean(row.company, 120)}` : ""}; interest: ${clean(row.service_interest, 120) || "not specified"}; status: ${row.status}; source: ${row.source}.`, `/crm/`, row.updated_at) || [])));
  }
  return (await Promise.all(requests.map((source) => source.catch(() => [])))).flat().slice(0, TORRES_AI_MAX_EVIDENCE_ITEMS);
}

async function loadThreads(url: string, serviceKey: string, organizationId: string, userId: string) {
  return rest<ThreadRow>(url, serviceKey, `ai_threads?organization_id=eq.${encodeURIComponent(organizationId)}&owner_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id,title,status,last_message_at,created_at&order=last_message_at.desc.nullslast,created_at.desc&limit=30`);
}

async function ownedThread(url: string, serviceKey: string, organizationId: string, userId: string, threadId: string) {
  if (!UUID.test(threadId)) return null;
  const rows = await rest<ThreadRow>(url, serviceKey, `ai_threads?id=eq.${encodeURIComponent(threadId)}&organization_id=eq.${encodeURIComponent(organizationId)}&owner_user_id=eq.${encodeURIComponent(userId)}&select=id,title,status,last_message_at,created_at&limit=1`);
  return rows[0] || null;
}

async function snapshot(url: string, serviceKey: string, organizationId: string, userId: string, requestedThreadId?: string) {
  const threads = await loadThreads(url, serviceKey, organizationId, userId);
  const selected = requestedThreadId ? await ownedThread(url, serviceKey, organizationId, userId, requestedThreadId) : threads[0] || null;
  if (requestedThreadId && (!selected || selected.status !== "active")) throw new Error("thread_not_found");
  const messages = selected ? await rest<MessageRow>(url, serviceKey, `ai_messages?thread_id=eq.${selected.id}&organization_id=eq.${organizationId}&select=id,role,kind,content,confidence,created_at&order=created_at.desc&limit=100`) : [];
  const citations = selected ? await rest<CitationRow>(url, serviceKey, `ai_citations?thread_id=eq.${selected.id}&organization_id=eq.${organizationId}&select=id,message_id,source_type,label,href,observed_at&order=created_at.asc&limit=300`) : [];
  return {
    threads: threads.map((row) => ({ id: row.id, title: row.title, status: row.status, lastMessageAt: row.last_message_at, createdAt: row.created_at })),
    selectedThreadId: selected?.id || null,
    messages: messages.reverse().map((message) => ({ id: message.id, role: message.role, kind: message.kind, content: message.content, confidence: message.confidence, createdAt: message.created_at, citations: citations.filter((citation) => citation.message_id === message.id).map((citation) => ({ id: citation.id, sourceType: citation.source_type, label: citation.label, href: citation.href, observedAt: citation.observed_at })) })),
    readOnly: true as const,
    privacy: PRIVACY_COPY,
  };
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const auth = await requireAuth(request, env, { permission: "ai.use" });
  if ("response" in auth) return auth.response;
  const organizationId = auth.context.organizationId || "";
  if (!organizationId) return authJson({ error: "Choose a workspace before opening Torres AI." }, 409);
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  try {
    return authJson({ snapshot: await snapshot(url, serviceKey, organizationId, auth.context.userId, request.headers.get("X-Torres-AI-Thread") || undefined) });
  } catch (error) {
    return authJson({ error: error instanceof Error && error.message === "thread_not_found" ? "That private conversation is not available in this workspace." : "Torres AI storage is not ready." }, error instanceof Error && error.message === "thread_not_found" ? 404 : 503);
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const auth = await requireAuth(request, env, { permission: "ai.use" });
  if ("response" in auth) return auth.response;
  const organizationId = auth.context.organizationId || "";
  if (!organizationId) return authJson({ error: "Choose a workspace before using Torres AI." }, 409);
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const body = await request.json().catch(() => null) as { action?: unknown; threadId?: unknown; createNew?: unknown; prompt?: unknown; kind?: unknown } | null;
  const action = body?.action;

  if (action === "archive") {
    const threadId = typeof body?.threadId === "string" ? body.threadId : "";
    const thread = await ownedThread(url, serviceKey, organizationId, auth.context.userId, threadId).catch(() => null);
    if (!thread || thread.status !== "active") return authJson({ error: "That private conversation is not available." }, 404);
    const write = await fetch(`${url}/rest/v1/ai_threads?id=eq.${thread.id}&organization_id=eq.${organizationId}&owner_user_id=eq.${auth.context.userId}`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ status: "archived", updated_at: new Date().toISOString() }) });
    if (!write.ok) return authJson({ error: "The conversation could not be archived." }, 502);
    await fetch(`${url}/rest/v1/audit_events`, { method: "POST", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: organizationId, actor_user_id: auth.context.userId, action: "ai.thread.archived", entity_type: "ai_thread", entity_id: thread.id, metadata: { reversible: true } }) });
    return authJson({ snapshot: await snapshot(url, serviceKey, organizationId, auth.context.userId) });
  }

  if (action !== "ask") return authJson({ error: "Unknown Torres AI action." }, 400);
  const prompt = clean(body?.prompt, TORRES_AI_MAX_PROMPT_CHARACTERS + 1);
  const kind = body?.kind === "daily_briefing" || body?.kind === "weekly_summary" ? body.kind : "answer";
  if (!prompt || prompt.length > TORRES_AI_MAX_PROMPT_CHARACTERS) return authJson({ error: `Ask a question up to ${TORRES_AI_MAX_PROMPT_CHARACTERS.toLocaleString()} characters.` }, 400);
  if (isDisallowedAiPrompt(prompt)) return authJson({ error: "Torres AI cannot reveal protected instructions or execute system and database commands." }, 400);
  if (!env.TORRES_AI || !env.TORRES_AI_INTERNAL_SECRET || env.TORRES_AI_INTERNAL_SECRET.length < 32) return authJson({ error: "Torres AI is not securely connected yet." }, 503);

  let activeRequestId = "";
  try {
    let thread = typeof body?.threadId === "string" ? await ownedThread(url, serviceKey, organizationId, auth.context.userId, body.threadId) : null;
    if (body?.threadId && (!thread || thread.status !== "active")) return authJson({ error: "That private conversation is not available." }, 404);
    if (!thread && body?.createNew !== true) {
      thread = (await loadThreads(url, serviceKey, organizationId, auth.context.userId))[0] || null;
    }
    if (!thread) {
      const response = await fetch(`${url}/rest/v1/ai_threads`, { method: "POST", headers: headers(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: organizationId, owner_user_id: auth.context.userId, title: titleFromPrompt(prompt) }) });
      const rows = await response.json().catch(() => []) as ThreadRow[];
      if (!response.ok || !rows[0]) throw new Error("thread_write_failed");
      thread = rows[0];
    }

    const [evidence, historyRows] = await Promise.all([
      authorizedEvidence(auth.context, url, serviceKey),
      rest<MessageRow>(url, serviceKey, `ai_messages?thread_id=eq.${thread.id}&organization_id=eq.${organizationId}&select=id,role,kind,content,confidence,created_at&order=created_at.desc&limit=${TORRES_AI_MAX_HISTORY_MESSAGES}`),
    ]);
    const requestId = crypto.randomUUID();
    activeRequestId = requestId;
    const claimResponse = await fetch(`${url}/rest/v1/rpc/claim_ai_request`, { method: "POST", headers: headers(serviceKey), body: JSON.stringify({ target_organization_id: organizationId, target_user_id: auth.context.userId, target_thread_id: thread.id, target_request_id: requestId, target_evidence_count: evidence.length, target_input_characters: prompt.length }) });
    const claim = await claimResponse.json().catch(() => "") as string;
    if (!claimResponse.ok) throw new Error("usage_claim_failed");
    if (claim !== "accepted") return authJson({ error: claim === "daily_limit" ? "Today’s private AI limit has been reached. Try again tomorrow." : "Torres AI is receiving too many requests. Wait a few minutes and try again." }, 429);

    const agentInput: TorresAiAgentRequest = { version: 1, requestId, organizationId, userId: auth.context.userId, threadId: thread.id, prompt, kind, history: historyRows.reverse().map((message) => ({ role: message.role, content: message.content })), evidence };
    const encoded = JSON.stringify(agentInput);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomUUID();
    const started = Date.now();
    const response = await env.TORRES_AI.fetch("https://torres-ai.internal/v1/respond", { method: "POST", headers: { "Content-Type": "application/json", "X-Torres-AI-Timestamp": timestamp, "X-Torres-AI-Nonce": nonce, "X-Torres-AI-Signature": await hmac(env.TORRES_AI_INTERNAL_SECRET, timestamp, nonce, encoded) }, body: encoded });
    const agentResult = await response.json().catch(() => null) as TorresAiAgentResponse | null;
    const answer = cleanAiAnswer(agentResult?.answer);
    const citationIds = verifiedCitationIds(agentResult?.citationIds, evidence);
    if (!response.ok || !agentResult || !answer || (evidence.length > 0 && !citationIds.length)) {
      await fetch(`${url}/rest/v1/ai_usage_events?request_id=eq.${requestId}`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ status: "failed", duration_ms: Date.now() - started, failure_code: "agent_response_invalid" }) });
      return authJson({ error: "Torres AI could not produce a verified answer. No answer was saved." }, 503);
    }

    const selectedEvidence = evidence.filter((item) => citationIds.includes(item.id));
    const persistence = await fetch(`${url}/rest/v1/rpc/persist_ai_answer`, { method: "POST", headers: headers(serviceKey), body: JSON.stringify({ target_organization_id: organizationId, target_user_id: auth.context.userId, target_thread_id: thread.id, target_kind: kind, target_prompt: prompt, target_answer: answer, target_confidence: agentResult.confidence, target_citations: selectedEvidence.map((item) => ({ source_type: item.sourceType, source_id: item.sourceId, label: item.label, href: item.href, observed_at: item.observedAt })) }) });
    if (!persistence.ok) {
      const persistenceError = await persistence.json().catch(() => null) as unknown;
      console.error(JSON.stringify({ level: "error", event: "torres_ai_persistence", status: persistence.status, code: persistenceFailureCode(persistenceError) }));
      throw new Error("answer_persistence_failed");
    }
    await Promise.all([
      fetch(`${url}/rest/v1/ai_usage_events?request_id=eq.${requestId}`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ status: agentResult.model === "policy" ? "refused" : "succeeded", model: clean(agentResult.model, 160), output_characters: answer.length, prompt_tokens: agentResult.usage?.promptTokens ?? null, completion_tokens: agentResult.usage?.completionTokens ?? null, duration_ms: Date.now() - started }) }),
      fetch(`${url}/rest/v1/audit_events`, { method: "POST", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: organizationId, actor_user_id: auth.context.userId, action: "ai.answer.generated", entity_type: "ai_thread", entity_id: thread.id, request_id: requestId, metadata: { kind, evidence_count: evidence.length, citation_count: citationIds.length, confidence: agentResult.confidence, read_only: true } }) }),
    ]);
    return authJson({ snapshot: await snapshot(url, serviceKey, organizationId, auth.context.userId, thread.id) });
  } catch (error) {
    if (activeRequestId) {
      await fetch(`${url}/rest/v1/ai_usage_events?request_id=eq.${activeRequestId}&status=eq.processing`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ status: "failed", failure_code: error instanceof Error ? clean(error.message, 80) : "unknown" }) }).catch(() => null);
    }
    console.error(JSON.stringify({ level: "error", event: "torres_ai_api", code: error instanceof Error ? error.message : "unknown", organizationId, userId: auth.context.userId }));
    return authJson({ error: "Torres AI could not complete that request safely. Try again." }, 503);
  }
};
