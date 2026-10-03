"use client";

import { useMemo, type Dispatch } from "react";
import { TimeChart, type ChartSeries } from "@/components/time-chart";
import { formatKw, formatPercent } from "@/lib/energy";
import { formatMoney, formatNumber } from "@/lib/format";
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
      label: "Разход за деня",
      sub: "с корекция за батерията",
      value: (m) => m.adjustedCostEur,
      format: (v) => formatEur(v),
      detail: (m) =>
        `${formatEur(m.energyCostEur)} платени, ${m.batteryDeltaWh >= 0 ? "−" : "+"}${formatEur(Math.abs(m.adjustedCostEur - m.energyCostEur))} за ${formatNumber(Math.abs(m.batteryDeltaWh / 1000), 1)} kWh ${m.batteryDeltaWh >= 0 ? "повече" : "по-малко"} в батерията накрая`,
      better: "lower",
      servedOnly: true,
    },
    { label: "Пик от мрежата", value: (m) => m.peakImportW, format: (v) => formatKw(v), better: "lower", servedOnly: true },
    { label: "Взета от мрежата", value: (m) => m.importWh, format: (v) => kwh(v), better: "lower", servedOnly: true },
    {
      label: "Слънце, ползвано на място",
      value: (m) => m.solarUtilization,
      format: (v) => formatPercent(v * 100),
      detail: (m) => (m.exportWh > 0 ? `отдадени ${kwh(m.exportWh)}` : "нищо не е отдадено"),
      better: "higher",
    },
    {
      label: "Коли, заредени навреме",
      value: (m) => m.evsOnTime,
      format: (v, m) => `${v} / ${m.evsTotal}`,
      detail: (m) => (m.unservedWh > 0 ? `недостиг ${formatNumber(m.unservedWh / 1000, 1)} kWh` : "всички заявки са изпълнени"),
      better: "higher",
    },
    {
      label: "Комфорт",
      sub: `°C·ч извън ${scenario.site.hvac.comfortMinC}–${scenario.site.hvac.comfortMaxC} °C`,
      value: (m) => m.comfortDegreeHours,
      format: (v) => formatNumber(v, 1),
      better: "lower",
    },
    {
      label: "Енергия през батерията",
      value: (m) => m.batteryThroughputWh,
      format: (v) => kwh(v),
      detail: (m) => `${formatNumber(m.batteryThroughputWh / (2 * scenario.site.battery.capacityWh), 2)} цикъла`,
      better: "lower",
    },
    { label: "Местения на коли", sub: "свързвания и размени", value: (m) => m.plugChanges, format: (v) => `${v}`, better: "lower" },
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
      list.push({ key: "you", label: "Вие", tone: "you", state: game.manual.state, metrics: metricsFor(scenario, game.manual.state) });
    }
    list.push(
      { key: "baseline", label: "Прости правила", tone: "baseline", dashed: true, state: baselineState, metrics: metricsFor(scenario, baselineState) },
      { key: "autopilot", label: "Автопилот", tone: "autopilot", state: autopilotState, metrics: metricsFor(scenario, autopilotState) },
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
          <p className="eyebrow">Резултати · {scenario.name} · вариант {scenario.seed}</p>
          <h2 id="verdict-title" className="verdict-headline">
            {headline}
          </h2>
          <p className="muted">{detail}</p>
        </div>
        <div className="table-scroll" style={{ maxHeight: "none" }}>
          <table className="data-table compare-table">
            <caption className="sr-only">Сравнение на изпълненията в един и същ ден</caption>
            <thead>
              <tr>
                <th scope="col">Показател</th>
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
            {game.manualDone ? "Изиграй деня отново" : "Изиграй деня"}
          </button>
          <button type="button" onClick={() => dispatch({ type: "start-autopilot" })}>
            Гледай Автопилота отново
          </button>
          <button type="button" onClick={() => dispatch({ type: "new-day", seed: scenario.seed + 1 })}>
            Друг ден (вариант {scenario.seed + 1})
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="import-title">
        <div className="panel-head">
          <h2 id="import-title">Взета от мрежата мощност през деня</h2>
          <span className="muted">Автопилотът се стреми към пик до {formatKw(PEAK_CAP_W)}</span>
        </div>
        <TimeChart title="Мощност от мрежата по изпълнения" x={x} series={series} height={240} formatY={formatKw} formatX={(t) => simClock(scenario, t)} />
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="cars-result-title">
          <div className="panel-head">
            <h2 id="cars-result-title">Всяка кола</h2>
            <span className="muted">получени от заявени kWh</span>
          </div>
          <div className="table-scroll" style={{ maxHeight: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Шофьор</th>
                  <th scope="col">Тръгва</th>
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
                          {formatNumber(got, 1)} / {(ev.needWh / 1000).toFixed(0)}
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
            <h2 id="fair-title">Как сравнението остава честно</h2>
          </div>
          <ul className="fairness">
            <li>Всяко изпълнение повтаря вариант {scenario.seed}: същото време, базов товар, тарифа, коли и срокове.</li>
            <li>
              Автопилотът решава всеки четвърт час по прогнозата „ден напред“ и по случилото се досега. Той не вижда
              бъдещите пристигания, нито истинските облаци.
            </li>
            <li>
              Разходът е коригиран за крайния заряд на батерията по средната цена за покупка за деня (
              {formatMoney(averageImportPrice(scenario), scenario.currency, 3)}/kWh), така че изпразването на батерията не
              се брои за спестяване.
            </li>
            <li>Пропуснатото зареждане се показва като недостиг на енергия и никога не се крие в разхода.</li>
            <li>
              „Прости правила“ значи: първа дошла кола, първа зарежда, на пълна мощност; батерията е на
              собствено потребление, а термостатът е на 23 °C през целия ден.
            </li>
            <li>Това са резултати от симулация. Те не обещават същите спестявания за реален обект или хардуер.</li>
          </ul>
          <div className="sim-actions">
            {columns.map((c) => (
              <button key={c.key} type="button" className="button-small" onClick={() => download(scenario, c.state, c.key)}>
                Изтегли {c.key === "you" ? "вашето изпълнение" : c.key === "autopilot" ? "изпълнението на Автопилота" : "„Прости правила“"} като телеметрия
              </button>
            ))}
          </div>
          <p className="footnote">
            JSON Lines по договор v1 за устройствата, с идентификаторите на устройствата от демо обекта Office: същите съобщения,
            които платформата приема от хардуера.
          </p>
        </section>
      </div>
    </div>
  );
}
