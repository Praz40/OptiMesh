import { defaultControls, initialState, step, type BatteryMode, type Controls, type SimState } from "./engine";
import { autopilotPolicy } from "./policies";
import { officeScenario, type Scenario } from "./scenario";

export type Phase = "intro" | "manual" | "autopilot" | "results";

export type Run = { state: SimState; controls: Controls };

export type Game = {
  scenario: Scenario;
  phase: Phase;
  manual: Run;
  manualDone: boolean;
  /** The animated Autopilot replay of the same day. */
  autopilot: Run;
  playing: boolean;
  /** Milliseconds per simulated quarter-hour. */
  tickMs: number;
};

export const SPEEDS = [
  { label: "0.5×", ms: 3000 },
  { label: "1×", ms: 1500 },
  { label: "2×", ms: 750 },
  { label: "4×", ms: 300 },
] as const;
const AUTOPILOT_TICK_MS = 220;

export type GameAction =
  | { type: "start-manual" }
  | { type: "tick" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "speed"; ms: number }
  | { type: "battery"; mode: BatteryMode }
  | { type: "hvac"; setpoint: number | null }
  | { type: "plug"; evId: string; chargerId: string }
  | { type: "unplug"; chargerId: string }
  | { type: "charger-power"; chargerId: string; watts: number }
  | { type: "start-autopilot" }
  | { type: "show-results" }
  | { type: "restart" }
  | { type: "new-day"; seed: number };

function freshRun(scenario: Scenario): Run {
  return { state: initialState(scenario), controls: defaultControls(scenario) };
}

export function newGame(seed = 7): Game {
  const scenario = officeScenario(seed);
  return {
    scenario,
    phase: "intro",
    manual: freshRun(scenario),
    manualDone: false,
    autopilot: freshRun(scenario),
    playing: false,
    tickMs: SPEEDS[1].ms,
  };
}

function withControls(game: Game, change: (controls: Controls) => Controls): Game {
  if (game.phase !== "manual" || game.manualDone) return game;
  return { ...game, manual: { ...game.manual, controls: change(game.manual.controls) } };
}

export function gameReducer(game: Game, action: GameAction): Game {
  const { scenario } = game;
  switch (action.type) {
    case "start-manual":
      return { ...game, phase: "manual", manual: freshRun(scenario), manualDone: false, playing: true };
    case "restart":
      return game.phase === "autopilot"
        ? { ...game, autopilot: freshRun(scenario), playing: true, tickMs: AUTOPILOT_TICK_MS }
        : { ...game, phase: "manual", manual: freshRun(scenario), manualDone: false, playing: false };
    case "new-day":
      return newGame(action.seed);
    case "play":
      return game.manualDone && game.phase === "manual" ? game : { ...game, playing: true };
    case "pause":
      return { ...game, playing: false };
    case "speed":
      return { ...game, tickMs: action.ms };
    case "tick": {
      if (game.phase === "manual" && !game.manualDone) {
        const state = step(scenario, game.manual.state, game.manual.controls);
        const done = state.step >= scenario.steps;
        // Cars that left are unplugged; keep the controls in sync with the chargers.
        const controls = { ...game.manual.controls, plugs: { ...state.plugs } };
        return { ...game, manual: { state, controls }, manualDone: done, playing: game.playing && !done };
      }
      if (game.phase === "autopilot") {
        const controls = autopilotPolicy(scenario, game.autopilot.state);
        const state = step(scenario, game.autopilot.state, controls);
        const done = state.step >= scenario.steps;
        const next = { ...game, autopilot: { state, controls: { ...controls, plugs: { ...state.plugs } } } };
        return done ? { ...next, phase: "results", playing: false } : next;
      }
      return game;
    }
    case "battery":
      return withControls(game, (c) => ({ ...c, battery: action.mode, peakCapW: action.mode === "peak" ? 22_000 : null }));
    case "hvac":
      return withControls(game, (c) => ({ ...c, hvacSetpointC: action.setpoint }));
    case "plug":
      return withControls(game, (c) => {
        const plugs = { ...c.plugs };
        for (const id of Object.keys(plugs)) if (plugs[id] === action.evId) plugs[id] = null;
        plugs[action.chargerId] = action.evId;
        return { ...c, plugs };
      });
    case "unplug":
      return withControls(game, (c) => ({ ...c, plugs: { ...c.plugs, [action.chargerId]: null } }));
    case "charger-power":
      return withControls(game, (c) => ({ ...c, chargerW: { ...c.chargerW, [action.chargerId]: action.watts } }));
    case "start-autopilot":
      return { ...game, phase: "autopilot", autopilot: freshRun(scenario), playing: true, tickMs: AUTOPILOT_TICK_MS };
    case "show-results":
      return { ...game, phase: "results", playing: false };
  }
}
