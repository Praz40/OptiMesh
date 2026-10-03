import type { Device, DeviceKind, Measurement, SiteSummary } from "./api";

/** One point of the site power trend, W. Signs follow SiteSummary. */
export type TrendPoint = {
  t: number;
  solar: number | null;
  grid: number | null;
  battery: number | null;
  ev: number | null;
  consumption: number | null;
};

export const TREND_BUCKET_MS = 10_000;
export const TREND_WINDOW_MS = 30 * 60_000;

function bucketOf(t: number): number {
  return Math.floor(t / TREND_BUCKET_MS) * TREND_BUCKET_MS;
}

export function pointFromSummary(summary: SiteSummary): TrendPoint | null {
  if (!summary.updated_at) return null;
  return {
    t: bucketOf(Date.parse(summary.updated_at)),
    solar: summary.solar_w,
    grid: summary.grid_w,
    battery: summary.battery_w,
    ev: summary.ev_w,
    consumption: summary.consumption_w,
  };
}

/** Merges points by bucket (later input wins) and trims to the window ending at the newest point. */
export function mergeTrend(...series: TrendPoint[][]): TrendPoint[] {
  const byBucket = new Map<number, TrendPoint>();
  for (const points of series) for (const point of points) byBucket.set(point.t, point);
  const sorted = [...byBucket.values()].sort((a, b) => a.t - b.t);
  const newest = sorted.at(-1)?.t ?? 0;
  return sorted.filter((point) => point.t > newest - TREND_WINDOW_MS);
}

/** Appends a live snapshot. Snapshots arrive per telemetry message; the latest in a bucket wins. */
export function pushTrend(points: TrendPoint[], summary: SiteSummary): TrendPoint[] {
  const point = pointFromSummary(summary);
  if (!point) return points;
  const last = points.at(-1);
  if (last && point.t < last.t) return points; // out-of-order snapshot
  return mergeTrend(points, [point]);
}

type Role = "solar" | "grid" | "battery" | "ev" | "load";

const ROLE_BY_KIND: Partial<Record<DeviceKind, Role>> = {
  solar_inverter: "solar",
  grid_meter: "grid",
  battery: "battery",
  ev_charger: "ev",
};

const roleOf = (kind: DeviceKind): Role => ROLE_BY_KIND[kind] ?? "load";

/**
 * Rebuilds the recent trend from per-device measurement history, using the same
 * balance rules as the backend summary: consumption = grid + solar - battery,
 * known only when every grid, solar and battery device reported in that bucket.
 */
export function trendFromHistory(devices: Device[], history: Map<string, Measurement[]>): TrendPoint[] {
  // bucket -> device -> [sum, count]
  const buckets = new Map<number, Map<string, [number, number]>>();
  for (const device of devices) {
    for (const row of history.get(device.id) ?? []) {
      if (row.power_w === null) continue;
      const t = bucketOf(Date.parse(row.observed_at));
      const perDevice = buckets.get(t) ?? new Map<string, [number, number]>();
      const [sum, count] = perDevice.get(device.id) ?? [0, 0];
      perDevice.set(device.id, [sum + row.power_w, count + 1]);
      buckets.set(t, perDevice);
    }
  }

  const byRole = new Map<Role, Device[]>();
  for (const device of devices) byRole.set(roleOf(device.kind), [...(byRole.get(roleOf(device.kind)) ?? []), device]);

  const points: TrendPoint[] = [];
  for (const [t, perDevice] of buckets) {
    const total = (role: Role): number | null => {
      const members = byRole.get(role) ?? [];
      if (members.length === 0) return null;
      let sum = 0;
      for (const device of members) {
        const reading = perDevice.get(device.id);
        if (!reading) return null; // incomplete bucket: unknown rather than wrong
        sum += reading[0] / reading[1];
      }
      return sum;
    };
    const solar = total("solar");
    const grid = total("grid");
    const battery = total("battery");
    const ev = total("ev");
    const balanceKnown =
      grid !== null &&
      (solar !== null || !byRole.has("solar")) &&
      (battery !== null || !byRole.has("battery"));
    points.push({
      t,
      solar,
      grid,
      battery,
      ev,
      consumption: balanceKnown ? grid + (solar ?? 0) - (battery ?? 0) : null,
    });
  }
  return mergeTrend(points);
}

/** Devices whose history contributes to the trend. */
export function trendDevices(devices: Device[]): Device[] {
  return devices.filter((device) => roleOf(device.kind) !== "load");
}
