"use client";
import { useEffect, useState } from "react";
import { Shell } from "../../components/shell";
import { ClientWebsiteHome } from "../../components/client-website-home";
import { StatePanel } from "../../components/ui-foundation";
import { studioRequest } from "../../lib/studio-api";
import { WebsiteSelector } from "../../components/website-selector";
import { AUTH_SESSION_EVENT } from "../../lib/supabase-auth";
type Workspace = { clientId?: string; state: string; canvasEnabled?: boolean; site?: { name: string; publicUrl: string | null } };
export default function WebsitePage() {
 const [workspace,setWorkspace] = useState<Workspace|null>(null);
 const [error,setError] = useState("");
 const [retry,setRetry] = useState(0);
 useEffect(()=>{
  let controller: AbortController;
  function load(){
   controller?.abort(); controller=new AbortController(); const signal=controller.signal;
   setWorkspace(null);setError("");
   void studioRequest<Workspace>("workspace",undefined,signal).then(data=>{if(!signal.aborted)setWorkspace(data)}).catch(e=>{if(!signal.aborted)setError(e instanceof Error?e.message:"Your website could not be opened.")});
  }
  load(); window.addEventListener(AUTH_SESSION_EVENT,load);
  return ()=>{controller.abort();window.removeEventListener(AUTH_SESSION_EVENT,load)};
 },[retry]);
 return <Shell active="Website"><WebsiteSelector/>{error?<section role="alert"><h1>Your website could not be opened</h1><p>{error}</p><button className="button" onClick={()=>setRetry(x=>x+1)}>Try again</button></section>:!workspace?<StatePanel state="loading" title="Opening your website" description="Checking your account’s website access."/>:workspace.state==="ready"&&workspace.canvasEnabled&&workspace.site?<ClientWebsiteHome name={workspace.site.name} publicUrl={workspace.site.publicUrl} clientId={workspace.clientId || null}/>:<StatePanel state="empty" title="Website editing is not connected" description="This website is not connected to the editor yet. Contact Torres & Co. to complete its setup."/>}</Shell>;
}
