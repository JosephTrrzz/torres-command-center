"use client";
import { useEffect, useState } from 'react';
import { studioRequest } from '../lib/studio-api';
import { AUTH_SESSION_EVENT } from '../lib/supabase-auth';

export function WebsiteSelector({ editing = false, beforeSwitch }: { editing?: boolean; beforeSwitch?: () => Promise<boolean> }) {
  const [sites, setSites] = useState<{ clientId: string; name: string }[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [switching, setSwitching] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const reset = () => { controller.abort(); setSites([]); setGeneration(value => value + 1); };
    window.addEventListener(AUTH_SESSION_EVENT, reset);
    const current = new URLSearchParams(window.location.search).get('client') || '';
    setSelected(current);
    void studioRequest<{ administrator: boolean; sites: typeof sites }>('sites', undefined, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setSites(data.sites);
        if (data.administrator && !current && data.sites.length && !editing)
          window.location.replace('/website/?client=' + encodeURIComponent(data.sites[0].clientId));
      }).catch(() => { if (!controller.signal.aborted) setError('Website selection could not be loaded. Refresh to try again.'); });
    return () => { controller.abort(); window.removeEventListener(AUTH_SESSION_EVENT, reset); };
  }, [editing, generation]);
  if (error) return <p role="alert">{error}</p>;
  if (!sites.length) return null;
  return <section style={{ marginBottom: 'var(--space-5)', maxWidth: 520 }} aria-label="Managed websites">
    <label htmlFor="managed-website">Client website</label>
    <select id="managed-website" value={selected} disabled={switching} style={{ width: '100%', minHeight: 48 }} onChange={async event => {
      const clientId = event.target.value;
      if (!sites.some(site => site.clientId === clientId)) return;
      if (editing && !window.confirm('Save your current draft and switch websites?')) return;
      setSwitching(true);
      if (beforeSwitch && !await beforeSwitch()) {
        setSwitching(false); setError('Your draft could not be saved. Stay here and try Save draft before switching.'); return;
      }
      // A full navigation destroys the old iframe and its in-flight request handlers.
      window.location.assign('/website/?client=' + encodeURIComponent(clientId));
    }}>
      <option value="" disabled>Choose a client website</option>
      {sites.map(site => <option key={site.clientId} value={site.clientId}>{site.name}</option>)}
    </select>
    <p>Choose a managed client to view its website workspace.</p>
  </section>;
}
