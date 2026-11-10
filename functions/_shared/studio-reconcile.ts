import { studioStore } from './studio-access';
import { canvasDraftIssue } from '../../lib/canvas-draft';
import { publicationDraftIssue } from './studio-publication-draft';
import manifest from '../../lib/canvas-manifest.json';
import { contentHash, matchingReceipt, publicPublication, publisherCall, PublisherNotFound, type Publication, type PublishingEnv, verifyLivePages } from './studio-publisher';

// Called only after own-site authorization or by the private scheduler.
// A lease is fenced on every update, so an expired worker cannot commit stale state.
export async function reconcilePublication(env: PublishingEnv, initial: Publication) {
 let release=initial;
 const {rest,headers}=studioStore(env),scope='client_id=eq.'+release.client_id;
 const read=async(path:string)=>{const r=await fetch(rest+path,{headers,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Publishing records are unavailable.');return r.json();};
 if(!env.STUDIO_PUBLISHER)throw Error('Publishing connection is unavailable.');
  if(['live','failed'].includes(release.status))return ({publication:publicPublication(release)});
  // Atomic short lease prevents rapid polls and concurrent tabs from duplicating work.
  const now=new Date().toISOString();
  const leaseUntil=new Date(Date.now()+90000).toISOString();
  const lease=await fetch(rest+'/studio_publications?'+scope+'&id=eq.'+release.id+'&next_check_at=lte.'+encodeURIComponent(now)+'&status=in.(queued,deploying,verifying)',{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({next_check_at:leaseUntil})});
  if(!lease.ok)throw Error('Publishing status could not be checked. Please retry.');
  const [claimed]=await lease.json();
  if(!claimed)return ({publication:publicPublication(release),retryAfter:30});
  release=claimed;
  const update=async(values:Partial<Publication>)=>{
   const r=await fetch(rest+'/studio_publications?'+scope+'&id=eq.'+release.id+'&status=eq.'+release.status+'&next_check_at=eq.'+encodeURIComponent(leaseUntil),{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify(values)});
   if(!r.ok)throw Error('Publishing status could not be saved. Please check again.');
   const [saved]=await r.json();if(saved)release=saved;else throw Error('Publishing status changed. Please check again.');
  };
  try {
   let receipt;
   if(release.status==='queued' && release.content_hash){
    // Recover a lost dispatch acknowledgment before accessing draft storage.
    // Only a definitive not-found permits another idempotent dispatch attempt.
    try{receipt=await publisherCall(env.STUDIO_PUBLISHER,'/releases/'+release.id+'?client='+release.client_id);}
    catch(error){if(!(error instanceof PublisherNotFound))throw error;}
   }
   if(release.status==='queued' && !receipt){
    const [saved]=await read('/studio_canvas_drafts?'+scope+'&snapshot_id=eq.'+release.snapshot_id+'&revision=eq.'+release.revision+'&select=draft&limit=1');
    const issue=!saved ? 'The saved draft is unavailable.' : canvasDraftIssue(saved.draft) || publicationDraftIssue(saved.draft,release.snapshot_id);
    if(issue){
     // A hash is persisted before dispatch. Its presence means an earlier POST
     // might already be building, even if its acknowledgment was lost. Never
     // declare that release failed based on local validation alone.
     if(release.content_hash)throw Error('Awaiting confirmation of a previously dispatched release.');
     await update({status:'failed'});
     return ({publication:publicPublication(release),message:issue+' The live website was not changed.'});
    }
    const digest=await contentHash({snapshotId:release.snapshot_id,revision:release.revision,draft:saved.draft});
    if(release.content_hash && release.content_hash!==digest)throw Error('The saved release could not be verified.');
    if(!release.content_hash)await update({content_hash:digest});
    const payload={protocol:1,releaseId:release.id,clientId:release.client_id,snapshotId:release.snapshot_id,revision:release.revision,contentHash:digest,publicUrl:manifest.source,draft:saved.draft};
    // The binding must persist idempotency before acknowledging; retries reuse the exact release.
    receipt=await publisherCall(env.STUDIO_PUBLISHER,'/releases',payload);
   }else if(!receipt){
    // Observe the immutable deployment receipt even when draft storage is down.
    // A local read failure must never release the single-publication lock.
    receipt=await publisherCall(env.STUDIO_PUBLISHER,'/releases/'+release.id+'?client='+release.client_id);
   }
   if(!matchingReceipt(receipt,release))throw Error('The deployment could not be matched to this draft. Please check again.');
   if(receipt.status==='failed')await update({status:'failed',deployment_id:receipt.deploymentId});
   else if(receipt.status==='succeeded'){
    await update({status:'verifying',deployment_id:receipt.deploymentId});
    if(await verifyLivePages(release))await update({status:'live',verified_at:new Date().toISOString()});
   }else if(['queued','building','deploying'].includes(receipt.status)){
    if(release.status!=='verifying')await update({status:'deploying',deployment_id:receipt.deploymentId});
   }else throw Error('The publishing service returned an unrecognized status.');
   return ({publication:publicPublication(release),retryAfter:30});
  }catch{
   // Ambiguous network errors are never "failed" or "live"; reconcile the same ID.
   return ({publication:publicPublication(release),retryAfter:30,message:'Waiting for publishing confirmation. Your saved draft is safe; check again shortly.'});
  }
}
