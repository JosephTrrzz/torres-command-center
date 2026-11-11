import {beforeEach,describe,it,expect,vi} from 'vitest';
const create=vi.hoisted(()=>vi.fn(()=>({fetch:vi.fn()})));
vi.mock('../functions/_shared/studio-cloudflare-adapter',()=>({createStudioCloudflareAdapter:create,verifyStudioCloudflareDeployment:()=>null}));
import {withStudioPublisher} from '../functions/_shared/studio-publishing-connection';
import {TORRES_SOURCE_COMMIT} from '../functions/_shared/studio-torres-artifact';
const credentials={STUDIO_CLOUDFLARE_API_TOKEN:'private-provider',SUPABASE_SERVICE_ROLE_KEY:'private-storage'};
beforeEach(()=>create.mockClear());
describe('publishing connection activation',()=>{
 it.each([{},{STUDIO_CLOUDFLARE_API_TOKEN:'private'},{SUPABASE_SERVICE_ROLE_KEY:'private'}])('requires both server credentials even for observation: %j',env=>{
  expect(withStudioPublisher(env)).toBe(env);expect(create).not.toHaveBeenCalled();
 });
 it.each([undefined,'not-json','null','[]',JSON.stringify({sourceCommit:'0'.repeat(40)}),'x'.repeat(4097)])('keeps credentialed observation with invalid or absent enrollment: %s',async value=>{
  const env={...credentials,STUDIO_BUILD_INPUT_SECRET:'x'.repeat(43),STUDIO_PUBLISHING_ENROLLMENT:value};
  expect(withStudioPublisher(env).STUDIO_PUBLISHER).toBeDefined();
  const options=(create.mock.calls.at(-1) as unknown as [unknown,{loadEnrollmentEvidence:()=>Promise<unknown>}])[1];
  expect(await options.loadEnrollmentEvidence()).toBeNull();
 });
 it('does not expose enrollment without the separate build-input secret',async()=>{
  withStudioPublisher({...credentials,STUDIO_PUBLISHING_ENROLLMENT:JSON.stringify({sourceCommit:TORRES_SOURCE_COMMIT})});
  const options=(create.mock.calls.at(-1) as unknown as [unknown,{loadEnrollmentEvidence:()=>Promise<unknown>}])[1];
  expect(await options.loadEnrollmentEvidence()).toBeNull();
 });
 it('passes source-matched server evidence to the internal adapter for full validation',()=>{
  const env={...credentials,STUDIO_BUILD_INPUT_SECRET:'x'.repeat(43),STUDIO_PUBLISHING_ENROLLMENT:JSON.stringify({sourceCommit:TORRES_SOURCE_COMMIT})};
  expect(withStudioPublisher(env).STUDIO_PUBLISHER).toBeDefined();
  expect(create).toHaveBeenLastCalledWith(env,expect.objectContaining({sourceCommit:TORRES_SOURCE_COMMIT,loadEnrollmentEvidence:expect.any(Function),verifyDeployment:expect.any(Function)}));
 });
 it('preserves an existing private binding',()=>{
  const env={STUDIO_PUBLISHER:{fetch:vi.fn()}};expect(withStudioPublisher(env)).toBe(env);expect(create).not.toHaveBeenCalled();
 });
});
