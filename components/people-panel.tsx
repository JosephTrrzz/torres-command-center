"use client";

import { useCallback, useEffect, useState } from "react";
import { ClientPerson } from "../lib/types";
import {
  createClientPerson,
  deleteClientPerson,
  fetchClientPeople,
  updateClientPerson,
} from "../lib/supabase-data";

const blank = { name: "", role: "", email: "", phone: "", notes: "" };

export function PeoplePanel({ clientId }: { clientId: string }) {
  const [people, setPeople] = useState<ClientPerson[]>([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<ClientPerson | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("Loading people…");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await fetchClientPeople(clientId);
      setPeople(rows);
      setStatus(rows.length ? "" : "No people added yet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load people.");
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  function closeForm() {
    setEditing(null);
    setForm(blank);
    setOpen(false);
  }

  function edit(person: ClientPerson) {
    setEditing(person);
    setForm({
      name: person.name,
      role: person.role,
      email: person.email,
      phone: person.phone,
      notes: person.notes,
    });
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");

    try {
      if (editing) {
        await updateClientPerson(editing.id, form);
      } else {
        await createClientPerson({ ...form, client_id: clientId });
      }
      closeForm();
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save person.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this person?")) return;
    await deleteClientPerson(id);
    await load();
  }

  return (
    <section className="detail-card people-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Contacts</p>
          <h2>People at this company</h2>
        </div>
        <button
          type="button"
          className="button button-dark"
          onClick={() => {
            if (open) closeForm();
            else setOpen(true);
          }}
        >
          {open ? "Close" : "+ Add person"}
        </button>
      </div>

      {open && (
        <form className="people-form" onSubmit={save}>
          <div className="form-heading">
            <p className="eyebrow">{editing ? "Update contact" : "New contact"}</p>
            <h3>{editing ? "Edit company contact" : "Add company contact"}</h3>
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span>Full name</span>
              <input required placeholder="e.g. Maria Torres" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label className="form-field">
              <span>Role or title</span>
              <input placeholder="e.g. General Manager" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} />
            </label>
            <label className="form-field">
              <span>Email address</span>
              <input type="email" placeholder="name@company.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </label>
            <label className="form-field">
              <span>Phone number</span>
              <input type="tel" placeholder="(555) 555-0123" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </label>
            <label className="form-field form-field-full">
              <span>Notes</span>
              <textarea placeholder="Add responsibilities, preferences, or account notes." value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
          </div>
          <div className="form-actions">
            <button className="button button-dark" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save person" : "Add person"}
            </button>
            <button type="button" className="button button-secondary" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {status && <p className="muted people-status">{status}</p>}
      <div className="people-grid">
        {people.map((person) => (
          <article className="person-card" key={person.id}>
            <span className="client-avatar">
              {person.name
                .split(/\s+/)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <div>
              <h3>{person.name}</h3>
              <p>{person.role || "Company contact"}</p>
              {person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}
              {person.phone && <a href={`tel:${person.phone}`}>{person.phone}</a>}
              {person.notes && <small>{person.notes}</small>}
            </div>
            <div className="person-actions">
              <button type="button" className="text-link" onClick={() => edit(person)}>
                Edit
              </button>
              <button type="button" className="text-link danger-link" onClick={() => void remove(person.id)}>
                Remove
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
