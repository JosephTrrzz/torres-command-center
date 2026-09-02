import Link from "next/link";

export type AppIconName = "today" | "overview" | "clients" | "crm" | "projects" | "operations" | "inbox" | "campaigns" | "onboarding" | "portal" | "integrations" | "reports" | "settings" | "chevron";

const paths: Record<AppIconName, React.ReactNode> = {
  today: <><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  overview: <><path d="M12 3 21 12 12 21 3 12Z"/><path d="m12 7 5 5-5 5-5-5Z"/></>,
  clients: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3.5 20v-2.3A4.7 4.7 0 0 1 8.2 13h1.6a4.7 4.7 0 0 1 4.7 4.7V20M14.5 15a4 4 0 0 1 6 3.5V20"/></>,
  crm: <><circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/><path d="m18 4 .8 1.5 1.7.3-1.2 1.2.3 1.7L18 8l-1.6.7.3-1.7-1.2-1.2 1.7-.3Z"/></>,
  projects: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
  operations: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  inbox: <><path d="M3 6.5h18v12H3Z"/><path d="m3 7 9 7 9-7"/></>,
  campaigns: <><path d="m4 13 13-6v10L4 11Z"/><path d="M7 13v5.5a2 2 0 0 0 2 2h1M20 9v6"/></>,
  onboarding: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
  portal: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H5V6h6"/></>,
  integrations: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="5"/></>,
  reports: <><path d="M5 3h14v18H5Z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7L10.5 2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7Z" transform="translate(1.5) scale(.88)"/></>,
  chevron: <path d="m8 10 4 4 4-4"/>,
};

export function AppIcon({ name, size = 18 }: { name: AppIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export function Breadcrumbs({ current, client = false }: { current: string; client?: boolean }) {
  return <nav className="app-breadcrumbs" aria-label="Breadcrumb"><ol><li><Link href={client ? "/portal/" : "/"}>{client ? "Client workspace" : "Torres & Co."}</Link></li><li aria-hidden="true">/</li><li aria-current="page">{current}</li></ol></nav>;
}

export function PageHeader({ eyebrow, title, description, actions, className = "" }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode; className?: string }) {
  return <header className={`page-heading page-header ${className}`.trim()}><div className="page-header-copy"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="lede">{description}</p></div>{actions ? <div className="page-header-actions">{actions}</div> : null}</header>;
}

export function FeedbackBanner({ tone = "info", title, children, action }: { tone?: "info" | "success" | "warning" | "error"; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <section className={`feedback-banner feedback-${tone}`} role={tone === "error" ? "alert" : "status"}><span className="feedback-mark" aria-hidden="true"/><div><strong>{title}</strong>{children ? <div>{children}</div> : null}</div>{action ? <div className="feedback-action">{action}</div> : null}</section>;
}

export function StatePanel({ state, title, description, action }: { state: "loading" | "empty" | "error"; title: string; description: string; action?: React.ReactNode }) {
  return <section className={`state-panel state-${state}`} aria-live={state === "loading" ? "polite" : undefined} role={state === "error" ? "alert" : undefined}><span className="state-symbol" aria-hidden="true">{state === "loading" ? <span className="state-spinner"/> : state === "error" ? "!" : "—"}</span><div><p className="eyebrow">{state === "loading" ? "Loading" : state === "error" ? "Needs attention" : "Nothing here yet"}</p><h2>{title}</h2><p>{description}</p>{action ? <div className="state-action">{action}</div> : null}</div></section>;
}
