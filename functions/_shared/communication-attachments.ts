export const COMMUNICATION_ATTACHMENT_BUCKET = "communication-attachments";
export const MAX_COMMUNICATION_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_COMMUNICATION_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_COMMUNICATION_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;

export const COMMUNICATION_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const allowedExtensions = new Set(["pdf", "jpg", "jpeg", "png", "webp", "txt", "csv", "docx", "xlsx"]);

export function sanitizeCommunicationAttachmentName(value: string) {
  const base = value.split(/[\\/]/).pop()?.trim() || "attachment";
  const normalized = base.normalize("NFKC").replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/\s+/g, " ").replace(/^\.+/, "").slice(0, 140);
  return normalized || "attachment";
}

export function validateCommunicationAttachment(input: { fileName: string; contentType: string; byteSize: number }) {
  const fileName = sanitizeCommunicationAttachmentName(input.fileName);
  const contentType = input.contentType.split(";", 1)[0].trim().toLowerCase();
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() || "" : "";
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) return { error: "Choose a non-empty file." } as const;
  if (input.byteSize > MAX_COMMUNICATION_ATTACHMENT_BYTES) return { error: "Each attachment must be 10 MB or smaller." } as const;
  if (!COMMUNICATION_ATTACHMENT_TYPES.has(contentType) || !allowedExtensions.has(extension)) return { error: "Use PDF, JPG, PNG, WebP, TXT, CSV, DOCX, or XLSX files." } as const;
  return { fileName, contentType, byteSize: input.byteSize } as const;
}

