// Same-origin trusted shell bridge; the editable canvas never receives credentials.
(()=>{
 if(!new URLSearchParams(location.search).has('connected'))return;
 const pending=new Map();let connected=false,inflight=null,blocked=false,lastSaved='{}';
 const request=(type,values={})=>new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID();
  const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('The connection timed out. Your changes are still open.'))},20000);
  pending.set(requestId,{resolve,reject,timer});parent.postMessage({type,requestId,...values},location.origin);
 });
 addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='canvas-result')return;const p=pending.get(e.data.requestId);if(!p)return;pending.delete(e.data.requestId);clearTimeout(p.timer);if(e.data.error)p.reject(Object.assign(Error(e.data.error),{status:e.data.status}));else p.resolve(e.data.result)});
 let revision=0;
 async function saveCloud(){
  if(!connected||blocked)return false;
  if(inflight){await inflight;return dirty?saveCloud():!blocked;}
  const captured=JSON.stringify(drafts);if(captured===lastSaved){dirty=false;return true;}
  status.textContent='Saving private draft…';
  inflight=request('canvas-save',{revision,draft:JSON.parse(captured)}).then(result=>{
   revision=result.revision;lastSaved=captured;dirty=JSON.stringify(drafts)!==captured;
   status.textContent=dirty?'Saving your latest changes…':'Saved to your account · Nothing was published.';return true;
  }).catch(error=>{dirty=true;blocked=error.status===409||error.status===401||error.status===403;status.textContent=error.message;return false;}).finally(()=>{inflight=null});
  const ok=await inflight;if(ok&&dirty)return saveCloud();return ok;
 }
 persistDraft=function(){if(!connected)return false;if(JSON.stringify(drafts)===lastSaved){dirty=false;return true;}void saveCloud();return false;};
 const markChanged=changed;changed=function(){markChanged();status.textContent='Saving private draft… · Your live website is unchanged.';};
 const capture=captureDraft;captureDraft=async function(){if(!connected)return false;if(!await capture())return false;return await saveCloud();};
 document.querySelector('header small').textContent='PRIVATE DRAFT · Live website unchanged';
 document.querySelector('.rail-footer').textContent='WEBSITE STUDIO';
 $('#save').textContent='Save draft';
 // Saved checkpoints are explicit actions, independent of the in-session Undo timeline.
 const historyButton=$('#saved-drafts');historyButton.hidden=false;
 const historyDialog=$('#saved-drafts-panel');
 const historyStatus=historyDialog.querySelector('[data-history-status]'),list=historyDialog.querySelector('[data-versions]');
 const dateFormat=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'medium'});
 let checkpointBusy=false;
 const buttons=()=>{$('#save').disabled=checkpointBusy;historyButton.disabled=checkpointBusy;};
 async function checkpoint(draft){
  const captured=JSON.stringify(draft);
  const result=await request('canvas-save',{revision,draft:JSON.parse(captured),checkpoint:true});
  revision=result.revision;lastSaved=captured;return result;
 }
 $('#save').onclick=async()=>{
  if(checkpointBusy||!connected||blocked)return;
  checkpointBusy=true;buttons();workspace.inert=true;
  try{if(!await captureDraft())return;clearTimeout(saveTimer);const result=await checkpoint(drafts);dirty=false;status.textContent='Draft saved · '+dateFormat.format(new Date(result.created_at))+' · Nothing was published.';}
  catch(error){status.textContent=error.message;}
  finally{checkpointBusy=false;workspace.inert=false;buttons();}
 };
 async function restoreVersion(version){
  if(checkpointBusy)return;checkpointBusy=true;buttons();list.inert=true;
  historyStatus.textContent='Restoring saved draft…';
  try{
   if(!await captureDraft())throw Error('Your current changes could not be saved. Please retry.');
   const saved=await request('canvas-version',{revision:version.revision});
   await checkpoint(saved.draft);
   drafts=saved.draft;dirty=false;clearTimeout(saveTimer);canvasReady=false;
   window.dispatchEvent(new Event('canvas-draft-loaded'));loadPage(active);
   status.textContent='Restored draft from '+dateFormat.format(new Date(version.created_at))+' · Nothing was published.';
   $('#panel-close').click();
  }catch(error){historyStatus.textContent=error.message;}
  finally{checkpointBusy=false;list.inert=false;buttons();}
 }
 historyButton.addEventListener('click',async()=>{
  if(checkpointBusy||!connected||historyDialog.hidden)return;
  list.replaceChildren();historyStatus.textContent='Loading saved drafts…';checkpointBusy=true;buttons();
  try{
   if(!await captureDraft())throw Error('Please wait for your current changes to save, then retry.');
   const result=await request('canvas-history');
   historyStatus.textContent=result.versions.length?'Times shown in '+Intl.DateTimeFormat().resolvedOptions().timeZone+'.':'No saved versions yet. Click Save draft to create your first one.';
   for(const version of result.versions.slice(0,6)){
    const row=document.createElement('li'),label=document.createElement('time'),action=document.createElement('button');
    label.dateTime=version.created_at;label.textContent=dateFormat.format(new Date(version.created_at));action.type='button';action.textContent='Restore';action.setAttribute('aria-label','Restore draft saved '+label.textContent);
    action.onclick=()=>{
     for(const other of list.querySelectorAll('[data-confirm]'))other.remove();
     const confirm=document.createElement('div');confirm.dataset.confirm='';const note=document.createElement('p');note.textContent='Restore this version as your current private draft? Your live website will stay unchanged.';
     const yes=document.createElement('button'),cancel=document.createElement('button');yes.type=cancel.type='button';yes.textContent='Restore draft';cancel.textContent='Cancel';yes.onclick=()=>restoreVersion(version);cancel.onclick=()=>{confirm.remove();action.focus()};confirm.append(note,yes,cancel);row.append(confirm);yes.focus();
    };row.append(label,action);list.append(row);
   }
  }catch(error){historyStatus.textContent=error.message;}
  finally{checkpointBusy=false;buttons();}
 });
 const workspace=document.querySelector('.workspace');workspace.inert=true;status.textContent='Connecting to your account…';
 request('canvas-load').then(info=>{
  drafts=info.draft;revision=info.revision;lastSaved=JSON.stringify(drafts);dirty=false;connected=true;
  if(pages.length)loadPage(0);
  workspace.inert=false;window.dispatchEvent(new Event('canvas-draft-loaded'));
  status.textContent='Private draft loaded · Edits save to your account.';
 }).catch(error=>{status.textContent=error.message;});
})();
