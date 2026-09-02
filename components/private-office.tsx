import Link from "next/link";

type PortfolioPanelProps = {
  businessName: string;
  clientSince?: string;
  servicePlan?: string;
  accountStatus: string;
  contact: string;
  recordId?: string;
};

function formatClientSince(value?: string) {
  if (!value) return "Private client record";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Private client record";
  return `Client since ${new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date)}`;
}

export function PrivateOfficePortfolioPanel({ businessName, clientSince, servicePlan, accountStatus, contact, recordId }: PortfolioPanelProps) {
  return <section className="private-office-portfolio" aria-label="Client portfolio summary">
    <div className="private-office-portfolio-top">
      <div><span className="private-office-kicker">Client portfolio</span><h2>{businessName}</h2></div>
      <span className="private-office-diamond" aria-hidden="true" />
    </div>
    <div className="private-office-status"><span><i aria-hidden="true" />{accountStatus}</span><small>{formatClientSince(clientSince)}</small></div>
    <dl className="private-office-portfolio-details">
      <div><dt>Relationship</dt><dd>{servicePlan || "Managed technology services"}</dd></div>
      <div><dt>Primary contact</dt><dd>{contact || "Not yet set"}</dd></div>
      <div><dt>Workspace</dt><dd>Private access</dd></div>
      <div><dt>Record</dt><dd>{recordId ? recordId.slice(0, 8).toUpperCase() : "Private"}</dd></div>
    </dl>
    <footer><span>Torres &amp; Co. Private Office</span><span className="private-office-monogram" aria-hidden="true">T</span></footer>
  </section>;
}

export function PrivateOfficeNextAction({ href, eyebrow, title, description, label }: { href: string; eyebrow: string; title: string; description: string; label: string }) {
  return <section className="private-office-next-action">
    <span className="private-office-kicker">{eyebrow}</span>
    <h2>{title}</h2>
    <p>{description}</p>
    <Link href={href}>{label}<span aria-hidden="true" className="custom-arrow">→︎</span></Link>
  </section>;
}
