export const PROJECT_STATUSES = ["planned", "active", "blocked", "completed", "archived"] as const;
export const MILESTONE_STATUSES = ["not_started", "in_progress", "blocked", "complete"] as const;
export const DELIVERABLE_STATUSES = ["draft", "in_review", "approved", "delivered"] as const;
export const REQUEST_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
export const REQUEST_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type ProjectStatus = typeof PROJECT_STATUSES[number];
export type MilestoneStatus = typeof MILESTONE_STATUSES[number];
export type DeliverableStatus = typeof DELIVERABLE_STATUSES[number];
export type ClientRequestStatus = typeof REQUEST_STATUSES[number];
export type ClientRequestPriority = typeof REQUEST_PRIORITIES[number];

export interface ProjectMilestone {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  due_date: string | null;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDeliverable {
  id: string;
  project_id: string;
  milestone_id: string | null;
  title: string;
  description: string;
  status: DeliverableStatus;
  resource_url: string | null;
  due_date: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientProjectRequest {
  id: string;
  project_id: string | null;
  client_id: string;
  title: string;
  description: string;
  priority: ClientRequestPriority;
  status: ClientRequestStatus;
  requested_by: string | null;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientProject {
  id: string;
  organization_id: string;
  client_id: string;
  name: string;
  summary: string;
  status: ProjectStatus;
  start_date: string | null;
  target_date: string | null;
  progress_percent: number;
  created_at: string;
  updated_at: string;
  milestones: ProjectMilestone[];
  deliverables: ProjectDeliverable[];
  requests: ClientProjectRequest[];
}

export interface ProjectsSnapshot {
  client: { id: string; name: string };
  canManage: boolean;
  projects: ClientProject[];
  unassignedRequests: ClientProjectRequest[];
}

export function calculateProjectProgress(milestones: Array<Pick<ProjectMilestone, "status">>) {
  if (!milestones.length) return 0;
  const complete = milestones.filter((milestone) => milestone.status === "complete").length;
  return Math.round((complete / milestones.length) * 100);
}

export function labelProjectValue(value: string) {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function projectStatusFromProgress(status: ProjectStatus, progress: number): ProjectStatus {
  if (status === "archived" || status === "blocked") return status;
  if (progress === 100) return "completed";
  if (status === "completed" && progress < 100) return "active";
  return status;
}
