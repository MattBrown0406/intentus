import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { bounded, safeDestination } from "@/contexts/AuthContext";

let recoveryUser: string | null = null;
export function recoveryReadyFor(id: string | undefined) { return !!id && recoveryUser === id; }
export function clearRecovery() { recoveryUser = null; }
export function markRecovery(id: string) { recoveryUser = id; }

const DUPLICATE_OPEN_MS = 3000;

export function useNativeDeepLinks() {
  // useNavigate() returns a new function on every pathname change. Depending on
  // it would tear down and re-run this effect on each navigation, re-reading
  // getLaunchUrl() (which keeps returning the last opened URL) with a fresh
  // `handled` set: the app would bounce back to the deep-link target after
  // every navigation and replay already-consumed auth callbacks into
  // "/reset-password?error=expired". Register once; navigate via a ref.
  const navigateNow = useNavigate();
  const navigateRef = useRef(navigateNow);
  navigateRef.current = navigateNow;
  useEffect(() => {
    const navigate = (to: string, options?: { replace?: boolean }) => { void navigateRef.current(to, options); };
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    let listener: { remove: () => Promise<void> } | undefined;
    // A cold-start URL can arrive both via getLaunchUrl() and appUrlOpen, so a
    // repeat within a short window is the same open. One-time auth callbacks are
    // never replayed; a plain link the user taps again later is routed again.
    const handled = new Map<string, number>();
    const route = async (event: { url: string }) => {
      const seen = handled.get(event.url);
      if (!active || (seen !== undefined && Date.now() - seen < DUPLICATE_OPEN_MS)) return;
      try {
        if (event.url.includes("\\")) return;
        const url = new URL(event.url);
        const owned = (url.protocol === "intentus:" && url.hostname === "app") ||
          (url.protocol === "https:" && url.hostname === "intentusai.com" && !url.port);
        if (!owned || url.username || url.password) return;
        const target = safeDestination(url.searchParams.get("route") ?? (url.pathname + url.search + url.hash), "");
        if (!target) return;
        const params = new URLSearchParams(url.hash.slice(1));
        const code = url.searchParams.get("code");
        const access = params.get("access_token"), refresh = params.get("refresh_token");
        const callback = (url.pathname === "/reset-password" || url.pathname === "/auth") &&
          !!(code || access || refresh || params.has("error") || url.searchParams.has("error"));
        handled.set(event.url, callback ? Infinity : Date.now());
        if (callback) {
          clearRecovery();
          if (params.has("error") || url.searchParams.has("error") || (!code && (!access || !refresh))) throw new Error("Invalid callback");
          const { data, error } = await bounded(code ? supabase.auth.exchangeCodeForSession(code) : supabase.auth.setSession({ access_token: access!, refresh_token: refresh! }));
          if (error || !data.session) throw error || new Error("Expired callback");
          if (!active) return;
          if (url.pathname === "/reset-password") markRecovery(data.session.user.id);
          navigate(url.pathname, { replace: true });
        } else if (target !== "/") navigate(target);
      } catch {
        if (active) navigate("/reset-password?error=expired", { replace: true });
      }
    };
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        if (!active) return;
        listener = await App.addListener("appUrlOpen", route);
        if (!active) { await listener.remove(); return; }
        const launch = await App.getLaunchUrl();
        if (launch) await route(launch);
      } catch { console.error("Native deep-link initialization failed"); }
    })();
    return () => { active = false; listener?.remove().catch(() => undefined); };
  }, []);
}
