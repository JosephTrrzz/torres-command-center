import type { CommunicationAttachment, CommunicationsSnapshot } from "./communications";
import type { AuthSession } from "./types";

function headers(session: AuthSession) {
  return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
}

function authorizationHeaders(session: AuthSession) {
  return { Authorization: `Bearer ${session.access_token}` };
}

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; snapshot?: CommunicationsSnapshot };
  if (!response.ok) throw new Error(payload.error || "The communications workspace could not be loaded.");
  return payload;
}

export async function fetchCommunications(session: AuthSession, clientId?: string) {
  const query = clientId ? `?client=${encodeURIComponent(clientId)}` : "";
  const response = await fetch(`/api/communications${query}`, { headers: headers(session), cache: "no-store" });
  const payload = await parseResponse(response);
  if (!payload.snapshot) throw new Error("The communications workspace returned an incomplete response.");
  return payload.snapshot;
}

export async function changeCommunications(session: AuthSession, input: Record<string, unknown>) {
  const response = await fetch("/api/communications", { method: "POST", headers: headers(session), body: JSON.stringify(input) });
  return parseResponse(response);
}

export async function uploadCommunicationAttachment(session: AuthSession, input: { clientId: string; messageId: string; file: File }) {
  const query = new URLSearchParams({ client: input.clientId, message: input.messageId, filename: input.file.name });
  const response = await fetch(`/api/communications/attachments?${query}`, {
    method: "POST",
    headers: {
      ...authorizationHeaders(session),
      "Content-Type": input.file.type || "application/octet-stream",
      "X-File-Size": String(input.file.size),
    },
    body: input.file,
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; attachment?: CommunicationAttachment };
  if (!response.ok || !payload.attachment) throw new Error(payload.error || "The attachment could not be uploaded.");
  return payload;
}

export async function deleteCommunicationAttachment(session: AuthSession, input: { clientId: string; attachmentId: string }) {
  const query = new URLSearchParams({ client: input.clientId, attachment: input.attachmentId });
  const response = await fetch(`/api/communications/attachments?${query}`, { method: "DELETE", headers: authorizationHeaders(session) });
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (!response.ok) throw new Error(payload.error || "The attachment could not be removed.");
  return payload;
}

export async function downloadCommunicationAttachment(session: AuthSession, input: { clientId: string; attachment: CommunicationAttachment }) {
  const query = new URLSearchParams({ client: input.clientId, attachment: input.attachment.id });
  const response = await fetch(`/api/communications/attachments?${query}`, { headers: authorizationHeaders(session), cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || "The attachment could not be downloaded.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = input.attachment.file_name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
