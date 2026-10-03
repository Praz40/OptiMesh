import {
  defaultControls,
  DONE_TOLERANCE_WH,
  hoursPerStep,
  isPresent,
  remainingWh,
  timeAt,
  type Policy,
  type SimState,
} from "./engine";
import { localHour, type EvSpec, type Scenario } from "./scenario";

/**
 * Policies decide the controls for the next interval from what is known at its start:
 * the state so far, the cars currently parked, the tariff and the day-ahead solar
 * forecast. None of them sees future arrivals or the actual (noisy) weather.
 */

function presentUnfinished(scenario: Scenario, state: SimState, t: number): EvSpec[] {
  return scenario.evs.filter((ev) => isPresent(ev, t, scenario) && remainingWh(ev, state) > DONE_TOLERANCE_WH);
}

/**
 * The unoptimized reference: first come, first served at full power, battery on
 * self-consumption, thermostat at 23 °C around the clock. A car keeps its charger
 * until it is full or leaves.
 */
export const baselinePolicy: Policy = (scenario, state) => {
  const t = timeAt(scenario, state.step);
  const controls = defaultControls(scenario);
  const waiting = presentUnfinished(scenario, state, t).sort((a, b) => a.arrival - b.arrival);
  const plugged = new Set<string>();
  for (const charger of scenario.chargers) {
    const ev = waiting.find((candidate) => candidate.id === state.plugs[charger.id]);
    if (ev) {
      controls.plugs[charger.id] = ev.id;
      plugged.add(ev.id);
    }
  }
  for (const charger of scenario.chargers) {
    if (controls.plugs[charger.id]) continue;
    const next = waiting.find((ev) => !plugged.has(ev.id));
    if (next) {
      controls.plugs[charger.id] = next.id;
      plugged.add(next.id);
    }
  }
  return controls;
};

/** Hours of slack: time left minus the time a car needs at its full rate. Negative means it will be late. */
export function laxityHours(ev: EvSpec, state: SimState, t: number, chargerMaxW: number): number {
  const hoursLeft = (ev.departure - t) / 3_600_000;
  return hoursLeft - remainingWh(ev, state) / Math.min(ev.maxW, chargerMaxW);
}

const CHEAP_PRICE = 0.14;
const EXPENSIVE_PRICE = 0.28;
// Import above this is shaved by the battery whenever it has charge.
export const PEAK_CAP_W = 22_000;
// Extra quarter-hours planned per car, so a late swap or a cloud cannot cause a miss.
const BUFFER_SLOTS = 1;
// State of charge kept back for the expensive evening hours.
const EVENING_RESERVE = 0.5;
// Intervals ahead that follow the latest measured solar rather than the forecast.
const NOWCAST_SLOTS = 4;
// Expected building load (base + HVAC) while occupied and otherwise, W.
const BUILDING_OCCUPIED_W = 14_000;
const BUILDING_EMPTY_W = 3_000;

function buildingEstimate(scenario: Scenario, j: number): number {
  return scenario.series.occupied[j] ? BUILDING_OCCUPIED_W : BUILDING_EMPTY_W;
}

type Slot = { k: number; price: number; chargers: number; powerW: number };

/**
 * Remaining intervals with their charging budget. A slot's effective price is the
 * export price when forecast solar exceeds the building's load (that energy would
 * otherwise be sold), else the import tariff. Its power budget keeps forecast import
 * under the peak cap.
 */
function slotsFrom(scenario: Scenario, state: SimState): Slot[] {
  const from = state.step;
  // Nowcast: if the last interval came in below forecast (a cloud), expect the next
  // hour to do the same. Beyond that, trust the day-ahead forecast.
  const last = state.records.at(-1);
  const lastForecast = from > 0 ? scenario.series.solarForecastW[from - 1] : 0;
  const ratio = last && lastForecast > 1000 ? Math.min(Math.max(last.solarW / lastForecast, 0.2), 1.1) : 1;
  const slots: Slot[] = [];
  for (let j = from; j < scenario.steps; j++) {
    const solar = scenario.series.solarForecastW[j] * (j - from < NOWCAST_SLOTS ? ratio : 1);
    const surplus = solar - buildingEstimate(scenario, j);
    slots.push({
      k: j - from,
      price: surplus > 0 ? scenario.series.exportPrice[j] : scenario.series.importPrice[j],
      chargers: scenario.chargers.length,
      powerW: Math.max(PEAK_CAP_W + surplus, 0),
    });
  }
  return slots;
}

/**
 * Plans every parked car's remaining energy into the cheapest intervals before it
 * leaves, earliest deadline first, within the chargers and the peak budget of each
 * interval. If a car cannot finish within the budget, its deadline wins over the peak.
 * Returns the cars that should charge now and at what power, most urgent first.
 */
