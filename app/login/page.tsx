"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestPasswordReset, signInWithPassword } from "../../lib/supabase-auth";

type Role = "client" | "employee" | "owner";

const roleCopy: Record<Role, { label: string; title: string; description: string; action: string }> = {
  client: { label: "Client", title: "Access your company workspace", description: "View your reports, website health, and recommendations.", action: "Continue as client" },
  employee: { label: "Employee", title: "Sign in to your team workspace", description: "Manage the client accounts assigned to you.", action: "Continue as employee" },
  owner: { label: "Owner / Admin", title: "Open the agency command center", description: "Review the full portfolio, team access, and agency settings.", action: "Continue as owner" },
};

export default function LoginPage() {
  const [role, setRole] = useState<Role>("client");
  const [notice, setNotice] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
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
<form onSubmit={async (event) => { event.preventDefault(); setBusy(true); setMessage(""); try { const session = await signInWithPassword(email, password); window.localStorage.setItem("torres-auth-session", JSON.stringify(session)); window.localStorage.setItem("torres-demo-session", role); const returnTo = new URLSearchParams(window.location.search).get("returnTo"); const destination = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"; router.push(destination); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to sign in."); } finally { setBusy(false); } }}>
          <label htmlFor="email">Work email</label>
          <input id="email" type="email" placeholder="you@company.com" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" placeholder="Enter your password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <div className="login-options"><label className="remember"><input type="checkbox" /> <span>Remember me</span></label><button type="button" className="forgot" onClick={async () => { setMessage(""); try { await requestPasswordReset(email); setNotice(true); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to request a password reset."); } }}>Forgot password?</button></div>
          <button className="button button-login" type="submit" disabled={busy}>{busy ? "Signing in…" : current.action}<span>→</span></button>
        </form>
        {notice && <p className="login-notice" role="status">If that email exists, a password-reset link has been sent.</p>}
        {message && <p className="login-notice" role="alert">{message}</p>}
        <p className="login-help">Need an account? <Link href="#">Ask Torres &amp; Co. for an invitation.</Link></p>
      </section>
      <p className="login-footer">Secure access for Torres &amp; Co. Technology</p>
    </main>
  );
}
