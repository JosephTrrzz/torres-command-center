import type { TorresTarget } from './studio-torres-mapping';

export type Operation = { target: TorresTarget; path: string; text?: string; attrs: Record<string,string|null>; styles: Record<string,string>; move?: {x:number;y:number} };
type RuntimePayload = { releaseId: string; operations: Operation[] };

// Minimal DOM contract keeps the server compiler compatible with Worker libraries.
interface PatchText { nodeType:number; nodeValue:string|null }
interface PatchElement {
  tagName:string; textContent:string|null; children:ArrayLike<unknown>; childNodes:ArrayLike<PatchText>;
  parentElement:PatchElement|null; clientWidth:number; clientHeight:number;
  style:Record<string,string>; dataset:Record<string,string>;
  getAttribute(name:string):string|null; setAttribute(name:string,value:string):void; removeAttribute(name:string):void;
  closest(selector:string):PatchElement|null; contains(node:PatchElement):boolean;
}
interface PatchObserver { observe(node:PatchElement):void; disconnect():void }
interface PatchBrowser {
  document:{documentElement:PatchElement;querySelectorAll(selector:string):ArrayLike<PatchElement>;addEventListener(name:string,callback:()=>void):void};
  location:{pathname:string}; ResizeObserver?:new(callback:()=>void)=>PatchObserver;
  getComputedStyle(node:PatchElement):{position:string};
  addEventListener(name:string,callback:()=>void,options?:{once?:boolean;passive?:boolean}):void;
  removeEventListener(name:string,callback:()=>void):void;
}
// Self-contained browser function: only the fixed compiler emits this code. No
// editor scripts, selectors from drafts, HTML parsing, DOM replacement or network.
export function runTorresPatches(payload:RuntimePayload){
  const browser=globalThis as unknown as PatchBrowser;
  const document=browser.document,location=browser.location,ResizeObserver=browser.ResizeObserver;
  let appliedRoute:string|null=null;
  let appliedBindings:{op:Operation;node:PatchElement}[]=[];
  let dispose:()=>void=function(){};
  function apply(){
    const route=location.pathname.replace(/\/+$/,'')||'/';
    // Only the reviewed source's route effect can declare hydration complete.
    // load/DOMContentLoaded/readystate and readiness from another route are not
    // authorization to mutate React's server-rendered DOM.
    if(document.documentElement.dataset.torresStudioHydratedRoute!==route)return;
    if(appliedRoute===route&&appliedBindings.length&&appliedBindings.every(function(b){
      const nodes=document.querySelectorAll(b.op.target.selector);return nodes.length===1&&nodes[0]===b.node;
    }))return;
    dispose();appliedRoute=null;appliedBindings=[];
    if(document.documentElement.dataset.studioApplied===payload.releaseId)delete document.documentElement.dataset.studioApplied;
    const operations=payload.operations.filter(function(op){return op.target.route===route;});
    if(!operations.length)return;
    const bindings:{op:Operation;node:PatchElement;textNode:PatchText|null;section:PatchElement|null}[]=[];
    const normalize=function(v:string){return v.replace(/\s+/g,' ').trim();};
    const fail=function(path:string):never{throw Error(path+': public source target is missing, ambiguous, interactive, or changed; no patches applied.');};
    // Resolve and verify every target before touching any element.
    for(const op of operations){
      const matches=document.querySelectorAll(op.target.selector);
      if(matches.length!==1)fail(op.path);
      const node=matches[0];
      if(node.tagName!==op.target.tag||node.closest('form,button,a,input,select,textarea,[contenteditable="true"],[role="dialog"],.receptionist,.priceBuilder'))fail(op.path);
      let textNode:PatchText|null=null,section:PatchElement|null=null;
      if(op.target.kind!=='image'){
        const texts=Array.from(node.childNodes).filter(function(n){return n.nodeType===3;});
        if(texts.length!==1||normalize(node.textContent||'')!==normalize(op.target.expectedText||''))fail(op.path);
        if(op.target.kind==='compound'){
          const child=node.children[0] as PatchElement|undefined;
          if(node.children.length!==1||node.childNodes.length!==2||node.childNodes[0]!==texts[0]||!child||child.tagName!=='EM'||child.textContent!==op.target.expectedChildText)fail(op.path);
        }else if(node.children.length)fail(op.path);
        textNode=texts[0];
      }else{
        if(node.getAttribute('src')!==op.target.expectedSrc||node.getAttribute('alt')!==op.target.expectedAlt||node.closest('picture'))fail(op.path);
        const sections=document.querySelectorAll(op.target.sectionSelector!);
        if(sections.length!==1||!sections[0].contains(node)||node.closest('section')!==sections[0])fail(op.path);
        section=sections[0];
      }
      bindings.push({op,node,textNode,section});
    }
    const saved:{node:PatchElement;style:string|null;src:string|null;srcset:string|null;alt:string|null}[]=[];
    const remember=function(node:PatchElement){
      if(saved.some(function(v){return v.node===node;}))return;
      saved.push({node,style:node.getAttribute('style'),src:node.getAttribute('src'),srcset:node.getAttribute('srcset'),alt:node.getAttribute('alt')});
    };
    const oldTexts:{node:PatchText;value:string|null}[]=[];
    const observers:PatchObserver[]=[];const listeners:(()=>void)[]=[];
    try{
      for(const binding of bindings){
        const op=binding.op,node=binding.node;remember(node);
        if(op.text!==undefined&&binding.textNode){oldTexts.push({node:binding.textNode,value:binding.textNode.nodeValue});binding.textNode.nodeValue=op.text;}
        for(const key of Object.keys(op.attrs)){
          const value=op.attrs[key];if(value===null)node.removeAttribute(key);else node.setAttribute(key,value);
        }
        for(const key of Object.keys(op.styles))(node.style as unknown as Record<string,string>)[key]=op.styles[key];
        if(op.move&&binding.section){
          const section=binding.section,offset=op.move;
          for(let parent=node.parentElement;parent&&parent!==section;parent=parent.parentElement){remember(parent);parent.style.overflow='visible';}
          if(browser.getComputedStyle(node).position==='static')node.style.position='relative';
          node.style.zIndex='21';
          const move=function(){
            if((location.pathname.replace(/\/+$/,'')||'/')!==route||document.documentElement.dataset.torresStudioHydratedRoute!==route)return;
            const matches=document.querySelectorAll(op.target.selector);if(matches.length!==1||matches[0]!==node)return;
            node.style.translate=(offset.x*section.clientWidth/100)+'px '+(offset.y*section.clientHeight/100)+'px';
          };
          move();
          if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(move);observer.observe(section);observers.push(observer);}
          else{browser.addEventListener('resize',move,{passive:true});listeners.push(move);}
        }
      }
      document.documentElement.dataset.studioApplied=payload.releaseId;
      appliedRoute=route;appliedBindings=bindings;
      dispose=function(){for(const observer of observers)observer.disconnect();for(const listener of listeners)browser.removeEventListener('resize',listener);};
    }catch(error){
      for(const observer of observers)observer.disconnect();
      for(const listener of listeners)browser.removeEventListener('resize',listener);
      for(const entry of oldTexts)entry.node.nodeValue=entry.value;
      for(const entry of saved){for(const key of ['style','src','srcset','alt'] as const){const value=entry[key];if(value===null)entry.node.removeAttribute(key);else entry.node.setAttribute(key,value);}}
      throw error;
    }
  }
  document.addEventListener('torres-studio:hydrated',apply);
  apply(); // Handles the source effect firing before this artifact script loads.
}

