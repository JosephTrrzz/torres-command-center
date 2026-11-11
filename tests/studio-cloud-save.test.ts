import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect} from 'vitest';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const handlers=new Map<string,Function[]>(),sent:any[]=[],nodes=new Map<string,any>(),timers:{fn:Function;ms:number}[]=[];
 const node=(id:string):any=>{if(!nodes.has(id)){
  const listeners=new Map<string,Function[]>();
  nodes.set(id,{hidden:false,inert:false,textContent:'',disabled:false,open:false,
   querySelector:(s:string)=>node(id+s),addEventListener:(name:string,fn:Function)=>listeners.set(name,[...(listeners.get(name)||[]),fn]),
   replaceChildren:()=>{},querySelectorAll:()=>[],append:()=>{},after:()=>{},setAttribute:()=>{},focus:()=>{},classList:{remove:()=>{}},
   showModal:()=>{node(id).open=true},close:()=>{node(id).open=false;listeners.get('close')?.forEach(fn=>fn())}});
 }return nodes.get(id)};
 const parent={postMessage:(message:any)=>sent.push(message)};let serial=0;
 const context:any={URLSearchParams,location:{search:'?connected=1',origin:'https://app.test'},crypto:{randomUUID:()=>String(++serial)},parent,Intl,Date,JSON,Map,Error,Promise,Event,setTimeout:(fn:Function,ms:number)=>{timers.push({fn,ms});return timers.length},clearTimeout:()=>{},drafts:{},dirty:false,pages:[],active:0,saveTimer:null,canvasReady:true,loadPage:()=>{},changed:()=>{context.dirty=true},captureDraft:async()=>true,persistDraft:()=>true,status:node('status'),$:node,document:{querySelector:node,createElement:node,body:node('body'),hidden:false},addEventListener:(type:string,fn:Function)=>{handlers.set(type,[...(handlers.get(type)||[]),fn])}};
 context.window={dispatchEvent:()=>{}};
 runInNewContext(readFileSync('public/website-preview/cloud-drafts.js','utf8'),context);
 const reply=(request:any,result?:any,error?:string,status?:number)=>handlers.get('message')!.forEach(fn=>fn({source:parent,origin:context.location.origin,data:{type:'canvas-result',requestId:request.requestId,result,error,status}}));
 return {context,sent,node,reply,handlers,timers};
}
async function loaded(){const s=setup();s.reply(s.sent[0],{draft:{},revision:4});await tick();
 const statusIndex=s.sent.findIndex(r=>r.type==='canvas-publish-status');
 if(statusIndex>=0){s.reply(s.sent[statusIndex],{ready:false,publication:null});s.sent.splice(statusIndex,1);await tick();}
 return s;}

describe('connected draft saving',()=>{
 it('waits for confirmation and saves edits made during an in-flight save',async()=>{
  const s=await loaded();s.context.drafts={0:{text:'First'}};s.context.changed();s.context.persistDraft();
  expect(s.context.dirty).toBe(true);expect(s.sent[1]).toMatchObject({type:'canvas-save',revision:4,draft:{0:{text:'First'}}});
  s.context.drafts={0:{text:'Second'}};s.reply(s.sent[1],{revision:5});await tick();
  expect(s.context.dirty).toBe(true);expect(s.sent[2]).toMatchObject({revision:5,draft:{0:{text:'Second'}}});
  s.reply(s.sent[2],{revision:6});await tick();expect(s.context.dirty).toBe(false);expect(s.node('status').textContent).toContain('Saved to your account');
 });
 it('keeps failed changes and retries only autosave when back online',async()=>{
  const s=await loaded();s.context.drafts={0:{text:'Keep me'}};s.context.changed();s.context.persistDraft();
  s.reply(s.sent[1],undefined,'Network unavailable',503);await tick();expect(s.context.dirty).toBe(true);expect(s.node('status').textContent).toContain('Click Save draft to retry');
  s.handlers.get('online')![0]();expect(s.sent[2]).toMatchObject({type:'canvas-save',revision:4});expect(s.sent[2].checkpoint).toBeUndefined();
 });
 it.each([401,403,409])('does not overwrite or retry a blocked %s save',async status=>{
  const s=await loaded();s.context.drafts={0:{text:'Keep me'}};s.context.changed();s.context.persistDraft();s.reply(s.sent[1],undefined,'Blocked',status);await tick();
  s.handlers.get('online')![0]();await s.node('#save').onclick();expect(s.sent).toHaveLength(2);expect(s.context.dirty).toBe(true);
 });
 it('explicit save creates a checkpoint even when autosave is current',async()=>{
  const s=await loaded();const saving=s.node('#save').onclick();await tick();expect(s.node('.workspace').inert).toBe(true);expect(s.sent[1]).toMatchObject({checkpoint:true,revision:4,draft:{}});
  s.reply(s.sent[1],{revision:5,created_at:'2026-11-10T20:00:00Z'});await saving;expect(s.node('.workspace').inert).toBe(false);expect(s.node('status').textContent).toContain('Draft saved');
 });
});

