import type { PublishingEnv } from './studio-publisher';
import { STUDIO_CLOUDFLARE_TARGET } from './studio-cloudflare';
import { advanceBuildAttempt, claimBuildAttempt, getBuildAttempt, type BuildAttemptScope } from './studio-build-attempts';
import { readStudioGitBuild, startStudioGitBuild } from './studio-cloudflare-build';

/** Internal orchestration only. A runner must first reserve a validated immutable
 * attempt. This is deliberately not wired to browser publishing until source,
 * authenticated build input, preview verification and recovery are installed.
 */
export async function dispatchStudioBuild(env: PublishingEnv, scope: BuildAttemptScope) {
  if (scope.clientId !== STUDIO_CLOUDFLARE_TARGET.client || !env.STUDIO_CLOUDFLARE_API_TOKEN) {
    throw Error('Publishing connection is unavailable.');
  }
  // A confirmed non-replayable claim is the ONLY permission to create a build.
  const claimed = await claimBuildAttempt(env, scope);
  if (!claimed) return getBuildAttempt(env, scope);
  const result = await startStudioGitBuild(env.STUDIO_CLOUDFLARE_API_TOKEN, { ...claimed, state: 'triggering' });
  if (result.outcome !== 'accepted') {
    return advanceBuildAttempt(env, { ...scope, expectedStage: 'triggering', stage: 'ambiguous' });
  }
  // Record the provider identity before checking terminal status. If this write
  // times out, retain the triggering lock; never create another deployment.
  return advanceBuildAttempt(env, { ...scope, expectedStage: 'triggering', stage: 'building',
    providerDeploymentId: result.deployment.id });
}

export async function observeStudioBuild(env: PublishingEnv, scope: BuildAttemptScope) {
  if (scope.clientId !== STUDIO_CLOUDFLARE_TARGET.client || !env.STUDIO_CLOUDFLARE_API_TOKEN) {
    throw Error('Publishing connection is unavailable.');
  }
  const attempt = await getBuildAttempt(env, scope);
  if (!attempt || ['reserved','succeeded','failed'].includes(attempt.stage) || !attempt.provider_deployment_id) {
    return { attempt, provider: null };
  }
  const result = await readStudioGitBuild(env.STUDIO_CLOUDFLARE_API_TOKEN, attempt, attempt.provider_deployment_id);
  if (result.outcome !== 'verified') return { attempt, provider: null };
  if (result.deployment.state === 'failed') {
    const saved = await advanceBuildAttempt(env, { ...scope, expectedStage: attempt.stage, stage: 'failed',
      providerDeploymentId: result.deployment.id });
    return { attempt: saved ?? attempt, provider: result.deployment };
  }
  // Provider success alone is insufficient. The verifier owns the transition
  // to succeeded after validating the actual deployed artifact and behavior.
  return { attempt, provider: result.deployment };
}
