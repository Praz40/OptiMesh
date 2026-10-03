import type { Command, CommandStatus, LiveEvent, SiteSnapshot } from "./api";

export type LiveState = {
  snapshot: SiteSnapshot | null;
  commands: Record<string, Command>;
};

export const emptyLiveState: LiveState = { snapshot: null, commands: {} };

const RANK: Record<CommandStatus, number> = {
  pending: 0,
  sent: 1,
  applied: 2,
  rejected: 2,
  expired: 2,
  failed: 2,
};

/** Events can race the POST response; never move a command back to an earlier status. */
export function mergeCommand(commands: Record<string, Command>, next: Command): Record<string, Command> {
  const current = commands[next.id];
  if (current && RANK[next.status] < RANK[current.status]) return commands;
  return { ...commands, [next.id]: next };
}

export function applyEvent(state: LiveState, event: LiveEvent): LiveState {
  if (event.type === "snapshot") return { ...state, snapshot: event.data };
  return { ...state, commands: mergeCommand(state.commands, event.data) };
}

export function latestCommandByDevice(commands: Record<string, Command>): Record<string, Command> {
  const latest: Record<string, Command> = {};
  for (const command of Object.values(commands)) {
    const current = latest[command.device_id];
    if (!current || command.created_at > current.created_at) latest[command.device_id] = command;
  }
  return latest;
}

export function parseLiveEvent(raw: string): LiveEvent | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { type, data } = value as { type?: unknown; data?: unknown };
    if ((type === "snapshot" || type === "command") && typeof data === "object" && data !== null) {
      return value as LiveEvent;
    }
    return null;
  } catch {
    return null;
  }
}
