import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {fixture,env,sourceCommit,secret} from './studio-source-build.fixture.mjs';
import {packageApprovedTorresArtifact} from '../scripts/studio-source-package.mjs';
import {verifyTorresExport,expectedAttestation,PROOF_PATH,exportPolicies,artifactPayload} from '../scripts/studio-verify-export.mjs';
import {runStudioSourceBuild} from '../scripts/studio-source-build.mjs';
const require=createRequire(import.meta.url);
let chromium;
try{chromium=require(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright-core').chromium;}catch(error){if(process.env.STUDIO_PLAYWRIGHT_MODULE)throw error;}
// Opt-in only when Chromium tooling is available; the production runner has no skip path.
const browserOptions={browserType:chromium,...(process.env.STUDIO_CHROME_PATH?{executablePath:process.env.STUDIO_CHROME_PATH}:{}),timeout:2500};
async function writeTree(root,files){for(const [p,v] of Object.entries(files)){await mkdir(dirname(join(root,p)),{recursive:true});await writeFile(join(root,p),v);}}
async function withExport(options,run){const root=await mkdtemp(join(tmpdir(),'studio-export-test-'));try{const {approved,files}=await fixture(options);const packaged=await packageApprovedTorresArtifact({artifact:approved.artifact,sourceCommit,files});await writeTree(root,packaged.files);return await run(root,approved,packaged);}finally{await rm(root,{recursive:true,force:true});}}
describe.skipIf(!chromium)('actual Chromium export verification (React fixture, not public Next build)',()=>{
  it('checks all 11 routes at both widths with real public component handlers and draft36 EM patches',async()=>{
    await withExport({},async(outDir,approved)=>{
      const proof=await verifyTorresExport({outDir,approved,...browserOptions});expect(proof).toEqual(expectedAttestation(approved));
      expect(proof.artifactHash).toHaveLength(64);await expect(access(join(outDir,PROOF_PATH))).rejects.toThrow();
    });
  },60000);
  it('waits for the real hydration effect even when hydration starts after load',async()=>{
    await withExport({broken:'late-hydration'},async(outDir,approved)=>{
      expect(await verifyTorresExport({outDir,approved,...browserOptions})).toEqual(expectedAttestation(approved));
      await expect(access(join(outDir,PROOF_PATH))).rejects.toThrow();
    });
  },60000);
  it.each(['hydration','spoofed-status','target','form','menu','csp'])('fails closed without proof for broken %s',async broken=>{
    await withExport({broken},async(outDir,approved)=>{
      await expect(verifyTorresExport({outDir,approved,...browserOptions})).rejects.toThrow();
      await expect(access(join(outDir,PROOF_PATH))).rejects.toThrow();
    });
  },30000);
  it('rejects clipped hero content even when overflow-hidden masks document overflow',async()=>{
    await withExport({},async(outDir,approved)=>{
      const css=await readFile(join(outDir,'site.css'),'utf8');
      await writeFile(join(outDir,'site.css'),css+'\nbody{overflow-x:hidden}.heroCopy{width:700px;min-width:700px}');
      await expect(verifyTorresExport({outDir,approved,...browserOptions})).rejects.toThrow('responsive-content-clipped');
      await expect(access(join(outDir,PROOF_PATH))).rejects.toThrow();
    });
  },30000);
  it('rejects missing marker, missing runtime asset, and preexisting proof without repairing output',async()=>{
    for(const fault of ['marker','script','proof'])await withExport({},async(outDir,approved)=>{
      if(fault==='marker'){const path=join(outDir,'contact.html');await writeFile(path,(await readFile(path,'utf8')).replace(approved.artifact.marker,''));}
      if(fault==='script')await rm(join(outDir,approved.artifact.assetPath.slice(1)));
      if(fault==='proof')await writeFile(join(outDir,PROOF_PATH),'untrusted');
      await expect(verifyTorresExport({outDir,approved,...browserOptions})).rejects.toThrow();
      if(fault==='proof')expect(await readFile(join(outDir,PROOF_PATH),'utf8')).toBe('untrusted');else await expect(access(join(outDir,PROOF_PATH))).rejects.toThrow();
    });
  },30000);
  it('applies only supplied headers and refuses unsupported rules instead of inventing CSP',()=>{
    expect(exportPolicies({})).toEqual({headers:[],redirects:[]});
    expect(exportPolicies({_headers:Buffer.from("/*\n Content-Security-Policy: default-src 'self'")} ).headers[0].values).toEqual([['content-security-policy',"default-src 'self'"]]);
    expect(()=>exportPolicies({_headers:Buffer.from('/*\n ! Content-Security-Policy')})).toThrow();
    expect(()=>exportPolicies({_redirects:Buffer.from('/a /b 200')})).toThrow();
  });
  it('parses expected payload without executing code',()=>{
    expect(()=>artifactPayload({script:'globalThis.executed=true;',releaseId:'x'})).toThrow();expect(globalThis.executed).toBeUndefined();
  });
  it.each([false,true])('runner writes proof only after the browser gate (broken=%s)',async broken=>{
    const root=await mkdtemp(join(tmpdir(),'studio-runner-test-'));const {approved,files}=await fixture(broken?{broken:'hydration'}:{});const calls=[];let fetchCount=0;
    try{
      await writeTree(root,{'package.json':JSON.stringify({dependencies:{next:'16.2.6'}}),'node_modules/next/package.json':'{"version":"16.2.6"}','node_modules/next/dist/bin/next':'fixture-next','functions/api/contact.js':'// retained function'});
      await mkdir(join(root,'node_modules/.bin'),{recursive:true});await symlink('../next/dist/bin/next',join(root,'node_modules/.bin/next'));
      const deps={browserOptions:{...browserOptions,browserType:{launch:options=>{expect(options.env.STUDIO_BUILD_INPUT_SECRET).toBeUndefined();expect(Object.values(options.env)).not.toContain(secret);return chromium.launch(options);}}},fetchImpl:async()=>{fetchCount++;return Response.json(approved);},runProcess:async(cmd,args,options)=>{
        calls.push([cmd,args]);expect(Object.values(options.env)).not.toContain(secret);expect(options.env.STUDIO_BUILD_INPUT_SECRET).toBeUndefined();
        if(cmd==='git')return args[0]==='rev-parse'?sourceCommit+'\n':'';
        expect(cmd).toBe('npx');expect(args).toEqual(['--no-install','next','build']);await writeTree(join(root,'out'),files);return '';
      }};
      const pending=runStudioSourceBuild({cwd:root,env},deps);
      if(broken){await expect(pending).rejects.toThrow('browser-verification-timeout-direct-route');await expect(access(join(root,'out',PROOF_PATH))).rejects.toThrow();expect(await readFile(join(root,'out/index.html'),'utf8')).not.toContain(approved.artifact.marker);}
      else{await pending;expect(JSON.parse(await readFile(join(root,'out',PROOF_PATH),'utf8'))).toEqual(expectedAttestation(approved));expect(await readFile(join(root,'out/app.js'),'utf8')).toBe(files['app.js']);}
      expect(await readFile(join(root,'functions/api/contact.js'),'utf8')).toBe('// retained function');expect(fetchCount).toBeGreaterThanOrEqual(2);expect(calls.filter(([cmd])=>cmd==='npx')).toHaveLength(1);
    }finally{await rm(root,{recursive:true,force:true});}
  },60000);
});
