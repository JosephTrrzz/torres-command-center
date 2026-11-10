import { describe, it, expect, vi } from 'vitest';
import { onRequest } from '../functions/_middleware';
import { trustedStudioRequest } from '../functions/_shared/studio-request';
const url = 'https://admin.example/api/website/canvas-drafts';
describe('Website Studio request boundary', () => {
  it.each(['https://evil.example', 'https://sub.admin.example', 'null', 'https://admin.example.evil.test'])( 'rejects foreign origin %s before reading or writing storage', async origin => {
    const next = vi.fn();
    const response = await onRequest({request:new Request(url,{method:'POST',headers:{Origin:origin},body:'{}'}),next});
    expect(response.status).toBe(403);expect(next).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it.each(['cross-site','same-site'])('rejects %s fetch metadata even without Origin', site => {
    expect(trustedStudioRequest(new Request(url,{headers:{'Sec-Fetch-Site':site}}))).toBe(false);
  });
  it('allows same-origin requests to reach authentication', async () => {
    const next=vi.fn(async()=>new Response(null,{status:401}));
    const response=await onRequest({request:new Request(url,{headers:{Origin:'https://admin.example','Sec-Fetch-Site':'same-origin'}}),next});
    expect(response.status).toBe(401);expect(next).toHaveBeenCalledOnce();
  });
  it('keeps authentication required for non-browser requests', async()=>{
    const next=vi.fn(async()=>new Response(null,{status:401}));
    expect((await onRequest({request:new Request(url),next})).status).toBe(401);
  });
  it('does not change public receptionist or provider webhook routing', async()=>{
    const next=vi.fn(async()=>new Response(null,{status:204}));
    expect((await onRequest({request:new Request('https://admin.example/api/receptionist',{headers:{Origin:'https://public.example'}}),next})).status).toBe(204);
  });
});
