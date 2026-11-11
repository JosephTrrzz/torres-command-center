#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,realpath,readFile,readdir,mkdir,mkdtemp,writeFile,rename,rm,open} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {packageApprovedTorresArtifact,TORRES_ROUTES} from './studio-source-package.mjs';
import {verifyTorresExport,expectedAttestation,PROOF_PATH,browserFailureCode} from './studio-verify-export.mjs';

export const BUILD_INPUT_URL='https://admin.torrescotechnology.com/api/website/build-input';
const BRANCHES=Object.freeze({preview:'codex/studio-publish-preview',production:'main'});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX_RESPONSE=8*1024*1024,MAX_TREE=256*1024*1024,MAX_FILE=64*1024*1024;
export class StudioSourceBuildError extends Error {
  constructor(code){super(`Studio source build stopped: ${code}.`);this.name='StudioSourceBuildError';this.code=code;}
}
const fail=code=>{throw new StudioSourceBuildError(code);};
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',');

export function buildContext(env){
  if(env.CF_PAGES!=='1'||!/^[a-f0-9]{40}$/.test(env.CF_PAGES_COMMIT_SHA||''))fail('source-environment-mismatch');
  if(!Object.hasOwn(BRANCHES,env.STUDIO_BUILD_ENVIRONMENT)||env.CF_PAGES_BRANCH!==BRANCHES[env.STUDIO_BUILD_ENVIRONMENT])fail('branch-environment-mismatch');
  const match=/^https:\/\/([a-f0-9]{8})\.torres-co-technology\.pages\.dev\/?$/.exec(env.CF_PAGES_URL||'');
  if(!match)fail('immutable-deployment-url-required');
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(env.STUDIO_BUILD_INPUT_SECRET||''))fail('build-credential-unavailable');
  if(env.STUDIO_BUILD_ATTEMPT_ID&&!UUID.test(env.STUDIO_BUILD_ATTEMPT_ID))fail('invalid-expected-attempt');
  return Object.freeze({buildUrl:env.CF_PAGES_URL,sourceCommit:env.CF_PAGES_COMMIT_SHA,branch:env.CF_PAGES_BRANCH,environment:env.STUDIO_BUILD_ENVIRONMENT,prefix:match[1],expectedAttemptId:env.STUDIO_BUILD_ATTEMPT_ID||null});
}

