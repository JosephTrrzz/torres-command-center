import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../lib/canvas-manifest.json';
import { withStudioPublisher } from '../functions/_shared/studio-publishing-connection';
import routes from '../public/website-preview/pages.json';
import { createStudioCloudflareAdapter, studioBuildAttemptId, verifyStudioCloudflareDeployment,
  type StudioCloudflareAdapterOptions, type StudioDeploymentVerification, type StudioEnrollmentEvidence } from '../functions/_shared/studio-cloudflare-adapter';
import { reserveBuildAttempt, getBuildAttempt, advanceBuildAttempt, type BuildAttempt, type PreviewEvidence } from '../functions/_shared/studio-build-attempts';
import { dispatchStudioBuild, observeStudioBuild } from '../functions/_shared/studio-build-dispatch';
import { readStudioGitBuild } from '../functions/_shared/studio-cloudflare-build';
import { STUDIO_CLOUDFLARE_TARGET as target, verifyStudioCloudflareCredential } from '../functions/_shared/studio-cloudflare';
import { compileTorresArtifact, TORRES_SOURCE_COMMIT } from '../functions/_shared/studio-torres-artifact';
import { contentHash, matchingReceipt, publisherReady, type Publication, type PublisherBinding } from '../functions/_shared/studio-publisher';

vi.mock('../functions/_shared/studio-build-attempts', () => ({reserveBuildAttempt:vi.fn(),getBuildAttempt:vi.fn(),advanceBuildAttempt:vi.fn()}));
vi.mock('../functions/_shared/studio-build-dispatch', () => ({dispatchStudioBuild:vi.fn(),observeStudioBuild:vi.fn()}));
vi.mock('../functions/_shared/studio-cloudflare-build', async original => ({
  ...await original<typeof import('../functions/_shared/studio-cloudflare-build')>(),readStudioGitBuild:vi.fn(),
}));
vi.mock('../functions/_shared/studio-cloudflare', async original => ({
  ...await original<typeof import('../functions/_shared/studio-cloudflare')>(), verifyStudioCloudflareCredential:vi.fn(),
}));
const releaseId = '11111111-1111-4111-8111-111111111111';
const previewProvider = '22222222-2222-4222-8222-222222222222';
const productionProvider = '33333333-3333-4333-8333-333333333333';
const previousProvider = '44444444-4444-4444-8444-444444444444';
const foreign = '55555555-5555-4555-8555-555555555555';
const createdAt = '2026-01-01T00:00:00.000Z';
const verifiedAt = '2026-01-02T00:00:00.000Z';
const draft = {0:{2:{moveX:0,moveY:1}}};
const env = {SUPABASE_URL:'https://storage.example',SUPABASE_SERVICE_ROLE_KEY:'private-storage',STUDIO_CLOUDFLARE_API_TOKEN:'private-provider'};
let publication: Publication;
let payload: Record<string,unknown>;
let rows: Map<string,BuildAttempt>;
let previewId: string, productionId: string;
let providerState: 'building'|'succeeded'|'failed';
let enrollment: StudioEnrollmentEvidence | null;
let siteEnabled: boolean;
let adapter: PublisherBinding;
const fetcher = vi.fn();
const verifier = vi.fn<NonNullable<StudioCloudflareAdapterOptions['verifyDeployment']>>();
const json = (v:unknown,mime='application/json') => new Response(typeof v==='string' ? v : JSON.stringify(v),{headers:{'Content-Type':mime}});
const clone = <T>(v:T):T => structuredClone(v);
function proof(input: StudioDeploymentVerification): PreviewEvidence {
  return {deployment_id:input.deployment.id,artifact_hash:input.artifact.assetPath.slice(9,-3),verified_at:verifiedAt,
    routes_verified:true,runtime_verified:true,functional_verified:true};
}
const post = (body:unknown=payload,binding=adapter) => binding.fetch(new Request('https://studio-publisher.internal/releases',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
}));
const get = (binding=adapter) => binding.fetch(new Request(`https://studio-publisher.internal/releases/${releaseId}?client=${target.client}`));
const observe = () => adapter.fetch(new Request(`https://studio-publisher.internal/releases/${releaseId}?client=${target.client}&observe=1`));
const options = ():StudioCloudflareAdapterOptions => ({sourceCommit:TORRES_SOURCE_COMMIT,loadEnrollmentEvidence:async()=>enrollment,verifyDeployment:verifier});

