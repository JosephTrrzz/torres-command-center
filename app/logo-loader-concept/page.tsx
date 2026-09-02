"use client";

import { useState } from "react";
import { AppEntryTransition, TorresLogoLoader } from "../../components/loading-system";
import styles from "./logo-loader.module.css";

type Variant = "dark" | "light";
type Size = "small" | "medium" | "large";

const sizes: Size[] = ["small", "medium", "large"];

function ShellPreview() {
  return (
    <div className={styles.shellPreview}>
      <aside>
        <span className={styles.shellMark}>T&amp;</span>
        <i />
        <i />
        <i />
        <i />
      </aside>
      <main>
        <p>Private Office</p>
        <h2>Welcome back, Joseph.</h2>
        <div className={styles.shellGrid}>
          <article><span /><strong /><i /></article>
          <article><span /><strong /><i /></article>
          <article><span /><strong /><i /></article>
        </div>
      </main>
    </div>
  );
}

export default function LogoLoaderConceptPage() {
  const [variant, setVariant] = useState<Variant>("dark");
  const [size, setSize] = useState<Size>("large");
  const [run, setRun] = useState(0);
  const [ready, setReady] = useState(false);

  function replay() {
    setReady(false);
    setRun((current) => current + 1);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Torres OS · Motion study</p>
          <h1>Signature logo-fill loader</h1>
        </div>
        <span>Approved system · active on first secure entry</span>
      </header>

      <section className={styles.controls} aria-label="Loader preview controls">
        <fieldset>
          <legend>Appearance</legend>
          <div>
            {(["dark", "light"] as Variant[]).map((option) => (
              <button aria-pressed={variant === option} key={option} onClick={() => setVariant(option)} type="button">{option}</button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Scale</legend>
          <div>
            {sizes.map((option) => (
              <button aria-pressed={size === option} key={option} onClick={() => setSize(option)} type="button">{option}</button>
            ))}
          </div>
        </fieldset>
        <div className={styles.actions}>
          <button className={styles.secondary} onClick={replay} type="button">Replay fill</button>
          <button className={styles.primary} onClick={() => setReady(true)} type="button">Complete and reveal</button>
        </div>
      </section>

      <section className={`${styles.stage} ${styles[variant]}`} aria-label={`${variant} loader preview`}>
        <TorresLogoLoader key={`${run}-${variant}-${size}`} size={size} status="Loading Torres OS" variant={variant} />
      </section>

      <section className={styles.explanation}>
        <article>
          <span>01</span>
          <h2>One composed sequence</h2>
          <p>A platinum outline resolves into the authentic Torres blue, followed by the gold detail and one controlled light pass. The mark then rests without looping.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Content always wins</h2>
          <p>When initialization finishes, the loader releases in one clean upward pass while the ready workspace rises into place beneath it. Slow operations settle into a calm full-color hold instead of replaying.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Reserved for arrival</h2>
          <p>Use it for first secure entry and major workspace initialization. Navigation, filtering, saving, and background refreshes keep their compact indicators.</p>
        </article>
      </section>

      <section className={styles.transitionDemo}>
        <div className={styles.transitionCopy}>
          <p>Application handoff</p>
          <h2>Loader to workspace, in one composed upward reveal.</h2>
          <p>The frame holds its geometry while content becomes ready. Use the control above to reveal this internal-shell study.</p>
          <button className={styles.secondary} onClick={replay} type="button">Reset handoff</button>
        </div>
        <div className={styles.transitionFrame}>
          <AppEntryTransition key={run} ready={ready} status="Preparing your private office" variant="dark">
            <ShellPreview />
          </AppEntryTransition>
        </div>
      </section>

      <section className={styles.accessibility}>
        <TorresLogoLoader reducedMotion size="small" status="Reduced-motion preview" variant="light" />
        <div>
          <p>Reduced motion</p>
          <h2>Same identity, quieter arrival.</h2>
          <span>The fill becomes a short opacity change, the light pass is removed, and loading meaning remains available to assistive technology.</span>
        </div>
      </section>
    </main>
  );
}
