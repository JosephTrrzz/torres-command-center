// Shared, scoped menu behavior for local editor controls only.
(()=>{
 const scope='#inspector, #button-presets, #shape-toolbar, #context-tools, .local-image-bar, .local-crop-bar';
 const menus=()=>[...document.querySelectorAll('details[open]')].filter(el=>el.closest(scope));
 function close(menu,focus=false){menu.open=false;if(focus)menu.querySelector('summary')?.focus()}
 document.addEventListener('toggle',e=>{if(e.target.matches?.('details')&&e.target.open&&e.target.closest(scope))for(const menu of menus())if(menu!==e.target)close(menu)},true);
 document.addEventListener('pointerdown',e=>{for(const menu of menus())if(!menu.contains(e.target))close(menu)},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menus().length){e.stopImmediatePropagation();e.preventDefault();close(menus().at(-1),true)}},true);
 function colors(){for(const input of document.querySelectorAll('input[type=color]')){if(!input.closest(scope)||input.closest('.color-wheel,.section-color,.studio-color'))continue;const wrap=document.createElement('span');wrap.className='studio-color';input.before(wrap);wrap.append(input)}}
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