beforeEach(async () => {
  vi.resetAllMocks(); rows=new Map();providerState='building';siteEnabled=true;
  previewId=await studioBuildAttemptId(target.client,releaseId,'preview');
  productionId=await studioBuildAttemptId(target.client,releaseId,'production');
  publication={id:releaseId,client_id:target.client,snapshot_id:manifest.id,revision:36,
    content_hash:await contentHash({snapshotId:manifest.id,revision:36,draft}),status:'queued',deployment_id:null,created_at:createdAt,verified_at:null};
  payload={protocol:1,releaseId,clientId:target.client,snapshotId:manifest.id,revision:36,contentHash:publication.content_hash,publicUrl:manifest.source,draft};
  enrollment={clientId:target.client,snapshotId:manifest.id,publicUrl:manifest.source,sourceCommit:TORRES_SOURCE_COMMIT,verifiedAt,
    previewDeploymentId:previewProvider,rollbackDeploymentId:previousProvider,rendererVerified:true,buildInputVerified:true,durableDispatchVerified:true,rollbackVerified:true};
  verifier.mockResolvedValue(null);
  vi.mocked(verifyStudioCloudflareCredential).mockResolvedValue({credential:'verified',sourceCommit:TORRES_SOURCE_COMMIT,deploymentId:previousProvider});
  vi.mocked(readStudioGitBuild).mockResolvedValue({outcome:'verified',deployment:{id:previousProvider,sourceCommit:TORRES_SOURCE_COMMIT,
    environment:'production',branch:'main',createdAt,url:`https://${previousProvider.slice(0,8)}.${target.project}.pages.dev`,state:'succeeded'}});
  vi.mocked(getBuildAttempt).mockImplementation(async (_env,s) => clone(rows.get(s.id) ?? null));
  vi.mocked(reserveBuildAttempt).mockImplementation(async (_env,p) => {
    if(rows.has(p.id))return clone(rows.get(p.id)!);
    const row:BuildAttempt={id:p.id,release_id:p.releaseId,client_id:p.clientId,content_hash:p.contentHash,source_commit:p.sourceCommit,
      environment:p.environment,branch:p.branch,stage:'reserved',provider_deployment_id:null,created_at:createdAt,updated_at:createdAt,triggered_at:null,
      preview_attempt_id:p.previewAttemptId??null,previous_production_deployment_id:p.previousProductionDeploymentId??null,
      preview_evidence:p.previewAttemptId?clone(rows.get(p.previewAttemptId)!.preview_evidence):null};
    rows.set(p.id,row);return clone(row);
  });
  vi.mocked(dispatchStudioBuild).mockImplementation(async (_env,s) => {
    const row=rows.get(s.id)!;
    if(row.stage==='reserved')Object.assign(row,{stage:'building',triggered_at:createdAt,provider_deployment_id:row.environment==='preview'?previewProvider:productionProvider});
    return clone(row);
  });
  vi.mocked(advanceBuildAttempt).mockImplementation(async (_env,p) => {
    const row=rows.get(p.id)!;if(row.stage!==p.expectedStage)return null;
    Object.assign(row,{stage:p.stage,provider_deployment_id:p.providerDeploymentId??row.provider_deployment_id,
      preview_evidence:p.previewEvidence?clone(p.previewEvidence):row.preview_evidence});return clone(row);
  });
  vi.mocked(observeStudioBuild).mockImplementation(async (_env,s) => {
    const row=rows.get(s.id)!;
    if(!row.provider_deployment_id)return {attempt:clone(row),provider:null};
    if(providerState==='failed')row.stage='failed';
    return {attempt:clone(row),provider:{id:row.provider_deployment_id,sourceCommit:row.source_commit,environment:row.environment,branch:row.branch,
      url:`https://${row.provider_deployment_id.slice(0,8)}.${target.project}.pages.dev`,createdAt,state:providerState}};
  });
  fetcher.mockImplementation(async (url: string) => {
    if(url.includes('/studio_publications?'))return json([publication]);
    if(url.includes('/studio_sites?'))return json([{enabled:siteEnabled,publishing_enabled:siteEnabled,canvas_snapshot_id:manifest.id,public_url:manifest.source}]);
    if(url.includes('/studio_canvas_drafts?'))return json([{draft}]);
    throw Error('Unexpected network request');
  });
  vi.stubGlobal('fetch',fetcher);adapter=createStudioCloudflareAdapter(env,options());
});
afterEach(()=>vi.unstubAllGlobals());

