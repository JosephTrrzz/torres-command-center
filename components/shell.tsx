"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { APP_NAVIGATION, appRoleForOrganizationRole, canAccessPath, defaultRouteForRole, organizationRoleLabel } from "../lib/access-control";
import { clearAuthSession, createAuthSessionFromTokens, readStoredSession, storeAuthSession, switchOrganization } from "../lib/supabase-auth";
import type { AuthSession, ClientSummary, OrganizationAccess } from "../lib/types";
import { readProfileAvatar } from "./profile-picture-editor";
import { fetchClients } from "../lib/supabase-data";
import { fetchNotifications, markNotificationsRead, type WorkspaceNotification } from "../lib/notifications";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "TC";
}

function displayNameFor(profile: AuthSession["profile"]) {
  if (profile.full_name.trim()) return profile.full_name.trim();
  const localPart = profile.email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return localPart.split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ") || "Workspace member";
}

function NotificationPanel({ items, error, unreadCount, onClose, onRetry, onMarkAllRead }: { items: WorkspaceNotification[]; error: string; unreadCount: number; onClose: () => void; onRetry: () => void; onMarkAllRead: () => void }) {
  return <div className="menu-popover notification-popover" role="dialog" aria-label="Workspace notifications">
    <div className="notification-heading"><div><strong>Notifications</strong><small>{unreadCount ? `${unreadCount} unread` : "All caught up"}</small></div>{unreadCount > 0 && <button type="button" className="mark-read" onClick={onMarkAllRead}>Mark all read</button>}</div>
    <div className="notification-list">{error ? <div className="notification-empty notification-error"><strong>Notifications are unavailable</strong><p>{error}</p><button type="button" onClick={onRetry}>Try again</button></div> : items.length ? items.map((item) => item.href ? <Link className={`notification-item ${item.read ? "is-read" : ""}`} href={item.href} onClick={onClose} key={item.id}><span className={`notification-dot ${item.tone}`} aria-hidden="true" /><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.time}</small></div></Link> : <div className={`notification-item ${item.read ? "is-read" : ""}`} key={item.id}><span className={`notification-dot ${item.tone}`} aria-hidden="true" /><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.time}</small></div></div>) : <div className="notification-empty"><strong>You’re all caught up</strong><p>New client, report, and integration activity will appear here.</p></div>}</div>
    <Link className="notification-footer" href="/settings/#admin-console" onClick={onClose}>Review workspace settings <span>→</span></Link>
  </div>;
}

