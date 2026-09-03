export type ReportMetricKey = "sessions" | "clicks" | "impressions" | "conversions";

export const REPORT_METRICS: Record<ReportMetricKey, { label: string; source: string; definition: string }> = {
  sessions: { label: "GA4 sessions", source: "Google Analytics", definition: "Visits that began during the selected period. One person may start more than one session." },
  clicks: { label: "Search clicks", source: "Google Search Console", definition: "Clicks from a Google Search result to the connected website." },
  impressions: { label: "Search impressions", source: "Google Search Console", definition: "Times a page from the connected website appeared in Google Search results." },
  conversions: { label: "GA4 conversions", source: "Google Analytics", definition: "Events marked as conversions in the connected GA4 property during the period." },
};

export function metricChange(current: number, previous: number) {
  const delta = current - previous;
  return { delta, percent: previous === 0 ? null : delta / previous };
}

export function formatMetricChange(current: number, previous: number) {
  const change = metricChange(current, previous);
  if (change.percent === null) return current === 0 ? "No change" : "New activity";
  if (!change.delta) return "No change";
  return `${change.delta > 0 ? "+" : "−"}${Math.round(Math.abs(change.percent) * 100)}% vs previous`;
}
