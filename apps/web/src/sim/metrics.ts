import { DONE_TOLERANCE_WH, hoursPerStep, type SimState } from "./engine";
import type { Scenario } from "./scenario";

export type RunMetrics = {
  /** Import cost minus export revenue, EUR. */
  energyCostEur: number;
  /**
   * Energy cost adjusted for the battery ending fuller or emptier than it started:
   * the difference is valued at the day's average import price. Without this, a run
   * could look cheaper just by draining the battery.
   */
  adjustedCostEur: number;
  batteryDeltaWh: number;
  importWh: number;
  exportWh: number;
  /** Highest 15-minute average import, W. */
  peakImportW: number;
  solarWh: number;
  curtailedWh: number;
  /** Share of available solar used on site (directly or via the battery), 0–1. */
  solarUtilization: number;
  /** Energy charged plus discharged, Wh. */
  batteryThroughputWh: number;
  evsOnTime: number;
  evsTotal: number;
  unservedWh: number;
  /** Degree-hours outside the comfort band while the office is occupied. */
  comfortDegreeHours: number;
  overloadIntervals: number;
  plugChanges: number;
};

export function averageImportPrice(scenario: Scenario): number {
  const prices = scenario.series.importPrice;
  return prices.reduce((sum, price) => sum + price, 0) / prices.length;
}

export function metricsFor(scenario: Scenario, state: SimState): RunMetrics {
  const dt = hoursPerStep(scenario);
  const { comfortMinC, comfortMaxC } = scenario.site.hvac;
  let energyCostEur = 0;
  let importWh = 0;
  let exportWh = 0;
  let peakImportW = 0;
  let solarWh = 0;
  let curtailedWh = 0;
  let solarExportedWh = 0;
  let batteryThroughputWh = 0;
  let comfortDegreeHours = 0;
  let overloadIntervals = 0;

  state.records.forEach((record, i) => {
    energyCostEur += record.costEur;
    const gridWh = record.gridW * dt;
    if (gridWh > 0) importWh += gridWh;
    else exportWh -= gridWh;
    peakImportW = Math.max(peakImportW, record.gridW);
    solarWh += (record.solarW + record.curtailedW) * dt;
    curtailedWh += record.curtailedW * dt;
    // Export is attributed to solar first; any remainder came from the battery.
    solarExportedWh += Math.min(Math.max(-record.gridW, 0), record.solarW) * dt;
    batteryThroughputWh += Math.abs(record.batteryW) * dt;
    if (scenario.series.occupied[i]) {
      const outside = Math.max(record.indoorC - comfortMaxC, comfortMinC - record.indoorC, 0);
      comfortDegreeHours += outside * dt;
    }
    if (record.overload) overloadIntervals += 1;
  });

  const unserved = scenario.evs.map((ev) => Math.max(ev.needWh - (state.deliveredWh[ev.id] ?? 0), 0));
  const initialWh = scenario.site.battery.capacityWh * scenario.site.battery.initialSoc;
  const batteryDeltaWh = state.socWh - initialWh;

  return {
    energyCostEur,
    adjustedCostEur: energyCostEur - (batteryDeltaWh / 1000) * averageImportPrice(scenario),
    batteryDeltaWh,
    importWh,
    exportWh,
    peakImportW,
    solarWh,
    curtailedWh,
    solarUtilization: solarWh > 0 ? (solarWh - curtailedWh - solarExportedWh) / solarWh : 0,
    batteryThroughputWh,
    evsOnTime: unserved.filter((wh) => wh <= DONE_TOLERANCE_WH).length,
    evsTotal: scenario.evs.length,
    unservedWh: unserved.reduce((sum, wh) => sum + (wh > DONE_TOLERANCE_WH ? wh : 0), 0),
    comfortDegreeHours,
    overloadIntervals,
    plugChanges: state.plugChanges,
  };
}
