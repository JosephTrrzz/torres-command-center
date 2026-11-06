"use client";

import { useEffect, useState } from "react";
import { Shell } from "../../components/shell";
import { AUTH_SESSION_EVENT, readStoredSession } from "../../lib/supabase-auth";
import { maxPhotoBytes, originalIntro, validIntro, type WebsiteIntro } from "../../lib/website-editor";
import "./website.css";

async function editorRequest(payload?: object) {
  const session = readStoredSession();
  if (!session) throw new Error("Sign in to edit your website.");
  const response = await fetch("/api/website/editor", {
    method: payload ? "POST" : "GET", cache: "no-store",
    headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Website editing is unavailable.");
  return result as { intro: WebsiteIntro; revision: number };
}

export default function WebsitePage() {
  const [intro, setIntro] = useState(originalIntro);
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Opening the website editor…");
  useEffect(() => {
    let current = true;
    const reset = () => window.location.reload();
    window.addEventListener(AUTH_SESSION_EVENT, reset);
    editorRequest().then(result => {
      if (current) { setIntro(result.intro); setRevision(result.revision); setNotice(""); }
    }).catch(error => { if (current) setNotice(error.message); });
    return () => { current = false; window.removeEventListener(AUTH_SESSION_EVENT, reset); };
  }, []);
  function update(key: keyof WebsiteIntro, value: string) {
    setIntro(previous => ({ ...previous, [key]: value }));
    setNotice("Unsaved changes");
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > maxPhotoBytes || !["image/png","image/jpeg","image/webp"].includes(file.type)) {
      setNotice("Choose a PNG, JPEG, or WebP image up to 512 KB."); return;
    }
    setBusy(true);
    const reader = new FileReader();
    reader.onload = () => update("photo", String(reader.result));
    reader.onerror = () => setNotice("This image could not be opened.");
    reader.onloadend = () => setBusy(false);
    reader.readAsDataURL(file);
  }
  async function save(action: "save" | "publish") {
    if (!validIntro(intro)) { setNotice("Enter a headline, description, and alternative text for an uploaded image."); return; }
    setBusy(true);
    try {
      const result = await editorRequest({ revision, action, intro });
      setRevision(result.revision);
      setNotice(action === "save" ? "Draft saved." : "Homepage introduction published.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <Shell active="Website"><header className="page-heading"><div><h1>Website</h1><p>torrescotechnology.com</p></div></header>
    <p role="status">{notice}</p>
    {revision !== null && <div className="site-editor">
      <fieldset disabled={busy} className="detail-card"><legend>Home · Introduction</legend>
        <label>Headline<input value={intro.heading} maxLength={100} onChange={e => update("heading", e.target.value)} /></label>
        <label>Emphasis<input value={intro.emphasis} maxLength={100} onChange={e => update("emphasis", e.target.value)} /></label>
        <label>Description<textarea value={intro.description} maxLength={600} onChange={e => update("description", e.target.value)} /></label>
        <label>Feature image · up to 512 KB<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files?.[0])} /></label>
        {intro.photo && <><label>Image description<input value={intro.alt} maxLength={180} onChange={e => update("alt", e.target.value)} /></label><button type="button" className="text-link" onClick={() => update("photo", "")}>Remove image</button></>}
        <div className="site-editor-actions"><button className="button button-light" onClick={() => void save("save")}>Save draft</button><button className="button button-dark" onClick={() => void save("publish")}>Publish to website</button></div>
      </fieldset>
      <section className="site-editor-preview" aria-label="Homepage introduction preview"><small>Homepage preview</small><h2>{intro.heading} <em>{intro.emphasis}</em></h2><p>{intro.description}</p>{intro.photo && <img src={intro.photo} alt={intro.alt} />}</section>
    </div>}
  </Shell>;
}
