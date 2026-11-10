import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import manifest from '../lib/canvas-manifest.json';
import {onRequest} from '../functions/api/website/reconcile';
import {reconcilePublication} from '../functions/_shared/studio-reconcile';
vi.mock('../functions/_shared/studio-access',()=>({studioStore:()=>({rest:'https://storage.example/rest/v1',headers:{}})}));
vi.mock('../functions/_shared/studio-reconcile',()=>({reconcilePublication:vi.fn(async()=>({publication:null}))}));
vi.mock('../functions/_shared/studio-publisher',()=>({publisherReady:vi.fn(async()=>true)}));
const secret='x'.repeat(64);
const env={STUDIO_CRON_SECRET:secret,SUPABASE_SERVICE_ROLE_KEY:'test-only',STUDIO_PUBLISHER:{fetch:vi.fn()}};
const release={id:'22222222-2222-4222-8222-222222222222',client_id:'11111111-1111-4111-8111-111111111111',snapshot_id:manifest.id,status:'queued'};
const site={public_url:manifest.source,canvas_snapshot_id:manifest.id,enabled:true,publishing_enabled:true};
const json=(data:unknown)=>new Response(JSON.stringify(data));
let fetcher:ReturnType<typeof vi.fn>;
const call=(token=secret,method='POST',environment=env)=>onRequest({env:environment,request:new Request('https://app.example/api/website/reconcile',{method,headers:{'x-torres-studio-secret':token}})});
beforeEach(()=>{fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);vi.mocked(reconcilePublication).mockClear();});
afterEach(()=>vi.unstubAllGlobals());
describe('publication background reconciliation',()=>{
 it('refuses missing or incorrect scheduler credentials before reading drafts',async()=>{
  expect((await call('')).status).toBe(401);expect((await call('y'.repeat(64))).status).toBe(401);expect(fetcher).not.toHaveBeenCalled();
 });
 it('never allows a GET request to advance publication',async()=>{expect((await call(secret,'GET')).status).toBe(405);expect(fetcher).not.toHaveBeenCalled()});
 it('advances an already approved release without an open editor',async()=>{
  fetcher.mockResolvedValueOnce(json([release])).mockResolvedValueOnce(json([site]));
  expect(await (await call()).json()).toEqual({checked:1,deferred:0});
  expect(reconcilePublication).toHaveBeenCalledWith(env,release);
  expect(fetcher.mock.calls[0][0]).toContain('limit=3');
 });
 it('blocks new delivery after enrollment is disabled',async()=>{
  fetcher.mockResolvedValueOnce(json([release])).mockResolvedValueOnce(json([{...site,publishing_enabled:false}]));
  expect(await (await call()).json()).toEqual({checked:0,deferred:1});expect(reconcilePublication).not.toHaveBeenCalled();
 });
 it('continues observing a dispatched release after enrollment is disabled',async()=>{
  fetcher.mockResolvedValueOnce(json([{...release,status:'deploying'}])).mockResolvedValueOnce(json([{...site,publishing_enabled:false}]));
  expect(await (await call()).json()).toEqual({checked:1,deferred:0});
 });
 it('does not deliver to a mismatched website',async()=>{
  fetcher.mockResolvedValueOnce(json([release])).mockResolvedValueOnce(json([{...site,public_url:'https://different.example'}]));
  expect(await (await call()).json()).toEqual({checked:0,deferred:1});expect(reconcilePublication).not.toHaveBeenCalled();
 });
 it('keeps temporary failures pending rather than reporting success',async()=>{
  fetcher.mockResolvedValueOnce(json([release])).mockRejectedValueOnce(Error('offline'));
  expect(await (await call()).json()).toEqual({checked:0,deferred:1});
 });
});
