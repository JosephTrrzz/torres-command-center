// Local bridge only: original public scripts and all production writes are disabled.
const nodes=[...document.querySelectorAll('h1,h2,h3,h4,p,li,main img')].filter(n=>n.tagName==='IMG'||(!n.querySelector('img,input,button,select,textarea,p,h1,h2,h3,h4,li')&&n.textContent.trim()));
const siteHeader=document.querySelector('header');
const sections=[...document.querySelectorAll('main section')];
if(siteHeader)sections.push(siteHeader);
const original=new Map([...nodes,...sections].map(n=>[n,n.getAttribute('style')]));
let editing=true,selected=null;
const documentEpoch=Number(new URLSearchParams(location.search).get("studioEpoch"));
const send=data=>parent.postMessage({...data,epoch:documentEpoch,page:location.pathname.split('/').pop().replace(/\.html$/, '')+'.html'},'*');
const style=document.createElement('style');style.textContent='[data-editable]:hover{outline:2px solid #a57d3d;outline-offset:4px;cursor:text}[contenteditable=true]:focus,[data-local-selected]{outline:2px solid #a57d3d!important;outline-offset:-2px}img[data-editable]:hover{cursor:pointer}html{scroll-behavior:auto!important}*{animation:none!important;transition:none!important}.reveal,[data-reveal]{opacity:1!important;transform:none!important}';document.head.append(style);
const photoOffsets=new Map();
function positionPhoto(n){const o=photoOffsets.get(n),s=n.closest('main section');if(!o||!s)return;n.style.translate=(o.x*s.clientWidth/100)+'px '+(o.y*s.clientHeight/100)+'px';n.style.position=getComputedStyle(n).position==='static'?'relative':n.style.position;n.style.zIndex='21';for(let p=n.parentElement;p&&p!==s;p=p.parentElement)p.style.overflow='visible'}
const bounded=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
function apply(n,v,isSection=false){
 const old=original.get(n);if(old===null)n.removeAttribute('style');else n.setAttribute('style',old);
 if(isSection){
  n.hidden=v.deleted===true;
  if(typeof v.color==='string'&&/^#[0-9a-f]{6}$/i.test(v.color))n.style.background=v.color;
  if(typeof v.backgroundImage==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.backgroundImage)&&v.backgroundImage.length<3000000){n.style.backgroundImage='url('+v.backgroundImage+')';n.style.backgroundSize='cover';n.style.backgroundPosition='center'}
  if(bounded(v.height,0,6000)){n.style.minHeight=v.height+'px';n.style.boxSizing='border-box'}
  if(v.sizePreset==='screen')n.style.minHeight='100svh';
  if(v.sizePreset==='auto'){n.style.minHeight='';}
  if(bounded(v.spacing,0,200)){n.style.paddingTop=v.spacing+'px';n.style.paddingBottom=v.spacing+'px'}
  if(bounded(v.width,40,100)){n.style.width=v.width+'%';n.style.marginInline='auto'}
  if(['ivory','navy'].includes(v.surface)){n.style.background=v.surface==='navy'?'#132238':'#f7f5f0';n.style.color=v.surface==='navy'?'white':'#132238'}
 }else if(n.tagName==='IMG'){
  if(typeof v.src==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(v.src)){n.removeAttribute('srcset');n.src=v.src}
  if(typeof v.alt==='string')n.alt=v.alt;
  if(bounded(v.moveX,-100,100)&&bounded(v.moveY,-100,100)){photoOffsets.set(n,{x:v.moveX,y:v.moveY});positionPhoto(n)}else{photoOffsets.delete(n);n.style.translate=''}
  if(v.flipX)n.style.scale='-1 1';
  if(bounded(v.opacity,10,100))n.style.opacity=v.opacity/100;
  if(['rounded','oval'].includes(v.frame))n.style.borderRadius=v.frame==='oval'?'50%':'24px';
  if(bounded(v.width,10,100)){n.style.width=v.width+'%';n.style.maxWidth='100%'}
  if(bounded(v.height,40,1200)){n.style.height=v.height+'px';n.style.maxHeight='none'}
  if(['cover','contain'].includes(v.fit))n.style.objectFit=v.fit;
  if(['center','top','bottom','left','right'].includes(v.position))n.style.objectPosition=v.position;
  if(bounded(v.cropX,0,100)&&bounded(v.cropY,0,100))n.style.objectPosition=v.cropX+'% '+v.cropY+'%';
 }else if(typeof v.text==='string')n.textContent=v.text;
}
function select(kind,id,scroll=false){
 const n=kind==='image'?nodes[id]:sections[id];if(!n)return;
 if(crop)endCrop(false);if(drag)finishDrag(false);if(selected)selected.removeAttribute('data-local-selected');selected=n;if(editing)n.dataset.localSelected='';
 if(scroll)n.scrollIntoView({block:'center'});requestAnimationFrame(positionHandles);dispatchEvent(new Event('resize'));
 send({type:'selected',kind,id,label:kind==='image'?(n.alt||'Photo'):(n===siteHeader?'Header':n.querySelector('h1,h2,h3')?.textContent.trim()||n.id||'Section '+(id+1)),alt:n.alt||''});
}
function bindEditable(n,id){n.dataset.localId=String(id);n.dataset.editable='';if(n.tagName!=='IMG'){n.contentEditable='false';n.tabIndex=0;n.addEventListener('input',()=>send({type:'change',id,text:n.innerText}));}else{n.tabIndex=0;n.setAttribute('aria-label','Edit photo: '+(n.alt||'Website image'));n.addEventListener('keydown',e=>{if(editing&&['Enter',' '].includes(e.key)){e.preventDefault();select('image',id)}})}}
nodes.forEach(bindEditable);
document.addEventListener('submit',e=>e.preventDefault(),true);
document.addEventListener('click',e=>{
 if(e.target.closest('#local-image-tools,.local-shape,#shape-toolbar'))return;
 const img=e.target.closest('img[data-editable]');if(editing&&img){e.preventDefault();e.stopPropagation();select('image',Number(img.dataset.localId));return}
 if(editing&&e.target.closest('[data-studio-button]')){e.preventDefault();e.stopPropagation();send({type:'button-selected',id:Number(e.target.closest('[data-studio-button]').dataset.studioButton)});return}
 const a=e.target.closest('a');if(a){e.preventDefault();send({type:'navigate',url:a.href});return}
 if(editing&&!e.target.closest('[contenteditable]:not([contenteditable=false])')){const s=e.target.closest('main section');if(s)select('section',sections.indexOf(s))}
},true);
window.addEventListener('message',e=>{
 if(e.source!==parent)return;const d=e.data;
 if(d.type==='restore'){
  for(const [id,v]of Object.entries(d.edits||{})){if(nodes[Number(id)]&&v&&typeof v==='object')apply(nodes[Number(id)],v)}
  for(const [id,v]of Object.entries(d.sections||{})){if(sections[Number(id)]&&v&&typeof v==='object')apply(sections[Number(id)],v,true)}
 }
 if(d.type==='select'&&Number.isInteger(d.id))select(d.kind,d.id,true);
 if(d.type==='clear'){if(crop)endCrop(false);selected?.removeAttribute('data-local-selected');selected=null}
 if(d.type==='mode'){editing=d.editing;nodes.forEach(n=>{if(n.tagName!=='IMG')n.contentEditable='false';if(editing)n.dataset.editable='';else delete n.dataset.editable;});if(!editing)selected?.removeAttribute('data-local-selected')}
 dispatchEvent(new Event('resize'));requestAnimationFrame(positionHandles);
});
send({type:'ready',sections:sections.map((s,id)=>({id,label:(s===siteHeader?'Header':s.querySelector('h1,h2,h3')?.textContent.trim()||s.id||'Section '+(id+1)).replace(/\s+/g,' ').slice(0,75),images:[...s.querySelectorAll('img')].filter(n=>nodes.includes(n)).map(n=>({id:nodes.indexOf(n),label:n.alt||'Photo'}))}))});

