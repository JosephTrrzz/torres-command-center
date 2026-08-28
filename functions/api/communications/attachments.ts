import {
  authJson,
  getSupabaseUrl,
  hasOrganizationPermission,
  requireAuth,
  type FunctionEnv,
} from "../../_shared/auth";
import {
  COMMUNICATION_ATTACHMENT_BUCKET,
  MAX_COMMUNICATION_ATTACHMENTS_PER_MESSAGE,
  MAX_COMMUNICATION_ATTACHMENTS_TOTAL_BYTES,
  sanitizeCommunicationAttachmentName,
  validateCommunicationAttachment,
} from "../../_shared/communication-attachments";

type AttachmentRow = { id: string; organization_id: string; client_id: string; conversation_id: string; message_id: string; file_name: string; content_type: string; byte_size: number; storage_bucket: string; storage_path: string; created_at: string };
type MessageRow = { id: string; organization_id: string; client_id: string; conversation_id: string; direction: string; channel: string; status: string; provider_message_id: string | null };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceHeaders(serviceKey: string, contentType = "application/json", prefer?: string) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...(contentType ? { "Content-Type": contentType } : {}), ...(prefer ? { Prefer: prefer } : {}) };
}

function storageUrl(url: string, bucket: string, path: string) {
  return `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function attachmentContext(request: Request, env: FunctionEnv, permission: "communications.read" | "communications.manage") {
  const requestUrl = new URL(request.url);
  const clientId = requestUrl.searchParams.get("client") || "";
  if (!uuidPattern.test(clientId)) return { response: authJson({ error: "Choose a valid client." }, 400) } as const;
  const initial = await requireAuth(request, env, { permission });
  if ("response" in initial) return initial;
  const scoped = await requireAuth(request, env, { clientId, permission });
  if ("response" in scoped) return scoped;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return { response: authJson({ error: "Attachment storage is not configured." }, 500) } as const;
  return { context: scoped.context, clientId, requestUrl, url, serviceKey } as const;
}

async function readMessage(url: string, serviceKey: string, clientId: string, messageId: string) {
  const response = await fetch(`${url}/rest/v1/messages?id=eq.${encodeURIComponent(messageId)}&client_id=eq.${encodeURIComponent(clientId)}&select=id,organization_id,client_id,conversation_id,direction,channel,status,provider_message_id&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as MessageRow[] : [];
  return rows[0] || null;
}

function editableDraft(message: MessageRow | null) {
  return Boolean(message && message.direction === "outbound" && message.channel === "email" && ["draft", "failed"].includes(message.status) && !message.provider_message_id);
}

export const onRequestPost = async ({ request, env }: { request: Request; env: FunctionEnv }) => {
  const resolved = await attachmentContext(request, env, "communications.manage");
  if ("response" in resolved) return resolved.response;
  if (!hasOrganizationPermission(resolved.context, "communications.manage") || resolved.context.organizationRole === "client") return authJson({ error: "Only workspace staff can attach files to email drafts." }, 403);
  const messageId = resolved.requestUrl.searchParams.get("message") || "";
  if (!uuidPattern.test(messageId)) return authJson({ error: "Choose a valid email draft." }, 400);
  const message = await readMessage(resolved.url, resolved.serviceKey, resolved.clientId, messageId);
  if (!editableDraft(message)) return authJson({ error: "Files can only be added to an unsent outbound email draft." }, 409);
  const byteSize = Number(request.headers.get("X-File-Size") || request.headers.get("Content-Length") || "0");
  const validation = validateCommunicationAttachment({
    fileName: resolved.requestUrl.searchParams.get("filename") || "",
    contentType: request.headers.get("Content-Type") || "",
    byteSize,
  });
  if ("error" in validation) return authJson({ error: validation.error }, 400);
  const existingResponse = await fetch(`${resolved.url}/rest/v1/message_attachments?message_id=eq.${encodeURIComponent(messageId)}&select=id,byte_size`, { headers: serviceHeaders(resolved.serviceKey) });
  if (!existingResponse.ok) return authJson({ error: "Attachment storage is not ready. Apply supabase/communication_attachments.sql first." }, 503);
  const existing = await existingResponse.json().catch(() => []) as Array<{ id?: string; byte_size?: number }>;
  if (existing.length >= MAX_COMMUNICATION_ATTACHMENTS_PER_MESSAGE) return authJson({ error: "An email can include up to 5 attachments." }, 409);
  const currentBytes = existing.reduce((total, row) => total + Number(row.byte_size || 0), 0);
  if (currentBytes + validation.byteSize > MAX_COMMUNICATION_ATTACHMENTS_TOTAL_BYTES) return authJson({ error: "Attachments for one email can total up to 20 MB." }, 409);
  const storagePath = `${message?.organization_id}/${resolved.clientId}/${messageId}/${crypto.randomUUID()}-${validation.fileName}`;
  const upload = await fetch(storageUrl(resolved.url, COMMUNICATION_ATTACHMENT_BUCKET, storagePath), {
    method: "POST",
    headers: { ...serviceHeaders(resolved.serviceKey, validation.contentType), "x-upsert": "false" },
    body: request.body,
  });
  if (!upload.ok) return authJson({ error: "The file could not be uploaded to secure storage." }, 502);
  const insert = await fetch(`${resolved.url}/rest/v1/message_attachments`, {
    method: "POST",
    headers: serviceHeaders(resolved.serviceKey, "application/json", "return=representation"),
    body: JSON.stringify({
      organization_id: message?.organization_id,
      client_id: resolved.clientId,
      conversation_id: message?.conversation_id,
      message_id: messageId,
      file_name: validation.fileName,
      content_type: validation.contentType,
      byte_size: validation.byteSize,
      storage_bucket: COMMUNICATION_ATTACHMENT_BUCKET,
      storage_path: storagePath,
      created_by: resolved.context.userId,
    }),
  });
  const rows = insert.ok ? await insert.json().catch(() => []) as AttachmentRow[] : [];
  if (!rows[0]) {
    await fetch(storageUrl(resolved.url, COMMUNICATION_ATTACHMENT_BUCKET, storagePath), { method: "DELETE", headers: serviceHeaders(resolved.serviceKey, "") }).catch(() => undefined);
    return authJson({ error: "The file uploaded, but its email record could not be saved." }, 502);
  }
  return authJson({ message: `${validation.fileName} attached securely.`, attachment: rows[0] }, 201);
};

