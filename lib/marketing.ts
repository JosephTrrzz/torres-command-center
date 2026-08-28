export const CAMPAIGN_TYPES = ["announcement", "newsletter", "review_request"] as const;
export const CAMPAIGN_STATUSES = ["draft", "sending", "sent", "partial", "canceled"] as const;
export const RECIPIENT_STATUSES = ["pending", "sending", "sent", "delivered", "delivery_delayed", "failed", "bounced", "complained", "suppressed"] as const;

export type CampaignType = typeof CAMPAIGN_TYPES[number];
export type CampaignStatus = typeof CAMPAIGN_STATUSES[number];
export type RecipientStatus = typeof RECIPIENT_STATUSES[number];
export type ConsentBasis = "business_relationship" | "explicit_opt_in";

export interface MarketingContact {
  id: string;
  name: string;
  role: string;
  email: string;
  suppressed: boolean;
  suppression_reason: string;
}

export interface MarketingRecipient {
  id: string;
  email: string;
  display_name: string;
  consent_basis: ConsentBasis;
  status: RecipientStatus;
  error_detail: string;
  sent_at: string | null;
  delivered_at: string | null;
}

export interface MarketingCampaign {
  id: string;
  campaign_type: CampaignType;
  name: string;
  subject: string;
  preview_text: string;
  body: string;
  review_url: string | null;
  service_job_id: string | null;
  status: CampaignStatus;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  recipients: MarketingRecipient[];
}

export interface MarketingJob {
  id: string;
  job_number: string;
  title: string;
  completed_at: string | null;
}

export interface MarketingSummary {
  drafts: number;
  sentCampaigns: number;
  eligibleContacts: number;
  deliveredRecipients: number;
  suppressedContacts: number;
}

export interface MarketingSnapshot {
  client: { id: string; name: string; industry: string; location: string };
  canManage: boolean;
  delivery: "ready" | "not_configured";
  contacts: MarketingContact[];
  completedJobs: MarketingJob[];
  campaigns: MarketingCampaign[];
  summary: MarketingSummary;
}

export function labelMarketingValue(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildMarketingSummary(campaigns: MarketingCampaign[], contacts: MarketingContact[]): MarketingSummary {
  const recipients = campaigns.flatMap((campaign) => campaign.recipients);
  return {
    drafts: campaigns.filter((campaign) => campaign.status === "draft").length,
    sentCampaigns: campaigns.filter((campaign) => campaign.status === "sent" || campaign.status === "partial").length,
    eligibleContacts: contacts.filter((contact) => Boolean(contact.email) && !contact.suppressed).length,
    deliveredRecipients: recipients.filter((recipient) => recipient.status === "delivered").length,
    suppressedContacts: contacts.filter((contact) => contact.suppressed).length,
  };
}

export function campaignCanSend(campaign: MarketingCampaign) {
  return campaign.status === "draft"
    && Boolean(campaign.subject.trim() && campaign.body.trim())
    && campaign.recipients.some((recipient) => recipient.status === "pending");
}
