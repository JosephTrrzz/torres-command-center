
// Contextual content tools. Stable element paths keep shared chrome independent of page indices.
(()=>{
 const roots={header:document.querySelector('header'),footer:document.querySelector('footer'),page:document.querySelector('main')};
 const registry=new Map(), baseline=new Map();let target=null;
 const ignored=n=>n.closest('script,style,svg,form,#local-image-tools,#shape-toolbar,.local-shape');
 for(const [scope,root]of Object.entries(roots)){if(!root)continue;for(const n of [root,...root.querySelectorAll('*')]){if(ignored(n)||(scope==="page"&&n.closest("header,footer")))continue;let parts=[],el=n;while(el!==root){parts.unshift([...el.parentElement.children].indexOf(el));el=el.parentElement}const key=scope+':'+parts.join('.');registry.set(key,n);n.dataset.contextKey=key;baseline.set(key,{style:n.getAttribute('style'),text:n.children.length?null:n.textContent,href:n.getAttribute('href'),src:n.getAttribute('src'),srcset:n.getAttribute('srcset'),alt:n.getAttribute('alt')});}}
 function registerAdded(){for(const root of document.querySelectorAll('[data-local-added],[data-local-copy]')){const prefix='page:'+ (root.dataset.localAdded?'added-'+root.dataset.localAdded:'copy-'+root.dataset.localCopy);for(const n of [root,...root.querySelectorAll('*')]){if(ignored(n)||n.dataset.contextKey)continue;let parts=[],el=n;while(el!==root){parts.unshift([...el.parentElement.children].indexOf(el));el=el.parentElement}const key=prefix+':'+parts.join('.');registry.set(key,n);n.dataset.contextKey=key;}}}
 function describe(n){if(target&&target!==n)target.contentEditable='false';const key=n.dataset.contextKey;if(!key)return;target=n;if(selected)selected.removeAttribute('data-local-selected');selected=n;n.dataset.localSelected='';dispatchEvent(new Event('resize'));send({type:'context-selected',key,region:key.split(':')[0],button:n.hasAttribute('data-studio-button'),kind:n===roots.footer?'footer':n.tagName==='A'?'link':'text',text:n.textContent.trim(),href:n.getAttribute('href')||'',fontSize:parseFloat(getComputedStyle(n).fontSize)});}
 const safeURL=v=>typeof v==='string'&&(/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(v))&&!v.startsWith('//');
 function patch(n,v){if(typeof v.text==='string'&&v.text.length<=10000){if(!n.children.length)n.textContent=v.text;else{const t=[...n.childNodes].find(x=>x.nodeType===3&&x.textContent.trim());if(t)t.textContent=v.text;else{const leaf=[...n.querySelectorAll('span,strong,em')].find(el=>!el.children.length&&el.textContent.trim());if(leaf)leaf.textContent=v.text;}}}
 if(typeof v.href==='string'&&n.tagName==='A'&&safeURL(v.href))n.setAttribute('href',v.href);
 if(['Arial','Georgia','Verdana','system-ui'].includes(v.font))n.style.fontFamily=v.font;
 if(bounded(v.boxWidth,40,2400)){n.style.width=v.boxWidth+'px';n.style.maxWidth='100%';n.style.boxSizing='border-box'}
 if(bounded(v.boxHeight,24,2400)){n.style.minHeight=v.boxHeight+'px';n.style.height='auto';n.style.boxSizing='border-box'}
 if(bounded(v.fontSize,10,160))n.style.fontSize=v.fontSize+'px';
 if(typeof v.bold==='boolean')n.style.fontWeight=v.bold?'700':'400';if(typeof v.italic==='boolean')n.style.fontStyle=v.italic?'italic':'normal';
 if(/^#[0-9a-f]{6}$/i.test(v.color||''))n.style.color=v.color;
 if(/^#[0-9a-f]{6}$/i.test(v.background||''))n.style.backgroundColor=v.background;
 if(bounded(v.spacing,0,200)){n.style.paddingTop=v.spacing+'px';n.style.paddingBottom=v.spacing+'px';}}
 window.addEventListener('click',e=>{registerAdded();if(!editing||ignored(e.target)||e.target.closest('[id^="local-"],#section-picker,.local-section-resize'))return;const n=e.target.closest('[data-context-key]');if(!n)return;if(n.tagName==='IMG')return;if(n===roots.header){select('section',sections.indexOf(n));return;}if(n===roots.footer){describe(n);return;}const link=n.closest('a');if(link){e.preventDefault();e.stopImmediatePropagation();describe(link);return;}if((n.matches('h1,h2,h3,h4,h5,h6,p,li,span,strong,em,small,label,button')||(!n.children.length&&n.textContent.trim()))&&!n.querySelector('img,input,textarea,button,p,h1,h2,h3,li')){e.stopImmediatePropagation();describe(n);}},true);
 document.addEventListener('dblclick',e=>{if(!editing)return;const n=e.target.closest('[data-context-key]');if(n&&!ignored(n)&&!n.children.length&&!['IMG','HEADER','FOOTER','MAIN'].includes(n.tagName)){e.preventDefault();n.contentEditable='true';n.focus();describe(n);}});
 document.addEventListener('input',e=>{const n=e.target.closest('[data-context-key]');if(editing&&n&&!ignored(n))send({type:'context-change',key:n.dataset.contextKey,values:{text:n.textContent}})});
 addEventListener('message',e=>{if(e.source!==parent)return;const d=e.data;
 if(d.type==='context-button'){const n=registry.get(d.key);if(n?.hasAttribute('data-studio-button'))send({type:'button-selected',id:Number(n.dataset.studioButton)})}if(d.type==='context-apply'){registerAdded();for(const [key,v]of Object.entries(d.edits||{})){const n=registry.get(key);if(n)patch(n,v)}dispatchEvent(new Event('resize'));}
 if(d.type==='shared-restore'){for(const [key,v]of Object.entries(d.edits||{})){const n=registry.get(key);if(!n||key.startsWith('page:'))continue;for(const [a,value]of Object.entries(v)){if(a==='text'&&!n.children.length)n.textContent=value;else if(['style','src','srcset','alt','href'].includes(a)){if(a==='srcset'&&value!==null)continue;if(a==='href'&&value!==null&&!safeURL(value))continue;if(a==='src'&&!/^(https:\/\/|\/website-preview\/assets\/|assets\/|data:image\/(png|jpeg|webp);base64,)/.test(value||''))continue;if(a==='style'&&/expression|javascript|@import/i.test(value||''))continue;if(value===null)n.removeAttribute(a);else n.setAttribute(a,value)}}}dispatchEvent(new Event('resize'));}
 if(d.type==='capture-shared'){if(d.requestId)document.activeElement?.blur();const edits={};for(const [key,n]of registry){if(key.startsWith('page:'))continue;const base=baseline.get(key),v={};for(const a of ['style','href','src','srcset','alt']){const now=n.getAttribute(a);if(a==='style'||now!==base[a])v[a]=now}if(base.text!==null&&n.textContent!==base.text)v.text=n.textContent;if(Object.keys(v).length)edits[key]=v;}setTimeout(()=>send({type:'shared-captured',edits,requestId:d.requestId}),0);}
 });
 for(const root of [roots.header,roots.footer])for(const img of root?.querySelectorAll('img')||[]){if(!nodes.includes(img)){nodes.push(img);original.set(img,img.getAttribute('style'));bindEditable(img,nodes.length-1)}}
 const footer=roots.footer;if(footer){const b=document.createElement('button');b.textContent='Edit footer';b.id='local-edit-footer';b.type='button';Object.assign(b.style,{position:'absolute',right:'16px',top:'8px',zIndex:'100',background:'#f5efe4',color:'#493b28',border:'1px solid #b8985d',borderRadius:'999px',padding:'12px 18px'});if(getComputedStyle(footer).position==='static')footer.style.position='relative';footer.append(b);b.onclick=e=>{e.stopPropagation();describe(footer)};addEventListener('message',e=>{if(e.source===parent&&e.data.type==='mode')b.hidden=!e.data.editing});}
// One click selects the box; double-click (or Enter) edits its text.
 const textHandles=document.createElement('div');textHandles.id='local-text-handles';textHandles.hidden=true;document.body.append(textHandles);
 Object.assign(textHandles.style,{position:'fixed',zIndex:'2147483646',border:'2px solid #a57d3d',pointerEvents:'none',boxSizing:'border-box'});
 function positionText(){const n=target;const visible=editing&&n===selected&&n?.isConnected&&!n.isContentEditable&&!['IMG','HEADER','FOOTER','MAIN'].includes(n.tagName);textHandles.hidden=!visible;if(!visible)return;const r=n.getBoundingClientRect();Object.assign(textHandles.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});}
 let textDrag=null;
 for(const [dir,x,y]of [['e',100,50],['s',50,100],['se',100,100]]){
  const h=document.createElement('button');h.type='button';h.setAttribute('aria-label','Resize text '+({e:'width',s:'height',se:'box'}[dir]));h.title='Drag to resize text box; double-click the text to type';
  Object.assign(h.style,{position:'absolute',left:x+'%',top:y+'%',width:'24px',height:'24px',padding:'5px',border:'0',borderRadius:'50%',background:'#f5efe4',boxShadow:'inset 0 0 0 2px #a57d3d',transform:'translate(-50%,-50%)',pointerEvents:'auto',touchAction:'none',cursor:dir+'-resize'});textHandles.append(h);
  h.addEventListener('pointerdown',e=>{if(e.button!==0||!target)return;e.preventDefault();e.stopPropagation();const r=target.getBoundingClientRect();textDrag={n:target,key:target.dataset.contextKey,style:target.getAttribute('style'),dir,x:e.clientX,y:e.clientY,w:r.width,h:r.height,pointer:e.pointerId,handle:h};h.setPointerCapture(e.pointerId)});
  h.addEventListener('pointermove',e=>{const g=textDrag;if(!g||g.pointer!==e.pointerId)return;g.values={};if(g.dir.includes('e'))g.values.boxWidth=Math.max(40,Math.min(2400,g.w+e.clientX-g.x));if(g.dir.includes('s'))g.values.boxHeight=Math.max(24,Math.min(2400,g.h+e.clientY-g.y));patch(g.n,g.values);positionText()});
  const finish=commit=>{const g=textDrag;if(!g)return;textDrag=null;if(commit&&g.values)send({type:'context-change',key:g.key,values:g.values});else if(g.style===null)g.n.removeAttribute('style');else g.n.setAttribute('style',g.style);if(h.hasPointerCapture(g.pointer))h.releasePointerCapture(g.pointer);positionText()};
  h.addEventListener('pointerup',()=>finish(true));h.addEventListener('pointercancel',()=>finish(false));h.addEventListener('lostpointercapture',()=>finish(false));
  h.addEventListener('keydown',e=>{if(!e.key.startsWith('Arrow')||!target)return;e.preventDefault();const r=target.getBoundingClientRect(),step=e.shiftKey?20:4,values={};if(e.key==='ArrowLeft'||e.key==='ArrowRight')values.boxWidth=Math.max(40,Math.min(2400,r.width+(e.key==='ArrowRight'?step:-step)));else values.boxHeight=Math.max(24,Math.min(2400,r.height+(e.key==='ArrowDown'?step:-step)));patch(target,values);send({type:'context-change',key:target.dataset.contextKey,values});positionText()});
 }
 document.addEventListener('click',()=>requestAnimationFrame(positionText));document.addEventListener('dblclick',()=>requestAnimationFrame(positionText));
 document.addEventListener('keydown',e=>{if(e.key==='Enter'&&target===selected&&!target.isContentEditable&&e.target===target){e.preventDefault();target.contentEditable='true';target.focus();positionText()}if(e.key==='Escape'&&target){target.contentEditable='false';target.blur();positionText()}});
 document.addEventListener('focusout',e=>{if(e.target===target){target.contentEditable='false';requestAnimationFrame(positionText)}});
 document.addEventListener('pointerdown',e=>{if(target&&!target.contains(e.target)&&!e.target.closest('#local-text-handles'))target.contentEditable='false';});
 addEventListener('resize',positionText);addEventListener('scroll',positionText,true);
 addEventListener('message',e=>{if(e.source===parent&&['clear','mode'].includes(e.data?.type)){if(target)target.contentEditable='false';requestAnimationFrame(positionText)}});
 // Keep original nodes and listeners: history restores attributes, never replaces the document.
 const historyBase=[...registry.values()].map(n=>({n,attrs:Object.fromEntries(['style','hidden','href','src','srcset','alt'].map(a=>[a,n.getAttribute(a)])),text:n.children.length?null:n.textContent,textNodes:[...n.childNodes].filter(t=>t.nodeType===3).map(t=>[t,t.textContent])}));
 addEventListener('message',e=>{
  if(e.source!==parent||e.data?.type!=='history-apply')return;
  const d=e.data,x=scrollX,y=scrollY;
  dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'clear'}}));
  photoOffsets.clear();window.StudioAlignment?.clear();
  for(const {n,attrs,text,textNodes}of historyBase){
   for(const [a,v]of Object.entries(attrs))if(v===null)n.removeAttribute(a);else if(n.getAttribute(a)!==v)n.setAttribute(a,v);
   if(text!==null){if(n.textContent!==text)n.textContent=text;}else for(const [t,v]of textNodes)if(t.isConnected)t.textContent=v;
  }
  // Apply the whole snapshot in a single task, before the browser paints.
  for(const message of [
   {type:'restore-shapes',shapes:d.edits?.$shapes||[]},
   {type:'restore',edits:d.edits||{},sections:d.edits?.$sections||{}},
   {type:'shared-restore',edits:d.shared||{}},
   {type:'context-apply',edits:{...(d.edits?.$content||{}),...(d.sharedContent||{})}}
  ])dispatchEvent(new MessageEvent('message',{source:parent,data:message}));
  scrollTo(x,y);
  requestAnimationFrame(()=>send({type:'history-applied',requestId:d.requestId}));
 });
send({type:'context-ready'});
})();