export const onRequestDelete = async ({ request, env }: { request: Request; env: FunctionEnv }) => {
  const resolved = await attachmentContext(request, env, "communications.manage");
  if ("response" in resolved) return resolved.response;
  if (!hasOrganizationPermission(resolved.context, "communications.manage") || resolved.context.organizationRole === "client") return authJson({ error: "Only workspace staff can remove email attachments." }, 403);
  const attachmentId = resolved.requestUrl.searchParams.get("attachment") || "";
  if (!uuidPattern.test(attachmentId)) return authJson({ error: "Choose a valid attachment." }, 400);
  const response = await fetch(`${resolved.url}/rest/v1/message_attachments?id=eq.${encodeURIComponent(attachmentId)}&client_id=eq.${encodeURIComponent(resolved.clientId)}&select=id,organization_id,client_id,conversation_id,message_id,file_name,content_type,byte_size,storage_bucket,storage_path,created_at&limit=1`, { headers: serviceHeaders(resolved.serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as AttachmentRow[] : [];
  const attachment = rows[0];
  const message = attachment ? await readMessage(resolved.url, resolved.serviceKey, resolved.clientId, attachment.message_id) : null;
  if (!attachment || !editableDraft(message)) return authJson({ error: "That attachment is not available on an editable email draft." }, 404);
  const recordDelete = await fetch(`${resolved.url}/rest/v1/message_attachments?id=eq.${encodeURIComponent(attachment.id)}`, {
    method: "DELETE",
    headers: serviceHeaders(resolved.serviceKey, "application/json", "return=representation"),
  });
  const deletedRows = recordDelete.ok ? await recordDelete.json().catch(() => []) as AttachmentRow[] : [];
  if (!deletedRows[0]) return authJson({ error: "The attachment record could not be removed." }, 502);
  const storageDelete = await fetch(storageUrl(resolved.url, attachment.storage_bucket, attachment.storage_path), { method: "DELETE", headers: serviceHeaders(resolved.serviceKey, "") });
  if (!storageDelete.ok && storageDelete.status !== 404) return authJson({ error: "The attachment was removed from the email, but secure storage cleanup needs attention." }, 502);
  return authJson({ message: `${attachment.file_name} removed.` });
};

export const onRequestGet = async ({ request, env }: { request: Request; env: FunctionEnv }) => {
  const resolved = await attachmentContext(request, env, "communications.read");
  if ("response" in resolved) return resolved.response;
  const attachmentId = resolved.requestUrl.searchParams.get("attachment") || "";
  if (!uuidPattern.test(attachmentId)) return authJson({ error: "Choose a valid attachment." }, 400);
  const visibility = resolved.context.organizationRole === "client" || (!resolved.context.organizationRole && resolved.context.role === "customer") ? "&messages.client_visible=eq.true" : "";
  const response = await fetch(`${resolved.url}/rest/v1/message_attachments?id=eq.${encodeURIComponent(attachmentId)}&client_id=eq.${encodeURIComponent(resolved.clientId)}${visibility}&select=id,file_name,content_type,storage_bucket,storage_path,messages!inner(client_visible)&limit=1`, { headers: serviceHeaders(resolved.serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as Array<Pick<AttachmentRow, "id" | "file_name" | "content_type" | "storage_bucket" | "storage_path">> : [];
  const attachment = rows[0];
  if (!attachment) return authJson({ error: "That attachment is not available." }, 404);
  const download = await fetch(storageUrl(resolved.url, attachment.storage_bucket, attachment.storage_path), { headers: serviceHeaders(resolved.serviceKey, "") });
  if (!download.ok || !download.body) return authJson({ error: "The attachment could not be downloaded." }, 502);
  return new Response(download.body, {
    status: 200,
    headers: {
      "Content-Type": attachment.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${sanitizeCommunicationAttachmentName(attachment.file_name).replaceAll('"', "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