// Handles live outside the site's layout so its markup and image positioning stay intact.
const imageTools=document.createElement('div');imageTools.id='local-image-tools';imageTools.hidden=true;
imageTools.innerHTML='<div class="local-image-bar"><button type="button" data-action="replace">Replace</button><button type="button" data-action="crop">Crop</button><button type="button" data-action="fit">Fit</button><button type="button" data-action="flip">Flip</button><button type="button" data-action="reset">Reset</button><button type="button" data-action="settings">Details</button><span class="local-image-size" aria-live="polite"></span></div>';
document.body.append(imageTools);
const handleStyle=document.createElement('style');handleStyle.textContent=`
#local-image-tools{position:fixed;z-index:2147483647;border:2px solid #4277df;pointer-events:none;box-sizing:border-box;font:12px/1.4 system-ui;color:#132238}
#local-image-tools[hidden]{display:none!important}
#local-image-tools .local-handle{position:absolute;width:44px;height:44px;min-width:0;padding:0;border:0;border-radius:0;background:transparent;transform:translate(-50%,-50%);pointer-events:auto;touch-action:none;box-shadow:none}
#local-image-tools .local-handle::after{content:'';display:block;width:10px;height:10px;border:2px solid #4277df;background:white;margin:auto;box-sizing:border-box}
#local-image-tools .local-handle:focus-visible{outline:2px solid #132238;outline-offset:-8px}
#local-image-tools .local-image-bar{position:absolute;bottom:calc(100% + 12px);left:0;display:flex;align-items:center;gap:4px;padding:4px;background:white;border:1px solid #e5e3df;border-radius:999px;box-shadow:0 4px 18px #13223826;pointer-events:auto;white-space:nowrap}
#local-image-tools .local-image-bar button{font:12px system-ui;min-height:40px;padding:8px 12px;border:0;border-radius:999px;background:white;color:#132238;cursor:pointer}
#local-image-tools .local-image-bar button:hover{background:#edf2fb}
#local-image-tools .local-image-size{padding:0 10px;font-size:11px}
`;document.head.append(handleStyle);
let drag=null,crop=null;
function positionHandles(){
 const visible=editing&&selected?.tagName==='IMG';imageTools.hidden=!visible;if(!visible)return;
 const r=selected.getBoundingClientRect();Object.assign(imageTools.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
 const bar=imageTools.querySelector('.local-image-bar');bar.style.bottom=r.top<64?'auto':'calc(100% + 12px)';bar.style.top=r.top<64?'12px':'auto';
 bar.style.maxWidth=Math.max(200,innerWidth-24)+'px';bar.style.left=Math.max(12-r.left,Math.min(0,innerWidth-r.left-bar.offsetWidth-12))+'px';
 imageTools.querySelector('.local-image-size').textContent=Math.round(r.width)+' × '+Math.round(r.height);
}
function startState(direction){
 const n=selected,r=n.getBoundingClientRect(),parentStyle=getComputedStyle(n.parentElement);
 const available=n.parentElement.clientWidth-parseFloat(parentStyle.paddingLeft)-parseFloat(parentStyle.paddingRight);
 return {n,direction,width:r.width,height:r.height,available:Math.max(40,available),style:n.getAttribute('style'),id:Number(n.dataset.localId)};
}
function resizeImage(state,dx,dy){
 const {n,direction,width,height,available}=state;
 let w=width,h=height;
 if(direction.includes('e'))w+=dx;if(direction.includes('w'))w-=dx;
 if(direction.includes('s'))h+=dy;if(direction.includes('n'))h-=dy;
 if(direction.length===2){const ratio=width/height;w=Math.abs(dx)>=Math.abs(dy)?w:h*ratio;w=Math.max(Math.max(available*.1,40*ratio),Math.min(w,available,1200*ratio));h=w/ratio}
 else{w=Math.max(available*.1,Math.min(w,available));h=Math.max(40,Math.min(h,1200))}
 state.values={width:Math.min(100,Math.max(10,w/available*100)),height:Math.min(1200,Math.max(40,h))};
 Object.assign(n.style,{width:state.values.width+'%',maxWidth:'100%',height:state.values.height+'px',maxHeight:'none'});positionHandles();
}
function finishDrag(commit){
 if(!drag)return;const state=drag;drag=null;
 if(commit&&state.values)send({type:'resize',id:state.id,...state.values});
 else if(state.style===null)state.n.removeAttribute('style');else state.n.setAttribute('style',state.style);
 if(state.handle.hasPointerCapture(state.pointerId))state.handle.releasePointerCapture(state.pointerId);
 positionHandles();
}
for(const [direction,x,y,cursor] of [['nw',0,0,'nwse'],['n',50,0,'ns'],['ne',100,0,'nesw'],['e',100,50,'ew'],['se',100,100,'nwse'],['s',50,100,'ns'],['sw',0,100,'nesw'],['w',0,50,'ew']]){
 const h=document.createElement('button');h.type='button';h.className='local-handle';h.dataset.direction=direction;h.setAttribute('aria-label','Resize image '+({nw:'top left',n:'top',ne:'top right',e:'right',se:'bottom right',s:'bottom',sw:'bottom left',w:'left'}[direction]));h.title='Drag to resize. Arrow keys adjust; Shift adjusts faster.';
 Object.assign(h.style,{left:x+'%',top:y+'%',cursor:cursor+'-resize'});imageTools.append(h);
 h.addEventListener('pointerdown',e=>{if(!editing||!selected||e.button!==0)return;e.preventDefault();drag={...startState(direction),x:e.clientX,y:e.clientY,handle:h,pointerId:e.pointerId};h.setPointerCapture(e.pointerId)});
 h.addEventListener('pointermove',e=>{if(drag?.handle!==h||drag.pointerId!==e.pointerId)return;resizeImage(drag,e.clientX-drag.x,e.clientY-drag.y)});
 h.addEventListener('pointerup',e=>{if(drag?.pointerId===e.pointerId)finishDrag(true)});
 h.addEventListener('pointercancel',()=>finishDrag(false));h.addEventListener('lostpointercapture',()=>finishDrag(false));
 h.addEventListener('keydown',e=>{if(!editing||!e.key.startsWith('Arrow'))return;e.preventDefault();const state=startState(direction),step=e.shiftKey?20:4;resizeImage(state,e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0);send({type:'resize',id:state.id,...state.values})});
}
imageTools.addEventListener('click',e=>{
 const action=e.target.dataset.action;if(!action||!selected)return;
 if(action==='crop'){beginCrop();return}if(action==='crop-done'){endCrop(true);return}if(action==='crop-cancel'){endCrop(false);return}
 if(action==='fit'){send({type:'media-change',id:Number(selected.dataset.localId),fit:getComputedStyle(selected).objectFit==='contain'?'cover':'contain'});return}
 send({type:'image-action',action,id:Number(selected.dataset.localId),alt:selected.alt});
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(crop){endCrop(false);return}if(drag)finishDrag(false);else{selected?.removeAttribute('data-local-selected');selected=null;positionHandles();send({type:'deselected'})}}});
addEventListener('scroll',positionHandles,true);addEventListener('resize',positionHandles);
new ResizeObserver(positionHandles).observe(document.documentElement);
for(const n of nodes.filter(n=>n.tagName==='IMG')){new ResizeObserver(positionHandles).observe(n);n.addEventListener('load',positionHandles)}

