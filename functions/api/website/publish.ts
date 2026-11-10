import { authJson } from '../../_shared/auth';
import { studioAccess, studioStore } from '../../_shared/studio-access';
import { trustedStudioRequest } from '../../_shared/studio-request';
import { canvasDraftIssue } from '../../../lib/canvas-draft';
import manifest from '../../../lib/canvas-manifest.json';
import { UUID, contentHash, matchingReceipt, publicPublication, publisherCall, publisherReady, verifyLivePages, type Publication, type PublishingEnv } from '../../_shared/studio-publisher';

const unavailable='Live publishing is not connected yet. Your edits remain safely saved as private drafts.';
export async function onRequest({request,env}:{request:Request;env:PublishingEnv}):Promise<Response> {
 if(!trustedStudioRequest(request))return authJson({error:'This request is not allowed.'},403);
 const access=await studioAccess(request,env);if('response' in access)return access.response;
 if(!['GET','POST'].includes(request.method))return authJson({error:'Unsupported method.'},405);
 const {rest,headers}=studioStore(env),scope='client_id=eq.'+access.clientId;
 const read=async(path:string)=>{const r=await fetch(rest+path,{headers,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Publishing records are unavailable. Your private drafts are safe.');return r.json();};
 try {
  const [site]=await read('/studio_sites?'+scope+'&enabled=eq.true&select=name,public_url,canvas_snapshot_id,publishing_enabled&limit=1');
  if(!site || site.canvas_snapshot_id!==manifest.id || site.public_url?.replace(/\/$/,'')!==manifest.source)return authJson({error:'Publishing is unavailable for this website.'},403);
  const [latest]=await read('/studio_publications?'+scope+'&order=created_at.desc&limit=1');
  const ready=site.publishing_enabled===true && await publisherReady(env,access.clientId);
  if(request.method==='GET')return authJson({ready,message:ready?'Review your saved draft before making it public.':unavailable,publicUrl:manifest.source,name:site.name,publication:publicPublication(latest??null)});
  if(!ready || !env.STUDIO_PUBLISHER)return authJson({error:unavailable},503);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return authJson({error:'Send a JSON request.'},415);
  const text=await request.text();if(text.length>1024)return authJson({error:'Publishing request is too large.'},413);
  let body;try{body=JSON.parse(text)}catch{return authJson({error:'Invalid publishing request.'},400)}
  if(!body || typeof body!=='object' || Array.isArray(body))return authJson({error:'Invalid publishing request.'},400);
  let release:Publication;
  if(body.action==='begin') {
   if(Object.keys(body).some(k=>!['action','snapshotId','revision','requestKey'].includes(k)) || body.snapshotId!==manifest.id || !Number.isSafeInteger(body.revision) || body.revision<1 || body.revision>=2147483647 || typeof body.requestKey!=='string' || !UUID.test(body.requestKey))return authJson({error:'Save the draft before publishing.'},400);
   const response=await fetch(rest+'/rpc/studio_begin_publication',{method:'POST',headers,body:JSON.stringify({p_client:access.clientId,p_actor:access.context.userId,p_snapshot:manifest.id,p_revision:body.revision,p_key:body.requestKey})});
   if(!response.ok)return authJson({error:'A newer draft or another publication exists. Refresh the publishing status before trying again.'},409);
   const data=await response.json();release=Array.isArray(data)?data[0]:data;
  }else if(body.action==='check'){
   if(Object.keys(body).some(k=>!['action','id'].includes(k)) || typeof body.id!=='string' || !UUID.test(body.id))return authJson({error:'Invalid publication.'},400);
   [release]=await read('/studio_publications?'+scope+'&id=eq.'+body.id+'&limit=1');
   if(!release)return authJson({error:'Publication not found.'},404);
  }else return authJson({error:'Unsupported publishing action.'},400);
  if(['live','failed'].includes(release.status))return authJson({publication:publicPublication(release)});
  // Atomic short lease prevents rapid polls and concurrent tabs from duplicating work.
  const now=new Date().toISOString();
  const lease=await fetch(rest+'/studio_publications?'+scope+'&id=eq.'+release.id+'&next_check_at=lte.'+encodeURIComponent(now)+'&status=in.(queued,deploying,verifying)',{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({next_check_at:new Date(Date.now()+90000).toISOString()})});
  if(!lease.ok)throw Error('Publishing status could not be checked. Please retry.');
  if(!(await lease.json()).length)return authJson({publication:publicPublication(release),retryAfter:30});
  const update=async(values:Partial<Publication>)=>{
   const r=await fetch(rest+'/studio_publications?'+scope+'&id=eq.'+release.id+'&status=eq.'+release.status,{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify(values)});
   if(!r.ok)throw Error('Publishing status could not be saved. Please check again.');
   const [saved]=await r.json();if(saved)release=saved;else throw Error('Publishing status changed. Please check again.');
  };
  try {
   const [saved]=await read('/studio_canvas_drafts?'+scope+'&snapshot_id=eq.'+release.snapshot_id+'&revision=eq.'+release.revision+'&select=draft&limit=1');
   if(!saved || canvasDraftIssue(saved.draft)){await update({status:'failed'});return authJson({publication:publicPublication(release),message:'This draft could not be validated. The live website was not changed.'});}
   const digest=await contentHash({snapshotId:release.snapshot_id,revision:release.revision,draft:saved.draft});
   if(release.content_hash && release.content_hash!==digest)throw Error('The saved release could not be verified.');
   if(!release.content_hash)await update({content_hash:digest});
   const payload={protocol:1,releaseId:release.id,clientId:access.clientId,snapshotId:release.snapshot_id,revision:release.revision,contentHash:digest,publicUrl:manifest.source,draft:saved.draft};
   // The binding must persist idempotency before acknowledging; retries reuse the exact release.
   const receipt=release.status==='queued' ? await publisherCall(env.STUDIO_PUBLISHER,'/releases',payload) : await publisherCall(env.STUDIO_PUBLISHER,'/releases/'+release.id+'?client='+access.clientId);
   if(!matchingReceipt(receipt,release))throw Error('The deployment could not be matched to this draft. Please check again.');
   if(receipt.status==='failed')await update({status:'failed',deployment_id:receipt.deploymentId});
   else if(receipt.status==='succeeded'){
    await update({status:'verifying',deployment_id:receipt.deploymentId});
    if(await verifyLivePages(release))await update({status:'live',verified_at:new Date().toISOString()});
   }else if(['queued','building','deploying'].includes(receipt.status)){
    if(release.status!=='verifying')await update({status:'deploying',deployment_id:receipt.deploymentId});
   }else throw Error('The publishing service returned an unrecognized status.');
   return authJson({publication:publicPublication(release),retryAfter:30});
  }catch{
   // Ambiguous network errors are never "failed" or "live"; reconcile the same ID.
   return authJson({publication:publicPublication(release),retryAfter:30,message:'Waiting for publishing confirmation. Your saved draft is safe; check again shortly.'});
  }
 }catch{return authJson({error:'Publishing is not available yet. Your private drafts are safe.'},503);}
}
