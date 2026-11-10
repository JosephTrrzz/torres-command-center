// One chronological history for the local site, including shared header/footer patches.
(()=>{
 let history=createDraftHistory(drafts);let pending=false,timer=null,busy=false,restoring=false,editPage=active,restoreTimer=null,restoreRequest=null;
 const undo=$('#undo-shape'),redo=$('#redo-shape');
 undo.textContent='Undo';redo.textContent='Redo';
 undo.title='Undo last edit (⌘/Ctrl Z)';redo.title='Redo last edit (⌘/Ctrl Shift Z)';
 undo.setAttribute('aria-keyshortcuts','Meta+Z Control+Z');redo.setAttribute('aria-keyshortcuts','Meta+Shift+Z Control+Shift+Z');
 function controls(){undo.disabled=busy||restoring||!history.canUndo&&!pending;redo.disabled=busy||restoring||!history.canRedo||pending;}
 function flush(){clearTimeout(timer);if(pending){history.record(drafts,editPage);pending=false;}controls();}
 const change=changed;changed=function(){change();if(restoring)return;pending=true;editPage=active;clearTimeout(timer);timer=setTimeout(flush,450);controls();};
 const open=openPage;openPage=async function(i){if(busy||restoring)return;if(!await captureDraft())return;flush();return open(i);};
 async function move(direction){
  if(busy||restoring||!canvasReady)return;
  busy=true;controls();
  try{
   if(!await captureDraft())return;
   flush();const entry=history.move(direction);if(!entry)return;
   const page=pages[entry.page]?entry.page:active;
   const structural=v=>Boolean(v?.$addedSections?.length||v?.$copies?.length);
   const inPlace=page===active&&!structural(drafts[active])&&!structural(entry.draft[active]);
   drafts=entry.draft;dirty=true;clearTimeout(saveTimer);const saved=persistDraft();
   restoring=true;canvasReady=false;closeInspector();
   for(const id of ['context-tools','button-presets'])$('#'+id).hidden=true;
   if(inPlace){
    restoreRequest=crypto.randomUUID();
    send({type:'history-apply',requestId:restoreRequest,edits:drafts[active]||{},shared:drafts.$shared||{},sharedContent:drafts.$sharedContent||{}});
    // Recover safely if an older cached preview does not acknowledge the update.
    restoreTimer=setTimeout(()=>{restoreRequest=null;loadPage(page)},1500);
   }else loadPage(page);
   if(saved)status.textContent=direction==='undo'?'Undoing last edit…':'Restoring edit…';
  }finally{busy=false;controls();}
 }
 undo.onclick=()=>move('undo');redo.onclick=()=>move('redo');
 // Remove competing one-tool undo controls; all edits use the same timeline.
 for(const el of [$('#section-undo'),$('#undo-section-main'),document.querySelector('#button-presets [data-undo]')])if(el){el.style.setProperty('display','none','important');el.onclick=()=>move('undo');}
 function shortcut(e){if(!(e.metaKey||e.ctrlKey)||e.altKey||e.key.toLowerCase()!=='z'||e.target.closest('input,textarea,[contenteditable=true]'))return;e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)move(e.shiftKey?'redo':'undo');}
 window.addEventListener('keydown',shortcut,true);
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('input,textarea'))flush();},true);
 addEventListener('message',e=>{
  if(e.source!==frame.contentWindow||e.origin!=='null'||e.data.page!==pages[active]?.file)return;
  if(e.data.type==='history-request')move(e.data.direction==='redo'?'redo':'undo');
  if(e.data.type==='history-boundary')flush();
  if(e.data.type==='history-applied'&&e.data.requestId===restoreRequest){clearTimeout(restoreTimer);restoreRequest=null;canvasReady=true;restoring=false;if(!dirty)status.textContent='Saved · Nothing was published.';controls();}
  if(e.data.type==='context-ready'){clearTimeout(restoreTimer);restoreRequest=null;if(restoring&&!dirty)status.textContent='Saved in this browser · Nothing was published.';restoring=false;controls();}
  if(e.data.type==='shapes-change')queueMicrotask(controls);
 });
 addEventListener('canvas-draft-loaded',()=>{history=createDraftHistory(drafts);pending=false;clearTimeout(timer);controls();});
 controls();
})();
