"use client";

import { useEffect, useState } from "react";
import { ClientCard } from "../../components/client-card";
import { Shell } from "../../components/shell";
import { clients as demoClients } from "../../lib/demo-data";
import { createClient, fetchClients, updateClient } from "../../lib/supabase-data";
import { ClientDetail } from "../../lib/types";

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientDetail[]>(demoClients);
  const [message, setMessage] = useState("Loading connected clients…");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ClientDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchClients()
      .then((rows) => {
        setClients(rows);
        setMessage(rows.length ? "Connected to Supabase" : "No clients added yet");
      })
      .catch(() => setMessage("Showing demo clients until Supabase access is configured."));
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
        await updateClient(editing.id, input);
        setMessage("Client updated successfully");
      } else {
        await createClient(input);
        setMessage("Client added successfully");
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
              <input name="name" defaultValue={editing?.name} placeholder="Example Company" autoComplete="organization" required />
            </label>
            <label className="form-field">
              <span>Industry</span>
              <input name="industry" defaultValue={editing?.industry} placeholder="HVAC services" required />
            </label>
            <label className="form-field">
              <span>Contact email</span>
              <input name="email" type="email" defaultValue={editing?.email} placeholder="owner@example.com" autoComplete="email" required />
            </label>
            <label className="form-field">
              <span>Phone number</span>
              <input name="phone" type="tel" defaultValue={editing?.phone} placeholder="(555) 555-0123" autoComplete="tel" required />
            </label>
            <label className="form-field">
              <span>Location</span>
              <input name="location" defaultValue={editing?.location} placeholder="City, State" autoComplete="address-level2" />
            </label>
            <label className="form-field">
              <span>Website</span>
              <input name="website" defaultValue={editing?.website} placeholder="example.com" autoComplete="url" />
            </label>
            <label className="form-field">
              <span>Health score</span>
              <input name="health_score" type="number" min="0" max="100" defaultValue={editing?.health} placeholder="0–100" />
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

      <section className="client-grid client-grid-wide">
        {clients.map((client) => (
          <div key={client.id}>
            <ClientCard client={client} />
            <button className="text-link" type="button" onClick={() => openEdit(client)}>
              Edit client →
            </button>
          </div>
        ))}
      </section>
    </Shell>
  );
}
