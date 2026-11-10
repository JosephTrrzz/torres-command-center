import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../functions/_shared/studio-access',()=>({studioAccess:vi.fn()}));
vi.mock('../functions/_shared/studio-cloudflare',()=>({
 STUDIO_CLOUDFLARE_TARGET:{client:'06edc104-71e0-4359-8cb3-42529d65b5d1'},
 verifyStudioCloudflareCredential:vi.fn(),
}));
import {studioAccess} from '../functions/_shared/studio-access';
import {verifyStudioCloudflareCredential} from '../functions/_shared/studio-cloudflare';
import {onRequest} from '../functions/api/website/publishing-health';
const access={staff:true,clientId:'06edc104-71e0-4359-8cb3-42529d65b5d1',context:{}};
const call=(method='GET',origin?:string)=>onRequest({request:new Request('https://app.example/api/website/publishing-health',{method,headers:origin?{Origin:origin}:{}}),env:{STUDIO_CLOUDFLARE_API_TOKEN:'unit-test-token'}});
beforeEach(()=>{vi.mocked(studioAccess).mockResolvedValue(access as never);vi.mocked(verifyStudioCloudflareCredential).mockResolvedValue({credential:'verified',sourceCommit:'a'.repeat(40),deploymentId:'deployment-1'});});
afterEach(()=>vi.clearAllMocks());
describe('publishing connection diagnostic access',()=>{
 it('denies foreign origins before authentication or provider access',async()=>{expect((await call('GET','https://evil.example')).status).toBe(403);expect(studioAccess).not.toHaveBeenCalled();expect(verifyStudioCloudflareCredential).not.toHaveBeenCalled()});
 it('only accepts read-only requests',async()=>{expect((await call('POST')).status).toBe(405);expect(verifyStudioCloudflareCredential).not.toHaveBeenCalled()});
 it.each([{...access,staff:false},{...access,clientId:'another-client'}])('denies clients and unassigned admins',async value=>{vi.mocked(studioAccess).mockResolvedValue(value as never);expect((await call()).status).toBe(403);expect(verifyStudioCloudflareCredential).not.toHaveBeenCalled()});
 it('propagates missing authentication without contacting the provider',async()=>{vi.mocked(studioAccess).mockResolvedValue({response:new Response(null,{status:401})});expect((await call()).status).toBe(401);expect(verifyStudioCloudflareCredential).not.toHaveBeenCalled()});
 it('never advertises publication readiness from credential validity alone',async()=>{const r=await call();expect(r.status).toBe(200);const text=await r.text();expect(JSON.parse(text)).toMatchObject({ready:false,sourceMatches:false,credential:'verified'});expect(text).not.toContain('unit-test-token')});
});
