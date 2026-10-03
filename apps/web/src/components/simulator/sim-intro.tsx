import type { Dispatch } from "react";
import type { GameAction } from "@/sim/game";
import type { Scenario } from "@/sim/scenario";
import { simClock } from "@/sim/view";

export function SimIntro({ scenario, dispatch }: { scenario: Scenario; dispatch: Dispatch<GameAction> }) {
  const { site } = scenario;
  const totalKwh = scenario.evs.reduce((sum, ev) => sum + ev.needWh, 0) / 1000;
  return (
    <div className="sim-hero">
      <section className="panel" aria-labelledby="intro-title">
        <p className="eyebrow">Scenario · seed {scenario.seed}</p>
        <h2 id="intro-title" style={{ fontSize: 20 }}>
          {scenario.name}
        </h2>
        <p className="muted" style={{ marginTop: 6 }}>
          {scenario.description}
        </p>
        <ul className="sim-facts">
          <li>
            <strong>{site.solarPeakW / 1000} kW</strong>carport solar
          </li>
          <li>
            <strong>{site.battery.capacityWh / 1000} kWh</strong>battery, {site.battery.maxW / 1000} kW
          </li>
          <li>
            <strong>{scenario.evs.length} cars</strong>
            {scenario.chargers.length} chargers × {scenario.chargers[0].maxW / 1000} kW
          </li>
          <li>
            <strong>{totalKwh.toFixed(0)} kWh</strong>requested by drivers
          </li>
        </ul>
        <p>
          You run the office&apos;s energy from {simClock(scenario, scenario.start)} to{" "}
          {simClock(scenario, scenario.start + scenario.steps * scenario.stepMinutes * 60_000)}, a quarter-hour at a
          time. Cars arrive through the morning and each driver needs a charge by a fixed time. Then Autopilot runs
          exactly the same day: same weather, prices and cars.
        </p>
        <ol className="sim-goals">
          <li>Get every car charged before its driver leaves.</li>
          <li>Keep the office between {site.hvac.comfortMinC} and {site.hvac.comfortMaxC} °C while people are in.</li>
          <li>Spend as little as possible, and keep the peak grid draw low.</li>
        </ol>
        <div className="sim-actions">
          <button type="button" className="button-primary" onClick={() => dispatch({ type: "start-manual" })}>
            Start the day
          </button>
          <button type="button" onClick={() => dispatch({ type: "start-autopilot" })}>
            Watch Autopilot first
          </button>
        </div>
      </section>
      <section className="panel" aria-labelledby="fleet-title">
        <div className="panel-head">
          <h2 id="fleet-title">Today&apos;s cars</h2>
          <span className="muted">Booked by the drivers</span>
        </div>
        <div className="table-scroll" style={{ maxHeight: "none", marginTop: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Driver</th>
                <th scope="col">Arrives</th>
                <th scope="col">Leaves</th>
                <th scope="col" className="right">
                  Needs
                </th>
              </tr>
            </thead>
            <tbody>
              {scenario.evs.map((ev) => (
                <tr key={ev.id}>
                  <td>
                    {ev.driver}
                    <span className="sub muted" style={{ display: "block", fontSize: 12 }}>
                      {ev.model} · max {ev.maxW / 1000} kW
                    </span>
                  </td>
                  <td>{simClock(scenario, ev.arrival)}</td>
                  <td>{simClock(scenario, ev.departure)}</td>
                  <td className="right">{(ev.needWh / 1000).toFixed(0)} kWh</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          The site, its devices and their limits are the same Office the live dashboard shows. Time runs in 15-minute
          intervals; power is in W and energy in Wh, as in the device contract.
        </p>
      </section>
    </div>
  );
}
