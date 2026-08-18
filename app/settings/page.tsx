"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "../../components/shell";

export default function SettingsPage() {
  const [compact, setCompact] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setCompact(window.localStorage.getItem("torres-compact-view") === "true"), []);
  function save() {
    window.localStorage.setItem("torres-compact-view", String(compact));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  return <Shell active="Settings"><div className="page-heading"><div><p className="eyebrow">Workspace</p><h1>Settings</h1><p className="lede">Manage your Command Center preferences.</p></div><button className="button button-dark" onClick={save}>Save settings</button></div><div className="settings-grid"><section className="detail-card"><p className="eyebrow">Appearance</p><h2>Workspace preferences</h2><label className="toggle-row"><span><strong>Compact client cards</strong><small>Use a tighter grid for larger portfolios.</small></span><input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} /></label>{saved && <p className="success-message">Settings saved.</p>}</section><section className="detail-card"><p className="eyebrow">Account</p><h2>Workspace access</h2><p>Owner access is active for Joseph Torres. Customer and employee roles can be added as authentication expands.</p><Link className="text-link" href="/clients/">Manage client accounts →</Link></section></div></Shell>;
}
