import { authJson } from '../../_shared/auth';
import { studioStore } from '../../_shared/studio-access';
import { reconcilePublication } from '../../_shared/studio-reconcile';
import { publisherReady, type Publication, type PublishingEnv } from '../../_shared/studio-publisher';
import manifest from '../../../lib/canvas-manifest.json';

type Env = PublishingEnv & { STUDIO_CRON_SECRET?: string };

async function authorized(request: Request, env: Env) {
 const expected=env.STUDIO_CRON_SECRET || '';
 const supplied=request.headers.get('x-torres-studio-secret') || '';
 if(expected.length<32 || supplied.length<32 || supplied.length>512)return false;
 const hash=(value:string)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 const [a,b]=await Promise.all([hash(expected),hash(supplied)]);
 const left=new Uint8Array(a),right=new Uint8Array(b);let difference=0;
 for(let i=0;i<left.length;i++)difference|=left[i]^right[i];
 return difference===0;
}

// No browser session, client ID, draft, callback URL or release state is accepted.
// The scheduler only advances publications already authorized by a user.
export async function onRequest({request,env}:{request:Request;env:Env}) {
 if(request.method!=='POST')return authJson({error:'Unsupported method.'},405);
 if(!await authorized(request,env))return authJson({error:'Invalid scheduler credentials.'},401);
 if(!env.STUDIO_PUBLISHER || !env.SUPABASE_SERVICE_ROLE_KEY)return authJson({error:'Publishing connection is unavailable.'},503);
 const {rest,headers}=studioStore(env);
 try {
  const due=await fetch(rest+'/studio_publications?status=in.(queued,deploying,verifying)&next_check_at=lte.'+encodeURIComponent(new Date().toISOString())+'&order=next_check_at.asc&limit=3',{headers,signal:AbortSignal.timeout(8000)});
  if(!due.ok)throw Error('Publication ledger unavailable.');
  const releases:Publication[]=await due.json();
  const results=await Promise.all(releases.map(async release=>{
   try {
    const siteResponse=await fetch(rest+'/studio_sites?client_id=eq.'+release.client_id+'&select=public_url,canvas_snapshot_id,enabled,publishing_enabled&limit=1',{headers,signal:AbortSignal.timeout(8000)});
    if(!siteResponse.ok)return false;
    const [site]=await siteResponse.json();
    if(!site || site.public_url?.replace(/\/$/,'')!==manifest.source || site.canvas_snapshot_id!==release.snapshot_id || release.snapshot_id!==manifest.id)return false;
    // Disabling enrollment blocks new delivery. Already dispatched work must still
    // be observed; disabling a switch cannot cancel an in-flight provider job.
    if(release.status==='queued' && (!site.enabled || !site.publishing_enabled))return false;
    if(!await publisherReady(env,release.client_id))return false;
    await reconcilePublication(env,release);
    return true;
   }catch{return false;}
  }));
  return authJson({checked:results.filter(Boolean).length,deferred:results.filter(v=>!v).length});
 }catch{return authJson({error:'Publishing reconciliation is temporarily unavailable.'},503);}
}
