import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_LOGOUT_KEY, AUTH_SESSION_EVENT, clearAuthSession, signOutSession } from '../lib/supabase-auth';
const session={access_token:'test-access',user:{id:'user'},profile:{id:'user',email:'user@example.test',full_name:'User',role:'owner',client_id:null,active:true}};
function setup(){
 const local=new Map<string,string>(),tab=new Map<string,string>();
 const storage=(map:Map<string,string>)=>({getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)});
 const dispatchEvent=vi.fn();vi.stubGlobal('window',{localStorage:storage(local),sessionStorage:storage(tab),dispatchEvent});
 tab.set('torres-auth-session',JSON.stringify(session));return {local,tab,dispatchEvent};
}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
describe('logout security',()=>{
 it('clears both stores and tells active screens to discard their session',()=>{
  const {local,tab,dispatchEvent}=setup();local.set('torres-auth-session','old');clearAuthSession();
  expect(local.has('torres-auth-session')).toBe(false);expect(tab.has('torres-auth-session')).toBe(false);
  expect(dispatchEvent.mock.calls[0][0].type).toBe(AUTH_SESSION_EVENT);
 });
 it('revokes provider credentials and broadcasts logout without retaining a token',async()=>{
  const {local,tab}=setup();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://auth.example');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','public-test');
  const fetcher=vi.fn(async()=>new Response(null,{status:204}));vi.stubGlobal('fetch',fetcher);await signOutSession();
  expect(tab.size).toBe(0);expect(local.has(AUTH_LOGOUT_KEY)).toBe(true);
  expect(fetcher).toHaveBeenCalledWith('https://auth.example/auth/v1/logout?scope=global',expect.objectContaining({method:'POST',keepalive:true}));
  expect(Array.from(local.values()).join()).not.toContain('test-access');
 });
 it('keeps local access cleared when the provider is unreachable',async()=>{
  const {tab}=setup();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://auth.example');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','public-test');vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('offline')}));
  await signOutSession();expect(tab.size).toBe(0);
 });
});
