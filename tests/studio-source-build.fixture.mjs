import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {components} from './studio-source-build.components.mjs';
import {compileTorresArtifact,TORRES_SOURCE_COMMIT} from '../functions/_shared/studio-torres-artifact';
import {contentHash} from '../functions/_shared/studio-publisher';
import manifest from '../lib/canvas-manifest.json';
const require=createRequire(import.meta.url);
export const sourceCommit=TORRES_SOURCE_COMMIT;
export const secret='test-only-credential-'.repeat(3);
export const env={...process.env,CF_PAGES:'1',CF_PAGES_COMMIT_SHA:sourceCommit,CF_PAGES_URL:'https://12345678.torres-co-technology.pages.dev',CF_PAGES_BRANCH:'codex/studio-publish-preview',STUDIO_BUILD_ENVIRONMENT:'preview',STUDIO_BUILD_INPUT_SECRET:secret};
const icon='export default function Icon(){return null}';
const app=`import React from 'react';import Navigation from './Navigation';import {ContactForm} from './ContactForm';
function HydrationSignal({route}){React.useEffect(()=>{document.documentElement.dataset.torresStudioHydratedRoute=route;document.dispatchEvent(new Event('torres-studio:hydrated'));return()=>{if(document.documentElement.dataset.torresStudioHydratedRoute===route)delete document.documentElement.dataset.torresStudioHydratedRoute;};},[route]);return null;}
// TEST ONLY router shim: fixture navigation is React/history, never evidence of Next routing.
export default function App(){const[route,setRoute]=React.useState(()=>typeof location==='undefined'?'/':location.pathname.replace(/\\/+$/,'')||'/');React.useEffect(()=>{const sync=()=>setRoute(location.pathname.replace(/\\/+$/,'')||'/');window.next={router:{push(path){history.pushState({},'',path);sync();},back(){history.back();}}};addEventListener('popstate',sync);return()=>{removeEventListener('popstate',sync);delete window.next;};},[]);return <div key={route}><Navigation/><main id="home" className="homePage"><section className="hero homeFullBleed"><div className="heroCopy"><h1 className="heroLionBrand"><img src="/images/torres-co-standing-lion-bronze.png" alt="Torres & Co. Technology"/></h1><p className="heroStatement">Considered design. <em>Personal attention.</em></p><p className="heroLead">Websites, IT systems, and local search, shaped around your business. Work directly with the owner, from the first conversation to the details that follow.</p></div></section><ContactForm/></main><HydrationSignal route={route}/></div>}`;
const css=`*{box-sizing:border-box}body{margin:0}.nav{display:flex;align-items:center;gap:10px}.menuTrigger{height:48px;width:48px}.menuGroup{margin-left:auto}.menuPanel,.serviceSelectPanel{display:none}.isOpen>.menuPanel,.isOpen>.serviceSelectPanel{display:block;position:absolute;right:0;background:white;z-index:100}.menuPanel a{display:block;padding:3px}.hero{width:100%;height:400px;overflow:hidden}.hero img{width:40px;height:40px}.heroLead{max-width:100%}.formFields{max-width:100%}.formRow{display:flex;flex-wrap:wrap}input,textarea{max-width:100%}.honeyField{display:none}.serviceSelect{position:relative}.serviceSelectPanel{left:0;right:auto;width:300px}.serviceSelectPanel li{padding:5px;cursor:pointer}form{max-width:100%;padding:10px}.brand{display:block}.headerSocial{display:none}`;
let assets;
async function reactAssets(){
  if(assets)return assets;
  const sources={...components,App:app,ArrowUpRightIcon:icon,InstagramIcon:icon,BrandLogo:'export default function BrandLogo(){return <span>Torres</span>}'};
  const plugin={name:'public-components',setup(b){b.onResolve({filter:/^\.\//},args=>sources[args.path.slice(2)]?{path:args.path.slice(2),namespace:'public-components'}:undefined);b.onLoad({filter:/.*/,namespace:'public-components'},args=>({contents:sources[args.path],loader:'tsx',resolveDir:process.cwd()}));}};
  const options={plugins:[plugin],bundle:true,jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"'}};
  const server=await build({...options,stdin:{contents:`import React from 'react';import {renderToString} from 'react-dom/server';import App from './App';export const html=renderToString(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},platform:'node',format:'cjs'});
  const mod={exports:{}};new Function('module','exports','require',server.outputFiles[0].text)(mod,mod.exports,require);
  const client=await build({...options,stdin:{contents:`import React from 'react';import {hydrateRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import App from './App';flushSync(()=>hydrateRoot(document.getElementById('root'),<App/>));`,resolveDir:process.cwd(),loader:'tsx'},platform:'browser',format:'iife'});
  return assets={html:mod.exports.html,script:client.outputFiles[0].text};
}
export async function fixture({broken}={}){
  const draft={0:{2:{moveX:0.0002577932091776258,moveY:0.7486839508623404},3:{text:'Considered design. Personal attention'},$content:{'page:2.1.3':{boxWidth:585.4470825195312,boxHeight:33.324668884277344},'page:2.1.2.0':{text:'Personal attention'}},$sections:{0:{},2:{}}},$shared:{'header:':{style:null},'footer:':{style:null}}};
  const artifact=await compileTorresArtifact({releaseId:'22222222-2222-4222-8222-222222222222',sourceCommit,snapshotId:manifest.id,revision:36,draft,contentHash:await contentHash({snapshotId:manifest.id,revision:36,draft})});
  const approved={attemptId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',deploymentId:'12345678-aaaa-4aaa-8aaa-aaaaaaaaaaaa',artifact};
  const react=await reactAssets();
  let html=react.html;
  if(broken==='form')html=html.replace('action="/api/contact"','action="/evil"');
  if(broken==='target')html=html.replace('Personal attention.','Changed source.');
  if(broken==='menu')html=html.replaceAll('menuTrigger','brokenTrigger');
  const document=`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/site.css"><script src="/app.js" defer></script></head><body><div id="root">${html}</div></body></html>`;
  const files=Object.fromEntries(artifact.routes.map(r=>[r==='/'?'index.html':r.slice(1)+'.html',document]));
  files['app.js']=broken==='hydration'?'':react.script;
  if(broken==='late-hydration')files['app.js']=`addEventListener('load',()=>setTimeout(()=>{${react.script}},0));`;
  if(broken==='spoofed-status')files['app.js']+=`addEventListener('load',()=>{document.querySelector('.heroStatement em').textContent='Wrong';});`;
  files['site.css']=css;
  files['images/torres-co-standing-lion-bronze.png']=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64');
  if(broken==='csp')files._headers="/*\n Content-Security-Policy: default-src 'self'; script-src 'none'";
  return {approved,files};
}
