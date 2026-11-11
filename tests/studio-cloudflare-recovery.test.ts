import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn()}));
vi.mock('../functions/_shared/studio-build-attempts',()=>({getBuildAttempt:mocks.get}));
import {recoverStudioProduction,observeStudioProductionRecovery} from '../functions/_shared/studio-cloudflare-recovery';
import {STUDIO_CLOUDFLARE_TARGET as target} from '../functions/_shared/studio-cloudflare';
const scope={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clientId:target.client};
const production='11111111-1111-4111-8111-111111111111',previous='22222222-2222-4222-8222-222222222222';
const source='a'.repeat(40),baseline='b'.repeat(40);
const env={STUDIO_CLOUDFLARE_API_TOKEN:'test-private-token-DO-NOT-RETURN'};
const base=`https://api.cloudflare.com/client/v4/accounts/${target.account}/pages/projects/${target.project}`;
const attempt={id:scope.id,client_id:target.client,release_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',content_hash:'c'.repeat(64),
  source_commit:source,environment:'production',branch:'main',stage:'succeeded',provider_deployment_id:production,previous_production_deployment_id:previous};
const deployment=(id:string,commit:string)=>({id,project_name:target.project,environment:'production',
  deployment_trigger:{metadata:{branch:'main',commit_hash:commit,commit_dirty:false}},latest_stage:{name:'deploy',status:'success'},
  is_skipped:false,created_on:'2026-11-10T00:00:00Z',url:`https://${id.slice(0,8)}.${target.project}.pages.dev`,env_vars:{SECRET:{value:'provider-secret'}}});
