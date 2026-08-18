import { clients } from "../../lib/demo-data";
import { ClientCard } from "../../components/client-card";
import { Shell } from "../../components/shell";

export default function ClientsPage() { return <Shell active="Clients"><div className="page-heading"><div><p className="eyebrow">Workspace</p><h1>Clients</h1><p className="lede">A clear, current view of every account you manage.</p></div><button className="button button-dark">+ Add client</button></div><section className="client-grid client-grid-wide">{clients.map((client) => <ClientCard client={client} key={client.id} />)}</section></Shell>; }
