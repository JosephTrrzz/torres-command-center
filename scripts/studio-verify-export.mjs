// Checks the packaged export, never the editor snapshot. Only the build runner
// persists the returned attestation; this module does not write proof files.
import {createServer} from 'node:http';
import {readFile,lstat,readdir} from 'node:fs/promises';
import {join,extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {TORRES_ROUTES,packageApprovedTorresArtifact} from './studio-source-package.mjs';
const require=createRequire(import.meta.url);
const fail=code=>{throw new Error(`Export verification failed: ${code}`);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const PROOF_PATH='_studio/verification.json';

export function expectedAttestation(approved){
  const {attemptId,deploymentId,artifact:a}=approved;
  if(!uuid.test(attemptId)||!uuid.test(deploymentId)||!uuid.test(a.releaseId)||!/^[a-f0-9]{64}$/.test(a.contentHash)||!/^[a-f0-9]{40}$/.test(a.sourceCommit)||!/^\/_studio\/[a-f0-9]{64}\.js$/.test(a.assetPath))fail('identity');
  return {protocol:1,attemptId,deploymentId,releaseId:a.releaseId,contentHash:a.contentHash,sourceCommit:a.sourceCommit,artifactHash:a.assetPath.slice(9,-3),routesVerified:true,runtimeVerified:true,functionalVerified:true};
}
// Parse, never evaluate, the compiler's single IIFE argument. Acorn rejects
// alternate wrappers and JSON.parse rejects executable/nonliteral payloads.
export function artifactPayload(artifact){
  const {parse}=require('acorn');
  const ast=parse(artifact.script,{ecmaVersion:2022});
  const call=ast.body[0]?.expression;
  if(ast.body.length!==1||ast.body[0].type!=='ExpressionStatement'||call?.type!=='CallExpression'||call.callee.type!=='FunctionExpression'||call.arguments.length!==1)fail('unsupported-runtime-wrapper');
  let payload;try{payload=JSON.parse(artifact.script.slice(call.arguments[0].start,call.arguments[0].end));}catch{fail('nonliteral-runtime-payload');}
  if(payload?.releaseId!==artifact.releaseId||!Array.isArray(payload.operations)||payload.operations.some(op=>!TORRES_ROUTES.includes(op.target?.route)||typeof op.target.selector!=='string'||!op.styles||!op.attrs))fail('runtime-payload');
  return payload;
}
async function exportFiles(root){
  const files=Object.create(null);let size=0,count=0;
  async function visit(path,prefix=''){
    const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())fail('unsafe-export');
    for(const name of await readdir(path)){
      if(/[\\\x00-\x1f\x7f]/.test(name))fail('unsafe-export');
      const location=join(path,name),entry=await lstat(location),key=prefix+name;
      if(entry.isSymbolicLink())fail('unsafe-export');
      if(entry.isDirectory()){await visit(location,key+'/');continue;}
      if(!entry.isFile()||++count>20000||(size+=entry.size)>256*1024*1024)fail('export-limit');
      files[key]=await readFile(location);
    }
  }
  await visit(root);if(Object.hasOwn(files,PROOF_PATH))fail('preexisting-proof');return files;
}
const pattern=value=>{
  if(!/^\/[A-Za-z0-9_./*\-]*$/.test(value)||value.includes('..')||(value.match(/\*/g)||[]).length>1)fail('unsupported-routing-pattern');
  return new RegExp('^'+value.replace(/[.]/g,'\\.').replace('*','(.*)')+'$');
};
export function exportPolicies(files){
  const headers=[],redirects=[];let current;
  for(const line of (files._headers?.toString('utf8')||'').split(/\r?\n/)){
    if(!line.trim()||line.trim().startsWith('#'))continue;
    if(!/^\s/.test(line)){current={match:pattern(line.trim()),values:[]};headers.push(current);continue;}
    const match=/^\s+([A-Za-z][A-Za-z0-9-]*):\s*(.+)$/.exec(line);
    if(!current||!match||/[\x00-\x1f\x7f]/.test(match[2])||match[2].includes(':splat'))fail('unsupported-header-rule');
    // Header removals, substitutions, absolute host rules and redirects in headers
    // need a provider-equivalent implementation before they can be attested.
    if(['location','content-length','transfer-encoding','connection','set-cookie'].includes(match[1].toLowerCase()))fail('unsupported-header-rule');
    current.values.push([match[1].toLowerCase(),match[2]]);
  }
  for(const line of (files._redirects?.toString('utf8')||'').split(/\r?\n/)){
    if(!line.trim()||line.trim().startsWith('#'))continue;
    const m=/^(\S+)\s+(\/[A-Za-z0-9_./*-]+)\s+(301|302|303|307|308)!?$/.exec(line.trim());
    if(!m||m[2].startsWith('//')||m[2].includes('..'))fail('unsupported-redirect-rule');
    redirects.push({match:pattern(m[1]),target:m[2],status:Number(m[3])});
  }
  return {headers,redirects};
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.txt':'text/plain','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.mp4':'video/mp4'};
export async function serveExport(files,routeFiles){
  const {headers,redirects}=exportPolicies(files);
  const server=createServer((req,res)=>{
    try{
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
      const path=new URL(req.url,'http://localhost').pathname;
      if(/%|\\/.test(path)||path.split('/').includes('..')){res.writeHead(400).end();return;}
      const values={'cache-control':'no-store'};
      for(const rule of headers)if(rule.match.test(path))for(const [key,value] of rule.values)values[key]=values[key]?values[key]+', '+value:value;
      for(const rule of redirects)if(rule.match.test(path)){res.writeHead(rule.status,{...values,location:rule.target}).end();return;}
      const direct=path.slice(1),canonical=path.replace(/\/+$/,'')||'/';
      const candidates=routeFiles[canonical]?[routeFiles[canonical]]:[direct,direct+'.html',direct.replace(/\/$/,'')+'/index.html'];
      const file=candidates.find(p=>Object.hasOwn(files,p)&&!['_headers','_redirects','_routes.json',PROOF_PATH].includes(p));
      if(!file){res.writeHead(404,values).end();return;}
      res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream',...values});res.end(req.method==='HEAD'?undefined:files[file]);
    }catch{res.writeHead(500).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {origin:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}

async function runtimeCheck(page,payload,route){
  const operations=payload.operations.filter(op=>op.target.route===route);
  await page.waitForFunction(route=>document.documentElement.dataset.torresStudioHydratedRoute===route,route);
  if(operations.length)await page.waitForFunction(id=>document.documentElement.dataset.studioApplied===id,payload.releaseId);
  const result=await page.evaluate(({operations,releaseId})=>{
    if(operations.length===0&&document.documentElement.dataset.studioApplied!==undefined)return false;
    for(const op of operations){
      const matches=document.querySelectorAll(op.target.selector);if(matches.length!==1)return 'selector';
      const node=matches[0];if(node.tagName!==op.target.tag)return 'tag';
      if(op.text!==undefined){const texts=Array.from(node.childNodes).filter(n=>n.nodeType===3);if(texts.length!==1||texts[0].nodeValue!==op.text)return 'text';}
      if(op.target.kind==='compound'&&(node.children.length!==1||node.children[0].tagName!=='EM'))return 'emphasis';
      for(const [key,value] of Object.entries(op.attrs))if(node.getAttribute(key)!==value)return 'attribute';
      for(const [key,value] of Object.entries(op.styles)){
        const expected=document.createElement('span').style;expected[key]=value;
        if(!expected[key]||node.style[key]!==expected[key])return 'style-'+key;
      }
      if(op.move){const section=document.querySelector(op.target.sectionSelector);if(!section)return 'section';const xy=node.style.translate.split(' ').map(parseFloat);if(xy.length!==2||Math.abs(xy[0]-op.move.x*section.clientWidth/100)>0.02||Math.abs(xy[1]-op.move.y*section.clientHeight/100)>0.02)return 'movement';}
      if(op.target.kind==='image'&&(!node.complete||!node.naturalWidth))return 'image';
    }
    return operations.length===0||document.documentElement.dataset.studioApplied===releaseId;
  },{operations,releaseId:payload.releaseId});
  if(result!==true)fail('patch-result-'+(typeof result==='string'?result:'status'));
}
async function responsiveCheck(page,width){
  if(!await page.evaluate(width=>{
    if(innerWidth!==width||document.documentElement.scrollWidth>innerWidth+2)return false;
    // Overflow-hidden containers can conceal an expanded grid track, so scroll
    // width alone cannot prove that the edited hero text/controls fit onscreen.
    return Array.from(document.querySelectorAll('main#home .heroCopy,main#home .heroStatement,main#home .heroLead,main#home .heroActions a')).every(node=>{const box=node.getBoundingClientRect();return box.width>0&&box.left>=-2&&box.right<=innerWidth+2;});
  },width))fail('responsive-content-clipped');
}
async function menuCheck(page){
  const button=page.locator('.menuTrigger'),panel=page.locator('#primary-menu');
  if(await button.count()!==1||await panel.count()!==1||await button.getAttribute('aria-controls')!=='primary-menu')fail('menu-contract');
  await button.click();
  await page.waitForFunction(()=>document.querySelector('.menuTrigger')?.getAttribute('aria-expanded')==='true'&&document.querySelector('#primary-menu')?.getAttribute('aria-hidden')==='false');
  if(!await panel.isVisible())fail('menu-not-visible');
  for(const route of TORRES_ROUTES.filter(r=>r!=='/'))if(await panel.locator(`a[href="${route}"][role="menuitem"]`).count()!==1)fail('menu-link');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.querySelector('.menuTrigger')?.getAttribute('aria-expanded')==='false'&&document.querySelector('#primary-menu')?.getAttribute('aria-hidden')==='true');
}
async function formCheck(page){
  const form=page.locator('form.contactForm');
  if(await form.count()!==1||await form.getAttribute('action')!=='/api/contact'||(await form.getAttribute('method'))?.toLowerCase()!=='post')fail('form-contract');
  for(const name of ['name','businessName','email','phone','description','service','_subject','_gotcha'])if(await form.locator(`[name="${name}"]`).count()!==1)fail('form-field');
  for(const name of ['name','email','description'])if(await form.locator(`[name="${name}"]`).getAttribute('required')===null)fail('required-field');
  if(await form.locator('[name="email"]').getAttribute('type')!=='email'||await form.locator('[name="contactMethod"]').count()!==3||await form.locator('button[type="submit"]:enabled').count()!==1)fail('form-controls');
  await form.locator('[name="name"]').fill('Browser verification');await form.locator('[name="email"]').fill('verification@example.invalid');await form.locator('[name="description"]').fill('Local verification only; never submitted.');
  await form.locator('.serviceSelectTrigger').click();
  await page.waitForFunction(()=>document.querySelector('.serviceSelectTrigger')?.getAttribute('aria-expanded')==='true');
  const option=form.locator('[role="option"]:not([aria-disabled="true"])').first();const service=(await option.textContent()).trim();if(!service)fail('service-option');await option.click();
  await page.waitForFunction(value=>document.querySelector('input[name="service"]')?.value===value,service);
  await menuCheck(page);
  if(await form.locator('[name="email"]').inputValue()!=='verification@example.invalid'||await form.locator('[name="description"]').inputValue()!=='Local verification only; never submitted.')fail('form-state-lost');
  if(!await form.evaluate(node=>node.checkValidity()))fail('form-validity');
}

/** No credentials enter browser env or pages. An installed Chromium is required;
 * no automatic download or network fallback occurs during verification. */
export async function verifyTorresExport({outDir,approved,browserType,executablePath,timeout=10000,env=process.env,onDiagnostic,onVerifiedPage}){
  const proof=expectedAttestation(approved),artifact=approved.artifact,payload=artifactPayload(artifact);
  const files=await exportFiles(outDir);
  const packaged=await packageApprovedTorresArtifact({artifact,sourceCommit:artifact.sourceCommit,files});
  // The verifier must not repair missing markers/assets and then attest repairs.
  if(Object.keys(files).length!==Object.keys(packaged.files).length||Object.entries(files).some(([p,v])=>!Buffer.from(packaged.files[p]).equals(v)))fail('unpackaged-export');
  const server=await serveExport(files,packaged.routeFiles);let browser,currentPage,currentRoute,currentWidth,phase;const pageErrors=[];
  const browserEnv={};for(const key of ['PATH','HOME','TMPDIR','TMP','TEMP','SystemRoot'])if(typeof env[key]==='string')browserEnv[key]=env[key];
  try{
    browser=await (browserType||require('playwright-core').chromium).launch({headless:true,env:browserEnv,...(executablePath?{executablePath}:{})});
    let routesChecked=0,menusChecked=0,formsChecked=0,navigationsChecked=0;
    for(const width of [1440,390]){
      currentWidth=width;
      const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,serviceWorkers:'block'});
      let badNetwork=false;
      await context.route('**/*',async route=>{
        const req=route.request();if(!['GET','HEAD'].includes(req.method())){badNetwork=true;await route.abort();return;}
        if(new URL(req.url()).origin!==server.origin){await route.abort();return;}
        await route.continue();
      });
      const page=await context.newPage();currentPage=page;page.setDefaultTimeout(timeout);page.setDefaultNavigationTimeout(timeout);
      let errors=false,assetLoaded=false;
      page.on('pageerror',error=>{errors=true;pageErrors.push(error.message.slice(0,500));});
      page.on('requestfailed',request=>{if(new URL(request.url()).origin===server.origin&&!request.url().endsWith('/favicon.ico'))errors=true;});
      page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource:'))errors=true;});
      page.on('response',response=>{
        if(new URL(response.url()).origin===server.origin){if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))errors=true;if(response.url()===server.origin+artifact.assetPath&&response.status()===200)assetLoaded=true;}
      });
      await page.addInitScript(selectors=>{
        window.__studioCspViolation=false;
        document.addEventListener('securitypolicyviolation',()=>{window.__studioCspViolation=true;});
        document.addEventListener('DOMContentLoaded',()=>{
          window.__studioOriginalNodes=Array.from(document.querySelectorAll('form.contactForm,form.contactForm input,form.contactForm textarea,'+selectors.join(',')));
        },{once:true});
      },payload.operations.filter(op=>op.target.kind==='compound').map(op=>op.target.selector+' > em').concat(['.menuTrigger']));
      for(const route of TORRES_ROUTES){
        currentRoute=route;phase='direct-route';assetLoaded=false;
        const response=await page.goto(server.origin+route,{waitUntil:'load'});
        if(response?.status()!==200||new URL(page.url()).pathname!==route)fail('route-response');
        if(await page.locator('meta[name="torres-studio-release"]').count()!==1||await page.locator('meta[name="torres-studio-release"]').getAttribute('content')!==artifact.releaseId+':'+artifact.contentHash)fail('route-marker');
        if(!assetLoaded||await page.locator('script[data-torres-studio]').count()!==1||await page.locator('script[data-torres-studio]').getAttribute('src')!==artifact.assetPath)fail('script-load');
        await runtimeCheck(page,payload,route);await menuCheck(page);menusChecked++;
        if(route==='/'||route==='/contact'){await formCheck(page);formsChecked++;}
        await runtimeCheck(page,payload,route);
        await responsiveCheck(page,width);
        if(!await page.evaluate(()=>Array.isArray(window.__studioOriginalNodes)&&window.__studioOriginalNodes.length>0&&window.__studioOriginalNodes.every(node=>node.isConnected)))fail('replaced-protected-nodes');
        if(errors||badNetwork||await page.evaluate(()=>window.__studioCspViolation))fail('browser-errors');
        if(onVerifiedPage)await onVerifiedPage({page,route,width,phase});
        routesChecked++;
      }
      // Real anchor navigation, rather than only scripted goto. Hard reload and
      // client navigation are both allowed, but the destination must be patched.
      phase='brand-navigation-home';currentRoute='/';
      await page.locator('.brand[href="/"]').click();await page.waitForURL(server.origin+'/');
      await page.waitForLoadState('load');await runtimeCheck(page,payload,'/');
      if(await page.locator('meta[name="torres-studio-release"]').getAttribute('content')!==artifact.releaseId+':'+artifact.contentHash)fail('navigation-marker');
      if(errors||badNetwork||await page.evaluate(()=>window.__studioCspViolation))fail('navigation-errors');
      // Exercise the pinned Next App Router, not a full-document navigation.
      // The test fixture models this API; real-export tests use the actual router.
      if(!await page.evaluate(()=>typeof window.next?.router?.push==='function'&&typeof window.next?.router?.back==='function'))fail('client-router-unavailable');
      const originalDocument=await page.evaluateHandle(()=>document);
      phase='client-navigation-away';currentRoute='/contact';
      await page.evaluate(()=>window.next.router.push('/contact'));
      await page.waitForURL(server.origin+'/contact');await runtimeCheck(page,payload,'/contact');
      if(!await page.evaluate(original=>original===document,originalDocument))fail('client-navigation-reloaded');
      phase='client-navigation-back';currentRoute='/';
      await page.evaluate(()=>window.next.router.back());
      await page.waitForURL(server.origin+'/');await runtimeCheck(page,payload,'/');
      if(!await page.evaluate(original=>original===document,originalDocument))fail('client-navigation-reloaded');
      await originalDocument.dispose();
      if(await page.locator('meta[name="torres-studio-release"]').getAttribute('content')!==artifact.releaseId+':'+artifact.contentHash||await page.locator('script[data-torres-studio]').getAttribute('src')!==artifact.assetPath)fail('client-navigation-marker');
      await menuCheck(page);await formCheck(page);await runtimeCheck(page,payload,'/');
      if(errors||badNetwork||await page.evaluate(()=>window.__studioCspViolation))fail('client-navigation-errors');
      await responsiveCheck(page,width);
      if(onVerifiedPage)await onVerifiedPage({page,route:'/',width,phase});
      navigationsChecked++;await context.close();
    }
    if(routesChecked!==22||menusChecked!==22||formsChecked!==4||navigationsChecked!==2)fail('incomplete-checks');
    const after=await exportFiles(outDir);if(!same(Object.keys(files).sort(),Object.keys(after).sort())||Object.entries(files).some(([p,v])=>!v.equals(after[p])))fail('export-changed');
    return proof;
  }catch(error){
    if(onDiagnostic){
      const state=await currentPage?.evaluate(operations=>({url:location.pathname,readyState:document.readyState,applied:document.documentElement.dataset.studioApplied||null,targets:operations.map(op=>{const nodes=document.querySelectorAll(op.target.selector),node=nodes[0];return {id:op.target.id,count:nodes.length,tag:node?.tagName,textMatches:op.text===undefined?null:Array.from(node?.childNodes||[]).some(n=>n.nodeType===3&&n.nodeValue===op.text),stylesMatch:node?Object.entries(op.styles).every(([k,v])=>{const expected=document.createElement('span').style;expected[k]=v;return node.style[k]===expected[k];}):false};})}),payload.operations.filter(op=>op.target.route===currentRoute)).catch(()=>null);
      await onDiagnostic({route:currentRoute,width:currentWidth,phase,pageErrors,state});
    }
    throw error;
  }finally{try{await browser?.close();}finally{await server.close();}}
}

// Standalone diagnostics never emit or persist an attestation. The trusted
// runner remains the only proof writer after source and approval verification.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    const args=process.argv.slice(2);
    if(args.length!==4||args[0]!=='--out'||args[2]!=='--expected')fail('arguments');
    const input=await readFile(args[3]);if(input.length>8*1024*1024)fail('input-limit');
    await verifyTorresExport({outDir:args[1],approved:JSON.parse(input.toString('utf8'))});
    console.log('Local export browser checks passed; no attestation written.');
  })().catch(()=>{console.error('Export browser verification failed; no attestation written.');process.exitCode=1;});
}
