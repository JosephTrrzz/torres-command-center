export type Trend = "up" | "down" | "flat";
export type HealthStatus = "healthy" | "watch" | "attention";

export interface Metric { label: string; value: string; change: string; trend: Trend; }
export interface ClientSummary {
  id: string; name: string; initials: string; industry: string; location: string;
  health: number; status: HealthStatus; metrics: Metric[]; lastUpdated: string;
}
export interface Activity { id: string; clientId: string; title: string; detail: string; time: string; type: "insight" | "report" | "alert"; }
export interface ClientDetail extends ClientSummary {
  website: string; email?: string; phone?: string; owner: string; services: string[]; overview: string;
  traffic: { month: string; value: number }[]; opportunities: string[];
}
