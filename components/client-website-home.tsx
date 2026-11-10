import Link from "next/link";
import styles from "./client-website-home.module.css";

function ExternalArrow() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12" /></svg>;
}

export function ClientWebsiteHome({ name, publicUrl, clientId }: {
  name: string; publicUrl: string | null; clientId: string | null;
}) {
  const editor = "/website/canvas/" + (clientId ? "?client=" + encodeURIComponent(clientId) : "");
  let safeUrl: URL | null = null;
  try {
    const candidate = new URL(publicUrl ?? "");
    if (candidate.protocol === "https:" && !candidate.username && !candidate.password) safeUrl = candidate;
  } catch { /* An invalid address should not prevent access to the draft. */ }
  return <section className={styles.home} aria-labelledby="website-home-title">
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>Your website workspace</p><h1 id="website-home-title">Make it yours.</h1><p>Update your pages, refresh your photos, and keep your website feeling current.</p></div>
      <Link className={styles.primary} href={editor}>Edit website <ExternalArrow /></Link>
    </header>
    <article className={styles.site} aria-label={name}>
      <div className={styles.preview}>
        <div className={styles.previewBar}><span aria-hidden="true">● ● ●</span><span>Website preview</span></div>
        <div className={styles.viewport}><iframe title="Website source preview" src="/website-preview/page-0.html" sandbox="" tabIndex={-1} aria-hidden="true" loading="lazy" /></div>
        <span className={styles.previewLabel}>Source preview · Open the editor to see saved edits</span>
      </div>
      <div className={styles.details}>
        <span className={styles.status}>Private editing enabled</span>
        <h2>{name}</h2>
        {safeUrl && <a className={styles.domain} href={safeUrl.href} target="_blank" rel="noopener noreferrer">{safeUrl.hostname} <ExternalArrow /><span className={styles.srOnly}> (opens in a new tab)</span></a>}
        <p>Your workspace for the details that make your business unique.</p>
        <dl className={styles.facts}><div><dt>Saving</dt><dd>Edits save to your private draft</dd></div><div><dt>Public website</dt><dd>Stays unchanged while you edit</dd></div></dl>
        <Link className={styles.secondary} href={editor}>Open your draft</Link>
      </div>
    </article>
    <section className={styles.guide} aria-labelledby="website-guide-title">
      <div><p className={styles.eyebrow}>A simple place to start</p><h2 id="website-guide-title">Your changes, in context.</h2></div>
      <ol><li><strong>Choose a page</strong><p>Use Pages to move through your website.</p></li><li><strong>Click what you want to change</strong><p>Edit text on the page, replace photos, or adjust a section.</p></li><li><strong>Check your draft</strong><p>Preview desktop and phone layouts. Watch for the saved confirmation before leaving.</p></li></ol>
    </section>
    <aside className={styles.note}><strong>Private until published.</strong><p>Saving a draft does not update your public website. Publishing is a separate step managed with Torres &amp; Co.</p></aside>
  </section>;
}
