"use client";
import { useEffect, useRef, useState } from 'react';
import { Shell } from '../../../components/shell';
import { studioRequest } from '../../../lib/studio-api';
import { AUTH_SESSION_EVENT, readStoredSession } from '../../../lib/supabase-auth';
import { WebsiteSelector } from "../../../components/website-selector";
import manifest from '../../../lib/canvas-manifest.json';

export default function CanvasWebsitePage() {
 const frame=useRef<HTMLIFrameElement>(null);
 const switchSave=useRef<((saved:boolean)=>void)|null>(null);
 const saveBeforeSwitch=()=>new Promise<boolean>(resolve=>{
  const button=frame.current?.contentDocument?.getElementById('save') as HTMLButtonElement|null;
  if(!button || button.disabled){resolve(false);return;}
  const timeout=window.setTimeout(()=>{switchSave.current=null;resolve(false)},30000);
  switchSave.current=(saved)=>{window.clearTimeout(timeout);switchSave.current=null;resolve(saved)};
  button.click();
 });
 const [notice,setNotice]=useState('Opening your private website draft…');
 const [available,setAvailable]=useState(false);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let alive=true, busy=false;
  const controller=new AbortController();
  const identity=readStoredSession()?.user.id;
  const reset=()=>{controller.abort();setAvailable(false);setNotice('Your account changed. Reload to open the correct website.');};
  window.addEventListener(AUTH_SESSION_EVENT,reset);
  const load=()=>studioRequest<{snapshotId:string;revision:number;draft:object;name:string}>('canvas-drafts',undefined,controller.signal);
  load().then(info=>{if(alive){setAvailable(info.snapshotId===manifest.id);setNotice(info.name+' · Private draft. Your live website is unchanged.');}}).catch(error=>{if(alive)setNotice(error.message)});
  const receive=async(event:MessageEvent)=>{
   if(event.source!==frame.current?.contentWindow || event.origin!==window.location.origin || !alive) return;
   const m=event.data;
   if(!m || !['canvas-load','canvas-save','canvas-history','canvas-version','canvas-publish-status','canvas-publish','canvas-publish-check'].includes(m.type) || typeof m.requestId!=='string' || m.requestId.length>80) return;
   const reply=(value:object)=>{if(alive)frame.current?.contentWindow?.postMessage({type:'canvas-result',requestId:m.requestId,...value},window.location.origin)};
   if(identity!==readStoredSession()?.user.id){reset();return;}
   if(busy){if(m.type==='canvas-save')switchSave.current?.(false);reply({error:'A save is already in progress. Please retry.'});return;}
   busy=true;
   try{
    if(m.type==='canvas-version'&&(!Number.isSafeInteger(m.revision)||m.revision<1))throw Error('Invalid saved draft.');
    const result=m.type==='canvas-publish-status'?await studioRequest('publish',undefined,controller.signal):m.type==='canvas-publish'?await studioRequest('publish',{action:'begin',snapshotId:manifest.id,revision:m.revision,requestKey:m.requestKey},controller.signal):m.type==='canvas-publish-check'?await studioRequest('publish',{action:'check',id:m.id},controller.signal):m.type==='canvas-load'?await load():m.type==='canvas-history'?await studioRequest('canvas-drafts?history=1',undefined,controller.signal):m.type==='canvas-version'?await studioRequest('canvas-drafts?version='+m.revision,undefined,controller.signal):await studioRequest('canvas-drafts',{snapshotId:manifest.id,revision:m.revision,draft:m.draft,checkpoint:m.checkpoint===true},controller.signal);
    reply({result});
    if(m.type==='canvas-save' && m.checkpoint===true) switchSave.current?.(true);
   }catch(error){if(m.type==='canvas-save')switchSave.current?.(false);reply({error:error instanceof Error?error.message:'Saving failed. Keep this page open.',status:(error as {status?:number}).status});}
   finally{busy=false;}
  };
  window.addEventListener('message',receive);
  return()=>{switchSave.current?.(false);alive=false;controller.abort();window.removeEventListener('message',receive);window.removeEventListener(AUTH_SESSION_EVENT,reset);};
 },[retry]);
 return <Shell active="Website"><WebsiteSelector editing beforeSwitch={saveBeforeSwitch}/><p role="status">{notice}</p>{available?<iframe ref={frame} title="Private website editor" src="/website-preview/index.html?connected=1" style={{width:'100%',height:'calc(100dvh - 180px)',minHeight:560,border:0}}/>:<button onClick={()=>setRetry(v=>v+1)}>Try again</button>}</Shell>;
}
