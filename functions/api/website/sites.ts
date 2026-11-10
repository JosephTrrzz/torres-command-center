import { authJson, requireAuth, type FunctionEnv } from '../../_shared/auth';
import { studioAccess, studioAdministrator, studioStore } from '../../_shared/studio-access';

// Return only clients independently authorized by the same boundary as saves.
export async function onRequestGet({ request, env }: { request: Request; env: FunctionEnv }) {
  const identity = await requireAuth(request, env);
  if ('response' in identity) return identity.response;
  if (!studioAdministrator(identity.context)) return authJson({ sites: [], administrator: false });
  const { rest, headers } = studioStore(env);
  const sites: { clientId: string; name: string }[] = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${rest}/clients?select=id,name&order=id&limit=100&offset=${offset}`, { headers });
    if (!response.ok) return authJson({ error: 'Managed websites could not be loaded.' }, 503);
    const rows = await response.json() as { id: string; name: string }[];
    for (const row of rows) {
      const url = new URL(request.url);
      url.searchParams.set('client', row.id);
      const access = await studioAccess(new Request(url, { headers: request.headers }), env);
      if ('response' in access) {
        if (![403, 404].includes(access.response.status)) return access.response;
      } else if (access.staff) sites.push({ clientId: row.id, name: row.name });
    }
    if (rows.length < 100) break;
  }
  sites.sort((a, b) => a.name.localeCompare(b.name));
  return authJson({ administrator: true, sites });
}
