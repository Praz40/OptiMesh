"use client";

import { useMemo, type Dispatch } from "react";
import { TimeChart, type ChartSeries } from "@/components/time-chart";
import { formatKw } from "@/lib/energy";
import { run, timeAt, type SimState } from "@/sim/engine";
import type { Game, GameAction } from "@/sim/game";
import { averageImportPrice, metricsFor, type RunMetrics } from "@/sim/metrics";
import { autopilotPolicy, baselinePolicy, PEAK_CAP_W } from "@/sim/policies";
import type { Scenario } from "@/sim/scenario";
import { telemetryFor, toJsonLines } from "@/sim/telemetry";
import { formatEur, simClock, verdict } from "@/sim/view";

type Column = { key: "you" | "baseline" | "autopilot"; label: string; tone: string; dashed?: boolean; state: SimState; metrics: RunMetrics };

type Row = {
  label: string;
  sub?: string;
  value: (m: RunMetrics) => number;
  format: (value: number, m: RunMetrics) => string;
  detail?: (m: RunMetrics) => string;
  better: "lower" | "higher";
  /** Only runs that charged the most cars compete: skipping charging is not a saving. */
  servedOnly?: boolean;
};

const kwh = (wh: number) => `${(wh / 1000).toFixed(0)} kWh`;

function rows(scenario: Scenario): Row[] {
  return [
    {
      label: "Day cost",
      sub: "battery-adjusted",
      value: (m) => m.adjustedCostEur,
      format: (v) => formatEur(v),
      detail: (m) =>
        `${formatEur(m.energyCostEur)} paid, ${m.batteryDeltaWh >= 0 ? "−" : "+"}${formatEur(Math.abs(m.adjustedCostEur - m.energyCostEur))} for ending ${Math.abs(m.batteryDeltaWh / 1000).toFixed(1)} kWh ${m.batteryDeltaWh >= 0 ? "fuller" : "emptier"}`,
      better: "lower",
      servedOnly: true,
    },
    { label: "Peak import", value: (m) => m.peakImportW, format: (v) => formatKw(v), better: "lower", servedOnly: true },
    { label: "Grid import", value: (m) => m.importWh, format: (v) => kwh(v), better: "lower", servedOnly: true },
    {
      label: "Solar used on site",
      value: (m) => m.solarUtilization,
      format: (v) => `${Math.round(v * 100)}%`,
      detail: (m) => (m.exportWh > 0 ? `${kwh(m.exportWh)} exported` : "nothing exported"),
      better: "higher",
    },
    {
      label: "Cars charged on time",
      value: (m) => m.evsOnTime,
      format: (v, m) => `${v} / ${m.evsTotal}`,
      detail: (m) => (m.unservedWh > 0 ? `${(m.unservedWh / 1000).toFixed(1)} kWh short` : "every request met"),
      better: "higher",
    },
    {
      label: "Comfort",
      sub: `°C·h outside ${scenario.site.hvac.comfortMinC}–${scenario.site.hvac.comfortMaxC} °C`,
      value: (m) => m.comfortDegreeHours,
      format: (v) => v.toFixed(1),
      better: "lower",
    },
    {
      label: "Battery throughput",
      value: (m) => m.batteryThroughputWh,
      format: (v) => kwh(v),
      detail: (m) => `${(m.batteryThroughputWh / (2 * scenario.site.battery.capacityWh)).toFixed(2)} cycles`,
      better: "lower",
    },
    { label: "Car moves", sub: "plug-ins and swaps", value: (m) => m.plugChanges, format: (v) => `${v}`, better: "lower" },
  ];
}

