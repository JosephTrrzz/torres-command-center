export const INTEGRATION_PROVIDERS = ["google", "resend", "website_intake", "supabase", "cloudflare"] as const;

export type IntegrationProvider = typeof INTEGRATION_PROVIDERS[number];
export type IntegrationHealth = "connected" | "degraded" | "action_required" | "disconnected";

export interface IntegrationConnection {
  provider: IntegrationProvider;
  name: string;
  category: string;
  description: string;
  scope: "client" | "organization" | "platform";
  status: IntegrationHealth;
  statusDetail: string;
  accountLabel: string;
  capabilities: string[];
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  canReconnect: boolean;
  canDisconnect: boolean;
}

export interface IntegrationSyncRun {
  id: string;
  provider: IntegrationProvider;
  operation: string;
  status: "running" | "succeeded" | "failed";
  recordsRead: number;
  recordsWritten: number;
  errorMessage: string;
  startedAt: string;
  completedAt: string | null;
}

export interface IntegrationsSnapshot {
  client: { id: string; name: string };
  canManage: boolean;
  registryReady: boolean;
  connections: IntegrationConnection[];
  runs: IntegrationSyncRun[];
  summary: {
    connected: number;
    actionRequired: number;
    checkedRecently: number;
  };
}

export function integrationStatusLabel(status: IntegrationHealth) {
  if (status === "action_required") return "Action required";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function integrationScopeLabel(scope: IntegrationConnection["scope"]) {
  if (scope === "organization") return "Agency-wide";
  if (scope === "platform") return "Platform";
  return "This client";
}

