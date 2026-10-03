import type { SiteSummary } from "@/lib/api";
import type { EvSpec, Scenario } from "./scenario";

/**
 * Battery control:
 * - auto: self-consumption (store surplus, cover any deficit)
 * - peak: store surplus, discharge only for import above `peakCapW`
 * - hold: neither charge nor discharge
 * - charge: charge at full power, from the grid if needed (import capped at `peakCapW` when set)
 * - discharge: discharge at full power; anything the site does not use is exported
 */
export type BatteryMode = "auto" | "peak" | "hold" | "charge" | "discharge";

export type Controls = {
  battery: BatteryMode;
  peakCapW: number | null;
  /** Thermostat target, °C. null switches the HVAC off. */
  hvacSetpointC: number | null;
  /** Which car is plugged into each charger. */
  plugs: Record<string, string | null>;
  /** Power limit per charger, W. 0 pauses it. */
  chargerW: Record<string, number>;
};

export type StepRecord = {
  /** Interval start, UTC ms. */
  t: number;
  solarW: number;
  curtailedW: number;
  baseW: number;
  hvacW: number;
  evW: number;
  chargerW: Record<string, number>;
  /** + charging, - discharging (contract sign convention). */
  batteryW: number;
  /** + import, - export (contract sign convention). */
  gridW: number;
  socWh: number;
  indoorC: number;
  outdoorC: number;
  importPrice: number;
  exportPrice: number;
  /** Energy cost of this interval: import cost minus export revenue. */
  costEur: number;
  overload: boolean;
  battery: BatteryMode;
  hvacSetpointC: number | null;
};

export type SimEvent = {
  t: number;
  kind: "arrival" | "departure" | "complete" | "overload" | "comfort";
  evId?: string;
  text: string;
  tone?: "good" | "warn" | "bad";
};

export type SimState = {
  /** Index of the next interval to simulate. */
  step: number;
  socWh: number;
  indoorC: number;
  deliveredWh: Record<string, number>;
  plugs: Record<string, string | null>;
  plugChanges: number;
  records: StepRecord[];
  events: SimEvent[];
};

// Thermal model, per hour: drift = ENVELOPE * (outdoor - indoor) + internal gains + sun,
// cooling removes COOLING °C per kWh of HVAC electricity.
const ENVELOPE = 0.12;
const GAINS_OCCUPIED = 0.6;
const GAINS_EMPTY = 0.1;
const SUN_GAIN = 0.4;
const COOLING = 0.15;
// Energy below this counts as delivered: chargers stop on whole-Wh accounting.
export const DONE_TOLERANCE_WH = 100;

export const hoursPerStep = (scenario: Scenario) => scenario.stepMinutes / 60;
export const timeAt = (scenario: Scenario, step: number) => scenario.start + step * scenario.stepMinutes * 60_000;

/** A car can charge in an interval only if it is parked for the whole interval. */
export function isPresent(ev: EvSpec, t: number, scenario: Scenario): boolean {
  return ev.arrival <= t && t + scenario.stepMinutes * 60_000 <= ev.departure;
}

export function remainingWh(ev: EvSpec, state: SimState): number {
  return Math.max(ev.needWh - (state.deliveredWh[ev.id] ?? 0), 0);
}

