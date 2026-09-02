export const LEAD_STATUSES = ["new", "qualified", "contacted", "appointment_scheduled", "won", "lost"] as const;
export const LEAD_SOURCES = ["website", "referral", "phone", "email", "social", "other"] as const;
export const APPOINTMENT_STATUSES = ["scheduled", "completed", "canceled", "no_show"] as const;
export const TASK_STATUSES = ["open", "in_progress", "completed", "canceled"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type LeadStatus = typeof LEAD_STATUSES[number];
export type LeadSource = typeof LEAD_SOURCES[number];
export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number];
export type TaskStatus = typeof TASK_STATUSES[number];
export type TaskPriority = typeof TASK_PRIORITIES[number];

export interface CrmLead {
  id: string;
  client_id: string;
  full_name: string;
  email: string;
  phone: string;
  company: string;
  service_interest: string;
  message: string;
  source: LeadSource;
  status: LeadStatus;
  assigned_to: string | null;
  is_pinned: boolean;
  pinned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmAppointment {
  id: string;
  lead_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: AppointmentStatus;
  location: string;
  notes: string;
  assigned_to: string | null;
  created_at: string;
}

export interface CrmTask {
  id: string;
  lead_id: string | null;
  appointment_id: string | null;
  title: string;
  description: string;
  due_at: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_to: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface CrmActivity {
  id: string;
  lead_id: string;
  activity_type: string;
  title: string;
  detail: string;
  created_at: string;
}

export interface CrmChatMessage {
  id: string;
  direction: "inbound" | "outbound" | "system";
  sender_name: string;
  body: string;
  status: string;
  created_at: string;
}

export interface CrmWebsiteChat {
  leadId: string | null;
  conversationId: string;
  clientId: string;
  visitorName: string;
  visitorEmail: string;
  visitorPhone: string;
  status: string;
  priority: string;
  lastMessageAt: string;
  latestMessage: string;
  state: string;
  aiEnabled: boolean;
  archivedAt: string | null;
  messages: CrmChatMessage[];
}

export interface CrmTeamMember { id: string; name: string; email: string; role: string }
export interface CrmClientOption { id: string; name: string }

export interface CrmSnapshot {
  scope: { type: "organization" | "client"; clientId: string | null; label: string };
  client: CrmClientOption | null;
  clients: CrmClientOption[];
  canManage: boolean;
  leads: CrmLead[];
  appointments: CrmAppointment[];
  tasks: CrmTask[];
  activities: CrmActivity[];
  websiteChats: CrmWebsiteChat[];
  archivedWebsiteChats: CrmWebsiteChat[];
  team: CrmTeamMember[];
  summary: ReturnType<typeof buildCrmSummary>;
}

export function labelCrmValue(value: string) {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function sortCrmLeads<T extends Pick<CrmLead, "is_pinned" | "pinned_at" | "created_at">>(leads: T[]) {
  return [...leads].sort((left, right) => {
    if (Boolean(left.is_pinned) !== Boolean(right.is_pinned)) return left.is_pinned ? -1 : 1;
    if (left.is_pinned && right.is_pinned) {
      const pinnedOrder = (right.pinned_at || "").localeCompare(left.pinned_at || "");
      if (pinnedOrder) return pinnedOrder;
    }
    return (right.created_at || "").localeCompare(left.created_at || "");
  });
}

export function buildCrmSummary(leads: Array<Pick<CrmLead, "status" | "assigned_to">>, tasks: Array<Pick<CrmTask, "status" | "due_at">>, appointments: Array<Pick<CrmAppointment, "status" | "starts_at">>, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return {
    activeLeads: leads.filter((lead) => !["won", "lost"].includes(lead.status)).length,
    unassigned: leads.filter((lead) => !lead.assigned_to && !["won", "lost"].includes(lead.status)).length,
    openTasks: tasks.filter((task) => !["completed", "canceled"].includes(task.status)).length,
    overdueTasks: tasks.filter((task) => task.due_at && task.due_at.slice(0, 10) < today && !["completed", "canceled"].includes(task.status)).length,
    upcomingAppointments: appointments.filter((appointment) => appointment.status === "scheduled" && appointment.starts_at >= now.toISOString()).length,
    wonLeads: leads.filter((lead) => lead.status === "won").length,
  };
}
