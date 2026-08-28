import { describe, expect, it } from "vitest";
import {
  buildCommunicationsSummary,
  communicationDeliveryLabel,
  labelCommunicationValue,
  type Conversation,
} from "../lib/communications";
import { buildTransactionalEmailHtml, deliveryStatusForResendEvent, escapeEmailHtml } from "../functions/_shared/email";

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
          provider_message_id: null,
          error_detail: "",
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
          provider_message_id: null,
          error_detail: "",
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
    expect(communicationDeliveryLabel("email")).toBe("Email");
    expect(communicationDeliveryLabel("sms")).toBe("Sms not configured");
    expect(labelCommunicationValue("awaiting_review")).toBe("Awaiting Review");
  });
});

describe("transactional email safety", () => {
  it("escapes user content before rendering email HTML", () => {
    expect(escapeEmailHtml(`<script>alert("x")</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    const html = buildTransactionalEmailHtml({ heading: "Client <update>", body: "Hello & welcome" });
    expect(html).toContain("Client &lt;update&gt;");
    expect(html).toContain("Hello &amp; welcome");
    expect(html).not.toContain("<update>");
  });

  it("renders only safe activation actions", () => {
    const html = buildTransactionalEmailHtml({
      heading: "Portal invitation",
      body: "Your workspace is ready.",
      action: { label: "Open <portal>", url: "https://admin.example.com/activate?a=1&b=2" },
    });
    expect(html).toContain("Open &lt;portal&gt;");
    expect(html).toContain("https://admin.example.com/activate?a=1&amp;b=2");

    const unsafe = buildTransactionalEmailHtml({
      heading: "Portal invitation",
      body: "Your workspace is ready.",
      action: { label: "Open portal", url: "javascript:alert(1)" },
    });
    expect(unsafe).not.toContain("javascript:");
  });

  it("maps only supported provider lifecycle events", () => {
    expect(deliveryStatusForResendEvent("email.delivered")).toBe("delivered");
    expect(deliveryStatusForResendEvent("email.bounced")).toBe("bounced");
    expect(deliveryStatusForResendEvent("email.opened")).toBeNull();
  });
});
