"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Site } from "@/lib/api";

const POLL_MS = 3000;

export type SitesState =
  | { status: "loading" }
  | { status: "ready"; sites: Site[]; stale: boolean }
  | { status: "error"; message: string };

const SitesContext = createContext<SitesState>({ status: "loading" });

/** Polls the portfolio once for the whole app. Keeps the last data (marked stale) if a poll fails. */
export function SitesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SitesState>({ status: "loading" });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function poll() {
      try {
        const sites = await api.sites(controller.signal);
        setState({ status: "ready", sites, stale: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((previous) =>
          previous.status === "ready"
            ? { ...previous, stale: true }
            : { status: "error", message: error instanceof Error ? error.message : "заявката не успя" },
        );
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, POLL_MS);
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  return <SitesContext value={state}>{children}</SitesContext>;
}

export function useSites(): SitesState {
  return useContext(SitesContext);
}
