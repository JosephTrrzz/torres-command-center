import {
  blockedHttpMethod,
  requestBodyLimit,
  requestBodyWithinLimit,
  secureApiResponse,
} from "./_shared/security";

type MiddlewareContext = {
  request: Request;
  next(): Promise<Response>;
};

function error(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequest = async (context: MiddlewareContext) => {
  const requestId = crypto.randomUUID();
  const pathname = new URL(context.request.url).pathname.replace(/\/$/, "") || "/";
  let response: Response;

  if (blockedHttpMethod(context.request.method)) {
    response = error("Method not allowed.", 405);
  } else if (!await requestBodyWithinLimit(context.request, requestBodyLimit(pathname))) {
    response = error("Request body is too large or uses an unsupported encoding.", 413);
  } else {
    response = await context.next();
  }

  return pathname.startsWith("/api/") ? secureApiResponse(response, requestId, pathname) : response;
};