export function isDone(ev: EvSpec, state: SimState): boolean {
  return remainingWh(ev, state) <= DONE_TOLERANCE_WH;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export function defaultControls(scenario: Scenario): Controls {
  return {
    battery: "auto",
    peakCapW: null,
    hvacSetpointC: 23,
    plugs: Object.fromEntries(scenario.chargers.map((c) => [c.id, null])),
    chargerW: Object.fromEntries(scenario.chargers.map((c) => [c.id, c.maxW])),
  };
}

export function initialState(scenario: Scenario): SimState {
  const { battery, hvac } = scenario.site;
  const t0 = scenario.start;
  return {
    step: 0,
    socWh: battery.capacityWh * battery.initialSoc,
    indoorC: hvac.initialIndoorC,
    deliveredWh: Object.fromEntries(scenario.evs.map((ev) => [ev.id, 0])),
    plugs: Object.fromEntries(scenario.chargers.map((c) => [c.id, null])),
    plugChanges: 0,
    records: [],
    events: arrivals(scenario, t0 - 1, t0),
  };
}

function hhmm(scenario: Scenario, t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", { timeZone: scenario.timezone, hour: "2-digit", minute: "2-digit" });
}

function arrivals(scenario: Scenario, after: number, upTo: number): SimEvent[] {
  return scenario.evs
    .filter((ev) => ev.arrival > after && ev.arrival <= upTo)
    .map((ev) => ({
      t: ev.arrival,
      kind: "arrival" as const,
      evId: ev.id,
      text: `${ev.driver} arrived: needs ${(ev.needWh / 1000).toFixed(0)} kWh by ${hhmm(scenario, ev.departure)}`,
    }));
}

/** Plugs requested by the controls, minus anything physically impossible. */
function resolvePlugs(scenario: Scenario, state: SimState, controls: Controls, t: number): Record<string, string | null> {
  const used = new Set<string>();
  const plugs: Record<string, string | null> = {};
  for (const charger of scenario.chargers) {
    const evId = controls.plugs[charger.id] ?? null;
    const ev = scenario.evs.find((candidate) => candidate.id === evId);
    const valid = ev !== undefined && !used.has(ev.id) && isPresent(ev, t, scenario);
    plugs[charger.id] = valid ? ev.id : null;
    if (valid) used.add(ev.id);
  }
  return plugs;
}

function hvacPower(scenario: Scenario, indoorC: number, driftPerHour: number, setpoint: number | null): number {
  if (setpoint === null) return 0;
  const { minW, maxW } = scenario.site.hvac;
  const dt = hoursPerStep(scenario);
  // Ideal thermostat: the power that lands exactly on the setpoint at the end of the interval.
  const neededW = ((indoorC + driftPerHour * dt - setpoint) / (COOLING * dt)) * 1000;
  if (neededW <= 0) return 0;
  if (neededW < minW) return neededW >= minW / 2 ? minW : 0; // compressor runs at its minimum or not at all
  return Math.min(neededW, maxW);
}

function batteryPower(scenario: Scenario, controls: Controls, socWh: number, surplusW: number): number {
  const { capacityWh, maxW, minSoc, maxSoc, efficiency } = scenario.site.battery;
  const dt = hoursPerStep(scenario);
  const oneWay = Math.sqrt(efficiency);
  const maxChargeW = Math.min(maxW, Math.max(capacityWh * maxSoc - socWh, 0) / (oneWay * dt));
  const maxDischargeW = Math.min(maxW, (Math.max(socWh - capacityWh * minSoc, 0) * oneWay) / dt);
  const cap = controls.peakCapW;
  let desired: number;
  switch (controls.battery) {
    case "auto":
      desired = surplusW;
      break;
    case "peak":
      desired = surplusW >= 0 ? surplusW : -Math.max(-surplusW - (cap ?? Infinity), 0);
      break;
    case "hold":
      desired = 0;
      break;
    case "charge":
      desired = cap === null ? maxW : Math.max(cap + surplusW, 0);
      break;
    case "discharge":
      desired = -maxW;
      break;
  }
  return clamp(desired, -maxDischargeW, maxChargeW);
}

/** Advances one interval. Pure: returns a new state and never mutates its inputs. */
export function step(scenario: Scenario, state: SimState, controls: Controls): SimState {
  if (state.step >= scenario.steps) return state;
  const i = state.step;
  const dt = hoursPerStep(scenario);
  const t = timeAt(scenario, i);
  const tEnd = timeAt(scenario, i + 1);
  const { series, site } = scenario;
  const events: SimEvent[] = [];

  // Cars on chargers.
  const plugs = resolvePlugs(scenario, state, controls, t);
  const plugChanges = scenario.chargers.filter((c) => plugs[c.id] !== null && plugs[c.id] !== state.plugs[c.id]).length;
  const deliveredWh = { ...state.deliveredWh };
  const chargerW: Record<string, number> = {};
  let evW = 0;
  for (const charger of scenario.chargers) {
    const ev = scenario.evs.find((candidate) => candidate.id === plugs[charger.id]);
    let power = 0;
    if (ev) {
      const setting = clamp(controls.chargerW[charger.id] ?? charger.maxW, 0, charger.maxW);
      const limit = setting > 0 && setting < charger.minW ? charger.minW : setting;
      const remaining = Math.max(ev.needWh - deliveredWh[ev.id], 0);
      power = Math.min(limit, ev.maxW, remaining / dt);
      if (power < 1) power = 0;
      deliveredWh[ev.id] += power * dt;
      const finished = ev.needWh - deliveredWh[ev.id] <= DONE_TOLERANCE_WH;
      if (power > 0 && finished && remaining > DONE_TOLERANCE_WH) {
        events.push({ t: tEnd, kind: "complete", evId: ev.id, text: `${ev.driver}'s ${ev.model} is fully charged`, tone: "good" });
      }
    }
    chargerW[charger.id] = power;
    evW += power;
  }

  // HVAC and the building.
  const solarAvailableW = series.solarW[i];
  const drift =
    ENVELOPE * (series.outdoorC[i] - state.indoorC) +
    (series.occupied[i] ? GAINS_OCCUPIED : GAINS_EMPTY) +
    SUN_GAIN * (solarAvailableW / site.solarPeakW);
  const hvacW = hvacPower(scenario, state.indoorC, drift, controls.hvacSetpointC);
  const indoorC = state.indoorC + (drift - (COOLING * hvacW) / 1000) * dt;
  const baseW = series.baseLoadW[i];
  const loadW = baseW + hvacW + evW;

  // Battery, then the grid balances whatever is left.
  const batteryW = batteryPower(scenario, controls, state.socWh, solarAvailableW - loadW);
  const oneWay = Math.sqrt(site.battery.efficiency);
  const socWh = state.socWh + (batteryW >= 0 ? batteryW * dt * oneWay : (batteryW * dt) / oneWay);
  let gridW = loadW + batteryW - solarAvailableW;
  let curtailedW = 0;
  if (gridW < -site.exportLimitW) {
    curtailedW = -site.exportLimitW - gridW;
    gridW = -site.exportLimitW;
  }
  const solarW = solarAvailableW - curtailedW;
  const overload = gridW > site.importLimitW;
  const kwh = (gridW * dt) / 1000;
  const costEur = kwh >= 0 ? kwh * series.importPrice[i] : kwh * series.exportPrice[i];

  if (overload) {
    events.push({ t, kind: "overload", text: `Grid import ${(gridW / 1000).toFixed(0)} kW is above the ${site.importLimitW / 1000} kW connection`, tone: "bad" });
  }
  const { comfortMinC, comfortMaxC } = site.hvac;
  const wasComfortable = state.indoorC >= comfortMinC - 0.05 && state.indoorC <= comfortMaxC + 0.05;
  if (series.occupied[i] && wasComfortable && (indoorC > comfortMaxC + 0.05 || indoorC < comfortMinC - 0.05)) {
    events.push({ t: tEnd, kind: "comfort", text: `Office is ${indoorC.toFixed(1)} °C, outside the ${comfortMinC}–${comfortMaxC} °C comfort band`, tone: "warn" });
  }

  // Cars that leave at the end of this interval take their charge with them.
  const nextPlugs = { ...plugs };
  for (const ev of scenario.evs) {
    if (ev.departure > t && ev.departure <= tEnd) {
      const got = deliveredWh[ev.id];
      const ok = ev.needWh - got <= DONE_TOLERANCE_WH;
      events.push({
        t: ev.departure,
        kind: "departure",
        evId: ev.id,
        text: ok
          ? `${ev.driver} left on time with ${(got / 1000).toFixed(0)} kWh`
          : `${ev.driver} left ${((ev.needWh - got) / 1000).toFixed(1)} kWh short`,
        tone: ok ? "good" : "bad",
      });
      for (const charger of scenario.chargers) if (nextPlugs[charger.id] === ev.id) nextPlugs[charger.id] = null;
    }
  }
  events.push(...arrivals(scenario, t, tEnd));

  const record: StepRecord = {
    t,
    solarW,
    curtailedW,
    baseW,
    hvacW,
    evW,
    chargerW,
    batteryW,
    gridW,
    socWh,
    indoorC,
    outdoorC: series.outdoorC[i],
    importPrice: series.importPrice[i],
    exportPrice: series.exportPrice[i],
    costEur,
    overload,
    battery: controls.battery,
    hvacSetpointC: controls.hvacSetpointC,
  };

  return {
    step: i + 1,
    socWh,
    indoorC,
    deliveredWh,
    plugs: nextPlugs,
    plugChanges: state.plugChanges + plugChanges,
    records: [...state.records, record],
    events: [...state.events, ...events],
  };
}

export type Policy = (scenario: Scenario, state: SimState) => Controls;

/** Runs a policy over the remaining intervals. */
export function run(scenario: Scenario, policy: Policy, from: SimState = initialState(scenario)): SimState {
  let state = from;
  while (state.step < scenario.steps) state = step(scenario, state, policy(scenario, state));
  return state;
}

/** The interval as the platform would summarize it: same fields and signs as the live API. */
export function toSiteSummary(scenario: Scenario, record: StepRecord | undefined): SiteSummary {
  const devices = scenario.devices.length;
  if (!record) {
    return {
      solar_w: null,
      grid_w: null,
      battery_w: null,
      battery_soc_pct: null,
      ev_w: null,
      loads_w: null,
      consumption_w: null,
      unmeasured_w: null,
      devices_online: devices,
      devices_total: devices,
      updated_at: null,
    };
  }
  const consumption = record.baseW + record.hvacW + record.evW;
  return {
    solar_w: record.solarW,
    grid_w: record.gridW,
    battery_w: record.batteryW,
    battery_soc_pct: (record.socWh / scenario.site.battery.capacityWh) * 100,
    ev_w: record.evW,
    loads_w: record.hvacW,
    consumption_w: consumption,
    unmeasured_w: record.baseW,
    devices_online: devices,
    devices_total: devices,
    updated_at: new Date(record.t + scenario.stepMinutes * 60_000).toISOString(),
  };
}
