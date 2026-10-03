"use client";

import { useMemo, type Dispatch } from "react";
import { EnergyFlow } from "@/components/energy-flow";
import { BatteryIcon, BuildingIcon, CoinIcon, EvIcon, GridIcon, SolarIcon } from "@/components/icons";
import { KpiTiles } from "@/components/site-kpis";
import { TimeChart } from "@/components/time-chart";
import { formatKw, formatPercent, formatPower, powerParts, type FlowNode } from "@/lib/energy";
import { formatMoney, formatNumber, formatPrice } from "@/lib/format";
import { timeAt, toSiteSummary, type BatteryMode, type Controls, type SimEvent, type SimState } from "@/sim/engine";
import { SPEEDS, type Game, type GameAction } from "@/sim/game";
import { metricsFor } from "@/sim/metrics";
import type { Scenario } from "@/sim/scenario";
import { carViews, formatDuration, formatEur, simClock, type CarView } from "@/sim/view";

const ALL_FLOWS = new Set<FlowNode>(["solar", "grid", "battery", "ev"]);

const BATTERY_MODES: { mode: BatteryMode; label: string; hint: string }[] = [
  { mode: "auto", label: "Собствено потребление", hint: "Съхранява излишъка от слънцето и покрива недостига." },
  { mode: "peak", label: "Рязане на пикове", hint: "Съхранява излишъка; разрежда само когато взетото от мрежата надхвърли 22 kW." },
  { mode: "hold", label: "Задържане", hint: "Пази заряда за по-късно." },
  { mode: "charge", label: "Зареждане", hint: "Зарежда с пълна мощност, при нужда и от мрежата." },
  { mode: "discharge", label: "Разреждане", hint: "Разрежда с пълна мощност; излишъкът се отдава към мрежата." },
];

const POWER_STEPS = [0, 3700, 7400, 11_000];

type Props = { game: Game; dispatch: Dispatch<GameAction>; readOnly: boolean };

function Hud({ game, dispatch, readOnly }: Props) {
  const { scenario } = game;
  const state = readOnly ? game.autopilot.state : game.manual.state;
  const done = state.step >= scenario.steps;
  const now = timeAt(scenario, state.step);
  const progress = (state.step / scenario.steps) * 100;
  return (
    <div className="sim-hud">
      <p className="sim-clock" aria-live="off">
        {simClock(scenario, now)}
      </p>
      <div className="sim-progress" role="progressbar" aria-valuemin={0} aria-valuemax={scenario.steps} aria-valuenow={state.step} aria-label="Напредък на деня">
        <div className="sim-progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="sim-progress-labels">
          <span>{simClock(scenario, scenario.start)}</span>
          <span>{simClock(scenario, timeAt(scenario, scenario.steps))}</span>
        </div>
      </div>
      {!done && (
        <button
          type="button"
          className={game.playing ? undefined : "button-primary"}
          onClick={() => dispatch({ type: game.playing ? "pause" : "play" })}
        >
          {game.playing ? "Пауза" : "Пусни"}
        </button>
      )}
      {!done && !game.playing && !readOnly && (
        <button type="button" onClick={() => dispatch({ type: "tick" })}>
          +15 мин
        </button>
      )}
      {!readOnly && !done && (
        <div className="segmented" role="group" aria-label="Скорост">
          {SPEEDS.map((speed) => (
            <button key={speed.label} type="button" aria-pressed={game.tickMs === speed.ms} onClick={() => dispatch({ type: "speed", ms: speed.ms })}>
              {speed.label}
            </button>
          ))}
        </div>
      )}
      {readOnly ? (
        <button type="button" className="button-ghost" onClick={() => dispatch({ type: "show-results" })}>
          Към резултатите
        </button>
      ) : (
        <button type="button" className="button-ghost" onClick={() => dispatch({ type: "restart" })}>
          Отначало
        </button>
      )}
    </div>
  );
}