const cropSurface=document.createElement('div');cropSurface.className='local-crop-surface';cropSurface.tabIndex=0;cropSurface.setAttribute('role','group');cropSurface.setAttribute('aria-label','Reposition photo. Drag or use arrow keys. Enter applies; Escape cancels.');cropSurface.hidden=true;imageTools.append(cropSurface);
const cropBar=document.createElement('div');cropBar.className='local-crop-bar';cropBar.hidden=true;cropBar.innerHTML='<span>Drag photo to reposition</span><button type="button" data-action="crop-cancel">Cancel</button><button type="button" data-action="crop-done">Done</button>';imageTools.append(cropBar);
const cropCSS=document.createElement('style');cropCSS.textContent=`
#local-image-tools{--editor-accent:#7654d8;border-color:var(--editor-accent)}
#local-image-tools .local-handle::after{border-color:var(--editor-accent);border-radius:50%;width:12px;height:12px}
#local-image-tools .local-image-bar{flex-wrap:wrap;white-space:normal;border-radius:14px}
#local-image-tools .local-image-bar button{min-height:44px}
#local-image-tools .local-crop-surface{position:absolute;inset:0;pointer-events:auto;touch-action:none;cursor:move;outline:0;background:linear-gradient(to right,transparent 33%,#ffffff88 33%,#ffffff88 33.3%,transparent 33.3%,transparent 66%,#ffffff88 66%,#ffffff88 66.3%,transparent 66.3%),linear-gradient(to bottom,transparent 33%,#ffffff88 33%,#ffffff88 33.3%,transparent 33.3%,transparent 66%,#ffffff88 66%,#ffffff88 66.3%,transparent 66.3%)}
#local-image-tools .local-crop-surface:focus-visible{outline:3px solid var(--editor-accent);outline-offset:-4px}
#local-image-tools .local-crop-bar{position:absolute;left:0;top:12px;display:flex;gap:8px;align-items:center;max-width:100%;flex-wrap:wrap;padding:6px 10px;background:white;border-radius:12px;pointer-events:auto;box-shadow:0 4px 18px #13223826}
#local-image-tools .local-crop-bar button{font:12px system-ui;padding:8px 12px;border:1px solid #e5e3df;border-radius:999px;min-height:44px;background:white;color:#132238}
#local-image-tools .local-crop-bar button[data-action=crop-done]{background:#132238;color:white}
#local-image-tools [hidden]{display:none!important}
#local-image-tools[data-cropping] .local-handle,#local-image-tools[data-cropping] .local-image-bar{display:none!important}
`;document.head.append(cropCSS);
function beginCrop(){
 if(crop||!selected||selected.tagName!=='IMG')return;
 const n=selected,parts=getComputedStyle(n).objectPosition.split(' ');
 crop={n,id:Number(n.dataset.localId),style:n.getAttribute('style'),x:Number.isFinite(parseFloat(parts[0]))?parseFloat(parts[0]):50,y:Number.isFinite(parseFloat(parts[1]))?parseFloat(parts[1]):50};
 n.style.objectFit='cover';cropSurface.hidden=false;cropBar.hidden=false;imageTools.dataset.cropping='';cropSurface.focus();
}
function endCrop(commit){
 if(!crop)return;const c=crop;crop=null;cropSurface.hidden=true;cropBar.hidden=true;delete imageTools.dataset.cropping;
 if(commit)send({type:'media-change',id:c.id,fit:'cover',cropX:c.x,cropY:c.y});
 else if(c.style===null)c.n.removeAttribute('style');else c.n.setAttribute('style',c.style);
 positionHandles();
}
function moveCrop(x,y){if(!crop)return;crop.x=Math.max(0,Math.min(100,x));crop.y=Math.max(0,Math.min(100,y));crop.n.style.objectPosition=crop.x+'% '+crop.y+'%'}
cropSurface.addEventListener('pointerdown',e=>{if(!crop||e.button!==0)return;e.preventDefault();crop.pointer={id:e.pointerId,x:e.clientX,y:e.clientY,cx:crop.x,cy:crop.y};cropSurface.setPointerCapture(e.pointerId)});
cropSurface.addEventListener('pointermove',e=>{
 if(!crop?.pointer||crop.pointer.id!==e.pointerId)return;
 const r=crop.n.getBoundingClientRect(),scale=Math.max(r.width/crop.n.naturalWidth,r.height/crop.n.naturalHeight),extraX=crop.n.naturalWidth*scale-r.width,extraY=crop.n.naturalHeight*scale-r.height;
 moveCrop(extraX>1?crop.pointer.cx-(e.clientX-crop.pointer.x)/extraX*100:crop.x,extraY>1?crop.pointer.cy-(e.clientY-crop.pointer.y)/extraY*100:crop.y);
});
cropSurface.addEventListener('pointerup',()=>{if(crop)crop.pointer=null});cropSurface.addEventListener('pointercancel',()=>endCrop(false));
cropSurface.addEventListener('keydown',e=>{if(!crop)return;if(e.key==='Enter'){e.preventDefault();endCrop(true);return}if(!e.key.startsWith('Arrow'))return;e.preventDefault();const step=e.shiftKey?10:2;moveCrop(crop.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),crop.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0))});
for(const n of nodes.filter(n=>n.tagName==='IMG'))n.addEventListener('dblclick',e=>{if(!editing)return;e.preventDefault();beginCrop()});