async function verifiedPreview() {
  await post();providerState='succeeded';verifier.mockImplementation(async input=>proof(input));
  expect((await get()).status).toBe(200);expect(rows.get(previewId)?.stage).toBe('succeeded');
}

describe('private adapter contract and durable stages',()=>{
  it('returns operator cancellation without observing or promoting a late preview',async()=>{
    await post();Object.assign(rows.get(previewId)!,{stage:'cancelled'});
    vi.mocked(observeStudioBuild).mockClear();vi.mocked(dispatchStudioBuild).mockClear();vi.mocked(reserveBuildAttempt).mockClear();
    expect(await (await get()).json()).toMatchObject({status:'failed',phase:'preview_cancelled'});
    expect(observeStudioBuild).not.toHaveBeenCalled();expect(dispatchStudioBuild).not.toHaveBeenCalled();
    expect(reserveBuildAttempt).not.toHaveBeenCalled();expect(verifier).not.toHaveBeenCalled();
  });
  it.each([undefined,'invalid-json'])('credentialed connection observes without valid enrollment (%s), with capabilities false',async value=>{
    await post();const connected=withStudioPublisher({...env,STUDIO_PUBLISHING_ENROLLMENT:value});
    expect(connected.STUDIO_PUBLISHER).toBeDefined();expect(await publisherReady(connected,target.client)).toBe(false);
    const response=await get(connected.STUDIO_PUBLISHER!);
    expect(response.status).toBe(200);expect(await response.text()).not.toMatch(/private-provider|private-storage/);
    expect(observeStudioBuild).toHaveBeenCalled();expect(dispatchStudioBuild).toHaveBeenCalledTimes(1);expect(rows.size).toBe(1);
  });
  it('observation never reserves or dispatches even while fully enrolled',async()=>{
    expect((await observe()).status).toBe(404);
    const original=vi.mocked(reserveBuildAttempt).getMockImplementation()!;
    vi.mocked(reserveBuildAttempt).mockImplementationOnce(async(...args)=>{await original(...args);throw Error('lost reserve response');});
    await post();expect(rows.get(previewId)?.stage).toBe('reserved');
    expect((await observe()).status).toBe(200);
    expect(dispatchStudioBuild).not.toHaveBeenCalled();expect(rows.size).toBe(1);
  });
  it.each(['disabled','unenrolled'] as const)('observes a queued dispatched preview while %s without promoting',async mode=>{
    await post();expect(publication.status).toBe('queued');
    if(mode==='disabled')siteEnabled=false;else enrollment=null;
    providerState='succeeded';verifier.mockImplementation(async input=>proof(input));
    expect((await observe()).status).toBe(200);expect(rows.get(previewId)?.stage).toBe('succeeded');
    await observe();expect(rows.has(productionId)).toBe(false);expect(dispatchStudioBuild).toHaveBeenCalledTimes(1);
  });
  it('observation cannot dispatch an enrolled reserved production attempt',async()=>{
    await verifiedPreview();await get();expect(rows.get(productionId)?.stage).toBe('reserved');
    await observe();expect(rows.get(productionId)?.stage).toBe('reserved');expect(dispatchStudioBuild).toHaveBeenCalledTimes(1);
  });
  it.each(['disabled','unenrolled'] as const)('verifies already dispatched production while %s without creating more work',async mode=>{
    await verifiedPreview();await get();await get();
    if(mode==='disabled')siteEnabled=false;else enrollment=null;
    expect(await (await observe()).json()).toMatchObject({status:'succeeded'});
    expect(rows.get(productionId)?.stage).toBe('succeeded');expect(dispatchStudioBuild).toHaveBeenCalledTimes(2);expect(rows.size).toBe(2);
  });
  it('leaves production reserved when the baseline changed before dispatch',async()=>{
    await verifiedPreview();await get();
    vi.mocked(verifyStudioCloudflareCredential).mockResolvedValue({credential:'verified',sourceCommit:TORRES_SOURCE_COMMIT,deploymentId:foreign});
    expect((await get()).status).toBe(200);expect(rows.get(productionId)?.stage).toBe('reserved');
    expect(rows.get(productionId)?.previous_production_deployment_id).toBe(previousProvider);expect(dispatchStudioBuild).toHaveBeenCalledTimes(1);
  });
  it.each(['unavailable','mismatch'] as const)('leaves production reserved on %s baseline verification',async outcome=>{
    await verifiedPreview();await get();vi.mocked(readStudioGitBuild).mockResolvedValue({outcome});
    await get();expect(rows.get(productionId)?.stage).toBe('reserved');expect(dispatchStudioBuild).toHaveBeenCalledTimes(1);
  });
  it('dispatches only after the reserved baseline is independently reverified',async()=>{
    await verifiedPreview();await get();vi.mocked(readStudioGitBuild).mockClear();
    await get();expect(rows.get(productionId)?.stage).toBe('building');
    expect(readStudioGitBuild).toHaveBeenCalledWith(env.STUDIO_CLOUDFLARE_API_TOKEN,expect.objectContaining({source_commit:TORRES_SOURCE_COMMIT,branch:'main',environment:'production'}),previousProvider);
    expect(vi.mocked(readStudioGitBuild).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(dispatchStudioBuild).mock.invocationCallOrder[1]);
  });
  it('defaults capabilities off without explicit enrollment and a verifier',async()=>{
    expect(await publisherReady({...env,STUDIO_PUBLISHER:createStudioCloudflareAdapter(env,{sourceCommit:TORRES_SOURCE_COMMIT})},target.client)).toBe(false);
    enrollment=null;expect(await publisherReady({...env,STUDIO_PUBLISHER:adapter},target.client)).toBe(false);
    expect((await post()).status).toBe(503);expect(reserveBuildAttempt).not.toHaveBeenCalled();
  });
  it('requires exact reviewed enrollment identity',async()=>{
    enrollment!.sourceCommit='a'.repeat(40);
    expect(await publisherReady({...env,STUDIO_PUBLISHER:adapter},target.client)).toBe(false);
    expect((await post()).status).toBe(503);
    expect(dispatchStudioBuild).not.toHaveBeenCalled();
  });
  it('rejects a disabled site even with enrollment evidence',async()=>{
    siteEnabled=false;expect((await post()).status).toBe(503);expect(reserveBuildAttempt).not.toHaveBeenCalled();
  });
  it('uses deterministic environment-specific keys independent of source configuration',async()=>{
    expect(previewId).not.toBe(productionId);
    expect(await studioBuildAttemptId(target.client,releaseId,'preview')).toBe(previewId);
    expect(await studioBuildAttemptId(foreign,releaseId,'preview')).not.toBe(previewId);
  });
  it('returns not-found only before the adapter has a persisted release attempt',async()=>{
    expect((await get()).status).toBe(404);
    vi.mocked(getBuildAttempt).mockRejectedValueOnce(Error('storage failure'));
    expect((await get()).status).toBe(503);
  });
  it.each([{clientId:foreign},{publicUrl:'https://evil.example'},{sourceCommit:'browser-selected'},{revision:37},{contentHash:'e'.repeat(64)}])('refuses altered release identity before reservation: %j',async patch=>{
    expect((await post({...payload,...patch})).status).toBeGreaterThanOrEqual(400);
    expect(reserveBuildAttempt).not.toHaveBeenCalled();expect(dispatchStudioBuild).not.toHaveBeenCalled();
  });
  it('independently rejects a changed draft under the stored hash',async()=>{
    expect((await post({...payload,draft:{0:{2:{moveX:50,moveY:1}}}})).status).toBe(503);
    expect(reserveBuildAttempt).not.toHaveBeenCalled();
  });
  it('rejects a foreign GET and never sends private information in errors',async()=>{
    const response=await adapter.fetch(new Request(`https://studio-publisher.internal/releases/${releaseId}?client=${foreign}`));
    expect(response.status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValueOnce(Error('private-provider private draft text'));
    expect(await (await post()).text()).not.toMatch(/private-provider|private draft text/);
  });
  it('rejects use as a public/browser endpoint',async()=>{
    expect((await adapter.fetch(new Request('https://public.example/releases'))).status).toBe(403);
    expect((await adapter.fetch(new Request(`https://studio-publisher.internal/capabilities?client=${target.client}`,{headers:{Origin:'https://public.example'}}))).status).toBe(403);
  });
  it('does not duplicate preview creation on repeated POST or restart',async()=>{
    const first=await (await post()).json();
    const restarted=createStudioCloudflareAdapter(env,options());
    const second=await (await post(payload,restarted)).json();
    expect(dispatchStudioBuild).toHaveBeenCalledTimes(1);expect(reserveBuildAttempt).toHaveBeenCalledTimes(1);
    expect(first.deploymentId).toBe('studio-'+releaseId);expect(second.deploymentId).toBe(first.deploymentId);
    expect(matchingReceipt(second,{...publication,deployment_id:first.deploymentId})).toBe(true);
  });
  it('does not treat provider success as preview evidence',async()=>{
    await post();providerState='succeeded';
    expect(await (await get()).json()).toMatchObject({status:'building'});
    expect(rows.get(previewId)?.stage).toBe('building');expect(rows.has(productionId)).toBe(false);
    expect(advanceBuildAttempt).not.toHaveBeenCalled();
  });
  it.each(['deployment_id','artifact_hash','runtime_verified'] as const)('rejects mismatched browser proof: %s',async field=>{
    await post();providerState='succeeded';
    verifier.mockImplementation(async input=>({...proof(input),[field]:field==='runtime_verified'?false:'wrong'}) as PreviewEvidence);
    expect((await get()).status).toBe(409);expect(advanceBuildAttempt).not.toHaveBeenCalled();expect(rows.has(productionId)).toBe(false);
  });
  it('keeps one receipt ID across verified preview, production reservation, deployment, and verification',async()=>{
    const first=await (await post()).json();publication.deployment_id=first.deploymentId;
    providerState='succeeded';verifier.mockImplementation(async input=>proof(input));
    const preview=await (await get()).json();expect(preview.phase).toBe('preview_verified');
    const reserved=await (await get()).json();expect(reserved.phase).toBe('production_reserved');
    expect(rows.get(productionId)).toMatchObject({stage:'reserved',preview_attempt_id:previewId,previous_production_deployment_id:previousProvider});
    expect(dispatchStudioBuild).toHaveBeenCalledTimes(1);
    const deployed=await (await get()).json();expect(deployed.status).toBe('deploying');
    const verified=await (await get()).json();expect(verified.status).toBe('succeeded');
    for(const r of [preview,reserved,deployed,verified])expect(matchingReceipt(r,publication)).toBe(true);
    expect(dispatchStudioBuild).toHaveBeenCalledTimes(2);
    expect(rows.get(productionId)?.preview_evidence?.deployment_id).toBe(previewProvider);
    expect(verifier.mock.calls.at(-1)?.[0].deployment.id).toBe(productionProvider);
  });
  it('cannot reserve production when previous production identity is unavailable or source drifted',async()=>{
    await verifiedPreview();
    vi.mocked(verifyStudioCloudflareCredential).mockResolvedValueOnce({credential:'unavailable',reason:'request_error'});
    expect(await (await get()).json()).toMatchObject({phase:'awaiting_production_identity'});
    vi.mocked(verifyStudioCloudflareCredential).mockResolvedValueOnce({credential:'verified',sourceCommit:'d'.repeat(40),deploymentId:foreign});
    expect(await (await get()).json()).toMatchObject({phase:'awaiting_production_identity'});expect(rows.has(productionId)).toBe(false);
  });
  it('cannot promote after enrollment is revoked',async()=>{
    await verifiedPreview();enrollment=null;
    expect(await (await get()).json()).toMatchObject({phase:'awaiting_enrollment'});expect(rows.has(productionId)).toBe(false);
  });
  it('requires previous production to be a provider-confirmed successful main build',async()=>{
    await verifiedPreview();vi.mocked(readStudioGitBuild).mockResolvedValueOnce({outcome:'mismatch'});
    expect(await (await get()).json()).toMatchObject({phase:'awaiting_production_identity'});expect(rows.has(productionId)).toBe(false);
    expect(readStudioGitBuild).toHaveBeenLastCalledWith(env.STUDIO_CLOUDFLARE_API_TOKEN,
      {id:productionId,source_commit:TORRES_SOURCE_COMMIT,environment:'production',branch:'main'},previousProvider);
  });
  it('allows the exact enrolled baseline with its independently verified older source commit',async()=>{
    await verifiedPreview();const baselineSource='a'.repeat(40);
    vi.mocked(verifyStudioCloudflareCredential).mockResolvedValueOnce({credential:'verified',sourceCommit:baselineSource,deploymentId:previousProvider});
    vi.mocked(readStudioGitBuild).mockResolvedValueOnce({outcome:'verified',deployment:{id:previousProvider,sourceCommit:baselineSource,
      environment:'production',branch:'main',createdAt,url:`https://${previousProvider.slice(0,8)}.${target.project}.pages.dev`,state:'succeeded'}});
    expect(await (await get()).json()).toMatchObject({phase:'production_reserved'});
    expect(readStudioGitBuild).toHaveBeenLastCalledWith(env.STUDIO_CLOUDFLARE_API_TOKEN,
      {id:productionId,source_commit:baselineSource,environment:'production',branch:'main'},previousProvider);
    expect(rows.get(productionId)).toMatchObject({source_commit:TORRES_SOURCE_COMMIT,previous_production_deployment_id:previousProvider});
  });
  it('allows subsequent successful production IDs only when they use the approved source',async()=>{
    await verifiedPreview();
    vi.mocked(verifyStudioCloudflareCredential).mockResolvedValueOnce({credential:'verified',sourceCommit:TORRES_SOURCE_COMMIT,deploymentId:foreign});
    vi.mocked(readStudioGitBuild).mockResolvedValueOnce({outcome:'verified',deployment:{id:foreign,sourceCommit:TORRES_SOURCE_COMMIT,
      environment:'production',branch:'main',createdAt,url:`https://${foreign.slice(0,8)}.${target.project}.pages.dev`,state:'succeeded'}});
    expect(await (await get()).json()).toMatchObject({phase:'production_reserved'});
    expect(rows.get(productionId)?.previous_production_deployment_id).toBe(foreign);
  });
  it.each([{sourceCommit:'b'.repeat(40)},{id:foreign},{branch:'other'},{environment:'preview'},{state:'failed'}])('rejects mismatched independent baseline evidence: %j',async patch=>{
    await verifiedPreview();const baselineSource='a'.repeat(40);
    vi.mocked(verifyStudioCloudflareCredential).mockResolvedValueOnce({credential:'verified',sourceCommit:baselineSource,deploymentId:previousProvider});
    vi.mocked(readStudioGitBuild).mockResolvedValueOnce({outcome:'verified',deployment:{id:previousProvider,sourceCommit:baselineSource,
      environment:'production',branch:'main',createdAt,url:`https://${previousProvider.slice(0,8)}.${target.project}.pages.dev`,state:'succeeded',...patch} as import('../functions/_shared/studio-cloudflare-build').DeploymentEvidence});
    expect(await (await get()).json()).toMatchObject({phase:'awaiting_production_identity'});expect(rows.has(productionId)).toBe(false);
  });
  it('does not advertise rollback just because a baseline ID is enrolled',async()=>{
    enrollment={...enrollment!,rollbackVerified:false} as unknown as StudioEnrollmentEvidence;
    const result=await adapter.fetch(new Request(`https://studio-publisher.internal/capabilities?client=${target.client}`));
    expect(await result.json()).toMatchObject({rollback:false,safeRenderer:false,durableIdempotency:false});
    expect((await post()).status).toBe(503);expect(reserveBuildAttempt).not.toHaveBeenCalled();
  });
  it('rejects source drift without allocating a new attempt',async()=>{
    await post();const changed=createStudioCloudflareAdapter(env,{...options(),sourceCommit:'d'.repeat(40)});
    expect((await get(changed)).status).toBe(409);expect(rows.size).toBe(1);expect(dispatchStudioBuild).toHaveBeenCalledTimes(1);
  });
  it('holds ambiguity rather than retrying create or declaring failure',async()=>{
    await post();Object.assign(rows.get(previewId)!,{stage:'ambiguous',provider_deployment_id:null});
    expect(await (await post()).json()).toMatchObject({status:'building'});
    expect(dispatchStudioBuild).toHaveBeenCalledTimes(1);expect(rows.has(productionId)).toBe(false);
  });
  it('recovers a lost reserve response from the persisted deterministic key',async()=>{
    const original=vi.mocked(reserveBuildAttempt).getMockImplementation()!;
    vi.mocked(reserveBuildAttempt).mockImplementationOnce(async (...args)=>{await original(...args);throw Error('lost acknowledgment');});
    expect((await post()).status).toBe(503);expect(dispatchStudioBuild).not.toHaveBeenCalled();
    expect((await get()).status).toBe(200);expect(reserveBuildAttempt).toHaveBeenCalledTimes(1);expect(dispatchStudioBuild).toHaveBeenCalledTimes(1);
  });
  it('recovers a lost dispatch response without dispatching again',async()=>{
    const original=vi.mocked(dispatchStudioBuild).getMockImplementation()!;
    vi.mocked(dispatchStudioBuild).mockImplementationOnce(async (...args)=>{await original(...args);throw Error('lost acknowledgment');});
    expect((await post()).status).toBe(503);expect((await get()).status).toBe(200);expect(dispatchStudioBuild).toHaveBeenCalledTimes(1);
  });
  it('reports a provider-confirmed preview failure without starting production',async()=>{
    await post();providerState='failed';
    expect(await (await get()).json()).toMatchObject({status:'failed',deploymentId:'studio-'+releaseId});
    expect(rows.has(productionId)).toBe(false);expect(verifier).not.toHaveBeenCalled();
  });
});

describe('deployed runner attestation verifier',()=>{
  let input:StudioDeploymentVerification;
  let attestation:Record<string,unknown>;
  let html:string;
  beforeEach(async()=>{
    await post();providerState='succeeded';
    const observed=await observeStudioBuild(env,{id:previewId,clientId:target.client});
    const artifact=await compileTorresArtifact({releaseId,snapshotId:manifest.id,revision:36,contentHash:publication.content_hash!,sourceCommit:TORRES_SOURCE_COMMIT,draft});
    input={release:publication,attempt:rows.get(previewId)!,deployment:observed.provider!,artifact};
    attestation={protocol:1,attemptId:previewId,deploymentId:previewProvider,releaseId,contentHash:publication.content_hash,
      sourceCommit:TORRES_SOURCE_COMMIT,artifactHash:artifact.assetPath.slice(9,-3),routesVerified:true,runtimeVerified:true,functionalVerified:true};
    html=`<html><head>${artifact.marker}<script src="${artifact.assetPath}" defer data-torres-studio="${releaseId}"></script></head><body>Real source output</body></html>`;
    fetcher.mockReset().mockImplementation(async (url:string)=>{
      if(url.endsWith('/_studio/verification.json'))return json(attestation);
      if(url.endsWith(artifact.assetPath))return json(artifact.script,'application/javascript');
      return json(html,'text/html');
    });
  });
  it('requires runner proof, exact script bytes and all eleven deployed route markers',async()=>{
    expect(await verifyStudioCloudflareDeployment(input)).toMatchObject({deployment_id:previewProvider,artifact_hash:attestation.artifactHash,
      routes_verified:true,runtime_verified:true,functional_verified:true});
    expect(fetcher).toHaveBeenCalledTimes(13);
    for(const [url,init] of fetcher.mock.calls){expect(new URL(url).origin).toBe(input.deployment.url);expect(init.redirect).toBe('manual');}
  });
  it.each(['attemptId','deploymentId','releaseId','contentHash','sourceCommit','artifactHash','runtimeVerified','functionalVerified','routesVerified','protocol'])('rejects mismatched attestation %s',async field=>{
    attestation[field]='wrong';expect(await verifyStudioCloudflareDeployment(input)).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown proof fields and never follows a proof-supplied URL',async()=>{
    attestation.callback='https://evil.example';expect(await verifyStudioCloudflareDeployment(input)).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('requires provider-confirmed final success before network verification',async()=>{
    input={...input,deployment:{...input.deployment,state:'building'}};expect(await verifyStudioCloudflareDeployment(input)).toBeNull();expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects an arbitrary provider URL without a request',async()=>{
    input={...input,deployment:{...input.deployment,url:'https://evil.example'}};expect(await verifyStudioCloudflareDeployment(input)).toBeNull();expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects redirects and oversized attestations',async()=>{
    fetcher.mockResolvedValueOnce(new Response(null,{status:302,headers:{Location:'https://evil.example'}}));
    expect(await verifyStudioCloudflareDeployment(input)).toBeNull();
    fetcher.mockResolvedValueOnce(json(' '.repeat(8193)));expect(await verifyStudioCloudflareDeployment(input)).toBeNull();
  });
  it('rejects an edited or missing runtime script',async()=>{
    fetcher.mockResolvedValueOnce(json(attestation)).mockResolvedValueOnce(json(input.artifact.script+';','application/javascript'));
    expect(await verifyStudioCloudflareDeployment(input)).toBeNull();
  });
  it('rejects partial route deployment and comment-only markers',async()=>{
    const original=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async(url:string)=>url.endsWith(routes.at(-1)!.route)?json('<head>old</head>','text/html'):original(url));
    expect(await verifyStudioCloudflareDeployment(input)).toBeNull();
    fetcher.mockImplementation(original);html=`<head><!--${input.artifact.marker}--><script src="${input.artifact.assetPath}" defer data-torres-studio="${releaseId}"></script></head>`;
    expect(await verifyStudioCloudflareDeployment(input)).toBeNull();
  });
  it('rejects markers outside the bounded head',async()=>{
    html='<head>'+'x'.repeat(65536)+html;expect(await verifyStudioCloudflareDeployment(input)).toBeNull();
  });
  it('does not accept proof alone with a missing script tag',async()=>{
    html=`<head>${input.artifact.marker}</head>`;expect(await verifyStudioCloudflareDeployment(input)).toBeNull();
  });
});
