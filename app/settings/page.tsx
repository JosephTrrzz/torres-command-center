"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { BrandSelect } from "../../components/brand-select";
import { Shell } from "../../components/shell";
import { ProfilePictureEditor } from "../../components/profile-picture-editor";
import { createClient, fetchClients } from "../../lib/supabase-data";
import { readStoredSession } from "../../lib/supabase-auth";

type CustomerStatus = "Active" | "Invited" | "Paused";
type Customer = { id: string; name: string; email: string; status: CustomerStatus; phone?: string; industry?: string };
type Modal = "customer" | "team" | null;
type TeamInviteResult = { email: string; role: string; activationLink: string; message: string; emailSent: boolean; deliveryStatus: string; emailError?: string };

const checklistLabels = [
  ["Create the customer record", "Capture the company details and primary contact."],
  ["Invite the customer", "Give the customer a secure login to their workspace."],
  ["Connect reporting services", "Link Google, website health, and review sources."],
  ["Schedule the first report", "Set the cadence that keeps everyone aligned."],
];

export default function SettingsPage() {
  const [compact, setCompact] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [completed, setCompleted] = useState([true, true, false, false]);
  const [modal, setModal] = useState<Modal>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [teamInvite, setTeamInvite] = useState<TeamInviteResult | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: "", email: "", phone: "", industry: "" });
  const [newTeam, setNewTeam] = useState({ name: "", email: "", role: "operator" });
  const [preferences, setPreferences] = useState({ company: "Torres & Co.", industry: "Technology Agency", location: "Dallas, TX", website: "https://torrescotechnology.com", email: "jos.jt@icloud.com", phone: "", timezone: "America/Los_Angeles", cadence: "Weekly", emailAlerts: true, weeklyDigest: true, explanations: true });
  const [security, setSecurity] = useState({ mfa: true, customerEdit: true, audit: true, backups: true });
  const [communications, setCommunications] = useState({ autoLeadAcknowledgment: true, websiteChatEnabled: true });

  useEffect(() => {
    try {
      setCompact(window.localStorage.getItem("torres-compact-view") === "true");
      const storedCustomers = window.localStorage.getItem("torres-admin-customers");
      const storedPreferences = window.localStorage.getItem("torres-settings-preferences");
      const storedSecurity = window.localStorage.getItem("torres-settings-security");
      const storedCommunications = window.localStorage.getItem("torres-settings-communications");
      const storedChecklist = window.localStorage.getItem("torres-settings-checklist");
      if (storedCustomers) {
        const saved = JSON.parse(storedCustomers) as Customer[];
        setCustomers(saved.filter((customer) => !["hvac", "taqueria", "torres"].includes(customer.id)));
      } else {
        fetchClients().then((rows) => setCustomers(rows.map((row) => ({ id: row.id, name: row.name, email: row.email ?? "", phone: row.phone, industry: row.industry, status: "Active" as const })))).catch(() => undefined);
      }
      if (storedPreferences) setPreferences(JSON.parse(storedPreferences));
      if (storedSecurity) setSecurity(JSON.parse(storedSecurity));
      if (storedCommunications) setCommunications(JSON.parse(storedCommunications));
      if (storedChecklist) setCompleted(JSON.parse(storedChecklist));
    } catch { /* Keep safe starter defaults. */ }
    const session = readStoredSession();
    if (session?.access_token) {
      fetch("/api/settings", { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(async (response) => {
          const body = await response.json().catch(() => ({})) as { settings?: { preferences?: Partial<typeof preferences>; security?: Partial<typeof security>; communications?: Partial<typeof communications>; compact?: boolean; completed?: boolean[] } };
          if (!response.ok || !body.settings) return;
          if (body.settings.preferences) setPreferences((current) => ({ ...current, ...body.settings?.preferences }));
          if (body.settings.security) setSecurity((current) => ({ ...current, ...body.settings?.security }));
          if (body.settings.communications) setCommunications((current) => ({ ...current, ...body.settings?.communications }));
          if (typeof body.settings.compact === "boolean") setCompact(body.settings.compact);
          if (Array.isArray(body.settings.completed)) setCompleted(body.settings.completed.slice(0, 4));
        })
        .catch(() => undefined);
    }
  }, []);

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function persistCustomers(next: Customer[]) { setCustomers(next); window.localStorage.setItem("torres-admin-customers", JSON.stringify(next)); }
  async function saveSettings() {
    const session = readStoredSession();
    if (!session?.access_token) { showNotice("Sign in again before saving settings."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ preferences, security, communications, compact, completed }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error || "Supabase could not confirm the settings update.");
      window.localStorage.setItem("torres-compact-view", String(compact));
      window.localStorage.setItem("torres-settings-preferences", JSON.stringify(preferences));
      window.localStorage.setItem("torres-settings-security", JSON.stringify(security));
      window.localStorage.setItem("torres-settings-communications", JSON.stringify(communications));
      window.localStorage.setItem("torres-settings-checklist", JSON.stringify(completed));
      setSaved(true);
      showNotice(body.message || "Admin settings saved to Supabase.");
      window.setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Unable to save admin settings.");
    } finally {
      setSaving(false);
    }
  }
  async function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newCustomer.name.trim() || !newCustomer.email.trim()) { showNotice("Add a company name and primary contact email first."); return; }
    setOnboardingBusy(true);
    try {
      const input = { name: newCustomer.name.trim(), industry: newCustomer.industry.trim() || "Not specified", location: "", website: "", email: newCustomer.email.trim(), phone: newCustomer.phone.trim(), health_score: 0 };
      const created = await createClient(input);
      const row = created?.[0];
      if (!row?.id) throw new Error("The customer record was not returned by Supabase.");
      const session = readStoredSession();
      const response = await fetch("/api/admin/customer-invite", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` }, body: JSON.stringify({ clientId: row.id, email: input.email, fullName: input.name }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The customer was created, but the portal invitation could not be prepared.");
      const customer = { id: row.id, name: input.name, email: input.email, phone: input.phone, industry: input.industry, status: "Invited" as const };
      persistCustomers([...customers.filter((item) => item.id !== row.id), customer]);
      setNewCustomer({ name: "", email: "", phone: "", industry: "" }); setModal(null); showNotice(body.message || `${customer.name} was added and invited to the customer portal.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Unable to complete customer onboarding.");
    } finally { setOnboardingBusy(false); }
  }
  async function inviteTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTeam.name.trim() || !newTeam.email.trim()) { showNotice("Add the team member’s name and email first."); return; }
    setOnboardingBusy(true);
    try {
      const session = readStoredSession();
      const response = await fetch("/api/admin/team-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ fullName: newTeam.name.trim(), email: newTeam.email.trim(), role: newTeam.role }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.activationLink) throw new Error(body.error || "The team invitation could not be prepared.");
      setTeamInvite({ email: body.email, role: body.role, activationLink: body.activationLink, message: body.message, emailSent: Boolean(body.emailSent), deliveryStatus: body.deliveryStatus || "failed", emailError: body.emailError });
      showNotice(body.message || `Invitation ready for ${newTeam.name.trim()}.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Unable to invite this team member.");
    } finally {
      setOnboardingBusy(false);
    }
  }
  function togglePause(id: string) { persistCustomers(customers.map((customer) => customer.id === id ? { ...customer, status: customer.status === "Paused" ? "Active" : "Paused" } : customer)); showNotice("Customer access status updated."); }
  function removeCustomer(id: string) { const removed = customers.find((customer) => customer.id === id); persistCustomers(customers.filter((customer) => customer.id !== id)); setRemoveId(null); showNotice(`${removed?.name ?? "Customer"} was removed from this admin list.`); }
  function exportWorkspace() {
    const blob = new Blob([JSON.stringify({ customers, preferences, security, communications, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "torres-command-center-workspace.json"; anchor.click(); URL.revokeObjectURL(url); showNotice("Workspace export downloaded.");
  }
  function updatePreference(key: keyof typeof preferences, value: string | boolean) { setPreferences((current) => ({ ...current, [key]: value })); }
  function updateSecurity(key: keyof typeof security, value: boolean) { setSecurity((current) => ({ ...current, [key]: value })); }
  function updateCommunications(key: keyof typeof communications, value: boolean) { setCommunications((current) => ({ ...current, [key]: value })); }
  const statusClass = (status: CustomerStatus) => `status-chip status-${status.toLowerCase()}`;

  return (
    <Shell active="Settings">
      <div className="page-heading settings-page-heading"><div><p className="eyebrow">Admin console</p><h1>Settings</h1><p className="lede">Run your company from one place: onboard customers, manage access, personalize their workspace, connect reporting, and keep your team aligned.</p></div><button className="button button-dark" onClick={() => void saveSettings()} disabled={saving}>{saving ? "Saving…" : saved ? "Saved" : "Save settings"}</button></div>
      {notice && <p className="success-message settings-notice">{notice}</p>}
      <nav className="settings-nav" aria-label="Settings sections"><a href="#customer-workspace">Customer workspace</a><a href="#admin-console">Admin console</a><a href="#communications">Communications</a><a href="#security-roles">Security &amp; roles</a></nav>

      <section className="settings-section" id="customer-workspace"><div className="settings-section-head"><div><p className="eyebrow">Customer workspace</p><h2>Make each account feel personal</h2><p>These details shape the customer-facing workspace, report labels, alerts, and explanations.</p></div></div><ProfilePictureEditor /><div className="settings-grid-2">
        <section className="detail-card"><p className="eyebrow">Profile and preferences</p><h2>Your company defaults</h2><div className="settings-form-grid">{([ ["company", "Company name"], ["industry", "Industry"], ["location", "Primary location"], ["website", "Company website"], ["email", "Admin contact email"], ["phone", "Admin phone"] ] as const).map(([key, label]) => <label key={key}>{label}<input type={key === "email" ? "email" : key === "website" ? "url" : "text"} value={preferences[key]} onChange={(event) => updatePreference(key, event.target.value)} /></label>)}<BrandSelect label="Timezone" value={preferences.timezone} onChange={(value) => updatePreference("timezone", value)} options={[{ value: "America/Los_Angeles", label: "Pacific Time", description: "Los Angeles and West Coast" }, { value: "America/Denver", label: "Mountain Time", description: "Denver and Mountain region" }, { value: "America/Chicago", label: "Central Time", description: "Dallas and Central region" }, { value: "America/New_York", label: "Eastern Time", description: "New York and East Coast" }]} /><BrandSelect label="Report cadence" value={preferences.cadence} onChange={(value) => updatePreference("cadence", value)} options={[{ value: "Weekly", label: "Weekly", description: "A fresh report every week" }, { value: "Monthly", label: "Monthly", description: "A focused monthly summary" }, { value: "Quarterly", label: "Quarterly", description: "A strategic quarterly review" }]} /></div><p className="info-callout">The admin contact email is shared across the organization and saved in Supabase. It does not change the email used to sign in.</p><div className="settings-list"><label className="toggle-row"><span><strong>Customer profile editing</strong><small>Let customers update their own company contact details.</small></span><input type="checkbox" checked={security.customerEdit} onChange={(event) => updateSecurity("customerEdit", event.target.checked)} /></label><label className="toggle-row"><span><strong>Explain every metric</strong><small>Show plain-language help next to scores, traffic, reviews, and opportunities.</small></span><input type="checkbox" checked={preferences.explanations} onChange={(event) => updatePreference("explanations", event.target.checked)} /></label></div></section>
        <section className="detail-card"><p className="eyebrow">Connections</p><h2>Proof for every business</h2><p className="card-explanation">Connect the services that prove performance. Each connection can power reporting, recommendations, and customer-facing explanations.</p><div className="settings-list"><div><strong>Google Business Profile</strong><span>Reviews, rating, calls, direction requests, and listing health.</span><span className="status-chip status-invited">Managed per client</span></div><div><strong>Google Analytics + Search Console</strong><span>Traffic, engagement, search clicks, impressions, and queries.</span><span className="status-chip status-active">Mapped in integrations</span></div><div><strong>Website health and Cloudflare</strong><span>Uptime, performance, DNS, security, and deployment status.</span><span className="status-chip status-active">Cloudflare connected</span></div></div><Link className="button button-light" href="/integrations/">Open integrations hub</Link></section>
      </div></section>

      <section className="settings-section" id="admin-console"><div className="settings-section-head"><div><p className="eyebrow">Admin console</p><h2>Onboard and manage access</h2><p>Use these tools for the full customer lifecycle, from first invitation through offboarding.</p></div></div><div className="admin-action-grid"><button className="admin-action" onClick={() => setModal("customer")}><span>+</span><strong>Onboard customer</strong><small>Create a customer record and prepare their invite.</small></button><button className="admin-action" onClick={() => { setTeamInvite(null); setModal("team"); }}><span>↗︎</span><strong>Invite team member</strong><small>Add employees with the right role and access level.</small></button><button className="admin-action" onClick={exportWorkspace}><span>↓︎</span><strong>Export workspace</strong><small>Download a backup of customer and admin settings.</small></button><Link className="admin-action" href="/clients/"><span>◎</span><strong>Manage client records</strong><small>Edit company profiles, contacts, and customer details.</small></Link></div><div className="settings-grid-2">
        <section className="detail-card"><p className="eyebrow">Onboarding checklist</p><h2>Make every launch consistent</h2><div className="onboarding-list">{checklistLabels.map(([title, description], index) => <button className={`onboarding-item ${completed[index] ? "is-complete" : ""}`} key={title} onClick={() => setCompleted((current) => current.map((item, itemIndex) => itemIndex === index ? !item : item))}><span>{completed[index] ? "✓" : index + 1}</span><div><strong>{title}</strong><small>{description}</small></div></button>)}</div></section>
        <section className="detail-card"><p className="eyebrow">Customer access</p><h2>Active accounts</h2><div className="customer-table">{customers.map((customer) => <div className="customer-row" key={customer.id}><div><strong>{customer.name}</strong><small>{customer.email}{customer.phone ? ` · ${customer.phone}` : ""}</small><span className={statusClass(customer.status)}>{customer.status}</span></div><div className="row-actions">{customer.status === "Invited" && <button className="text-button" onClick={() => showNotice(`Open this client from Clients to create a fresh activation link for ${customer.name}.`)}>Resend invite</button>}<button className="text-button" onClick={() => togglePause(customer.id)}>{customer.status === "Paused" ? "Resume" : "Pause"}</button><button className="text-button danger-text" onClick={() => setRemoveId(customer.id)}>Remove</button></div>{removeId === customer.id && <div className="inline-confirm"><span>Remove this customer from your admin list?</span><button className="text-button danger-text" onClick={() => removeCustomer(customer.id)}>Confirm remove</button><button className="text-button" onClick={() => setRemoveId(null)}>Keep</button></div>}</div>)}</div><p className="info-callout">Invitations and organization memberships are created through protected server workflows. Removing a customer here only removes the local admin-list entry; use a controlled offboarding workflow before revoking production access.</p></section>
      </div></section>

      <section className="settings-section" id="communications">
        <div className="settings-section-head"><div><p className="eyebrow">Communications</p><h2>Control the first response</h2><p>Manage the acknowledgment sent to new leads and whether the public website receptionist is accepting conversations.</p></div></div>
        <div className="settings-grid-2">
          <section className="detail-card"><p className="eyebrow">Lead follow-up</p><h2>Confirm every inquiry</h2><p className="card-explanation">Send a professional receipt immediately after a new lead shares an email address.</p><div className="settings-list"><label className="toggle-row"><span><strong>Automatic 24-hour acknowledgment</strong><small>Tell new leads their message was received and that the team will respond within 24 hours.</small></span><input type="checkbox" checked={communications.autoLeadAcknowledgment} onChange={(event) => updateCommunications("autoLeadAcknowledgment", event.target.checked)} /></label></div></section>
          <section className="detail-card"><p className="eyebrow">Website receptionist</p><h2>Control live website chat</h2><p className="card-explanation">Turn the public chat button off during maintenance or when the team is unavailable.</p><div className="settings-list"><label className="toggle-row"><span><strong>Website chat enabled</strong><small>Show the chat button and allow new receptionist sessions on torrescotechnology.com.</small></span><input type="checkbox" checked={communications.websiteChatEnabled} onChange={(event) => updateCommunications("websiteChatEnabled", event.target.checked)} /></label></div></section>
        </div>
      </section>

      <section className="settings-section" id="security-roles"><div className="settings-section-head"><div><p className="eyebrow">Security &amp; roles</p><h2>Keep access clear and controlled</h2><p>Assign the least-privileged organization role that matches each person’s work.</p></div></div><div className="settings-grid-2"><section className="detail-card"><p className="eyebrow">Role guide</p><h2>Who can do what?</h2><div className="role-list"><div><strong>Owner / Administrator</strong><span>Manage organization access, customers, integrations, reports, automation, and audit history.</span></div><div><strong>Operator</strong><span>Run client delivery, integrations, reports, exports, and AI without changing organization access.</span></div><div><strong>Member / Viewer</strong><span>Members can use reports and AI; viewers have read-only workspace access.</span></div><div><strong>Client</strong><span>View only their own company portal, reports, connected metrics, and recommendations.</span></div></div></section><section className="detail-card"><p className="eyebrow">Protection</p><h2>Security controls</h2><div className="settings-list">{([ ["mfa", "Multi-factor authentication", "Require an extra sign-in step for admin accounts."], ["audit", "Activity history", "Keep a record of important access and profile changes."], ["backups", "Workspace backups", "Keep an exportable copy of customer and configuration data."] ] as const).map(([key, title, description]) => <label className="toggle-row" key={key}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={security[key]} onChange={(event) => updateSecurity(key, event.target.checked)} /></label>)}<label className="toggle-row"><span><strong>Email alerts</strong><small>Notify admins when important customer or integration events occur.</small></span><input type="checkbox" checked={preferences.emailAlerts} onChange={(event) => updatePreference("emailAlerts", event.target.checked)} /></label></div></section></div><div className="danger-zone"><div><p className="eyebrow">Danger zone</p><h3>Offboarding policy</h3><p>Review your customer removal process before enabling permanent deletion. Export data, revoke access, and confirm ownership first.</p></div><button className="button button-outline-danger" onClick={() => showNotice("Offboarding review checklist opened.")}>Review policy</button></div></section>

      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}><div className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close dialog" onClick={() => setModal(null)}>×</button>{modal === "customer" ? <><p className="eyebrow">Customer onboarding</p><h2>Add a customer</h2><p className="card-explanation">Start with the company and primary contact. You can finish connections after the record is created.</p><form className="inline-form" onSubmit={addCustomer}><label>Company name<input required value={newCustomer.name} onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })} /></label><label>Primary email<input required type="email" value={newCustomer.email} onChange={(event) => setNewCustomer({ ...newCustomer, email: event.target.value })} /></label><label>Phone number<input value={newCustomer.phone} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} /></label><label>Industry<input value={newCustomer.industry} onChange={(event) => setNewCustomer({ ...newCustomer, industry: event.target.value })} /></label><div className="modal-actions"><button type="button" className="button button-light" onClick={() => setModal(null)}>Cancel</button><button className="button button-dark" disabled={onboardingBusy}>{onboardingBusy ? "Creating…" : "Add customer"}</button></div></form></> : <><p className="eyebrow">Team access</p><h2>{teamInvite ? teamInvite.emailSent ? "Invitation sent" : "Invitation ready" : "Invite a team member"}</h2><p className="card-explanation">{teamInvite ? teamInvite.emailSent ? `Resend accepted the branded invitation for ${teamInvite.email}. Keep the secure link below as a fallback.` : "The email provider did not accept this invitation. Copy the private activation link and send it manually." : "Choose the least-privileged role that gives this person the access they need."}</p>{teamInvite ? <div className="activation-link-panel"><div><span>Invitee</span><strong>{teamInvite.email}</strong><small>{teamInvite.role} · {teamInvite.emailSent ? "Email accepted" : "Manual delivery required"}</small>{!teamInvite.emailSent && teamInvite.emailError && <small>{teamInvite.emailError}</small>}</div><label>Secure activation link<input readOnly value={teamInvite.activationLink} onFocus={(event) => event.currentTarget.select()} /></label><div className="modal-actions"><button type="button" className="button button-light" onClick={() => { setTeamInvite(null); setNewTeam({ name: "", email: "", role: "operator" }); }}>Invite another</button><button type="button" className="button button-dark" onClick={async () => { await navigator.clipboard.writeText(teamInvite.activationLink); showNotice("Activation link copied."); }}>{teamInvite.emailSent ? "Copy fallback link" : "Copy link"}</button></div></div> : <form className="inline-form" onSubmit={inviteTeam}><label>Name<input required value={newTeam.name} onChange={(event) => setNewTeam({ ...newTeam, name: event.target.value })} /></label><label>Email<input required type="email" value={newTeam.email} onChange={(event) => setNewTeam({ ...newTeam, email: event.target.value })} /></label><BrandSelect label="Role" value={newTeam.role} onChange={(value) => setNewTeam({ ...newTeam, role: value })} options={[{ value: "operator", label: "Operator", description: "Manage clients, integrations, reports, and AI" }, { value: "member", label: "Member", description: "Read clients and integrations; create reports" }, { value: "viewer", label: "Viewer", description: "Read-only workspace access" }, { value: "admin", label: "Administrator", description: "Manage the organization, team, and all operations" }]} /><div className="modal-actions"><button type="button" className="button button-light" onClick={() => setModal(null)}>Cancel</button><button className="button button-dark" disabled={onboardingBusy}>{onboardingBusy ? "Preparing…" : "Create secure invite"}</button></div></form>}</>}</div></div>}
    </Shell>
  );
}
