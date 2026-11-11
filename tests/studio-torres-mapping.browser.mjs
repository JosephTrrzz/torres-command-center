// Optional real-DOM regression. Supply STUDIO_PLAYWRIGHT_MODULE when Playwright
// is installed outside this checkout, and STUDIO_CHROME_PATH for system Chrome.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {build}=require('esbuild');
const {chromium}=require(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const compiled=await build({entryPoints:['functions/_shared/studio-torres-artifact.ts'],bundle:true,keepNames:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};
new Function('module','exports','require',compiled.outputFiles[0].text)(module,module.exports,require);
const {compileTorresArtifact,TORRES_SOURCE_COMMIT}=module.exports;
const manifest=JSON.parse(await readFile('lib/canvas-manifest.json','utf8'));
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}':JSON.stringify(value);
const draft={0:{2:{moveX:0.0002577932091776258,moveY:0.7486839508623404},3:{text:'Considered design. Personal attention'},$content:{'page:2.1.3':{boxWidth:585.4470825195312,boxHeight:33.324668884277344},'page:2.1.2.0':{text:'Personal attention'}},$sections:{0:{},2:{}}},$shared:{'header:':{style:null},'footer:':{style:null}}};
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical({snapshotId:manifest.id,revision:36,draft})))).toString('hex');
const artifact=await compileTorresArtifact({releaseId:'22222222-2222-4222-8222-222222222222',sourceCommit:TORRES_SOURCE_COMMIT,snapshotId:manifest.id,revision:36,contentHash:hash,draft});
// A real SSR/hydration boundary with an explicit React effect, plus controllable
// client navigation. Installing the artifact before hydration must be inert.
const app=`import React,{useState,useEffect} from 'react';
function Signal({route}){useEffect(()=>{window.signalNodes={em:document.querySelector('.heroStatement em'),form:document.querySelector('form'),input:document.querySelector('input')};document.documentElement.dataset.torresStudioHydratedRoute=route;document.dispatchEvent(new Event('torres-studio:hydrated'));return()=>{if(document.documentElement.dataset.torresStudioHydratedRoute===route)delete document.documentElement.dataset.torresStudioHydratedRoute;};},[route]);return null;}
export function App(){const[open,setOpen]=useState(false);const[count,setCount]=useState(0);const[route,setRoute]=useState('/');useEffect(()=>{window.commitRoute=()=>setRoute(location.pathname);},[]);return <><nav><button id="menu" onClick={()=>setOpen(!open)}>Menu</button><span id="menu-state">{String(open)}</span><a id="link" href="/contact">Contact</a></nav>{route==='/'?<main id="home" className="homePage"><section className="hero homeFullBleed" style={{height:800,width:1000}}><div className="heroCopy"><h1 className="heroLionBrand"><img src="/images/torres-co-standing-lion-bronze.png" alt="Torres & Co. Technology"/></h1><p className="heroStatement">Considered design. <em>Personal attention.</em></p><p className="heroLead">Websites, IT systems, and local search, shaped around your business. Work directly with the owner, from the first conversation to the details that follow.</p></div></section></main>:<main>Contact</main>}<form onSubmit={e=>{e.preventDefault();setCount(count+1)}}><input name="email"/><button id="submit">Submit</button><output id="count">{count}</output></form><Signal route={route}/></>};`;
const server=await build({stdin:{contents:app+`import {renderToString} from 'react-dom/server';export const html=renderToString(<App/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false});
const ssr={exports:{}};new Function('module','exports','require',server.outputFiles[0].text)(ssr,ssr.exports,require);
const react=await build({stdin:{contents:app+`import {hydrateRoot} from 'react-dom/client';window.hydrateTest=()=>hydrateRoot(document.getElementById('root'),<App/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'iife',platform:'browser',write:false});
const browser=await chromium.launch({headless:true,...(process.env.STUDIO_CHROME_PATH?{executablePath:process.env.STUDIO_CHROME_PATH}:{})});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body><div id="root">'+ssr.exports.html+'</div></body></html>'}):r.abort());
 await page.goto('http://studio.test/');await page.addScriptTag({content:react.outputFiles[0].text});await page.waitForSelector('.heroStatement em');
 await page.evaluate(()=>{window.originalEm=document.querySelector('.heroStatement em');window.originalForm=document.querySelector('form');window.originalInput=document.querySelector('input');window.originalEm.addEventListener('click',()=>window.emClicked=true);});
 await page.locator('input').fill('keep@example.com');await page.addScriptTag({content:artifact.script});
 assert.equal(await page.locator('.heroStatement').textContent(),'Considered design. Personal attention.');
 assert.equal(await page.locator('.heroLead').evaluate(n=>n.style.width),'');
 await page.evaluate(()=>{dispatchEvent(new Event('load'));document.dispatchEvent(new Event('torres-studio:hydrated'));});
 assert.equal(await page.locator('.heroLead').evaluate(n=>n.style.width),'');
 await page.evaluate(()=>window.hydrateTest());
 await page.waitForFunction(()=>document.documentElement.dataset.studioApplied==='22222222-2222-4222-8222-222222222222');
 assert.equal(await page.locator('.heroStatement').textContent(),'Considered design. Personal attention');
 assert.equal(await page.locator('.heroLead').evaluate(n=>n.style.width),'min(585.447px, 100%)');
 await page.locator('#menu').click();assert.equal(await page.locator('#menu-state').textContent(),'true');
 await page.locator('#submit').click();assert.equal(await page.locator('#count').textContent(),'1');
 assert.equal(await page.locator('input').inputValue(),'keep@example.com');
 assert.equal(await page.locator('.heroStatement').textContent(),'Considered design. Personal attention');
 await page.locator('.heroStatement em').click();
 assert.equal(await page.evaluate(()=>window.originalEm===document.querySelector('.heroStatement em')&&window.originalForm===document.querySelector('form')&&window.originalInput===document.querySelector('input')&&window.emClicked===true),true);
 assert.equal(await page.locator('#link').getAttribute('href'),'/contact');
 // Change URL first: a stale home signal cannot authorize work for contact.
 await page.evaluate(()=>{history.pushState({},'', '/contact');document.dispatchEvent(new Event('torres-studio:hydrated'));window.commitRoute();});
 await page.waitForFunction(()=>document.documentElement.dataset.torresStudioHydratedRoute==='/contact');
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.studioApplied),undefined);
 await page.evaluate(()=>{history.pushState({},'', '/');window.commitRoute();});
 await page.waitForFunction(()=>document.documentElement.dataset.studioApplied==='22222222-2222-4222-8222-222222222222');
 assert.equal(await page.locator('.heroStatement').textContent(),'Considered design. Personal attention');
 assert.equal(await page.evaluate(()=>window.signalNodes.em===document.querySelector('.heroStatement em')&&window.signalNodes.form===document.querySelector('form')&&window.signalNodes.input===document.querySelector('input')),true);
 assert.equal(await page.evaluate(()=>window.originalEm!==document.querySelector('.heroStatement em')&&window.originalForm===document.querySelector('form')&&window.originalInput===document.querySelector('input')),true);
 await page.evaluate(()=>document.dispatchEvent(new Event('torres-studio:hydrated')));
 assert.equal(await page.locator('input').inputValue(),'keep@example.com');assert.deepEqual(errors,[]);
 // Reproduce the public hero's auto-minimum grid at mobile width. Hidden
 // overflow must not conceal a fixed-width patch expanding the grid track.
 await page.setViewportSize({width:390,height:900});
 await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:0}.hero{width:100%!important;display:grid;grid-template-columns:1fr;padding:24px;overflow:hidden}.heroCopy{display:flex;flex-direction:column;align-items:center;min-width:auto}.heroLionBrand{width:280px;max-width:100%}.heroLionBrand img{width:100%}.heroLead{margin:0}'});
 const bounds=()=>page.locator('.heroLead').evaluate(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};});
 assert.equal((await bounds()).width,342);
 await page.locator('.heroLead').evaluate(n=>{n.style.width='585.4470825195312px';});
 assert.ok((await bounds()).right>390,'old fixed width must reproduce the clipping regression');
 await page.locator('.heroLead').evaluate(n=>{n.style.width='min(585.4470825195312px, 100%)';});
 assert.equal((await bounds()).width,342);assert.ok((await bounds()).right<=390);
 // Validate every mapped selector against the actual imported HTML in Chrome.
 const mapped=await build({entryPoints:['functions/_shared/studio-torres-mapping.ts'],bundle:true,platform:'node',format:'cjs',write:false});const mapping={exports:{}};new Function('module','exports','require',mapped.outputFiles[0].text)(mapping,mapping.exports,require);
 for(const pageIndex of ['0','8','10']){
   const html=(await readFile(`public/website-preview/page-${pageIndex}.html`,'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
   await page.setContent(html);for(const t of mapping.exports.TORRES_TARGETS.filter(t=>t.page===pageIndex)){
    assert.equal(await page.locator(t.selector).count(),1,t.id+' selector');
    assert.equal(await page.locator(t.selector).evaluate(n=>n.tagName),t.tag);
    if(t.expectedText!==undefined)assert.equal(await page.locator(t.selector).textContent(),t.expectedText,t.id+' text');
   }
 }
 console.log('PASS: draft36 SSR/hydration, inert before route effect, client navigation away/back; EM/node/listener/input preservation; rerender, form handler, link; all 16 snapshot selectors.');
}finally{await browser.close();}
