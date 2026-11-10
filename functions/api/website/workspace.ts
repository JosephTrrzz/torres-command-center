import { authJson, requireAuth, type FunctionEnv } from "../../_shared/auth";
import manifest from "../../../lib/canvas-manifest.json";
import { studioAccess, studioStore } from "../../_shared/studio-access";
export async function onRequestGet({
  request,
  env,
}: {
  request: Request;
  env: FunctionEnv;
}) {
  const identity = await requireAuth(request, env);
  if ("response" in identity) return identity.response;
  const customer =
    identity.context.websiteOnly ||
    (identity.context.organizationRole
      ? identity.context.organizationRole === "client"
      : identity.context.role === "customer");
  const access = await studioAccess(request, env);
  if ("response" in access) {
    if (access.response.status === 403 || access.response.status === 404)
      return authJson({ state: "unconfigured", clientWorkspace: customer });
    return access.response;
  }
  const { rest, headers } = studioStore(env);
  const response = await fetch(
    rest +
      "/studio_sites?client_id=eq." +
      access.clientId +
      "&select=*&limit=1",
    { headers },
  );
  if (!response.ok)
    return authJson(
      { error: "Website setup could not be loaded. Please try again." },
      503,
    );
  const [site] = await response.json();
  return authJson({
    clientId: access.clientId,
    state: !site ? "unconfigured" : site.enabled ? "ready" : "disabled",
    clientWorkspace: !access.staff,
    canvasEnabled: Boolean(site?.enabled && site.canvas_snapshot_id === manifest.id && site.public_url?.replace(/\/$/, "") === manifest.source),
    site: site ? { name: site.name, publicUrl: site.public_url } : null,
  });
}
