import { authJson, type FunctionEnv } from '../../_shared/auth';
import { studioAccess } from '../../_shared/studio-access';
import { trustedStudioRequest } from '../../_shared/studio-request';
import { STUDIO_CLOUDFLARE_TARGET, verifyStudioCloudflareCredential } from '../../_shared/studio-cloudflare';
import { TORRES_SOURCE_COMMIT } from '../../_shared/studio-torres-artifact';

// Read-only operator check. This never starts a build, enables a site or returns
// credentials. Saving a token in settings is not itself proof of usable access.
export async function onRequest({ request, env }: {
  request: Request; env: FunctionEnv & { STUDIO_CLOUDFLARE_API_TOKEN?: string };
}) {
  if (!trustedStudioRequest(request)) return authJson({ error: 'This request is not allowed.' }, 403);
  if (request.method !== 'GET') return authJson({ error: 'Unsupported method.' }, 405);
  const access = await studioAccess(request, env);
  if ('response' in access) return access.response;
  if (!access.staff || access.clientId !== STUDIO_CLOUDFLARE_TARGET.client) return authJson({ error: 'Publishing setup is available only to the assigned website administrator.' }, 403);
  const check = await verifyStudioCloudflareCredential(env.STUDIO_CLOUDFLARE_API_TOKEN);
  return authJson({ ...check,
    sourceMatches: check.credential === 'verified' && check.sourceCommit === TORRES_SOURCE_COMMIT,
    ready: false,
    message: 'Connection checks do not publish changes. Preview deployment and rollback verification are still required.',
  });
}
