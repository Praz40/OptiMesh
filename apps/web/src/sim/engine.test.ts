import { describe, expect, it } from "vitest";
import { defaultControls, initialState, run, step, toSiteSummary, type Controls, type Policy } from "./engine";
import { metricsFor } from "./metrics";
import { autopilotPolicy, baselinePolicy, idlePolicy } from "./policies";
import { officeScenario, type Scenario } from "./scenario";

const scenario = officeScenario(7);
const POLICIES: [string, Policy][] = [
  ["idle", idlePolicy],
  ["baseline", baselinePolicy],
  ["autopilot", autopilotPolicy],
  ["always discharge", (s) => ({ ...defaultControls(s), battery: "discharge" })],
  ["always charge", (s) => ({ ...defaultControls(s), battery: "charge" })],
];

describe("scenario", () => {
  it("is reproducible from its seed", () => {
    expect(officeScenario(7)).toEqual(officeScenario(7));
    expect(officeScenario(8).series.solarW).not.toEqual(officeScenario(7).series.solarW);
  });

  it("uses the seeded Office devices and UTC 15-minute intervals", () => {
    expect(scenario.devices.map((d) => d.kind)).toEqual([
      "grid_meter",
      "solar_inverter",
      "battery",
      "hvac",
      "ev_charger",
      "ev_charger",
      "ev_charger",
    ]);
    expect(scenario.chargers).toHaveLength(3);
    expect(scenario.evs).toHaveLength(10);
    expect(new Date(scenario.start).toISOString()).toBe("2026-06-17T03:00:00.000Z"); // 06:00 in Sofia
    expect(scenario.stepMinutes).toBe(15);
  });
});

describe("step", () => {
  it.each(POLICIES)("conserves energy in every interval (%s)", (_, policy) => {
    const state = run(scenario, policy);
    expect(state.records).toHaveLength(scenario.steps);
    for (const r of state.records) {
      // Contract signs: grid + import, battery + charging. Supply equals demand.
      expect(r.gridW + r.solarW).toBeCloseTo(r.baseW + r.hvacW + r.evW + r.batteryW, 6);
    }
  });

  it.each(POLICIES)("keeps the battery within its state-of-charge limits (%s)", (_, policy) => {
    const { capacityWh, minSoc, maxSoc, maxW } = scenario.site.battery;
    for (const r of run(scenario, policy).records) {
      expect(r.socWh).toBeGreaterThanOrEqual(capacityWh * minSoc - 1e-6);
      expect(r.socWh).toBeLessThanOrEqual(capacityWh * maxSoc + 1e-6);
      expect(Math.abs(r.batteryW)).toBeLessThanOrEqual(maxW + 1e-6);
    }
  });

  it("loses energy on a charge/discharge round trip", () => {
    const flat: Scenario = { ...scenario, series: { ...scenario.series, solarW: scenario.series.solarW.map(() => 0) } };
    const charge: Controls = { ...defaultControls(flat), battery: "charge", hvacSetpointC: null };
    let state = initialState(flat);
    const startWh = state.socWh;
    state = step(flat, state, charge);
    const storedWh = state.socWh - startWh;
    const gridInWh = (state.records[0].batteryW * 15) / 60;
    expect(storedWh).toBeLessThan(gridInWh);
    expect(storedWh / gridInWh).toBeCloseTo(Math.sqrt(0.95), 6);
  });

  it("is deterministic: the same inputs give the same run", () => {
    expect(run(officeScenario(7), autopilotPolicy)).toEqual(run(officeScenario(7), autopilotPolicy));
  });

  it("never charges a car faster than its charger or onboard limit, nor beyond its request", () => {
    const state = run(scenario, baselinePolicy);
    for (const r of state.records) {
      for (const charger of scenario.chargers) expect(r.chargerW[charger.id]).toBeLessThanOrEqual(charger.maxW);
    }
    for (const ev of scenario.evs) expect(state.deliveredWh[ev.id]).toBeLessThanOrEqual(ev.needWh + 1e-6);
  });

  it("ignores plugs for cars that are not parked or already on another charger", () => {
    const [c1, c2, c3] = scenario.chargers;
    const boris = scenario.evs[0]; // arrives 07:30, so not at 06:00
    const controls: Controls = { ...defaultControls(scenario), plugs: { [c1.id]: boris.id, [c2.id]: null, [c3.id]: null } };
    const early = step(scenario, initialState(scenario), controls);
    expect(early.records[0].evW).toBe(0);

    let state = initialState(scenario);
    while (state.step < 6) state = step(scenario, state, defaultControls(scenario)); // 07:30
    const twice: Controls = { ...defaultControls(scenario), plugs: { [c1.id]: boris.id, [c2.id]: boris.id, [c3.id]: null } };
    const next = step(scenario, state, twice);
    expect(next.records.at(-1)?.chargerW[c2.id]).toBe(0);
    expect(next.records.at(-1)?.chargerW[c1.id]).toBeGreaterThan(0);
  });

  it("unplugs cars when they leave and records whether they were ready", () => {
    const state = run(scenario, baselinePolicy);
    expect(Object.values(state.plugs).every((plug) => plug === null)).toBe(true);
    const departures = state.events.filter((event) => event.kind === "departure");
    expect(departures).toHaveLength(10);
    expect(state.events.filter((event) => event.kind === "arrival")).toHaveLength(10);
  });

  it("reports infeasible demand as unserved energy instead of hiding it", () => {
    const greedy: Scenario = { ...scenario, evs: scenario.evs.map((ev) => ({ ...ev, needWh: 200_000 })) };
    const metrics = metricsFor(greedy, run(greedy, autopilotPolicy));
    expect(metrics.evsOnTime).toBe(0);
    expect(metrics.unservedWh).toBeGreaterThan(1_000_000);
  });

  it("curtails solar it can neither use nor export", () => {
    const sunny: Scenario = {
      ...scenario,
      site: { ...scenario.site, exportLimitW: 1000 },
      series: { ...scenario.series, solarW: scenario.series.solarW.map(() => 30_000) },
    };
    const state = run(sunny, (s) => ({ ...defaultControls(s), battery: "hold" }));
    for (const r of state.records) expect(r.gridW).toBeGreaterThanOrEqual(-1000 - 1e-6);
    expect(metricsFor(sunny, state).curtailedWh).toBeGreaterThan(0);
  });

  it("counts discomfort when the office is left without cooling", () => {
    const hot = run(scenario, (s) => ({ ...defaultControls(s), hvacSetpointC: null }));
    expect(metricsFor(scenario, hot).comfortDegreeHours).toBeGreaterThan(1);
    expect(hot.events.some((event) => event.kind === "comfort")).toBe(true);
  });
});

describe("toSiteSummary", () => {
  it("speaks the platform's summary contract, so live components render the simulation", () => {
    const record = run(scenario, autopilotPolicy).records[28]; // 13:00 local
    const summary = toSiteSummary(scenario, record);
    // The backend balance: consumption = grid + solar - battery.
    expect(summary.consumption_w).toBeCloseTo((summary.grid_w ?? 0) + (summary.solar_w ?? 0) - (summary.battery_w ?? 0), 6);
    expect(summary.ev_w).toBe(record.evW);
    expect(summary.battery_soc_pct).toBeCloseTo((record.socWh / 50_000) * 100, 6);
    expect(summary.devices_online).toBe(scenario.devices.length);
    expect(toSiteSummary(scenario, undefined).grid_w).toBeNull();
  });
});
