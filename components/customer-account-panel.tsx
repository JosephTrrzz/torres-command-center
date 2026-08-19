"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { fetchCustomerAccount, upsertCustomerAccount } from "../lib/supabase-data";
import { BillingStatus, CustomerAccount, PortalStatus } from "../lib/types";

type Props = { clientId: string; clientName: string; defaultEmail?: string };

export function CustomerAccountPanel({ clientId, clientName, defaultEmail = "" }: Props) {
  const [, setAccount] = useState<CustomerAccount | null>(null);
  const [portalEmail, setPortalEmail] = useState(defaultEmail);
  const [billingEmail, setBillingEmail] = useState(defaultEmail);
  const [portalStatus, setPortalStatus] = useState<PortalStatus>("invited");
  const [billingStatus, setBillingStatus] = useState<BillingStatus>("not_connected");
  const [portalEnabled, setPortalEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchCustomerAccount(clientId).then((existing) => {
      if (!active || !existing) return;
      setAccount(existing); setPortalEmail(existing.portal_email); setBillingEmail(existing.billing_email); setPortalStatus(existing.portal_status); setBillingStatus(existing.billing_status); setPortalEnabled(existing.portal_enabled);
    }).catch(() => { if (active) setMessage("Portal setup is ready, but the customer_accounts table still needs to be enabled in Supabase."); });
    return () => { active = false; };
  }, [clientId]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const saved = await upsertCustomerAccount({ client_id: clientId, portal_email: portalEmail.trim(), portal_enabled: portalEnabled, portal_status: portalStatus, billing_email: billingEmail.trim(), billing_status: billingStatus });
      setAccount(saved); setMessage("Customer portal settings saved.");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to save customer portal settings."); }
    finally { setBusy(false); }
  };

  return <section className="detail-card customer-account-panel">
    <div className="section-heading"><div><p className="eyebrow">Customer relationship</p><h2>Portal access & billing</h2><p>Keep {clientName}&apos;s portal, billing contact, and future payment status connected to this business.</p></div><Link className="button button-light" href={`/integrations/?client=${encodeURIComponent(clientId)}`}>Manage connections <span>→</span></Link></div>
    <div className="account-status-grid"><div className="account-status-card" data-state={portalEnabled && portalStatus === "active" ? "ready" : "pending"}><span>Portal</span><strong>{portalEnabled ? portalStatus : "Disabled"}</strong><small>Controls whether the customer can access their private workspace.</small></div><div className="account-status-card" data-state={billingStatus === "active" ? "ready" : "pending"}><span>Billing</span><strong>{billingStatus.replace("_", " ")}</strong><small>Shows Square readiness; card details will stay with Square.</small></div></div>
    <form id="customer-account-form" className="account-form-grid" onSubmit={save}>
      <label>Portal email<input className="field-input" type="email" value={portalEmail} onChange={(event) => setPortalEmail(event.target.value)} placeholder="customer@company.com" required /></label>
      <label>Billing email<input className="field-input" type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} placeholder="billing@company.com" required /></label>
      <label>Portal status<select className="field-input" value={portalStatus} onChange={(event) => setPortalStatus(event.target.value as PortalStatus)}><option value="invited">Invited</option><option value="active">Active</option><option value="paused">Paused</option><option value="revoked">Revoked</option></select></label>
      <label>Billing status<select className="field-input" value={billingStatus} onChange={(event) => setBillingStatus(event.target.value as BillingStatus)}><option value="not_connected">Not connected</option><option value="pending">Pending</option><option value="active">Active</option><option value="past_due">Past due</option><option value="canceled">Canceled</option></select></label>
      <label className="account-toggle full"><input type="checkbox" checked={portalEnabled} onChange={(event) => setPortalEnabled(event.target.checked)} /> Enable customer portal access for this business</label>
    </form>
    <p className="account-help">This record is tied to <strong>{clientName}</strong>. Later, the customer will sign in with this portal email and see only their company. Square should process checkout, invoices, and payment methods; this app stores status and IDs, never card numbers.</p>
    <div className="account-actions"><button className="button button-dark" type="submit" form="customer-account-form" disabled={busy}>{busy ? "Saving…" : "Save portal settings"} <span>→</span></button><Link className="button button-light" href={`/integrations/?client=${encodeURIComponent(clientId)}#square`}>Prepare Square connection</Link><Link className="button button-light" href="/login/?returnTo=/portal/">Customer portal sign-in</Link>{message && <p className="account-message">{message}</p>}{error && <p className="account-message error">{error}</p>}</div>
  </section>;
}