let canonicalId:string, previousData:ReturnType<typeof deployment>,projectOverride:Record<string,unknown>;
let rollbackResponse:()=>Response|Promise<Response>;
const control=()=>({claimOnce:vi.fn().mockResolvedValue(true),record:vi.fn().mockResolvedValue(undefined)});
const ok=(result:unknown)=>Response.json({success:true,result});
const posts=()=>vi.mocked(fetch).mock.calls.filter(([,init])=>init?.method==='POST');
beforeEach(()=>{
  vi.resetAllMocks();canonicalId=production;previousData=deployment(previous,baseline);projectOverride={};mocks.get.mockResolvedValue({...attempt});
  rollbackResponse=()=>{canonicalId=previous;return ok(previousData);};
  vi.stubGlobal('fetch',vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{
    const value=String(url);
    if(value===base+'/deployments/'+previous+'/rollback'&&init?.method==='POST')return rollbackResponse();
    if(value===base)return ok({name:target.project,production_branch:'main',domains:[target.hostname],
      canonical_deployment:deployment(canonicalId,canonicalId===previous?baseline:source),...projectOverride});
    if(value===base+'/deployments/'+previous)return ok(previousData);
    if(value===base+'/deployments/'+production)return ok(deployment(production,source));
    throw Error('Unexpected provider request');
  }));
});
describe('operator production recovery',()=>{
  it('claims exact ledger identities, restores only its previous production and independently checks routing',async()=>{
    const c=control(),result=await recoverStudioProduction(env,scope,c);
    expect(result.outcome).toBe('provider_restored');expect(c.claimOnce).toHaveBeenCalledTimes(1);
    expect(c.claimOnce.mock.calls[0][0]).toMatchObject({attemptId:scope.id,previousProductionDeploymentId:previous,previousSourceCommit:baseline});
    expect(posts()).toHaveLength(1);expect(posts()[0][0]).toBe(base+'/deployments/'+previous+'/rollback');
    expect(posts()[0][1]).toMatchObject({redirect:'manual',headers:{Authorization:`Bearer ${env.STUDIO_CLOUDFLARE_API_TOKEN}`}});
    expect(c.record).toHaveBeenCalledWith(c.claimOnce.mock.calls[0][0],'provider_restored');
    expect(JSON.stringify(result)).not.toMatch(/provider-secret|test-private-token|env_vars|rollbackVerified/);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe(base);
  });
  it('does not need publishing enabled to recover an incident',async()=>{
    expect((await recoverStudioProduction(env,scope,control())).outcome).toBe('provider_restored');
    expect(vi.mocked(fetch).mock.calls.every(([url])=>!String(url).includes('studio_sites'))).toBe(true);
  });
  it.each([undefined,'short','long-enough-but\ninvalid-token'])('rejects a missing or invalid server token before storage',async token=>{
    expect((await recoverStudioProduction({STUDIO_CLOUDFLARE_API_TOKEN:token},scope,control())).outcome).toBe('blocked');
    expect(mocks.get).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects other clients and invalid attempt IDs before any access',async()=>{
    for(const s of [{...scope,clientId:production},{...scope,id:'../other'}])expect((await recoverStudioProduction(env,s,control())).outcome).toBe('blocked');
    expect(mocks.get).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{environment:'preview',branch:'codex/studio-publish-preview'},{stage:'reserved'},
    {previous_production_deployment_id:null},{provider_deployment_id:null},{previous_production_deployment_id:production},
    {previous_production_deployment_id:'../escape'},{client_id:production}])('blocks invalid ledger recovery identity %j',async patch=>{
    mocks.get.mockResolvedValue({...attempt,...patch});
    expect((await recoverStudioProduction(env,scope,control())).outcome).toBe('blocked');expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{environment:'preview'},{project_name:'other'},{latest_stage:{name:'deploy',status:'failure'}},
    {deployment_trigger:{metadata:{branch:'other',commit_hash:baseline,commit_dirty:false}}},
    {url:'https://attacker.invalid'},{id:production}])('rejects independently invalid rollback target %j',async patch=>{
    previousData={...previousData,...patch} as typeof previousData;
    expect((await recoverStudioProduction(env,scope,control())).outcome).toBe('blocked');expect(posts()).toHaveLength(0);
  });
  it.each([{name:'other'},{production_branch:'other'},{domains:[]},{canonical_deployment:deployment(scope.id,source)}])('blocks project or current-production drift %j',async patch=>{
    projectOverride=patch;expect((await recoverStudioProduction(env,scope,control())).outcome).toBe('blocked');expect(posts()).toHaveLength(0);
  });
  it('reports an already-current baseline without pretending a recovery was performed',async()=>{
    canonicalId=previous;const c=control();expect((await recoverStudioProduction(env,scope,c)).outcome).toBe('previous_current');
    expect(c.claimOnce).not.toHaveBeenCalled();expect(c.record).not.toHaveBeenCalled();expect(posts()).toHaveLength(0);
  });
  it('never mutates without the durable control port',async()=>{
    expect((await recoverStudioProduction(env,scope,undefined as never)).outcome).toBe('blocked');expect(fetch).not.toHaveBeenCalled();
  });
  it('never replays a consumed claim',async()=>{
    const c=control();c.claimOnce.mockResolvedValue(false);
    expect((await recoverStudioProduction(env,scope,c)).outcome).toBe('already_claimed');expect(posts()).toHaveLength(0);
  });
  it('never writes after an uncertain claim response and suppresses its error details',async()=>{
    const c=control();c.claimOnce.mockRejectedValue(Error('private database contents'));
    expect(await recoverStudioProduction(env,scope,c)).toEqual({outcome:'ambiguous'});expect(posts()).toHaveLength(0);
  });
  it('rechecks provider drift after the claim',async()=>{
    const c=control();c.claimOnce.mockImplementation(async()=>{canonicalId=scope.id;return true;});
    expect((await recoverStudioProduction(env,scope,c)).outcome).toBe('blocked');expect(posts()).toHaveLength(0);
    expect(c.record.mock.calls[0][1]).toBe('blocked');
  });
  it('rechecks ledger drift after the claim',async()=>{
    const c=control();c.claimOnce.mockImplementation(async()=>{mocks.get.mockResolvedValue({...attempt,content_hash:'d'.repeat(64)});return true;});
    expect((await recoverStudioProduction(env,scope,c)).outcome).toBe('blocked');expect(posts()).toHaveLength(0);
  });
  it.each([302,403,500])('keeps HTTP %i mutations ambiguous with no retry',async status=>{
    rollbackResponse=()=>new Response('private',{status});const c=control();
    expect((await recoverStudioProduction(env,scope,c)).outcome).toBe('ambiguous');expect(posts()).toHaveLength(1);
    expect(c.record.mock.calls[0][1]).toBe('ambiguous');
  });
  it('keeps a lost mutating response ambiguous even if the provider performed the rollback',async()=>{
    rollbackResponse=()=>{canonicalId=previous;throw Error('network private');};const c=control();
    expect((await recoverStudioProduction(env,scope,c)).outcome).toBe('ambiguous');expect(posts()).toHaveLength(1);
    expect((await observeStudioProductionRecovery(env,scope)).outcome).toBe('previous_current');expect(posts()).toHaveLength(1);
  });
  it.each([()=>ok({id:production}),()=>ok({}),()=>new Response('not JSON'),()=>new Response('x'.repeat(1048577))])('rejects uncertain mutation bodies',async response=>{
    rollbackResponse=response;expect((await recoverStudioProduction(env,scope,control())).outcome).toBe('ambiguous');expect(posts()).toHaveLength(1);
  });
  it('does not equate a successful POST with restored production',async()=>{
    rollbackResponse=()=>ok(previousData);expect((await recoverStudioProduction(env,scope,control())).outcome).toBe('ambiguous');
  });
  it('requires a durable outcome write before reporting restored routing',async()=>{
    const c=control();c.record.mockRejectedValue(Error('private'));
    expect(await recoverStudioProduction(env,scope,c)).toEqual({outcome:'ambiguous'});expect(posts()).toHaveLength(1);
  });
  it('read-only inspection never claims, mutates or returns provider configuration',async()=>{
    const result=await observeStudioProductionRecovery(env,scope);expect(result.outcome).toBe('production_current');
    expect(posts()).toHaveLength(0);expect(JSON.stringify(result)).not.toMatch(/provider-secret|env_vars/);
  });
  it('sanitizes storage failures and provider read errors',async()=>{
    mocks.get.mockRejectedValue(Error('private'));expect(await observeStudioProductionRecovery(env,scope)).toEqual({outcome:'unavailable'});
    mocks.get.mockResolvedValue(attempt);vi.mocked(fetch).mockResolvedValue(new Response('private',{status:500}));
    expect(await observeStudioProductionRecovery(env,scope)).toEqual({outcome:'unavailable'});expect(posts()).toHaveLength(0);
  });
});
