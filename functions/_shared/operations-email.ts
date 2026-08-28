import { buildTransactionalEmailHtml } from "./email";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailRecipients(values: unknown[]) {
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => emailPattern.test(value))));
}

export function productionAppOrigin(requestUrl: string, configuredUrl?: string) {
  const candidates = [configuredUrl?.trim(), new URL(requestUrl).origin];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (!["https:", "http:"].includes(url.protocol)) continue;
      if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) continue;
      return url.origin;
    } catch {
      // Try the request origin next.
    }
  }
  return new URL(requestUrl).origin;
}

export function operationsSignInLink(requestUrl: string, configuredUrl: string | undefined, input: { clientId: string; jobId: string }) {
  const params = new URLSearchParams({ client: input.clientId, job: input.jobId });
  const returnTo = `/operations/?${params.toString()}`;
  return `${productionAppOrigin(requestUrl, configuredUrl)}/login/?returnTo=${encodeURIComponent(returnTo)}`;
}

function formatMoney(total: number | string | undefined, currency: string | undefined) {
  const amount = Number(total || 0);
  const code = (currency || "USD").trim().toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"} ${code}`;
  }
}

export function estimateReviewEmail(input: {
  clientName: string;
  estimateNumber?: string;
  estimateTitle?: string;
  total?: number | string;
  currency?: string;
  expiresAt?: string | null;
  actionUrl: string;
}) {
  const title = input.estimateTitle?.trim() || "Service estimate";
  const reference = input.estimateNumber?.trim() || "Estimate";
  const expiration = input.expiresAt ? `\n\nPlease respond by ${input.expiresAt}.` : "";
  const body = `Hello ${input.clientName},\n\nA new estimate is ready for your secure review.\n\n${reference}: ${title}\nTotal: ${formatMoney(input.total, input.currency)}${expiration}\n\nSign in to review the full estimate and accept or reject it. This private link opens only the workspace assigned to your account.`;
  return {
    subject: `${reference} is ready for review`,
    text: `${body}\n\nReview estimate: ${input.actionUrl}`,
    html: buildTransactionalEmailHtml({
      heading: "Your estimate is ready",
      preheader: `${reference} is ready for secure review.`,
      body,
      action: { label: "Review estimate", url: input.actionUrl },
    }),
  };
}

export function estimateDecisionEmail(input: {
  clientName: string;
  estimateNumber?: string;
  estimateTitle?: string;
  response: "accepted" | "rejected";
  responder: string;
  actionUrl: string;
}) {
  const title = input.estimateTitle?.trim() || "Service estimate";
  const reference = input.estimateNumber?.trim() || "Estimate";
  const responseLabel = input.response === "accepted" ? "accepted" : "rejected";
  const body = `${input.clientName} ${responseLabel} ${reference}: ${title}.\n\nResponse recorded by ${input.responder}. Open Operations to review the saved decision and continue the delivery workflow.`;
  return {
    subject: `${input.clientName} ${responseLabel} ${reference}`,
    text: `${body}\n\nOpen Operations: ${input.actionUrl}`,
    html: buildTransactionalEmailHtml({
      heading: `Estimate ${responseLabel}`,
      preheader: `${input.clientName} ${responseLabel} ${reference}.`,
      body,
      action: { label: "Open Operations", url: input.actionUrl },
    }),
  };
}
