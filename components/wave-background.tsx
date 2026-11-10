"use client";

import { useEffect, useRef } from "react";

type VantaEffect = {
  destroy: () => void;
  renderer?: { domElement: HTMLCanvasElement; dispose: () => void; forceContextLoss: () => void };
};
type VantaWindow = Window & { VANTA?: { WAVES: (options: Record<string, unknown>) => VantaEffect }; THREE?: unknown };
const scripts = new Map<string, Promise<void>>();

function loadScript(src: string) {
  const existing = scripts.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { scripts.delete(src); script.remove(); reject(new Error("Background unavailable")); };
    document.head.appendChild(script);
  });
  scripts.set(src, promise);
  return promise;
}

export function WaveBackground({ paused }: { paused: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)");
    let effect: VantaEffect | undefined;
    let disposed = false;
    let generation = 0;
    function stop() {
      const renderer = effect?.renderer;
      effect?.destroy();
      effect = undefined;
      renderer?.dispose();
      renderer?.forceContextLoss();
      element!.removeAttribute("data-vanta-ready");
    }
    async function sync() {
      const run = ++generation;
      stop();
      if (paused || preference.matches || disposed) return;
      try {
        await loadScript("/vendor/vanta/three-r134.min.js");
        await loadScript("/vendor/vanta/vanta.waves-0.5.24.min.js");
        if (disposed || run !== generation || preference.matches) return;
        const runtime = window as VantaWindow;
        if (!runtime.VANTA?.WAVES) return;
        effect = runtime.VANTA.WAVES({
          el: element, THREE: runtime.THREE,
          mouseControls: false, touchControls: false, gyroControls: false,
          minHeight: 200, minWidth: 200,
          scale: Math.max(1, window.devicePixelRatio || 1),
          scaleMobile: Math.max(1.5, window.devicePixelRatio || 1),
          color: 0x87aabd, shininess: 24, waveHeight: 18, waveSpeed: 1.25, zoom: .9,
        });
        if (effect.renderer) element!.setAttribute("data-vanta-ready", "true");
        else stop();
      } catch { stop(); } // Keep the static artwork if WebGL or loading is unavailable.
    }
    const onPreference = () => { void sync(); };
    const onContextLoss = () => { ++generation; stop(); };
    element.addEventListener("webglcontextlost", onContextLoss, true);
    preference.addEventListener("change", onPreference);
    void sync();
    return () => {
      disposed = true;
      ++generation;
      element.removeEventListener("webglcontextlost", onContextLoss, true);
      preference.removeEventListener("change", onPreference);
      stop();
    };
  }, [paused]);
  return <div ref={host} className="workspace-waves" aria-hidden="true" />;
}
