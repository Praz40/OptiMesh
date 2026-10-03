"use client";

import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";
import { useSiteLive } from "@/hooks/use-site-live";
import { guardSend, loadMode, modeReducer, saveMode, type SiteMode } from "@/lib/site-mode";

type SiteModeValue = {
  mode: SiteMode;
  select: (mode: SiteMode) => void;
  /** sendCommand from the live connection, gated by the mode: outside Assist it sends nothing. */
  send: ReturnType<typeof guardSend>;
};

const SiteModeContext = createContext<SiteModeValue | null>(null);

/**
 * The site's mode, remembered per site in localStorage. Render it inside SiteLiveProvider and
 * with `key={siteId}`, so another site starts from its own stored mode. The mode is read on the
 * client only: SiteFrame renders nothing mode-dependent before the first live snapshot.
 */
export function SiteModeProvider({ siteId, children }: { siteId: string; children: ReactNode }) {
  const { sendCommand } = useSiteLive();
  const [mode, dispatch] = useReducer(modeReducer, siteId, loadMode);

  const select = useCallback(
    (next: SiteMode) => {
      const chosen = modeReducer(mode, { type: "select", mode: next });
      dispatch({ type: "select", mode: next });
      saveMode(siteId, chosen);
    },
    [mode, siteId],
  );
  const send = useMemo(() => guardSend(mode, sendCommand), [mode, sendCommand]);
  const value = useMemo(() => ({ mode, select, send }), [mode, select, send]);

  return <SiteModeContext value={value}>{children}</SiteModeContext>;
}

export function useSiteMode(): SiteModeValue {
  const value = useContext(SiteModeContext);
  if (!value) throw new Error("useSiteMode must be used inside SiteModeProvider");
  return value;
}
