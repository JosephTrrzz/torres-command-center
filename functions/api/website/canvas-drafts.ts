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
 const response=await fetch(rest+'/studio_canvas_drafts'+query+'&select=revision,draft,created_at&order=revision.desc&limit=1',{headers});
 if(!response.ok) return authJson({error:'Website drafts could not be loaded.'},503);
 const [previous]=await response.json();
 if(request.method==='GET') return authJson({clientId:access.clientId,name:site.name,snapshotId:manifest.id,revision:previous?.revision??0,draft:previous?.draft??{}});
 if(!request.headers.get('content-type')?.startsWith('application/json')) return authJson({error:'Send a JSON draft.'},415);
 const text=await request.text();
 if(new TextEncoder().encode(text).length>CANVAS_DRAFT_LIMIT+1000) return authJson({error:'This draft is too large. Use smaller images.'},413);
 let body;try{body=JSON.parse(text)}catch{return authJson({error:'Invalid draft.'},400)}
 if(!body || Object.keys(body).some(k=>!['snapshotId','revision','draft'].includes(k)) || body.snapshotId!==manifest.id || !Number.isSafeInteger(body.revision) || body.revision<0 || body.revision>=2147483647) return authJson({error:'Invalid draft version.'},400);
 const issue=canvasDraftIssue(body.draft);if(issue) return authJson({error:issue},400);
 if(body.revision!==(previous?.revision??0)) return authJson({error:'Someone saved a newer draft. Your changes are still open; reload before saving again.'},409);
 // Unique revision key arbitrates concurrent saves after the optimistic read.
 const saved=await fetch(rest+'/studio_canvas_drafts?select=revision,created_at',{method:'POST',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({client_id:access.clientId,snapshot_id:manifest.id,revision:body.revision+1,draft:body.draft,actor_id:access.context.userId})});
 if(!saved.ok) return authJson({error:saved.status===409?'Someone saved first. Your changes are still open.':'The draft could not be saved. Keep this page open.'},saved.status===409?409:503);
 return authJson((await saved.json())[0]);
}
