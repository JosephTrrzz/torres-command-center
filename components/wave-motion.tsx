"use client";

import { useEffect, useState } from "react";

export function useWaveMotion() {
  const [motionPaused, setMotionPaused] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    try { setMotionPaused(localStorage.getItem("torres-wave-motion-paused") === "true"); }
    catch { setMotionPaused(false); }
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);
  function toggleBackgroundMotion() {
    const paused = !motionPaused;
    setMotionPaused(paused);
    try { localStorage.setItem("torres-wave-motion-paused", String(paused)); } catch { /* Still works for this visit. */ }
  }
  return { motionPaused, animationPaused: motionPaused || !pageVisible, toggleBackgroundMotion };
}

export function WaveMotionControl({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  const label = paused ? "Resume background motion" : "Pause background motion";
  return <button type="button" className="wave-motion-control" onClick={onToggle} aria-label={label} title={label} aria-pressed={paused}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paused ? <path d="m8 5 11 7-11 7Z" /> : <><path d="M8 5v14" /><path d="M16 5v14" /></>}
    </svg>
  </button>;
}
