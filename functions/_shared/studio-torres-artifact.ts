import { TORRES_RUNTIME_SOURCE } from './studio-torres-runtime.generated';
import type { Operation } from './studio-torres-runtime';
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
  // Runtime bytes are generated data: serializing a bundled function would
  // capture Worker-only helpers (e.g. esbuild keepNames' __name).
  const script=`(${TORRES_RUNTIME_SOURCE})(${payload});`;
  const artifactHash=await contentHash({script,sourceCommit:identity.sourceCommit,contentHash:identity.contentHash});
  return {protocol:1 as const,releaseId:identity.releaseId,contentHash:identity.contentHash,sourceCommit:identity.sourceCommit,assetPath:'/_studio/'+artifactHash+'.js',script,marker:'<meta name="torres-studio-release" content="'+identity.releaseId+':'+identity.contentHash+'">',routes:routes.map(page=>page.route)};
}
