import { describe, expect, it } from "vitest";
import type { DeviceLive, SiteSummary } from "./api";
import { flowsFor, formatAgo, formatPower, freshness, selfSufficiency, siteHealth, supplyMix } from "./energy";

const base: SiteSummary = {
  solar_w: null,
  grid_w: null,
  battery_w: null,
  battery_soc_pct: null,
  ev_w: null,
  loads_w: null,
  consumption_w: null,
  unmeasured_w: null,
  devices_online: 0,
  devices_total: 0,
  updated_at: null,
};

describe("formatPower", () => {
  it("uses W below 1 kW and kW above", () => {
    expect(formatPower(850.4)).toBe("850 W");
    expect(formatPower(1234)).toBe("1.2 kW");
    expect(formatPower(-4500)).toBe("-4.5 kW");
    expect(formatPower(28_328)).toBe("28 kW");
  });

  it("shows a dash for missing values", () => {
    expect(formatPower(null)).toBe("—");
    expect(formatPower(Number.NaN)).toBe("—");
  });
});

describe("flowsFor", () => {
  it("maps the site balance to flow directions around the hub", () => {
    const flows = flowsFor({
      ...base,
      solar_w: 5000,
      grid_w: -800, // exporting
      battery_w: 1200, // charging
      ev_w: 2000,
      consumption_w: 3000,
    });
    expect(flows.solar).toEqual({ node: "solar", watts: 5000, direction: "in" });
    expect(flows.grid).toEqual({ node: "grid", watts: 800, direction: "out" });
    expect(flows.battery).toEqual({ node: "battery", watts: 1200, direction: "out" });
    expect(flows.ev).toEqual({ node: "ev", watts: 2000, direction: "out" });
    expect(flows.home).toEqual({ node: "home", watts: 1000, direction: "out" });
  });

  it("treats grid import and battery discharge as inflows", () => {
    const flows = flowsFor({ ...base, grid_w: 1500, battery_w: -700, consumption_w: 2200 });
    expect(flows.grid.direction).toBe("in");
    expect(flows.battery.direction).toBe("in");
  });

  it("keeps unknown and near-zero branches idle", () => {
    const flows = flowsFor({ ...base, solar_w: 5, loads_w: 300 });
    expect(flows.solar.direction).toBe("idle");
    expect(flows.grid).toEqual({ node: "grid", watts: null, direction: "idle" });
    expect(flows.home.watts).toBe(300);
  });
});

describe("selfSufficiency", () => {
  it("is the share of consumption not imported", () => {
    expect(selfSufficiency({ ...base, consumption_w: 4000, grid_w: 1000 })).toBe(75);
    expect(selfSufficiency({ ...base, consumption_w: 4000, grid_w: -500 })).toBe(100);
    expect(selfSufficiency({ ...base, consumption_w: 4000 })).toBeNull();
  });
});

describe("supplyMix", () => {
  it("splits consumption into solar, battery and grid shares", () => {
    const mix = supplyMix({ ...base, consumption_w: 4000, grid_w: 1000, battery_w: -1000, solar_w: 2000 });
    expect(mix).toEqual([
      { source: "solar", watts: 2000 },
      { source: "battery", watts: 1000 },
      { source: "grid", watts: 1000 },
    ]);
  });

  it("ignores export and battery charging, and is empty when the balance is unknown", () => {
    const mix = supplyMix({ ...base, consumption_w: 1000, grid_w: -3000, battery_w: 1000, solar_w: 5000 });
    expect(mix).toEqual([{ source: "solar", watts: 1000 }]);
    expect(supplyMix({ ...base, consumption_w: 1000 })).toEqual([]);
  });
});

describe("freshness", () => {
  const now = Date.parse("2026-10-03T10:00:30Z");
  const live: DeviceLive = {
    device_id: "d",
    online: true,
    observed_at: null,
    received_at: "2026-10-03T10:00:28Z",
    metrics: null,
    state: null,
  };

  it("is good for recent readings and warns when readings run late", () => {
    expect(freshness(live, now)).toEqual({ tone: "good", label: "Updated just now" });
    expect(freshness({ ...live, received_at: "2026-10-03T10:00:18Z" }, now).tone).toBe("warn");
  });

  it("reports offline devices with when they were last seen", () => {
    expect(freshness({ ...live, online: false, received_at: "2026-10-03T09:58:30Z" }, now)).toEqual({
      tone: "bad",
      label: "Offline · last seen 2 min ago",
    });
    expect(freshness({ ...live, online: false, received_at: null }, now).label).toBe("Never connected");
  });
});

describe("siteHealth", () => {
  it("summarizes how many devices report", () => {
    expect(siteHealth({ ...base, devices_online: 3, devices_total: 3 }).tone).toBe("good");
    expect(siteHealth({ ...base, devices_online: 2, devices_total: 3 }).label).toBe("1 of 3 devices offline");
    expect(siteHealth({ ...base, devices_online: 0, devices_total: 3 }).tone).toBe("bad");
  });
});

describe("formatAgo", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  it("uses the largest sensible unit", () => {
    expect(formatAgo("2026-10-03T11:59:59Z", now)).toBe("just now");
    expect(formatAgo("2026-10-03T11:59:15Z", now)).toBe("45 s ago");
    expect(formatAgo("2026-10-03T11:30:00Z", now)).toBe("30 min ago");
    expect(formatAgo("2026-10-03T09:00:00Z", now)).toBe("3 h ago");
    expect(formatAgo(null, now)).toBe("never");
  });
});
