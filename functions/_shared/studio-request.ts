// Browser origin checks supplement, never replace, bearer-token and tenant checks.
export function trustedStudioRequest(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== new URL(request.url).origin) return false;
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  // Non-browser callers may omit both headers; authentication is still mandatory.
  return true;
}