const shapesScript=document.createElement("script");shapesScript.src="/website-preview/shapes.js?v=section-divisions-1";document.body.append(shapesScript);

let photoMove=null;
for(const n of nodes.filter(n=>n.tagName==='IMG')){
 n.draggable=false;
 n.addEventListener('pointerdown',e=>{if(!editing||crop||e.button!==0)return;const section=n.closest('main section');if(!section)return;e.preventDefault();const r=n.getBoundingClientRect(),sr=section.getBoundingClientRect(),offset=photoOffsets.get(n)||{x:0,y:0};photoMove={n,id:Number(n.dataset.localId),pointer:e.pointerId,x:e.clientX,y:e.clientY,r,sr,offset,style:n.getAttribute('style')};StudioAlignment.begin(n,section);n.setPointerCapture(e.pointerId)});
 n.addEventListener('pointermove',e=>{const m=photoMove;if(!m||m.n!==n||m.pointer!==e.pointerId)return;let dx=e.clientX-m.x,dy=e.clientY-m.y;if(!m.moved&&Math.hypot(dx,dy)<5)return;m.moved=true;
 dx=Math.max(m.sr.left-m.r.left,Math.min(dx,m.sr.right-m.r.right));dy=Math.max(m.sr.top-m.r.top,Math.min(dy,m.sr.bottom-m.r.bottom));const aligned=StudioAlignment.move({left:m.r.left+dx,top:m.r.top+dy,width:m.r.width,height:m.r.height},e.altKey);dx+=aligned.dx;dy+=aligned.dy;photoOffsets.set(n,{x:m.offset.x+dx/m.sr.width*100,y:m.offset.y+dy/m.sr.height*100});positionPhoto(n);positionHandles()});
 n.addEventListener('pointerup',()=>finishPhotoMove(true));n.addEventListener('pointercancel',()=>finishPhotoMove(false));
 n.addEventListener('keydown',e=>{if(!editing||crop||!e.altKey||!e.key.startsWith('Arrow'))return;e.preventDefault();const section=n.closest('main section');if(!section)return;const r=n.getBoundingClientRect(),sr=section.getBoundingClientRect(),o=photoOffsets.get(n)||{x:0,y:0},step=e.shiftKey?20:4;const dx=Math.max(sr.left-r.left,Math.min(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,sr.right-r.right)),dy=Math.max(sr.top-r.top,Math.min(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0,sr.bottom-r.bottom));photoOffsets.set(n,{x:o.x+dx/sr.width*100,y:o.y+dy/sr.height*100});positionPhoto(n);send({type:'photo-move',id:Number(n.dataset.localId),...photoOffsets.get(n)});positionHandles()});
}
function finishPhotoMove(commit){const m=photoMove;if(!m)return;photoMove=null;StudioAlignment.clear();if(commit&&m.moved)send({type:'photo-move',id:m.id,...photoOffsets.get(m.n)});else if(!commit){photoOffsets.set(m.n,m.offset);if(m.style===null)m.n.removeAttribute('style');else m.n.setAttribute('style',m.style)}if(m.n.hasPointerCapture(m.pointer))m.n.releasePointerCapture(m.pointer);positionHandles()}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&photoMove)finishPhotoMove(false)});
addEventListener('resize',()=>{for(const n of photoOffsets.keys())positionPhoto(n);positionHandles()});
const moveCSS=document.createElement('style');moveCSS.textContent='img[data-editable]{touch-action:none;cursor:move!important}';document.head.append(moveCSS);
send({type:'site-media',images:nodes.filter(n=>n.tagName==='IMG'&&n.getAttribute('src')?.startsWith('/website-preview/assets/')).map(n=>({src:n.getAttribute('src'),name:n.alt||'Website photo'}))});