function SimTiles({ scenario, state }: { scenario: Scenario; state: SimState }) {
  const metrics = useMemo(() => metricsFor(scenario, state), [scenario, state]);
  const last = state.records.at(-1);
  const views = carViews(scenario, state, state.plugs);
  const ready = views.filter((v) => v.status === "ready" || v.status === "left-ok").length;
  const short = views.filter((v) => v.status === "left-short").length;
  const [peak, peakUnit] = powerParts(metrics.peakImportW);
  const { comfortMinC, comfortMaxC } = scenario.site.hvac;
  const indoor = state.indoorC;
  return (
    <KpiTiles
      tiles={[
        {
          key: "cost",
          label: "Разход досега",
          icon: <CoinIcon />,
          tone: "price",
          value: formatEur(metrics.energyCostEur),
          note: last ? `сега ${formatPrice(last.importPrice, scenario.currency)}` : "цени „ден напред“",
        },
        {
          key: "peak",
          label: "Пик от мрежата",
          icon: <GridIcon />,
          tone: "grid",
          value: peak,
          unit: peakUnit,
          note: `присъединяване ${formatKw(scenario.site.importLimitW)}`,
        },
        {
          key: "solar",
          label: "Слънце, ползвано на място",
          icon: <SolarIcon />,
          tone: "solar",
          value: metrics.solarWh > 0 ? formatPercent(metrics.solarUtilization * 100) : "—",
          note: `произведени ${(metrics.solarWh / 1000).toFixed(0)} kWh`,
        },
        {
          key: "cars",
          label: "Заредени коли",
          icon: <EvIcon />,
          tone: "ev",
          value: `${ready}`,
          unit: `/ ${scenario.evs.length}`,
          note: short > 0 ? `${short} тръгнаха недозаредени` : "няма недозаредени",
        },
        {
          key: "comfort",
          label: "Температура в офиса",
          icon: <BuildingIcon />,
          tone: "consumption",
          value: formatNumber(indoor, 1),
          unit: "°C",
          note: indoor > comfortMaxC || indoor < comfortMinC ? `извън ${comfortMinC}–${comfortMaxC} °C` : "комфортно",
        },
      ]}
    />
  );
}

