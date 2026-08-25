"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { APP_NAVIGATION, canAccessPath, defaultRouteForRole, roleLabel } from "../lib/access-control";
import { clearAuthSession, readStoredSession } from "../lib/supabase-auth";
import type { AuthSession } from "../lib/types";
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
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [avatarImage, setAvatarImage] = useState("");
  const [clientCount, setClientCount] = useState(0);
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
    if (!canAccessPath(stored.profile.role, pathname || "/")) {
      router.replace(defaultRouteForRole(stored.profile.role));
      setChecked(true);
      return () => window.removeEventListener("torres-profile-avatar-changed", onAvatarChanged);
    }
    setSession(stored);
    setNotificationError("");
    void fetchNotifications(stored).then(setWorkspaceNotifications).catch(() => setNotificationError("Notifications couldn’t be loaded."));
    setChecked(true);
    return () => window.removeEventListener("torres-profile-avatar-changed", onAvatarChanged);
  }, [pathname, router]);

  useEffect(() => {
    fetchClients().then((rows) => setClientCount(rows.length)).catch(() => setClientCount(0));
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
  if (!checked || !session) return <main className="auth-loading" aria-live="polite">Opening your secure workspace…</main>;
  const nav = APP_NAVIGATION[session.profile.role];
  const displayName = displayNameFor(session.profile);
  const avatar = initials(displayName);
  const accessLabel = roleLabel(session.profile.role);
  return <div className="app-shell">
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand"><span className="brand-mark">T</span><span>Torres <i>&amp; Co.</i></span></div>
      <div className="workspace"><span className="workspace-avatar">TC</span><div><small>Workspace</small><strong>Torres &amp; Co. <b>⌄</b></strong></div></div>
      <nav aria-label="Main navigation">{nav.map((item) => <Link onClick={() => setOpen(false)} className={active === item.label ? "active" : ""} aria-current={active === item.label ? "page" : undefined} href={item.href} key={item.label}><span className="nav-icon" aria-hidden="true">{item.label === "Overview" ? "◈" : item.label === "Clients" ? "◎" : item.label === "Portal" ? "↗" : item.label === "Integrations" ? "✦" : item.label === "Reports" ? "▤" : "⚙"}</span>{item.label}{item.label === "Clients" && session.profile.role !== "customer" && clientCount > 0 && <em aria-label={`${clientCount} clients`}>{clientCount}</em>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="profile">{avatarImage ? <img className="avatar avatar-image" src={avatarImage} alt="" /> : <span className="avatar">{avatar}</span>}<div><strong>{displayName}</strong><small>{accessLabel}</small></div><button className="logout-button" onClick={logout}>Log out</button></div></div>
    </aside>
    <main className="main">
      <header className="mobile-header"><button onClick={() => setOpen(!open)} aria-label="Toggle menu">☰</button><span className="brand-mark">T</span><strong>Torres &amp; Co.</strong><button className="mobile-logout" onClick={logout}>Log out</button></header>
      <div className="topbar"><span className="breadcrumb">Torres &amp; Co. <b>/</b> {active}</span><div className="top-actions"><div className="header-menu"><button type="button" className="round-button notification-trigger" onClick={() => setNotice(!notice)} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={notice}><span className="notification-bell" aria-hidden="true" />{unreadCount > 0 && <b className="notification-count">{unreadCount}</b>}</button>{notice && <NotificationPanel items={workspaceNotifications} error={notificationError} unreadCount={unreadCount} onClose={() => setNotice(false)} onRetry={loadNotifications} onMarkAllRead={markAllRead} />}</div><div className="header-menu"><button type="button" className="top-avatar" onClick={() => setProfile(!profile)} aria-label="Open profile menu" aria-expanded={profile}>{avatarImage ? <img src={avatarImage} alt="" /> : avatar}</button>{profile && <div className="menu-popover profile-popover"><strong>{displayName}</strong><small>{accessLabel}</small><button type="button" onClick={logout}>Log out</button></div>}</div></div></div>
      <div className="content">{children}</div>
    </main>
  </div>;
}