const toolbarPolish=document.createElement('style');toolbarPolish.textContent=`
#local-image-tools .local-image-bar{position:fixed!important;left:50%!important;top:16px!important;bottom:auto!important;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 32px);padding:6px;gap:4px;flex-wrap:wrap;justify-content:center;border:1px solid #dcddea;border-radius:22px;box-shadow:0 4px 12px #2822501f;background:white}
#local-image-tools .local-image-bar button{font:500 14px system-ui;min-height:44px;padding:8px 14px;border-radius:12px}
#local-image-tools .local-image-bar button:hover{background:#eee7ff;color:#583496}
#local-image-tools .local-image-bar button:focus-visible{outline:2px solid #7654d8;outline-offset:2px}
#local-image-tools .local-image-size{border-left:1px solid #e4e2e8;color:#6d6a75}
`;document.head.append(toolbarPolish);

if(siteHeader){
 const editHeader=document.createElement('button');editHeader.type='button';editHeader.textContent='Edit header';editHeader.id='local-edit-header';editHeader.setAttribute('aria-label','Edit header');document.body.append(editHeader);
 const headerStyle=document.createElement('style');headerStyle.textContent='#local-edit-header{position:fixed;z-index:2147483646;min-height:44px;padding:10px 18px;background:white;color:#132238;border:1px solid #dcddea;border-radius:999px;box-shadow:0 4px 14px #13223822;font:600 13px system-ui;cursor:pointer}#local-edit-header[hidden]{display:none}#local-edit-header:focus-visible{outline:3px solid #7654d8;outline-offset:3px}';document.head.append(headerStyle);
 let headerEngaged=false;
 const placeHeader=()=>{const r=siteHeader.getBoundingClientRect();editHeader.hidden=!editing||!headerEngaged||selected===siteHeader||r.bottom<=0||r.top>=innerHeight;editHeader.style.right='16px';editHeader.style.top=Math.min(innerHeight-52,Math.max(8,r.bottom+8))+'px'};
 siteHeader.addEventListener('pointerenter',()=>{headerEngaged=true;placeHeader()});siteHeader.addEventListener('focusin',()=>{headerEngaged=true;placeHeader()});document.addEventListener('pointerdown',e=>{if(!siteHeader.contains(e.target)&&!editHeader.contains(e.target)){headerEngaged=false;placeHeader()}},true);
 editHeader.onclick=e=>{e.stopPropagation();select('section',sections.indexOf(siteHeader))};addEventListener('scroll',placeHeader,{passive:true});addEventListener('resize',placeHeader);addEventListener('message',e=>{if(e.source===parent&&['mode','clear'].includes(e.data?.type)){headerEngaged=false;placeHeader()}});placeHeader();
}

