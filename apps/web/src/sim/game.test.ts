import { describe, expect, it } from "vitest";
import { run } from "./engine";
import { gameReducer, newGame, type Game } from "./game";
import { autopilotPolicy } from "./policies";

function ticks(game: Game, n: number): Game {
  let next = game;
  for (let i = 0; i < n; i++) next = gameReducer(next, { type: "tick" });
  return next;
}

describe("gameReducer", () => {
  it("plays the manual day with the player's controls and stops at the end", () => {
    let game = gameReducer(newGame(7), { type: "start-manual" });
    expect(game.phase).toBe("manual");
    game = ticks(game, 6); // 07:30, Boris has arrived
    const boris = game.scenario.evs[0];
    const charger = game.scenario.chargers[0];
    game = gameReducer(game, { type: "plug", evId: boris.id, chargerId: charger.id });
    game = ticks(game, 1);
    expect(game.manual.state.records.at(-1)?.chargerW[charger.id]).toBe(11_000);

    game = ticks(game, 100);
    expect(game.manualDone).toBe(true);
    expect(game.playing).toBe(false);
    expect(game.manual.state.step).toBe(game.scenario.steps);
  });

  it("moves a car rather than plugging it into two chargers", () => {
    let game = ticks(gameReducer(newGame(7), { type: "start-manual" }), 6);
    const [c1, c2] = game.scenario.chargers;
    const boris = game.scenario.evs[0].id;
    game = gameReducer(game, { type: "plug", evId: boris, chargerId: c1.id });
    game = gameReducer(game, { type: "plug", evId: boris, chargerId: c2.id });
    expect(game.manual.controls.plugs[c1.id]).toBeNull();
    expect(game.manual.controls.plugs[c2.id]).toBe(boris);
  });

  it("ignores control changes once the day is over", () => {
    const game = ticks(gameReducer(newGame(7), { type: "start-manual" }), 100);
    expect(gameReducer(game, { type: "battery", mode: "hold" })).toBe(game);
  });

  it("replays Autopilot on the same day and lands on the results", () => {
    let game = gameReducer(newGame(7), { type: "start-autopilot" });
    game = ticks(game, 100);
    expect(game.phase).toBe("results");
    expect(game.autopilot.state).toEqual(run(game.scenario, autopilotPolicy));
  });
});
