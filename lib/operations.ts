export const JOB_STATUSES = ["requested", "scheduled", "in_progress", "waiting", "completed", "canceled"] as const;
export const JOB_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const ESTIMATE_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
export const DOCUMENT_TYPES = ["proposal", "contract", "invoice", "report", "photo", "other"] as const;
export const DOCUMENT_STATUSES = ["draft", "shared", "approved", "archived"] as const;

export type JobStatus = typeof JOB_STATUSES[number];
export type JobPriority = typeof JOB_PRIORITIES[number];
export type EstimateStatus = typeof ESTIMATE_STATUSES[number];
export type DocumentType = typeof DOCUMENT_TYPES[number];
export type DocumentStatus = typeof DOCUMENT_STATUSES[number];

export interface CustomerLocation {
  id: string;
  label: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  is_primary: boolean;
  access_notes: string;
}

export interface OperationsContact { id: string; name: string; role: string; email: string; phone: string }
export interface OperationsTeamMember { id: string; name: string; email: string; role: string }
export interface OperationsLead { id: string; full_name: string; service_interest: string; status: string; converted_at: string | null }
export interface OperationsProject { id: string; name: string; status: string; progress_percent: number }
export interface OperationsTask {
  id: string;
  job_id: string | null;
  title: string;
  description: string;
  due_at: string | null;
  priority: JobPriority;
  status: string;
  assigned_to: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface JobActivity {
  id: string;
  job_id: string;
  activity_type: string;
  title: string;
  detail: string;
  client_visible: boolean;
  created_at: string;
}

export interface EstimateItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  sort_order: number;
}

export interface JobEstimate {
  id: string;
  job_id: string;
  estimate_number: string;
  title: string;
  status: EstimateStatus;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  expires_at: string | null;
  notes: string;
  client_visible: boolean;
  responded_at: string | null;
  created_at: string;
  items: EstimateItem[];
}

export interface JobDocument {
  id: string;
  job_id: string;
  estimate_id: string | null;
  title: string;
  description: string;
  document_type: DocumentType;
  status: DocumentStatus;
  resource_url: string;
  version: number;
  client_visible: boolean;
  created_at: string;
}

export interface ServiceJob {
  id: string;
  lead_id: string | null;
  project_id: string | null;
  job_number: string;
  title: string;
  description: string;
  status: JobStatus;
  priority: JobPriority;
  scheduled_start: string | null;
  scheduled_end: string | null;
  location_id: string | null;
  assigned_to: string | null;
  client_visible: boolean;
  created_at: string;
  updated_at: string;
  activities: JobActivity[];
  estimates: JobEstimate[];
  documents: JobDocument[];
  tasks: OperationsTask[];
}

export interface CalendarEntry {
  id: string;
  kind: "job" | "appointment" | "task";
  title: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  assigned_to: string | null;
  job_id: string | null;
}

export interface OperationsSnapshot {
  client: { id: string; name: string; industry: string; location: string; website: string };
  canManage: boolean;
  canRespondToEstimates: boolean;
  contacts: OperationsContact[];
  locations: CustomerLocation[];
  leads: OperationsLead[];
  projects: OperationsProject[];
  jobs: ServiceJob[];
  calendar: CalendarEntry[];
  team: OperationsTeamMember[];
  summary: ReturnType<typeof buildOperationsSummary>;
}

export function labelOperationsValue(value: string) {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

export function calculateEstimate(items: Array<{ quantity: number; unitPrice: number }>, taxRate = 0) {
  const subtotal = Math.round(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100) / 100;
  const tax = Math.round(subtotal * Math.max(0, taxRate) * 100) / 100;
  return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
}

export function buildOperationsSummary(jobs: Array<Pick<ServiceJob, "status" | "priority" | "scheduled_start">>, estimates: Array<Pick<JobEstimate, "status" | "total">>, documents: Array<Pick<JobDocument, "client_visible">>, now = new Date()) {
  const active = jobs.filter((job) => !["completed", "canceled"].includes(job.status));
  return {
    activeJobs: active.length,
    urgentJobs: active.filter((job) => job.priority === "urgent").length,
    upcomingJobs: active.filter((job) => job.scheduled_start && job.scheduled_start >= now.toISOString()).length,
    pendingEstimates: estimates.filter((estimate) => estimate.status === "sent").length,
    acceptedValue: estimates.filter((estimate) => estimate.status === "accepted").reduce((sum, estimate) => sum + Number(estimate.total || 0), 0),
    sharedDocuments: documents.filter((document) => document.client_visible).length,
  };
}
