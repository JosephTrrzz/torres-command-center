export type ReportCadence = "weekly" | "monthly";

export function nextReportRun(current: string | Date, cadence: ReportCadence) {
  const next = new Date(current);
  if (Number.isNaN(next.getTime())) throw new Error("A valid next delivery time is required.");
  if (cadence === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  }
  return next.toISOString();
}

export function reportTypeLabel(value: string) {
  return value === "performance" ? "Client performance" : value === "opportunities" ? "SEO opportunities" : "Portfolio health";
}
