import { authJson, type FunctionEnv } from '../../_shared/auth';
import { studioAccess, studioStore } from '../../_shared/studio-access';
import { canvasDraftIssue, CANVAS_DRAFT_LIMIT } from '../../../lib/canvas-draft';
import manifest from '../../../lib/canvas-manifest.json';

export async function onRequest({request,env}:{request:Request;env:FunctionEnv}) {
 const access = await studioAccess(request,env);
 if ('response' in access) return access.response;
 if (!['GET','POST'].includes(request.method)) return authJson({error:'Unsupported method.'},405);
 const {rest,headers}=studioStore(env);
 const scope='?client_id=eq.'+access.clientId;
 const siteResponse=await fetch(rest+'/studio_sites'+scope+'&enabled=eq.true&select=name,public_url,canvas_snapshot_id&limit=1',{headers});
 if (!siteResponse.ok) return authJson({error:'Website draft storage is not configured yet.'},503);
 const [site]=await siteResponse.json();
 if (!site || site.canvas_snapshot_id!==manifest.id || site.public_url?.replace(/\/$/,'')!==manifest.source) return authJson({error:'This website has not been connected to the visual editor.'},403);
 const query=scope+'&snapshot_id=eq.'+manifest.id;
 const url=new URL(request.url);
 if(request.method==='GET' && (url.searchParams.has('history')||url.searchParams.has('version'))){
  const list=await fetch(rest+'/studio_canvas_drafts'+query+'&is_checkpoint=eq.true&select=revision,created_at&order=revision.desc&limit=6',{headers});
  if(!list.ok)return authJson({error:'Saved draft history is unavailable. Please try again.'},503);
  const versions=await list.json();
  if(url.searchParams.has('version')){
   const raw=url.searchParams.get('version')||'';const revision=Number(raw);
   if(!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(revision))return authJson({error:'Invalid saved draft.'},400);
   if(!versions.some((v:{revision:number})=>v.revision===revision))return authJson({error:'This saved draft is no longer in the latest six.'},404);
   const snapshot=await fetch(rest+'/studio_canvas_drafts'+query+'&revision=eq.'+revision+'&is_checkpoint=eq.true&select=revision,draft,created_at&limit=1',{headers});
   if(!snapshot.ok)return authJson({error:'The saved draft could not be loaded.'},503);
   const [version]=await snapshot.json();if(!version)return authJson({error:'Saved draft not found.'},404);
   return authJson(version);
  }
  return authJson({versions});
 }
 const response=await fetch(rest+'/studio_canvas_drafts'+query+'&select=revision,draft,created_at&order=revision.desc&limit=1',{headers});
 if(!response.ok) return authJson({error:'Website drafts could not be loaded.'},503);
 const [previous]=await response.json();
 if(request.method==='GET') return authJson({clientId:access.clientId,name:site.name,snapshotId:manifest.id,revision:previous?.revision??0,draft:previous?.draft??{}});
 if(!request.headers.get('content-type')?.startsWith('application/json')) return authJson({error:'Send a JSON draft.'},415);
 const text=await request.text();
 if(new TextEncoder().encode(text).length>CANVAS_DRAFT_LIMIT+1000) return authJson({error:'This draft is too large. Use smaller images.'},413);
 let body;try{body=JSON.parse(text)}catch{return authJson({error:'Invalid draft.'},400)}
 if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['snapshotId','revision','draft','checkpoint'].includes(k)) || (body.checkpoint!==undefined&&typeof body.checkpoint!=='boolean') || body.snapshotId!==manifest.id || !Number.isSafeInteger(body.revision) || body.revision<0 || body.revision>=2147483647) return authJson({error:'Invalid draft version.'},400);
 const issue=canvasDraftIssue(body.draft);if(issue) return authJson({error:issue},400);
 if(body.revision!==(previous?.revision??0)) return authJson({error:'Someone saved a newer draft. Your changes are still open; reload before saving again.'},409);
 // Unique revision key arbitrates concurrent saves after the optimistic read.
 const saved=await fetch(rest+'/studio_canvas_drafts?select=revision,created_at',{method:'POST',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({client_id:access.clientId,snapshot_id:manifest.id,revision:body.revision+1,draft:body.draft,actor_id:access.context.userId,is_checkpoint:body.checkpoint===true})});
 if(!saved.ok) return authJson({error:saved.status===409?'Someone saved first. Your changes are still open.':'The draft could not be saved. Keep this page open.'},saved.status===409?409:503);
 return authJson((await saved.json())[0]);
}
