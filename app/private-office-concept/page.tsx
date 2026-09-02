"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./private-office.module.css";

const concepts = [
  ["login", "Client login"],
  ["home", "Client home"],
  ["portfolio", "Portfolio panel"],
  ["internal", "Internal overview"],
  ["project", "Project detail"],
  ["report", "Analytics report"],
  ["mobile", "Mobile home"],
  ["loading", "Loading states"],
] as const;

type ConceptId = (typeof concepts)[number][0];

function Mark({ light = false }: { light?: boolean }) {
  return <Image className={styles.mark} src="/brand/torres-co-monogram.png" alt="Torres & Co." width={48} height={48} unoptimized data-light={light || undefined} />;
}

function Arrow() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 6l4 4-4 4" /></svg>;
}

function ConceptLabel({ children = "Concept preview" }: { children?: string }) {
  return <span className={styles.conceptLabel}>{children}</span>;
}

function ClientNav() {
  return <header className={styles.clientNav}><Mark /><div><strong>Torres OS</strong><span>Private Office</span></div><nav aria-label="Concept navigation"><span>Overview</span><span>Projects</span><span>Performance</span></nav><button type="button">Contact Joseph</button><span className={styles.avatar}>JT</span></header>;
}

function LoginConcept() {
  return <section className={`${styles.screen} ${styles.loginScreen}`} aria-label="Client login concept">
    <div className={styles.loginEditorial}><Mark light /><div><ConceptLabel /><p className={styles.kicker}>Torres OS · Private Office</p><h2>Your business,<br />personally managed.</h2><p>A private workspace for the work, decisions, and performance shaping your business.</p><div className={styles.loginRule}><span /><small>Prepared by Torres &amp; Co.</small></div></div></div>
    <div className={styles.loginForm}><div><p className={styles.kicker}>Secure client access</p><h3>Welcome back.</h3><p>Enter the credentials provided with your invitation.</p><label>Work email<input type="email" placeholder="name@company.com" /></label><label>Password<input type="password" placeholder="Enter your password" /></label><button type="button" className={styles.primaryButton}>Enter Private Office <Arrow /></button><a href="#concept-notes">Need help accessing your account?</a></div></div>
  </section>;
}

function PortfolioPanel({ expanded = false }: { expanded?: boolean }) {
  return <article className={`${styles.portfolioPanel} ${expanded ? styles.portfolioExpanded : ""}`}>
    <div className={styles.portfolioTop}><div><span className={styles.kicker}>Client portfolio</span><h3>Torres &amp; Co. Technology LLC</h3></div><span className={styles.diamond} aria-hidden="true" /></div>
    <div className={styles.portfolioStatus}><span><i /> In good standing</span><small>ORG · TC-0826</small></div>
    <div className={styles.portfolioGrid}><div><span>Client since</span><strong>August 2026</strong></div><div><span>Service plan</span><strong>Managed Technology</strong></div><div><span>Your contact</span><strong>Joseph Torres</strong></div><div><span>Priority support</span><strong>Active</strong></div>{expanded && <><div><span>Active projects</span><strong>1 current engagement</strong></div><div><span>Next review</span><strong>September 15</strong></div></>}</div>
    <div className={styles.portfolioFooter}><span>Managed by Torres &amp; Co.</span><Mark light /></div>
  </article>;
}

function ClientHomeConcept() {
  return <section className={`${styles.screen} ${styles.clientScreen}`} aria-label="Client home concept"><ClientNav /><main className={styles.clientMain}><ConceptLabel>Concept · representative content</ConceptLabel><div className={styles.arrival}><div><p className={styles.kicker}>Tuesday, September 2</p><h2>Good morning,<br />Joseph.</h2><p>Your business at a glance, prepared for today.</p></div><div className={styles.arrivalAside}><span>Portfolio health</span><strong>Current</strong><small>All connected services reporting</small></div></div><div className={styles.homeGrid}><PortfolioPanel /><article className={styles.nextAction}><p className={styles.kicker}>One action for you</p><h3>Review the website launch milestone.</h3><p>The final quality review is ready. Your approval keeps the September launch on schedule.</p><button type="button" className={styles.primaryButton}>Review milestone <Arrow /></button></article></div><section className={styles.chapter}><div><p className={styles.kicker}>What changed</p><h3>Work moved forward while you were away.</h3></div><div className={styles.changeList}><article><span>01</span><div><strong>Website quality review completed</strong><p>Performance and mobile checks are ready.</p></div><small>Today</small></article><article><span>02</span><div><strong>Search visibility increased</strong><p>Four priority pages are now indexed.</p></div><small>This week</small></article></div></section></main></section>;
}

