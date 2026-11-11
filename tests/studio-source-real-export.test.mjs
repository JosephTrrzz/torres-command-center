// Opt-in diagnostics against a REAL Next export. Until an actual saved-draft
// file is supplied, this test explicitly uses the representative revision36.
// It never writes an attestation and never changes the source export.
import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtemp,readdir,lstat,readFile,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,sourceCommit} from './studio-source-build.fixture.mjs';
import {compileTorresArtifact} from '../functions/_shared/studio-torres-artifact';
import {contentHash} from '../functions/_shared/studio-publisher';
import manifest from '../lib/canvas-manifest.json';
import {packageApprovedTorresArtifact} from '../scripts/studio-source-package.mjs';
import {verifyTorresExport,serveExport,artifactPayload,PROOF_PATH} from '../scripts/studio-verify-export.mjs';
const require=createRequire(import.meta.url);
it.skipIf(!process.env.STUDIO_REAL_EXPORT)(process.env.STUDIO_SAVED_DRAFT?'Actual saved draft36 against actual Next export; diagnostic identity only, no attestation':'TEST ONLY representative36 against actual Next export; no attestation',async()=>{
  let approved;
  if(process.env.STUDIO_SAVED_DRAFT){
    const draft=JSON.parse(await readFile(process.env.STUDIO_SAVED_DRAFT,'utf8'));
    // UUIDs identify this local test only: no publication/attempt is created.
    const artifact=await compileTorresArtifact({releaseId:'22222222-2222-4222-8222-222222222222',sourceCommit,snapshotId:manifest.id,revision:36,draft,contentHash:await contentHash({snapshotId:manifest.id,revision:36,draft})});
    approved={attemptId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',deploymentId:'12345678-aaaa-4aaa-8aaa-aaaaaaaaaaaa',artifact};
  }else({approved}=await fixture());
  const files={};
  async function scan(dir,prefix=''){for(const name of await readdir(dir)){const p=join(dir,name),s=await lstat(p);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())await scan(p,prefix+name+'/');else files[prefix+name]=await readFile(p);}}
  await scan(process.env.STUDIO_REAL_EXPORT);
  const packaged=await packageApprovedTorresArtifact({artifact:approved.artifact,sourceCommit,files});
  const root=await mkdtemp(join(tmpdir(),'studio-real-export-test-'));
  const chromium=require(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright-core').chromium;
  const executablePath=process.env.STUDIO_CHROME_PATH;
  const screenshots=new Map();
  try{
    for(const [path,bytes] of Object.entries(packaged.files)){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);}
    try{await verifyTorresExport({outDir:root,approved,browserType:chromium,executablePath,timeout:5000,onDiagnostic:value=>console.log('Verifier failure diagnostic:',JSON.stringify(value)),onVerifiedPage:async({page,route,width,phase})=>{if(process.env.STUDIO_SCREENSHOTS&&route==='/'){await page.evaluate(()=>scrollTo(0,0));screenshots.set(`home-${width===390?'mobile':'desktop'}-${phase}.png`,await page.screenshot({fullPage:false}));}}});}
    catch(error){
      // Public-source diagnostics only: identify source target mismatches rather
      // than converting a runtime failure into false proof.
      const server=await serveExport(files,packaged.routeFiles);const browser=await chromium.launch({headless:true,executablePath});
      try{const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===server.origin?r.continue():r.abort());await page.goto(server.origin+'/',{waitUntil:'load'});
        const result=await page.evaluate(operations=>operations.map(op=>{const all=document.querySelectorAll(op.target.selector),n=all[0];return {path:op.path,selector:op.target.selector,count:all.length,expectedTag:op.target.tag,actualTag:n?.tagName,expectedText:op.target.expectedText,actualText:n?.textContent,expectedSrc:op.target.expectedSrc,actualSrc:n?.getAttribute('src'),expectedAlt:op.target.expectedAlt,actualAlt:n?.getAttribute('alt')};}),artifactPayload(approved.artifact).operations.filter(op=>op.target.route==='/'));
        console.log('TEST ONLY actual-source target diagnostic:',JSON.stringify(result));
      }finally{await browser.close();await server.close();}throw error;
    }
    await expect(access(join(root,PROOF_PATH))).rejects.toThrow();
    if(process.env.STUDIO_SCREENSHOTS){await mkdir(process.env.STUDIO_SCREENSHOTS,{recursive:true});for(const [name,bytes] of screenshots)await writeFile(join(process.env.STUDIO_SCREENSHOTS,name),bytes,{mode:0o600});console.log('Saved successful local validation screenshots:',[...screenshots.keys()].join(', '));}
  }finally{await rm(root,{recursive:true,force:true});}
},60000);
