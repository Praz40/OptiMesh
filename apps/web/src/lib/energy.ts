import type { CommandStatus, DeviceKind, SiteSummary } from "./api";

export function formatPower(watts: number | null | undefined): string {
  if (watts === null || watts === undefined || !Number.isFinite(watts)) return "—";
  const abs = Math.abs(watts);
  if (abs < 1000) return `${Math.round(watts)} W`;
  const kw = watts / 1000;
  return `${kw.toFixed(abs < 10_000 ? 1 : 0)} kW`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}%`;
}

export const KIND_LABELS: Record<DeviceKind, string> = {
  grid_meter: "Grid meter",
  solar_inverter: "Solar inverter",
  battery: "Battery",
  ev_charger: "EV charger",
  hvac: "HVAC",
  boiler: "Boiler",
  smart_plug: "Smart plug",
  load: "Load",
};

export type FlowNode = "solar" | "grid" | "battery" | "ev" | "home";

export type Flow = {
  node: FlowNode;
  /** Absolute power on this branch, W. null when not measured. */
  watts: number | null;
  /** Direction relative to the site hub. */
  direction: "in" | "out" | "idle";
};

// Below this a branch is drawn idle, so sensor noise does not animate.
export const IDLE_THRESHOLD_W = 20;

function branch(node: FlowNode, signed: number | null, inwardWhenPositive: boolean): Flow {
  if (signed === null) return { node, watts: null, direction: "idle" };
  const watts = Math.abs(signed);
  if (watts < IDLE_THRESHOLD_W) return { node, watts, direction: "idle" };
  const positiveIn = signed > 0 === inwardWhenPositive;
  return { node, watts, direction: positiveIn ? "in" : "out" };
}

/** Branches of a hub-and-spoke energy flow diagram, derived from the site balance. */
export function flowsFor(summary: SiteSummary): Record<FlowNode, Flow> {
  const home =
    summary.consumption_w === null
      ? summary.loads_w
      : Math.max(summary.consumption_w - (summary.ev_w ?? 0), 0);
  return {
    solar: branch("solar", summary.solar_w, true),
    grid: branch("grid", summary.grid_w, true), // + import flows into the site
    battery: branch("battery", summary.battery_w, false), // + charging flows out of the hub
    ev: branch("ev", summary.ev_w, false),
    home: branch("home", home, false),
  };
}

/** Self-sufficiency: share of consumption not covered by grid import. */
export function selfSufficiency(summary: SiteSummary): number | null {
  const { consumption_w: consumption, grid_w: grid } = summary;
  if (consumption === null || grid === null || consumption <= 0) return null;
  return Math.min(Math.max((1 - Math.max(grid, 0) / consumption) * 100, 0), 100);
}

export const COMMAND_LABELS: Record<CommandStatus, string> = {
  pending: "Sending…",
  sent: "Waiting for device…",
  applied: "Applied",
  rejected: "Rejected by device",
  expired: "No response from device",
  failed: "Could not send",
};

export function isFinalStatus(status: CommandStatus): boolean {
  return !["pending", "sent"].includes(status);
}