function PortfolioConcept() {
  return <section className={`${styles.screen} ${styles.darkPresentation}`} aria-label="Client portfolio panel concept"><div className={styles.presentationHeader}><Mark light /><span>Torres OS</span><ConceptLabel>Presentation mode</ConceptLabel></div><div className={styles.portfolioStage}><div><p className={styles.kicker}>Business portfolio</p><h2>An account prepared<br />around your business.</h2><p>One clear record of your standing, service relationship, current work, and next review.</p></div><PortfolioPanel expanded /></div><footer><span>Private client workspace</span><button type="button">Return to overview <Arrow /></button></footer></section>;
}

function InternalOverviewConcept() {
  return <section className={`${styles.screen} ${styles.internalScreen}`} aria-label="Internal overview concept"><aside className={styles.internalNav}><Mark light /><div className={styles.internalWorkspace}><small>Agency workspace</small><strong>Torres &amp; Co.</strong></div>{["Today", "Overview", "Clients", "CRM", "Projects", "Operations", "Inbox", "Reports"].map((item) => <span className={item === "Overview" ? styles.selectedNav : ""} key={item}>{item}</span>)}</aside><main className={styles.internalMain}><div className={styles.utilityBar}><span>Torres OS · Internal</span><div><button type="button" aria-label="Search">⌕</button><span className={styles.avatar}>JT</span></div></div><div className={styles.internalContent}><ConceptLabel>Concept · representative content</ConceptLabel><header><div><p className={styles.kicker}>Executive overview</p><h2>Good morning, Joseph.</h2><p>The agency is current. Two items need your attention.</p></div><button type="button" className={styles.primaryButton}>Open priority queue <Arrow /></button></header><section className={styles.operatingBrief}><article className={styles.priorityFeature}><p className={styles.kicker}>Needs attention</p><strong>2</strong><h3>Decisions are waiting.</h3><p>One client milestone and one website lead require a response today.</p></article><div className={styles.briefRows}><article><span>Client portfolio</span><strong>2 current accounts</strong><small>All data boundaries verified</small></article><article><span>Delivery</span><strong>1 active engagement</strong><small>Next milestone due Friday</small></article><article><span>New business</span><strong>1 qualified lead</strong><small>Response due within 4 hours</small></article></div></section><section className={styles.queue}><div><p className={styles.kicker}>Priority queue</p><h3>Move these forward</h3></div><ol><li><span>01</span><div><strong>Approve final website review</strong><small>Torres &amp; Co. Technology · Project</small></div><button type="button"><Arrow /></button></li><li><span>02</span><div><strong>Reply to new website inquiry</strong><small>Unassigned lead · CRM</small></div><button type="button"><Arrow /></button></li></ol></section></div></main></section>;
}

function ProjectConcept() {
  return <section className={`${styles.screen} ${styles.editorialScreen}`} aria-label="Client project detail concept"><ClientNav /><main className={styles.projectMain}><ConceptLabel>Concept · representative content</ConceptLabel><div className={styles.projectTitle}><div><p className={styles.kicker}>Active engagement · 01</p><h2>Website design<br />and launch.</h2><p>A shared view of the work, decisions, and delivery path.</p></div><div className={styles.projectProgress}><strong>78</strong><span>% complete</span><i><b /></i></div></div><div className={styles.projectColumns}><section><p className={styles.kicker}>Current milestone</p><h3>Final quality review</h3><p>Responsive behavior, content accuracy, accessibility, and launch readiness are being checked.</p><div className={styles.projectMeta}><span>Target<strong>September 6</strong></span><span>Owner<strong>Joseph Torres</strong></span></div><button type="button" className={styles.primaryButton}>Review deliverables <Arrow /></button></section><ol className={styles.timeline}><li className={styles.complete}><span>01</span><div><strong>Discovery and direction</strong><small>Completed August 20</small></div></li><li className={styles.complete}><span>02</span><div><strong>Design and development</strong><small>Completed August 29</small></div></li><li className={styles.current}><span>03</span><div><strong>Quality review</strong><small>In progress</small></div></li><li><span>04</span><div><strong>Launch and handoff</strong><small>Scheduled</small></div></li></ol></div></main></section>;
}

