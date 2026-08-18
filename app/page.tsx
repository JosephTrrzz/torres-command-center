import Link from "next/link";
import { activities, clients } from "../lib/demo-data";
import { ClientCard } from "../components/client-card";
import { Shell } from "../components/shell";

export default function DashboardPage() {
  const healthy = clients.filter((client) => client.status === "healthy").length;
  return <Shell active="Overview">
    <div className="page-heading"><div><p className="eyebrow">Monday, August 17, 2026</p><h1>Good morning, Joseph.</h1><p className="lede">Here’s what’s happening across your client portfolio.</p></div><Link className="button button-dark" href="/clients">View all clients <span>→</span></Link></div>
    <section className="stat-grid" aria-label="Portfolio summary"><div className="stat-card"><span>Portfolio health</span><strong>91<span className="muted">/100</span></strong><small className="positive">↑ 6.2% <em>vs last month</em></small></div><div className="stat-card"><span>Organic traffic</span><strong>38.2K</strong><small className="positive">↑ 19.4% <em>vs last month</em></small></div><div className="stat-card"><span>Open opportunities</span><strong>12</strong><small className="neutral">4 high priority</small></div><div className="stat-card"><span>Clients monitored</span><strong>{clients.length}</strong><small className="positive">{healthy} healthy <em>right now</em></small></div></section>
    <div className="section-heading"><div><p className="eyebrow">Your portfolio</p><h2>Client health</h2></div><Link className="text-link" href="/clients">See all clients →</Link></div>
    <section className="client-grid">{clients.map((client) => <ClientCard client={client} key={client.id} />)}</section>
    <section className="activity-panel"><div className="section-heading"><div><p className="eyebrow">Live feed</p><h2>Recent activity</h2></div><button className="icon-button" aria-label="More activity">•••</button></div>{activities.map((activity) => <div className="activity-row" key={activity.id}><span className={`activity-icon ${activity.type}`}>{activity.type === "alert" ? "!" : activity.type === "report" ? "▤" : "✦"}</span><div><strong>{activity.title}</strong><p>{activity.detail}</p></div><time>{activity.time}</time></div>)}</section>
  </Shell>;
}
