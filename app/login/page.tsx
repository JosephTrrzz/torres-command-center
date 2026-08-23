"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { canAccessPath, defaultRouteForRole, isSafeReturnTo } from "../../lib/access-control";
import { createAuthSession, requestPasswordReset, storeAuthSession } from "../../lib/supabase-auth";

export default function LoginPage() {
  const [notice, setNotice] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  return (
    <main className="login-page">
      <div className="login-brand"><Image src="/brand/torres-co-wordmark.png" alt="Torres & Co. Technology" width={270} height={106} priority className="login-wordmark" /></div>
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-intro">
          <p className="eyebrow">Command Center</p>
          <h1 id="login-title">Welcome back.</h1>
          <p>Sign in with your work account. Your permissions automatically open the correct workspace.</p>
        </div>
        <div className="login-role-copy"><span className="role-kicker">Secure access</span><h2>One sign-in for every account type</h2><p>Owners, employees, and customers only see the areas assigned to them.</p></div>
<form onSubmit={async (event) => { event.preventDefault(); setBusy(true); setMessage(""); try { const session = await createAuthSession(email, password); storeAuthSession(session); const requestedPath = new URLSearchParams(window.location.search).get("returnTo"); const destination = requestedPath && isSafeReturnTo(requestedPath) && canAccessPath(session.profile.role, requestedPath) ? requestedPath : defaultRouteForRole(session.profile.role); router.replace(destination); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to sign in."); } finally { setBusy(false); } }}>
          <label htmlFor="email">Work email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <div className="login-options"><label className="remember"><input type="checkbox" /> <span>Remember me</span></label><button type="button" className="forgot" onClick={async () => { setMessage(""); try { await requestPasswordReset(email); setNotice(true); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to request a password reset."); } }}>Forgot password?</button></div>
          <button className="button button-login" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}<span>→</span></button>
        </form>
        {notice && <p className="login-notice" role="status">If that email exists, a password-reset link has been sent.</p>}
        {message && <p className="login-notice" role="alert">{message}</p>}
        <p className="login-help">Need an account? <Link href="https://torrescotechnology.com">Ask Torres &amp; Co. for an invitation.</Link></p>
      </section>
      <p className="login-footer">Secure access for Torres &amp; Co. Technology</p>
    </main>
  );
}
