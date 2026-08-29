const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function crmConversationId(sourceMetadata: unknown) {
  let metadata = sourceMetadata;
  if (typeof metadata === "string") {
    try {
      metadata = JSON.parse(metadata) as unknown;
    } catch {
      return "";
    }
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const conversationId = (metadata as Record<string, unknown>).conversation_id;
  return typeof conversationId === "string" && uuidPattern.test(conversationId) ? conversationId : "";
}

export function websiteChatCrmHref(leadId: string) {
  return uuidPattern.test(leadId) ? `/crm/?lead=${encodeURIComponent(leadId)}` : "/crm/";
}
