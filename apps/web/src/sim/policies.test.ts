import { describe, expect, it } from "vitest";
import { initialState, run, step } from "./engine";
import { metricsFor } from "./metrics";
import { autopilotPolicy, baselinePolicy, carsToChargeNow, PEAK_CAP_W } from "./policies";
import { officeScenario } from "./scenario";

const SEEDS = [7, 1, 42];

describe.each(SEEDS)("office scenario, seed %i", (seed) => {
  const scenario = officeScenario(seed);
  const baseline = metricsFor(scenario, run(scenario, baselinePolicy));
  const autopilot = metricsFor(scenario, run(scenario, autopilotPolicy));

  it("is feasible: Autopilot gets every car charged on time", () => {
    expect(autopilot.evsOnTime).toBe(10);
    expect(autopilot.unservedWh).toBe(0);
  });

  it("keeps the office comfortable and the connection within limits", () => {
    expect(autopilot.comfortDegreeHours).toBeLessThan(0.25);
    expect(autopilot.overloadIntervals).toBe(0);
  });

  it("stays within the peak cap the baseline exceeds", () => {
    expect(autopilot.peakImportW).toBeLessThanOrEqual(PEAK_CAP_W + 1);
    expect(baseline.peakImportW).toBeGreaterThan(PEAK_CAP_W * 1.3);
  });

  it("costs less than the baseline once the final battery charge is accounted for", () => {
    expect(autopilot.adjustedCostEur).toBeLessThan(baseline.adjustedCostEur);
  });
});

describe("baseline", () => {
  it("misses deadlines: long-stay cars block the chargers (why scheduling matters here)", () => {
    const scenario = officeScenario(7);
    const metrics = metricsFor(scenario, run(scenario, baselinePolicy));
    expect(metrics.evsOnTime).toBeLessThan(10);
    expect(metrics.unservedWh).toBeGreaterThan(0);
  });
});

describe("carsToChargeNow", () => {
  it("never plans more cars than there are chargers, at any point of the day", () => {
    const scenario = officeScenario(7);
    let state = initialState(scenario);
    while (state.step < scenario.steps) {
      expect(carsToChargeNow(scenario, state).length).toBeLessThanOrEqual(scenario.chargers.length);
      state = step(scenario, state, autopilotPolicy(scenario, state));
    }
  });
});
