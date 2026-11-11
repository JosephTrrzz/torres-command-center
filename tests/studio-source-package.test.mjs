import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {packageApprovedTorresArtifact,TORRES_ROUTES} from '../scripts/studio-source-package.mjs';
import {buildContext,validateApprovedInput,runStudioSourceBuild,fetchApprovedInput,runProcess} from '../scripts/studio-source-build.mjs';
import {packageTorresArtifact} from '../functions/_shared/studio-torres-package';
import {TORRES_SOURCE_COMMIT} from '../functions/_shared/studio-torres-artifact';
import {contentHash} from '../functions/_shared/studio-publisher';

const nextCommit='0123456789abcdef0123456789abcdef01234567';
const secret='s'.repeat(48);
const env={CF_PAGES:'1',CF_PAGES_COMMIT_SHA:nextCommit,CF_PAGES_URL:'https://12345678.torres-co-technology.pages.dev',CF_PAGES_BRANCH:'codex/studio-publish-preview',STUDIO_BUILD_ENVIRONMENT:'preview',STUDIO_BUILD_INPUT_SECRET:secret};
async function fixture(sourceCommit=nextCommit){
  const releaseId='22222222-2222-4222-8222-222222222222',hash='a'.repeat(64),script='"use strict";';
  const artifact={protocol:1,releaseId,contentHash:hash,sourceCommit,script,routes:[...TORRES_ROUTES],marker:`<meta name="torres-studio-release" content="${releaseId}:${hash}">`,assetPath:`/_studio/${await contentHash({script,sourceCommit,contentHash:hash})}.js`};
  const files=Object.fromEntries(TORRES_ROUTES.map(route=>[route==='/'?'index.html':route.slice(1)+'.html','<!DOCTYPE html><html><head><title>Original</title></head><body><form action="/api/contact" method="post"><input name="email"></form><script src="/original.js"></script></body></html>']));
  Object.assign(files,{'original.js':'/* original */','image.png':new Uint8Array([137,80,78,71]),'_headers':"/*\n Content-Security-Policy: default-src 'self'",'_redirects':'/old /contact 301','_routes.json':'{"version":1,"include":["/api/*"],"exclude":[]}'});
  return {artifact,sourceCommit,files};
}
const envelope=artifact=>({attemptId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',deploymentId:'12345678-aaaa-4aaa-8aaa-aaaaaaaaaaaa',artifact});
describe('portable source trust boundary',()=>{
  it('records the current server packager fingerprint and bundles no literal source pin',async()=>{
    const source=await readFile(new URL('../functions/_shared/studio-torres-package.ts',import.meta.url));
    const portable=await readFile(new URL('../scripts/studio-source-package.mjs',import.meta.url),'utf8');
    expect(portable).toContain('Package source SHA-256: '+createHash('sha256').update(source).digest('hex'));
    expect(portable).not.toContain(TORRES_SOURCE_COMMIT);
  });
  it('matches server packaging byte for byte at the existing reviewed pin',async()=>{
    const input=await fixture(TORRES_SOURCE_COMMIT);
    expect(await packageApprovedTorresArtifact(input)).toEqual(await packageTorresArtifact(input));
  });
  it('packages a different authenticated checkout without embedding its own commit; server remains pinned',async()=>{
    const input=await fixture(),before=structuredClone(input.files);
    const result=await packageApprovedTorresArtifact(input);
    expect(Object.keys(result.routeFiles)).toHaveLength(11);
    for(const path of ['original.js','image.png','_headers','_redirects','_routes.json'])expect(result.files[path]).toEqual(before[path]);
    for(const path of Object.values(result.routeFiles)){
      expect(result.files[path]).toContain(input.artifact.marker);
      expect(result.files[path]).toContain('<form action="/api/contact" method="post">');
    }
    expect(input.files).toEqual(before);
    await expect(packageTorresArtifact(input)).rejects.toThrow('pinned source');
  });
  it.each(['', 'short', 'A'.repeat(40), 'f'.repeat(40)])('refuses invalid or mismatched actual source %s',async sourceCommit=>{
    const input=await fixture();await expect(packageApprovedTorresArtifact({...input,sourceCommit})).rejects.toThrow('sourceCommit');
  });
  it('binds asset digest to source as well as script and content hash',async()=>{
    const input=await fixture();input.sourceCommit='f'.repeat(40);input.artifact.sourceCommit=input.sourceCommit;
    await expect(packageApprovedTorresArtifact(input)).rejects.toThrow('fingerprint');
  });
  it('still rejects missing routes and incompatible markers without mutating caller input',async()=>{
    for(const fault of ['missing','marker']){
      const input=await fixture();if(fault==='missing')delete input.files['contact.html'];else input.files['contact.html']=input.files['contact.html'].replace('<head>','<head><meta name="torres-studio-release" content="wrong">');
      const before=structuredClone(input.files);await expect(packageApprovedTorresArtifact(input)).rejects.toThrow();expect(input.files).toEqual(before);
    }
  });
  it('validates exact approved response schema and immutable deployment identity',async()=>{
    const {artifact}=await fixture(),context=buildContext(env),approved=envelope(artifact);
    expect(validateApprovedInput(approved,context,secret)).toEqual(approved);
    for(const bad of [{...approved,extra:true},{...approved,deploymentId:'99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{...approved,artifact:{...artifact,extra:true}},{...approved,artifact:{...artifact,sourceCommit:TORRES_SOURCE_COMMIT}}])expect(()=>validateApprovedInput(bad,context,secret)).toThrow();
  });
  it('refuses environment/actual HEAD disagreement before requesting any approval or building',async()=>{
    let fetched=false;const calls=[];
    await expect(runStudioSourceBuild({cwd:process.cwd(),env},{runProcess:async(command,args)=>{calls.push([command,args]);return TORRES_SOURCE_COMMIT+'\n';},fetchImpl:async()=>{fetched=true;throw Error('unexpected fetch');}})).rejects.toThrow('checkout-source-mismatch');
    expect(fetched).toBe(false);expect(calls).toEqual([['git',['rev-parse','HEAD']]]);
  });
  it('uses bootstrap identity with bounded 409 retry and no unapproved fallback',async()=>{
    const {artifact}=await fixture(),context=buildContext(env),requests=[];let sleeps=0;
    const approved=await fetchApprovedInput(context,secret,{sleep:async()=>{sleeps++;},fetchImpl:async(url,options)=>{requests.push({url,options});return requests.length===1?new Response(null,{status:409}):Response.json(envelope(artifact));}});
    expect(approved.artifact.sourceCommit).toBe(nextCommit);expect(sleeps).toBe(1);
    expect(JSON.parse(requests[0].options.body)).toEqual({buildUrl:env.CF_PAGES_URL,sourceCommit:nextCommit});expect(requests[0].options.redirect).toBe('error');
    let count=0;await expect(fetchApprovedInput(context,secret,{sleep:async()=>{},fetchImpl:async()=>{count++;return new Response(null,{status:409});}})).rejects.toThrow('not-approved');expect(count).toBe(6);
  });
});

// Real child-process checks: no shell interpolation or echoed error output.
describe('source runner process boundary',()=>{
  it('passes metacharacters literally without a shell',async()=>{
    const literal='$(echo should-not-execute); `anything`';
    expect(await runProcess(process.execPath,['-e','process.stdout.write(process.argv[1])',literal],{env:{}})).toBe(literal);
  });
  it('drains and suppresses stderr on failure',async()=>{
    await expect(runProcess(process.execPath,['-e','console.error("private-test-string");process.exit(1)'],{env:{}})).rejects.toThrow('process-failed');
  });
  it('forwards an outer TERM to the detached build process group',async()=>{
    const url=new URL('../scripts/studio-source-build.mjs',import.meta.url).href;
    const code=`import {runProcess} from ${JSON.stringify(url)};setTimeout(()=>process.kill(process.pid,'SIGTERM'),100);try{await runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{}})}catch(e){process.stdout.write(e.code)}`;
    expect(await runProcess(process.execPath,['--input-type=module','-e',code],{env:{},timeout:3000})).toBe('process-terminated');
  });
  it('terminates on bounded output and timeout',async()=>{
    await expect(runProcess(process.execPath,['-e','process.stdout.write("a".repeat(1000))'],{env:{},maxOutput:16})).rejects.toThrow('process-output-limit');
    await expect(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{},timeout:100})).rejects.toThrow('process-timeout');
  });
});
