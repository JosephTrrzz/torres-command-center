import Link from "next/link";
import { ClientSummary } from "../lib/types";

export function ClientCard({ client }: { client: ClientSummary & { website?: string } }) {
  const website = client.website?.trim();
  const websiteHref = website ? (website.startsWith("http") ? website : `https://${website}`) : null;
  const statusLabel = client.status === "healthy" ? "Active" : client.status === "watch" ? "Monitor" : "Needs attention";
  return <div className="client-card-wrap">
    <Link href={`/clients/detail/?id=${encodeURIComponent(client.id)}`} className="client-card">
      <div className="client-card-top">
        <span className="client-avatar">{client.initials}</span>
        <span className="client-card-status"><span className={`status-dot ${client.status}`} aria-hidden="true" />{statusLabel}</span>
      </div>
      <h3>{client.name}</h3><p>{client.industry} · {client.location}</p>
      <div className="health-row"><span>Health score</span><strong>{client.health}</strong></div>
      <div className="health-track"><span style={{width:`${client.health}%`}} /></div>
      <div className="card-footer"><span>Last updated</span><strong>{client.lastUpdated}</strong></div>
    </Link>
    {websiteHref ? <a className="client-site-link" href={websiteHref} target="_blank" rel="noreferrer">Open client site <span>↗</span></a> : <span className="client-site-link disabled">Add website to connect site</span>}
  </div>;
}
