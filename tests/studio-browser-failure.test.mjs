import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,access,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {browserFailureCode,browserAssertionCode,expectedAttestation,PROOF_PATH} from '../scripts/studio-verify-export.mjs';
import {runStudioSourceBuild} from '../scripts/studio-source-build.mjs';
import {fixture,env,sourceCommit} from './studio-source-build.fixture.mjs';
const privateText='https://private.invalid/?token=SECRET private saved text';
const timeout=()=>Object.assign(new Error(privateText),{name:'TimeoutError'});
async function writeTree(root,files){for(const [path,bytes]of Object.entries(files)){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);}}
describe('safe browser failure classification',()=>{
  it.each([
    ['Host system is missing dependencies to run browsers.','browser-launch-missing-libraries'],
    ['chrome: error while loading shared libraries: libnss3.so: cannot open shared object file','browser-launch-missing-libraries'],
    ['Missing libraries: libatk-1.0.so.0','browser-launch-missing-libraries'],
    ["Executable doesn't exist at /private/browser",'browser-launch-executable-missing'],
    ['sandbox startup failed','browser-launch-failed'],
  ])('classifies launch without exposing messages: %s',(message,expected)=>{
    expect(browserFailureCode(new Error(message+' '+privateText),'launch')).toBe(expected);
  });
  it('distinguishes launch timeout, operation timeout, assertion, and unknown failures',()=>{
    expect(browserFailureCode(timeout(),'launch')).toBe('browser-launch-timeout');
    expect(browserFailureCode(timeout(),'direct-route')).toBe('browser-verification-timeout-direct-route');
    try{expectedAttestation({artifact:{}});}catch(error){expect(browserFailureCode(error)).toBe('browser-verification-assertion-identity');}
    for(const error of [new Error(privateText),{code:privateText},null,privateText])expect(browserFailureCode(error)).toBe('browser-verification-failed');
    // Page errors mentioning library names must not be mistaken for a launch failure.
    expect(browserFailureCode(new Error('Missing libraries: '+privateText),'direct-route')).toBe('browser-verification-failed');
  });
  it.each(['route-marker','responsive-content-clipped','form-validity','script-load','patch-result-style'])('exposes only known assertion literal %s',code=>{
    expect(browserAssertionCode(code)).toBe('browser-verification-assertion-'+code);
  });
  it('never echoes unknown assertion codes, forged errors, or timeout phases',()=>{
    for(const code of [privateText,'route-marker '+privateText,'patch-result-style-'+privateText,'__proto__',null,{}])expect(browserAssertionCode(code)).toBe('browser-verification-assertion');
    for(const phase of [privateText,'direct-route '+privateText,undefined])expect(browserFailureCode(timeout(),phase)).toBe('browser-verification-timeout');
    expect(browserFailureCode({message:'Export verification failed: route-marker',code:'route-marker'})).toBe('browser-verification-failed');
    for(const phase of ['browser-context','direct-route','brand-navigation-home','client-navigation-away','client-navigation-back'])expect(browserFailureCode(timeout(),phase)).toBe('browser-verification-timeout-'+phase);
  });
  it.each([
    ['missing-libraries',()=>{throw Error('error while loading shared libraries: libnss3.so '+privateText);},'browser-launch-missing-libraries'],
    ['launch-timeout',()=>{throw timeout();},'browser-launch-timeout'],
    ['launch-failed',()=>{throw Error(privateText);},'browser-launch-failed'],
    ['assertion',()=>({newContext:async()=>({route:async()=>{},newPage:async()=>({setDefaultTimeout(){},setDefaultNavigationTimeout(){},on(){},addInitScript:async()=>{},goto:async()=>({status:()=>500}),evaluate:async()=>{throw Error(privateText);}})}),close:async()=>{}}),'browser-verification-assertion-route-response'],
    ['operation-timeout',()=>({newContext:async()=>{throw timeout();},close:async()=>{}}),'browser-verification-timeout-browser-context'],
  ])('runner emits only fixed code and never writes proof for %s',async(_name,launch,code)=>{
    const root=await mkdtemp(join(tmpdir(),'studio-safe-error-'));const {approved,files}=await fixture({});let fetches=0;
    try{
      await writeTree(root,{'package.json':'{"dependencies":{"next":"16.2.6"}}','node_modules/next/package.json':'{"version":"16.2.6"}','node_modules/next/dist/bin/next':'fixture'});
      await mkdir(join(root,'node_modules/.bin'),{recursive:true});await symlink('../next/dist/bin/next',join(root,'node_modules/.bin/next'));
      let error;try{await runStudioSourceBuild({cwd:root,env},{
        browserOptions:{browserType:{launch},onDiagnostic:async()=>{throw Error(privateText);}},
        fetchImpl:async()=>{fetches++;return Response.json(approved);},
        runProcess:async(cmd,args)=>{if(cmd==='git')return args[0]==='rev-parse'?sourceCommit+'\n':'';await writeTree(join(root,'out'),files);return '';},
      });}catch(caught){error=caught;}
      expect(error?.message).toBe(`Studio source build stopped: ${code}.`);
      expect(error?.stack).not.toContain(privateText);expect(error?.cause).toBeUndefined();
      expect(fetches).toBe(2);await expect(access(join(root,'out',PROOF_PATH))).rejects.toThrow();
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
