"use client";
import Link from "next/link";
import { useState } from "react";

const nav = [
  { label: "Overview", href: "/" },
  { label: "Clients", href: "/clients/" },
  { label: "Integrations", href: "/integrations/" },
  { label: "Reports", href: "/reports/" },
  { label: "Settings", href: "/settings/" },
];

export function Shell({ children, active }: { children: React.ReactNode; active: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  const [profile, setProfile] = useState(false);
  const logout = () => {
    window.localStorage.removeItem("torres-demo-session");
    window.localStorage.removeItem("torres-auth-session");
    window.location.href = "/login/";
  };
  return <div className="app-shell">
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand"><span className="brand-mark">T</span><span>Torres <i>&amp; Co.</i></span></div>
      <div className="workspace"><span className="workspace-avatar">TC</span><div><small>Workspace</small><strong>Torres &amp; Co. <b>⌄</b></strong></div></div>
      <nav aria-label="Main navigation">{nav.map((item) => <Link className={active === item.label ? "active" : ""} href={item.href} key={item.label}><span className="nav-icon">{item.label === "Overview" ? "◈" : item.label === "Clients" ? "◎" : item.label === "Integrations" ? "✦" : item.label === "Reports" ? "▤" : "⚙"}</span>{item.label}{item.label === "Clients" && <em>3</em>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="profile"><span className="avatar">JT</span><div><strong>Joseph Torres</strong><small>Admin</small></div><button className="logout-button" onClick={logout}>Log out</button></div></div>
    </aside>
    <main className="main">
      <header className="mobile-header"><button onClick={() => setOpen(!open)} aria-label="Toggle menu">☰</button><span className="brand-mark">T</span><strong>Torres &amp; Co.</strong><button className="mobile-logout" onClick={logout}>Log out</button></header>
      <div className="topbar"><span className="breadcrumb">Torres &amp; Co. <b>/</b> {active}</span><div className="top-actions"><div className="header-menu"><button className="round-button" onClick={() => setNotice(!notice)} aria-label="Notifications">♢<span /></button>{notice && <div className="menu-popover"><strong>Notifications</strong><p>No new alerts right now.</p></div>}</div><div className="header-menu"><button className="top-avatar" onClick={() => setProfile(!profile)} aria-label="Open profile">JT</button>{profile && <div className="menu-popover profile-popover"><strong>Joseph Torres</strong><small>Admin</small><button onClick={logout}>Log out</button></div>}</div></div></div>
      <div className="content">{children}</div>
    </main>
  </div>;
}