// Deliberate allowlist: no provider/database/build credentials, NODE_OPTIONS,
// NODE_PATH, npm config tokens or NEXT_PUBLIC_* variables enter the child build.
export function buildEnvironment(env){
  const child={CI:'1',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',npm_config_update_notifier:'false'};
  for(const key of ['PATH','HOME','TMPDIR','TMP','TEMP','SystemRoot'])if(typeof env[key]==='string')child[key]=env[key];
  return child;
}
export function runProcess(command,args,{cwd,env,timeout=20*60*1000,maxOutput=8*1024*1024}={}){
  return new Promise((resolvePromise,reject)=>{
    let child,output='',bytes=0,settled=false,timer,failure;
    const stop=code=>{failure??=new StudioSourceBuildError(code);try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
    // Forward the provider's outer timeout to our separately grouped Next child.
    const terminate=()=>stop('process-terminated');
    process.once('SIGTERM',terminate);process.once('SIGINT',terminate);
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);process.removeListener('SIGTERM',terminate);process.removeListener('SIGINT',terminate);error?reject(error):resolvePromise(value);};
    try{child=spawn(command,args,{cwd,env,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});}
    catch{finish(new StudioSourceBuildError('process-start-failed'));return;}
    timer=setTimeout(()=>stop('process-timeout'),timeout);
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxOutput){stop('process-output-limit');}else output+=chunk.toString('utf8');});
    // Drain but never print/retain arbitrary build error output.
    child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxOutput){stop('process-output-limit');}});
    child.on('error',()=>finish(new StudioSourceBuildError('process-start-failed')));
    child.on('close',code=>failure?finish(failure):code===0?finish(null,output):finish(new StudioSourceBuildError('process-failed')));
  });
}
async function jsonBody(response){
  if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail('invalid-build-input');
  const reader=response.body?.getReader();if(!reader)fail('invalid-build-input');
  let size=0;const chunks=[];
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_RESPONSE)fail('build-input-too-large');chunks.push(part.value);}}
  finally{await reader.cancel();}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{fail('invalid-build-input');}
}
function secretForms(secret){return [secret,Buffer.from(secret).toString('base64'),Buffer.from(secret).toString('hex')].map(s=>Buffer.from(s));}
function rejectSecret(value,secret){const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(value);if(secretForms(secret).some(s=>bytes.includes(s)))fail('credential-in-artifact');}
export function validateApprovedInput(value,context,secret){
  if(!exact(value,['attemptId','deploymentId','artifact'])||!UUID.test(value.attemptId)||!UUID.test(value.deploymentId)||value.deploymentId.slice(0,8)!==context.prefix||context.expectedAttemptId&&value.attemptId!==context.expectedAttemptId)fail('attempt-identity-mismatch');
  const a=value.artifact;
  if(!exact(a,['protocol','releaseId','contentHash','sourceCommit','assetPath','script','marker','routes'])||a.protocol!==1||!UUID.test(a.releaseId)||!HASH.test(a.contentHash)||a.sourceCommit!==context.sourceCommit||typeof a.script!=='string'||Buffer.byteLength(a.script)>MAX_RESPONSE||!Array.isArray(a.routes)||a.routes.length!==TORRES_ROUTES.length||a.routes.some((r,i)=>r!==TORRES_ROUTES[i]))fail('artifact-identity-mismatch');
  if(a.marker!==`<meta name="torres-studio-release" content="${a.releaseId}:${a.contentHash}">`||a.assetPath!==`/_studio/${sha(canonical({script:a.script,sourceCommit:a.sourceCommit,contentHash:a.contentHash}))}.js`)fail('artifact-fingerprint-mismatch');
  rejectSecret(JSON.stringify(value),secret);
  return structuredClone(value);
}
export async function fetchApprovedInput(context,secret,{fetchImpl=fetch,sleep=delay}={}){
  // Only identity-not-yet-persisted responses may retry, at most 5 seconds of
  // backoff. HTTP/network errors and exhausted conflicts never allow a build.
  for(let attempt=0;attempt<6;attempt++){
    let response;
    try{response=await fetchImpl(BUILD_INPUT_URL,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({buildUrl:context.buildUrl,sourceCommit:context.sourceCommit})});}
    catch{fail('build-input-unavailable');}
    if(response.status===409){await response.body?.cancel();if(attempt===5)fail('build-input-not-approved');await sleep(1000);continue;}
    if(!response.ok){await response.body?.cancel();fail('build-input-not-approved');}
    return validateApprovedInput(await jsonBody(response),context,secret);
  }
  fail('build-input-not-approved');
}
async function exists(path){try{return await lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function readTree(root,{optional=false}={}){
  const top=await exists(root);if(!top){if(optional)return {files:Object.create(null),modes:Object.create(null)};fail('missing-build-output');}
  if(!top.isDirectory()||top.isSymbolicLink())fail('unsafe-filesystem-entry');
  const files=Object.create(null),modes=Object.create(null);let total=0,count=0;
  async function visit(dir,prefix){
    for(const name of (await readdir(dir)).sort()){
      if(!name||['.','..','__proto__','prototype','constructor'].includes(name)||/[\\\u0000-\u001f\u007f]/.test(name))fail('unsafe-filesystem-entry');
      const path=join(dir,name),rel=prefix+name,stat=await lstat(path);
      if(stat.isSymbolicLink())fail('unsafe-filesystem-entry');
      if(stat.isDirectory()){await visit(path,rel+'/');continue;}
      if(!stat.isFile()||stat.size>MAX_FILE||++count>20000||(total+=stat.size)>MAX_TREE)fail('build-output-limit');
      const bytes=await readFile(path);if(bytes.length!==stat.size)fail('build-output-changed');files[rel]=bytes;modes[rel]=stat.mode&0o777;
    }
  }
  await visit(root,'');return {files,modes};
}
function treeHash(tree){return sha(canonical(Object.fromEntries(Object.entries(tree.files).map(([path,bytes])=>[path,sha(bytes)]))));}
async function noDotenv(cwd){for(const name of ['.env','.env.local','.env.production','.env.production.local'])if(await exists(join(cwd,name)))fail('dotenv-build-input-forbidden');}
async function verifyCheckout(cwd,context,env,run){
  const options={cwd,env,timeout:10000,maxOutput:1024*1024};
  if((await run('git',['rev-parse','HEAD'],options)).trim()!==context.sourceCommit)fail('checkout-source-mismatch');
  if((await run('git',['status','--porcelain=v1','--untracked-files=all'],options)).trim())fail('dirty-source-checkout');
  await noDotenv(cwd);
}
async function verifyNext(cwd){
  let declared,installed;
  try{declared=JSON.parse(await readFile(join(cwd,'package.json'),'utf8'));installed=JSON.parse(await readFile(join(cwd,'node_modules/next/package.json'),'utf8'));}catch{fail('next-toolchain-unavailable');}
  if(declared.dependencies?.next!=='16.2.6'||installed.version!=='16.2.6')fail('next-toolchain-mismatch');
  const bin=await realpath(join(cwd,'node_modules/.bin/next'));
  if(bin!==await realpath(join(cwd,'node_modules/next/dist/bin/next')))fail('next-executable-mismatch');
}
function verifyPackage(original,packaged,artifact,secret){
  if(!object(packaged?.files)||!object(packaged.routeFiles)||packaged.assetPath!==artifact.assetPath)fail('invalid-package-result');
  const asset=artifact.assetPath.slice(1),allowed=new Set(Object.values(packaged.routeFiles));
  if(Object.keys(packaged.routeFiles).sort().join('|')!==TORRES_ROUTES.slice().sort().join('|'))fail('invalid-package-result');
  for(const [path,bytes]of Object.entries(original.files)){
    const result=packaged.files[path];if(!(typeof result==='string'||result instanceof Uint8Array))fail('package-dropped-file');
    if(!allowed.has(path)&&!Buffer.from(bytes).equals(Buffer.from(result)))fail('package-changed-unrelated-file');
  }
  for(const [path,bytes]of Object.entries(packaged.files)){
    if(!Object.hasOwn(original.files,path)&&path!==asset)fail('package-added-unrelated-file');
    if(typeof bytes!=='string'&&!(bytes instanceof Uint8Array))fail('invalid-package-result');
    rejectSecret(bytes,secret);
  }
}

/** Trusted-runner entry point. Dependency injection is for local tests only;
 * the CLI uses the fixed endpoint, real spawn and the bundled reviewed packager.
 * Returns packaging identity, never deployment success or readiness evidence.
 */
export async function runStudioSourceBuild({cwd=process.cwd(),env=process.env}={},deps={}){
  let lock,lockPath,stage;
  try{
    const context=buildContext(env),secret=env.STUDIO_BUILD_INPUT_SECRET;
    const secrets=Object.entries(env).filter(([key,value])=>/(secret|token|password|private.*key|service.*key)/i.test(key)&&typeof value==='string'&&value.length>=8).map(([,value])=>value);
    const root=await realpath(cwd),childEnv=buildEnvironment(env),run=deps.runProcess||runProcess;
    for(const value of Object.values(childEnv))for(const credential of secrets)rejectSecret(value,credential);
    await verifyCheckout(root,context,childEnv,run);await verifyNext(root);
    if(await exists(join(root,'out')))fail('existing-output-requires-clean-build');
    lockPath=join(dirname(root),`.studio-source-${sha(root).slice(0,20)}.lock`);
    try{lock=await open(lockPath,'wx',0o600);}catch{fail('build-already-locked');}
    const functionsBefore=treeHash(await readTree(join(root,'functions'),{optional:true}));
    const approved=await fetchApprovedInput(context,secret,{fetchImpl:deps.fetchImpl||fetch,sleep:deps.sleep||delay});
    // No secret is passed in command arguments, environment or build output logs.
    await run('npx',['--no-install','next','build'],{cwd:root,env:childEnv,timeout:20*60*1000});
    await verifyCheckout(root,context,childEnv,run);
    if(treeHash(await readTree(join(root,'functions'),{optional:true}))!==functionsBefore)fail('functions-source-changed');
    const refreshed=await fetchApprovedInput({...context,expectedAttemptId:approved.attemptId},secret,{fetchImpl:deps.fetchImpl||fetch,sleep:deps.sleep||delay});
    if(canonical(refreshed)!==canonical(approved))fail('approval-changed-during-build');
    const original=await readTree(join(root,'out'));
    if(Object.hasOwn(original.files,PROOF_PATH)){await rm(join(root,'out',PROOF_PATH));fail('untrusted-preexisting-proof');}
    let packaged;
    try{packaged=await (deps.packageArtifact||packageApprovedTorresArtifact)({artifact:approved.artifact,sourceCommit:context.sourceCommit,files:original.files});}
    catch{fail('artifact-packaging-rejected');}
    verifyPackage(original,packaged,approved.artifact,secret);
    for(const bytes of Object.values(packaged.files))for(const credential of secrets)rejectSecret(bytes,credential);
    stage=await mkdtemp(join(dirname(root),'.studio-packaging-'));const staged=join(stage,'out');await mkdir(staged);
    for(const [path,bytes]of Object.entries(packaged.files)){
      // Packager preserves paths; independently forbid traversal before writes.
      if(path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..')||path.includes('\\'))fail('unsafe-package-path');
      const destination=join(staged,path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes,{flag:'wx',mode:original.modes[path]??0o644});
    }
    // Mandatory browser gate. No CLI option bypasses this; injected dependencies
    // are an in-process test seam, never read from deployment environment/input.
    let proof;
    try{proof=await verifyTorresExport({outDir:staged,approved,env:childEnv,...deps.browserOptions});}
    catch(error){fail(browserFailureCode(error));}
    if(canonical(proof)!==canonical(expectedAttestation(approved)))fail('invalid-browser-proof');
    const checked=await readTree(staged);
    if(Object.keys(checked.files).length!==Object.keys(packaged.files).length||Object.entries(packaged.files).some(([path,bytes])=>!Buffer.from(bytes).equals(checked.files[path]||Buffer.alloc(0))))fail('verified-output-changed');
    for(const bytes of Object.values(checked.files))for(const credential of secrets)rejectSecret(bytes,credential);
    const finalApproval=await fetchApprovedInput({...context,expectedAttemptId:approved.attemptId},secret,{fetchImpl:deps.fetchImpl||fetch,sleep:deps.sleep||delay});
    if(canonical(finalApproval)!==canonical(approved))fail('approval-changed-during-verification');
    // The runner alone writes proof, only after every real browser check passed.
    await writeFile(join(staged,PROOF_PATH),JSON.stringify(proof)+'\n',{flag:'wx',mode:0o644});
    // Detect a concurrent writer before swapping a completely prepared tree.
    if(treeHash(await readTree(join(root,'out')))!==treeHash(original))fail('build-output-changed');
    await verifyCheckout(root,context,childEnv,run);
    if(treeHash(await readTree(join(root,'functions'),{optional:true}))!==functionsBefore)fail('functions-source-changed');
    const backup=join(stage,'original');await rename(join(root,'out'),backup);
    try{await rename(staged,join(root,'out'));}catch{await rename(backup,join(root,'out'));fail('output-swap-failed');}
    return {attemptId:approved.attemptId,deploymentId:approved.deploymentId,releaseId:approved.artifact.releaseId,contentHash:approved.artifact.contentHash,sourceCommit:context.sourceCommit,assetPath:approved.artifact.assetPath,routeCount:TORRES_ROUTES.length};
  }catch(error){if(error instanceof StudioSourceBuildError)throw error;throw new StudioSourceBuildError('build-or-filesystem-failed');}
  finally{
    if(stage)await rm(stage,{recursive:true,force:true}).catch(()=>{});
    if(lock){await lock.close().catch(()=>{});await rm(lockPath,{force:true}).catch(()=>{});}
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runStudioSourceBuild().then(()=>console.log('Approved source artifact packaged locally.')).catch(error=>{console.error(error instanceof StudioSourceBuildError?error.message:'Studio source build stopped.');process.exitCode=1;});
}
