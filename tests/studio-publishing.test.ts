import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import manifest from '../lib/canvas-manifest.json';
import {contentHash,matchingReceipt,verifyLivePages,publisherReady,type Publication} from '../functions/_shared/studio-publisher';
vi.mock('../functions/_shared/studio-access',()=>({studioAccess:vi.fn(async()=>({clientId:'11111111-1111-4111-8111-111111111111',context:{userId:'verified-actor'}})),studioStore:()=>({rest:'https://storage.example/rest/v1',headers:{}})}));
import {onRequest} from '../functions/api/website/publish';
import {studioAccess} from '../functions/_shared/studio-access';
import {reconcilePublication} from '../functions/_shared/studio-reconcile';
const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
const release:Publication={id:'22222222-2222-4222-8222-222222222222',client_id:'11111111-1111-4111-8111-111111111111',revision:3,snapshot_id:manifest.id,status:'queued',content_hash:null,deployment_id:null,created_at:'2026-11-10T00:00:00Z',verified_at:null};
const site={name:'Torres',public_url:manifest.source,canvas_snapshot_id:manifest.id,publishing_enabled:true};
const capability={protocol:1,clientId:release.client_id,snapshotId:manifest.id,publicUrl:manifest.source,safeRenderer:true,durableIdempotency:true,rollback:true};
const binding={fetch:vi.fn(async(_request:Request)=>json(capability))};
let fetcher:ReturnType<typeof vi.fn>;
const call=(body?:unknown,env:object={STUDIO_PUBLISHER:binding},origin?:string)=>onRequest({env,request:new Request('https://app.example/api/website/publish',body!==undefined?{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)}:{})});
const begin={action:'begin',snapshotId:manifest.id,revision:3,requestKey:'33333333-3333-4333-8333-333333333333'};
beforeEach(()=>{fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);binding.fetch.mockReset().mockImplementation(async()=>json(capability));vi.mocked(studioAccess).mockResolvedValue({clientId:release.client_id,context:{userId:'verified-actor'}} as never);});
afterEach(()=>{vi.unstubAllGlobals()});
function initial(){fetcher.mockResolvedValueOnce(json([site])).mockResolvedValueOnce(json([]));}
describe('publishing boundaries',()=>{
 it('rejects foreign origins before identity or storage',async()=>{expect((await call(begin,{},'https://evil.example')).status).toBe(403);expect(fetcher).not.toHaveBeenCalled();});
 it('requires authenticated own-site access before storage',async()=>{vi.mocked(studioAccess).mockResolvedValueOnce({response:new Response(null,{status:403})} as never);expect((await call(begin)).status).toBe(403);expect(fetcher).not.toHaveBeenCalled();});
 it('stays disabled without a private publishing connection',async()=>{initial();const r=await call(undefined,{});expect(await r.json()).toMatchObject({ready:false,publication:null});expect(binding.fetch).not.toHaveBeenCalled();});
 it('does not create a release when the connection is absent',async()=>{initial();expect((await call(begin,{})).status).toBe(503);expect(fetcher).toHaveBeenCalledTimes(2)});
 it('checks the approved site and source snapshot',async()=>{fetcher.mockResolvedValueOnce(json([{...site,public_url:'https://other.example'}]));expect((await call(begin)).status).toBe(403);expect(binding.fetch).not.toHaveBeenCalled()});
 it.each([{...begin,clientId:'other'},{...begin,draft:{script:'evil'}},{...begin,revision:0},{...begin,requestKey:'../other'},[],null])('rejects browser target/payload/version manipulation: %j',async body=>{initial();expect((await call(body)).status).toBe(400);expect(fetcher).toHaveBeenCalledTimes(2)});
 it('surfaces stale revision/duplicate conflicts without contacting deployment',async()=>{initial();fetcher.mockResolvedValueOnce(new Response(null,{status:409}));expect((await call(begin)).status).toBe(409);expect(binding.fetch).toHaveBeenCalledTimes(1);const payload=JSON.parse(fetcher.mock.calls[2][1].body);expect(payload).toMatchObject({p_actor:'verified-actor',p_client:release.client_id,p_revision:3})});
 it('does not expose foreign publication IDs',async()=>{initial();fetcher.mockResolvedValueOnce(json([]));expect((await call({action:'check',id:release.id})).status).toBe(404);expect(fetcher.mock.calls[2][0]).toContain('client_id=eq.'+release.client_id)});
 it('uses a database lease to stop concurrent delivery attempts',async()=>{initial();fetcher.mockResolvedValueOnce(json(release)).mockResolvedValueOnce(json([]));const data=await (await call(begin)).json();expect(data.publication.status).toBe('queued');expect(binding.fetch).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[3][0]).toContain('next_check_at=lte.')});
 it('retries the same immutable release after ambiguous service failure',async()=>{
  initial();fetcher.mockResolvedValueOnce(json(release)).mockResolvedValueOnce(json([release])).mockResolvedValueOnce(json([{draft:{0:{}}}]));
  const digest=await contentHash({snapshotId:manifest.id,revision:3,draft:{0:{}}});
  fetcher.mockResolvedValueOnce(json([{...release,content_hash:digest}]));
  binding.fetch.mockResolvedValueOnce(json(capability)).mockRejectedValueOnce(Error('timeout'));
  const data=await (await call(begin)).json();expect(data.publication.status).toBe('queued');expect(data.message).toContain('confirmation');
  const payload=await (binding.fetch.mock.calls[1][0] as Request).json();expect(payload).toMatchObject({releaseId:release.id,contentHash:digest,draft:{0:{}}});
  expect(fetcher.mock.calls[5][0]).toContain('next_check_at=eq.');
 });
 it('does not dispatch if a newer worker owns the lease before the hash is saved',async()=>{
  initial();fetcher.mockResolvedValueOnce(json(release)).mockResolvedValueOnce(json([release])).mockResolvedValueOnce(json([{draft:{0:{}}}])).mockResolvedValueOnce(json([]));
  const result=await (await call(begin)).json();
  expect(result.publication.status).toBe('queued');expect(binding.fetch).toHaveBeenCalledTimes(1);
 });
});
describe('publication recovery',()=>{
 it('fails an invalid undispatched draft without calling the provider',async()=>{
  fetcher.mockResolvedValueOnce(json([release]))
   .mockResolvedValueOnce(json([{draft:{0:{bad:{html:'<script>bad</script>'}}}}]))
   .mockResolvedValueOnce(json([{...release,status:'failed'}]));
  const result=await reconcilePublication({STUDIO_PUBLISHER:binding},release);
  expect(result.publication?.status).toBe('failed');
  expect(binding.fetch).not.toHaveBeenCalled();
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({status:'failed'});
 });
 it('keeps an ambiguously dispatched release pending when its draft is unavailable',async()=>{
  const pending={...release,content_hash:'a'.repeat(64)};
  fetcher.mockResolvedValueOnce(json([pending])).mockResolvedValueOnce(json([]));
  binding.fetch.mockResolvedValueOnce(new Response(null,{status:404}));
  const result=await reconcilePublication({STUDIO_PUBLISHER:binding},pending);
  expect(result.publication?.status).toBe('queued');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(binding.fetch).toHaveBeenCalledTimes(1);
  expect(binding.fetch.mock.calls[0][0].method).toBe('GET');
 });
 it.each(['queued','deploying'] as const)('recovers a %s deployment without reading draft storage',async(status)=>{
  const pending={...release,status,content_hash:'a'.repeat(64),deployment_id:'deployment-1'};
  fetcher.mockResolvedValueOnce(json([pending])).mockResolvedValueOnce(json([{...pending,status:'deploying'}]));
  binding.fetch.mockResolvedValueOnce(json({releaseId:pending.id,clientId:pending.client_id,
   snapshotId:pending.snapshot_id,revision:pending.revision,contentHash:pending.content_hash,
   deploymentId:pending.deployment_id,status:'building'}));
  const result=await reconcilePublication({STUDIO_PUBLISHER:binding},pending);
  expect(result.publication?.status).toBe('deploying');
  expect(binding.fetch.mock.calls[0][0].method).toBe('GET');
  expect(binding.fetch.mock.calls[0][0].url).toContain('/releases/'+pending.id);
  expect(fetcher.mock.calls.every(([url])=>!String(url).includes('studio_canvas_drafts'))).toBe(true);
 });
 it('does not unlock a deployment on a provider timeout',async()=>{
  const pending={...release,status:'deploying' as const,content_hash:'a'.repeat(64),deployment_id:'deployment-1'};
  fetcher.mockResolvedValueOnce(json([pending]));
  binding.fetch.mockRejectedValueOnce(Error('timeout'));
  const result=await reconcilePublication({STUDIO_PUBLISHER:binding},pending);
  expect(result.publication?.status).toBe('deploying');
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
describe('live evidence',()=>{
 it('hashes equivalent object order identically and edited content differently',async()=>{expect(await contentHash({a:1,b:2})).toBe(await contentHash({b:2,a:1}));expect(await contentHash({a:2})).not.toBe(await contentHash({a:1}))});
 it.each(['clientId','releaseId','snapshotId','contentHash','revision','deploymentId'])('rejects mismatched provider %s',field=>{
  const p={...release,content_hash:'a'.repeat(64),deployment_id:'deployment-1'};
  const receipt={clientId:p.client_id,releaseId:p.id,snapshotId:p.snapshot_id,revision:p.revision,contentHash:p.content_hash,deploymentId:p.deployment_id};
  expect(matchingReceipt(receipt,p)).toBe(true);expect(matchingReceipt({...receipt,[field]:'other'},p)).toBe(false);
 });
 it('refuses incompatible renderer capabilities',async()=>{binding.fetch.mockResolvedValueOnce(json({...capability,snapshotId:'old'}));expect(await publisherReady({STUDIO_PUBLISHER:binding},release.client_id)).toBe(false)});
 it('requires release markers from all eleven public pages',async()=>{
  const p={...release,content_hash:'a'.repeat(64)};
  fetcher.mockImplementation(async()=>new Response('<head><meta name="torres-studio-release" content="'+p.id+':'+p.content_hash+'"></head>',{headers:{'Content-Type':'text/html'}}));
  expect(await verifyLivePages(p)).toBe(true);expect(fetcher).toHaveBeenCalledTimes(11);
  for(const [url,options]of fetcher.mock.calls){expect(new URL(url).origin).toBe(manifest.source);expect(new URL(url).search).toBe('');expect(options.redirect).toBe('error')}
 });
 it('rejects a release visible only at a cache-busting URL',async()=>{
  fetcher.mockImplementation(async(url:URL)=>new Response(url.search ? '<meta name="torres-studio-release" content="'+release.id+':null">' : '<head>previous release</head>',{headers:{'Content-Type':'text/html'}}));
  expect(await verifyLivePages(release)).toBe(false);
 });
 it('does not call accepted or partially deployed releases live',async()=>{fetcher.mockImplementation(async()=>new Response('<head>old content</head>',{headers:{'Content-Type':'text/html'}}));expect(await verifyLivePages(release)).toBe(false)});
 it('rejects a marker beyond the bounded page head',async()=>{fetcher.mockImplementation(async()=>new Response('x'.repeat(65536)+'<meta name="torres-studio-release" content="'+release.id+':null">',{headers:{'Content-Type':'text/html'}}));expect(await verifyLivePages(release)).toBe(false)});
});