export function Shell({ children, active }: { children: React.ReactNode; active: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  const [workspaceNotifications, setWorkspaceNotifications] = useState<WorkspaceNotification[]>([]);
  const [notificationError, setNotificationError] = useState("");
  const [profile, setProfile] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [avatarImage, setAvatarImage] = useState("");
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const stored = readStoredSession();
    setAvatarImage(readProfileAvatar());
    const onAvatarChanged = () => setAvatarImage(readProfileAvatar());
    window.addEventListener("torres-profile-avatar-changed", onAvatarChanged);
    if (!stored) {
      const returnTo = pathname ? `?returnTo=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login/${returnTo}`);
      setChecked(true);
      return () => window.removeEventListener("torres-profile-avatar-changed", onAvatarChanged);
    }
    const effectiveRole = appRoleForOrganizationRole(stored.organization?.role, stored.profile.role);
    if (!canAccessPath(effectiveRole, pathname || "/")) {
      router.replace(defaultRouteForRole(effectiveRole));
      setChecked(true);
      return () => window.removeEventListener("torres-profile-avatar-changed", onAvatarChanged);
    }
    setSession(stored);
    if (!Array.isArray(stored.organizations)) {
      void createAuthSessionFromTokens(stored.access_token, stored.refresh_token, stored.expires_at, stored.user).then((freshSession) => {
        storeAuthSession(freshSession);
        setSession(freshSession);
      }).catch(() => undefined);
    }
    setNotificationError("");
    void fetchNotifications(stored).then(setWorkspaceNotifications).catch(() => setNotificationError("Notifications couldn’t be loaded."));
    setChecked(true);
    return () => window.removeEventListener("torres-profile-avatar-changed", onAvatarChanged);
  }, [pathname, router]);

  useEffect(() => {
    fetchClients().then(setClients).catch(() => setClients([]));
  }, []);

  const logout = () => {
    clearAuthSession();
    router.replace("/login/");
  };
  const unreadCount = workspaceNotifications.filter((item) => !item.read).length;
  const loadNotifications = () => {
    if (!session) return;
    setNotificationError("");
    void fetchNotifications(session).then(setWorkspaceNotifications).catch(() => setNotificationError("Notifications couldn’t be loaded."));
  };
  const markAllRead = () => {
    if (!session) return;
    const ids = workspaceNotifications.filter((item) => !item.read).map((item) => item.id);
    setWorkspaceNotifications((items) => items.map((item) => ({ ...item, read: true })));
    void markNotificationsRead(session, ids).catch(() => {
      setWorkspaceNotifications((items) => items.map((item) => ids.includes(item.id) ? { ...item, read: false } : item));
      setNotificationError("Those notifications couldn’t be updated. Try again.");
    });
  };
  const chooseWorkspace = async (organization: OrganizationAccess) => {
    if (!session || organization.id === session.organization?.id) {
      setWorkspaceOpen(false);
      return;
    }
    setWorkspaceBusy(organization.id);
    setWorkspaceError("");
    try {
      const nextSession = await switchOrganization(session, organization.id);
      storeAuthSession(nextSession);
      setSession(nextSession);
      setWorkspaceOpen(false);
      const nextRole = appRoleForOrganizationRole(nextSession.organization?.role, nextSession.profile.role);
      const nextPath = canAccessPath(nextRole, pathname || "/") ? pathname || defaultRouteForRole(nextRole) : defaultRouteForRole(nextRole);
      router.push(nextPath);
      router.refresh();
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "That workspace could not be opened.");
    } finally {
      setWorkspaceBusy("");
    }
  };
  if (!checked || !session) return <main className="auth-loading" aria-live="polite">Opening your secure workspace…</main>;
  const effectiveRole = appRoleForOrganizationRole(session.organization?.role, session.profile.role);
  const nav = APP_NAVIGATION[effectiveRole];
  const displayName = displayNameFor(session.profile);
  const avatar = initials(displayName);
  const accessLabel = organizationRoleLabel(session.organization?.role, session.profile.role);
  const organizations = session.organizations?.length ? session.organizations : session.organization ? [session.organization] : [];
  return <div className="app-shell">
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand"><span className="brand-mark">T</span><span>Torres <i>&amp; Co.</i></span></div>
      <div className="workspace-control">
        <button className="workspace" type="button" onClick={() => { setWorkspaceOpen(!workspaceOpen); setWorkspaceError(""); }} aria-haspopup="menu" aria-expanded={workspaceOpen}>
          <span className="workspace-avatar">{initials(session.organization?.name || "Torres & Co.")}</span><span className="workspace-copy"><small>{session.organization?.kind === "client" ? "Client workspace" : "Agency workspace"}</small><strong>{session.organization?.name || "Torres & Co."}</strong></span><span className="workspace-chevron" aria-hidden="true">⌄</span>
        </button>
        {workspaceOpen && <div className="workspace-menu" role="menu" aria-label="Choose a workspace">
          <div className="workspace-menu-heading"><strong>Switch workspace</strong><small>Only workspaces you can access are shown.</small></div>
          <div className="workspace-options">{organizations.map((organization) => <button type="button" role="menuitemradio" aria-checked={organization.id === session.organization?.id} className="workspace-option" key={organization.id} onClick={() => void chooseWorkspace(organization)} disabled={Boolean(workspaceBusy)}><span>{initials(organization.name)}</span><div><strong>{organization.name}</strong><small>{organization.kind === "agency" ? "Agency" : "Client"} · {organizationRoleLabel(organization.role, session.profile.role)}</small></div><b>{workspaceBusy === organization.id ? "…" : organization.id === session.organization?.id ? "✓" : "→"}</b></button>)}</div>
          {effectiveRole !== "customer" && clients.length > 0 && <div className="workspace-preview-section"><span>View as client</span><small>Preview mode is labeled and does not change your account.</small>{clients.map((client) => <Link href={`/portal/?previewClient=${encodeURIComponent(client.id)}`} onClick={() => { setWorkspaceOpen(false); setOpen(false); }} key={client.id}><i>{client.initials}</i><strong>{client.name}</strong><b>Preview →</b></Link>)}</div>}
          {workspaceError && <p className="workspace-error" role="alert">{workspaceError}</p>}
        </div>}
      </div>
      <nav aria-label="Main navigation">{nav.map((item) => <Link onClick={() => setOpen(false)} className={active === item.label ? "active" : ""} aria-current={active === item.label ? "page" : undefined} href={item.href} key={item.label}><span className="nav-icon" aria-hidden="true">{item.label === "Today" ? "☼" : item.label === "Overview" ? "◈" : item.label === "Clients" ? "◎" : item.label === "CRM" ? "◉" : item.label === "Projects" ? "◇" : item.label === "Operations" ? "▦" : item.label === "Inbox" ? "✉" : item.label === "Onboarding" ? "✓" : item.label === "Portal" || item.label === "My account" ? "↗" : item.label === "Integrations" ? "✦" : item.label === "Reports" ? "▤" : "⚙"}</span>{item.label}{item.label === "Clients" && effectiveRole !== "customer" && clients.length > 0 && <em aria-label={`${clients.length} clients`}>{clients.length}</em>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="profile">{avatarImage ? <img className="avatar avatar-image" src={avatarImage} alt="" /> : <span className="avatar">{avatar}</span>}<div><strong>{displayName}</strong><small>{accessLabel}</small></div><button className="logout-button" onClick={logout}>Log out</button></div></div>
    </aside>
    <main className="main">
      <header className="mobile-header"><button onClick={() => setOpen(!open)} aria-label="Toggle menu">☰</button><span className="brand-mark">T</span><strong>Torres &amp; Co.</strong><button className="mobile-logout" onClick={logout}>Log out</button></header>
      <div className="topbar"><span className="breadcrumb">Torres &amp; Co. <b>/</b> {active}</span><div className="top-actions"><div className="header-menu"><button type="button" className="round-button notification-trigger" onClick={() => setNotice(!notice)} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={notice}><span className="notification-bell" aria-hidden="true" />{unreadCount > 0 && <b className="notification-count">{unreadCount}</b>}</button>{notice && <NotificationPanel items={workspaceNotifications} error={notificationError} unreadCount={unreadCount} onClose={() => setNotice(false)} onRetry={loadNotifications} onMarkAllRead={markAllRead} />}</div><div className="header-menu"><button type="button" className="top-avatar" onClick={() => setProfile(!profile)} aria-label="Open profile menu" aria-expanded={profile}>{avatarImage ? <img src={avatarImage} alt="" /> : avatar}</button>{profile && <div className="menu-popover profile-popover"><strong>{displayName}</strong><small>{accessLabel}</small><button type="button" onClick={logout}>Log out</button></div>}</div></div></div>
      <div className="content">{children}</div>
    </main>
  </div>;
}