function download(scenario: Scenario, state: SimState, name: string) {
  const blob = new Blob([toJsonLines(telemetryFor(scenario, state))], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `optimesh-${scenario.id}-${name}.jsonl`;
  link.click();
  URL.revokeObjectURL(url);
}

export function SimResults({ game, dispatch }: { game: Game; dispatch: Dispatch<GameAction> }) {
  const { scenario } = game;
  const columns = useMemo<Column[]>(() => {
    const autopilotState =
      game.autopilot.state.step >= scenario.steps ? game.autopilot.state : run(scenario, autopilotPolicy);
    const baselineState = run(scenario, baselinePolicy);
    const list: Column[] = [];
    if (game.manualDone) {
      list.push({ key: "you", label: "You", tone: "you", state: game.manual.state, metrics: metricsFor(scenario, game.manual.state) });
    }
    list.push(
      { key: "baseline", label: "Simple rules", tone: "baseline", dashed: true, state: baselineState, metrics: metricsFor(scenario, baselineState) },
      { key: "autopilot", label: "Autopilot", tone: "autopilot", state: autopilotState, metrics: metricsFor(scenario, autopilotState) },
    );
    return list;
  }, [game.autopilot.state, game.manual.state, game.manualDone, scenario]);

  const byKey = Object.fromEntries(columns.map((c) => [c.key, c])) as Partial<Record<Column["key"], Column>>;
  const { headline, detail } = verdict(byKey.you?.metrics ?? null, byKey.autopilot!.metrics, byKey.baseline!.metrics);
  const x = useMemo(() => Array.from({ length: scenario.steps }, (_, i) => timeAt(scenario, i)), [scenario]);
  const series: ChartSeries[] = columns.map((c) => ({
    key: c.key,
    label: c.label,
    tone: c.tone,
    style: c.dashed ? "dash" : "line",
    values: c.state.records.map((r) => Math.max(r.gridW, 0)),
  }));

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="verdict-title">
        <div className="verdict">
          <p className="eyebrow">Results · {scenario.name} · seed {scenario.seed}</p>
          <h2 id="verdict-title" className="verdict-headline">
            {headline}
          </h2>
          <p className="muted">{detail}</p>
        </div>
        <div className="table-scroll" style={{ maxHeight: "none" }}>
          <table className="data-table compare-table">
            <caption className="sr-only">Comparison of runs on the same day</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="right">
                    <span className="col-key" data-shape={c.dashed ? "dash" : undefined} style={{ ["--tone" as string]: `var(--${c.tone})` }} />
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows(scenario).map((row) => {
                const values = columns.map((c) => row.value(c.metrics));
                const mostCars = Math.max(...columns.map((c) => c.metrics.evsOnTime));
                const eligible = columns.map((c) => !row.servedOnly || c.metrics.evsOnTime === mostCars);
                const contenders = values.filter((_, i) => eligible[i]);
                const best = row.better === "lower" ? Math.min(...contenders) : Math.max(...contenders);
                const distinct = new Set(values.map((v) => v.toFixed(3))).size > 1;
                return (
                  <tr key={row.label}>
                    <th scope="row">
                      {row.label}
                      {row.sub && <span className="sub">{row.sub}</span>}
                    </th>
                    {columns.map((c, i) => (
                      <td key={c.key} className={`right${distinct && eligible[i] && Math.abs(values[i] - best) < 1e-9 ? " best" : ""}`}>
                        {row.format(values[i], c.metrics)}
                        {row.detail && <span className="sub">{row.detail(c.metrics)}</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="sim-actions">
          <button type="button" className="button-primary" onClick={() => dispatch({ type: "start-manual" })}>
            {game.manualDone ? "Play this day again" : "Try it yourself"}
          </button>
          <button type="button" onClick={() => dispatch({ type: "start-autopilot" })}>
            Watch Autopilot again
          </button>
          <button type="button" onClick={() => dispatch({ type: "new-day", seed: scenario.seed + 1 })}>
            Another day (seed {scenario.seed + 1})
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="import-title">
        <div className="panel-head">
          <h2 id="import-title">Grid import through the day</h2>
          <span className="muted">Autopilot holds a {PEAK_CAP_W / 1000} kW peak target</span>
        </div>
        <TimeChart title="Grid import by run" x={x} series={series} height={240} formatY={formatKw} formatX={(t) => simClock(scenario, t)} />
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="cars-result-title">
          <div className="panel-head">
            <h2 id="cars-result-title">Each car</h2>
            <span className="muted">kWh delivered of kWh requested</span>
          </div>
          <div className="table-scroll" style={{ maxHeight: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Driver</th>
                  <th scope="col">Leaves</th>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className="right">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scenario.evs.map((ev) => (
                  <tr key={ev.id}>
                    <td>{ev.driver}</td>
                    <td>{simClock(scenario, ev.departure)}</td>
                    {columns.map((c) => {
                      const got = c.state.deliveredWh[ev.id] / 1000;
                      const ok = ev.needWh - c.state.deliveredWh[ev.id] <= 100;
                      return (
                        <td key={c.key} className="right" style={{ color: ok ? undefined : "var(--bad)" }}>
                          {got.toFixed(1)} / {(ev.needWh / 1000).toFixed(0)}
                          {ok ? "" : " ✗"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel" aria-labelledby="fair-title">
          <div className="panel-head">
            <h2 id="fair-title">How the comparison is kept fair</h2>
          </div>
          <ul className="fairness">
            <li>Every run replays seed {scenario.seed}: identical weather, base load, tariff, cars and deadlines.</li>
            <li>
              Autopilot decides each quarter-hour from the day-ahead forecast and what has already happened. It does not
              see future arrivals or the actual clouds.
            </li>
            <li>
              Cost is adjusted for the battery&apos;s final charge, valued at the day&apos;s average import price (€
              {averageImportPrice(scenario).toFixed(3)}/kWh), so emptying the battery does not count as saving.
            </li>
            <li>Missed charging is reported as energy short, never hidden in the cost.</li>
            <li>
              “Simple rules” is first come, first served at full power, the battery on self-use and the thermostat at
              23 °C all day.
            </li>
            <li>These are simulation results. They do not claim the same savings for any real site or hardware.</li>
          </ul>
          <div className="sim-actions">
            {columns.map((c) => (
              <button key={c.key} type="button" className="button-small" onClick={() => download(scenario, c.state, c.key)}>
                Download {c.key === "you" ? "your run" : c.label === "Autopilot" ? "Autopilot's run" : "simple rules"} as telemetry
              </button>
            ))}
          </div>
          <p className="footnote">
            JSON Lines in device contract v1, with the seeded Office device ids: the same messages the platform ingests
            from hardware.
          </p>
        </section>
      </div>
    </div>
  );
}
