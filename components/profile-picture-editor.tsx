"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { readStoredSession, storeAuthSession } from "../lib/supabase-auth";

const AVATAR_KEY = "torres-profile-avatar";
const AVATAR_EVENT = "torres-profile-avatar-changed";

export function readProfileAvatar() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(AVATAR_KEY) ?? "";
}

function profileInitials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0].replace(/[._-]+/g, " ");
  return source.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "TC";
}

export function AccountIdentityEditor({ surface = "settings" }: { surface?: "settings" | "portal" }) {
  const [avatar, setAvatar] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const session = readStoredSession();
    setAvatar(readProfileAvatar());
    setFullName(session?.profile.full_name ?? "");
    setEmail(session?.profile.email ?? session?.user.email ?? "");
  }, []);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setNotice("Choose an image file."); return; }
    if (file.size > 2 * 1024 * 1024) { setNotice("Choose an image smaller than 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      window.localStorage.setItem(AVATAR_KEY, value);
      window.dispatchEvent(new Event(AVATAR_EVENT));
      setAvatar(value);
      setNotice("Profile picture updated on this device.");
    };
    reader.readAsDataURL(file);
  }

  function remove() {
    window.localStorage.removeItem(AVATAR_KEY);
    window.dispatchEvent(new Event(AVATAR_EVENT));
    setAvatar("");
    setNotice("Profile picture removed from this device.");
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readStoredSession();
    if (!session?.access_token) { setNotice("Sign in again before updating your name."); return; }
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ fullName }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; profile?: { full_name?: string }; message?: string };
      if (!response.ok || !body.profile?.full_name) throw new Error(body.error || "Your name could not be saved.");
      setFullName(body.profile.full_name);
      storeAuthSession({ ...session, profile: { ...session.profile, full_name: body.profile.full_name } });
      setNotice(body.message || "Your display name was saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Your name could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <section className={`${surface === "portal" ? "portal-card" : "detail-card"} account-identity-card`}>
    <div className="account-identity-heading">
      <div className="profile-picture-preview">{avatar ? <Image src={avatar} alt="Profile preview" width={78} height={78} unoptimized /> : <span>{profileInitials(fullName, email)}</span>}</div>
      <div className="profile-picture-copy"><p className="eyebrow">Your identity</p><h2>Profile name and picture</h2><p>This is the person name shown in the sidebar and account menu. It stays separate from the client or agency name.</p><div className="form-actions"><label className="button button-dark profile-upload">Choose picture<input type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} /></label>{avatar && <button className="button button-outline" type="button" onClick={remove}>Remove</button>}</div></div>
    </div>
    <form className="account-identity-form" onSubmit={saveName}>
      <label>Display name<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" minLength={2} maxLength={120} required /></label>
      <label>Sign-in email<input value={email} type="email" readOnly aria-readonly="true" /></label>
      <button className="button button-dark" type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
    </form>
    <p className="account-identity-note">Your display name is saved securely to your Supabase user profile. The sign-in email and access role cannot be changed here.</p>
    {notice && <small className="form-message" role="status">{notice}</small>}
  </section>;
}

export const ProfilePictureEditor = AccountIdentityEditor;
