import { describe, expect, it } from "vitest";
import {
  formatEnergyBg,
  formatHourRange,
  formatKwBg,
  formatMoney,
  formatNumber,
  formatPowerBg,
  formatPrice,
  formatSiteTime,
} from "./format";

const NBSP = " ";

describe("Bulgarian number formatting", () => {
  it("uses a decimal comma and groups thousands with a no-break space", () => {
    expect(formatNumber(3.7746)).toBe("3,8");
    expect(formatNumber(0.5, 2)).toBe("0,50");
    expect(formatNumber(12345.6)).toBe(`12${NBSP}345,6`);
  });

  it("never shows a negative zero", () => {
    expect(formatNumber(-0.01)).toBe("0,0");
    expect(formatMoney(-0.001, "EUR")).toBe(`0,00${NBSP}€`);
  });

  it("formats money and prices in the response's currency", () => {
    expect(formatMoney(0.9265, "EUR")).toBe(`0,93${NBSP}€`);
    expect(formatMoney(-0.039, "EUR")).toBe(`-0,04${NBSP}€`);
    expect(formatPrice(0.19, "EUR")).toBe(`0,19${NBSP}€/kWh`);
  });

  it("formats power and energy with W below 1 k and k above", () => {
    expect(formatPowerBg(850.4)).toBe("850 W");
    expect(formatPowerBg(1840)).toBe("1,8 kW");
    expect(formatPowerBg(28_328)).toBe("28 kW");
    expect(formatKwBg(2500)).toBe("2,5 kW");
    expect(formatKwBg(10_000)).toBe("10 kW");
    expect(formatEnergyBg(380)).toBe("380 Wh");
    expect(formatEnergyBg(6370)).toBe("6,4 kWh");
  });

  it("shows a dash for missing values", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatMoney(Number.NaN, "EUR")).toBe("—");
    expect(formatPrice(undefined, "EUR")).toBe("—");
    expect(formatPowerBg(null)).toBe("—");
    expect(formatEnergyBg(null)).toBe("—");
  });
});

describe("site times", () => {
  it("shows the site's wall clock, whatever the browser's zone", () => {
    expect(formatSiteTime("2026-10-04T07:20:00Z", "Europe/Sofia")).toBe("10:20");
    expect(formatSiteTime("2026-10-04T21:00:00Z", "Europe/Sofia")).toBe("00:00");
    expect(formatHourRange("2026-10-04T10:00:00+03:00", "2026-10-04T11:00:00+03:00", "Europe/Sofia")).toBe(
      "10:00–11:00",
    );
  });

  it("falls back to UTC for an unknown zone, as the API does", () => {
    expect(formatSiteTime("2026-10-04T07:20:00Z", "Not/AZone")).toBe("07:20");
  });
});
