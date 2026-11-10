import routes from '../../public/website-preview/pages.json';
import { TORRES_SOURCE_COMMIT, type compileTorresArtifact } from './studio-torres-artifact';
import { contentHash, UUID } from './studio-publisher';

export type TorresCompiledArtifact = Awaited<ReturnType<typeof compileTorresArtifact>>;
export type TorresBuildFiles = Readonly<Record<string, string | Uint8Array>>;
export type TorresPackageInput = {
  artifact: TorresCompiledArtifact;
  /** Commit of the actual build, supplied by the trusted build runner. */
  sourceCommit: string;
  /** Export-relative paths, e.g. index.html, contact.html or contact/index.html. */
  files: TorresBuildFiles;
};
const encoder = new TextEncoder();
function issue(path: string, message: string): never { throw Error(`${path}: ${message}`); }
function read(value: string | Uint8Array, path: string): string {
  if (typeof value === 'string') return value;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value); }
  catch { return issue(path, 'HTML/script is not valid UTF-8'); }
}
function decodeAttribute(value: string): string {
  return value.replace(/&(?:#(x[\da-f]+|\d+)|(amp|quot|apos|lt|gt));/gi, (whole, numeric: string, named: string) => {
    if (numeric) {
      const n = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1),16) : Number(numeric);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'} as Record<string,string>)[named.toLowerCase()];
  });
}
type Tag = {name:string; closing:boolean; start:number; end:number; attrs:Record<string,string>; raw?:string};
// Scan without reserializing HTML: quoted '>', comments and raw-text elements
// must not be mistaken for a real head, marker or script. Ambiguous input fails.
function tags(html:string,path:string):Tag[] {
  const result:Tag[]=[]; let pos=0;
  while(pos<html.length){
    const start=html.indexOf('<',pos);if(start<0)break;
    if(html.startsWith('<!--',start)){
      const end=html.indexOf('-->',start+4);if(end<0)issue(path,'unterminated HTML comment');
      const comment=html.slice(start+4,end);
      if(comment.startsWith('>')||comment.startsWith('->')||comment.includes('--!>')||comment.includes('<!--'))issue(path,'ambiguous HTML comment');
      pos=end+3;continue;
    }
    const opening=/^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)\b/.exec(html.slice(start));
    if(!opening){
      if(/^<!doctype\s+html\s*>/i.test(html.slice(start))){pos=start+html.slice(start).indexOf('>')+1;continue;}
      if(/^<[!?]/.test(html.slice(start)))issue(path,'unsupported HTML declaration');
      pos=start+1;continue;
    }
    // Whitespace immediately after '<' is not a browser tag; refuse ambiguity.
    if(!/^<\/?[A-Za-z]/.test(html.slice(start)))issue(path,'ambiguous HTML tag');
    let end=start+opening[0].length,quote='';
    for(;end<html.length;end++){
      const c=html[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;
    }
    if(end===html.length)issue(path,'unterminated HTML tag');
    const name=opening[2].toLowerCase(),closing=!!opening[1];
    const attrs:Record<string,string>=Object.create(null);
    let rest=html.slice(start+opening[0].length,end);
    if(closing&&rest.trim())issue(path,'malformed closing tag');
    while(rest.trim()&&!closing){
      if(/^\s*\/$/.test(rest)){rest='';break;}
      const m=/^\s+([^\s=\/>"'<`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/.exec(rest);
      if(!m)issue(path,'malformed HTML attribute');
      const key=m![1].toLowerCase();if(Object.hasOwn(attrs,key))issue(path,`duplicate HTML attribute ${key}`);
      attrs[key]=decodeAttribute(m![2]??m![3]??m![4]??'');rest=rest.slice(m![0].length);
    }
    const tag:Tag={name,closing,start,end:end+1,attrs};result.push(tag);pos=end+1;
    if(!closing&&['script','style','title','textarea','xmp','iframe','noembed','noframes','noscript'].includes(name)){
      const close=new RegExp(`</${name}\\s*>`,'ig');close.lastIndex=pos;const m=close.exec(html);
      if(!m)issue(path,`unterminated ${name}`);
      tag.raw=html.slice(pos,m!.index);
      if(name==='script'&&tag.raw.includes('<!--')&&/<script[\s>]/i.test(tag.raw))issue(path,'unsupported double-escaped script text');
      pos=close.lastIndex;
    }
    if(name==='plaintext')issue(path,'plaintext documents cannot be packaged safely');
  }
  return result;
}
function reservedScript(src:string|undefined,path:string):boolean {
  if(!src)return false;
  let decoded=src;
  for(let i=0;i<5;i++){
    let next:string;
    try{next=decodeURIComponent(decoded);}catch{issue(path,'invalid encoding in script URL');}
    if(next === decoded)break;
    decoded=next!;
    if(i===4)issue(path,'excessive encoding in script URL');
  }
  // Browser URL parsing normalizes relative paths and backslashes. Recognize
  // reserved assets even when their original URL spelling is noncanonical.
  try{return new URL(decoded,'https://torrescotechnology.com/').pathname.includes('/_studio/');}
  catch{return issue(path,'invalid script URL');}
}
function plan(html:string,path:string,artifact:TorresCompiledArtifact):{at:number;insert:string} {
  const parsed=tags(html,path),heads=parsed.filter(t=>t.name==='head');
  if(heads.length!==2||heads[0].closing||!heads[1].closing)issue(path,'expected exactly one explicit head');
  const [head,close]=heads;
  const documents=parsed.filter(t=>t.name==='html'),bodies=parsed.filter(t=>t.name==='body');
  if(documents.length!==2||documents[0].closing||!documents[1].closing||bodies.length!==2||bodies[0].closing||!bodies[1].closing||bodies[0].start<close.end||bodies[1].end>documents[1].start)issue(path,'expected complete html/head/body document');
  const before=parsed.filter(t=>t.start<head.start);
  if(before.some(t=>t.name!=='html'||t.closing)||before.length!==1)issue(path,'head must belong to the document html element');
  const headTags=parsed.filter(t=>t.start>head.start&&t.start<close.start);
  if(headTags.some(t=>!['base','link','meta','title','style','script','noscript'].includes(t.name)||t.closing))issue(path,'unsupported or malformed head structure');
  const markers=parsed.filter(t=>!t.closing&&t.name==='meta'&&t.attrs.name?.toLowerCase()==='torres-studio-release');
  if(markers.length>1)issue(path,'duplicate release markers');
  for(const marker of markers){
    if(marker.start<head.end||marker.end>close.start||marker.attrs.content!==`${artifact.releaseId}:${artifact.contentHash}`||Object.keys(marker.attrs).some(k=>!['name','content'].includes(k)))issue(path,'existing incompatible release marker');
    if(encoder.encode(html.slice(0,marker.end)).length>65536)issue(path,'existing release marker lies outside first 64 KiB');
  }
  // Refuse ambiguous entity encodings of reserved metadata instead of overlooking them.
  if(parsed.some(t=>t.name==='meta'&&t.attrs.name?.includes('&')))issue(path,'unresolved entity in metadata name');
  const scripts=parsed.filter(t=>!t.closing&&t.name==='script'&&(Object.hasOwn(t.attrs,'data-torres-studio')||reservedScript(t.attrs.src,path)));
  if(scripts.length>1)issue(path,'duplicate Studio scripts');
  for(const script of scripts){
    if(script.start<head.end||script.end>close.start||script.attrs.src!==artifact.assetPath||script.attrs['data-torres-studio']!==artifact.releaseId||!Object.hasOwn(script.attrs,'defer')||script.attrs.defer!==''||script.raw?.trim()||Object.keys(script.attrs).some(k=>!['src','defer','data-torres-studio'].includes(k)))issue(path,'existing incompatible Studio script');
  }
  if(parsed.some(t=>t.name==='script'&&t.attrs.src?.includes('&')))issue(path,'unresolved entity in script URL');
  const scriptTag=`<script src="${artifact.assetPath}" defer data-torres-studio="${artifact.releaseId}"></script>`;
  const insert=(markers.length?'':artifact.marker)+(scripts.length?'':scriptTag);
  const markerEnd=markers.length?markers[0].end+insert.length:head.end+artifact.marker.length;
  const markerPrefix=markers.length?html.slice(0,head.end)+insert+html.slice(head.end,markers[0].end):html.slice(0,head.end)+artifact.marker;
  if(markerEnd>65536||encoder.encode(markerPrefix).length>65536)issue(path,'release marker would exceed first 64 KiB');
  return {at:head.end,insert};
}

/** Pure packaging only: no filesystem, network, deployment, or readiness side effects.
 * The build runner must attest the build's commit; a string cannot prove provenance.
 * The compiler result is a trusted internal input, not a browser payload.
 */
export async function packageTorresArtifact(input:TorresPackageInput):Promise<{
  files:Record<string,string|Uint8Array>; routeFiles:Record<string,string>; assetPath:string;
}> {
  // Capture all inputs before the first await (no caller mutation during hashing).
  const artifact={...input.artifact,routes:[...input.artifact.routes]};
  if(input.sourceCommit!==TORRES_SOURCE_COMMIT||artifact.sourceCommit!==input.sourceCommit)issue('sourceCommit','build and artifact must match the pinned source');
  if(artifact.protocol!==1||!UUID.test(artifact.releaseId)||!/^[a-f0-9]{64}$/.test(artifact.contentHash)||typeof artifact.script!=='string')issue('artifact','invalid compiler identity');
  const canonicalRoutes=routes.map(p=>p.route);
  if(artifact.routes.length!==11||artifact.routes.some((r,i)=>r!==canonicalRoutes[i]))issue('artifact.routes','expected all eleven canonical routes in compiler order');
  if(artifact.marker!==`<meta name="torres-studio-release" content="${artifact.releaseId}:${artifact.contentHash}">`)issue('artifact.marker','marker does not match compiler identity');
  const snapshot:Record<string,string|Uint8Array>=Object.create(null);
  for(const [path,value] of Object.entries(input.files)){
    if(!path||path.startsWith('/')||/[\\\u0000-\u001f\u007f]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..')||['__proto__','constructor','prototype'].includes(path))issue(path||'files','expected safe export-relative file path');
    if(typeof value!=='string'&&!(value instanceof Uint8Array))issue(path,'expected string or byte array');
    snapshot[path]=typeof value==='string'?value:value.slice();
  }
  const hash=await contentHash({script:artifact.script,sourceCommit:artifact.sourceCommit,contentHash:artifact.contentHash});
  if(artifact.assetPath!==`/_studio/${hash}.js`)issue('artifact.assetPath','script fingerprint does not match compiler artifact');
  const assetFile=artifact.assetPath.slice(1);
  if(Object.hasOwn(snapshot,assetFile)&&read(snapshot[assetFile],assetFile)!==artifact.script)issue(assetFile,'existing incompatible asset');
  const routeFiles:Record<string,string>=Object.create(null);
  const plans:{path:string;html:string;at:number;insert:string;bytes:boolean}[]=[];
  for(const route of canonicalRoutes){
    const candidates=route==='/'?['index.html']:[`${route.slice(1)}.html`,`${route.slice(1)}/index.html`];
    const matches=candidates.filter(p=>Object.hasOwn(snapshot,p));
    if(matches.length!==1)issue(route,matches.length?'ambiguous built route (both export layouts exist)':'missing built route');
    const path=matches[0],html=read(snapshot[path],path);
    plans.push({path,html,...plan(html,path,artifact),bytes:snapshot[path] instanceof Uint8Array});routeFiles[route]=path;
  }
  // All route/marker/asset checks have passed. Only now construct changed output.
  const files:Record<string,string|Uint8Array>={...snapshot};
  for(const p of plans){
    if(!p.insert)continue;
    const updated=p.html.slice(0,p.at)+p.insert+p.html.slice(p.at);
    files[p.path]=p.bytes?encoder.encode(updated):updated;
  }
  if(!Object.hasOwn(files,assetFile))files[assetFile]=artifact.script;
  return {files,routeFiles,assetPath:artifact.assetPath};
}
