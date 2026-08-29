import { describe, expect, it } from "vitest";
import {
  CONVERSATION_CATEGORIES,
  buildCommunicationsSummary,
  communicationDeliveryLabel,
  conversationCategoryLabel,
  labelCommunicationValue,
  type Conversation,
} from "../lib/communications";
import {
  buildTransactionalEmailHtml,
  deliveryStatusForResendEvent,
  escapeEmailHtml,
  TRANSACTIONAL_EMAIL_CONFIDENTIALITY_NOTICE,
  TRANSACTIONAL_EMAIL_SIGNATURE,
  withTransactionalEmailFooter,
  withTransactionalEmailHtmlFooter,
} from "../functions/_shared/email";
import {
  MAX_COMMUNICATION_ATTACHMENT_BYTES,
  sanitizeCommunicationAttachmentName,
  validateCommunicationAttachment,
} from "../functions/_shared/communication-attachments";
import {
  normalizeE164,
  twilioMessageStatus,
  twilioSmsConfigured,
  twilioVoiceConfigured,
} from "../functions/_shared/twilio";
import { authDisplayName } from "../functions/_shared/auth";

const baseConversation: Conversation = {
  id: "conversation-1",
  subject: "Website launch approval",
  channel: "internal",
  status: "open",
  priority: "normal",
  category: "general",
  client_visible: true,
  archived_at: null,
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
          attachments: [],
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
          attachments: [],
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
    expect(communicationDeliveryLabel("sms")).toBe("Sms");
    expect(labelCommunicationValue("awaiting_review")).toBe("Awaiting Review");
    expect(CONVERSATION_CATEGORIES).toContain("support");
    expect(conversationCategoryLabel("onboarding")).toBe("Onboarding");
  });

  it("keeps archived threads out of active workload totals", () => {
    const summary = buildCommunicationsSummary([
      baseConversation,
      { ...baseConversation, id: "conversation-2", status: "pending", archived_at: "2026-08-27T12:00:00.000Z" },
    ]);

    expect(summary.openConversations).toBe(1);
    expect(summary.pendingConversations).toBe(0);
  });
});

describe("communication sender identity", () => {
  it("uses the authenticated profile name for replies", () => {
    expect(authDisplayName({ fullName: "Joseph", email: "admin@example.com" })).toBe("Joseph");
  });

  it("creates a readable fallback when the profile name is missing", () => {
    expect(authDisplayName({ fullName: null, email: "joseph.torres@example.com" })).toBe("Joseph Torres");
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

  it("adds the agency signature and confidentiality notice exactly once", () => {
    const plain = withTransactionalEmailFooter("A secure client update.");
    expect(plain).toContain(TRANSACTIONAL_EMAIL_SIGNATURE);
    expect(plain).toContain(TRANSACTIONAL_EMAIL_CONFIDENTIALITY_NOTICE);
    expect(withTransactionalEmailFooter(plain)).toBe(plain);

    const html = buildTransactionalEmailHtml({
      heading: "Client update",
      body: "A secure client update.",
    });
    expect(html.match(/Team at Torres &amp; Co\. Technology LLC/g)).toHaveLength(1);
    expect(html).toContain("Confidentiality notice:");
    expect(withTransactionalEmailHtmlFooter(html)).toBe(html);
  });
});

describe("communication attachment safety", () => {
  it("allows supported business files and rejects unsafe or oversized files", () => {
    expect(validateCommunicationAttachment({
      fileName: "signed-proposal.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
    })).toEqual({
      fileName: "signed-proposal.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
    });
    expect(validateCommunicationAttachment({
      fileName: "invoice.exe",
      contentType: "application/octet-stream",
      byteSize: 1024,
    })).toEqual({ error: "Use PDF, JPG, PNG, WebP, TXT, CSV, DOCX, or XLSX files." });
    expect(validateCommunicationAttachment({
      fileName: "large.pdf",
      contentType: "application/pdf",
      byteSize: MAX_COMMUNICATION_ATTACHMENT_BYTES + 1,
    })).toEqual({ error: "Each attachment must be 10 MB or smaller." });
  });

  it("normalizes attachment names before storage or download", () => {
    expect(sanitizeCommunicationAttachmentName("../../Client Proposal (final).pdf"))
      .toBe("Client Proposal -final-.pdf");
  });
});

describe("SMS and voice provider safety", () => {
  it("accepts only normalized E.164 phone numbers", () => {
    expect(normalizeE164("+1 (503) 555-0123")).toBe("+15035550123");
    expect(normalizeE164("503-555-0123")).toBe("+15035550123");
    expect(normalizeE164("+0000000")).toBe("");
  });

  it("reports provider readiness from the required credentials", () => {
    expect(twilioSmsConfigured({})).toBe(false);
    expect(twilioSmsConfigured({
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_MESSAGING_SERVICE_SID: "MG123",
    })).toBe(true);
    expect(twilioVoiceConfigured({
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_PHONE_NUMBER: "+15035550123",
    })).toBe(true);
  });

  it("maps Twilio lifecycle states without overstating delivery", () => {
    expect(twilioMessageStatus("queued")).toBe("queued");
    expect(twilioMessageStatus("delivered")).toBe("delivered");
    expect(twilioMessageStatus("undelivered")).toBe("failed");
    expect(twilioMessageStatus("unknown")).toBe("queued");
  });
});
