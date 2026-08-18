import Link from "next/link";
export default function NotFound() { return <main className="not-found"><p className="eyebrow">404</p><h1>Client not found</h1><Link className="button button-dark" href="/clients">Back to clients</Link></main>; }
