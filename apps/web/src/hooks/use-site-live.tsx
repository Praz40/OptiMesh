"use client";

import { createContext, useCallback, useContext, useEffect, useReducer, useState, type ReactNode } from "react";
import { api, liveUrl, type Command, type CommandRequest, type LiveEvent, type Measurement } from "@/lib/api";
import { applyEvent, emptyLiveState, mergeCommand, parseLiveEvent, type LiveState } from "@/lib/live-state";
import { mergeTrend, pushTrend, trendDevices, trendFromHistory, type TrendPoint } from "@/lib/trend";

export type Connection = "connecting" | "live" | "reconnecting" | "not-found";

type State = LiveState & { trend: TrendPoint[]; backfilled: boolean };

type Action =
  | LiveEvent
  | { type: "commands"; data: Command[] }
  | { type: "backfill"; data: TrendPoint[] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "commands":
      return { ...state, commands: action.data.reduce(mergeCommand, state.commands) };
    case "backfill":
      return { ...state, backfilled: true, trend: mergeTrend(action.data, state.trend) };
    case "snapshot":
      return { ...state, ...applyEvent(state, action), trend: pushTrend(state.trend, action.data.site.summary) };
    default:
      return { ...state, ...applyEvent(state, action) };
  }
}

const initialState: State = { ...emptyLiveState, trend: [], backfilled: false };

const SITE_NOT_FOUND = 4404;
// ~30 min of history at the 2 s telemetry interval.
const HISTORY_ROWS = 900;

/** Live site snapshot, command updates and power trend over WebSocket, reconnecting with backoff. */
function useSiteLiveSource(siteId: string) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [connection, setConnection] = useState<Connection>("connecting");

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;
    const history = new AbortController();

    // Recent commands, so statuses survive a page reload.
    api.commands(siteId, history.signal).then(
      (commands) => dispatch({ type: "commands", data: commands }),
      () => undefined,
    );

    let backfillStarted = false;
    async function backfill(devices: Parameters<typeof trendDevices>[0]) {
      backfillStarted = true;
      const relevant = trendDevices(devices);
      const results = await Promise.allSettled(
        relevant.map((device) => api.measurements(siteId, device.id, HISTORY_ROWS, history.signal)),
      );
      if (disposed) return;
      const rows = new Map<string, Measurement[]>();
      results.forEach((result, index) => {
        if (result.status === "fulfilled") rows.set(relevant[index].id, result.value);
      });
      dispatch({ type: "backfill", data: trendFromHistory(relevant, rows) });
    }

    function connect() {
      socket = new WebSocket(liveUrl(siteId));
      socket.onmessage = (message) => {
        const event = typeof message.data === "string" ? parseLiveEvent(message.data) : null;
        if (!event) return;
        attempt = 0;
        setConnection("live");
        dispatch(event);
        if (event.type === "snapshot" && !backfillStarted) void backfill(event.data.devices);
      };
      socket.onclose = (closed) => {
        socket = null;
        if (disposed) return;
        if (closed.code === SITE_NOT_FOUND) {
          setConnection("not-found");
          return;
        }
        setConnection("reconnecting");
        const delay = Math.min(1000 * 2 ** attempt, 10_000);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      disposed = true;
      history.abort();
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [siteId]);

  const sendCommand = useCallback(
    async (deviceId: string, body: CommandRequest) => {
      const command = await api.sendCommand(siteId, deviceId, body);
      dispatch({ type: "command", data: command });
      return command;
    },
    [siteId],
  );

  return { ...state, siteId, connection, sendCommand };
}

export type SiteLive = ReturnType<typeof useSiteLiveSource>;

const SiteLiveContext = createContext<SiteLive | null>(null);

/**
 * One live connection per site, shared by all of the site's tabs. Render it with
 * `key={siteId}` so switching sites starts from empty state: no cross-site leakage.
 */
export function SiteLiveProvider({ siteId, children }: { siteId: string; children: ReactNode }) {
  const live = useSiteLiveSource(siteId);
  return <SiteLiveContext value={live}>{children}</SiteLiveContext>;
}

export function useSiteLive(): SiteLive {
  const live = useContext(SiteLiveContext);
  if (!live) throw new Error("useSiteLive must be used inside SiteLiveProvider");
  return live;
}
