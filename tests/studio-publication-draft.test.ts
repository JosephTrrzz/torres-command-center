import {describe,expect,it} from 'vitest';
import manifest from '../lib/canvas-manifest.json';
import {publicationDraftIssue} from '../functions/_shared/studio-publication-draft';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=';
const check=(v:unknown)=>publicationDraftIssue(v,manifest.id);
const shape={id:'shape-1',section:0,kind:'text',x:5,y:5,w:40,h:20,color:'#123456',opacity:80,rotation:30,text:'Hello',font:'serif',fontSize:24,textColor:'#abcdef',bold:true,italic:false,align:'center'};
function representative(){return {
  '0':{
    '0':{text:'Title',src:png,alt:'Photo',moveX:-10,moveY:10,flipX:true,opacity:90,frame:'rounded',width:50,height:200,fit:'cover',position:'center',cropX:25,cropY:75},
    $sections:{'0':{deleted:false,color:'#abcdef',backgroundImage:png,width:80,height:480,spacing:64,surface:'ivory',sizePreset:'comfortable'},'1':{height:null,spacing:null}},
    $buttons:{'0':{size:'large',style:'pill'}},
    $content:{'page:0.1':{text:'Copy',href:'/contact#form',font:'Georgia',fontSize:30,bold:true,italic:false,color:'#123456',background:'#ffffff',spacing:20,boxWidth:300,boxHeight:80,offsetX:5,offsetY:-5,movementLocked:false},'page:added-new:0':{text:'New heading'}},
    $addedSections:[{id:'new',index:5,before:0,template:'text',heading:'New',body:'Body'},{id:'blank',index:6,before:null,template:'blank',heading:'',body:''}],
    $copies:[], $shapes:[shape,{...shape,id:'photo',kind:'image',src:png,fit:'contain'}],
    $groups:[['page:0.1','photo:0','shape:shape-1','header:0']],$locks:['page:0.1','shape:shape-1'],
  },
  ...Object.fromEntries(Array.from({length:10},(_,i)=>[String(i+1),{}])),
  $shared:{'header:':{style:'position: relative; color: #123456; padding-top: 16px; border: 1px solid #123456;',href:'https://example.com/path',src:png,srcset:null,alt:'Logo',text:'Brand'},'footer:0':{style:null,href:null,src:null,srcset:null,alt:null}},
  $sharedContent:{'footer:':{spacing:32,background:'#ffffff',movementLocked:true},'header:0':{href:'mailto:hello@example.com'}},
};}
describe('strict publication draft preflight',()=>{
  it('accepts complete supported draft without mutating it',()=>{const d=representative(),before=JSON.stringify(d);expect(check(d)).toBeNull();expect(JSON.stringify(d)).toBe(before);});
  it('accepts the reported draft26 field combination (illustrative geometry)',()=>{
    // Production values were not retrieved; this tests the reported field shape.
    expect(check({
      '0':{
        '2':{moveX:5,moveY:-3},
        $content:{'page:2.1.3':{boxWidth:320,boxHeight:80}},
        $sections:{'0':{},'2':{}},
      },
      $shared:{'header:':{style:null},'header:0.1':{style:null},'footer:':{style:null},'footer:0.2':{style:null}},
    })).toBeNull();
  });
  it('accepts empty draft but binds it to the exact snapshot',()=>{expect(check({})).toBeNull();expect(publicationDraftIssue({},'old')).toContain('snapshotId:');});
  it.each(['11','-1','00','01','999','$unknown'])('rejects top-level key %s',k=>{expect(check({[k]:{}})).toContain(`draft["${k}"]`);});
  it.each([null,[],true,'text',12])('rejects non-object draft %j',v=>expect(check(v)).toContain('draft:'));
  it.each(['$content','$sections','$buttons','$shapes','$groups','$locks','$addedSections','$copies'])('rejects wrong container %s',k=>expect(check({0:{[k]:false}})).toContain(`draft["0"]["${k}"]`));
  it('rejects copies explicitly, even otherwise safe HTML',()=>{expect(check({0:{$copies:[{id:'x',index:2,after:0,html:'<section>Hi</section>'}]}})).toMatch(/draft\["0"\]\["\$copies"\]: unsupported copied sections/);});
  it.each(['page:0','shape:x','header:bad','footer:0..1'])('restricts shared scope %s',k=>{for(const field of ['$shared','$sharedContent'])expect(check({[field]:{[k]:{}}})).toContain(`draft["${field}"]["${k}"]`);});
  it('rejects shared keys in page content',()=>expect(check({0:{$content:{'header:0':{}}}})).toContain('expected page context key'));
  it.each(['//evil.test','\\evil.test','/\\evil.test','javascript:alert(1)','data:text/html;base64,SGk=','/a\nb','/a%0ab','/%5cevil','/%2fevil','/%252fevil','https://user:pass@example.com','https://example.com/%00','https://example.com/\u007f','relative/path','https:example.com','https:///example.com','https://example.com/%zz'])('rejects unsafe href %s',href=>expect(check({$sharedContent:{'header:0':{href}}})).toContain('["href"]'));
  it.each(['/contact','#form','https://example.com/path','http://example.com','mailto:a@example.com','tel:+15551234567'])('allows safe href %s',href=>expect(check({0:{$content:{'page:0':{href}}}})).toBeNull());
  it.each(['background: url(https://evil.test);','--custom: red;','color: expression(alert(1));','color: red !important;','position: fixed;','z-index: 999;','color: #123456; color: #ffffff','color: \\72 ed;','@import "x";','width: calc(100%);','padding: -2px;','font-size: 99999px;','background: /*x*/ #ffffff;'])('rejects unsupported CSS %s',style=>expect(check({$shared:{'header:':{style}}})).toContain('["style"]'));
  it('rejects unknown fields at every patch level',()=>{
    const cases=[{0:{0:{onclick:'evil'}}},{0:{$sections:{0:{unknown:true}}}},{0:{$buttons:{0:{href:'/'}}}},{0:{$content:{'page:0':{html:'evil'}}}},{$shared:{'header:':{onload:'evil'}}},{0:{$shapes:[{...shape,unknown:1}]}},{0:{$addedSections:[{id:'new',index:1,before:null,template:'blank',heading:'',body:'',unknown:1}]}}];
    for(const d of cases)expect(check(d)).toMatch(/\["(onclick|unknown|href|html|onload)"\]: unknown field/);
  });
  it.each([['width',9],['height',1201],['opacity',101],['moveX',101],['cropX',-1],['flipX','true'],['frame','square'],['fit','stretch']])('checks node %s', (k,v)=>expect(check({0:{0:{[k as string]:v}}})).toContain(`["${k}"]`));
  it.each([['fontSize',161],['spacing',201],['boxWidth',39],['boxHeight',23],['offsetX',2401],['bold',1],['color','red'],['font','Comic Sans']])('checks context %s',(k,v)=>expect(check({0:{$content:{'page:0':{[k as string]:v}}}})).toContain(`["${k}"]`));
  it.each([['width',39],['height',6001],['spacing',201],['surface','red'],['sizePreset','huge'],['deleted',1]])('checks section %s',(k,v)=>expect(check({0:{$sections:{0:{[k as string]:v}}}})).toContain(`["${k}"]`));
  it.each([['size','huge'],['style','custom']])('checks button %s',(k,v)=>expect(check({0:{$buttons:{0:{[k]:v}}}})).toContain(`["${k}"]`));
  it.each(['rectangle','rounded','ellipse','triangle','diamond','line','image','text','bubble'])('accepts supported shape %s',kind=>expect(check({0:{$shapes:[{...shape,kind,...(kind==='image'?{src:png}:{})}]}})).toBeNull());
  it.each([['index',-1],['before',1.5],['template','html'],['heading','x'.repeat(4001)],['id','../bad']])('checks added section %s',(k,v)=>expect(check({0:{$addedSections:[{id:'new',index:1,before:null,template:'text',heading:'Hi',body:'Text',[k as string]:v}]}})).toContain(`["${k}"]`));
  it('requires paired coordinates',()=>expect(check({0:{0:{moveX:1}}})).toContain('["moveY"]'));
  it('checks shape bounds and required fields',()=>{expect(check({0:{$shapes:[{...shape,x:90}]}})).toContain('["w"]');expect(check({0:{$shapes:[{...shape,kind:'image'}]}})).toContain('["src"]');expect(check({0:{$shapes:[{...shape,rotation:181}]}})).toContain('["rotation"]');});
  it('checks metadata membership types',()=>{expect(check({0:{$groups:[['page:0',42]]}})).toContain('[1]');expect(check({0:{$locks:['unknown:x']}})).not.toBeNull();});
  it('checks collection limits, duplicates and required addition fields',()=>{expect(check({0:{$shapes:Array(101).fill(shape)}})).toContain('$shapes');expect(check({0:{$shapes:[shape,shape]}})).toContain('[1]["id"]');expect(check({0:{$addedSections:[{}]}})).toContain('[0]["id"]');});
  it.each(['data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,SGVsbG8=','data:image/jpeg;base64,iVBORw0KGgo=','data:image/png;base64,abc','data:image/png;base64,AAAA====','data:image/png;base64,AA A=','http://example.com/image.png','javascript:alert(1)'])('rejects invalid image %s',src=>expect(check({0:{0:{src}}})).toContain('["src"]'));
  it('validates canonical base64 and decoded image size',()=>{const bytes=Buffer.alloc(2_097_153);bytes.set([137,80,78,71,13,10,26,10]);expect(check({0:{0:{src:'data:image/png;base64,'+bytes.toString('base64')}}})).toContain('["src"]');expect(check({0:{0:{src:'data:image/jpeg;base64,/9j/2R=='}}})).toContain('["src"]');});
  it('allows signature-matching JPEG/WebP and safe asset URLs',()=>{const jpeg='data:image/jpeg;base64,'+Buffer.from([255,216,255,217]).toString('base64');const webp='data:image/webp;base64,'+Buffer.from('RIFF\x0c\0\0\0WEBPVP8 \0\0\0\0','binary').toString('base64');for(const src of [jpeg,webp,'/website-preview/assets/test.png','assets/test.webp','https://example.com/a.png'])expect(check({0:{0:{src}}})).toBeNull();});
  it('rejects non-null srcset',()=>expect(check({$shared:{'header:0':{srcset:'evil 2x'}}})).toContain('["srcset"]'));
  it('rejects prototype pollution, getters, cycles and non-JSON values',()=>{
    expect(check(JSON.parse('{"0":{"__proto__":{}}}'))).toContain('__proto__');
    const getter=Object.defineProperty({},'0',{enumerable:true,get(){throw Error('must not execute');}});expect(check(getter)).toContain('accessors');
    const cycle:Record<string,unknown>={};cycle['0']=cycle;expect(check(cycle)).toContain('cyclic');
    for(const v of [NaN,Infinity,undefined,()=>0,BigInt(1),new Date()])expect(check({0:{0:{text:v}}})).not.toBeNull();
    expect(check({0:{$locks:Array(1)}})).toContain('sparse');
  });
  it('caps aggregate bytes and text lengths',()=>{expect(check({0:{0:{text:'x'.repeat(10001)}}})).toContain('["text"]');expect(check({0:{0:{src:png.repeat(22000)},1:{src:png.repeat(22000)}}})).toContain('4,000,000-byte');});
});
