"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { APP_NAVIGATION, canAccessPath, defaultRouteForRole, roleLabel } from "../lib/access-control";
import { clearAuthSession, readStoredSession } from "../lib/supabase-auth";
import type { AuthSession } from "../lib/types";
import { readProfileAvatar } from "./profile-picture-editor";

const workspaceNotifications = [
  { id: "site-health", title: "Website health check ready", detail: "Your client site scorecards are ready to review.", time: "Today", tone: "insight" },
  { id: "onboarding", title: "Finish a client setup", detail: "Connect reporting services for your newest account.", time: "Yesterday", tone: "action" },
  { id: "report", title: "Weekly report window", detail: "Your next portfolio summary is ready to schedule.", time: "2 days ago", tone: "report" },
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "TC";
}

function displayNameFor(profile: AuthSession["profile"]) {
  if (profile.full_name.trim()) return profile.full_name.trim();
  const localPart = profile.email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return localPart.split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ") || "Workspace member";
}

export function Shell({ children, active }: { children: React.ReactNode; active: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const [profile, setProfile] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [avatarImage, setAvatarImage] = useState("");
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const stored = readStoredSession();
    try { setReadNotifications(JSON.parse(window.localStorage.getItem("torres-read-notifications") ?? "[]")); } catch { setReadNotifications([]); }
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
    setChecked(true);
    return () => window.removeEventListener("torres-profile-avatar-changed", onAvatarChanged);
  }, [pathname, router]);

  const logout = () => {
    clearAuthSession();
    router.replace("/login/");
  };
  const unreadCount = workspaceNotifications.filter((item) => !readNotifications.includes(item.id)).length;
  const markAllRead = () => { const ids = workspaceNotifications.map((item) => item.id); setReadNotifications(ids); window.localStorage.setItem("torres-read-notifications", JSON.stringify(ids)); };
  if (!checked || !session) return <main className="auth-loading" aria-live="polite">Opening your secure workspace…</main>;
  const nav = APP_NAVIGATION[session.profile.role];
  const displayName = displayNameFor(session.profile);
  const avatar = initials(displayName);
  const accessLabel = roleLabel(session.profile.role);
  return <div className="app-shell">
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand"><span className="brand-mark">T</span><span>Torres <i>&amp; Co.</i></span></div>
      <div className="workspace"><span className="workspace-avatar">TC</span><div><small>Workspace</small><strong>Torres &amp; Co. <b>⌄</b></strong></div></div>
      <nav aria-label="Main navigation">{nav.map((item) => <Link onClick={() => setOpen(false)} className={active === item.label ? "active" : ""} href={item.href} key={item.label}><span className="nav-icon">{item.label === "Overview" ? "◈" : item.label === "Clients" ? "◎" : item.label === "Portal" ? "↗" : item.label === "Integrations" ? "✦" : item.label === "Reports" ? "▤" : "⚙"}</span>{item.label}{item.label === "Clients" && session.profile.role !== "customer" && <em>3</em>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="profile">{avatarImage ? <img className="avatar avatar-image" src={avatarImage} alt="" /> : <span className="avatar">{avatar}</span>}<div><strong>{displayName}</strong><small>{accessLabel}</small></div><button className="logout-button" onClick={logout}>Log out</button></div></div>
    </aside>
    <main className="main">
      <header className="mobile-header"><button onClick={() => setOpen(!open)} aria-label="Toggle menu">☰</button><span className="brand-mark">T</span><strong>Torres &amp; Co.</strong><button className="mobile-logout" onClick={logout}>Log out</button></header>
      <div className="topbar"><span className="breadcrumb">Torres &amp; Co. <b>/</b> {active}</span><div className="top-actions"><div className="header-menu"><button className="round-button notification-trigger" onClick={() => setNotice(!notice)} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={notice}><span className="notification-bell">♧</span>{unreadCount > 0 && <b className="notification-count">{unreadCount}</b>}</button>{notice && <div className="menu-popover notification-popover"><div className="notification-heading"><div><strong>Notifications</strong><small>{unreadCount ? `${unreadCount} unread` : "All caught up"}</small></div>{unreadCount > 0 && <button className="mark-read" onClick={markAllRead}>Mark all read</button>}</div><div className="notification-list">{workspaceNotifications.map((item) => <div className={`notification-item ${readNotifications.includes(item.id) ? "is-read" : ""}`} key={item.id}><span className={`notification-dot ${item.tone}`} /><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.time}</small></div></div>)}</div><Link className="notification-footer" href="/settings/#admin-console" onClick={() => setNotice(false)}>Review workspace settings <span>→</span></Link></div>}</div><div className="header-menu"><button className="top-avatar" onClick={() => setProfile(!profile)} aria-label="Open profile">{avatarImage ? <img src={avatarImage} alt="" /> : avatar}</button>{profile && <div className="menu-popover profile-popover"><strong>{displayName}</strong><small>{accessLabel}</small><button onClick={logout}>Log out</button></div>}</div></div></div>
      <div className="content">{children}</div>
    </main>
  </div>;
}
