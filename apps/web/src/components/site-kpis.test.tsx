import { describe, expect, it } from "vitest";
import { forecastFixture } from "@/lib/insights.fixtures";
import { costNow } from "@/lib/insights";
import type { Device, SiteSummary } from "@/lib/api";
import { costNowTile, siteTiles } from "./site-kpis";

const NBSP = " ";
const at = "2026-10-04T07:30:00Z";

describe("costNowTile", () => {
  it("shows grid power × the current import price, per hour", () => {
    const tile = costNowTile(costNow(1840, at, forecastFixture)!);
    expect(tile).toMatchObject({ key: "cost-now", label: "Разход в момента", tone: "price", unit: "/ч" });
    expect(tile.value).toBe(`0,35${NBSP}€`);
    expect(tile.note).toBe(`покупка 1,8 kW × 0,19${NBSP}€/kWh`);
  });

  it("shows export as revenue at the export price", () => {
    const tile = costNowTile(costNow(-3400, at, forecastFixture)!);
    expect(tile.value).toBe(`-0,20${NBSP}€`);
    expect(tile.note).toBe(`приход: отдаване 3,4 kW × 0,06${NBSP}€/kWh`);
  });

  it("is appended after the live tiles", () => {
    const summary: SiteSummary = {
      solar_w: null,
      grid_w: 1840,
      battery_w: null,
      battery_soc_pct: null,
      ev_w: null,
      loads_w: null,
      consumption_w: 1840,
      unmeasured_w: null,
      devices_online: 1,
      devices_total: 1,
      updated_at: at,
    };
    const meter: Device = {
      id: "de000000-0000-4000-8000-000000001001",
      site_id: forecastFixture.site_id,
      name: "Grid meter",
      kind: "grid_meter",
      source: "simulator",
      capabilities: ["measure_power", "measure_energy"],
      limits: { min_power_w: null, max_power_w: null, capacity_wh: null },
    };
    const tiles = siteTiles(summary, [meter], [costNowTile(costNow(summary.grid_w, summary.updated_at, forecastFixture)!)]);
    expect(tiles.map((t) => t.key)).toEqual(["grid", "consumption", "cost-now"]);
  });
});
