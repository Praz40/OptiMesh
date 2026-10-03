import { describe, expect, it } from "vitest";
import type { SiteSummary } from "./api";
import { flowsFor, formatPower, selfSufficiency } from "./energy";

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
