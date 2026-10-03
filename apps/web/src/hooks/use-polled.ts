"use client";

import { useEffect, useState } from "react";
import { LOADING, pollReducer, startPolling, type PollState } from "@/lib/poll";

/**
 * Polls one site resource while the calling component is mounted. Stops when it unmounts or
 * the site changes; data of the previous site is never returned for the new one.
 */
export function usePolled<T>(
  load: (siteId: string, signal: AbortSignal) => Promise<T>,
  siteId: string,
  intervalMs: number,
): PollState<T> {
  const [entry, setEntry] = useState<{ siteId: string; state: PollState<T> }>({ siteId, state: LOADING });

  useEffect(
    () =>
      startPolling((signal) => load(siteId, signal), { intervalMs }, (event) =>
        setEntry((previous) => ({
          siteId,
          state: pollReducer(previous.siteId === siteId ? previous.state : LOADING, event),
        })),
      ),
    [load, siteId, intervalMs],
  );

  return entry.siteId === siteId ? entry.state : LOADING;
}
