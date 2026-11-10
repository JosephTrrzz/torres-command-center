// Shared, scoped menu behavior for local editor controls only.
(()=>{
 const scope='#inspector, #button-presets, #shape-toolbar, #context-tools, .local-image-bar, .local-crop-bar';
 const menus=()=>[...document.querySelectorAll('details[open]')].filter(el=>el.closest(scope));
 function close(menu,focus=false){menu.open=false;if(focus)menu.querySelector('summary')?.focus()}
 document.addEventListener('toggle',e=>{if(e.target.matches?.('details')&&e.target.open&&e.target.closest(scope))for(const menu of menus())if(menu!==e.target)close(menu)},true);
 document.addEventListener('pointerdown',e=>{for(const menu of menus())if(!menu.contains(e.target))close(menu)},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menus().length){e.stopImmediatePropagation();e.preventDefault();close(menus().at(-1),true)}},true);
 // The swatch reflects the selected value, including an honest transparent state.
 const colorContext=document.createElement('canvas').getContext('2d');
 function hex(value){
  if(!value||!CSS.supports('color',value))return null;
  colorContext.fillStyle='#000000';colorContext.fillStyle=value;
  const normalized=colorContext.fillStyle;
  if(/^#[a-f0-9]{6}$/i.test(normalized))return normalized;
  if(/^#[a-f0-9]{3}$/i.test(normalized))return '#'+[...normalized.slice(1)].map(c=>c+c).join('');
  const parts=normalized.match(/[\d.]+/g);if(!parts||parts.length<3)return null;
  if(parts.length===4&&Number(parts[3])===0)return null;
  return '#'+parts.slice(0,3).map(n=>Math.round(Number(n)).toString(16).padStart(2,'0')).join('');
 }
 function colors(){for(const input of document.querySelectorAll('input[type=color]')){
  if(!input.closest(scope+',#section-controls'))continue;
  let wrap=input.closest('.color-wheel,.section-color,.studio-color');
  if(!wrap){wrap=document.createElement('span');wrap.className='studio-color';input.before(wrap);wrap.append(input)}
  const transparent=input.dataset.transparent==='true';
  wrap.style.background=transparent?'repeating-conic-gradient(#fff 0% 25%,#ddd 0% 50%) 50% / 12px 12px':input.value;
  wrap.style.boxShadow='inset 0 0 0 1px rgba(73,59,40,.25)';
  wrap.title=(input.getAttribute('aria-label')||'Change color')+' · '+(transparent?'Transparent':input.value.toUpperCase());
 }}
 window.StudioColor={sync:colors,set(input,value){const color=hex(value);input.value=color||'#ffffff';input.dataset.transparent=String(!color);colors()}};
 document.addEventListener('input',e=>{if(e.target.matches('input[type=color]')){delete e.target.dataset.transparent;colors()}},true);
 addEventListener('message',()=>requestAnimationFrame(colors));
 addEventListener('studio-colors',colors);
 colors();new MutationObserver(colors).observe(document.body,{childList:true,subtree:true});
 // Parent chrome clicks dismiss canvas selection without intercepting editing fields.
 if(document.body.classList.contains('studio-shell'))document.addEventListener('pointerdown',e=>{
  if(e.target.closest('#inspector,#context-tools,#button-presets,#canvas'))return;
  for(const id of ['inspector','context-tools','button-presets']){const el=document.getElementById(id);if(el)el.hidden=true;}
  document.getElementById('canvas')?.contentWindow.postMessage({type:'clear'},'*');
 },true);
 const style=document.createElement('link');style.rel='stylesheet';style.href='/website-preview/editor-chrome.css?v=1';document.head.append(style);
})();

// Keep native text undo inside fields; canvas shortcuts use the site timeline.
if(!document.body.classList.contains('studio-shell')){
 document.addEventListener('pointerdown',()=>parent.postMessage({type:'history-boundary',epoch:Number(new URLSearchParams(location.search).get('studioEpoch')),page:location.pathname.split('/').pop().replace(/\.html$/, '')+'.html'},'*'),true);
 document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.key.toLowerCase()==='z'&&!e.target.closest('input,textarea,[contenteditable=true]')){e.preventDefault();parent.postMessage({type:'history-request',epoch:Number(new URLSearchParams(location.search).get('studioEpoch')),page:location.pathname.split('/').pop().replace(/\.html$/, '')+'.html',direction:e.shiftKey?'redo':'undo'},'*');}});
}
