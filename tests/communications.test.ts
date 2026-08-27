import { describe, expect, it } from "vitest";
import {
  buildCommunicationsSummary,
  communicationDeliveryLabel,
  labelCommunicationValue,
  type Conversation,
} from "../lib/communications";

const baseConversation: Conversation = {
  id: "conversation-1",
  subject: "Website launch approval",
  channel: "internal",
  status: "open",
  priority: "normal",
  client_visible: true,
  last_message_at: "2026-08-26T18:00:00.000Z",
  created_at: "2026-08-26T17:00:00.000Z",
  messages: [],
};

describe("communications summaries", () => {
  it("separates securely shared messages from unsent email drafts", () => {
    const summary = buildCommunicationsSummary([
      {
        ...baseConversation,
        messages: [{
          id: "message-1",
          conversation_id: baseConversation.id,
          direction: "outbound",
          channel: "internal",
          status: "sent",
          sender_name: "Agency team",
          sender_address: "",
          recipients: [],
          subject: baseConversation.subject,
          body: "The website is ready for review.",
          client_visible: true,
          sent_at: "2026-08-26T18:00:00.000Z",
          created_at: "2026-08-26T18:00:00.000Z",
        }],
      },
      {
        ...baseConversation,
        id: "conversation-2",
        channel: "email",
        status: "pending",
        client_visible: false,
        messages: [{
          id: "message-2",
          conversation_id: "conversation-2",
          direction: "outbound",
          channel: "email",
          status: "draft",
          sender_name: "Agency team",
          sender_address: "admin@example.com",
          recipients: ["client@example.com"],
          subject: "Launch reminder",
          body: "This message has not been sent.",
          client_visible: false,
          sent_at: null,
          created_at: "2026-08-26T19:00:00.000Z",
        }],
      },
    ]);

    expect(summary).toEqual({
      openConversations: 1,
      pendingConversations: 1,
      sharedMessages: 1,
      emailDrafts: 1,
    });
  });

  it("uses honest, readable delivery labels", () => {
    expect(communicationDeliveryLabel("internal")).toBe("Shared securely");
    expect(communicationDeliveryLabel("email")).toBe("Email draft");
    expect(communicationDeliveryLabel("sms")).toBe("Sms not configured");
    expect(labelCommunicationValue("awaiting_review")).toBe("Awaiting Review");
  });
});
