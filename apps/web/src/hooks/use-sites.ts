"use client";

import { useEffect, useState } from "react";
import { api, type Site } from "@/lib/api";

const POLL_MS = 3000;

export type SitesState =
  | { status: "loading" }
  | { status: "ready"; sites: Site[]; stale: boolean }
  | { status: "error"; message: string };

/** Portfolio overview, polled. Keeps showing the last data (marked stale) if a poll fails. */
export function useSites(): SitesState {
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
            : { status: "error", message: error instanceof Error ? error.message : "Request failed" },
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

  return state;
}
