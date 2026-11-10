"use client";

import { useEffect, useState } from "react";
import { PrivateOfficeNextAction } from "./private-office";
import { studioRequest, studioUrl } from "../lib/studio-api";
import { AUTH_SESSION_EVENT } from "../lib/supabase-auth";

/** Navigation is shown only after the server confirms access to a ready canvas. */
export function WebsiteEntry() {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    let controller: AbortController;
    function load() {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      setHref(null);
      const destination = studioUrl("workspace").replace("/api/website/workspace", "/website/");
      void studioRequest<{ state: string; canvasEnabled?: boolean }>("workspace", undefined, signal)
        .then((workspace) => {
          if (!signal.aborted && workspace.state === "ready" && workspace.canvasEnabled) setHref(destination);
        }).catch(() => { /* The rest of Today remains available if Studio is unavailable. */ });
    }
    load();
    window.addEventListener(AUTH_SESSION_EVENT, load);
    return () => { controller.abort(); window.removeEventListener(AUTH_SESSION_EVENT, load); };
  }, []);
  if (!href) return null;
  return <PrivateOfficeNextAction href={href} eyebrow="Your website" title="Make your next update." description="Edit your pages, photos, and sections in your private website workspace. Your public website stays unchanged while you work." label="Open website workspace" />;
}
