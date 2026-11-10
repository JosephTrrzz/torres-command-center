// Local-only decorative shapes. Section-relative geometry persists in the parent draft.
(()=>{
 const kinds=['rectangle','rounded','ellipse','triangle','diamond','line','image','text','bubble'];
 const fonts={sans:'Arial, sans-serif',serif:'Georgia, serif',modern:'system-ui, sans-serif',classic:'Times New Roman, serif',mono:'Courier New, monospace'};
 let inline=null,lastTextPress=null;
 let items=[],active=null,gesture=null,undo=[],redo=[],enabled=true;
 const layers=new Map(),elements=new Map(),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const css=document.createElement('style');css.textContent=`
.local-shape-layer{position:absolute;inset:0;pointer-events:none;z-index:20;overflow:hidden}
.local-shape{position:absolute;pointer-events:auto;touch-action:none;cursor:move;box-sizing:border-box;outline:none}
.local-shape-face{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-wrap;overflow:hidden;font:16px/1.4 system-ui;color:white;padding:8px;box-sizing:border-box}
.local-shape[data-active]{outline:2px solid #7654d8;outline-offset:2px}
.local-shape:focus-visible{outline:3px solid #7654d8;outline-offset:3px}
.local-shape-handle{position:absolute;width:44px;height:44px;min-width:0;padding:0;background:transparent;border:0;transform:translate(-50%,-50%);touch-action:none;box-shadow:none}
.local-shape-handle:after{content:'';display:block;width:12px;height:12px;margin:auto;background:white;border:2px solid #7654d8;border-radius:50%}
#shape-toolbar{position:fixed;z-index:2147483647;left:12px;top:12px;max-width:calc(100vw - 24px);display:flex;align-items:center;flex-wrap:wrap;gap:6px;background:white;color:#132238;padding:8px;border:1px solid #e5e3df;border-radius:14px;box-shadow:0 8px 24px #13223826;font:12px system-ui}
.local-inline-text{display:block;width:100%;height:100%;box-sizing:border-box;border:0;outline:0;resize:none;background:transparent;color:inherit;font:inherit;text-align:inherit;padding:0;white-space:pre-wrap;touch-action:auto;cursor:text}.local-shape:has(.local-inline-text){touch-action:auto}#shape-toolbar button[aria-pressed=true]{background:#eee8f6;border-color:#7654d8}
#shape-toolbar [hidden],#shape-toolbar[hidden],.local-shape-handle[hidden]{display:none!important}
#shape-toolbar label{display:flex;align-items:center;gap:5px}#shape-toolbar button,#shape-toolbar input{font:12px system-ui;min-height:44px;border:1px solid #e5e3df;border-radius:8px;background:white;color:#132238;padding:6px 9px}
#shape-toolbar textarea,#shape-toolbar select{font:14px system-ui;max-width:180px;min-height:44px;border:1px solid #e5e3df;border-radius:8px;padding:6px;color:#132238;background:white}#shape-toolbar input[type=number]{width:65px}#shape-toolbar input[type=range]{width:80px;padding:0}#shape-toolbar input[type=color]{width:44px;padding:5px}#shape-toolbar input[type=text]{width:140px}#shape-toolbar button{cursor:pointer}

#shape-toolbar{left:50%;top:16px;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 32px);padding:6px;border:1px solid #dcddea;border-radius:22px;box-shadow:0 4px 12px #2822501f;background:#fff;font:14px system-ui}
#shape-toolbar .toolbar-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap;justify-content:center}
#shape-toolbar .toolbar-row>label{font-size:0;gap:0;margin:0}
#shape-toolbar .toolbar-row button,#shape-toolbar .toolbar-row select{border:0;min-height:44px;background:transparent;border-radius:12px;font:500 14px system-ui;padding:8px 10px}
#shape-toolbar .toolbar-row>label>select{border:1px solid #d8d8e0;min-width:100px}
#shape-toolbar [data-field=font]{min-width:145px!important}
#shape-toolbar .toolbar-size{border:1px solid #d8d8e0;border-radius:14px;overflow:hidden}
#shape-toolbar .toolbar-size input{width:46px;min-width:0;padding:0;border:0;text-align:center;font:600 15px system-ui;appearance:textfield}
#shape-toolbar .toolbar-size input::-webkit-inner-spin-button{appearance:none}
#shape-toolbar .toolbar-size button{padding:8px;width:32px;font-size:20px}
#shape-toolbar .toolbar-row [data-act=bold],#shape-toolbar .toolbar-row [data-act=italic]{font-size:23px;width:44px}#shape-toolbar .toolbar-row [data-act=bold]{font-weight:750}#shape-toolbar .toolbar-row [data-act=italic]{font-family:Georgia,serif;font-style:italic}
#shape-toolbar .toolbar-row button[aria-pressed=true]{background:#eee7ff;color:#583496}
#shape-toolbar .toolbar-row button:hover,#shape-toolbar summary:hover{background:#f3f0f8}
#shape-toolbar button:focus-visible,#shape-toolbar select:focus-visible,#shape-toolbar summary:focus-visible{outline:2px solid #7654d8;outline-offset:2px}
#shape-toolbar .toolbar-more{position:relative}#shape-toolbar summary{cursor:pointer;list-style:none;padding:13px 10px;border-radius:12px;font-weight:500}#shape-toolbar summary::-webkit-details-marker{display:none}
#shape-toolbar .toolbar-tray{position:absolute;right:0;top:calc(100% + 12px);width:250px;max-height:55vh;overflow:auto;padding:16px;display:grid;gap:12px;border:1px solid #dcddea;border-radius:18px;background:white;box-shadow:0 8px 24px #28225024}
#shape-toolbar .toolbar-tray label{justify-content:space-between}#shape-toolbar .toolbar-tray textarea{width:155px}
#shape-toolbar [data-act=delete]{border-left:1px solid #e4e2e8;border-radius:0 12px 12px 0;display:flex;align-items:center}
@media(max-width:600px){#shape-toolbar{top:8px;max-width:calc(100vw - 16px);border-radius:18px}#shape-toolbar .toolbar-row{gap:2px}#shape-toolbar .toolbar-tray{position:fixed;left:0;right:0;top:calc(100% + 8px);width:auto}}

#shape-toolbar .color-wheel{position:relative;display:inline-block;width:44px;height:44px;flex:0 0 44px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffffffcc,transparent 52%),conic-gradient(#ff275d,#ff24ed,#783dff,#176aff,#00d4ee,#12e17b,#d4f327,#ffe622,#ff8a25,#ff275d);box-shadow:inset 0 0 0 1px #00000008;cursor:pointer}
#shape-toolbar .color-wheel input[type=color]{position:absolute;inset:0;width:100%;height:100%;min-height:44px;opacity:0;margin:0;padding:0;border:0;cursor:pointer;border-radius:50%}
#shape-toolbar .color-wheel:focus-within{outline:2px solid #7654d8;outline-offset:3px}
#shape-toolbar .color-wheel:hover{box-shadow:0 0 0 3px #eee7ff}

#shape-toolbar{background:#f5efe4;border-color:#d9c9ac;color:#493b28;box-shadow:0 4px 14px #493b2824}
#shape-toolbar .toolbar-row button,#shape-toolbar .toolbar-row select,#shape-toolbar .toolbar-size input{color:#493b28}
#shape-toolbar .toolbar-row>label>select,#shape-toolbar .toolbar-size{background:#fffcf6;border-color:#d9c9ac}
#shape-toolbar .toolbar-size input{background:#fffcf6}
#shape-toolbar .toolbar-row button[aria-pressed=true]{background:#e9dcc3;color:#805c26}
#shape-toolbar .toolbar-row button:hover,#shape-toolbar summary:hover{background:#e9dcc3;color:#805c26}
#shape-toolbar .toolbar-tray{background:#f5efe4;border-color:#d9c9ac;box-shadow:0 8px 24px #493b2824}
#shape-toolbar .toolbar-tray :is(input,textarea,select,button){background:#fffcf6;border-color:#d9c9ac;color:#493b28}
#shape-toolbar input[type=range]{accent-color:#805c26}
#shape-toolbar [data-act=delete]{border-color:#d9c9ac}
#shape-toolbar :is(button,select,summary):focus-visible,#shape-toolbar .color-wheel:focus-within{outline-color:#805c26}
#shape-toolbar .color-wheel:hover{box-shadow:0 0 0 3px #e9dcc3}
`;document.head.append(css);
 const bar=document.createElement('div');bar.id='shape-toolbar';bar.hidden=true;bar.setAttribute('role','group');bar.setAttribute('aria-label','Shape controls');bar.innerHTML='<label>Fill <input type="color" data-field="color" aria-label="Shape color"></label><label>Opacity <input type="range" min="10" max="100" data-field="opacity" aria-label="Shape opacity"></label><label>Rotate <input type="range" min="-180" max="180" data-field="rotation" aria-label="Shape rotation"></label><label>Text <textarea maxlength="300" data-field="text" aria-label="Element text" rows="2"></textarea></label><label data-text-style>Font <select data-field="font" aria-label="Font family"><option value="sans">Arial</option><option value="modern">System Sans</option><option value="serif">Georgia</option><option value="classic">Times New Roman</option><option value="mono">Courier New</option></select></label><button data-text-style data-act="bold" aria-pressed="false">Bold</button><button data-text-style data-act="italic" aria-pressed="false">Italic</button><button data-text-style data-act="edit-text">Edit text</button><label data-text-style>Size <input type="number" min="10" max="120" data-field="fontSize" aria-label="Text size"></label><label data-text-style>Text color <input type="color" data-field="textColor" aria-label="Text color"></label><label data-text-style>Align <select data-field="align" aria-label="Text alignment"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><button data-act="fit">Fit / Fill</button><button data-act="duplicate">Duplicate</button><button data-act="front">Forward</button><button data-act="back">Backward</button><button data-act="delete">Delete</button><button data-act="done">Done</button>';document.body.append(bar);
 // Keep common typography actions in one row; secondary controls open on demand.
 const field=k=>bar.querySelector('[data-field='+k+']').closest('label');
 const action=k=>bar.querySelector('[data-act='+k+']');
 const extra=document.createElement('details');extra.className='toolbar-more';
 const summary=document.createElement('summary');summary.textContent='More';summary.setAttribute('aria-label','More element controls');extra.append(summary);
 const tray=document.createElement('div');tray.className='toolbar-tray';extra.append(tray);
 for(const k of ['color','opacity','rotation','text'])tray.append(field(k));
 for(const k of ['duplicate','front','back'])tray.append(action(k));
 for(const key of ['color','textColor']){const input=bar.querySelector('[data-field='+key+']')||tray.querySelector('[data-field='+key+']');const label=input.closest('label');const wheel=document.createElement('span');wheel.className='color-wheel';wheel.title=key==='color'?'Change fill color':'Change text color';input.before(wheel);wheel.append(input)}
 const row=document.createElement('div');row.className='toolbar-row';
 for(const k of ['font','fontSize','textColor'])row.append(field(k));
 for(const k of ['bold','italic']){const b=action(k);b.setAttribute('aria-label',k==='bold'?'Bold':'Italic');b.title=k==='bold'?'Bold':'Italic';b.textContent=k==='bold'?'B':'I';row.append(b)}
 row.append(field('align'),action('edit-text'),action('fit'),extra,action('delete'),action('done'));bar.append(row);
 const size=bar.querySelector('[data-field=fontSize]');const sizeGroup=size.closest('label');sizeGroup.className='toolbar-size';
 for(const [symbol,delta,label]of [['−',-1,'Decrease font size'],['+',1,'Increase font size']]){const b=document.createElement('button');b.type='button';b.textContent=symbol;b.setAttribute('aria-label',label);b.onclick=()=>{size.value=clamp(Number(size.value)+delta,10,120);size.dispatchEvent(new Event('input',{bubbles:true}))};if(delta<0)size.before(b);else size.after(b)}
 action('delete').innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>';action('delete').setAttribute('aria-label','Delete element');action('delete').title='Delete';

 function snapshot(){return JSON.stringify(items)}
 function remember(){undo.push(snapshot());if(undo.length>40)undo.shift();redo=[]}
 function emit(){send({type:'shapes-change',shapes:items,canUndo:!!undo.length,canRedo:!!redo.length})}
 function safeImage(src){return typeof src==='string'&&(/^(data:image\/(png|jpeg|webp);base64,)/.test(src)||/^\/website-preview\/assets\/[a-zA-Z0-9._-]+$/.test(src))}
 function clean(v){return v&&typeof v.id==='string'&&v.id.length<100&&kinds.includes(v.kind)&&Number.isInteger(v.section)&&sections[v.section]&&['x','y','w','h','rotation','opacity'].every(k=>Number.isFinite(v[k]))&&v.x>=0&&v.y>=0&&v.w>=2&&v.h>=1&&v.x+v.w<=100.01&&v.y+v.h<=100.01&&/^#[a-f\d]{6}$/i.test(v.color)&&(v.kind!=='image'||safeImage(v.src))&&typeof v.text==='string'&&v.text.length<=300&&(v.fontSize===undefined||Number.isFinite(v.fontSize)&&v.fontSize>=10&&v.fontSize<=120)&&(v.textColor===undefined||/^#[a-f\d]{6}$/i.test(v.textColor))&&(v.font===undefined||Object.hasOwn(fonts,v.font))&&(v.bold===undefined||typeof v.bold==='boolean')&&(v.italic===undefined||typeof v.italic==='boolean')&&(v.align===undefined||['left','center','right'].includes(v.align))}
 function deselect(){active=null;render()}
 function choose(id){if(crop)endCrop(false);selected?.removeAttribute('data-local-selected');selected=null;positionHandles();active=id;render();send({type:'deselected'})}
 function endInline(cancel=false){if(!inline)return;const edit=inline;inline=null;const v=items.find(v=>v.id===edit.id);if(v&&cancel){v.text=edit.original;emit()}edit.field.replaceWith(document.createTextNode(v?.text||''));}
 function beginInline(id){if(!enabled)return;endInline();if(active!==id)choose(id);const v=items.find(v=>v.id===id);if(!v||!['text','bubble'].includes(v.kind))return;const face=elements.get(id).querySelector('.local-shape-face');const field=document.createElement('textarea');field.className='local-inline-text';field.setAttribute('aria-label','Edit text on page');field.maxLength=300;field.value=v.text;inline={id,field,original:v.text,recorded:false};face.replaceChildren(field);field.addEventListener('pointerdown',e=>e.stopPropagation());field.addEventListener('click',e=>e.stopPropagation());field.addEventListener('input',()=>{if(!inline)return;if(!inline.recorded){remember();inline.recorded=true}v.text=field.value.slice(0,300);bar.querySelector('[data-field=text]').value=v.text;emit()});field.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();endInline(true);elements.get(id)?.focus()}else if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();endInline();elements.get(id)?.focus()}});field.addEventListener('blur',()=>endInline());field.focus();field.select();}
 function render(){endInline();
  for(const el of elements.values())el.remove();elements.clear();
  for(const [i,s]of sections.entries())if(items.some(v=>v.section===i)){if(getComputedStyle(s).position==='static')s.style.position='relative';if(!layers.has(i)){const l=document.createElement('div');l.className='local-shape-layer';s.append(l);layers.set(i,l)}}
  for(const v of items){const el=document.createElement('div');el.className='local-shape';el.dataset.shapeId=v.id;el.tabIndex=enabled?0:-1;el.setAttribute('role',v.kind==='text'||v.kind==='bubble'?'group':'img');el.setAttribute('aria-label',v.kind+' shape'+(v.text?': '+v.text:''));if(enabled&&active===v.id)el.dataset.active='';
   Object.assign(el.style,{left:v.x+'%',top:v.y+'%',width:v.w+'%',height:v.h+'%',transform:`rotate(${v.rotation}deg)`,pointerEvents:enabled?'auto':'none'});
   const face=document.createElement('div');face.className='local-shape-face';face.textContent=v.text;Object.assign(face.style,{background:v.color,opacity:clamp(v.opacity,10,100)/100,borderRadius:v.kind==='ellipse'?'50%':v.kind==='rounded'?'20px':'0',clipPath:v.kind==='triangle'?'polygon(50% 0,100% 100%,0 100%)':v.kind==='diamond'?'polygon(50% 0,100% 50%,50% 100%,0 50%)':'none'});if(v.kind==='image'){face.style.padding='0';const photo=document.createElement('img');photo.src=v.src;photo.alt=v.text;photo.draggable=false;Object.assign(photo.style,{width:'100%',height:'100%',objectFit:v.fit||'cover',pointerEvents:'none'});face.replaceChildren(photo)}if(v.kind==='text'||v.kind==='bubble'){Object.assign(face.style,{background:v.kind==='text'?'transparent':v.color,color:v.textColor||'#132238',fontSize:(v.fontSize||24)+'px',fontFamily:fonts[v.font]||fonts.sans,fontWeight:v.bold?'700':'400',fontStyle:v.italic?'italic':'normal',textAlign:v.align||'left',justifyContent:v.align==='center'?'center':v.align==='right'?'flex-end':'flex-start',borderRadius:v.kind==='bubble'?'24px':'0',overflow:'auto',overflowWrap:'anywhere'});el.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();beginInline(v.id)})}el.append(face);
   if(enabled&&active===v.id)for(const [dir,x,y]of [['nw',0,0],['n',50,0],['ne',100,0],['e',100,50],['se',100,100],['s',50,100],['sw',0,100],['w',0,50]]){const h=document.createElement('button');h.className='local-shape-handle';h.type='button';h.dataset.dir=dir;h.setAttribute('aria-label','Resize shape '+dir);Object.assign(h.style,{left:x+'%',top:y+'%',cursor:dir+'-resize'});el.append(h)}
   el.addEventListener('pointerdown',e=>start(e,v.id));el.addEventListener('keydown',e=>keyboard(e,v.id));layers.get(v.section).append(el);elements.set(v.id,el);
  }
  const v=items.find(v=>v.id===active);bar.hidden=!enabled||!v;bar.querySelector('[data-act=fit]').hidden=v?.kind!=='image';for(const control of bar.querySelectorAll('[data-text-style]'))control.hidden=!v||!['text','bubble'].includes(v.kind);for(const act of ['bold','italic'])bar.querySelector('[data-act='+act+']').setAttribute('aria-pressed',!!v?.[act]);if(v){for(const input of bar.querySelectorAll('[data-field]'))if(document.activeElement!==input)input.value=v[input.dataset.field]??({font:'sans',fontSize:24,textColor:'#132238',align:'left'}[input.dataset.field]||'')}
 }
 function start(e,id){if(!enabled||e.button!==0||e.target.closest('.local-inline-text'))return;const twice=lastTextPress?.id===id&&performance.now()-lastTextPress.time<400;lastTextPress={id,time:performance.now()};if((e.detail===2||twice)&&['text','bubble'].includes(items.find(v=>v.id===id)?.kind)){e.preventDefault();e.stopPropagation();beginInline(id);return;}e.preventDefault();e.stopPropagation();if(active!==id)choose(id);const v=items.find(v=>v.id===id),r=layers.get(v.section).getBoundingClientRect();gesture={id,start:{...v},before:snapshot(),x:e.clientX,y:e.clientY,width:r.width,height:r.height,dir:e.target.dataset.dir||'move',pointer:e.pointerId};document.body.setPointerCapture(e.pointerId)}
 document.addEventListener('pointermove',e=>{if(!gesture||e.pointerId!==gesture.pointer)return;const g=gesture,v=items.find(v=>v.id===g.id),s=g.start;let dx=(e.clientX-g.x)/g.width*100,dy=(e.clientY-g.y)/g.height*100;
  if(g.dir==='move'){v.x=clamp(s.x+dx,0,100-s.w);v.y=clamp(s.y+dy,0,100-s.h)}else{
   const angle=s.rotation*Math.PI/180,px=e.clientX-g.x,py=e.clientY-g.y;dx=(px*Math.cos(angle)+py*Math.sin(angle))/g.width*100;dy=(-px*Math.sin(angle)+py*Math.cos(angle))/g.height*100;
   if(g.dir.includes('e'))v.w=clamp(s.w+dx,2,100-s.x);if(g.dir.includes('s'))v.h=clamp(s.h+dy,1,100-s.y);
   if(g.dir.includes('w')){v.x=clamp(s.x+dx,0,s.x+s.w-2);v.w=s.x+s.w-v.x}if(g.dir.includes('n')){v.y=clamp(s.y+dy,0,s.y+s.h-1);v.h=s.y+s.h-v.y}
  }const el=elements.get(v.id);Object.assign(el.style,{left:v.x+'%',top:v.y+'%',width:v.w+'%',height:v.h+'%'});
 });
 function finish(commit){if(!gesture)return;const g=gesture;gesture=null;if(commit&&snapshot()!==g.before){undo.push(g.before);redo=[];emit()}else if(!commit)items=JSON.parse(g.before);const changed=snapshot()!==g.before;if(document.body.hasPointerCapture(g.pointer))document.body.releasePointerCapture(g.pointer);if(changed||!commit)render()}
 document.addEventListener('pointerup',()=>finish(true));document.addEventListener('pointercancel',()=>finish(false));
 function keyboard(e,id){if(!enabled)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();if(e.key==='Enter'&&['text','bubble'].includes(items.find(v=>v.id===id)?.kind))beginInline(id);else choose(id);return}if(e.key==='Escape'){if(gesture)finish(false);else deselect();return}if(!e.key.startsWith('Arrow'))return;e.preventDefault();remember();const v=items.find(v=>v.id===id),step=e.shiftKey?3:.5,dir=e.target.dataset.dir;
  if(dir){if(['ArrowLeft','ArrowRight'].includes(e.key))v.w=clamp(v.w+(e.key==='ArrowRight'?step:-step),2,100-v.x);else v.h=clamp(v.h+(e.key==='ArrowDown'?step:-step),1,100-v.y)}else{v.x=clamp(v.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),0,100-v.w);v.y=clamp(v.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0),0,100-v.h)}emit();render();elements.get(id)?.focus()}
 bar.addEventListener('input',e=>{const field=e.target.dataset.field,v=items.find(v=>v.id===active);if(!field||!v)return;remember();v[field]=['text','color','textColor','align','font'].includes(field)?e.target.value:field==='fontSize'?clamp(Number(e.target.value)||24,10,120):Number(e.target.value);render();emit()});
 const dimensionMenu=document.createElement('details');dimensionMenu.style.position='relative';dimensionMenu.innerHTML='<summary style="cursor:pointer;padding:12px">Element size</summary><div style="position:absolute;right:0;top:100%;width:170px;max-height:240px;overflow:auto;display:grid;gap:6px;padding:10px;background:#f5efe4;border:1px solid #d9c9ac;border-radius:14px">'+[['small',20,14],['medium',35,24],['large',50,34]].map(([name,w,h])=>`<button data-element-size="${name}"><svg aria-hidden="true" width="64" height="42" viewBox="0 0 64 42"><rect x="1" y="1" width="62" height="40" rx="4" fill="#fffcf6" stroke="#d9c9ac"/><rect x="${32-w/2}" y="${21-h/2}" width="${w}" height="${h}" rx="3" fill="#b8985d"/></svg>${name[0].toUpperCase()+name.slice(1)}</button>`).join('')+'</div>';bar.append(dimensionMenu);
 dimensionMenu.addEventListener('click',e=>{const b=e.target.closest('[data-element-size]'),v=items.find(v=>v.id===active);if(!b||!v)return;endInline();remember();const dims={small:[20,14],medium:[35,24],large:[50,34]}[b.dataset.elementSize];v.w=dims[0];v.h=dims[1];v.x=clamp(v.x,0,100-v.w);v.y=clamp(v.y,0,100-v.h);dimensionMenu.open=false;render();emit()});
 bar.addEventListener('click',e=>{const act=e.target.closest('[data-act]')?.dataset.act,v=items.find(v=>v.id===active);if(!act||!v)return;if(act==='edit-text'){beginInline(v.id);return}if(act==='done'){deselect();return}remember();const i=items.indexOf(v);if(act==='bold'||act==='italic')v[act]=!v[act];if(act==='fit')v.fit=v.fit==='contain'?'cover':'contain';if(act==='duplicate'){const copy={...v,id:crypto.randomUUID(),x:clamp(v.x+3,0,100-v.w),y:clamp(v.y+3,0,100-v.h)};items.push(copy);active=copy.id}if(act==='delete'){items.splice(i,1);active=null}if(act==='front'&&i<items.length-1)[items[i],items[i+1]]=[items[i+1],items[i]];if(act==='back'&&i>0)[items[i],items[i-1]]=[items[i-1],items[i]];render();emit()});
 document.addEventListener('click',e=>{if(!e.target.closest('.local-shape,#shape-toolbar'))deselect()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&gesture)finish(false)});
 window.addEventListener('message',e=>{if(e.source!==parent)return;const d=e.data;
  if(d.type==='clear'){endInline();finish(true);deselect();}
  if(d.type==='capture-shared'){endInline();finish(true);}
  if(d.type==='restore-shapes'){if(gesture)finish(false);items=Array.isArray(d.shapes)?d.shapes.filter(clean).slice(0,100):[];render()}
  if(d.type==='mode'){enabled=d.editing;if(!enabled)active=null;render()}
  if((d.type==='add-shape'||d.type==='add-photo'&&safeImage(d.src))&&enabled&&kinds.includes(d.type==='add-photo'?'image':d.kind)){let section=selected?.closest('main section');if(!section)section=sections.find(s=>{const r=s.getBoundingClientRect();return r.bottom>innerHeight*.3&&r.top<innerHeight*.7})||sections[0];if(!section)return;remember();const v={id:crypto.randomUUID(),section:sections.indexOf(section),kind:d.type==='add-photo'?'image':d.kind,src:d.type==='add-photo'?d.src:undefined,x:35,y:30,w:30,h:d.kind==='line'?1:Math.min(30,180/section.clientHeight*100),color:'#a57d3d',opacity:100,rotation:0,text:d.type==='add-photo'?(d.name||'Photo').slice(0,300):''};v.h=Math.max(1,v.h);if(v.kind==='text'||v.kind==='bubble'){v.text=d.preset==='heading'?'Your heading':d.preset==='bubble'?'Your message':'Add your text here';v.fontSize=d.preset==='heading'?36:24;v.textColor='#132238';v.align='left';v.color='#eee8f6';v.w=50;v.x=25;v.h=Math.min(35,Math.max(8,140/section.clientHeight*100))}items.push(v);choose(v.id);elements.get(v.id).scrollIntoView({block:'center'});emit()}
  if(d.type==='shape-history'){const from=d.direction==='undo'?undo:redo,to=d.direction==='undo'?redo:undo;if(from.length){to.push(snapshot());items=JSON.parse(from.pop());active=null;render();emit()}}
 });
 send({type:'shapes-ready'});
})();

