export type Trend = "up" | "down" | "flat";
export type HealthStatus = "healthy" | "watch" | "attention";
export type AppRole = "owner" | "employee" | "customer";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  client_id: string | null;
  active: boolean;
}

export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user: AuthUser;
  profile: UserProfile;
}

export interface Metric { label: string; value: string; change: string; trend: Trend; }
export interface ClientSummary {
  id: string; name: string; initials: string; industry: string; location: string;
  health: number; status: HealthStatus; metrics: Metric[]; lastUpdated: string;
}
export interface Activity { id: string; clientId: string; title: string; detail: string; time: string; type: "insight" | "report" | "alert"; }
export interface ClientDetail extends ClientSummary {
  website: string; email?: string; phone?: string; owner: string; services: string[]; overview: string;
  traffic: { month: string; value: number }[]; opportunities: string[];
  people?: ClientPerson[];
}

export interface ClientPerson {
  id: string;
  client_id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
  created_at?: string;
}

export type PortalStatus = "invited" | "active" | "paused" | "revoked";
export type BillingStatus = "not_connected" | "pending" | "active" | "past_due" | "canceled";

export interface CustomerAccount {
  id: string;
  client_id: string;
  portal_email: string;
  portal_enabled: boolean;
  portal_status: PortalStatus;
  billing_email: string;
  billing_status: BillingStatus;
  square_customer_id?: string | null;
  square_subscription_id?: string | null;
  created_at?: string;
  updated_at?: string;
}
