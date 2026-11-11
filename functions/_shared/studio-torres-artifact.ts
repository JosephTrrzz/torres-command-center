import manifest from '../../lib/canvas-manifest.json';
import routes from '../../public/website-preview/pages.json';
import { canonical, contentHash, UUID } from './studio-publisher';
import { publicationDraftIssue } from './studio-publication-draft';
import { TORRES_SOURCE_COMMIT, TORRES_MAPPING_SNAPSHOT, TORRES_TARGETS, type TorresTarget } from './studio-torres-mapping';
export { TORRES_SOURCE_COMMIT } from './studio-torres-mapping';

export type ArtifactInput = {
  releaseId: string; snapshotId: string; revision: number; contentHash: string;
  sourceCommit: string; draft: unknown;
};
type Values = Record<string, unknown>;
type Operation = { target: TorresTarget; path: string; text?: string; attrs: Record<string,string|null>; styles: Record<string,string>; move?: {x:number;y:number} };
type RuntimePayload = { releaseId: string; operations: Operation[] };
const at = (path:string,key:string) => `${path}[${JSON.stringify(key)}]`;
function unsupported(path:string):never { throw Error(`${path}: this edit does not have a verified static public-site mapping.`); }
function record(value:unknown,path:string):Values {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(path+': expected an object.');
  return value as Values;
}
function empty(value:unknown,path:string){if(Object.keys(record(value,path)).length)unsupported(path);}
function replacementImage(src:string,path:string):string {
  if(/^data:image\/(png|jpeg|webp);base64,/.test(src))return src; // magic/base64/size checked by publication preflight
  for(const target of TORRES_TARGETS){
    if(target.kind!=='image')continue;
    if(src===target.expectedSrc||src===target.snapshotSrc||src===target.snapshotSrc?.replace('/website-preview/',''))return target.expectedSrc!;
  }
  throw Error(path+': only validated raster uploads or mapped source images are supported.');
}
function imagePatch(op:Operation,values:Values,path:string){
  const permitted=['src','alt','moveX','moveY','flipX','opacity','frame','width','height','fit','position','cropX','cropY'];
  for(const key of Object.keys(values))if(!permitted.includes(key))unsupported(at(path,key));
  if(typeof values.src==='string'){op.attrs.src=replacementImage(values.src,at(path,'src'));op.attrs.srcset=null;}
  if(typeof values.alt==='string')op.attrs.alt=values.alt;
  const s=op.styles;
  if(typeof values.moveX==='number')op.move={x:values.moveX,y:values.moveY as number};
  // False/original preserve the approved source style, matching a fresh preview restore.
  if(values.flipX===true)s.scale='-1 1';
  if(typeof values.opacity==='number')s.opacity=String(values.opacity/100);
  if(values.frame==='rounded'||values.frame==='oval')s.borderRadius=values.frame==='oval'?'50%':'24px';
  if(typeof values.width==='number'){s.width=values.width+'%';s.maxWidth='100%';}
  if(typeof values.height==='number'){s.height=values.height+'px';s.maxHeight='none';}
  if(typeof values.fit==='string')s.objectFit=values.fit;
  if(typeof values.position==='string')s.objectPosition=values.position;
  if(typeof values.cropX==='number')s.objectPosition=values.cropX+'% '+values.cropY+'%';
}
function contextPatch(op:Operation,values:Values,path:string){
  const permitted=['text','font','fontSize','bold','italic','color','background','spacing','boxWidth','boxHeight','offsetX','offsetY','movementLocked'];
  if(op.target.kind==='image')unsupported(path);
  // Context text on a mixed-content parent means a direct-text replacement in
  // the editor, unlike legacy flattened text. Keep that distinct case refused.
  if(op.target.kind==='compound'&&Object.hasOwn(values,'text'))unsupported(at(path,'text'));
  for(const key of Object.keys(values))if(!permitted.includes(key))unsupported(at(path,key));
  if(typeof values.text==='string')op.text=values.text;
  const s=op.styles;
  if(typeof values.font==='string')s.fontFamily=values.font;
  if(typeof values.fontSize==='number')s.fontSize=values.fontSize+'px';
  if(typeof values.bold==='boolean')s.fontWeight=values.bold?'700':'400';
  if(typeof values.italic==='boolean')s.fontStyle=values.italic?'italic':'normal';
  if(typeof values.color==='string')s.color=values.color;
  if(typeof values.background==='string')s.backgroundColor=values.background;
  if(typeof values.spacing==='number'){s.paddingTop=values.spacing+'px';s.paddingBottom=values.spacing+'px';}
  if(typeof values.boxWidth==='number'||typeof values.boxHeight==='number'){
    s.overflowWrap='anywhere';s.whiteSpace='normal';s.flexShrink='0';s.boxSizing='border-box';
  }
  // Bound width itself, not only max-width: a definite pixel width can enlarge
  // an auto-minimum grid track before percentage max-width is resolved.
  if(typeof values.boxWidth==='number'){s.width='min('+values.boxWidth+'px, 100%)';s.maxWidth='100%';}
  if(typeof values.boxHeight==='number'){s.minHeight=values.boxHeight+'px';s.height='auto';}
  if(typeof values.offsetX==='number')s.translate=values.offsetX+'px '+values.offsetY+'px';
  // movementLocked is validated editor metadata, deliberately has no public effect.
}

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
function runTorresPatches(payload:RuntimePayload){
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

export async function compileTorresArtifact(input:ArtifactInput){
  const issue=publicationDraftIssue(input.draft,input.snapshotId);if(issue)throw Error(issue);
  if(!UUID.test(input.releaseId)||input.snapshotId!==manifest.id||input.snapshotId!==TORRES_MAPPING_SNAPSHOT||input.sourceCommit!==TORRES_SOURCE_COMMIT||!Number.isSafeInteger(input.revision)||input.revision<1)throw Error('The saved draft and approved website source do not match.');
  // Freeze the private JSON before async hashing; a caller cannot substitute edits.
  const draft=JSON.parse(JSON.stringify(input.draft)) as Values;
  const identity={releaseId:input.releaseId,sourceCommit:input.sourceCommit,contentHash:input.contentHash,snapshotId:input.snapshotId,revision:input.revision};
  if(await contentHash({snapshotId:identity.snapshotId,revision:identity.revision,draft})!==identity.contentHash)throw Error('The saved draft fingerprint does not match this release.');
  const operations=new Map<string,Operation>();
  function operation(target:TorresTarget,path:string){
    let op=operations.get(target.id);if(!op){op={target,path,attrs:{},styles:{}};operations.set(target.id,op);}return op;
  }
  for(const [page,value] of Object.entries(draft)){
    const path=at('draft',page);
    if(page==='$shared'){
      for(const [key,attributes] of Object.entries(record(value,path))){
        const attrs=record(attributes,at(path,key));
        // Existing null captures are baseline bookkeeping, not shared mutations.
        if(Object.keys(attrs).length!==1||attrs.style!==null)unsupported(at(path,key));
      }
      continue;
    }
    if(page==='$sharedContent'){empty(value,path);continue;}
    const edits=record(value,path);
    // Numeric patches restore first; contextual patches override afterward,
    // independent of JSON property insertion order.
    for(const [key,value] of Object.entries(edits)){
      if(key.startsWith('$'))continue;
      const p=at(path,key),values=record(value,p),target=TORRES_TARGETS.find(t=>t.page===page&&t.nodeId===key);
      if(!target)unsupported(p);
      const op=operation(target,p);
      if(target.kind==='image')imagePatch(op,values,p);
      else{for(const field of Object.keys(values))if(field!=='text')unsupported(at(p,field));if(typeof values.text==='string')op.text=values.text;}
    }
    for(const [key,value] of Object.entries(edits)){
      const p=at(path,key);
      if(key==='$content')for(const [id,patch] of Object.entries(record(value,p))){
        const q=at(p,id),target=TORRES_TARGETS.find(t=>t.page===page&&t.contextKey===id);
        if(!target)unsupported(q);contextPatch(operation(target,q),record(patch,q),q);
      }
      else if(key==='$sections'||key==='$buttons'){for(const [id,patch]of Object.entries(record(value,p)))empty(patch,at(p,id));}
      else if(['$addedSections','$copies','$shapes'].includes(key)){if((value as unknown[]).length)unsupported(p);}
      else if(key==='$groups'||key==='$locks'){/* Validated editor-only metadata. */}
      else if(key.startsWith('$'))unsupported(p);
    }
  }
  // Legacy numeric text is a flattened paragraph. A matching explicit child
  // edit is required to recover the boundary without replacing its semantic EM.
  for(const op of Array.from(operations.values()))if(op.target.kind==='compound'&&op.text!==undefined){
    const nested=operations.get(op.target.childTarget!);
    const childText=nested?.text;
    if(!childText||!op.text.endsWith(childText)||op.text.indexOf(childText)!==op.text.lastIndexOf(childText)){
      throw Error(at(op.path,'text')+': ambiguous compound text; provide a unique trailing nested emphasis text edit.');
    }
    const prefix=op.text.slice(0,-childText.length);
    if(!prefix||!/\s$/.test(prefix))throw Error(at(op.path,'text')+': ambiguous boundary before nested emphasis.');
    op.text=prefix;
  }
  const list=Array.from(operations.values()).filter(op=>op.text!==undefined||Object.keys(op.attrs).length||Object.keys(op.styles).length||op.move).sort((a,b)=>a.target.id.localeCompare(b.target.id));
  const payload=canonical({releaseId:identity.releaseId,operations:list}).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const script=`(${runTorresPatches.toString()})(${payload});`;
  const artifactHash=await contentHash({script,sourceCommit:identity.sourceCommit,contentHash:identity.contentHash});
  return {protocol:1 as const,releaseId:identity.releaseId,contentHash:identity.contentHash,sourceCommit:identity.sourceCommit,assetPath:'/_studio/'+artifactHash+'.js',script,marker:'<meta name="torres-studio-release" content="'+identity.releaseId+':'+identity.contentHash+'">',routes:routes.map(page=>page.route)};
}
