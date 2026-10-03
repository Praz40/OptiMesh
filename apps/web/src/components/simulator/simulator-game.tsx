"use client";

import { useEffect, useReducer } from "react";
import { SimIntro } from "@/components/simulator/sim-intro";
import { SimPlay } from "@/components/simulator/sim-play";
import { SimResults } from "@/components/simulator/sim-results";
import { gameReducer, newGame } from "@/sim/game";

export function SimulatorGame() {
  const [game, dispatch] = useReducer(gameReducer, 7, newGame);
  const { playing, tickMs, phase } = game;

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => dispatch({ type: "tick" }), tickMs);
    return () => clearInterval(timer);
  }, [playing, tickMs, phase]);

  const dayOver = phase === "manual" && game.manualDone;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Simulator</p>
          <h1>Can you beat Autopilot?</h1>
          <p className="muted">Run a day at the office by hand, then watch Autopilot run the very same day.</p>
        </div>
        {phase !== "intro" && (
          <div className="head-actions">
            <button type="button" className="button-ghost" onClick={() => dispatch({ type: "new-day", seed: game.scenario.seed })}>
              Back to the briefing
            </button>
          </div>
        )}
      </div>
      {phase === "intro" && <SimIntro scenario={game.scenario} dispatch={dispatch} />}
      {(phase === "manual" || phase === "autopilot") && (
        <>
          {dayOver && (
            <div className="sim-banner" role="status">
              <span>
                <strong>Day complete.</strong> Now let Autopilot run the same day and compare.
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button type="button" className="button-primary" onClick={() => dispatch({ type: "start-autopilot" })}>
                  Run Autopilot
                </button>
                <button type="button" onClick={() => dispatch({ type: "show-results" })}>
                  See results
                </button>
              </span>
            </div>
          )}
          <SimPlay game={game} dispatch={dispatch} readOnly={phase === "autopilot"} />
        </>
      )}
      {phase === "results" && <SimResults game={game} dispatch={dispatch} />}
    </>
  );
}
