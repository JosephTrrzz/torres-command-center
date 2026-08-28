import { describe, expect, it } from "vitest";
import {
  buildMarketingSummary,
  campaignCanSend,
  labelMarketingValue,
  type MarketingCampaign,
  type MarketingContact,
} from "../lib/marketing";

const contacts: MarketingContact[] = [
  { id: "1", name: "Ready", role: "Owner", email: "ready@example.com", suppressed: false, suppression_reason: "" },
  { id: "2", name: "Stopped", role: "Owner", email: "stopped@example.com", suppressed: true, suppression_reason: "unsubscribed" },
  { id: "3", name: "Missing", role: "Owner", email: "", suppressed: false, suppression_reason: "" },
];

function campaign(overrides: Partial<MarketingCampaign> = {}): MarketingCampaign {
  return {
    id: "campaign-1",
    campaign_type: "newsletter",
    name: "Quarterly update",
    subject: "What is new",
    preview_text: "A concise update",
    body: "Here is the latest update.",
    review_url: null,
    service_job_id: null,
    status: "draft",
    sent_at: null,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
    recipients: [{
      id: "recipient-1",
      email: "ready@example.com",
      display_name: "Ready",
      consent_basis: "business_relationship",
      status: "pending",
      error_detail: "",
      sent_at: null,
      delivered_at: null,
    }],
    ...overrides,
  };
}

describe("marketing campaign summaries", () => {
  it("counts only eligible contacts and delivered recipients", () => {
    const summary = buildMarketingSummary([
      campaign(),
      campaign({
        id: "campaign-2",
        status: "partial",
        recipients: [
          { ...campaign().recipients[0], id: "recipient-2", status: "delivered" },
          { ...campaign().recipients[0], id: "recipient-3", status: "failed" },
        ],
      }),
    ], contacts);

    expect(summary).toEqual({
      drafts: 1,
      sentCampaigns: 1,
      eligibleContacts: 1,
      deliveredRecipients: 1,
      suppressedContacts: 1,
    });
  });
});

describe("marketing campaign delivery gates", () => {
  it("allows only complete drafts with a pending recipient", () => {
    expect(campaignCanSend(campaign())).toBe(true);
    expect(campaignCanSend(campaign({ status: "sent" }))).toBe(false);
    expect(campaignCanSend(campaign({ subject: "" }))).toBe(false);
    expect(campaignCanSend(campaign({ recipients: [{ ...campaign().recipients[0], status: "suppressed" }] }))).toBe(false);
  });

  it("formats system values for people", () => {
    expect(labelMarketingValue("review_request")).toBe("Review Request");
    expect(labelMarketingValue("delivery_delayed")).toBe("Delivery Delayed");
  });
});
