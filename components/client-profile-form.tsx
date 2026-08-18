"use client";

import { FormEvent, useState } from "react";
import { updateClient } from "../lib/supabase-data";
import { ClientDetail } from "../lib/types";

type ProfileFields = Pick<ClientDetail, "name" | "industry" | "location" | "website" | "email" | "phone">;

export function ClientProfileForm({ client, onSaved }: { client: ClientDetail; onSaved: (fields: ProfileFields) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<ProfileFields>({
    name: client.name,
    industry: client.industry,
    location: client.location,
    website: client.website,
    email: client.email ?? "",
    phone: client.phone ?? "",
  });

  const change = (field: keyof ProfileFields, value: string) => setForm((current) => ({ ...current, [field]: value }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await updateClient(client.id, form);
      onSaved(form);
      setMessage("Profile saved.");
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save this profile.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="detail-card profile-editor">
    <div className="section-heading"><div><p className="eyebrow">Business profile</p><h2>Contact and account details</h2></div><button className="button button-outline" onClick={() => setOpen((value) => !value)}>{open ? "Close editor" : "Edit profile"}</button></div>
    {!open && <p className="profile-summary">Keep the company name, phone number, email, website, and location current for reports and customer communication.</p>}
    {open && <form className="profile-form" onSubmit={save}>
      <div className="form-grid">
        <label>Company name<input value={form.name} onChange={(event) => change("name", event.target.value)} required /></label>
        <label>Industry<input value={form.industry} onChange={(event) => change("industry", event.target.value)} required /></label>
        <label>Location<input value={form.location} onChange={(event) => change("location", event.target.value)} required /></label>
        <label>Website<input type="url" placeholder="https://example.com" value={form.website} onChange={(event) => change("website", event.target.value)} required /></label>
        <label>Email<input type="email" placeholder="hello@example.com" value={form.email ?? ""} onChange={(event) => change("email", event.target.value)} /></label>
        <label>Phone number<input type="tel" placeholder="(555) 555-5555" value={form.phone ?? ""} onChange={(event) => change("phone", event.target.value)} /></label>
      </div>
      <div className="form-actions"><button className="button button-dark" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button><button type="button" className="button button-outline" onClick={() => setOpen(false)}>Cancel</button></div>
      {message && <small className="form-message" role="status">{message}</small>}
    </form>}
  </section>;
}
