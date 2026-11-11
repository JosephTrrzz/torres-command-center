import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTorresBrowser as browser} from './fixtures/studio-torres-dom';
import ts from 'typescript';
import sources from './fixtures/studio-torres-mapping-source.json';
import manifest from '../lib/canvas-manifest.json';
import {TORRES_TARGETS,TORRES_MAPPING_SNAPSHOT,TORRES_SOURCE_COMMIT} from '../functions/_shared/studio-torres-mapping';
import {compileTorresArtifact} from '../functions/_shared/studio-torres-artifact';
import {contentHash} from '../functions/_shared/studio-publisher';
const releaseId='22222222-2222-4222-8222-222222222222';
const draft36={0:{2:{moveX:0.0002577932091776258,moveY:0.7486839508623404},3:{text:'Considered design. Personal attention'},$content:{'page:2.1.3':{boxWidth:585.4470825195312,boxHeight:33.324668884277344},'page:2.1.2.0':{text:'Personal attention'}},$sections:{0:{},2:{}}},$shared:{'header:':{style:null},'footer:':{style:null}}};
async function compile(draft:unknown=draft36){return compileTorresArtifact({releaseId,snapshotId:manifest.id,revision:36,contentHash:await contentHash({snapshotId:manifest.id,revision:36,draft}),sourceCommit:TORRES_SOURCE_COMMIT,draft});}
const decode=(s:string)=>s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,k:string)=>k[0]==='#'?String.fromCodePoint(k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):Number(k.slice(1))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'}[k.toLowerCase()]!));
// Small test-only HTML tree reader; skips raw script/style text so registry
// positions are computed from the snapshot, not hand-maintained numeric fixtures.
type Tree={tag:string;attrs:Record<string,string>;children:Tree[];parent:Tree|null;parts:(string|Tree)[]};
function snapshot(page:string){
  const html=readFileSync(new URL(`../public/website-preview/page-${page}.html`,import.meta.url),'utf8');
  const root:Tree={tag:'root',attrs:{},children:[],parent:null,parts:[]};const stack=[root],all:Tree[]=[];
  const tokens=/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+|</g;let m:RegExpExecArray|null;
  while((m=tokens.exec(html))){const token=m[0],top=stack[stack.length-1];if(token.startsWith('<!'))continue;
    if(token.startsWith('</')){const tag=token.slice(2,-1).trim().toLowerCase();const i=stack.map(n=>n.tag).lastIndexOf(tag);if(i>0)stack.splice(i);continue;}
    if(token.startsWith('<')&&token.length>1){const tag=/^<([\w-]+)/.exec(token)![1].toLowerCase();const attrs:Record<string,string>={};for(const a of Array.from(token.matchAll(/\s([\w:-]+)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/g)))attrs[a[1].toLowerCase()]=decode(a[2]??a[3]??a[4]??'');
      const n:Tree={tag,attrs,children:[],parent:top,parts:[]};top.children.push(n);top.parts.push(n);all.push(n);
      if(['script','style'].includes(tag)){const end=html.indexOf('</'+tag,tokens.lastIndex);if(end>=0)tokens.lastIndex=html.indexOf('>',end)+1;continue;}
      if(!['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'].includes(tag))stack.push(n);
    }else top.parts.push(decode(token));
  }
  const text=(n:Tree):string=>n.parts.map(p=>typeof p==='string'?p:text(p)).join('');
  const descendants=(n:Tree):Tree[]=>n.children.flatMap(c=>[c,...descendants(c)]);
  const main=all.find(n=>n.tag==='main')!;
  const nodes=all.filter(n=>(['h1','h2','h3','h4','p','li'].includes(n.tag)||(n.tag==='img'&&descendants(main).includes(n)))&&(n.tag==='img'||(!!text(n).trim()&&!descendants(n).some(d=>['img','input','button','select','textarea','p','h1','h2','h3','h4','li'].includes(d.tag)))));
  return {main,nodes,text};
}
describe('verified static Torres mapping',()=>{
  it('binds the reviewed source blobs and snapshot identity',()=>{
    expect(sources.commit).toBe(TORRES_SOURCE_COMMIT);expect(TORRES_MAPPING_SNAPSHOT).toBe(manifest.id);
    for(const fixture of Object.values(sources.files)){const bytes=Buffer.from(fixture.content);expect(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')).toBe(fixture.sha);}
  });
  it.each(TORRES_TARGETS)('verifies snapshot numeric/context identity for $id',t=>{
    const page=snapshot(t.page);let n=t.nodeId===null?undefined:page.nodes[Number(t.nodeId)];
    if(t.contextKey){let context=page.main;for(const part of t.contextKey.slice(5).split('.'))context=context.children[Number(part)];if(n)expect(context).toBe(n);else n=context;
      for(let p:Tree|null=context;p&&p!==page.main;p=p.parent)expect(['header','footer','form','svg','script','style']).not.toContain(p.tag);
    }
    expect(n!.tag.toUpperCase()).toBe(t.tag);
    if(t.kind==='image'){expect(n!.attrs.src).toBe(t.snapshotSrc);expect(n!.attrs.alt).toBe(t.expectedAlt);}else expect(page.text(n!)).toBe(t.expectedText);
    const fixture=sources.files[t.sourceFile as keyof typeof sources.files];expect(fixture.sha).toBe(t.sourceBlob);
    // Parse source JSX: prove that the baseline is a static literal, not a
    // calculator/form state expression that happens to resemble snapshot text.
    const source=ts.createSourceFile(t.sourceFile,fixture.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found=false;
    function visit(node:ts.Node){
      if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(source).toUpperCase()===t.tag){
        const flat=node.children.map(c=>ts.isJsxText(c)?decode(c.text):ts.isJsxElement(c)&&t.kind==='compound'?c.children.map(x=>ts.isJsxText(x)?decode(x.text):'!dynamic!').join(''):'!dynamic!').join('');
        if(flat===t.expectedText)found=true;
      }
      if(ts.isJsxSelfClosingElement(node)&&t.kind==='image'&&node.tagName.getText(source)==='img'){
        const attributes:Record<string,string>={};for(const a of node.attributes.properties)if(ts.isJsxAttribute(a)&&a.initializer&&ts.isStringLiteral(a.initializer))attributes[a.name.getText(source)]=decode(a.initializer.text);
        if(attributes.src===t.expectedSrc&&attributes.alt===t.expectedAlt)found=true;
      }
      ts.forEachChild(node,visit);
    }
    visit(source);expect(found).toBe(true);
  });
});
describe('expanded static patch compiler',()=>{
  it('applies draft36 parent and nested text without replacing EM or listeners',async()=>{
    const a=await compile(),b=browser(),parent=b.nodes.get('home-statement')!,em=b.nodes.get('home-statement-em')!,textNode=parent.childNodes[0];
    const listener=()=>42;Object.assign(em,{listener});b.run(a.script);
    expect(parent.textContent).toBe('Considered design. Personal attention');expect(parent.children[0]).toBe(em);expect(parent.childNodes[0]).toBe(textNode);expect((em as unknown as {listener:()=>number}).listener()).toBe(42);
    const lead=b.nodes.get('home-lead')!;expect(lead.style.width).toBe('min(585.4470825195312px, 100%)');expect(lead.style.minHeight).toBe('33.324668884277344px');
    expect(b.document.documentElement.dataset.studioApplied).toBe(releaseId);
    const image=b.nodes.get('home-lion')!,old=image.style.translate;b.sections.values().next().value!.clientHeight=400;b.resize[0]();expect(image.style.translate).not.toBe(old);expect(image.style.position).toBeUndefined();
  });
  it('supports child-only text and preserves surrounding punctuation',async()=>{
    const b=browser();b.run((await compile({0:{$content:{'page:2.1.2.0':{text:'Updated emphasis'}}}})).script);
    expect(b.nodes.get('home-statement')!.textContent).toBe('Considered design. Updated emphasis');
  });
  it.each([
    {3:{text:'No explicit child edit'}},
    {3:{text:'Personal attention Personal attention'},$content:{'page:2.1.2.0':{text:'Personal attention'}}},
    {3:{text:'Personal attention comes first'},$content:{'page:2.1.2.0':{text:'Personal attention'}}},
    {3:{text:'Personal attention'},$content:{'page:2.1.2.0':{text:'Personal attention'}}},
    {3:{text:'HelloWorld'},$content:{'page:2.1.2.0':{text:'World'}}},
    {3:{text:'Hi'},$content:{'page:2.1.2.0':{text:''}}},
  ])('rejects ambiguous flattened text %j',async page=>{await expect(compile({0:page})).rejects.toThrow(/draft\["0"\]\["3"\]\["text"\]: ambiguous/);});
  it('gives context text precedence independent of property ordering',async()=>{
    for(const page of [{4:{text:'numeric'},$content:{'page:2.1.3':{text:'context'}}},{$content:{'page:2.1.3':{text:'context'}},4:{text:'numeric'}}]){const b=browser();b.run((await compile({0:page})).script);expect(b.nodes.get('home-lead')!.textContent).toBe('context');}
  });
  it('supports all mapped leaf text targets and route-scopes application',async()=>{
    for(const t of TORRES_TARGETS.filter(t=>t.kind==='text'&&t.nodeId!==null)){
      const a=await compile({[t.page]:{[t.nodeId!]:{text:'Updated '+t.id}}}),b=browser(t.route);b.run(a.script);expect(b.nodes.get(t.id)!.textContent).toBe('Updated '+t.id);
    }
    const b=browser('/contact');b.run((await compile({0:{4:{text:'Home only'}}})).script);expect(b.document.documentElement.dataset.studioApplied).toBeUndefined();
  });
  it('applies explicit context styles without replacing baseline styles',async()=>{
    const b=browser();b.nodes.get('home-lead')!.style.lineHeight='1.6';b.run((await compile({0:{$content:{'page:2.1.3':{font:'Georgia',fontSize:30,bold:true,italic:true,color:'#123456',background:'#abcdef',spacing:12,boxWidth:400,boxHeight:100,offsetX:5,offsetY:-4,movementLocked:true}}}})).script);
    expect(b.nodes.get('home-lead')!.style).toMatchObject({lineHeight:'1.6',fontFamily:'Georgia',fontSize:'30px',fontWeight:'700',fontStyle:'italic',color:'#123456',backgroundColor:'#abcdef',paddingTop:'12px',paddingBottom:'12px',width:'min(400px, 100%)',minHeight:'100px',translate:'5px -4px'});
  });
  it('maps preview image assets and applies image geometry/crop without replacing the image',async()=>{
    const portrait=TORRES_TARGETS.find(t=>t.id==='about-portrait')!,b=browser(),image=b.nodes.get('home-lion')!;image.attrs.srcset='old 2x';
    b.run((await compile({0:{2:{src:portrait.snapshotSrc,alt:'Updated',width:50,height:200,fit:'contain',position:'top',cropX:20,cropY:30,flipX:true,frame:'oval',opacity:70}}})).script);
    expect(b.nodes.get('home-lion')).toBe(image);expect(image.attrs.src).toBe(portrait.expectedSrc);expect(image.attrs.srcset).toBeUndefined();expect(image.attrs.alt).toBe('Updated');expect(image.style).toMatchObject({width:'50%',height:'200px',objectFit:'contain',objectPosition:'20% 30%',scale:'-1 1',borderRadius:'50%',opacity:'0.7'});
  });
  it('treats HTML-like text only as text, with safe serialization',async()=>{
    const text='</script><img src=x onerror=alert(1)>\u2028&';const a=await compile({0:{4:{text}}}),b=browser();expect(a.script).not.toContain('</script>');b.run(a.script);expect(b.nodes.get('home-lead')!.textContent).toBe(text);expect(b.nodes.get('home-lead')!.children).toHaveLength(0);
  });
  it.each(['missing','duplicate','changed-text','changed-tag','protected','changed-em'])('fails before any mutation on %s source drift',async failure=>{
    const b=browser(),lead=TORRES_TARGETS.find(t=>t.id==='home-lead')!,node=b.nodes.get('home-lead')!;
    if(failure==='missing')b.selectors.delete(lead.selector);if(failure==='duplicate')b.selectors.set(lead.selector,[node,node]);if(failure==='changed-text')node.childNodes[0]={nodeType:3,nodeValue:'drift'};if(failure==='changed-tag')node.tagName='DIV';if(failure==='protected')node.protected=true;if(failure==='changed-em')b.nodes.get('home-statement-em')!.tagName='STRONG';
    const a=await compile();expect(()=>b.run(a.script)).toThrow('no patches applied');expect(b.nodes.get('home-lion')!.style).toEqual({});expect(b.document.documentElement.dataset.studioApplied).toBeUndefined();
  });
  it.each([
    {0:{999:{text:'unknown'}}},{8:{1:{text:'nested span'}}},{10:{10:{text:'form content'}}},
    {8:{$content:{'page:2.0.1':{text:'unregistered context'}}}},
    {0:{2:{text:'image is not text'}}},{0:{$content:{'page:2.1.3':{href:'/contact'}}}},
    {0:{2:{src:'https://external.example/image.png'}}},
    {0:{$sections:{0:{deleted:true}}}},{$sharedContent:{'footer:':{text:'unsupported'}}},
    {0:{$copies:[{id:'copy',index:1,after:0,html:'<section>copy</section>'}]}},
  ])('rejects unsupported edits with draft paths %j',async draft=>{await expect(compile(draft)).rejects.toThrow('draft[');});
  it('retains the packager contract, determinism, and metadata-only no-ops',async()=>{
    const a=await compile();expect(a).toEqual(await compile());expect(a.routes).toHaveLength(11);expect(a.protocol).toBe(1);expect(a.assetPath).toMatch(/^\/_studio\/[a-f0-9]{64}\.js$/);
    expect(a.script).not.toMatch(/innerHTML|fetch\(|postMessage|eval\(/);
    await expect(compile({0:{$groups:[['page:2.1.3','photo:2']],$locks:['photo:2'],$copies:[],$addedSections:[],$shapes:[]}})).resolves.toHaveProperty('script');
  });
});
