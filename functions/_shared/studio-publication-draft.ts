import manifest from '../../lib/canvas-manifest.json';

// A fail-closed publication boundary, not a renderer or a source/DOM mapping check.
type Check = (value: unknown, path: string) => void;
type Fields = Record<string, Check>;
class DraftIssue extends Error {}
const fail = (path: string, message: string): never => { throw new DraftIssue(`${path}: ${message}`); };
const child = (path: string, key: string) => `${path}[${JSON.stringify(key)}]`;
const controls = /[\u0000-\u001f\u007f-\u009f]/;
const number = (min: number, max: number, integer = false): Check => (v, p) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) fail(p, `expected ${integer ? 'integer' : 'number'} from ${min} to ${max}`);
};
const text = (max: number): Check => (v, p) => {
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(v)) fail(p, `expected text of at most ${max} characters without unsafe controls`);
};
const choice = (...values: string[]): Check => (v, p) => { if (typeof v !== 'string' || !values.includes(v)) fail(p, `expected one of ${values.join(', ')}`); };
const bool: Check = (v, p) => { if (typeof v !== 'boolean') fail(p, 'expected boolean'); };
const nullable = (check: Check): Check => (v, p) => { if (v !== null) check(v, p); };
const color: Check = (v, p) => { if (typeof v !== 'string' || !/^#[\da-f]{6}$/i.test(v)) fail(p, 'expected #RRGGBB color'); };
const identifier: Check = (v, p) => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,79}$/.test(v)) fail(p, 'expected safe identifier (1–79 characters)'); };
const index: Check = (v, p) => { if (typeof v !== 'string' || !/^(0|[1-9]\d{0,3})$/.test(v)) fail(p, 'expected canonical numeric index (0–9999)'); };
function object(v: unknown, p: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail(p, 'expected plain object');
  return v as Record<string, unknown>;
}
const record = (key: Check, value: Check): Check => (v, p) => {
  for (const [k, x] of Object.entries(object(v, p))) { key(k, child(p, k)); value(x, child(p, k)); }
};
const fields = (schema: Fields, required: string[] = []): Check => (v, p) => {
  const o = object(v, p);
  for (const k of required) if (!Object.hasOwn(o, k)) fail(child(p, k), 'required field is missing');
  for (const [k, x] of Object.entries(o)) {
    if (!Object.hasOwn(schema, k)) fail(child(p, k), 'unknown field');
    schema[k](x, child(p, k));
  }
};
const array = (check: Check, max: number, min = 0): Check => (v, p) => {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail(p, `expected array with ${min}–${max} entries`);
  (v as unknown[]).forEach((x, i) => check(x, `${p}[${i}]`));
};
const contextKey = (shared: boolean): Check => (v, p) => {
  const pattern = shared ? /^(header|footer):(?:\d+(?:\.\d+)*)?$/ : /^page:(?:(?:added|copy)-[A-Za-z0-9_-]{1,79}:)?(?:\d+(?:\.\d+)*)?$/;
  if (typeof v !== 'string' || v.length > 180 || !pattern.test(v)) fail(p, shared ? 'expected header/footer context key' : 'expected page context key');
};
const selectionKey: Check = (v, p) => {
  if (typeof v !== 'string' || v.length > 180) fail(p, 'expected selection key');
  if (/^(photo:(0|[1-9]\d{0,3})|shape:[A-Za-z0-9_-]{1,79})$/.test(v as string)) return;
  contextKey(/^(header|footer):/.test(v as string))(v, p);
};
function safeURL(v: unknown, p: string, image = false): void {
  if (typeof v !== 'string' || !v || v.length > 4096 || /[\\\s]/.test(v) || controls.test(v)) fail(p, 'unsafe URL');
  const s = v as string;
  let decoded = s;
  for (let i = 0; i < 5; i++) {
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { fail(p, 'invalid URL encoding'); }
    if (/[\\\u0000-\u0020\u007f-\u009f]/.test(next!) || next!.startsWith('//')) fail(p, 'unsafe encoded URL');
    if (next! === decoded) break;
    decoded = next!;
    if (i === 4) fail(p, 'excessively encoded URL');
  }
  if (s.startsWith('//')) fail(p, 'protocol-relative URLs are forbidden');
  if (s.startsWith('/') || (!image && s.startsWith('#'))) return;
  if (image && /^(?:\/website-preview\/)?assets\/[A-Za-z0-9._-]+$/.test(s)) return;
  if (!image && /^(mailto:[^@?]+@[^@?]+|tel:\+?[0-9().-]+)$/i.test(s)) return;
  if (!/^https?:\/\/[^/]/i.test(s)) fail(p, 'expected explicit HTTP(S) URL scheme');
  try {
    const u = new URL(s);
    if (!(image ? ['https:'] : ['http:', 'https:']).includes(u.protocol) || !u.hostname || u.username || u.password) fail(p, 'unsafe URL scheme or credentials');
  } catch { fail(p, 'expected safe absolute URL, root-relative path, or supported link'); }
}
const image: Check = (v, p) => {
  if (typeof v !== 'string') fail(p, 'expected raster image URL');
  if (!(v as string).startsWith('data:')) return safeURL(v, p, true);
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v as string);
  if (!match || match[2].length > 2_796_204 || match[2].length % 4 !== 0) fail(p, 'expected canonical raster base64 image under 2 MiB');
  let bytes: string;
  try { bytes = atob(match![2]); } catch { fail(p, 'invalid image base64'); }
  if (bytes!.length > 2_097_152 || btoa(bytes!) !== match![2]) fail(p, 'invalid or oversized canonical image base64');
  const starts = (...signature: number[]) => signature.every((n, i) => bytes!.charCodeAt(i) === n);
  const valid = match![1] === 'png' ? bytes!.length >= 24 && starts(137,80,78,71,13,10,26,10) && bytes!.slice(12,16) === 'IHDR'
    : match![1] === 'jpeg' ? bytes!.length >= 4 && starts(255,216,255) && bytes!.endsWith('\xff\xd9')
    : bytes!.length >= 20 && bytes!.slice(0,4) === 'RIFF' && bytes!.slice(8,12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes!.slice(12,16));
  if (!valid) fail(p, 'raster image magic bytes do not match its MIME type');
};

