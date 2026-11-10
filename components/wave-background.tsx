"use client";

import { useEffect, useId, useRef } from "react";

const WIDTH = 1440;
const BANDS = [160, 370, 590, 820, 1050];

// Two traveling swells deform each contour independently; the page itself never moves.
function contour(base: number, time: number, offset = 0) {
  let path = "";
  for (let x = -80; x <= WIDTH + 80; x += 16) {
    const y = base + offset
      + Math.sin(x / 310 + time * .55 + base / 410) * 74
      + Math.sin(x / 620 - time * .36 + base / 270) * 48;
    path += `${x === -80 ? "M" : "L"}${x},${y.toFixed(2)} `;
  }
  return path;
}

export function WaveBackground({ paused }: { paused: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const elapsed = useRef(0);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    const root = svg.current;
    if (!root) return;
    const paths = Array.from(root.querySelectorAll<SVGPathElement>("path[data-wave]"));
    const preference = matchMedia("(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)");
    let frame = 0;
    let previous = 0;
    function draw(time: number) {
      paths.forEach((path) => {
        const base = Number(path.dataset.wave);
        const offset = Number(path.dataset.offset || 0);
        path.setAttribute("d", contour(base, time, offset) + (path.dataset.fill ? `L1520,1200 L-80,1200 Z` : ""));
      });
    }
    function tick(now: number) {
      if (previous) elapsed.current += Math.min(now - previous, 50) / 1000;
      previous = now;
      draw(elapsed.current);
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame);
      previous = 0;
      if (preference.matches) draw(0);
      else if (!paused) frame = requestAnimationFrame(tick);
    }
    sync();
    preference.addEventListener("change", sync);
    return () => { cancelAnimationFrame(frame); preference.removeEventListener("change", sync); };
  }, [paused]);

  return <div className="workspace-waves" aria-hidden="true">
    <svg ref={svg} viewBox="0 0 1440 1000" preserveAspectRatio="none" focusable="false">
      <defs>
        <linearGradient id={`${id}-cool`} x1="0" y1="0" x2=".25" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="#dbe7eb" stopOpacity=".8"/><stop offset=".65" stopColor="#f8f8f6" stopOpacity=".1"/></linearGradient>
        <linearGradient id={`${id}-warm`} x1="0" y1="0" x2=".25" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="#eee3cf" stopOpacity=".75"/><stop offset=".65" stopColor="#f8f8f6" stopOpacity=".1"/></linearGradient>
      </defs>
      {BANDS.map((base, index) => <g key={base}>
        <path data-wave={base} data-fill="true" d={`${contour(base, 0)}L1520,1200 L-80,1200 Z`} fill={`url(#${id}-${index % 2 ? "warm" : "cool"})`}/>
        {[0, 14, 28].map(offset => <path key={offset} data-wave={base} data-offset={offset} d={contour(base, 0, offset)} fill="none" stroke={index % 2 ? "#b08d57" : "#8ba5b3"} strokeOpacity=".09" strokeWidth="1"/>) }
      </g>)}
    </svg>
  </div>;
}
