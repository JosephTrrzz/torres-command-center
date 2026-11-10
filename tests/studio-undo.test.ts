import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect} from 'vitest';
function setup(initial:object={}){
 const controls=new Map<string,any>(),messages:any[]=[],loads:number[]=[];
 const context:any={drafts:initial,active:0,pages:[{file:'page-0.html'},{file:'page-1.html'}],canvasReady:true,dirty:false,saveTimer:null,status:{textContent:''},frame:{contentWindow:{}},crypto:{randomUUID:()=> 'restore-1'},setTimeout:()=>1,clearTimeout:()=>{},queueMicrotask:()=>{},changed:()=>{},openPage:()=>{},captureDraft:async()=>true,persistDraft:()=>true,closeInspector:()=>{},loadPage:(p:number)=>loads.push(p),send:(d:any)=>messages.push(d),addEventListener:()=>{},document:{addEventListener:()=>{},querySelector:()=>null},$: (id:string)=>{if(!controls.has(id))controls.set(id,{style:{setProperty:()=>{}}});return controls.get(id)}};
 runInNewContext(readFileSync('public/website-preview/draft-history.js','utf8'),context);
 runInNewContext(readFileSync('public/website-preview/site-history.js','utf8'),context);
 return {context,controls,messages,loads};
}
describe('website history rendering',()=>{
 it('restores a text edit without navigating the iframe',async()=>{
  const s=setup();s.context.drafts={0:{$content:{'page:0':{text:'Edited'}}}};s.context.changed();await s.controls.get('#undo-shape').onclick();
  expect(s.loads).toEqual([]);expect(s.messages).toEqual([expect.objectContaining({type:'history-apply',edits:{},requestId:'restore-1'})]);
 });
 it('uses a document rebuild when undo removes an added section',async()=>{
  const s=setup();s.context.drafts={0:{$addedSections:[{id:'new'}]}};s.context.changed();await s.controls.get('#undo-shape').onclick();expect(s.loads).toEqual([0]);expect(s.messages).toEqual([]);
 });
 it('keeps shared content in the in-place restore payload',async()=>{
  const s=setup({$sharedContent:{'header:0':{text:'Original'}}});s.context.drafts={$sharedContent:{'header:0':{text:'Edited'}}};s.context.changed();await s.controls.get('#undo-shape').onclick();expect(s.messages[0].sharedContent).toEqual({'header:0':{text:'Original'}});
 });
});