export function carsToChargeNow(scenario: Scenario, state: SimState): { ev: EvSpec; powerW: number }[] {
  const i = state.step;
  const t = timeAt(scenario, i);
  const dt = hoursPerStep(scenario);
  const slots = slotsFrom(scenario, state);
  const charger = scenario.chargers[0];
  const now: { ev: EvSpec; powerW: number; lax: number }[] = [];

  const cars = presentUnfinished(scenario, state, t).sort((a, b) => a.departure - b.departure);
  for (const ev of cars) {
    const fullW = Math.min(ev.maxW, charger.maxW);
    const lastSlot = Math.min(Math.floor((ev.departure - scenario.start) / (scenario.stepMinutes * 60_000)), scenario.steps) - i;
    const window = slots.slice(0, Math.max(lastSlot, 0)).filter((slot) => slot.chargers > 0);
    let needWh = remainingWh(ev, state) + BUFFER_SLOTS * fullW * dt;
    const taken = new Map<number, number>();
    // First within the peak budget, then (deadline over peak) at full power.
    for (const respectPeak of [true, false]) {
      for (const slot of [...window].sort((a, b) => a.price - b.price || a.k - b.k)) {
        if (needWh <= 0) break;
        const already = taken.get(slot.k) ?? 0;
        const room = respectPeak ? Math.min(fullW - already, slot.powerW) : fullW - already;
        if (room < charger.minW) continue;
        const powerW = Math.min(room, needWh / dt);
        taken.set(slot.k, already + powerW);
        needWh -= powerW * dt;
      }
    }
    for (const [k, powerW] of taken) {
      slots[k].chargers -= 1;
      slots[k].powerW -= powerW;
    }
    const nowW = taken.get(0);
    if (nowW) now.push({ ev, powerW: Math.max(nowW, charger.minW), lax: laxityHours(ev, state, t, charger.maxW) });
  }
  return now.sort((a, b) => a.lax - b.lax);
}

/**
 * Rule-based Autopilot. A transparent heuristic, not an optimizer: it is the bar the
 * scheduling work (issue #13) has to beat on exactly the same scenario.
 *
 * - Cars: each car's energy goes into the cheapest quarter-hours before it leaves.
 * - Battery: stores surplus, shaves import above the peak cap, covers expensive hours.
 * - HVAC: pre-cools on cheap or solar energy, coasts through expensive hours, off when empty.
 */
export const autopilotPolicy: Policy = (scenario, state) => {
  const i = state.step;
  const t = timeAt(scenario, i);
  const hour = localHour(t, scenario.timezone);
  const price = scenario.series.importPrice[i];
  const controls = defaultControls(scenario);

  // --- Cars. Keep a car on the charger it already uses; fill free chargers in urgency order.
  const charging = carsToChargeNow(scenario, state).slice(0, scenario.chargers.length);
  const free = scenario.chargers.filter((charger) => {
    const keep = charging.find((c) => c.ev.id === state.plugs[charger.id]);
    if (keep) controls.plugs[charger.id] = keep.ev.id;
    return !keep;
  });
  const unplaced = charging.filter((c) => !Object.values(controls.plugs).includes(c.ev.id));
  free.forEach((charger, index) => {
    controls.plugs[charger.id] = unplaced[index]?.ev.id ?? null;
  });
  for (const charger of scenario.chargers) {
    const car = charging.find((c) => c.ev.id === controls.plugs[charger.id]);
    controls.chargerW[charger.id] = car ? car.powerW : 0;
  }

  const socFraction = state.socWh / scenario.site.battery.capacityWh;
  const surplusW = scenario.series.solarForecastW[i] - (state.records.at(-1)?.baseW ?? 5000);

  // --- Battery: cover the site in expensive hours; otherwise store surplus and shave peaks,
  // also covering mid-priced hours while there is charge to spare for the evening.
  controls.peakCapW = PEAK_CAP_W;
  if (price >= EXPENSIVE_PRICE) controls.battery = "auto";
  else if (price > CHEAP_PRICE && socFraction > EVENING_RESERVE) controls.battery = "auto";
  else controls.battery = "peak";

  // --- HVAC: pre-cool on cheap or solar energy, coast through expensive hours, off when empty.
  const occupied = scenario.series.occupied[i];
  const preCoolSoon = !occupied && hour >= 7.25 && hour < 8;
  if (!occupied && !preCoolSoon) controls.hvacSetpointC = null;
  else if (price >= EXPENSIVE_PRICE) controls.hvacSetpointC = 24.5;
  else if (price <= CHEAP_PRICE || surplusW > 4000) controls.hvacSetpointC = 22.5;
  else controls.hvacSetpointC = 23.5;

  return controls;
};

/** A player who does nothing: the default controls, no cars plugged in. */
export const idlePolicy: Policy = (scenario) => defaultControls(scenario);
