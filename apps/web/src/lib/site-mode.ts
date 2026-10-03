import type { Command, CommandRequest } from "./api";

/**
 * How much the dashboard may do on a real site (issue #10):
 * - monitor: read-only, no command can be sent;
 * - assist: recommendations with an explicit "Приложи", manual controls available;
 * - autopilot: shown but never selectable for real sites; it runs only in the simulator.
 */
export type SiteMode = "monitor" | "assist" | "autopilot";

/** Read-only until the user chooses Assist. */
export const DEFAULT_MODE: SiteMode = "monitor";

export type ModeAction = { type: "select"; mode: SiteMode };

export function modeReducer(state: SiteMode, action: ModeAction): SiteMode {
  // Hardware Autopilot stays disabled until its failure handling exists.
  if (action.mode === "autopilot") return state;
  return action.mode;
}

/** A stored value back to a mode. Anything unknown, and Autopilot, falls back to the default. */
export function parseMode(raw: string | null | undefined): SiteMode {
  return raw === "monitor" || raw === "assist" ? raw : DEFAULT_MODE;
}

export const modeKey = (siteId: string) => `optimesh.mode.${siteId}`;

type ModeStorage = Pick<Storage, "getItem" | "setItem">;

/** localStorage, or null where it is missing or blocked (server render, private mode, policy). */
export function browserStorage(): ModeStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadMode(siteId: string, storage: ModeStorage | null = browserStorage()): SiteMode {
  try {
    return parseMode(storage?.getItem(modeKey(siteId)));
  } catch {
    return DEFAULT_MODE;
  }
}

/** Remembers the mode per site. Returns false when storage refused it; the mode still applies until reload. */
export function saveMode(siteId: string, mode: SiteMode, storage: ModeStorage | null = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(modeKey(siteId), mode);
    return true;
  } catch {
    return false;
  }
}

export function canSendCommands(mode: SiteMode): boolean {
  return mode === "assist";
}

export class ReadOnlyModeError extends Error {
  constructor() {
    super("Режим „Наблюдение“ е само за четене");
  }
}

type Send = (deviceId: string, body: CommandRequest) => Promise<Command>;

/** The one gate every command passes: outside Assist it rejects without calling `send`. */
export function guardSend(mode: SiteMode, send: Send): Send {
  return (deviceId, body) => (canSendCommands(mode) ? send(deviceId, body) : Promise.reject(new ReadOnlyModeError()));
}
