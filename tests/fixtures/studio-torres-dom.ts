import {runInNewContext} from 'node:vm';
import {TORRES_TARGETS} from '../../functions/_shared/studio-torres-mapping';
class Element {
  attrs:Record<string,string>={};style:Record<string,string>={};dataset:Record<string,string>={};children:Element[]=[];childNodes:({nodeType:number;nodeValue:string|null}|Element)[]=[];parentElement:Element|null=null;clientWidth=1000;clientHeight=800;protected=false;nodeType=1;
  constructor(public tagName:string,txt?:string){if(txt!==undefined)this.childNodes=[{nodeType:3,nodeValue:txt}];}
  get textContent():string{return this.childNodes.map(n=>n instanceof Element?n.textContent:n.nodeValue||'').join('');}
  getAttribute(k:string){return this.attrs[k]??null;}
  setAttribute(k:string,v:string){this.attrs[k]=v;}
  removeAttribute(k:string){delete this.attrs[k];}
  closest(s:string):Element|null{if(s==='section'){for(let n:Element|null=this;n;n=n.parentElement)if(n.tagName==='SECTION')return n;return null;}if(s==='picture')return null;return this.protected?this:null;}
  contains(n:Element):boolean{for(let p:Element|null=n;p;p=p.parentElement)if(p===this)return true;return false;}
}
export function createTorresBrowser(route='/'){
  const selectors=new Map<string,Element[]>(),nodes=new Map<string,Element>(),sections=new Map<string,Element>();
  for(const t of TORRES_TARGETS){
    if(t.route!==route)continue;
    const n=new Element(t.tag,t.kind==='text'?t.expectedText:undefined);nodes.set(t.id,n);selectors.set(t.selector,[n]);
    if(t.kind==='image'){
      n.attrs.src=t.expectedSrc!;n.attrs.alt=t.expectedAlt!;let section=sections.get(t.sectionSelector!);if(!section){section=new Element('SECTION');sections.set(t.sectionSelector!,section);selectors.set(t.sectionSelector!,[section]);}
      const parent=new Element('DIV');parent.parentElement=section;n.parentElement=parent;
    }
  }
  const statement=nodes.get('home-statement'),em=nodes.get('home-statement-em');if(statement&&em){statement.children=[em];statement.childNodes=[{nodeType:3,nodeValue:'Considered design. '},em];em.parentElement=statement;}
  const handlers:Record<string,()=>void>={};const resize:(()=>void)[]=[];
  const document={readyState:'loading',documentElement:new Element('HTML'),querySelectorAll:(s:string)=>selectors.get(s)||[],addEventListener:(name:string,fn:()=>void)=>{handlers[name]=fn;}};
  const context={document,location:{pathname:route},getComputedStyle:()=>({position:'absolute'}),addEventListener:(name:string,fn:()=>void)=>{handlers[name]=fn;},removeEventListener:()=>{},ResizeObserver:class {constructor(fn:()=>void){resize.push(fn);}observe(){}disconnect(){}}};
  function hydrate(path=context.location.pathname){document.documentElement.dataset.torresStudioHydratedRoute=path.replace(/\/+$/,'')||'/';handlers['torres-studio:hydrated']?.();}
  return {context,document,handlers,resize,selectors,nodes,sections,hydrate,run(script:string,ready=true){runInNewContext(script,context);if(ready)hydrate();}};
}
