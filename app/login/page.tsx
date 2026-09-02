"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { appRoleForOrganizationRole, canAccessPath, defaultRouteForRole, isSafeReturnTo } from "../../lib/access-control";
import { createAuthSession, createAuthSessionFromTokens, requestPasswordReset, storeAuthSession } from "../../lib/supabase-auth";
import { BrandedAppLoader, markSignatureEntrySeen } from "../../components/loading-system";

export default function LoginPage() {
  const [notice, setNotice] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteSession, setInviteSession] = useState<{ access_token: string; refresh_token?: string; expires_at?: number; user: { id: string; email?: string } } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const linkType = hash.get("type");
    if (!accessToken || !["invite", "magiclink"].includes(linkType || "")) return;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) { setMessage("Account activation is not configured."); return; }
    void fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("This activation link has expired. Ask Torres & Co. to send a new one.");
        const user = await response.json() as { id?: string; email?: string };
        if (!user.id) throw new Error("This activation link is incomplete. Ask Torres & Co. to send a new one.");
        setEmail(user.email || "");
        setInviteSession({ access_token: accessToken, refresh_token: hash.get("refresh_token") || undefined, expires_at: Number(hash.get("expires_at") || 0) || undefined, user: { id: user.id, email: user.email } });
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to open this activation link."));
  }, []);

  async function activateAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inviteSession) return;
    const form = new FormData(event.currentTarget);
    const nextPassword = String(form.get("new_password") || "");
    const confirmPassword = String(form.get("confirm_password") || "");
    if (nextPassword.length < 8) { setMessage("Choose a password with at least 8 characters."); return; }
    if (nextPassword !== confirmPassword) { setMessage("The passwords do not match."); return; }
    setBusy(true); setMessage("");
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) throw new Error("Account activation is not configured.");
      const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, { method: "PUT", headers: { apikey: supabaseKey, Authorization: `Bearer ${inviteSession.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ password: nextPassword }) });
      if (!response.ok) throw new Error("Unable to finish activation. Ask Torres & Co. to send a new link.");
      const acceptanceResponse = await fetch("/api/invitation-accept", { method: "POST", headers: { Authorization: `Bearer ${inviteSession.access_token}` } });
      const acceptanceBody = await acceptanceResponse.json().catch(() => ({})) as { error?: string };
      if (!acceptanceResponse.ok) throw new Error(acceptanceBody.error || "Your organization invitation could not be activated.");
      const session = await createAuthSessionFromTokens(inviteSession.access_token, inviteSession.refresh_token, inviteSession.expires_at, inviteSession.user);
      storeAuthSession(session);
      await fetch("/api/customer-activate", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
      markSignatureEntrySeen();
      router.replace(defaultRouteForRole(appRoleForOrganizationRole(session.organization?.role, session.profile.role)));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to activate your portal."); setBusy(false); }
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const session = await createAuthSession(email, password);
      storeAuthSession(session);
      const effectiveRole = appRoleForOrganizationRole(session.organization?.role, session.profile.role);
      const requestedPath = new URLSearchParams(window.location.search).get("returnTo");
      const destination = requestedPath && isSafeReturnTo(requestedPath) && canAccessPath(effectiveRole, requestedPath) ? requestedPath : defaultRouteForRole(effectiveRole);
      markSignatureEntrySeen();
      router.replace(destination);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in.");
      setBusy(false);
    }
  }

  if (busy) return <BrandedAppLoader animate label={inviteSession ? "Activating your private workspace" : "Verifying secure access"} />;

  return (
    <main className="login-page">
      <div className="login-private-office-layout">
      <section className="login-private-office-intro" aria-label="Torres Private Office">
        <div className="login-brand"><Image src="/brand/torres-co-wordmark.png" alt="Torres & Co. Technology" width={270} height={106} priority className="login-wordmark" /></div>
        <div><p className="private-office-kicker">Private Office</p><h2>Your business,<br />composed.</h2><p>One secure entrance to your projects, service record, conversations, account details, and connected performance.</p></div>
        <footer><span>Private client access</span><span>Protected workspace</span></footer>
      </section>
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-intro">
          <p className="eyebrow">Private Office access</p>
          <h1 id="login-title">Welcome back.</h1>
          <p>Sign in with your work account. Your permissions automatically open the correct workspace.</p>
        </div>
        <div className="login-role-copy"><span className="role-kicker">Secure access</span><h2>One sign-in for every account type</h2><p>Owners, employees, and customers only see the areas assigned to them.</p></div>
        {inviteSession ? <form onSubmit={activateAccount}>
          <p className="eyebrow">Account activation</p><h2>Activate your workspace.</h2><p className="login-role-copy">Create your password to open the private workspace assigned to {email}.</p>
          <label htmlFor="new_password">Create password</label><input id="new_password" name="new_password" type="password" autoComplete="new-password" minLength={8} required />
          <label htmlFor="confirm_password">Confirm password</label><input id="confirm_password" name="confirm_password" type="password" autoComplete="new-password" minLength={8} required />
          <button className="button button-login" type="submit" disabled={busy}>{busy ? "Activating…" : "Activate account"}<span>→︎</span></button>
        </form> : <form onSubmit={signIn}>
          <label htmlFor="email">Work email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <div className="login-options"><label className="remember"><input type="checkbox" /> <span>Remember me</span></label><button type="button" className="forgot" onClick={async () => { setMessage(""); try { await requestPasswordReset(email); setNotice(true); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to request a password reset."); } }}>Forgot password?</button></div>
          <button className="button button-login" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}<span>→︎</span></button>
        </form>}
        {notice && <p className="login-notice" role="status">If that email exists, a password-reset link has been sent.</p>}
        {message && <p className="login-notice" role="alert">{message}</p>}
        <p className="login-help">Need an account? <Link href="https://torrescotechnology.com">Ask Torres &amp; Co. for an invitation.</Link></p>
      </section>
      </div>
      <p className="login-footer">Secure access for Torres &amp; Co. Technology</p>
    </main>
  );
}
