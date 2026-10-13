import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { markRecovery, clearRecovery } from "@/hooks/useNativeDeepLinks";
import { supabase } from "@/integrations/supabase/client";


interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function safeDestination(value: unknown, fallback = "/onboarding") {
  // Reject literal whitespace/control bytes as well as backslashes in redirects.
  // eslint-disable-next-line no-control-regex
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || decoded.includes("\\")) return fallback;
    return value;
  } catch { return fallback; }
}

export async function bounded<T>(operation: PromiseLike<T>, ms = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([Promise.resolve(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Request timed out. Please try again.")), ms);
    })]);
  } finally { clearTimeout(timer!); }
}

// Registered by native bindings. Auth must await token revocation while its
// authenticated owner still exists; a failed revoke must not claim logout.
const beforeSignOut = new Set<(userId: string) => Promise<void>>();
export function registerSignOutCleanup(cleanup: (userId: string) => Promise<void>) {
  beforeSignOut.add(cleanup);
  return () => { beforeSignOut.delete(cleanup); };
}
export async function cleanupBeforeSignOut(userId: string) {
  for (const cleanup of beforeSignOut) await bounded(cleanup(userId));
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const publish = (session: Session | null) => {
      if (!active) return;
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (_event === "PASSWORD_RECOVERY" && session) markRecovery(session.user.id);
        if (_event === "SIGNED_OUT") clearRecovery();
        receivedEvent = true;
        publish(session);
      }
    );
    // A newer auth event must win over an outstanding storage read.
    bounded(supabase.auth.getSession()).then(({ data: { session } }) => {
      if (!receivedEvent) publish(session);
    }).catch(() => {
      if (!receivedEvent) publish(null);
    });

    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const [inviteError, setInviteError] = useState("");
  const [inviteRetry, setInviteRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setInviteError("");
    const metadata = session?.user.user_metadata;
    if (!session || (!metadata?.invite_code && !metadata?.coach_slug)) return;
    void (async () => {
      try {
        let body: Record<string, string> = { invite_code: metadata.invite_code };
        if (!metadata.invite_code && metadata.coach_slug) {
          const { data, error } = await bounded(supabase.rpc("get_public_coach_branding", { _slug: metadata.coach_slug }));
          if (error || !data?.[0]) throw error || new Error("Coach not found");
          body = { invite_code: "__branded__", coach_user_id: data[0].coach_user_id };
        }
        if (!active) return;
        const { data, error } = await bounded(supabase.functions.invoke("process-coach-invite", {
          body, headers: { Authorization: `Bearer ${session.access_token}` },
        }));
        if (error || data?.error) throw error || new Error(data.error);
        // The code lives in durable user metadata. Once redeemed, consume it so a
        // later session cannot silently re-link a removed client, nor surface a
        // permanent error after the coach deletes or expires the invite link.
        if (!active) return;
        // Redemption already succeeded and is idempotent; a failed cleanup must not report failure.
        const cleared = await bounded(supabase.auth.updateUser({ data: { invite_code: null, coach_slug: null } })).catch(error => ({ error }));
        if (cleared.error) console.error("Coach invite metadata cleanup failed");
      } catch (error) {
        if (active) setInviteError(error instanceof Error ? error.message : "Coach link failed. Please retry.");
      }
    })();
    return () => { active = false; };
  }, [session?.user.id, inviteRetry]);

  const signOut = async () => {
    if (user) await cleanupBeforeSignOut(user.id);
    const { error } = await bounded(supabase.auth.signOut());
    if (error) throw error;
  };

  // A permanently invalid invite (deleted/expired link) must not nag every session.
  const dismissInvite = async () => {
    const { error } = await bounded(supabase.auth.updateUser({ data: { invite_code: null, coach_slug: null } })).catch(error => ({ error }));
    if (!error) setInviteError("");
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {inviteError && <div role="alert">Coach link failed: {inviteError} <button onClick={() => setInviteRetry(n => n + 1)}>Retry coach link</button> <button onClick={() => void dismissInvite()}>Dismiss invite</button></div>}
      {children}
    </AuthContext.Provider>
  );
};
