"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { BrandSelect } from "../../components/brand-select";
import { Shell } from "../../components/shell";

type CustomerStatus = "Active" | "Invited" | "Paused";
type Customer = { id: string; name: string; email: string; status: CustomerStatus; phone?: string; industry?: string };
type Modal = "customer" | "team" | null;

const starterCustomers: Customer[] = [
  { id: "hvac", name: "HVAC Ministries", email: "owner@hvacministries.com", status: "Active" },
  { id: "taqueria", name: "Taqueria Market", email: "hello@taqueriamarket.com", status: "Active" },
  { id: "torres", name: "Torres & Co.", email: "joseph@torrescotechnology.com", status: "Active" },
];

const checklistLabels = [
  ["Create the customer record", "Capture the company details and primary contact."],
  ["Invite the customer", "Give the customer a secure login to their workspace."],
  ["Connect reporting services", "Link Google, website health, and review sources."],
  ["Schedule the first report", "Set the cadence that keeps everyone aligned."],
];

export default function SettingsPage() {
  const [compact, setCompact] = useState(false);
  const [saved, setSaved] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>(starterCustomers);
  const [completed, setCompleted] = useState([true, true, false, false]);
  const [modal, setModal] = useState<Modal>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [newCustomer, setNewCustomer] = useState({ name: "", email: "", phone: "", industry: "" });
  const [newTeam, setNewTeam] = useState({ name: "", email: "", role: "Employee" });
  const [preferences, setPreferences] = useState({ company: "Torres & Co.", industry: "Technology Agency", location: "Dallas, TX", website: "https://torrescotechnology.com", email: "joseph@torrescotechnology.com", phone: "", timezone: "America/Los_Angeles", cadence: "Weekly", emailAlerts: true, weeklyDigest: true, explanations: true });
  const [security, setSecurity] = useState({ mfa: true, customerEdit: true, audit: true, backups: true });

  useEffect(() => {
    try {
      setCompact(window.localStorage.getItem("torres-compact-view") === "true");
      const storedCustomers = window.localStorage.getItem("torres-admin-customers");
      const storedPreferences = window.localStorage.getItem("torres-settings-preferences");
      const storedSecurity = window.localStorage.getItem("torres-settings-security");
      const storedChecklist = window.localStorage.getItem("torres-settings-checklist");
      if (storedCustomers) setCustomers(JSON.parse(storedCustomers));
      if (storedPreferences) setPreferences(JSON.parse(storedPreferences));
      if (storedSecurity) setSecurity(JSON.parse(storedSecurity));
      if (storedChecklist) setCompleted(JSON.parse(storedChecklist));
    } catch { /* Keep safe starter defaults. */ }
  }, []);

  function showNotice(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  function persistCustomers(next: Customer[]) { setCustomers(next); window.localStorage.setItem("torres-admin-customers", JSON.stringify(next)); }
  function saveSettings() {
    window.localStorage.setItem("torres-compact-view", String(compact));
    window.localStorage.setItem("torres-settings-preferences", JSON.stringify(preferences));
    window.localStorage.setItem("torres-settings-security", JSON.stringify(security));
    window.localStorage.setItem("torres-settings-checklist", JSON.stringify(completed));
    setSaved(true); showNotice("Admin settings saved."); window.setTimeout(() => setSaved(false), 2000);
  }
  function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newCustomer.name.trim() || !newCustomer.email.trim()) { showNotice("Add a company name and primary contact email first."); return; }
    const customer = { id: `${newCustomer.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`, name: newCustomer.name.trim(), email: newCustomer.email.trim(), phone: newCustomer.phone.trim(), industry: newCustomer.industry.trim(), status: "Invited" as const };
    persistCustomers([...customers, customer]); setNewCustomer({ name: "", email: "", phone: "", industry: "" }); setModal(null); showNotice(`${customer.name} was added as an invited customer.`);
  }
  function inviteTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTeam.name.trim() || !newTeam.email.trim()) { showNotice("Add the team member’s name and email first."); return; }
    setModal(null); showNotice(`Invite prepared for ${newTeam.name.trim()}. Connect Supabase Auth to deliver it.`); setNewTeam({ name: "", email: "", role: "Employee" });
  }
  function togglePause(id: string) { persistCustomers(customers.map((customer) => customer.id === id ? { ...customer, status: customer.status === "Paused" ? "Active" : "Paused" } : customer)); showNotice("Customer access status updated."); }
  function removeCustomer(id: string) { const removed = customers.find((customer) => customer.id === id); persistCustomers(customers.filter((customer) => customer.id !== id)); setRemoveId(null); showNotice(`${removed?.name ?? "Customer"} was removed from this admin list.`); }
  function exportWorkspace() {
    const blob = new Blob([JSON.stringify({ customers, preferences, security, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "torres-command-center-workspace.json"; anchor.click(); URL.revokeObjectURL(url); showNotice("Workspace export downloaded.");
  }
  function updatePreference(key: keyof typeof preferences, value: string | boolean) { setPreferences((current) => ({ ...current, [key]: value })); }
  function updateSecurity(key: keyof typeof security, value: boolean) { setSecurity((current) => ({ ...current, [key]: value })); }
  const statusClass = (status: CustomerStatus) => `status-chip status-${status.toLowerCase()}`;

  return (
    <Shell active="Settings">
      <div className="page-heading settings-page-heading"><div><p className="eyebrow">Admin console</p><h1>Settings</h1><p className="lede">Run your company from one place: onboard customers, manage access, personalize their workspace, connect reporting, and keep your team aligned.</p></div><button className="button button-dark" onClick={saveSettings}>{saved ? "Saved" : "Save settings"}</button></div>
      {notice && <p className="success-message settings-notice">{notice}</p>}
      <nav className="settings-nav" aria-label="Settings sections"><a href="#customer-workspace">Customer workspace</a><a href="#admin-console">Admin console</a><a href="#security-roles">Security &amp; roles</a></nav>

      <section className="settings-section" id="customer-workspace"><div className="settings-section-head"><div><p className="eyebrow">Customer workspace</p><h2>Make each account feel personal</h2><p>These details shape the customer-facing workspace, report labels, alerts, and explanations.</p></div></div><div className="settings-grid-2">
        <section className="detail-card"><p className="eyebrow">Profile and preferences</p><h2>Your company defaults</h2><div className="settings-form-grid">{([ ["company", "Company name"], ["industry", "Industry"], ["location", "Primary location"], ["website", "Company website"], ["email", "Admin email"], ["phone", "Admin phone"] ] as const).map(([key, label]) => <label key={key}>{label}<input value={preferences[key]} onChange={(event) => updatePreference(key, event.target.value)} placeholder={label} /></label>)}<BrandSelect label="Timezone" value={preferences.timezone} onChange={(value) => updatePreference("timezone", value)} options={[{ value: "America/Los_Angeles", label: "Pacific Time", description: "Los Angeles and West Coast" }, { value: "America/Denver", label: "Mountain Time", description: "Denver and Mountain region" }, { value: "America/Chicago", label: "Central Time", description: "Dallas and Central region" }, { value: "America/New_York", label: "Eastern Time", description: "New York and East Coast" }]} /><BrandSelect label="Report cadence" value={preferences.cadence} onChange={(value) => updatePreference("cadence", value)} options={[{ value: "Weekly", label: "Weekly", description: "A fresh report every week" }, { value: "Monthly", label: "Monthly", description: "A focused monthly summary" }, { value: "Quarterly", label: "Quarterly", description: "A strategic quarterly review" }]} /></div><div className="settings-list"><label className="toggle-row"><span><strong>Customer profile editing</strong><small>Let customers update their own company contact details.</small></span><input type="checkbox" checked={security.customerEdit} onChange={(event) => updateSecurity("customerEdit", event.target.checked)} /></label><label className="toggle-row"><span><strong>Explain every metric</strong><small>Show plain-language help next to scores, traffic, reviews, and opportunities.</small></span><input type="checkbox" checked={preferences.explanations} onChange={(event) => updatePreference("explanations", event.target.checked)} /></label></div></section>
        <section className="detail-card"><p className="eyebrow">Connections</p><h2>Proof for every business</h2><p className="card-explanation">Connect the services that prove performance. Each connection can power reporting, recommendations, and customer-facing explanations.</p><div className="settings-list"><div><strong>Google Business Profile</strong><span>Reviews, rating, calls, direction requests, and listing health.</span><span className="status-chip status-invited">Ready to connect</span></div><div><strong>Google Analytics + Search Console</strong><span>Traffic, engagement, search clicks, impressions, and queries.</span><span className="status-chip status-invited">Ready to connect</span></div><div><strong>Website health and Cloudflare</strong><span>Uptime, performance, DNS, security, and deployment status.</span><span className="status-chip status-active">Cloudflare connected</span></div></div><Link className="button button-light" href="/integrations/">Open integrations hub</Link></section>
      </div></section>

      <section className="settings-section" id="admin-console"><div className="settings-section-head"><div><p className="eyebrow">Admin console</p><h2>Onboard and manage access</h2><p>Use these tools for the full customer lifecycle, from first invitation through offboarding.</p></div></div><div className="admin-action-grid"><button className="admin-action" onClick={() => setModal("customer")}><span>+</span><strong>Onboard customer</strong><small>Create a customer record and prepare their invite.</small></button><button className="admin-action" onClick={() => setModal("team")}><span>↗</span><strong>Invite team member</strong><small>Add employees with the right role and access level.</small></button><button className="admin-action" onClick={exportWorkspace}><span>↓</span><strong>Export workspace</strong><small>Download a backup of customer and admin settings.</small></button><Link className="admin-action" href="/clients/"><span>◎</span><strong>Manage client records</strong><small>Edit company profiles, contacts, and customer details.</small></Link></div><div className="settings-grid-2">
        <section className="detail-card"><p className="eyebrow">Onboarding checklist</p><h2>Make every launch consistent</h2><div className="onboarding-list">{checklistLabels.map(([title, description], index) => <button className={`onboarding-item ${completed[index] ? "is-complete" : ""}`} key={title} onClick={() => setCompleted((current) => current.map((item, itemIndex) => itemIndex === index ? !item : item))}><span>{completed[index] ? "✓" : index + 1}</span><div><strong>{title}</strong><small>{description}</small></div></button>)}</div></section>
        <section className="detail-card"><p className="eyebrow">Customer access</p><h2>Active accounts</h2><div className="customer-table">{customers.map((customer) => <div className="customer-row" key={customer.id}><div><strong>{customer.name}</strong><small>{customer.email}{customer.phone ? ` · ${customer.phone}` : ""}</small><span className={statusClass(customer.status)}>{customer.status}</span></div><div className="row-actions">{customer.status === "Invited" && <button className="text-button" onClick={() => showNotice(`Invite reminder prepared for ${customer.name}.`)}>Resend invite</button>}<button className="text-button" onClick={() => togglePause(customer.id)}>{customer.status === "Paused" ? "Resume" : "Pause"}</button><button className="text-button danger-text" onClick={() => setRemoveId(customer.id)}>Remove</button></div>{removeId === customer.id && <div className="inline-confirm"><span>Remove this customer from your admin list?</span><button className="text-button danger-text" onClick={() => removeCustomer(customer.id)}>Confirm remove</button><button className="text-button" onClick={() => setRemoveId(null)}>Keep</button></div>}</div>)}</div><p className="info-callout">The controls above manage the workspace list immediately. Permanent account deletion and invitation delivery should be completed through protected Supabase Auth and server-side workflows before launch.</p></section>
      </div></section>

      <section className="settings-section" id="security-roles"><div className="settings-section-head"><div><p className="eyebrow">Security &amp; roles</p><h2>Keep access clear and controlled</h2><p>Use the simplest role model now, then expand it as your staff and customer base grows.</p></div></div><div className="settings-grid-2"><section className="detail-card"><p className="eyebrow">Role guide</p><h2>Who can do what?</h2><div className="role-list"><div><strong>Owner</strong><span>Full control of customers, billing, integrations, team members, and security.</span></div><div><strong>Employee</strong><span>Manage assigned customers and reports without changing owner-level security.</span></div><div><strong>Customer</strong><span>View their own company, reports, connected metrics, contacts, and recommendations.</span></div></div></section><section className="detail-card"><p className="eyebrow">Protection</p><h2>Security controls</h2><div className="settings-list">{([ ["mfa", "Multi-factor authentication", "Require an extra sign-in step for admin accounts."], ["audit", "Activity history", "Keep a record of important access and profile changes."], ["backups", "Workspace backups", "Keep an exportable copy of customer and configuration data."] ] as const).map(([key, title, description]) => <label className="toggle-row" key={key}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={security[key]} onChange={(event) => updateSecurity(key, event.target.checked)} /></label>)}<label className="toggle-row"><span><strong>Email alerts</strong><small>Notify admins when important customer or integration events occur.</small></span><input type="checkbox" checked={preferences.emailAlerts} onChange={(event) => updatePreference("emailAlerts", event.target.checked)} /></label></div></section></div><div className="danger-zone"><div><p className="eyebrow">Danger zone</p><h3>Offboarding policy</h3><p>Review your customer removal process before enabling permanent deletion. Export data, revoke access, and confirm ownership first.</p></div><button className="button button-outline-danger" onClick={() => showNotice("Offboarding review checklist opened.")}>Review policy</button></div></section>

      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}><div className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close dialog" onClick={() => setModal(null)}>×</button>{modal === "customer" ? <><p className="eyebrow">Customer onboarding</p><h2>Add a customer</h2><p className="card-explanation">Start with the company and primary contact. You can finish connections after the record is created.</p><form className="inline-form" onSubmit={addCustomer}><label>Company name<input required value={newCustomer.name} onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })} /></label><label>Primary email<input required type="email" value={newCustomer.email} onChange={(event) => setNewCustomer({ ...newCustomer, email: event.target.value })} /></label><label>Phone number<input value={newCustomer.phone} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} /></label><label>Industry<input value={newCustomer.industry} onChange={(event) => setNewCustomer({ ...newCustomer, industry: event.target.value })} /></label><div className="modal-actions"><button type="button" className="button button-light" onClick={() => setModal(null)}>Cancel</button><button className="button button-dark">Add customer</button></div></form></> : <><p className="eyebrow">Team access</p><h2>Invite a team member</h2><p className="card-explanation">Choose a role now. Secure invitation delivery will be connected through Supabase Auth.</p><form className="inline-form" onSubmit={inviteTeam}><label>Name<input required value={newTeam.name} onChange={(event) => setNewTeam({ ...newTeam, name: event.target.value })} /></label><label>Email<input required type="email" value={newTeam.email} onChange={(event) => setNewTeam({ ...newTeam, email: event.target.value })} /></label><BrandSelect label="Role" value={newTeam.role} onChange={(value) => setNewTeam({ ...newTeam, role: value })} options={[{ value: "Employee", label: "Employee", description: "Manage assigned customer work" }, { value: "Owner", label: "Owner", description: "Full company and security access" }, { value: "Customer success", label: "Customer success", description: "Support customers and reports" }]} /><div className="modal-actions"><button type="button" className="button button-light" onClick={() => setModal(null)}>Cancel</button><button className="button button-dark">Prepare invite</button></div></form></>}</div></div>}
    </Shell>
  );
}
