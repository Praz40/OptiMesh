"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { RegistryError, registry, type OwnedSite } from "@/lib/registry";

export type MySitesState =
  /** Sign-in is not configured, still loading, or nobody is signed in. */
  | { status: "signed-out" }
  | { status: "loading" }
  | { status: "ready"; sites: OwnedSite[] }
  | { status: "failed"; error: unknown };

export type MySites = {
  state: MySitesState;
  reload(): void;
  /** Shows a site created with POST /sites without loading the list again (newest first, as GET /sites). */
  added(site: OwnedSite): void;
};

const MySitesContext = createContext<MySites>({
  state: { status: "signed-out" },
  reload: () => undefined,
  added: () => undefined,
});

/** The signed-in user's sites from GET /sites, loaded once per sign-in and on reload. */
export function MySitesProvider({ children }: { children: ReactNode }) {
  const { state: auth, accessToken } = useAuth();
  const userId = auth.status === "signed-in" ? auth.userId : null;
  const [version, setVersion] = useState(0);
  const key = userId && `${userId}:${version}`;
  // Keyed by user and reload, so another user's list or an outdated one is never shown.
  const [entry, setEntry] = useState<{ key: string; state: MySitesState } | null>(null);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await accessToken();
        if (!token) throw new RegistryError(401, "Not signed in");
        const sites = await registry.sites(token, controller.signal);
        if (!controller.signal.aborted) setEntry({ key, state: { status: "ready", sites } });
      } catch (error) {
        if (!controller.signal.aborted) setEntry({ key, state: { status: "failed", error } });
      }
    })();
    return () => controller.abort();
  }, [key, accessToken]);

  const state: MySitesState = !key
    ? { status: "signed-out" }
    : entry?.key === key
      ? entry.state
      : { status: "loading" };

  const value: MySites = {
    state,
    reload: () => setVersion((current) => current + 1),
    added: (site) =>
      setEntry((current) =>
        current?.state.status === "ready"
          ? { ...current, state: { status: "ready", sites: [site, ...current.state.sites] } }
          : current,
      ),
  };
  return <MySitesContext value={value}>{children}</MySitesContext>;
}

export function useMySites(): MySites {
  return useContext(MySitesContext);
}
