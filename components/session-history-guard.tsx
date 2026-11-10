"use client";
import { useEffect } from "react";
import { AUTH_LOGOUT_KEY, clearAuthSession, readStoredSession, signOutSession } from "../lib/supabase-auth";

export function SessionHistoryGuard() {
  useEffect(() => {
    let leaving = false;
    const lock = (revoke = true) => {
      if (leaving) return;
      leaving = true;
      document.documentElement.setAttribute('data-session-locked', 'true');
      if (revoke) void signOutSession(); else clearAuthSession();
      window.location.replace('/login/');
    };
    const history = () => { if (readStoredSession()) lock(); };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) lock();
      else document.documentElement.removeAttribute('data-session-locked');
    };
    const hide = () => document.documentElement.setAttribute('data-session-locked', 'true');
    const storage = (event: StorageEvent) => { if (event.key === AUTH_LOGOUT_KEY) lock(false); };
    window.addEventListener('popstate', history);
    window.addEventListener('pageshow', show);
    window.addEventListener('pagehide', hide);
    window.addEventListener('storage', storage);
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.type === 'back_forward' && readStoredSession()) lock();
    return () => {
      window.removeEventListener('popstate', history);
      window.removeEventListener('pageshow', show);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('storage', storage);
    };
  }, []);
  return null;
}
