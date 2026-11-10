import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {onRequest} from '../functions/api/website/canvas-drafts';
import {studioAccess} from '../functions/_shared/studio-access';
import {canvasDraftIssue} from '../lib/canvas-draft';
import manifest from '../lib/canvas-manifest.json';
vi.mock('../functions/_shared/studio-access',async original=>({...await original<typeof import('../functions/_shared/studio-access')>(),studioAccess:vi.fn()}));
const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-only'};
const client='00000000-0000-4000-8000-000000000001';
function call(body?:object){return onRequest({env,request:new Request('https://app.test/api/website/canvas-drafts',{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})})}
const site={name:'Website',public_url:manifest.source,canvas_snapshot_id:manifest.id};
function stub(rows:unknown[]=[],insertStatus=201){return vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{if(input.includes('/studio_sites'))return Response.json([site]);if(init?.method==='POST')return Response.json(insertStatus===201?[{revision:1}]:{error:'conflict'},{status:insertStatus});return Response.json(rows)}));}
beforeEach(()=>{vi.mocked(studioAccess).mockResolvedValue({clientId:client,staff:false,context:{userId:'verified-user'}} as Awaited<ReturnType<typeof studioAccess>>);stub()});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()});
describe('private canvas drafts',()=>{
 it('requires existing authenticated client access before touching storage',async()=>{vi.mocked(studioAccess).mockResolvedValue({response:new Response(null,{status:403})});expect((await call()).status).toBe(403);expect(fetch).not.toHaveBeenCalled()});
 it('loads only the verified client and source snapshot',async()=>{const res=await call();expect(res.status).toBe(200);expect(await res.json()).toMatchObject({clientId:client,draft:{},revision:0});for(const [url] of vi.mocked(fetch).mock.calls)expect(String(url)).toContain('client_id=eq.'+client)});
 it('fails closed on unassigned website snapshot',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json([{...site,canvas_snapshot_id:null}])));expect((await call()).status).toBe(403)});
 it('saves immutable drafts with server-derived actor and scope',async()=>{expect((await call({snapshotId:manifest.id,revision:0,draft:{0:{$content:{title:{text:'Private'}}}}})).status).toBe(200);const args=vi.mocked(fetch).mock.calls.at(-1)!;expect(JSON.parse(String(args[1]?.body))).toMatchObject({client_id:client,actor_id:'verified-user',revision:1});expect(String(args[0])).not.toContain('publication')});
 it('rejects caller identity fields and prototype keys',async()=>{expect((await call({snapshotId:manifest.id,revision:0,draft:{},client_id:'other'})).status).toBe(400);expect(canvasDraftIssue(JSON.parse('{"0":{"__proto__":{}}}'))).toBeTruthy()});
 it('rejects stale saves and concurrent inserts',async()=>{stub([{revision:2,draft:{}}]);expect((await call({snapshotId:manifest.id,revision:1,draft:{}})).status).toBe(409);stub([],409);expect((await call({snapshotId:manifest.id,revision:0,draft:{}})).status).toBe(409)});
 it('bounds size and shape without accepting a publication action',async()=>{expect(canvasDraftIssue([])).toBeTruthy();expect(canvasDraftIssue({0:{text:'a'.repeat(3000001)}})).toBeTruthy();expect((await call({snapshotId:manifest.id,revision:0,draft:{},action:'publish'})).status).toBe(400)});
});
