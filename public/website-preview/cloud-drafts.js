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
 const workspace=document.querySelector('.workspace');workspace.inert=true;status.textContent='Connecting to your account…';
 request('canvas-load').then(info=>{
  drafts=info.draft;revision=info.revision;lastSaved=JSON.stringify(drafts);dirty=false;connected=true;
  if(pages.length)loadPage(0);
  workspace.inert=false;window.dispatchEvent(new Event('canvas-draft-loaded'));
  status.textContent='Private draft loaded · Edits save to your account.';
 }).catch(error=>{status.textContent=error.message;});
})();