function BatteryControl({ controls, state, scenario, dispatch, readOnly }: { controls: Controls; state: SimState; scenario: Scenario; dispatch: Dispatch<GameAction>; readOnly: boolean }) {
  const soc = (state.socWh / scenario.site.battery.capacityWh) * 100;
  const last = state.records.at(-1);
  const current = BATTERY_MODES.find((m) => m.mode === controls.battery);
  return (
    <div className="control-group">
      <h3>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <BatteryIcon level={soc} width={18} height={18} style={{ color: "var(--battery)" }} /> Батерия
        </span>
        <span className="muted">
          {formatPercent(soc)} ·{" "}
          {last && Math.abs(last.batteryW) >= 20 ? `${last.batteryW > 0 ? "зарежда" : "разрежда"} ${formatPower(Math.abs(last.batteryW))}` : "в покой"}
        </span>
      </h3>
      <div className="mode-grid" role="radiogroup" aria-label="Режим на батерията">
        {BATTERY_MODES.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={controls.battery === option.mode}
            disabled={readOnly}
            onClick={() => dispatch({ type: "battery", mode: option.mode })}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="control-hint">{current?.hint}</p>
    </div>
  );
}

function HvacControl({ controls, state, scenario, dispatch, readOnly }: { controls: Controls; state: SimState; scenario: Scenario; dispatch: Dispatch<GameAction>; readOnly: boolean }) {
  const setpoint = controls.hvacSetpointC;
  const last = state.records.at(-1);
  const { comfortMinC, comfortMaxC } = scenario.site.hvac;
  const outside = state.indoorC > comfortMaxC || state.indoorC < comfortMinC;
  const set = (value: number | null) => dispatch({ type: "hvac", setpoint: value });
  return (
    <div className="control-group">
      <h3>
        <span>Климатизация</span>
        <span className="muted">{last ? formatPower(last.hvacW) : "—"}</span>
      </h3>
      <div className="thermostat">
        <button type="button" aria-label="Намали термостата" disabled={readOnly || setpoint === null || setpoint <= 19} onClick={() => set((setpoint ?? 23) - 0.5)}>
          −
        </button>
        <span className="thermostat-value" aria-live="polite">
          {setpoint === null ? "Изключена" : `${formatNumber(setpoint, 1)} °C`}
        </span>
        <button type="button" aria-label="Увеличи термостата" disabled={readOnly || setpoint === null || setpoint >= 27} onClick={() => set((setpoint ?? 23) + 0.5)}>
          +
        </button>
        <button type="button" className="button-small" disabled={readOnly} onClick={() => set(setpoint === null ? 23 : null)}>
          {setpoint === null ? "Включи" : "Изключи"}
        </button>
      </div>
      <p className="temp-readout">
        <span>
          Вътре <strong data-tone={outside ? "warn" : undefined}>{formatNumber(state.indoorC, 1)} °C</strong>
        </span>
        <span>Навън {last ? `${last.outdoorC.toFixed(0)} °C` : "—"}</span>
        <span>
          Комфорт {comfortMinC}–{comfortMaxC} °C, 08:00–18:00
        </span>
      </p>
    </div>
  );
}

function Chargers({ scenario, controls, state, views, dispatch, readOnly }: { scenario: Scenario; controls: Controls; state: SimState; views: CarView[]; dispatch: Dispatch<GameAction>; readOnly: boolean }) {
  const last = state.records.at(-1);
  return (
    <div className="control-group">
      <h3>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <EvIcon width={18} height={18} style={{ color: "var(--ev)" }} /> Зарядни
        </span>
        <span className="muted">{last ? formatPower(last.evW) : "—"}</span>
      </h3>
      <div className="chargers">
        {scenario.chargers.map((charger) => {
          const car = views.find((view) => view.ev.id === controls.plugs[charger.id]);
          const powerW = last?.chargerW[charger.id] ?? 0;
          return (
            <div key={charger.id} className="charger" data-active={powerW > 0}>
              <div>
                <p className="charger-name">
                  {charger.name}
                  <span className="muted">
                    {powerW > 0 ? formatPower(powerW) : car?.status === "ready" ? "колата е заредена, откачете я" : car ? "в покой" : "свободна"}
                  </span>
                </p>
                <p className="charger-car">
                  {car
                    ? `${car.ev.driver} · ${formatNumber(car.deliveredWh / 1000, 1)} от ${(car.ev.needWh / 1000).toFixed(0)} kWh`
                    : "Няма свързана кола"}
                </p>
              </div>
              <div className="charger-tools">
                <label>
                  <span className="sr-only">Лимит на мощността на {charger.name}</span>
                  <select
                    value={controls.chargerW[charger.id]}
                    disabled={readOnly}
                    onChange={(event) => dispatch({ type: "charger-power", chargerId: charger.id, watts: Number(event.target.value) })}
                  >
                    {POWER_STEPS.map((watts) => (
                      <option key={watts} value={watts}>
                        {watts === 0 ? "Пауза" : formatKw(watts)}
                      </option>
                    ))}
                    {!POWER_STEPS.includes(controls.chargerW[charger.id]) && (
                      <option value={controls.chargerW[charger.id]}>{formatKw(controls.chargerW[charger.id])}</option>
                    )}
                  </select>
                </label>
                {car && !readOnly && (
                  <button type="button" className="button-small" onClick={() => dispatch({ type: "unplug", chargerId: charger.id })}>
                    Откачи
                  </button>
                )}
              </div>
              {car && (
                <div className="bar" data-tone={car.status === "ready" ? "good" : undefined} aria-hidden="true">
                  <span style={{ width: `${Math.min((car.deliveredWh / car.ev.needWh) * 100, 100)}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_TEXT: Record<CarView["status"], string> = {
  upcoming: "Още не е тук",
  waiting: "Чака зарядна",
  charging: "Зарежда",
  plugged: "Свързана, не зарежда",
  ready: "Заредена",
  "left-ok": "Тръгна заредена",
  "left-short": "Тръгна недозаредена",
};

const STATUS_TONE: Partial<Record<CarView["status"], "good" | "warn" | "bad" | "accent">> = {
  charging: "accent",
  ready: "good",
  "left-ok": "good",
  "left-short": "bad",
  waiting: "warn",
};

function CarCard({ view, scenario, controls, dispatch, readOnly }: { view: CarView; scenario: Scenario; controls: Controls; dispatch: Dispatch<GameAction>; readOnly: boolean }) {
  const { ev } = view;
  const freeCharger = scenario.chargers.find((charger) => !controls.plugs[charger.id])?.id;
  const parked = ["waiting", "charging", "plugged", "ready"].includes(view.status);
  const share = Math.min(view.deliveredWh / ev.needWh, 1) * 100;
  const tone = view.status === "left-short" ? "bad" : view.status === "ready" || view.status === "left-ok" ? "good" : undefined;
  return (
    <li className="car" data-status={view.status.startsWith("left") ? "left" : view.status} data-risk={view.atRisk}>
      <div className="car-head">
        <div>
          <p>{ev.driver}</p>
          <p className="muted" style={{ fontSize: 12 }}>
            {ev.model}
          </p>
        </div>
        <span className="chip" data-tone={STATUS_TONE[view.status]}>
          {STATUS_TEXT[view.status]}
        </span>
      </div>
      <div className="bar" data-tone={tone} aria-hidden="true">
        <span style={{ width: `${share}%` }} />
      </div>
      <p className="car-meta">
        <span>
          {formatNumber(view.deliveredWh / 1000, 1)} / {(ev.needWh / 1000).toFixed(0)} kWh
        </span>
        <span>
          {view.status === "upcoming" ? `пристига ${simClock(scenario, ev.arrival)}` : `тръгва ${simClock(scenario, ev.departure)}`}
        </span>
      </p>
      {view.slackH !== null && (
        <p className="car-meta" style={{ color: view.atRisk ? "var(--warn)" : undefined }}>
          <span>{view.slackH < 0 ? `Не стигат ${formatDuration(-view.slackH)} дори на пълна мощност` : `Резерв ${formatDuration(view.slackH)} при пълна мощност`}</span>
        </p>
      )}
      {view.status === "ready" && view.chargerId && !readOnly && (
        <div className="car-actions">
          <button type="button" className="button-small" onClick={() => dispatch({ type: "unplug", chargerId: view.chargerId as string })}>
            Откачи и освободи {scenario.chargers.find((c) => c.id === view.chargerId)?.name}
          </button>
        </div>
      )}
      {parked && !readOnly && view.status !== "ready" && (
        <div className="car-actions">
          {freeCharger && !view.chargerId ? (
            <button type="button" className="button-small button-primary" onClick={() => dispatch({ type: "plug", evId: ev.id, chargerId: freeCharger })}>
              Свържи
            </button>
          ) : null}
          <label>
            <span className="sr-only">Премести колата на {ev.driver} на зарядна</span>
            <select
              value={view.chargerId ?? ""}
              onChange={(event) => {
                const chargerId = event.target.value;
                if (chargerId) dispatch({ type: "plug", evId: ev.id, chargerId });
                else if (view.chargerId) dispatch({ type: "unplug", chargerId: view.chargerId });
              }}
            >
              <option value="">{view.chargerId ? "Откачи" : freeCharger ? "Избери зарядна…" : "Смени с…"}</option>
              {scenario.chargers.map((charger) => {
                const occupant = scenario.evs.find((other) => other.id === controls.plugs[charger.id]);
                return (
                  <option key={charger.id} value={charger.id}>
                    {charger.name}
                    {occupant && occupant.id !== ev.id ? ` (вместо ${occupant.driver})` : occupant ? " (текуща)" : " (свободна)"}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
      )}
    </li>
  );
}

function DayCharts({ scenario, state }: { scenario: Scenario; state: SimState }) {
  const x = useMemo(() => Array.from({ length: scenario.steps }, (_, i) => timeAt(scenario, i)), [scenario]);
  const pick = (f: (r: SimState["records"][number]) => number) => x.map((_, i) => (state.records[i] ? f(state.records[i]) : null));
  const now = timeAt(scenario, Math.min(state.step, scenario.steps - 1));
  const clock = (t: number) => simClock(scenario, t);
  return (
    <div className="stack">
      <TimeChart
        title="Мощност на обекта през деня"
        x={x}
        series={[
          { key: "solar", label: "Слънце", tone: "solar", style: "area", values: pick((r) => r.solarW) },
          { key: "consumption", label: "Консумация", tone: "consumption", values: pick((r) => r.baseW + r.hvacW + r.evW) },
          { key: "grid", label: "Мрежа (+ взета)", tone: "grid", values: pick((r) => r.gridW) },
        ]}
        height={230}
        formatY={formatKw}
        formatX={clock}
        marker={state.step > 0 && state.step < scenario.steps ? { x: now, label: "сега" } : undefined}
        emptyText="Графиката се попълва, докато денят тече."
      />
      <div>
        <h3 className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>
          Цена за покупка, „ден напред“ (€/kWh)
        </h3>
        <TimeChart
          title="Цена за покупка през деня"
          x={x}
          series={[{ key: "price", label: "Цена за покупка", tone: "price", values: scenario.series.importPrice }]}
          height={120}
          curve="step"
          formatY={(v) => formatMoney(v, scenario.currency)}
          formatX={clock}
          marker={state.step < scenario.steps ? { x: now, label: "сега" } : undefined}
        />
      </div>
    </div>
  );
}

function EventLog({ scenario, events }: { scenario: Scenario; events: SimEvent[] }) {
  const recent = [...events].reverse().slice(0, 30);
  if (recent.length === 0) return <p className="muted">Още нищо не се е случило.</p>;
  return (
    <ol className="events">
      {recent.map((event, i) => (
        <li key={`${event.t}-${i}`}>
          <time>{simClock(scenario, event.t)}</time>
          <span className="status-dot" data-tone={event.tone} aria-hidden="true" />
          <span>{event.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function SimPlay({ game, dispatch, readOnly }: Props) {
  const { scenario } = game;
  const run = readOnly ? game.autopilot : game.manual;
  const { state, controls } = run;
  const views = carViews(scenario, state, controls.plugs);
  const summary = toSiteSummary(scenario, state.records.at(-1));

  return (
    <>
      <Hud game={game} dispatch={dispatch} readOnly={readOnly} />
      {readOnly && (
        <p className="sim-banner">
          <strong>Автопилотът</strong> управлява същия ден: същото време, цени и коли. Вижда само прогнозата „ден
          напред“ и случилото се досега.
        </p>
      )}
      <SimTiles scenario={scenario} state={state} />
      <div className="sim-layout">
        <section className="panel" aria-labelledby="sim-cars-title">
          <div className="panel-head">
            <h2 id="sim-cars-title">Паркинг</h2>
            <span className="muted">Резерв: колко може да чака колата и пак да се зареди на пълна мощност</span>
          </div>
          <Chargers scenario={scenario} controls={controls} state={state} views={views} dispatch={dispatch} readOnly={readOnly} />
          <div className="control-group">
            <h3>
              <span>Коли</span>
              <span className="muted">{readOnly ? "Автопилотът разпределя всяка кола в най-евтините интервали от 15 минути" : "Свързването важи от следващия четвърт час"}</span>
            </h3>
            <ul className="cars" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {views.map((view) => (
                <CarCard key={view.ev.id} view={view} scenario={scenario} controls={controls} dispatch={dispatch} readOnly={readOnly} />
              ))}
            </ul>
          </div>
        </section>
        <div className="stack">
          <section className="panel" aria-labelledby="sim-flow-title">
            <div className="panel-head">
              <h2 id="sim-flow-title">Поток на енергията</h2>
              <span className="muted">средно за 15 минути</span>
            </div>
            <EnergyFlow summary={summary} present={ALL_FLOWS} />
          </section>
          <section className="panel" aria-labelledby="sim-controls-title">
            <div className="panel-head">
              <h2 id="sim-controls-title">{readOnly ? "Настройки на Автопилота" : "Сграда"}</h2>
            </div>
            <BatteryControl controls={controls} state={state} scenario={scenario} dispatch={dispatch} readOnly={readOnly} />
            <HvacControl controls={controls} state={state} scenario={scenario} dispatch={dispatch} readOnly={readOnly} />
          </section>
        </div>
        <section className="panel" aria-labelledby="sim-chart-title">
          <div className="panel-head">
            <h2 id="sim-chart-title">Денят досега</h2>
          </div>
          <DayCharts scenario={scenario} state={state} />
        </section>
        <section className="panel" aria-labelledby="sim-events-title">
          <div className="panel-head">
            <h2 id="sim-events-title">Какво се случи</h2>
          </div>
          <EventLog scenario={scenario} events={state.events} />
        </section>
      </div>
    </>
  );
}