describe('publishing dialog recovery',()=>{
 it('polls the latest status without draft or delivery mutations',async()=>{
  const s=await loaded();const opening=s.node('button').onclick();
  s.reply(s.sent.at(-1),{ready:true,name:'Assigned site',publicUrl:'https://example.test',publication:{id:'active',revision:4,status:'deploying'}});await opening;
  const polling=s.timers.filter(t=>t.ms===30000).at(-1)!.fn();
  expect(s.sent.at(-1).type).toBe('canvas-publish-status');
  s.reply(s.sent.at(-1),{ready:true,name:'Assigned site',publicUrl:'https://example.test',publication:{id:'active',revision:4,status:'live',verifiedAt:'2026-11-10T20:00:00Z'}});await polling;
  expect(s.node('button').textContent).toBe('Now Live');
  expect(s.node('dialog[data-publish-version]').textContent).toBe('Saved draft · Version 4');
  expect(s.sent.some(r=>['canvas-save','canvas-publish','canvas-publish-check'].includes(r.type))).toBe(false);
 });

 it('discovers the latest publication without saving or advancing an old cached release',async()=>{
  const s=await loaded();const opening=s.node('button').onclick();
  s.reply(s.sent.at(-1),{ready:false,name:'Assigned site',publicUrl:'https://example.test',message:'Not connected',publication:{id:'old',revision:4,status:'failed'}});await opening;
  expect(s.node('dialog[data-publish-check]').hidden).toBe(false);
  s.context.drafts={0:{text:'Unsaved'}};s.context.dirty=true;
  const before=s.sent.length;const checking=s.node('dialog[data-publish-check]').onclick();
  expect(s.sent.slice(before).map(r=>r.type)).toEqual(['canvas-publish-status']);
  s.reply(s.sent.at(-1),{ready:false,name:'Assigned site',publicUrl:'https://example.test',message:'Not connected',publication:{id:'latest',revision:5,status:'deploying'}});await checking;
  expect(s.node('dialog[data-publish-version]').textContent).toBe('Saved draft · Version 4 · Publication · Version 5');
  expect(s.node('dialog[data-publish-confirm]').hidden).toBe(true);
  expect(s.context.dirty).toBe(true);expect(s.context.drafts).toEqual({0:{text:'Unsaved'}});
  expect(s.sent.some(r=>['canvas-save','canvas-publish','canvas-publish-check'].includes(r.type))).toBe(false);
 });
 it('opens status without capturing or saving dirty drafts and refuses confirmation',async()=>{
  const s=await loaded();s.context.dirty=true;s.context.drafts={0:{text:'Keep private'}};
  const opening=s.node('button').onclick();
  expect(s.sent.at(-1).type).toBe('canvas-publish-status');
  s.reply(s.sent.at(-1),{ready:true,name:'Assigned site',publicUrl:'https://example.test',publication:null});await opening;
  expect(s.node('dialog[data-publish-confirm]').disabled).toBe(true);
  expect(s.node('dialog[data-publish-message]').textContent).toContain('Save your changes');
  const count=s.sent.length;await s.node('dialog[data-publish-confirm]').onclick();expect(s.sent).toHaveLength(count);
  expect(s.sent.some(r=>r.type==='canvas-save')).toBe(false);
 });
 it('refreshes from no cached publication and never labels a different revision as the current live draft',async()=>{
  const s=await loaded();const checking=s.node('dialog[data-publish-check]').onclick();
  s.reply(s.sent.at(-1),{ready:true,name:'Assigned site',publicUrl:'https://example.test',publication:{id:'latest',revision:5,status:'live',verifiedAt:'2026-11-10T20:00:00Z'}});await checking;
  expect(s.node('button').textContent).toBe('Push to live site');
  expect(s.node('dialog[data-publish-version]').textContent).toContain('Publication · Version 5');
  expect(s.node('dialog[data-publish-link]').hidden).toBe(false);
 });
 it('keeps status refresh retryable on error and prevents confirmation from stale readiness',async()=>{
  const s=await loaded();const opening=s.node('button').onclick();
  s.reply(s.sent.at(-1),{ready:true,name:'Assigned site',publicUrl:'https://example.test',publication:null});await opening;
  expect(s.node('dialog[data-publish-confirm]').disabled).toBe(false);
  const checking=s.node('dialog[data-publish-check]').onclick();s.reply(s.sent.at(-1),undefined,'Unavailable',503);await checking;
  expect(s.node('dialog[data-publish-check]').disabled).toBe(false);
  expect(s.node('dialog[data-publish-confirm]').disabled).toBe(true);
  expect(s.node('dialog[data-publish-message]').textContent).toBe('Unavailable');
 });
 it('releases the editor when the review is closed during a status request',async()=>{
  const s=await loaded();const opening=s.node('button').onclick();await tick();
  s.reply(s.sent.at(-1),{ready:true,name:'Assigned site',publicUrl:'https://example.test',publication:{id:'release',revision:4,status:'deploying'}});await opening;
  expect(s.node('.workspace').inert).toBe(true);
  const checking=s.node('dialog[data-publish-check]').onclick();
  s.node('dialog[data-publish-close]').onclick();
  expect(s.node('.workspace').inert).toBe(false);
  s.reply(s.sent.at(-1),{publication:{id:'release',revision:4,status:'deploying'}});await checking;
  expect(s.node('.workspace').inert).toBe(false);
 });
});
