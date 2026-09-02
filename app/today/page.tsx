"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "../../components/shell";
import { ClientPrivateOfficeHome } from "../../components/client-private-office-home";
import { FeedbackBanner, PageHeader, StatePanel } from "../../components/ui-foundation";
import { appRoleForOrganizationRole } from "../../lib/access-control";
import { fetchNotifications, type WorkspaceNotification } from "../../lib/notifications";
import { readStoredSession } from "../../lib/supabase-auth";
import { fetchClients } from "../../lib/supabase-data";
import { buildTodayPriorities, type TodayReport } from "../../lib/today";
import type { AuthSession, ClientDetail } from "../../lib/types";

export default function TodayPage() {
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [reports, setReports] = useState<TodayReport[]>([]);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewerSession, setViewerSession] = useState<AuthSession | null>(null);
  const [roleChecked, setRoleChecked] = useState(false);

  useEffect(() => {
    const session = readStoredSession();
    setViewerSession(session);
    setRoleChecked(true);
    if (!session || appRoleForOrganizationRole(session.organization?.role, session.profile.role) === "customer") {
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const loadedClients = await fetchClients();
        setClients(loadedClients);
        const [loadedNotifications, loadedReports] = await Promise.all([
          fetchNotifications(session).catch(() => [] as WorkspaceNotification[]),
          Promise.all(loadedClients.map(async (client): Promise<TodayReport> => {
            try {
              const response = await fetch(`/api/reports?client=${encodeURIComponent(client.id)}`, {
                cache: "no-store",
                headers: { Authorization: `Bearer ${session.access_token}` },
              });
              if (!response.ok) return { clientId: client.id, available: false, errors: ["Live reporting could not be verified."] };
              return await response.json() as TodayReport;
            } catch {
              return { clientId: client.id, available: false, errors: ["Live reporting could not be reached."] };
            }
          })),
        ]);
        setNotifications(loadedNotifications);
        setReports(loadedReports);
      } catch {
        setError("Your operating brief could not load. Confirm the Supabase connection and try again.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const priorities = useMemo(() => buildTodayPriorities(clients, reports, notifications), [clients, reports, notifications]);
  const totals = useMemo(() => reports.reduce((result, report) => ({
    sessions: result.sessions + (report.analytics?.totals?.sessions || 0),
    clicks: result.clicks + (report.searchConsole?.totals?.clicks || 0),
    current: result.current + (report.available ? 1 : 0),
  }), { sessions: 0, clicks: 0, current: 0 }), [reports]);
  const unread = notifications.filter((notification) => !notification.read).length;
  const attention = clients.filter((client) => client.health < 80).length;
  const dateLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  if (!roleChecked) return <Shell active="Today"><StatePanel state="loading" title="Opening your workspace" description="Confirming your secure account access." /></Shell>;
  if (viewerSession && appRoleForOrganizationRole(viewerSession.organization?.role, viewerSession.profile.role) === "customer") return <Shell active="Today"><ClientPrivateOfficeHome session={viewerSession} /></Shell>;

  return <Shell active="Today">
    <PageHeader className="today-heading" eyebrow={dateLabel} title="Today" description="Your live operating brief, prioritized from connected workspace activity." actions={<Link className="button button-dark" href="/reports/">Review reports <span aria-hidden="true">→︎</span></Link>} />

    {error && <FeedbackBanner tone="error" title="The operating brief could not load"><p>{error}</p></FeedbackBanner>}

    <section className="today-stats" aria-label="Today summary">
      <div><span>Unread actions</span><strong>{loading ? "—" : unread}</strong><small>{unread ? "Open the priority queue" : "No unread workspace actions"}</small></div>
      <div><span>Clients needing attention</span><strong>{loading ? "—" : attention}</strong><small>{attention ? "Health score below 80" : "No low health scores"}</small></div>
      <div><span>Current data sources</span><strong>{loading ? "—" : `${totals.current}/${clients.length}`}</strong><small>Clients with verified live report data</small></div>
      <div><span>Last 28 days</span><strong>{loading ? "—" : totals.sessions.toLocaleString()}</strong><small>{totals.clicks.toLocaleString()} Search Console clicks</small></div>
    </section>

    <section className="today-layout">
      <div className="today-priority-panel">
        <div className="section-heading"><div><p className="eyebrow">Priority queue</p><h2>What needs attention</h2></div></div>
        {loading ? <StatePanel state="loading" title="Building your priority queue" description="Checking connected accounts and recent workspace activity." /> : priorities.length ? <div className="today-priority-list">{priorities.map((priority, index) => <Link href={priority.href} className={`today-priority ${priority.level}`} key={priority.id}><span className="today-priority-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{priority.title}</strong><p>{priority.detail}</p></div><b aria-hidden="true">→︎</b></Link>)}</div> : <StatePanel state="empty" title="No priorities need attention" description="New client, reporting, and integration activity will appear here." />}
      </div>

      <aside className="today-flow-panel">
        <p className="eyebrow">Operating rhythm</p><h2>Move the work forward</h2>
        <ol>
          <li><Link href="/clients/"><strong>Client readiness</strong><span>Review accounts and activation status.</span></Link></li>
          <li><Link href="/integrations/"><strong>Evidence layer</strong><span>Verify provider mappings and live data.</span></Link></li>
          <li><Link href="/reports/"><strong>Client communication</strong><span>Preview the evidence before sharing.</span></Link></li>
        </ol>
      </aside>
    </section>
  </Shell>;
}
