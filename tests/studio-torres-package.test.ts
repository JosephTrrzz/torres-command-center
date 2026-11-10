import {describe,expect,it} from 'vitest';
import manifest from '../lib/canvas-manifest.json';
import {compileTorresArtifact,TORRES_SOURCE_COMMIT} from '../functions/_shared/studio-torres-artifact';
import {contentHash} from '../functions/_shared/studio-publisher';
import {packageTorresArtifact,type TorresBuildFiles} from '../functions/_shared/studio-torres-package';
const releaseId='22222222-2222-4222-8222-222222222222';
async function artifact(){
  const draft={0:{2:{moveX:1,moveY:2},$content:{'page:2.1.3':{boxWidth:585,boxHeight:33}},$sections:{0:{},2:{}}},$shared:{'header:':{style:null}}};
  return compileTorresArtifact({releaseId,revision:26,snapshotId:manifest.id,sourceCommit:TORRES_SOURCE_COMMIT,draft,contentHash:await contentHash({draft,revision:26,snapshotId:manifest.id})});
}
// Representative Next export HTML. Includes executable/hydration scripts and live
// form markup so tests assert byte preservation, not replacement with snapshots.
const html=(route:string)=>`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Torres ${route}</title><link rel="stylesheet" href="/_next/static/site.css"/><script src="/_next/static/chunks/app.js" async=""></script><script>self.__next_f.push([1,"head text > and <meta name=\\"example\\">"])</script></head><body><header><a href="/contact">Contact</a></header><main id="home" class="homePage"><section class="hero homeFullBleed"><div class="heroLionBrand"><img src="/brand.png"/></div><p class="heroLead">Welcome café</p></section><form action="/api/contact" method="post"><input name="email" type="email" required/><input name="csrf" value="preserved"/><button type="submit">Send</button></form></main><footer>Footer</footer><script src="/receptionist.js"></script></body></html>`;
async function setup(directory=false){
  const a=await artifact();const files:Record<string,string|Uint8Array>={};
  for(const route of a.routes)files[route==='/'?'index.html':route.slice(1)+(directory?'/index.html':'.html')]=html(route);
  files['_next/static/chunks/app.js']='original javascript';files['_next/static/site.css']='original css';files['brand.png']=new Uint8Array([137,80,78,71]);files['404.html']='<h1>Not found</h1>';files['_headers']='/*\n Content-Security-Policy: script-src self';files['_redirects']='/old /contact 301';
  return {artifact:a,sourceCommit:TORRES_SOURCE_COMMIT,files};
}
function asText(v:string|Uint8Array){return typeof v==='string'?v:new TextDecoder('utf-8',{ignoreBOM:true}).decode(v);}
describe('pure Torres built-artifact packager',()=>{
  it.each([false,true])('patches all eleven routes, retaining every original byte (directory=%s)',async directory=>{
    const input=await setup(directory),before=structuredClone(input.files);
    const result=await packageTorresArtifact(input);
    expect(Object.keys(result.routeFiles)).toEqual(input.artifact.routes);
    expect(Object.keys(result.files)).toHaveLength(Object.keys(input.files).length+1);
    for(const route of input.artifact.routes){
      const file=result.routeFiles[route],output=asText(result.files[file]),original=asText(before[file]);
      const addition=input.artifact.marker+`<script src="${input.artifact.assetPath}" defer data-torres-studio="${releaseId}"></script>`;
      expect(output).toBe(original.replace('<head>','<head>'+addition));
      expect(output.replace(addition,'')).toBe(original);
      expect(output.indexOf(input.artifact.marker)).toBeLessThan(65536);
    }
    for(const path of ['_next/static/chunks/app.js','_next/static/site.css','brand.png','404.html','_headers','_redirects'])expect(result.files[path]).toEqual(before[path]);
    expect(result.files[input.artifact.assetPath.slice(1)]).toBe(input.artifact.script);
    expect(input.files).toEqual(before);expect(result.files['brand.png']).not.toBe(input.files['brand.png']);
  });
  it('is deterministic and idempotent for the same compiled release',async()=>{
    const input=await setup(),first=await packageTorresArtifact(input);
    expect(await packageTorresArtifact(input)).toEqual(first);
    expect(await packageTorresArtifact({...input,files:first.files})).toEqual(first);
  });
  it('preserves UTF-8 byte inputs including BOM',async()=>{
    const input=await setup();input.files['index.html']=new TextEncoder().encode('\ufeff'+html('/'));
    const result=await packageTorresArtifact(input);expect(result.files['index.html']).toBeInstanceOf(Uint8Array);
    expect(asText(result.files['index.html']).startsWith('\ufeff<!DOCTYPE html>')).toBe(true);
    expect(asText(result.files['index.html'])).toContain('café');
  });
  it.each(['sourceCommit','artifact.sourceCommit'])('rejects source mismatch %s without changing inputs',async field=>{
    const input=await setup(),before=structuredClone(input.files);
    if(field==='sourceCommit')input.sourceCommit='bad';else input.artifact.sourceCommit='bad';
    await expect(packageTorresArtifact(input)).rejects.toThrow('sourceCommit:');expect(input.files).toEqual(before);
  });
  it.each(Array.from({length:11},(_,i)=>i))('rejects missing route %i atomically',async i=>{
    const input=await setup(),route=input.artifact.routes[i];delete input.files[route==='/'?'index.html':route.slice(1)+'.html'];
    const before=structuredClone(input.files);await expect(packageTorresArtifact(input)).rejects.toThrow(`${route}: missing built route`);expect(input.files).toEqual(before);
  });
  it('rejects ambiguous route outputs',async()=>{const input=await setup();input.files['contact/index.html']=html('/contact');await expect(packageTorresArtifact(input)).rejects.toThrow('/contact: ambiguous');});
  it.each(['marker','assetPath','script','routes','protocol','releaseId','contentHash'])('rejects compiler-result tampering: %s',async field=>{
    const input=await setup();const changed={...input.artifact,[field]:field==='routes'?input.artifact.routes.slice(1):field==='protocol'?2:'tampered'};
    await expect(packageTorresArtifact({...input,artifact:changed as typeof input.artifact})).rejects.toThrow();
  });
  it.each([
    '<meta name="torres-studio-release" content="other">',
    '<META content="other" NAME="torres-studio-release">',
    '<meta name="torres&#45;studio-release" content="other">',
    '<meta name="torres&#x2d;studio-release" content="other">',
    '<meta name="torres&#45studio-release" content="other">',
    '<script src="/_studio/old.js" defer></script>',
    '<script src="/%5fstudio/old.js"></script>',
    '<script src="_studio/old.js"></script>',
    '<script src="https://example.com/_studio/old.js"></script>',
    '<script data-torres-studio="other" src="/other.js"></script>',
  ])('rejects incompatible existing tags: %s',async tag=>{
    const input=await setup();input.files['contact.html']=html('/contact').replace('</head>',tag+'</head>');const before=structuredClone(input.files);
    await expect(packageTorresArtifact(input)).rejects.toThrow('contact.html:');expect(input.files).toEqual(before);
  });
  it('rejects duplicate or misplaced matching markers',async()=>{
    const input=await setup();for(const suffix of [input.artifact.marker.repeat(2),'<template>'+input.artifact.marker+'</template>']){
      input.files['index.html']=html('/').replace('</head>',suffix+'</head>');await expect(packageTorresArtifact(input)).rejects.toThrow();
    }
    input.files['index.html']=html('/').replace('</body>',input.artifact.marker+'</body>');await expect(packageTorresArtifact(input)).rejects.toThrow('incompatible release marker');
  });
  it('adds only the missing script beside a matching existing marker',async()=>{
    const input=await setup();input.files['index.html']=html('/').replace('</head>',input.artifact.marker+'</head>');
    const result=await packageTorresArtifact(input);expect(asText(result.files['index.html']).split(input.artifact.marker)).toHaveLength(2);
  });
  it('rejects conflicting asset bytes before returning any result',async()=>{
    const input=await setup();input.files[input.artifact.assetPath.slice(1)]='wrong script';const before=structuredClone(input.files);
    await expect(packageTorresArtifact(input)).rejects.toThrow('existing incompatible asset');expect(input.files).toEqual(before);
  });
  it('retains matching existing asset bytes',async()=>{
    const input=await setup();input.files[input.artifact.assetPath.slice(1)]=new TextEncoder().encode(input.artifact.script);
    const result=await packageTorresArtifact(input);expect(result.files[input.artifact.assetPath.slice(1)]).toEqual(input.files[input.artifact.assetPath.slice(1)]);
  });
  it('ignores fake tags in comments and raw scripts/styles',async()=>{
    const input=await setup();const fake='<!-- <head><meta name="torres-studio-release" content="other"></head> -->';
    input.files['index.html']=html('/').replace('<head>','<head>'+fake+'<script>const fake=\'<meta name="torres-studio-release" content="other">\';</script><style>/* <head> */</style>');
    const result=await packageTorresArtifact(input);expect(asText(result.files['index.html'])).toContain(fake);
  });
  it('handles quoted greater-than and mixed-case head tags',async()=>{
    const input=await setup();input.files['index.html']=html('/').replace('<head>','<HEAD data-label="a > b">').replace('</head>','</HEAD>');
    expect(asText((await packageTorresArtifact(input)).files['index.html'])).toContain('<HEAD data-label="a > b">'+input.artifact.marker);
  });
  it.each([
    '<html><body>missing head</body></html>',
    '<html><head></head><head></head><body></body></html>',
    '<html><head><script>unterminated</head></html>',
    '<html><head><!-- unterminated</head></html>',
    '<html><head><meta name="one" name="two"></head></html>',
    '<html><head><div>invalid head child</div></head></html>',
    '<html><head><meta name="unterminated></head></html>',
    '<html><head></head><plaintext>rest',
    '<html><head></head>',
    '<html><head><!--><meta name="torres-studio-release" content="other"><!-- --></head><body></body></html>',
  ])('rejects ambiguous/malformed HTML %s',async document=>{const input=await setup();input.files['index.html']=document;await expect(packageTorresArtifact(input)).rejects.toThrow('index.html:');});
  it('enforces marker byte offset, not just character offset',async()=>{
    const input=await setup();input.files['index.html']='<!--'+'é'.repeat(33000)+'-->'+html('/');await expect(packageTorresArtifact(input)).rejects.toThrow('64 KiB');
  });
  it('rejects a matching marker too far into the head',async()=>{
    const input=await setup();input.files['index.html']=html('/').replace('</head>','<!--'+'x'.repeat(65536)+'-->'+input.artifact.marker+'</head>');await expect(packageTorresArtifact(input)).rejects.toThrow('64 KiB');
  });
  it.each(['../bad','/absolute','a/../b','a\\b','a//b'])('rejects unsafe file path %s',async path=>{const input=await setup();input.files[path]='x';await expect(packageTorresArtifact(input)).rejects.toThrow('export-relative');});
  it('rejects invalid UTF-8 without lossy conversion',async()=>{const input=await setup();input.files['index.html']=new Uint8Array([255]);await expect(packageTorresArtifact(input)).rejects.toThrow('UTF-8');});
  it('snapshots inputs before asynchronous hashing',async()=>{
    const input=await setup();const expected=structuredClone(input.files);const pending=packageTorresArtifact(input);
    input.files['index.html']='changed';(input.files['brand.png'] as Uint8Array)[0]=0;input.artifact.routes.pop();
    const result=await pending;expect(asText(result.files['index.html'])).toContain('<form');expect(result.files['brand.png']).toEqual(expected['brand.png']);expect(Object.keys(result.routeFiles)).toHaveLength(11);
  });
  it('accepts frozen caller maps',async()=>{const input=await setup();Object.freeze(input.files);await expect(packageTorresArtifact({...input,files:input.files as TorresBuildFiles})).resolves.toHaveProperty('assetPath');});
});