// Deliberately excludes URL functions, custom properties, escapes and arbitrary CSS.
const cssColor = /^(?:#[\da-f]{3,8}|transparent|white|black)$/i;
const length = /^(?:0|(?:\d{1,3}|1\d{3}|2[0-3]\d{2}|2400)(?:\.\d{1,3})?px)$/;
const cssValues: Record<string, (v: string) => boolean> = {};
for (const k of ['color','background','background-color','border-color']) cssValues[k] = v => cssColor.test(v) && (!v.startsWith('#') || [4,5,7,9].includes(v.length));
for (const k of ['width','height','min-width','min-height','max-width','max-height','padding','padding-top','padding-bottom','padding-left','padding-right','margin','margin-top','margin-bottom','margin-left','margin-right','margin-inline','border-radius','font-size','gap']) cssValues[k] = v => v === 'auto' || v === '100%' || length.test(v);
Object.assign(cssValues, {
  display: (v: string) => /^(block|inline|inline-block|flex|grid|none)$/.test(v),
  position: (v: string) => /^(static|relative)$/.test(v),
  'box-sizing': (v: string) => v === 'border-box',
  'font-family': (v: string) => /^(Arial|Georgia|Verdana|system-ui)$/.test(v),
  'font-weight': (v: string) => /^(400|500|600|700|normal|bold)$/.test(v),
  'font-style': (v: string) => /^(normal|italic)$/.test(v),
  'text-align': (v: string) => /^(left|center|right)$/.test(v),
  'white-space': (v: string) => /^(normal|pre-wrap)$/.test(v),
  'overflow-wrap': (v: string) => /^(normal|anywhere|break-word)$/.test(v),
  'object-fit': (v: string) => /^(cover|contain)$/.test(v),
  'object-position': (v: string) => /^(center|top|bottom|left|right)$/.test(v),
  opacity: (v: string) => /^(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(v),
  border: (v: string) => /^(0|none|1px solid (#[\da-f]{6}|transparent))$/i.test(v),
  'box-shadow': (v: string) => v === 'none',
});
const style: Check = nullable((v, p) => {
  if (typeof v !== 'string' || v.length > 8000 || /[\\{}@!\/*()]/.test(v) || controls.test(v)) fail(p, 'unsupported shared CSS; only conservative declarative styles are allowed');
  const seen = new Set<string>();
  for (const declaration of (v as string).split(';')) {
    if (!declaration.trim()) continue;
    const m = /^\s*([a-z-]+)\s*:\s*([^:]+?)\s*$/.exec(declaration);
    if (!m || !Object.hasOwn(cssValues, m[1]) || !cssValues[m[1]](m[2]) || seen.has(m[1])) fail(p, 'unsupported shared CSS property/value or duplicate declaration');
    seen.add(m![1]);
  }
});
const contextFields: Fields = {text:text(10000), href:(v,p)=>safeURL(v,p), font:choice('Arial','Georgia','Verdana','system-ui'), fontSize:number(10,160), bold:bool, italic:bool, color, background:color, spacing:number(0,200), boxWidth:number(40,2400), boxHeight:number(24,2400), offsetX:number(-2400,2400), offsetY:number(-2400,2400), movementLocked:bool};
const paired = (check: Check, pairs: string[][]): Check => (v,p) => {
  check(v,p); const o = v as Record<string,unknown>;
  for (const [a,b] of pairs) if (Object.hasOwn(o,a) !== Object.hasOwn(o,b)) fail(child(p,Object.hasOwn(o,a)?b:a), 'paired coordinate is required');
};
const context = paired(fields(contextFields), [['offsetX','offsetY']]);
const node = paired(fields({text:text(10000),src:image,alt:text(500),moveX:number(-100,100),moveY:number(-100,100),flipX:bool,opacity:number(10,100),frame:choice('original','rounded','oval'),width:number(10,100),height:number(40,1200),fit:choice('cover','contain'),position:choice('center','top','bottom','left','right'),cropX:number(0,100),cropY:number(0,100)}), [['moveX','moveY'],['cropX','cropY']]);
const section = fields({deleted:bool,color,backgroundImage:image,width:number(40,100),height:nullable(number(0,6000)),spacing:nullable(number(0,200)),surface:choice('original','ivory','navy'),sizePreset:choice('auto','compact','comfortable','spacious','screen')});
const added = fields({id:identifier,index:number(0,9999,true),before:nullable(number(0,9999,true)),template:choice('text','blank'),heading:text(4000),body:text(4000)}, ['id','index','before','template','heading','body']);
const shape: Check = (v,p) => {
  fields({id:identifier,section:number(0,9999,true),kind:choice('rectangle','rounded','ellipse','triangle','diamond','line','image','text','bubble'),x:number(0,100),y:number(0,100),w:number(2,100),h:number(1,100),color,opacity:number(10,100),rotation:number(-180,180),text:text(300),src:image,fit:choice('cover','contain'),font:choice('sans','serif','modern','classic','mono'),fontSize:number(10,120),textColor:color,bold:bool,italic:bool,align:choice('left','center','right')}, ['id','section','kind','x','y','w','h','color','opacity','rotation','text'])(v,p);
  const o = v as Record<string,unknown>;
  if ((o.x as number)+(o.w as number)>100.01) fail(child(p,'w'),'shape exceeds section width');
  if ((o.y as number)+(o.h as number)>100.01) fail(child(p,'h'),'shape exceeds section height');
  if (o.kind === 'image' && !Object.hasOwn(o,'src')) fail(child(p,'src'),'image shape requires a raster source');
};
const unique = (check: Check, max: number): Check => (v,p) => {
  array(check,max)(v,p); const ids = new Set<unknown>();
  (v as Record<string,unknown>[]).forEach((o,i)=>{if(ids.has(o.id))fail(child(`${p}[${i}]`,'id'),'duplicate identifier');ids.add(o.id);});
};
const pageFields: Fields = {
  $sections:record(index,section), $buttons:record(index,fields({size:choice('small','medium','large'),style:choice('solid','outline','soft','pill','square')})),
  $content:record(contextKey(false),context), $addedSections:unique(added,50), $shapes:unique(shape,100),
  $copies:(v,p)=>{if(!Array.isArray(v))fail(p,'expected array');if((v as unknown[]).length)fail(p,'unsupported copied sections: publication cannot safely preserve copied-section HTML');},
  $groups:array(array(selectionKey,200,2),100), $locks:array(selectionKey,500),
};
const page: Check = (v,p) => {for(const [k,x] of Object.entries(object(v,p))){const q=child(p,k);if(Object.hasOwn(pageFields,k))pageFields[k](x,q);else{index(k,q);node(x,q);}}};

/** Validate untrusted saved JSON only. Success does not authorize or render a publication. */
export function publicationDraftIssue(draft: unknown, snapshotId: unknown): string | null {
  try {
    if(snapshotId !== manifest.id) fail('snapshotId','unsupported source snapshot');
    // Bound traversal before schema checks/decoding, and reject non-JSON values/accessors.
    let count=0; const ancestors=new Set<object>();
    const visit=(v:unknown,p:string,depth:number):void=>{
      if(++count>50000||depth>18)fail(p,'draft exceeds structural limits');
      if(v===null||typeof v==='boolean')return;
      if(typeof v==='string'){if(v.length>3_000_000)fail(p,'string exceeds size limit');return;}
      if(typeof v==='number'){if(!Number.isFinite(v))fail(p,'expected finite number');return;}
      if(typeof v!=='object')fail(p,'expected JSON value');
      const o=v as object;
      if(ancestors.has(o))fail(p,'cyclic draft is unsupported');
      if(!Array.isArray(o))object(o,p);else if(o.length>1000)fail(p,'array exceeds size limit');
      ancestors.add(o);
      for(const k of Reflect.ownKeys(o)){
        if(Array.isArray(o)&&k==='length')continue;
        if(typeof k!=='string')fail(p,'symbol keys are unsupported');
        const q=child(p,k as string),d=Object.getOwnPropertyDescriptor(o,k)!;
        if(Array.isArray(o)&&! /^(0|[1-9]\d*)$/.test(k as string))fail(q,'non-index array properties are unsupported');
        if(!d.enumerable||!('value' in d))fail(q,'accessors/non-JSON properties are unsupported');
        if(['__proto__','prototype','constructor'].includes(k as string)||String(k).length>180)fail(q,'unsafe field name');
        visit(d.value,q,depth+1);
      }
      if(Array.isArray(o))for(let i=0;i<o.length;i++)if(!Object.hasOwn(o,i))fail(`${p}[${i}]`,'sparse arrays are unsupported');
      ancestors.delete(o);
    };
    visit(draft,'draft',0);
    if(new TextEncoder().encode(JSON.stringify(draft)).length>4_000_000)fail('draft','draft exceeds 4,000,000-byte limit');
    for(const [k,v] of Object.entries(object(draft,'draft'))){
      const p=child('draft',k);
      if(k==='$shared')record(contextKey(true),fields({style,href:nullable((x,q)=>safeURL(x,q)),src:nullable(image),srcset:(x,q)=>{if(x!==null)fail(q,'non-null shared srcset is unsupported');},alt:nullable(text(500)),text:text(10000)}))(v,p);
      else if(k==='$sharedContent')record(contextKey(true),context)(v,p);
      else if(/^(?:[0-9]|10)$/.test(k))page(v,p);
      else fail(p,'unknown field; supported pages are 0–10');
    }
    return null;
  } catch(error) {
    if(error instanceof DraftIssue)return error.message;
    return 'draft: invalid or unreadable JSON value';
  }
}
