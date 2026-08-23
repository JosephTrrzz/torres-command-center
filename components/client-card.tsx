import Link from "next/link";
import { ClientSummary } from "../lib/types";

export function ClientCard({ client }: { client: ClientSummary & { website?: string } }) {
  const website = client.website?.trim();
  const websiteHref = website ? (website.startsWith("http") ? website : `https://${website}`) : null;
  return <div className="client-card-wrap">
    <Link href={`/clients/detail/?id=${encodeURIComponent(client.id)}`} className="client-card">
      <div className="client-card-top"><span className="client-avatar">{client.initials}</span><span className={`status-dot ${client.status}`} aria-label={client.status} /></div>
      <h3>{client.name}</h3><p>{client.industry} · {client.location}</p>
      <div className="health-row"><span>Health score</span><strong>{client.health}</strong></div>
      <div className="health-track"><span style={{width:`${client.health}%`}} /></div>
      <div className="card-footer"><span>{client.metrics[0].label}</span><strong>{client.metrics[0].value} <small>↑ {client.metrics[0].change}</small></strong></div>
    </Link>
    {websiteHref ? <a className="client-site-link" href={websiteHref} target="_blank" rel="noreferrer">Open client site <span>↗</span></a> : <span className="client-site-link disabled">Add website to connect site</span>}
  </div>;
}
