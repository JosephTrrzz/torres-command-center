import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import manifest from '../lib/canvas-manifest.json';
vi.mock('../functions/_shared/studio-access',()=>({studioAccess:vi.fn(async()=>({clientId:'client-a',context:{userId:'user-a'}})),studioStore:()=>({rest:'https://storage.example/rest/v1',headers:{}})}));
import {onRequest} from '../functions/api/website/canvas-drafts';
import {studioAccess} from '../functions/_shared/studio-access';
const site={name:'My site',public_url:manifest.source,canvas_snapshot_id:manifest.id};
let fetcher:ReturnType<typeof vi.fn>;
const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
const call=(suffix='',body?:object)=>onRequest({request:new Request('https://app.example/api/website/canvas-drafts'+suffix,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),env:{} as never});
beforeEach(()=>{fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);fetcher.mockResolvedValueOnce(json([site]));});
afterEach(()=>vi.unstubAllGlobals());
describe('private saved checkpoints',()=>{
 it('lists only six explicit saves under the authorized site and client',async()=>{
  fetcher.mockResolvedValueOnce(json([{revision:9,created_at:'2026-11-09T23:00:00Z'}]));
  const response=await call('?history=1&client=another-client');expect(response.status).toBe(200);
  const url=fetcher.mock.calls[1][0];expect(url).toContain('client_id=eq.client-a');expect(url).toContain('snapshot_id=eq.'+manifest.id);expect(url).toContain('is_checkpoint=eq.true');expect(url).toContain('limit=6');expect(url).not.toContain('another-client');
 });
 it('does not expose unlisted or autosaved versions',async()=>{fetcher.mockResolvedValueOnce(json([{revision:9}]));expect((await call('?version=8')).status).toBe(404);expect(fetcher).toHaveBeenCalledTimes(2)});
 it('returns an available saved draft with the same scope',async()=>{fetcher.mockResolvedValueOnce(json([{revision:9}])).mockResolvedValueOnce(json([{revision:9,draft:{0:{}}}]));expect((await (await call('?version=9')).json()).draft).toEqual({0:{}});expect(fetcher.mock.calls[2][0]).toContain('client_id=eq.client-a')});
 it.each([true,false])('records explicit checkpoint=%s without changing optimistic locking',async checkpoint=>{
  fetcher.mockResolvedValueOnce(json([{revision:3}])).mockResolvedValueOnce(json([{revision:4}]));
  expect((await call('',{snapshotId:manifest.id,revision:3,draft:{},checkpoint})).status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({client_id:'client-a',actor_id:'user-a',is_checkpoint:checkpoint,revision:4});
 });
 it('rejects stale saved checkpoints',async()=>{fetcher.mockResolvedValueOnce(json([{revision:4}]));expect((await call('',{snapshotId:manifest.id,revision:3,draft:{},checkpoint:true})).status).toBe(409);expect(fetcher).toHaveBeenCalledTimes(2)});
 it('rejects unauthenticated access before reading storage',async()=>{vi.mocked(studioAccess).mockResolvedValueOnce({response:new Response(null,{status:401})} as never);expect((await call('?history=1')).status).toBe(401);expect(fetcher).not.toHaveBeenCalled()});
});
