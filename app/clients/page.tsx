"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClientCard } from "../../components/client-card";
import { Shell } from "../../components/shell";
import { fetchClients, updateClient } from "../../lib/supabase-data";
import { readStoredSession } from "../../lib/supabase-auth";
import { ClientDetail } from "../../lib/types";

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientDetail[]>([]);
  const [message, setMessage] = useState("Loading connected clients…");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ClientDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [onboarding, setOnboarding] = useState<ClientDetail | null>(null);
  const [activationBusyId, setActivationBusyId] = useState("");
  const [activationSent, setActivationSent] = useState<Record<string, boolean>>({});
  const [activationLink, setActivationLink] = useState("");

  useEffect(() => {
    fetchClients()
      .then((rows) => {
        setClients(rows);
        setMessage(rows.length ? "Connected to Supabase" : "No clients added yet");
      })
      .catch(() => setMessage("Unable to load live client records. Check the Supabase connection."));
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const input = {
        name: String(form.get("name")),
        industry: String(form.get("industry")),
        location: String(form.get("location")),
        website: String(form.get("website")),
        email: String(form.get("email")),
        phone: String(form.get("phone")),
        health_score: Number(form.get("health_score") || 0),
      };

      if (editing) {
        const result = await updateClient(editing.id, input);
        setMessage(result.message || "Client updated successfully in Supabase");
      } else {
        const session = readStoredSession();
        if (!session) throw new Error("Sign in again before creating a client.");
        const createResponse = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(input) });
        const createBody = await createResponse.json().catch(() => ({})) as { client?: { id?: string }; message?: string; error?: string };
        if (!createResponse.ok || !createBody.client?.id) throw new Error(createBody.error || "The client workspace could not be created.");
        setMessage(createBody.message || "Client workspace created successfully");
        const row = createBody.client;
        if (row?.id) {
          const inviteResponse = await fetch("/api/admin/customer-invite", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` }, body: JSON.stringify({ clientId: row.id, email: input.email, fullName: input.name }) });
          const inviteBody = await inviteResponse.json().catch(() => ({}));
          if (!inviteResponse.ok) throw new Error(inviteBody.error || "Client was created, but the portal invitation could not be prepared.");
          setMessage(inviteBody.message || "Client and portal invitation created successfully");
          setOnboarding({
          id: row.id, name: input.name, initials: input.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
          industry: input.industry, location: input.location, website: input.website, email: input.email, phone: input.phone,
          health: input.health_score, status: input.health_score >= 80 ? "healthy" : "watch", owner: "Joseph Torres", services: [], lastUpdated: "Today",
          overview: "Client profile connected to the Torres & Co. Command Center.", traffic: [], opportunities: [],
          metrics: [{ label: "Health score", value: String(input.health_score), change: "—", trend: "flat" }],
          });
        }
      }

      closeForm();
      setClients(await fetchClients());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save client.");
    } finally {
      setBusy(false);
    }
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setError("");
  }

  function openCreate() {
    setEditing(null);
    setError("");
    setShowForm((value) => !value);
  }

  function openEdit(client: ClientDetail) {
    setEditing(client);
    setShowForm(true);
    setError("");
  }

  async function sendActivation(client: ClientDetail) {
    const session = readStoredSession();
    setActivationBusyId(client.id);
    setError("");
    setActivationLink("");
    try {
      const response = await fetch("/api/admin/customer-invite", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` }, body: JSON.stringify({ clientId: client.id, resend: true }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to prepare an activation link.");
      setActivationSent((current) => ({ ...current, [client.id]: true }));
      if (typeof body.activationLink === "string") setActivationLink(body.activationLink);
      setMessage(body.message || "Activation link prepared.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to prepare an activation link.");
    } finally {
      setActivationBusyId("");
    }
  }

  return (
    <Shell active="Clients">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Clients</h1>
          <p className="lede">A clear, current view of every account you manage.</p>
          <small className="updated">{message}</small>
        </div>
        <button className="button button-dark" type="button" onClick={openCreate}>
          + Add client
        </button>
      </div>

      {showForm && (
        <form className="detail-card client-form" onSubmit={submit}>
          <div className="form-heading">
            <p className="eyebrow">{editing ? "Update account" : "New account"}</p>
            <h2>{editing ? `Edit ${editing.name}` : "Add a client"}</h2>
            <p>Keep the company profile accurate so reports, contacts, and integrations stay organized.</p>
          </div>

          <div className="form-grid">
            <label className="form-field">
              <span>Business name</span>
              <input name="name" defaultValue={editing?.name} autoComplete="organization" required />
            </label>
            <label className="form-field">
              <span>Industry</span>
              <input name="industry" defaultValue={editing?.industry} required />
            </label>
            <label className="form-field">
              <span>Contact email</span>
              <input name="email" type="email" defaultValue={editing?.email} autoComplete="email" required />
            </label>
            <label className="form-field">
              <span>Phone number</span>
              <input name="phone" type="tel" defaultValue={editing?.phone} autoComplete="tel" required />
            </label>
            <label className="form-field">
              <span>Location</span>
              <input name="location" defaultValue={editing?.location} autoComplete="address-level2" />
            </label>
            <label className="form-field">
              <span>Website</span>
              <input name="website" defaultValue={editing?.website} autoComplete="url" />
            </label>
            <label className="form-field">
              <span>Health score</span>
              <input name="health_score" type="number" min="0" max="100" defaultValue={editing?.health} />
            </label>
          </div>

          {error && <p className="login-notice error">{error}</p>}
          <div className="form-actions">
            <button className="button button-dark" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Save client"}
            </button>
            <button className="button button-secondary" type="button" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {onboarding && <section className="detail-card onboarding-next" aria-live="polite">
        <div><p className="eyebrow">Next step</p><h2>{onboarding.name} is ready for activation.</h2><p>The client record is saved. Send the client their activation email, then prepare integrations and preview the portal from this workspace.</p></div>
        <div className="form-actions"><Link className="button button-dark" href={`/clients/detail/?id=${encodeURIComponent(onboarding.id)}`}>Open client account <span>→</span></Link><Link className="button button-light" href={`/integrations/?client=${encodeURIComponent(onboarding.id)}`}>Prepare integrations <span>→</span></Link>{onboarding.website && <a className="button button-outline" href={onboarding.website.startsWith("http") ? onboarding.website : `https://${onboarding.website}`} target="_blank" rel="noreferrer">Open client site ↗</a>}</div>
      </section>}

      {activationLink && <section className="detail-card activation-link-card" aria-live="polite"><div><p className="eyebrow">Activation link ready</p><h2>Send this secure link to the client</h2><p>The link signs the client in and activates their assigned portal. Treat it like a password and share it privately.</p></div><div className="activation-link-row"><input aria-label="Client activation link" readOnly value={activationLink} /><button className="button button-dark" type="button" onClick={() => void navigator.clipboard?.writeText(activationLink)}>Copy link</button></div></section>}

      <section className="client-grid client-grid-wide">
        {clients.map((client) => (
          <article className="client-account-card" key={client.id}>
            <ClientCard client={client} />
            <div className="client-account-actions">
              <Link className="client-account-primary" href={`/clients/detail/?id=${encodeURIComponent(client.id)}`}>
                <span><small>Account workspace</small>Manage client</span><b>→</b>
              </Link>
              <div className="client-account-action-grid">
                <button className="client-account-action" type="button" onClick={() => openEdit(client)}><span>Edit profile</span><b>→</b></button>
                <Link className="client-account-action" href={`/onboarding/?client=${encodeURIComponent(client.id)}`}><span>Onboarding</span><b>→</b></Link>
                <button className="client-account-action" type="button" onClick={() => void sendActivation(client)} disabled={activationBusyId === client.id}><span>{activationBusyId === client.id ? "Preparing…" : activationSent[client.id] ? "Resend activation" : "Send activation"}</span><b>→</b></button>
                <Link className="client-account-action" href={`/portal/?previewClient=${encodeURIComponent(client.id)}`}><span>Preview portal</span><b>→</b></Link>
              </div>
            </div>
          </article>
        ))}
      </section>
    </Shell>
  );
}
