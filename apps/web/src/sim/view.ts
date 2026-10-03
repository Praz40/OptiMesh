import { isDone, remainingWh, timeAt, type Controls, type SimState } from "./engine";
import { laxityHours } from "./policies";
import type { RunMetrics } from "./metrics";
import type { EvSpec, Scenario } from "./scenario";

export type CarStatus = "upcoming" | "waiting" | "charging" | "plugged" | "ready" | "left-ok" | "left-short";

export type CarView = {
  ev: EvSpec;
  status: CarStatus;
  deliveredWh: number;
  remainingWh: number;
  /** Charger the car is (or is about to be) plugged into. */
  chargerId: string | null;
  /** Power in the last interval, W. */
  powerW: number;
  /** Hours of slack at full power; null once the car is ready or gone. */
  slackH: number | null;
  /** Will miss its deadline unless it charges at full power very soon. */
  atRisk: boolean;
};

const ORDER: Record<CarStatus, number> = {
  charging: 0,
  waiting: 1,
  plugged: 2,
  ready: 3,
  upcoming: 4,
  "left-short": 5,
  "left-ok": 6,
};

/** How each car looks "now", i.e. at the start of the next interval. */
export function carViews(scenario: Scenario, state: SimState, plugs: Controls["plugs"]): CarView[] {
  const t = timeAt(scenario, state.step);
  const last = state.records.at(-1);
  const chargerMax = Math.max(...scenario.chargers.map((c) => c.maxW));
  const views = scenario.evs.map((ev): CarView => {
    const deliveredWh = state.deliveredWh[ev.id] ?? 0;
    const remaining = remainingWh(ev, state);
    const done = isDone(ev, state);
    const chargerId = scenario.chargers.find((c) => plugs[c.id] === ev.id)?.id ?? null;
    const wasCharging = scenario.chargers.find((c) => state.plugs[c.id] === ev.id);
    const powerW = wasCharging && last ? (last.chargerW[wasCharging.id] ?? 0) : 0;
    const base = { ev, deliveredWh, remainingWh: remaining, chargerId, powerW };

    if (ev.departure <= t) return { ...base, chargerId: null, powerW: 0, status: done ? "left-ok" : "left-short", slackH: null, atRisk: false };
    if (ev.arrival > t) return { ...base, status: "upcoming", slackH: null, atRisk: false };
    if (done) return { ...base, status: "ready", slackH: null, atRisk: false };
    const slackH = laxityHours(ev, state, t, chargerMax);
    const status: CarStatus = chargerId ? (powerW > 0 ? "charging" : "plugged") : "waiting";
    return { ...base, status, slackH, atRisk: slackH < 0.75 };
  });
  return views.sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      (a.slackH ?? 99) - (b.slackH ?? 99) ||
      a.ev.arrival - b.ev.arrival,
  );
}

export function formatDuration(hours: number): string {
  const sign = hours < 0 ? "−" : "";
  const minutes = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${sign}${h > 0 ? `${h} h ` : ""}${m} min`.replace(/ 0 min$/, "").trim();
}

export function simClock(scenario: Scenario, t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", { timeZone: scenario.timezone, hour: "2-digit", minute: "2-digit" });
}

export function formatEur(value: number, digits = 2): string {
  const sign = value < 0 ? "−" : "";
  return `${sign}€${Math.abs(value).toFixed(digits)}`;
}

/** The results headline. Deadlines come first: a run that skipped charging is not "cheaper", it did less. */
export function verdict(you: RunMetrics | null, autopilot: RunMetrics, baseline: RunMetrics): { headline: string; detail: string } {
  const reference = you ?? baseline;
  const who = you ? "you" : "simple rules";
  const whose = you ? "Your" : "The simple-rules";
  const peakCut = (reference.peakImportW - autopilot.peakImportW) / 1000;
  const peak = peakCut > 0.05 ? ` Peak import ${peakCut.toFixed(1)} kW lower.` : "";
  // Deadlines first: a run that skipped charging is not "cheaper", it did less.
  if (autopilot.evsOnTime > reference.evsOnTime) {
    return {
      headline: `Autopilot charged ${autopilot.evsOnTime}/${autopilot.evsTotal} cars on time; ${who} managed ${reference.evsOnTime}/${reference.evsTotal}.`,
      detail: `${whose} day left ${(reference.unservedWh / 1000).toFixed(1)} kWh of charging undone, so its cost is not comparable. Autopilot met every request for ${formatEur(autopilot.adjustedCostEur)}.${peak}`,
    };
  }
  const saved = reference.adjustedCostEur - autopilot.adjustedCostEur;
  if (you && reference.evsOnTime >= autopilot.evsOnTime && saved < -0.005) {
    return {
      headline: `You beat Autopilot by ${formatEur(-saved)}.`,
      detail: `With ${you.evsOnTime}/${you.evsTotal} cars on time. That is the bar the scheduling work has to clear.`,
    };
  }
  const pct = reference.adjustedCostEur > 0 ? (saved / reference.adjustedCostEur) * 100 : 0;
  return {
    headline:
      saved > 0.005
        ? `Autopilot ran the same day ${formatEur(saved)} cheaper (${pct.toFixed(0)}%) than ${who}.`
        : `Autopilot matched ${who} on cost.`,
    detail: `Both charged ${autopilot.evsOnTime}/${autopilot.evsTotal} cars on time.${peak}`,
  };
}