function ReportConcept() {
  return <section className={`${styles.screen} ${styles.reportScreen}`} aria-label="Analytics report concept"><div className={styles.reportNav}><Mark /><span>Torres OS · Executive report</span><button type="button">Exit presentation</button></div><main><ConceptLabel>Concept · representative content</ConceptLabel><header><p className={styles.kicker}>Performance review · August 2026</p><h2>Visibility is becoming<br />a business asset.</h2><p>Your connected search and website signals show a stronger foundation than last month.</p></header><section className={styles.reportHero}><div><span>Portfolio health</span><strong>Current</strong><small>Connected services reporting normally</small></div><div className={styles.reportChart}><div className={styles.chartHead}><span>Search visibility</span><strong>Steady improvement</strong></div><svg viewBox="0 0 600 190" role="img" aria-label="Representative upward search visibility trend"><path d="M10 162 C90 150 105 164 174 126 S285 135 344 91 S458 94 590 30" /><path className={styles.chartArea} d="M10 162 C90 150 105 164 174 126 S285 135 344 91 S458 94 590 30 L590 190 L10 190Z" /></svg><div className={styles.chartAxis}><span>Aug 01</span><span>Aug 31</span></div></div></section><div className={styles.reportNarrative}><article><span>01</span><h3>What changed</h3><p>Priority pages gained visibility and the website continued receiving qualified visits.</p></article><article><span>02</span><h3>What matters next</h3><p>Complete the service-page content review before expanding the search program.</p></article><article><span>03</span><h3>Recommended action</h3><p>Approve the September content plan during the next portfolio review.</p></article></div></main></section>;
}

function MobileConcept() {
  return <section className={`${styles.screen} ${styles.mobileStage}`} aria-label="Mobile client home concept"><div><ConceptLabel>390px client home</ConceptLabel><h2>Composed for the hand,<br />not compressed from desktop.</h2><p>Priority, progress, and direct support remain visible without reducing touch targets.</p></div><div className={styles.phone}><header><button type="button" aria-label="Open navigation">☰</button><Mark /><span className={styles.avatar}>JT</span></header><main><p className={styles.kicker}>Private Office</p><h3>Good morning,<br />Joseph.</h3><p>Your business is current.</p><article className={styles.mobileStatus}><span>Portfolio health</span><strong>Current</strong><small>All services reporting</small></article><article className={styles.mobileAction}><p className={styles.kicker}>Next action</p><strong>Review the website launch milestone.</strong><button type="button">Open review <Arrow /></button></article><section><span>Current work</span><strong>Website design and launch</strong><div><i><b /></i><small>78%</small></div></section></main><nav><span>Home</span><span>Projects</span><span>Messages</span><span>Account</span></nav></div></section>;
}

function LoadingConcept() {
  return <section className={`${styles.screen} ${styles.loadingScreen}`} aria-label="Loading and skeleton concepts"><div className={styles.loadingIntro}><ConceptLabel /><p className={styles.kicker}>Loading system</p><h2>Confidence before content.</h2><p>Each placeholder preserves the shape of the workspace that follows. Small requests never receive a full-screen interruption.</p></div><div className={styles.loadingGallery}><article className={styles.darkLoader}><Mark light /><span /><strong>Opening Torres OS</strong><small>Used once after secure entry</small></article><article className={styles.portfolioSkeleton}><div /><span /><span /><section><i /><i /><i /><i /></section></article><article className={styles.chartSkeleton}><span /><strong /><svg viewBox="0 0 320 110" aria-hidden="true"><path d="M0 100 C55 90 70 98 106 68 S190 75 222 39 S278 48 320 8" /></svg></article><article className={styles.listSkeleton}>{[0, 1, 2, 3].map((item) => <div key={item}><i /><span><b /><b /></span></div>)}</article></div></section>;
}

function ActiveConcept({ id }: { id: ConceptId }) {
  if (id === "login") return <LoginConcept />;
  if (id === "home") return <ClientHomeConcept />;
  if (id === "portfolio") return <PortfolioConcept />;
  if (id === "internal") return <InternalOverviewConcept />;
  if (id === "project") return <ProjectConcept />;
  if (id === "report") return <ReportConcept />;
  if (id === "mobile") return <MobileConcept />;
  return <LoadingConcept />;
}

export default function PrivateOfficeConceptPage() {
  const [active, setActive] = useState<ConceptId>("home");
  return <main className={styles.gallery}>
    <header className={styles.galleryHeader}><div><span>Torres OS</span><strong>Private Office concept review</strong></div><p>Direction study · no production data or controls</p></header>
    <nav className={styles.conceptNav} aria-label="Private Office concepts">{concepts.map(([id, label], index) => <button type="button" className={active === id ? styles.activeConcept : ""} aria-pressed={active === id} onClick={() => setActive(id)} key={id}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav>
    <div className={styles.canvas}><ActiveConcept id={active} /></div>
    <footer className={styles.galleryFooter} id="concept-notes"><div><strong>Approval checkpoint</strong><p>This gallery establishes visual direction only. Production routes, permissions, data loading, and client boundaries remain unchanged.</p></div><span>{concepts.find(([id]) => id === active)?.[1]}</span></footer>
  </main>;
}
