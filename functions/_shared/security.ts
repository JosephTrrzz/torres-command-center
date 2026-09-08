const DEFAULT_API_BODY_LIMIT = 1024 * 1024;
const ATTACHMENT_BODY_LIMIT = 10 * 1024 * 1024;
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const BLOCKED_METHODS = new Set(["CONNECT", "TRACE", "TRACK"]);

export function requestBodyLimit(pathname: string) {
  return pathname === "/api/communications/attachments" ? ATTACHMENT_BODY_LIMIT : DEFAULT_API_BODY_LIMIT;
}

export function blockedHttpMethod(method: string) {
  return BLOCKED_METHODS.has(method.toUpperCase());
}

export async function requestBodyWithinLimit(request: Request, limit: number) {
  if (!BODY_METHODS.has(request.method.toUpperCase()) || !request.body) return true;
  const contentEncoding = (request.headers.get("Content-Encoding") || "identity").toLowerCase();
  if (contentEncoding !== "identity") return false;
  const declared = request.headers.get("Content-Length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit) return false;
  }

  const reader = request.clone().body?.getReader();
  if (!reader) return true;
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return true;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        // Do not await cancellation: cloned/teed request streams may wait for
        // the untouched branch, while this branch has already proven the body
        // is too large and the request will be rejected.
        void reader.cancel().catch(() => undefined);
        return false;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function secureApiResponse(response: Response, requestId: string, pathname: string) {
  const secured = new Response(response.body, response);
  secured.headers.set("Cache-Control", "private, no-store, max-age=0");
  secured.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  secured.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  secured.headers.set("Cross-Origin-Resource-Policy", pathname === "/api/receptionist" ? "cross-origin" : "same-site");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("X-Request-Id", requestId);
  return secured;
}
