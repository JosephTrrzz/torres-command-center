"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LoadingRegion } from "./loading-system";
import { PrivateOfficeNextAction, PrivateOfficePortfolioPanel } from "./private-office";
import { FeedbackBanner, StatePanel } from "./ui-foundation";
import { fetchNotifications, type WorkspaceNotification } from "../lib/notifications";
import { fetchOnboarding } from "../lib/onboarding-api";
import type { OnboardingSnapshot } from "../lib/onboarding";
import { fetchProjects } from "../lib/projects-api";
import type { ProjectsSnapshot } from "../lib/projects";
import { fetchClient, fetchClientPeople, fetchCustomerAccount, fetchCustomerAccountByEmail } from "../lib/supabase-data";
import type { AuthSession, ClientDetail, ClientPerson, CustomerAccount } from "../lib/types";

function formatStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstName(session: AuthSession) {
  const saved = session.profile.full_name.trim().split(/\s+/)[0];
  if (saved) return saved;
  const emailName = (session.profile.email || session.user.email || "").split("@")[0].split(/[._-]/)[0];
  return emailName ? emailName.charAt(0).toUpperCase() + emailName.slice(1).toLowerCase() : "there";
}

export function ClientPrivateOfficeHome({ session }: { session: AuthSession }) {
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [people, setPeople] = useState<ClientPerson[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingSnapshot | null>(null);
  const [projects, setProjects] = useState<ProjectsSnapshot | null>(null);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError("");
      try {
        await fetch("/api/customer-activate", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => undefined);
        const customerAccount = session.profile.client_id
          ? await fetchCustomerAccount(session.profile.client_id)
          : await fetchCustomerAccountByEmail(session.profile.email || session.user.email || "");
        if (!customerAccount) throw new Error("Your Private Office account is not active yet. Please contact Torres & Co. Technology.");
        const customer = await fetchClient(customerAccount.client_id);
        if (!customer) throw new Error("The company connected to this Private Office could not be found.");
        const [contacts, setup, projectSnapshot, notices] = await Promise.all([
          fetchClientPeople(customer.id).catch(() => [] as ClientPerson[]),
          fetchOnboarding(session, customer.id).catch(() => null),
          fetchProjects(session).catch(() => null),
          fetchNotifications(session).catch(() => [] as WorkspaceNotification[]),
        ]);
        if (cancelled) return;
        setAccount(customerAccount);
        setClient(customer);
        setPeople(contacts);
        setOnboarding(setup);
        setProjects(projectSnapshot);
        setNotifications(notices);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Your Private Office could not be opened.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [session]);

  const nextAction = useMemo(() => {
    if (onboarding && onboarding.status !== "complete") return { href: "/onboarding/", title: "Complete your private profile", description: "Finish the remaining setup details so every recommendation and report reflects your business accurately.", label: "Continue setup" };
    const unread = notifications.find((notification) => !notification.read);
    if (unread) return { href: unread.href || "/inbox/", title: unread.title, description: unread.detail, label: "Review update" };
    const activeProject = projects?.projects.find((project) => project.status === "active" || project.status === "blocked");
    if (activeProject) return { href: "/projects/", title: `Review ${activeProject.name}`, description: activeProject.summary || "Review the latest milestones, deliverables, dates, and requests.", label: "Open project" };
    return { href: "/operations/", title: "Review your service record", description: "See scheduled work, approvals, and client-visible documents in one secure place.", label: "Open services" };
  }, [notifications, onboarding, projects]);

  if (loading) return <LoadingRegion active label="Preparing your Private Office" variant="dashboard" />;
  if (error || !account || !client) return <FeedbackBanner tone="error" title="Your Private Office could not load"><p>{error || "The client record is unavailable."}</p><p><Link href="/portal/">Review your account access</Link></p></FeedbackBanner>;

  const visibleChanges = notifications.slice(0, 3);
  const activeProjects = projects?.projects.filter((project) => project.status === "active" || project.status === "blocked").length || 0;
  const dateLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  return <div className="private-office-home">
    {onboarding && onboarding.status !== "complete" && <div className="onboarding-portal-banner"><div><span className="eyebrow">Finish account setup</span><strong>Your business profile is {onboarding.completionPercent}% complete.</strong><p>Complete the guided steps so your workspace uses accurate business information.</p></div><Link className="button button-dark" href="/onboarding/">Continue onboarding <span className="custom-arrow" aria-hidden="true">→︎</span></Link></div>}
    <section className="private-office-arrival">
      <div><span className="private-office-kicker">{dateLabel}</span><h1>Welcome back, {firstName(session)}.</h1><p>A composed view of your relationship with Torres &amp; Co.—current work, account standing, performance, and the next useful action.</p></div>
      <aside><span>Account standing</span><strong>{account.portal_status === "active" ? "In good standing" : formatStatus(account.portal_status)}</strong><small>{activeProjects ? `${activeProjects} active project${activeProjects === 1 ? "" : "s"}` : client.name}</small></aside>
    </section>
    <div className="private-office-home-grid">
      <PrivateOfficePortfolioPanel businessName={client.name} clientSince={account.created_at} servicePlan={client.services[0]} accountStatus={account.portal_status === "active" ? "Relationship active" : formatStatus(account.portal_status)} contact={people[0]?.name || account.portal_email} recordId={client.id} />
      <PrivateOfficeNextAction href={nextAction.href} eyebrow="One action for you" title={nextAction.title} description={nextAction.description} label={nextAction.label} />
    </div>
    <section className="private-office-chapter private-office-change-chapter">
      <header><span className="private-office-kicker">What changed</span><h2>Work moved forward while you were away.</h2><p>Only updates connected to your secure workspace appear here.</p></header>
      {visibleChanges.length ? <ol>{visibleChanges.map((notice, index) => <li key={notice.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{notice.title}</strong><p>{notice.detail}</p></div><small>{notice.time}</small>{notice.href ? <Link href={notice.href} aria-label={`Open ${notice.title}`}><span className="custom-arrow" aria-hidden="true">→︎</span></Link> : null}</li>)}</ol> : <StatePanel state="empty" title="No new updates" description="Project, service, message, and performance activity will appear here when it changes." />}
    </section>
  </div>;
}
