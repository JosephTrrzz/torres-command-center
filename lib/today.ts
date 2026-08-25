import type { ClientDetail } from "./types";
import type { WorkspaceNotification } from "./notifications";

export interface TodayReport {
  clientId: string;
  available?: boolean;
  analytics?: { totals?: { sessions?: number; conversions?: number } } | null;
  searchConsole?: { totals?: { clicks?: number; impressions?: number } } | null;
  errors?: string[];
}

export interface TodayPriority {
  id: string;
  title: string;
  detail: string;
  href: string;
  level: "action" | "watch" | "clear";
}

export function buildTodayPriorities(
  clients: ClientDetail[],
  reports: TodayReport[],
  notifications: WorkspaceNotification[],
): TodayPriority[] {
  const priorities: TodayPriority[] = [];

  notifications.filter((notification) => !notification.read).slice(0, 3).forEach((notification) => {
    priorities.push({
      id: `notification-${notification.id}`,
      title: notification.title,
      detail: notification.detail,
      href: notification.href || "/today/",
      level: "action",
    });
  });

  clients.filter((client) => client.health < 80).forEach((client) => {
    priorities.push({
      id: `health-${client.id}`,
      title: `${client.name} needs attention`,
      detail: `The current health score is ${client.health}/100. Review the account before the next client update.`,
      href: `/clients/detail/?id=${encodeURIComponent(client.id)}`,
      level: "watch",
    });
  });

  reports.filter((report) => report.available === false).forEach((report) => {
    const client = clients.find((candidate) => candidate.id === report.clientId);
    priorities.push({
      id: `report-${report.clientId}`,
      title: `${client?.name || "A client"} is missing report data`,
      detail: report.errors?.[0] || "Map a verified Google property before this client’s metrics can appear.",
      href: `/integrations/?client=${encodeURIComponent(report.clientId)}`,
      level: "watch",
    });
  });

  if (!priorities.length) {
    priorities.push({
      id: "all-clear",
      title: "No urgent action right now",
      detail: "Connected accounts are current and there are no unread workspace actions.",
      href: "/reports/",
      level: "clear",
    });
  }

  return priorities;
}
