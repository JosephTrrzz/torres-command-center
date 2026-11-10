// Same-origin trusted shell bridge; the editable canvas never receives credentials.
(()=>{
 if(!new URLSearchParams(location.search).has('connected'))return;
 const pending=new Map();let connected=false,inflight=null,blocked=false,lastSaved='{}';
 const request=(type,values={})=>new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID();
  const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('The connection timed out. Your changes are still open.'))},type.startsWith('canvas-publish')?60000:20000);
  pending.set(requestId,{resolve,reject,timer});parent.postMessage({type,requestId,...values},location.origin);
 });
 addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='canvas-result')return;const p=pending.get(e.data.requestId);if(!p)return;pending.delete(e.data.requestId);clearTimeout(p.timer);if(e.data.error)p.reject(Object.assign(Error(e.data.error),{status:e.data.status}));else p.resolve(e.data.result)});
 let revision=0;
 function saveError(error){
  blocked=[401,403,409].includes(error.status);
  status.textContent=error.message+(blocked?' Keep this tab open and copy any unsaved work before signing in or reloading.':' Your changes are still open. Click Save draft to retry.');
 }
 // Reconnect only retries the current private draft, never creates a checkpoint or publishes.
 addEventListener('online',()=>{if(connected&&dirty&&!blocked&&!checkpointBusy)void saveCloud();});
 async function saveCloud(){
  if(!connected||blocked)return false;
  if(inflight){await inflight;return dirty?saveCloud():!blocked;}
  const captured=JSON.stringify(drafts);if(captured===lastSaved){dirty=false;return true;}
  status.textContent='Saving private draft…';
  inflight=request('canvas-save',{revision,draft:JSON.parse(captured)}).then(result=>{
   revision=result.revision;lastSaved=captured;dirty=JSON.stringify(drafts)!==captured;
   status.textContent=dirty?'Saving your latest changes…':'Saved to your account · Nothing was published.';return true;
  }).catch(error=>{dirty=true;saveError(error);return false;}).finally(()=>{inflight=null});
  const ok=await inflight;if(ok&&dirty)return saveCloud();return ok;
 }
 persistDraft=function(){if(!connected)return false;if(JSON.stringify(drafts)===lastSaved){dirty=false;return true;}void saveCloud();return false;};
 const markChanged=changed;changed=function(){markChanged();if(typeof publishButton!=='undefined'){publishButton.textContent='Push to live site';}status.textContent='Saving private draft… · Your live website is unchanged.';};
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
  catch(error){saveError(error);}
  finally{checkpointBusy=false;workspace.inert=false;buttons();}
 };
 async function restoreVersion(version){
  if(checkpointBusy||blocked)return;checkpointBusy=true;buttons();list.inert=true;workspace.inert=true;
  historyStatus.textContent='Restoring saved draft…';
  try{
   if(!await captureDraft())throw Error('Your current changes could not be saved. Please retry.');
   const saved=await request('canvas-version',{revision:version.revision});
   await checkpoint(saved.draft);
   drafts=saved.draft;dirty=false;clearTimeout(saveTimer);canvasReady=false;
   window.dispatchEvent(new Event('canvas-draft-loaded'));loadPage(active);
   status.textContent='Restored draft from '+dateFormat.format(new Date(version.created_at))+' · Nothing was published.';
   $('#panel-close').click();
  }catch(error){saveError(error);historyStatus.textContent=status.textContent;}
  finally{checkpointBusy=false;list.inert=false;workspace.inert=false;buttons();}
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

 // Publishing always starts from a saved account revision; it never sends canvas HTML.
 const publishButton=document.createElement('button');publishButton.type='button';publishButton.id='publish-site';publishButton.className='primary';publishButton.textContent='Push to live site';
 $('#save').classList.remove('primary');$('#save').after(publishButton);
 const publishDialog=document.createElement('dialog');publishDialog.className='publish-review';publishDialog.setAttribute('aria-labelledby','publish-title');
 publishDialog.innerHTML='<h2 id="publish-title">Publish your website</h2><p data-publish-target></p><p data-publish-version></p><p data-publish-message role="status" aria-live="polite"></p><p class="publish-note">Only the reviewed saved revision is published. Later edits stay private. To reverse a change, restore a saved draft and publish it as a new version.</p><div class="publish-actions"><button type="button" data-publish-close>Cancel</button><button type="button" data-publish-check hidden>Check status</button><button type="button" data-publish-confirm class="primary" disabled>Push to live site</button><a data-publish-link hidden target="_blank" rel="noopener noreferrer">Open live site</a></div>';
 document.body.append(publishDialog);
 const publishMessage=publishDialog.querySelector('[data-publish-message]'),publishVersion=publishDialog.querySelector('[data-publish-version]'),publishConfirm=publishDialog.querySelector('[data-publish-confirm]'),publishCheck=publishDialog.querySelector('[data-publish-check]'),publishClose=publishDialog.querySelector('[data-publish-close]'),publishLink=publishDialog.querySelector('[data-publish-link]');
 let publication=null,publishBusy=false,publishTimer=null,reviewRevision=null,publishReady=false,requestKey=null;
 function publishState(message){
  const active=publication&&['queued','deploying','verifying'].includes(publication.status);
  const same=publication?.revision===revision&&!dirty;
  publishButton.textContent=active?'Publishing…':publication?.status==='live'&&same?'Now Live':'Push to live site';
  publishButton.setAttribute('aria-busy',active?'true':'false');
  publishConfirm.hidden=Boolean(active)||publication?.status==='live'&&same;
  publishConfirm.disabled=!publishReady||publishBusy||reviewRevision!==revision;
  publishClose.textContent=active||publication?.status==='live'?'Close':'Cancel';
  publishCheck.hidden=!active;publishCheck.disabled=publishBusy;
  publishLink.hidden=publication?.status!=='live';
  const labels={queued:'Publication queued.',deploying:'Building and deploying your saved draft…',verifying:'Deployment complete. Checking the live pages…',live:'Now Live',failed:'Publishing failed. Your draft is still saved. Review the draft and save a new version before retrying.'};
  publishMessage.textContent=message||(publication?labels[publication.status]:'Review the site and saved version, then push it live.');
  if(publication?.status==='live'&&same){status.textContent='Now Live · Published '+dateFormat.format(new Date(publication.verifiedAt));}
 }
 function schedulePublishCheck(){clearTimeout(publishTimer);if(publication&&['queued','deploying','verifying'].includes(publication.status))publishTimer=setTimeout(checkPublication,30000);}
 async function checkPublication(){
  if(!publication||publishBusy||document.hidden){schedulePublishCheck();return;}
  publishBusy=true;publishState();
  try{const result=await request('canvas-publish-check',{id:publication.id});publication=result.publication;publishState(result.message);}
  catch(error){publishState(error.message);}
  finally{publishBusy=false;publishCheck.disabled=false;schedulePublishCheck();}
 }
 publishCheck.onclick=checkPublication;
 publishClose.onclick=()=>publishDialog.close();
 publishDialog.addEventListener('close',()=>{if(!publishBusy)workspace.inert=false;publishButton.focus();});
 publishDialog.addEventListener('cancel',e=>{if(publishBusy)e.preventDefault();});
 publishButton.onclick=async()=>{
  if(!connected||publishBusy||checkpointBusy)return;
  publishDialog.showModal();workspace.inert=true;publishReady=false;reviewRevision=null;publishConfirm.disabled=true;publishMessage.textContent='Checking your saved draft and publishing connection…';
  try {
   if(!await captureDraft())throw Error('Save your current changes before publishing.');
   const info=await request('canvas-publish-status');publishReady=info.ready;publication=info.publication;
   publishDialog.querySelector('[data-publish-target]').textContent=info.name+' · '+info.publicUrl;
   publishLink.href=info.publicUrl;reviewRevision=revision;requestKey=crypto.randomUUID();
   publishVersion.textContent='Saved draft · Version '+revision;
   publishState(info.ready?undefined:info.message);schedulePublishCheck();
  }catch(error){publishState(error.message);}
 };
 publishConfirm.onclick=async()=>{
  if(!publishReady||publishBusy||reviewRevision!==revision)return;
  publishBusy=true;publishClose.disabled=true;publishState('Submitting your saved draft…');
  try{
   const result=await request('canvas-publish',{revision:reviewRevision,requestKey});publication=result.publication;
   publishState(result.message);schedulePublishCheck();
  }catch(error){publishState(error.message+' Check status before trying again.');}
  finally{publishBusy=false;publishClose.disabled=false;publishState(publishMessage.textContent);}
 };
 addEventListener('visibilitychange',()=>{if(!document.hidden)schedulePublishCheck();});
 addEventListener('pagehide',()=>clearTimeout(publishTimer));
 const workspace=document.querySelector('.workspace');workspace.inert=true;status.textContent='Connecting to your account…';
 request('canvas-load').then(info=>{
  drafts=info.draft;revision=info.revision;lastSaved=JSON.stringify(drafts);dirty=false;connected=true;
  if(pages.length)loadPage(0);
  workspace.inert=false;window.dispatchEvent(new Event('canvas-draft-loaded'));
  status.textContent='Private draft loaded · Edits save to your account.';
  request('canvas-publish-status').then(info=>{publication=info.publication;publishReady=info.ready;publishLink.href=info.publicUrl;publishState();schedulePublishCheck();}).catch(()=>{});
 }).catch(error=>{status.textContent=error.message;});
})();
