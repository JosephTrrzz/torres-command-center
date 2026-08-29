import { describe, expect, it } from "vitest";
import { crmConversationId, websiteChatCrmHref } from "../functions/_shared/crm-chat";

const conversationId = "550e8400-e29b-41d4-a716-446655440000";
const leadId = "c56a4180-65aa-42ec-a945-5fd21dec0538";

describe("website chat CRM routing", () => {
  it("reads a valid conversation ID from JSON metadata", () => {
    expect(crmConversationId({ conversation_id: conversationId })).toBe(conversationId);
    expect(crmConversationId(JSON.stringify({ conversation_id: conversationId }))).toBe(conversationId);
  });

  it("rejects malformed or untrusted conversation metadata", () => {
    expect(crmConversationId({ conversation_id: "not-a-uuid" })).toBe("");
    expect(crmConversationId("not-json")).toBe("");
    expect(crmConversationId(null)).toBe("");
  });

  it("deep-links qualified chats to their agency-wide CRM lead", () => {
    expect(websiteChatCrmHref(leadId)).toBe(`/crm/?lead=${leadId}`);
    expect(websiteChatCrmHref("invalid")).toBe("/crm/");
  });
});
