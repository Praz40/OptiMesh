"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { authConfig } from "@/lib/auth";

export type AuthState =
  /** NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is unset: sign-in is hidden. */
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; userId: string; email: string | null };

export type Auth = {
  state: AuthState;
  signIn(email: string, password: string): Promise<void>;
  /** "confirm-email" when the project asks new users to confirm their address first. */
  signUp(email: string, password: string): Promise<"signed-in" | "confirm-email">;
  signOut(): Promise<void>;
  /** The current access token, refreshed when it is about to expire; null when signed out. */
  accessToken(): Promise<string | null>;
};

const CONFIG = authConfig();
const unavailable = () => Promise.reject(new Error("Sign-in is not configured"));

const AuthContext = createContext<Auth>({
  state: { status: "disabled" },
  signIn: unavailable,
  signUp: unavailable,
  signOut: unavailable,
  accessToken: () => Promise.resolve(null),
});

function stateOf(session: Session | null): AuthState {
  return session
    ? { status: "signed-in", userId: session.user.id, email: session.user.email ?? null }
    : { status: "signed-out" };
}

/** Keeps the Supabase session (stored and refreshed by supabase-js). Without configuration it does nothing. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(CONFIG ? { status: "loading" } : { status: "disabled" });
  const client = useRef<Promise<SupabaseClient> | null>(null);

  useEffect(() => {
    if (!CONFIG) return;
    const { url, key } = CONFIG;
    let active = true;
    let unsubscribe: () => void = () => undefined;
    // Loaded on demand, so an unconfigured app does not download supabase-js at all.
    client.current ??= import("@supabase/supabase-js").then(({ createClient }) => createClient(url, key));
    client.current.then(
      (supabase) => {
        if (!active) return;
        const { data } = supabase.auth.onAuthStateChange((_event, session) => setState(stateOf(session)));
        unsubscribe = () => data.subscription.unsubscribe();
      },
      () => {
        if (active) setState({ status: "signed-out" });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Stable across token refreshes, so callers can list them as effect dependencies.
  const actions = useMemo<Omit<Auth, "state">>(() => {
    const supabase = () => client.current ?? Promise.reject(new Error("Sign-in is not configured"));
    return {
      async signIn(email, password) {
        const { error } = await (await supabase()).auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUp(email, password) {
        const { data, error } = await (await supabase()).auth.signUp({ email, password });
        if (error) throw error;
        return data.session ? "signed-in" : "confirm-email";
      },
      async signOut() {
        // Only this browser; the session is removed locally even if Supabase cannot be reached.
        const { error } = await (await supabase()).auth.signOut({ scope: "local" });
        if (error) throw error;
      },
      async accessToken() {
        if (!client.current) return null;
        const { data } = await (await client.current).auth.getSession();
        return data.session?.access_token ?? null;
      },
    };
  }, []);
  const auth = useMemo<Auth>(() => ({ state, ...actions }), [state, actions]);

  return <AuthContext value={auth}>{children}</AuthContext>;
}

export function useAuth(): Auth {
  return useContext(AuthContext);
}
