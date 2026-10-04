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
          <p className="eyebrow">Симулатор</p>
          <h1>Можете ли да победите Автопилота?</h1>
          <p className="muted">Управлявайте ръчно един ден в офиса, после гледайте как Автопилотът управлява същия ден.</p>
        </div>
        {phase !== "intro" && (
          <div className="head-actions">
            <button type="button" className="button-ghost" onClick={() => dispatch({ type: "new-day", seed: game.scenario.seed })}>
              Към описанието на деня
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
                <strong>Денят приключи.</strong> Сега пуснете Автопилота в същия ден и сравнете.
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button type="button" className="button-primary" onClick={() => dispatch({ type: "start-autopilot" })}>
                  Пусни Автопилота
                </button>
                <button type="button" onClick={() => dispatch({ type: "show-results" })}>
                  Виж резултатите
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
