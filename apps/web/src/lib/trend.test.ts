import { describe, expect, it } from "vitest";
import type { Device, Measurement, SiteSummary } from "./api";
import { mergeTrend, pushTrend, TREND_BUCKET_MS, TREND_WINDOW_MS, trendFromHistory, type TrendPoint } from "./trend";

const summary = (updatedAt: string, overrides: Partial<SiteSummary> = {}): SiteSummary => ({
  solar_w: 1000,
  grid_w: 200,
  battery_w: 0,
  battery_soc_pct: 50,
  ev_w: null,
  loads_w: null,
  consumption_w: 1200,
  unmeasured_w: 0,
  devices_online: 3,
  devices_total: 3,
  updated_at: updatedAt,
  ...overrides,
});

function device(id: string, kind: Device["kind"]): Device {
  return {
    id,
    site_id: "s",
    name: id,
    kind,
    source: "simulator",
    capabilities: ["measure_power"],
    limits: { min_power_w: null, max_power_w: null, capacity_wh: null },
  };
}

function reading(observedAt: string, power: number): Measurement {
  return { observed_at: observedAt, power_w: power, energy_wh: null, soc_pct: null, voltage_v: null, current_a: null, state: null };
}

describe("pushTrend", () => {
  it("keeps one point per bucket, the latest snapshot winning", () => {
    let points: TrendPoint[] = [];
    points = pushTrend(points, summary("2026-10-03T10:00:01Z", { solar_w: 900 }));
    points = pushTrend(points, summary("2026-10-03T10:00:05Z", { solar_w: 950 }));
    points = pushTrend(points, summary("2026-10-03T10:00:12Z", { solar_w: 1000 }));
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.solar)).toEqual([950, 1000]);
    expect(points[1].t - points[0].t).toBe(TREND_BUCKET_MS);
  });

  it("ignores snapshots without a timestamp or older than the newest point", () => {
    const points = pushTrend([], summary("2026-10-03T10:00:30Z"));
    expect(pushTrend(points, summary("2026-10-03T10:00:01Z"))).toBe(points);
    expect(pushTrend(points, { ...summary(""), updated_at: null })).toBe(points);
  });

  it("drops points that fall out of the window", () => {
    const start = Date.parse("2026-10-03T10:00:00Z");
    let points: TrendPoint[] = [];
    points = pushTrend(points, summary(new Date(start).toISOString()));
    points = pushTrend(points, summary(new Date(start + TREND_WINDOW_MS + TREND_BUCKET_MS).toISOString()));
    expect(points).toHaveLength(1);
  });
});

describe("mergeTrend", () => {
  it("lets later series override earlier ones in the same bucket", () => {
    const old: TrendPoint = { t: 0, solar: 1, grid: 1, battery: 1, ev: 1, consumption: 1 };
    const fresh: TrendPoint = { ...old, solar: 2 };
    expect(mergeTrend([old], [fresh])).toEqual([fresh]);
  });
});

describe("trendFromHistory", () => {
  const devices = [device("g", "grid_meter"), device("s", "solar_inverter"), device("b", "battery")];

  it("averages each device per bucket and derives consumption from the balance", () => {
    const history = new Map([
      ["g", [reading("2026-10-03T10:00:01Z", 100), reading("2026-10-03T10:00:03Z", 300)]],
      ["s", [reading("2026-10-03T10:00:02Z", 2000)]],
      ["b", [reading("2026-10-03T10:00:02Z", 500)]],
    ]);
    const [point] = trendFromHistory(devices, history);
    expect(point).toMatchObject({ grid: 200, solar: 2000, battery: 500, consumption: 1700 });
  });

  it("leaves consumption unknown when a balance device is missing from a bucket", () => {
    const history = new Map([
      ["g", [reading("2026-10-03T10:00:01Z", 100)]],
      ["s", [reading("2026-10-03T10:00:02Z", 2000)]],
    ]);
    const [point] = trendFromHistory(devices, history);
    expect(point.battery).toBeNull();
    expect(point.consumption).toBeNull();
  });

  it("returns points in time order", () => {
    const history = new Map([
      ["g", [reading("2026-10-03T10:00:21Z", 1), reading("2026-10-03T10:00:01Z", 2)]],
    ]);
    const points = trendFromHistory([device("g", "grid_meter")], history);
    expect(points.map((p) => p.grid)).toEqual([2, 1]);
    expect(points[0].consumption).toBe(2); // grid only: consumption equals import
  });
});
