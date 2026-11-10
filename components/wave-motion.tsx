"use client";

import { useEffect, useState } from "react";

export function useWaveMotion() {
  const [animationPaused, setAnimationPaused] = useState(true);
  useEffect(() => {
    const updateVisibility = () => setAnimationPaused(document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);
  return { animationPaused };
}
