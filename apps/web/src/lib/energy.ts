import type { CommandStatus, DeviceKind, DeviceLive, SiteSummary } from "./api";
import { formatEnergyBg, formatKwBg, formatNumber } from "./format";

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

/** Splits a power value into a display number and unit, e.g. 1530 -> ["1,5", "kW"]. */
export function powerParts(watts: number | null | undefined): [string, string] {
  if (!finite(watts)) return ["—", ""];
  const abs = Math.abs(watts);
  if (abs < 1000) return [String(Math.round(watts)), "W"];
  return [formatNumber(watts / 1000, abs < 10_000 ? 1 : 0), "kW"];
}

export function formatPower(watts: number | null | undefined): string {
  const [value, unit] = powerParts(watts);
  return unit ? `${value} ${unit}` : value;
}

/** Axis-friendly kW: whole numbers from 10 kW, one decimal below. */
export function formatKw(watts: number): string {
  return formatKwBg(watts);
}

export function formatEnergy(wh: number | null | undefined): string {
  return formatEnergyBg(wh);
}

/** 45.4 -> "45 %", with a space as in Bulgarian. */
export function formatPercent(value: number | null | undefined): string {
  if (!finite(value)) return "—";
  return `${formatNumber(value, 0)} %`;
}

/** "току-що", "преди 12 сек", "преди 4 мин", "преди 2 ч". */
export function formatAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return "никога";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 3) return "току-що";
  if (seconds < 60) return `преди ${seconds} сек`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `преди ${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `преди ${hours} ч`;
  return `преди ${Math.round(hours / 24)} дни`;
}

export function formatClock(iso: string | number, withSeconds = false): string {
  return new Date(iso).toLocaleTimeString("bg-BG", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

export const KIND_LABELS: Record<DeviceKind, string> = {
  grid_meter: "Електромер",
  solar_inverter: "Инвертор",
  battery: "Батерия",
  ev_charger: "Зарядна станция",
  hvac: "Климатизация",
  boiler: "Бойлер",
  smart_plug: "Смарт контакт",
  load: "Товар",
};

/** "1 устройство", "3 устройства". */
export function devicesCount(count: number): string {
  return `${count} ${count === 1 ? "устройство" : "устройства"}`;
}

export type Tone = "good" | "warn" | "bad";

/** Portfolio-level health: are this site's devices reporting? */
export function siteHealth(summary: SiteSummary): { tone: Tone; label: string } {
  const { devices_online: online, devices_total: total } = summary;
  if (total === 0) return { tone: "warn", label: "Няма устройства" };
  if (online === total) return { tone: "good", label: total === 1 ? "1 устройство на линия" : `Всички ${total} устройства на линия` };
  if (online === 0) return { tone: "bad", label: "Нито едно устройство не изпраща данни" };
  const offline = total - online;
  return { tone: "warn", label: `${offline} от ${total} устройства ${offline === 1 ? "не е" : "не са"} на линия` };
}

/** Telemetry is expected every 2–5 s, so a reading older than this is "late" even while online. */
export const LATE_AFTER_S = 8;

export function freshness(live: DeviceLive, now: number): { tone: Tone; label: string } {
  if (!live.online) {
    return {
      tone: "bad",
      label: live.received_at ? `Не е на линия · последни данни ${formatAgo(live.received_at, now)}` : "Никога не се е свързвало",
    };
  }
  const age = live.received_at ? (now - Date.parse(live.received_at)) / 1000 : 0;
  return { tone: age > LATE_AFTER_S ? "warn" : "good", label: `Обновено ${formatAgo(live.received_at, now)}` };
}

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

/** Site consumption excluding EV charging, W. */
export function nonEvConsumption(summary: SiteSummary): number | null {
  return summary.consumption_w === null
    ? summary.loads_w
    : Math.max(summary.consumption_w - (summary.ev_w ?? 0), 0);
}

/** Branches of a hub-and-spoke energy flow diagram, derived from the site balance. */
export function flowsFor(summary: SiteSummary): Record<FlowNode, Flow> {
  return {
    solar: branch("solar", summary.solar_w, true),
    grid: branch("grid", summary.grid_w, true), // + import flows into the site
    battery: branch("battery", summary.battery_w, false), // + charging flows out of the hub
    ev: branch("ev", summary.ev_w, false),
    home: branch("home", nonEvConsumption(summary), false),
  };
}

/** Self-sufficiency: share of consumption not covered by grid import. */
export function selfSufficiency(summary: SiteSummary): number | null {
  const { consumption_w: consumption, grid_w: grid } = summary;
  if (consumption === null || grid === null || consumption <= 0) return null;
  return Math.min(Math.max((1 - Math.max(grid, 0) / consumption) * 100, 0), 100);
}

export type SupplyShare = { source: "solar" | "battery" | "grid"; watts: number };

/** Where the power being consumed right now comes from. Empty when the balance is unknown. */
export function supplyMix(summary: SiteSummary): SupplyShare[] {
  const { consumption_w: consumption, grid_w: grid } = summary;
  if (consumption === null || grid === null || consumption <= 0) return [];
  const fromGrid = Math.max(grid, 0);
  const fromBattery = Math.max(-(summary.battery_w ?? 0), 0);
  const fromSolar = Math.max(consumption - fromGrid - fromBattery, 0);
  return [
    { source: "solar" as const, watts: fromSolar },
    { source: "battery" as const, watts: fromBattery },
    { source: "grid" as const, watts: fromGrid },
  ].filter((share) => share.watts >= IDLE_THRESHOLD_W);
}

export type GridDirection = "importing" | "exporting" | "balanced";

export function gridDirection(watts: number | null): GridDirection | null {
  if (watts === null) return null;
  if (watts > IDLE_THRESHOLD_W) return "importing";
  if (watts < -IDLE_THRESHOLD_W) return "exporting";
  return "balanced";
}

export const GRID_LABELS: Record<GridDirection, string> = {
  importing: "взема от мрежата",
  exporting: "отдава към мрежата",
  balanced: "в баланс",
};

export type BatteryDirection = "charging" | "discharging" | "idle";

export function batteryDirection(watts: number | null): BatteryDirection | null {
  if (watts === null) return null;
  if (watts > IDLE_THRESHOLD_W) return "charging";
  if (watts < -IDLE_THRESHOLD_W) return "discharging";
  return "idle";
}

export const BATTERY_LABELS: Record<BatteryDirection, string> = {
  charging: "зарежда",
  discharging: "разрежда",
  idle: "в покой",
};

export const COMMAND_LABELS: Record<CommandStatus, string> = {
  pending: "Изпраща се…",
  sent: "Чака устройството…",
  applied: "Приложено",
  rejected: "Отказано",
  expired: "Няма отговор",
  failed: "Не е изпратено",
};

export function isFinalStatus(status: CommandStatus): boolean {
  return !["pending", "sent"].includes(status);
}
