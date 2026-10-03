"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { api, liveUrl, type Command, type CommandRequest, type LiveEvent } from "@/lib/api";
import { applyEvent, emptyLiveState, mergeCommand, parseLiveEvent, type LiveState } from "@/lib/live-state";

export type Connection = "connecting" | "live" | "reconnecting" | "not-found";

type Action = LiveEvent | { type: "commands"; data: Command[] };

function reducer(state: LiveState, action: Action): LiveState {
  if (action.type === "commands") {
    return { ...state, commands: action.data.reduce(mergeCommand, state.commands) };
  }
  return applyEvent(state, action);
}

const SITE_NOT_FOUND = 4404;

/** Live site snapshot and command updates over WebSocket, reconnecting with backoff. */
export function useSiteLive(siteId: string) {
  const [state, dispatch] = useReducer(reducer, emptyLiveState);
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

    function connect() {
      socket = new WebSocket(liveUrl(siteId));
      socket.onmessage = (message) => {
        const event = typeof message.data === "string" ? parseLiveEvent(message.data) : null;
        if (!event) return;
        attempt = 0;
        setConnection("live");
        dispatch(event);
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

  return { ...state, connection, sendCommand };
}
