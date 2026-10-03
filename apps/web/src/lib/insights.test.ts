import { describe, expect, it } from "vitest";
import type { Forecast } from "./api";
import { costNow, forecastCharts, hasForecastValues, intervalAt, isOpenHour } from "./insights";
import { costsFixture, forecastFixture } from "./insights.fixtures";

describe("forecastCharts", () => {
  const charts = forecastCharts(forecastFixture);

  it("puts expected solar and load on one chart, dashed as expectations", () => {
    expect(charts.x).toHaveLength(24);
    expect(charts.x[0]).toBe(Date.parse("2026-10-04T07:00:00Z"));
    expect(charts.energy.map((s) => [s.key, s.tone, s.style])).toEqual([
      ["solar", "solar", "dash"],
      ["load", "consumption", "dash"],
    ]);
    expect(charts.energy[0].values[0]).toBeCloseTo(3774.65, 1);
    expect(charts.energy[1].values[0]).toBe(3200);
  });

  it("keeps prices on their own chart, import and export", () => {
    expect(charts.prices.map((s) => s.key)).toEqual(["import", "export"]);
    expect(charts.prices[0].values.slice(0, 2)).toEqual([0.19, 0.13]);
    expect(charts.prices[1].values.every((v) => v === 0.06)).toBe(true);
    expect(charts.prices.every((s) => s.tone === "price")).toBe(true);
  });

  it("leaves out a series the API has no values for", () => {
    const noSolar: Forecast = {
      ...forecastFixture,
      intervals: forecastFixture.intervals.map((i) => ({ ...i, solar_w: null })),
    };
    expect(forecastCharts(noSolar).energy.map((s) => s.key)).toEqual(["load"]);
    expect(hasForecastValues(noSolar)).toBe(true);
    const nothing: Forecast = { ...noSolar, intervals: noSolar.intervals.map((i) => ({ ...i, load_w: null })) };
    expect(forecastCharts(nothing).energy).toEqual([]);
    expect(hasForecastValues(nothing)).toBe(false);
  });
});

describe("costNow", () => {
  const at = "2026-10-04T07:30:00Z"; // 10:30 in Sofia, the first forecast hour

  it("prices import at this hour's import price", () => {
    const cost = costNow(1840, at, forecastFixture);
    expect(cost).toMatchObject({ direction: "import", price: 0.19, currency: "EUR" });
    expect(cost?.perHour).toBeCloseTo(0.3496, 4);
  });

  it("uses the hour that contains the reading, not always the first one", () => {
    expect(costNow(1000, "2026-10-04T08:05:00Z", forecastFixture)?.price).toBe(0.13);
  });

  it("prices export at the export price, as a negative cost", () => {
    const cost = costNow(-3400, at, forecastFixture);
    expect(cost).toMatchObject({ direction: "export", price: 0.06 });
    expect(cost?.perHour).toBeCloseTo(-0.204, 4);
  });

  it("is hidden when grid power, its time or a covering forecast hour is missing", () => {
    expect(costNow(null, at, forecastFixture)).toBeNull();
    expect(costNow(1840, null, forecastFixture)).toBeNull();
    expect(costNow(1840, at, null)).toBeNull();
    expect(costNow(1840, "2026-10-06T07:30:00Z", forecastFixture)).toBeNull();
    expect(costNow(1840, at, { ...forecastFixture, intervals: [] })).toBeNull();
  });
});

describe("intervalAt and isOpenHour", () => {
  it("treats start as inclusive and end as exclusive", () => {
    expect(intervalAt(forecastFixture, Date.parse("2026-10-04T08:00:00Z"))?.import_price).toBe(0.13);
    expect(intervalAt(forecastFixture, Date.parse("2026-10-04T07:59:59Z"))?.import_price).toBe(0.19);
  });

  it("marks only the hour still being measured as open", () => {
    const open = costsFixture.intervals.filter((i) => isOpenHour(costsFixture, i.end));
    expect(open.map((i) => i.start)).toEqual(["2026-10-04T10:00:00+03:00"]);
  });
});