const warmToolbar=document.createElement('style');warmToolbar.textContent=`
#local-image-tools .local-image-bar,#local-image-tools .local-crop-bar{background:#f5efe4;border-color:#d9c9ac;color:#493b28;box-shadow:0 4px 14px #493b2824}
#local-image-tools .local-image-bar button,#local-image-tools .local-crop-bar button{background:transparent;color:#493b28}
#local-image-tools .local-image-bar button:hover,#local-image-tools .local-crop-bar button:hover{background:#e9dcc3;color:#805c26}
#local-image-tools .local-image-bar button:focus-visible{outline-color:#805c26}
#local-image-tools .local-image-size{border-color:#d9c9ac;color:#6b5d49}
`;document.head.append(warmToolbar);

// Section insertion is isolated to this local canvas and its browser draft.
(()=>{
 let added=[],records=new Map(),pending=null,raf=0;
 const css=document.createElement('style');css.textContent=`
#section-divisions{position:fixed;inset:0;pointer-events:none;z-index:1000}#section-divisions[hidden]{display:none}
.local-section-boundary{position:absolute;pointer-events:none;border:1px solid #b8985d88;box-sizing:border-box}
.local-add-section{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;border:1px solid #b8985d;background:#f5efe4;color:#493b28;border-radius:999px;padding:10px 20px;min-height:44px;font:600 13px system-ui;white-space:nowrap;box-shadow:0 3px 12px #493b2826;cursor:pointer}
.local-add-section:hover{background:#e9dcc3}.local-add-section:focus-visible{outline:3px solid #805c26;outline-offset:3px}
#section-picker{margin:auto;inset:0;box-sizing:border-box;background:#f5efe4;color:#493b28;border:1px solid #d9c9ac;border-radius:22px;padding:24px;width:420px;max-width:calc(100vw - 32px);font:14px/1.5 system-ui}#section-picker::backdrop{background:#13223855}#section-picker h2{font:600 24px system-ui;margin:0 0 8px}#section-picker button{min-height:44px;border:1px solid #d9c9ac;border-radius:16px;background:#fffcf6;color:#493b28;padding:12px 18px;font:600 14px system-ui;cursor:pointer}#section-picker .section-choices{display:grid;gap:12px;margin:20px 0}#section-picker button:focus-visible{outline:3px solid #805c26}
section[data-local-added]{min-height:320px;padding:64px 8%;background:#f7f5f0;color:#132238;position:relative;box-sizing:border-box}section[data-local-added] h2{font:40px/1.2 Georgia,serif;margin:0 0 20px}section[data-local-added] p{font:18px/1.6 system-ui;margin:0;max-width:65ch}
`;document.head.append(css);
 const layer=document.createElement('div');layer.id='section-divisions';layer.setAttribute('aria-label','Section insertion controls');document.body.append(layer);
 const picker=document.createElement('dialog');picker.id='section-picker';picker.setAttribute('aria-labelledby','section-picker-title');picker.innerHTML='<h2 id="section-picker-title">Add a section</h2><p>Choose a starting point. Edit its content directly on the page.</p><div class="section-choices"><button data-template="text">Heading and text</button><button data-template="blank">Blank section</button></div><button data-cancel>Cancel</button>';document.body.append(picker);
 const visibleSections=()=>[...document.querySelectorAll('main section')].filter(s=>!s.hidden&&!s.parentElement.closest('section'));
 function persist(){send({type:'added-sections-change',sections:added})}
 function build(v){const s=document.createElement('section');s.dataset.localAdded=v.id;s.setAttribute('aria-label','Added section');if(v.template==='text'){for(const [tag,key]of [['h2','heading'],['p','body']]){const n=document.createElement(tag);n.textContent=v[key];n.contentEditable='false';n.tabIndex=0;n.setAttribute('aria-label',key==='heading'?'New section heading':'New section text');n.addEventListener('input',()=>{v[key]=n.innerText.slice(0,4000);persist();schedule()});s.append(n)}}
 const before=v.before===null?null:sections[v.before];const list=visibleSections();if(before?.parentElement)before.before(s);else if(list.length)list[list.length-1].after(s);else document.querySelector('main')?.append(s);sections.push(s);original.set(s,null);records.set(v.id,s);observer.observe(s);dispatchEvent(new Event('resize'));return s}
 function valid(v){return v&&typeof v.id==='string'&&v.id.length<80&&['text','blank'].includes(v.template)&&(v.before===null||Number.isInteger(v.before)&&v.before>=0&&v.before<sections.length)&&typeof v.heading==='string'&&v.heading.length<=4000&&typeof v.body==='string'&&v.body.length<=4000}
 const observer=new ResizeObserver(()=>schedule());for(const s of visibleSections())observer.observe(s);
 function draw(){raf=0;layer.hidden=!editing;if(!editing)return;layer.replaceChildren();const list=visibleSections();for(const s of list){const r=s.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)continue;const outline=document.createElement('div');outline.className='local-section-boundary';Object.assign(outline.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});layer.append(outline)}
 const points=list.map(s=>({s,y:s.getBoundingClientRect().top,before:sections.indexOf(s)}));if(list.length)points.push({s:list[list.length-1],y:list[list.length-1].getBoundingClientRect().bottom,before:null});for(const {s,y,before}of points){if(y<0||y>innerHeight)continue;const r=s.getBoundingClientRect(),b=document.createElement('button');b.type='button';b.className='local-add-section';b.textContent='+ Add section';b.setAttribute('aria-label',before===null?'Add section at end':'Add section before '+(s.querySelector('h1,h2,h3')?.textContent.trim()||'section'));Object.assign(b.style,{left:Math.max(85,Math.min(innerWidth-85,r.left+r.width/2))+'px',top:Math.max(24,Math.min(innerHeight-24,y))+'px'});b.onclick=()=>{pending={before};picker.showModal()};layer.append(b)}}
 function schedule(){if(!raf)raf=requestAnimationFrame(draw)}
 picker.querySelector('[data-cancel]').onclick=()=>picker.close();picker.addEventListener('click',e=>{const template=e.target.dataset.template;if(!template||!pending)return;if(added.length>=50){picker.querySelector('p').textContent='This local page supports up to 50 added sections.';return;}const v={id:crypto.randomUUID(),index:sections.length,before:pending.before,template,heading:'New section',body:'Write your message here.'};added.push(v);const s=build(v);picker.close();persist();s.scrollIntoView({block:'center'});schedule()});
 window.addEventListener('message',e=>{if(e.source!==parent)return;const d=e.data;if(d.type==='restore-added-sections'&&Array.isArray(d.sections)){for(const v of d.sections.slice(0,50)){if(valid(v)&&!records.has(v.id)){added.push({...v});build(added[added.length-1])}}schedule()}if(d.type==='mode'){for(const s of records.values())for(const n of s.querySelectorAll('[contenteditable]'))n.contentEditable='false';if(!d.editing&&picker.open)picker.close();schedule()}});
 addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);schedule();
})();

