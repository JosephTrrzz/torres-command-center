// Operator-owned target. Browser input must never choose the account/project.
export const STUDIO_CLOUDFLARE_TARGET = Object.freeze({
  account: 'bdecd4f5c86e75b33b31738dd5837947',
  project: 'torres-co-technology',
  client: '06edc104-71e0-4359-8cb3-42529d65b5d1',
  hostname: 'torrescotechnology.com',
});

export async function verifyStudioCloudflareCredential(token: string | undefined) {
  if (!token || token.length < 20 || /[\r\n]/.test(token)) return { credential: 'missing' as const };
  const target = STUDIO_CLOUDFLARE_TARGET;
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${target.account}/pages/projects/${target.project}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) return { credential: 'rejected' as const };
    if (!response.ok) return { credential: 'unavailable' as const };
    // Cloudflare project responses may contain confidential configuration.
    // Never log, persist or return that object. Select only deployment identity.
    const body = await response.json() as {
      success?: boolean;
      result?: { name?: string; domains?: string[]; production_branch?: string;
        canonical_deployment?: { id?: string; environment?: string;
          deployment_trigger?: { metadata?: { commit_hash?: string } } } };
    };
    const project = body.result;
    if (!body.success || project?.name !== target.project || !project.domains?.includes(target.hostname) || project.production_branch !== 'main') {
      return { credential: 'target_mismatch' as const };
    }
    const deployment = project.canonical_deployment;
    const sourceCommit = deployment?.deployment_trigger?.metadata?.commit_hash;
    if (deployment?.environment !== 'production' || !/^[a-f0-9]{40}$/.test(sourceCommit || '') ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(deployment.id || '')) return { credential: 'unavailable' as const };
    return { credential: 'verified' as const, sourceCommit: sourceCommit!, deploymentId: deployment.id! };
  } catch {
    return { credential: 'unavailable' as const };
  }
}
