import { createStudioCloudflareAdapter, verifyStudioCloudflareDeployment, type StudioEnrollmentEvidence } from './studio-cloudflare-adapter';
import { TORRES_SOURCE_COMMIT } from './studio-torres-artifact';
import type { PublishingEnv } from './studio-publisher';

/** Server-only configuration. An encrypted provider credential alone is never
 * enrollment. Operator evidence is installed only after actual preview/recovery
 * verification, and is invalidated whenever the approved source changes. */
export function withStudioPublisher(env: PublishingEnv): PublishingEnv {
  if (env.STUDIO_PUBLISHER || !env.STUDIO_CLOUDFLARE_API_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY) return env;
  // Credentials permit observation of existing attempts, never enrollment.
  let evidence: StudioEnrollmentEvidence | null = null;
  try {
    if (env.STUDIO_BUILD_INPUT_SECRET && env.STUDIO_PUBLISHING_ENROLLMENT && env.STUDIO_PUBLISHING_ENROLLMENT.length <= 4096) {
      const parsed = JSON.parse(env.STUDIO_PUBLISHING_ENROLLMENT);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.sourceCommit === TORRES_SOURCE_COMMIT) evidence = parsed;
    }
  } catch { /* Invalid enrollment still permits credentialed observation only. */ }
  return { ...env, STUDIO_PUBLISHER: createStudioCloudflareAdapter(env, {
    sourceCommit: TORRES_SOURCE_COMMIT,
    loadEnrollmentEvidence: async () => structuredClone(evidence),
    verifyDeployment: verifyStudioCloudflareDeployment,
  }) };
}
