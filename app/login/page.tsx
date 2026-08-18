"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";

type Role = "client" | "employee" | "owner";

const roleCopy: Record<Role, { label: string; title: string; description: string; action: string }> = {
  client: { label: "Client", title: "Access your company workspace", description: "View your reports, website health, and recommendations.", action: "Continue as client" },
  employee: { label: "Employee", title: "Sign in to your team workspace", description: "Manage the client accounts assigned to you.", action: "Continue as employee" },
  owner: { label: "Owner / Admin", title: "Open the agency command center", description: "Review the full portfolio, team access, and agency settings.", action: "Continue as owner" },
};

export default function LoginPage() {
  const [role, setRole] = useState<Role>("client");
  const [notice, setNotice] = useState(false);
  const current = roleCopy[role];

  return (
    <main className="login-page">
      <div className="login-brand"><Image src="/brand/torres-co-wordmark.png" alt="Torres & Co. Technology" width={270} height={106} priority className="login-wordmark" /></div>
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-intro">
          <p className="eyebrow">Command Center</p>
          <h1 id="login-title">Welcome back.</h1>
          <p>Choose how you’re accessing the Torres &amp; Co. workspace.</p>
        </div>
        <div className="role-tabs" role="tablist" aria-label="Account type">
          {(Object.keys(roleCopy) as Role[]).map((item) => <button key={item} role="tab" aria-selected={role === item} className={role === item ? "selected" : ""} onClick={() => { setRole(item); setNotice(false); }}>{roleCopy[item].label}</button>)}
        </div>
        <div className="login-role-copy"><span className="role-kicker">{current.label}</span><h2>{current.title}</h2><p>{current.description}</p></div>
        <form onSubmit={(event) => { event.preventDefault(); setNotice(true); }}>
          <label htmlFor="email">Work email</label>
          <input id="email" type="email" placeholder="you@company.com" autoComplete="email" required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" placeholder="Enter your password" autoComplete="current-password" required />
          <div className="login-options"><label className="remember"><input type="checkbox" /> <span>Remember me</span></label><button type="button" className="forgot" onClick={() => setNotice(true)}>Forgot password?</button></div>
          <button className="button button-login" type="submit">{current.action}<span>→</span></button>
        </form>
        {notice && <p className="login-notice" role="status">Authentication will be connected in the next setup step. Your information has not been submitted.</p>}
        <p className="login-help">Need an account? <Link href="#">Ask Torres &amp; Co. for an invitation.</Link></p>
      </section>
      <p className="login-footer">Secure access for Torres &amp; Co. Technology</p>
    </main>
  );
}
