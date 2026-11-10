import type { FunctionEnv } from './auth';
import manifest from '../../lib/canvas-manifest.json';
import routes from '../../public/website-preview/pages.json';

// A private Cloudflare service binding; never a browser-supplied URL or credential.
export interface PublisherBinding { fetch(request: Request): Promise<Response> }
export interface PublishingEnv extends FunctionEnv { STUDIO_PUBLISHER?: PublisherBinding }
export type Publication = {
 id: string; client_id: string; snapshot_id: string; revision: number;
 status: 'queued'|'deploying'|'verifying'|'live'|'failed';
 content_hash: string|null; deployment_id: string|null; created_at: string; verified_at: string|null;
};
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function publisherCall(binding: PublisherBinding, path: string, body?: unknown) {
 const response = await binding.fetch(new Request('https://studio-publisher.internal'+path, {
  method: body ? 'POST' : 'GET', headers: {'Content-Type':'application/json'},
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000),
 }));
 if (!response.ok) throw Error('The publishing service is unavailable. Your private draft is safe.');
 const text = await response.text();
 if (text.length>16384) throw Error('Invalid publishing service response.');
 return JSON.parse(text);
}
export async function publisherReady(env: PublishingEnv, clientId: string): Promise<boolean> {
 if (!env.STUDIO_PUBLISHER) return false;
 try {
  const c = await publisherCall(env.STUDIO_PUBLISHER, '/capabilities?client='+encodeURIComponent(clientId));
  return c.clientId===clientId && c.snapshotId===manifest.id && c.publicUrl===manifest.source &&
   c.protocol===1 && c.safeRenderer===true && c.durableIdempotency===true && c.rollback===true;
 } catch { return false; }
}
// Stable hash independent of JSON object key ordering.
export function canonical(value: unknown): string {
 if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 if (value && typeof value==='object') return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
export async function contentHash(value: unknown): Promise<string> {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function matchingReceipt(value: Record<string,unknown>, release: Publication): boolean {
 return value.releaseId===release.id && value.clientId===release.client_id &&
 value.snapshotId===release.snapshot_id && value.revision===release.revision && value.contentHash===release.content_hash &&
 typeof value.deploymentId==='string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value.deploymentId) &&
 (!release.deployment_id || value.deploymentId===release.deployment_id);
}
async function boundedHead(response: Response): Promise<string> {
 const reader=response.body?.getReader();if(!reader)return '';
 const decoder=new TextDecoder();let text='',bytes=0;
 try { while(bytes<65536) { const part=await reader.read();if(part.done)break;
  const chunk=part.value.subarray(0,65536-bytes);bytes+=chunk.length;text+=decoder.decode(chunk,{stream:true});
  if (text.includes('</head>')) break;
 } } finally { await reader.cancel(); }
 return text;
}
export async function verifyLivePages(release: Publication): Promise<boolean> {
 // Every packaged page must identify this exact release. No redirects, user URLs,
 // unauthenticated callbacks, or provider 'accepted' responses can mark it live.
 const marker='<meta name="torres-studio-release" content="'+release.id+':'+release.content_hash+'">';
 for(let i=0;i<routes.length;i+=3){
  const results=await Promise.all(routes.slice(i,i+3).map(async page=>{
   try {
    const url=new URL(page.route,manifest.source);url.searchParams.set('__studio_release',release.id);
    const response=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),headers:{'Cache-Control':'no-cache'}});
    if(!response.ok || !response.headers.get('content-type')?.includes('text/html'))return false;
    return (await boundedHead(response)).includes(marker);
   }catch{return false;}
  }));if(results.some(v=>!v))return false;
 }
 return true;
}
export function publicPublication(p: Publication|null) {
 return p ? {id:p.id,revision:p.revision,status:p.status,createdAt:p.created_at,verifiedAt:p.verified_at} : null;
}
