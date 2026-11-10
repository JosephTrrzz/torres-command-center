import { reconcilePublication } from '../../_shared/studio-reconcile';
import { authJson } from '../../_shared/auth';
import { studioAccess, studioStore } from '../../_shared/studio-access';
import { trustedStudioRequest } from '../../_shared/studio-request';
import { STUDIO_CLOUDFLARE_TARGET, verifyStudioCloudflareCredential } from '../../_shared/studio-cloudflare';
import manifest from '../../../lib/canvas-manifest.json';
import { UUID, publicPublication, publisherReady, type Publication, type PublishingEnv } from '../../_shared/studio-publisher';

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
  if(request.method==='GET'){
   // Setup diagnostics are operator-only and consume the encrypted credential
   // server-side. A valid credential alone must never enable publication.
   const connection=!ready && access.staff && access.clientId===STUDIO_CLOUDFLARE_TARGET.client && env.STUDIO_CLOUDFLARE_API_TOKEN
    ? await verifyStudioCloudflareCredential(env.STUDIO_CLOUDFLARE_API_TOKEN) : undefined;
   return authJson({ready,message:ready?'Review your saved draft before making it public.':unavailable,
    publicUrl:manifest.source,name:site.name,publication:publicPublication(latest??null),connection});
  }
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
  return authJson(await reconcilePublication(env,release));
 }catch{return authJson({error:'Publishing is not available yet. Your private drafts are safe.'},503);}
}