// Duplicates are snapshots of local content, sanitized before they join the canvas.
(()=>{
 const copies=new Map();
 const allowed=new Set('SECTION DIV ARTICLE H1 H2 H3 H4 H5 H6 P SPAN STRONG EM B I U S UL OL LI IMG PICTURE SOURCE A BR HR BLOCKQUOTE FIGURE FIGCAPTION SMALL'.split(' '));
 function sanitize(html){const doc=new DOMParser().parseFromString(html,'text/html');const root=doc.body.firstElementChild;if(!root||root.tagName!=='SECTION')return null;for(const n of [root,...root.querySelectorAll('*')]){if(!allowed.has(n.tagName)){n.remove();continue}for(const a of [...n.attributes]){if(!['class','style','src','alt','width','height','href','srcset'].includes(a.name))n.removeAttribute(a.name);if(['src','href'].includes(a.name)&&!/^(https:\/\/|\/website-preview\/assets\/|assets\/|\/(?!\/)|#|mailto:|tel:|data:image\/(png|jpeg|webp);base64,)/.test(a.value))n.removeAttribute(a.name);if(a.name==='srcset')n.removeAttribute(a.name);if(a.name==='style'&&/url\s*\(|expression|@import/i.test(a.value))n.removeAttribute('style')}}return root}
 function mount(v){if(copies.has(v.id)||!Number.isInteger(v.after)||!sections[v.after]||typeof v.html!=='string'||v.html.length>500000)return;const n=sanitize(v.html);if(!n)return;n.dataset.localCopy=v.id;sections[v.after].after(n);sections.push(n);original.set(n,n.getAttribute('style'));for(const el of n.querySelectorAll('h1,h2,h3,h4,p,li,img')){if(el.tagName!=='IMG'&&el.querySelector('img,p,h1,h2,h3,h4,li'))continue;const id=nodes.length;nodes.push(el);original.set(el,el.getAttribute('style'));bindEditable(el,id)}copies.set(v.id,n);dispatchEvent(new Event('resize'))}
 addEventListener('message',e=>{if(e.source!==parent)return;const d=e.data;if(d.type==='restore-copies'&&Array.isArray(d.copies))for(const v of d.copies.slice(0,30))mount(v);if(d.type==='duplicate-section'&&editing&&Number.isInteger(d.id)&&sections[d.id]&&sections[d.id]!==siteHeader&&copies.size<30){const clone=sections[d.id].cloneNode(true);clone.querySelectorAll('.local-shape').forEach(n=>n.remove());const v={id:crypto.randomUUID(),index:sections.length,after:d.id,html:clone.outerHTML};mount(v);if(copies.has(v.id)){send({type:'section-copy',copy:v});select('section',sections.indexOf(copies.get(v.id)),true)}}});
})();

// Section backgrounds are keyboard-selectable as well as clickable.
function exposeSectionKeys(){for(const s of sections){if(s===siteHeader||s.dataset.sectionKeyboard)continue;s.dataset.sectionKeyboard='true';s.tabIndex=0;s.addEventListener('keydown',e=>{if(e.target===s&&editing&&['Enter',' '].includes(e.key)){e.preventDefault();select('section',sections.indexOf(s))}})}}
exposeSectionKeys();addEventListener('resize',exposeSectionKeys);
// Direct section sizing; only minimum height changes, so content is never cropped.
(()=>{
 const css=document.createElement('style');css.textContent=`
.local-section-resize{position:fixed;z-index:1100;transform:translate(-50%,-50%);min-width:44px;min-height:44px;padding:8px 16px;display:flex;gap:10px;justify-content:center;align-items:center;border:1px solid #b8985d;border-radius:999px;background:#f5efe4;color:#493b28;box-shadow:0 3px 12px #493b2826;font:600 12px system-ui;cursor:ns-resize;touch-action:none;user-select:none}
.local-section-resize{font-size:20px}.local-section-resize:focus-visible{outline:3px solid #805c26;outline-offset:3px}.local-section-resize[hidden]{display:none!important}
`;document.head.append(css);
 const handle=document.createElement('button');handle.type='button';handle.className='local-section-resize';handle.hidden=true;handle.innerHTML='<svg width=20 height=20 viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=1.8 aria-hidden=true><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/></svg>';handle.title='Drag to resize section';handle.setAttribute('aria-label','Resize section height. Drag, or use Up and Down arrows.');document.body.append(handle);
 let gesture=null,queued=0;
 const section=()=>selected?.tagName==='SECTION'&&!selected.hidden?selected:null;
 function place(){queued=0;const s=gesture?.node||section();if(!editing||!s){handle.hidden=true;return}const r=s.getBoundingClientRect();handle.hidden=!gesture&&(r.bottom<22||r.bottom>innerHeight-22);if(handle.hidden)return;handle.style.left=Math.max(28,Math.min(innerWidth-28,r.right-28))+'px';handle.style.top=Math.max(22,Math.min(innerHeight-22,r.bottom))+'px';if(gesture)handle.textContent=Math.round(r.height)+' px';else handle.innerHTML='<svg width=20 height=20 viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=1.8 aria-hidden=true><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/></svg>';}
 function queue(){if(!queued)queued=requestAnimationFrame(place)}
 function setHeight(s,height){s.style.boxSizing='border-box';s.style.minHeight=height+'px';dispatchEvent(new Event('resize'))}
 function finish(commit){if(!gesture)return;const g=gesture;gesture=null;if(!commit){if(g.style===null)g.node.removeAttribute('style');else g.node.setAttribute('style',g.style)}else send({type:'section-resize',id:sections.indexOf(g.node),height:g.height});if(handle.hasPointerCapture(g.pointer))handle.releasePointerCapture(g.pointer);dispatchEvent(new Event('resize'));queue()}
 handle.addEventListener('pointerdown',e=>{const s=section();if(!s||!editing||e.button!==0)return;e.preventDefault();e.stopPropagation();const start=s.getBoundingClientRect().height;gesture={node:s,pointer:e.pointerId,start,y:e.clientY,height:Math.min(6000,Math.max(160,Math.round(start))),style:s.getAttribute('style')};handle.setPointerCapture(e.pointerId)});
 handle.addEventListener('pointermove',e=>{if(!gesture||e.pointerId!==gesture.pointer)return;gesture.height=Math.min(6000,Math.max(160,Math.round(gesture.start+e.clientY-gesture.y)));setHeight(gesture.node,gesture.height);queue()});
 handle.addEventListener('pointerup',()=>finish(true));handle.addEventListener('pointercancel',()=>finish(false));handle.addEventListener('lostpointercapture',()=>{if(gesture)finish(false)});
 handle.addEventListener('keydown',e=>{const s=section();if(!s||!editing||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const height=Math.min(6000,Math.max(160,Math.round(s.getBoundingClientRect().height)+(e.key==='ArrowUp'?-1:1)*(e.shiftKey?40:10)));setHeight(s,height);send({type:'section-resize',id:sections.indexOf(s),height});queue()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&gesture){e.preventDefault();e.stopImmediatePropagation();finish(false)}},true);
 document.addEventListener('click',()=>queue());addEventListener('scroll',queue,{passive:true});addEventListener('resize',queue);addEventListener('message',e=>{if(e.source!==parent)return;if(['mode','clear','restore'].includes(e.data?.type)&&gesture)finish(false);queue()});queue();
})();

// Local CTA appearance only; links and form destinations remain unchanged.
(()=>{
 const buttons=[...new Set([...document.querySelectorAll('main a.button,header a.button,main button:not([disabled])'),...document.querySelectorAll('a.primaryButton,a.secondaryButton,a.navCta')])].filter(n=>!n.closest('#section-picker,#local-image-tools,#shape-toolbar')&&!n.id.startsWith('local-'));
 const base=buttons.map(n=>n.getAttribute('style'));
 buttons.forEach((n,i)=>{n.dataset.studioButton=i;n.addEventListener('keydown',e=>{if(editing&&e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();send({type:'button-selected',id:i})}})});
 addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='restore')return;for(const [id,v]of Object.entries(e.data.edits?.$buttons||{})){const n=buttons[Number(id)];if(!n||!v)continue;if(base[id]===null)n.removeAttribute('style');else n.setAttribute('style',base[id]);const sizes={small:[44,14,16],medium:[52,22,16],large:[64,30,18]};if(sizes[v.size]){const [h,p,f]=sizes[v.size];Object.assign(n.style,{minHeight:h+'px',padding:'10px '+p+'px',fontSize:f+'px',boxSizing:'border-box',maxWidth:'100%',whiteSpace:'normal'})}const styles={solid:['#132238','#ffffff','1px solid #132238','12px'],outline:['transparent','#132238','1px solid #132238','12px'],soft:['#e9dcc3','#493b28','1px solid #d9c9ac','12px'],pill:['#132238','#ffffff','1px solid #132238','999px'],square:['#132238','#ffffff','1px solid #132238','0px']};if(styles[v.style]){const [background,color,border,borderRadius]=styles[v.style];Object.assign(n.style,{background,color,border,borderRadius,boxShadow:'none'})}}});
})();

window.addEventListener('pointerdown',e=>{
 if(!editing||e.target.closest('#local-image-tools,#shape-toolbar,.local-shape,#section-picker,.local-section-resize,#local-edit-header,#local-edit-footer'))return;
 if(selected&&!selected.contains(e.target)){
  if(crop)endCrop(false);selected.removeAttribute('data-local-selected');selected=null;
  positionHandles();dispatchEvent(new Event('resize'));send({type:'deselected'});
 }
},true);
