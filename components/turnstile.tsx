"use client";

import Script from "next/script";
import { useCallback, useEffect, useId, useRef } from "react";

type TurnstileApi = {
  render(container: string | HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
};

declare global {
  interface Window { turnstile?: TurnstileApi }
}

export function TurnstileChallenge({ siteKey, onToken }: { siteKey: string; onToken(token: string): void }) {
  const reactId = useId().replace(/:/g, "");
  const elementId = `turnstile-${reactId}`;
  const widgetId = useRef("");

  const render = useCallback(() => {
    if (!window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(`#${elementId}`, {
      sitekey: siteKey,
      action: "command_center_login",
      appearance: "interaction-only",
      theme: "light",
      callback: (token: string) => onToken(token),
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
    });
  }, [elementId, onToken, siteKey]);

  useEffect(() => () => {
    if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
  }, []);

  return <>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={render} />
    <div id={elementId} className="login-turnstile" aria-label="Bot protection check" />
  </>;
}
