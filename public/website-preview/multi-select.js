// Canvas-only selection. Locks prevent accidental edits; authorization stays server-side.
(()=>{
 let enabled=false,mode=false,keys=new Set(),locks=new Set(),groups=[],gesture=null,bar,box,overlay,suppress=false,drawPending=false;
 const ui='#local-multi-bar,#local-multi-overlay,#local-multi-box';
 const key=n=>n?.dataset.shapeId?'shape:'+n.dataset.shapeId:n?.dataset.contextKey?.match(/^(header|footer):/)?n.dataset.contextKey:n?.matches('img[data-local-id]')?'photo:'+n.dataset.localId:n?.dataset.contextKey;
 // Select complete text runs and controls, never both a parent and its children.
 function candidates(){
  window.StudioContentSelection?.register();
  const all=[...document.querySelectorAll('[data-context-key],img[data-local-id],.local-shape')].filter(n=>{
   if(n.closest('form,script,style,[id^="local-"],#shape-toolbar')||n.getBoundingClientRect().width<=0)return false;
   if(n.matches('.local-shape,img,video'))return true;
   if(!n.dataset.contextKey||!n.textContent.trim())return false;
   if(n.matches('a,button'))return true;
   return !n.querySelector('h1,h2,h3,h4,h5,h6,p,div,section,article,nav,ul,ol,li,table,img,video,button,a,input,textarea')&&n.matches('h1,h2,h3,h4,h5,h6,p,li,span,strong,em,small,label,div,blockquote,figcaption,dt,dd');
  });
  return all.filter(n=>!all.some(parent=>parent!==n&&parent.contains(n)&&!parent.matches('.local-shape,img,video')));
 }
 const locked=n=>!!n&&(locks.has(key(n))||[...n.querySelectorAll('[data-context-key]')].some(child=>locks.has(key(child))));
 const hit=t=>candidates().filter(n=>n===t||n.contains(t)).at(-1);
 const members=id=>groups.find(g=>g.includes(id))||[id];
 const selectedGroup=()=>groups.find(g=>g.length===keys.size&&g.every(k=>keys.has(k)));
 const picked=()=>candidates().filter(n=>keys.has(key(n)));
 function clearNative(){const keep=new Set(keys);dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'clear'}}));keys=keep;send({type:'deselected'});}
 function scheduleDraw(){if(drawPending)return;drawPending=true;requestAnimationFrame(()=>{drawPending=false;draw()})}
 function draw(){if(!bar)return;overlay.replaceChildren();const list=picked();bar.hidden=!enabled||(!mode&&!list.length);bar.querySelector('output').textContent=list.length?list.length+' selected'+(list.some(n=>locked(n))?' · locked':''):'Drag a box or Shift-click items';
  for(const n of list){const r=n.getBoundingClientRect(),mark=document.createElement('div');Object.assign(mark.style,{position:'fixed',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',border:'2px '+(locked(n)?'dashed':'solid')+' #a57d3d',boxSizing:'border-box'});overlay.append(mark)}
  if(list.length>1){const rects=list.map(n=>n.getBoundingClientRect()),group=document.createElement('div');group.dataset.groupOutline='';const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top));Object.assign(group.style,{position:'fixed',left:(left-6)+'px',top:(top-6)+'px',width:(Math.max(...rects.map(r=>r.right))-left+12)+'px',height:(Math.max(...rects.map(r=>r.bottom))-top+12)+'px',border:'1px dashed #a57d3d',borderRadius:'4px',boxSizing:'border-box'});overlay.append(group)}
  for(const b of bar.querySelectorAll('[data-lock]'))b.disabled=!list.length;
  const move=bar.querySelector('[data-move]');if(move)move.disabled=!list.some(n=>!locked(n));
  const groupButton=bar.querySelector('[data-group]');if(groupButton){groupButton.textContent=selectedGroup()?'Ungroup':'Group';groupButton.disabled=list.length<2;}
  const lockButton=bar.querySelector('[data-lock-toggle]');if(lockButton){const allLocked=list.length&&list.every(locked);lockButton.setAttribute('aria-label',allLocked?'Unlock selection':'Lock selection');lockButton.title=allLocked?'Unlock selection':'Lock selection';lockButton.setAttribute('aria-pressed',String(!!allLocked));lockButton.disabled=!list.length;}
  if(list.length){const rects=list.map(n=>n.getBoundingClientRect()),left=Math.min(...rects.map(r=>r.left)),right=Math.max(...rects.map(r=>r.right)),top=Math.min(...rects.map(r=>r.top)),bottom=Math.max(...rects.map(r=>r.bottom));const width=bar.offsetWidth||360,height=bar.offsetHeight||60;bar.style.left=Math.max(12,Math.min(innerWidth-width-12,(left+right-width)/2))+'px';bar.style.top=Math.max(12,Math.min(innerHeight-height-12,top>height+24?top-height-12:bottom+12))+'px';}else{bar.style.left='12px';bar.style.top='12px';}
  bar.style.visibility=gesture?.started?'hidden':'visible';
 }
 function setMode(value){mode=value;if(!value)keys.clear();clearNative();draw();send({type:'multi-mode-state',enabled:mode})}
 function stop(e){e.preventDefault();e.stopImmediatePropagation()}
 function point(e){return {x:e.clientX,y:e.clientY}}
 function beginMove(e){
  clearNative();const list=picked().filter(v=>!locked(v));if(!list.length)return;
  gesture={kind:'move',...point(e),pointer:e.pointerId,items:list.map(v=>{const r=v.getBoundingClientRect(),s=v.closest('header,footer,section')||document.querySelector('main'),sr=s.getBoundingClientRect(),k=key(v),shape=k.startsWith('shape:')?window.StudioShapeSelection?.get(v.dataset.shapeId):null,offset=k.startsWith('photo:')?photoOffsets.get(v)||{x:0,y:0}:{x:Number(v.dataset.studioOffsetX)||0,y:Number(v.dataset.studioOffsetY)||0};return {n:v,k,r,sr,s,shape,offset,translate:v.style.translate,display:v.style.display};}),dx:0,dy:0,started:false};
  send({type:'history-boundary'});if(e.pointerId!==undefined)document.body.setPointerCapture(e.pointerId);
 }
 // Capture before single-item tools, without stealing text editing or toolbar controls.
 window.addEventListener('pointerdown',e=>{
  if(!enabled||e.button!==0)return;
  suppress=false;
  if(e.target.closest('[data-move]')){stop(e);suppress=true;beginMove(e);return;}
  if(e.target.closest(ui))return;
  if(e.target.closest('input,textarea,[contenteditable=true],#local-text-handles,#local-image-tools,#shape-toolbar,#section-picker,.local-section-resize,#local-edit-header,#local-edit-footer,#section-divisions'))return;
  const n=hit(e.target),id=key(n);
  if(!e.target.closest('main,header,footer'))return;
  if(e.shiftKey&&n){stop(e);suppress=true;const remove=keys.has(id);for(const member of members(id))if(remove)keys.delete(member);else keys.add(member);clearNative();draw();return;}
  if(n&&locked(n)&&!mode){stop(e);suppress=true;if(!keys.has(id))keys=new Set(members(id));clearNative();draw();return;}
  // A Shift-click group remains draggable without first enabling a separate mode.
  if(n&&(keys.has(id)&&(mode||keys.size>1)||members(id).length>1)){stop(e);suppress=true;if(!keys.has(id))keys=new Set(members(id));beginMove(e);draw();return;}
  if(n&&!mode)return;
  // Selection mode can start a marquee over unselected content, including full-bleed images.
  stop(e);clearNative();suppress=true;
  const before=new Set(keys);if(!e.shiftKey)keys.clear();
  gesture={kind:'box',...point(e),pointer:e.pointerId,hit:id,before,base:e.shiftKey?new Set(keys):new Set(),candidates:candidates(),started:false};
  document.body.setPointerCapture(e.pointerId);draw();
 },true);
 function applyMove(g,dx,dy){for(const v of g.items){if(v.shape)window.StudioShapeSelection.set(v.n.dataset.shapeId,v.shape.x+dx/v.sr.width*100,v.shape.y+dy/v.sr.height*100);else if(v.k.startsWith('photo:')){photoOffsets.set(v.n,{x:v.offset.x+dx/v.s.clientWidth*100,y:v.offset.y+dy/v.s.clientHeight*100});positionPhoto(v.n)}else{if(getComputedStyle(v.n).display==='inline')v.n.style.display='inline-block';v.n.style.translate=(v.offset.x+dx)+'px '+(v.offset.y+dy)+'px';}}}
 function updateGesture(e){const g=gesture;if(!g||e.pointerId!==g.pointer)return;stop(e);if(!g.started&&Math.hypot(e.clientX-g.x,e.clientY-g.y)<4)return;g.started=true;if(g.kind==='box'){box.hidden=false;
  const left=Math.min(g.x,e.clientX),top=Math.min(g.y,e.clientY),right=Math.max(g.x,e.clientX),bottom=Math.max(g.y,e.clientY);Object.assign(box.style,{left:left+'px',top:top+'px',width:(right-left)+'px',height:(bottom-top)+'px'});
  keys=new Set([...g.base,...g.candidates.filter(n=>{const r=n.getBoundingClientRect();const contained=r.left>=left&&r.right<=right&&r.top>=top&&r.bottom<=bottom;const section=n.closest('section'),sr=section?.getBoundingClientRect();const background=n.matches('img,video')&&sr&&r.width>=sr.width*.9&&r.height>=sr.height*.9;return contained||(!background&&r.right>left&&r.left<right&&r.bottom>top&&r.top<bottom)}).map(key)]);
 }else{let dx=e.clientX-g.x,dy=e.clientY-g.y;const minX=Math.max(...g.items.map(v=>Math.min(0,v.sr.left-v.r.left))),maxX=Math.min(...g.items.map(v=>Math.max(0,v.sr.right-v.r.right))),minY=Math.max(...g.items.map(v=>Math.min(0,v.sr.top-v.r.top))),maxY=Math.min(...g.items.map(v=>Math.max(0,v.sr.bottom-v.r.bottom)));g.dx=Math.max(minX,Math.min(maxX,dx));g.dy=Math.max(minY,Math.min(maxY,dy));applyMove(g,g.dx,g.dy);}scheduleDraw();}
 window.addEventListener('pointermove',updateGesture,true);
 function finish(commit){const g=gesture;if(!g)return;gesture=null;box.hidden=true;if(g.kind==='box'){if(!commit)keys=g.before;else if(!g.started)keys=new Set([...g.base,...(g.hit?members(g.hit):[])]);else keys=new Set([...keys].flatMap(members));}if(g.kind==='move'){if(!commit){applyMove(g,0,0);for(const v of g.items)if(!v.shape){v.n.style.translate=v.translate||'';v.n.style.display=v.display||'';}}else if(g.dx||g.dy){const changes=[];for(const v of g.items){if(v.shape)continue;if(v.k.startsWith('photo:'))changes.push({kind:'photo',id:Number(v.n.dataset.localId),...photoOffsets.get(v.n)});else{const x=v.offset.x+g.dx,y=v.offset.y+g.dy;v.n.dataset.studioOffsetX=x;v.n.dataset.studioOffsetY=y;changes.push({kind:'text',key:v.k,x,y})}}send({type:'selection-moved',changes,shapes:window.StudioShapeSelection?.all()});}}if(typeof g.pointer==='number'&&document.body.hasPointerCapture(g.pointer))document.body.releasePointerCapture(g.pointer);draw();}
 window.addEventListener('pointerup',e=>{if(gesture){stop(e);finish(true)}},true);
 window.addEventListener('pointercancel',()=>finish(false),true);
 window.addEventListener('blur',()=>finish(false));
 window.addEventListener('lostpointercapture',()=>finish(false));
 window.addEventListener('click',e=>{if(e.target.closest(ui))return;if(suppress){suppress=false;stop(e);return}const n=hit(e.target);if(enabled&&n){keys=new Set(members(key(n)));if(keys.size>1){stop(e);clearNative();}if(locked(n)){stop(e);clearNative();}requestAnimationFrame(draw)}else if(!e.target.closest('[id^="local-"],#shape-toolbar')){keys.clear();draw()}},true);
 window.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,[contenteditable=true]'))return;if(e.key==='Escape'){finish(false);setMode(false)}if(enabled&&(mode||keys.size>1||e.target.closest('[data-move]'))&&e.key.startsWith('Arrow')&&!e.altKey&&!e.ctrlKey&&!e.metaKey){stop(e);beginMove({clientX:0,clientY:0});if(gesture){const step=e.shiftKey?10:1;const dx=e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,dy=e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0;const g=gesture;g.dx=Math.max(Math.max(...g.items.map(v=>Math.min(0,v.sr.left-v.r.left))),Math.min(Math.min(...g.items.map(v=>Math.max(0,v.sr.right-v.r.right))),dx));g.dy=Math.max(Math.max(...g.items.map(v=>Math.min(0,v.sr.top-v.r.top))),Math.min(Math.min(...g.items.map(v=>Math.max(0,v.sr.bottom-v.r.bottom))),dy));applyMove(g,g.dx,g.dy);finish(true);}return;}if(enabled&&locked(hit(e.target))&&(e.key.startsWith('Arrow')||e.key==='Delete'||e.key==='Backspace'))stop(e);},true);
 addEventListener('message',e=>{if(e.source!==parent)return;const d=e.data;if(d.type==='marquee-outside'&&enabled){
   if(d.phase==='start'&&[d.x,d.y].every(Number.isFinite)){finish(false);clearNative();const before=new Set(keys);if(!d.add)keys.clear();gesture={kind:'box',x:d.x,y:d.y,pointer:'outside',before,base:d.add?new Set(keys):new Set(),candidates:candidates(),started:false};draw();}
   if(d.phase==='move'&&gesture?.pointer==='outside'&&[d.x,d.y].every(Number.isFinite))updateGesture({pointerId:'outside',clientX:d.x,clientY:d.y,preventDefault(){},stopImmediatePropagation(){}});
   if(d.phase==='end'&&gesture?.pointer==='outside')finish(true);
   if(d.phase==='cancel'&&gesture?.pointer==='outside')finish(false);
  }
  if(d.type==='multi-mode')setMode(!!d.enabled);if(d.type==='restore-groups'){groups=Array.isArray(d.groups)?d.groups.filter(g=>Array.isArray(g)&&g.length>1&&g.length<=200&&g.every(k=>typeof k==='string'&&k.length<180)).slice(0,100):[];}if(d.type==='restore-locks'){locks=new Set(Array.isArray(d.locks)?d.locks.filter(k=>typeof k==='string'&&k.length<300).slice(0,500):[]);draw()}if(d.type==='mode'){enabled=!!d.editing;if(!enabled){finish(false);mode=false;keys.clear();send({type:'multi-mode-state',enabled:false})}draw()}if(d.type==='clear'&&!mode){keys.clear();draw()}});
 window.addEventListener('dblclick',e=>{if(enabled&&locked(hit(e.target)))stop(e)},true);
 addEventListener('DOMContentLoaded',()=>{
  enabled=true;const style=document.createElement('style');style.textContent='#local-multi-bar [data-move]{cursor:grab;touch-action:none}#local-multi-bar button:disabled{opacity:.45;cursor:default}#local-multi-bar{position:fixed;top:12px;left:12px;transform:none!important;z-index:2147483647;background:#f5eddf;color:#493b28;border:1px solid #b08d57;border-radius:18px;padding:6px 10px;display:flex;gap:4px;align-items:center;width:max-content;max-width:calc(100vw - 24px);box-sizing:border-box;flex-wrap:wrap;box-shadow:0 4px 18px #0002;font:14px system-ui}#local-multi-bar[hidden],#local-multi-box[hidden]{display:none}#local-multi-bar button{min-height:44px;border:0;border-radius:12px;background:transparent;color:#493b28;padding:8px 10px;font:inherit}#local-multi-bar button:hover{background:#e8d9bf}#local-multi-bar output{font-size:12px;padding:0 8px;border-right:1px solid #cfb88e}#local-multi-bar button:focus-visible{outline:3px solid #a57d3d}#local-multi-overlay{position:fixed;inset:0;pointer-events:none;z-index:2147483645}#local-multi-box{position:fixed;border:1px solid #a57d3d;background:#b08d5722;pointer-events:none;z-index:2147483646}';document.head.append(style);
  overlay=document.createElement('div');overlay.id='local-multi-overlay';overlay.setAttribute('aria-hidden','true');box=document.createElement('div');box.id='local-multi-box';box.hidden=true;bar=document.createElement('div');bar.id='local-multi-bar';bar.hidden=true;bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Selection controls');bar.innerHTML='<output aria-live="polite"></output><button type="button" data-group>Group</button><button type="button" data-lock-toggle aria-label="Lock selection" title="Lock selection"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/></svg></button><button type="button" data-move aria-label="Move selection" title="Drag to move; arrow keys to nudge"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg></button>';document.body.append(overlay,box,bar);
  bar.onclick=e=>{const control=e.target.closest('button');if(!control)return;
   if(control.hasAttribute('data-group')){send({type:'history-boundary'});const existing=selectedGroup();groups=groups.filter(g=>!g.some(k=>keys.has(k)));if(!existing&&keys.size>1)groups.push([...keys]);send({type:'groups-change',groups});draw();return;}
   if(control.hasAttribute('data-lock-toggle')){send({type:'history-boundary'});const unlock=picked().every(locked);for(const n of picked()){if(unlock){locks.delete(key(n));for(const child of n.querySelectorAll('[data-context-key]'))locks.delete(key(child));}else locks.add(key(n));}clearNative();send({type:'locks-change',locks:[...locks]});draw();return;}
};
  addEventListener('dragstart',e=>{if(enabled&&(mode||gesture))stop(e)},true);
  addEventListener('scroll',scheduleDraw,true);addEventListener('resize',scheduleDraw);
 });
})();
