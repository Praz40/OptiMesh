import type { Dispatch } from "react";
import { formatKwBg } from "@/lib/format";
import type { GameAction } from "@/sim/game";
import type { Scenario } from "@/sim/scenario";
import { simClock } from "@/sim/view";

export function SimIntro({ scenario, dispatch }: { scenario: Scenario; dispatch: Dispatch<GameAction> }) {
  const { site } = scenario;
  const totalKwh = scenario.evs.reduce((sum, ev) => sum + ev.needWh, 0) / 1000;
  return (
    <div className="sim-hero">
      <section className="panel" aria-labelledby="intro-title">
        <p className="eyebrow">Сценарий · вариант {scenario.seed}</p>
        <h2 id="intro-title" style={{ fontSize: 20 }}>
          {scenario.name}
        </h2>
        <p className="muted" style={{ marginTop: 6 }}>
          {scenario.description}
        </p>
        <ul className="sim-facts">
          <li>
            <strong>{formatKwBg(site.solarPeakW)}</strong>слънчеви панели над паркинга
          </li>
          <li>
            <strong>{site.battery.capacityWh / 1000} kWh</strong>батерия, {formatKwBg(site.battery.maxW)}
          </li>
          <li>
            <strong>{scenario.evs.length} коли</strong>
            {scenario.chargers.length} зарядни × {formatKwBg(scenario.chargers[0].maxW)}
          </li>
          <li>
            <strong>{totalKwh.toFixed(0)} kWh</strong>заявени от шофьорите
          </li>
        </ul>
        <p>
          Управлявате енергията на офиса от {simClock(scenario, scenario.start)} до{" "}
          {simClock(scenario, scenario.start + scenario.steps * scenario.stepMinutes * 60_000)}, по четвърт час. Колите
          пристигат през сутринта и всеки шофьор иска заряд до определен час. После Автопилотът управлява точно същия
          ден: същото време, цени и коли.
        </p>
        <ol className="sim-goals">
          <li>Заредете всяка кола, преди шофьорът ѝ да тръгне.</li>
          <li>Дръжте офиса между {site.hvac.comfortMinC} и {site.hvac.comfortMaxC} °C, докато в него има хора.</li>
          <li>Харчете възможно най-малко и дръжте пика от мрежата нисък.</li>
        </ol>
        <div className="sim-actions">
          <button type="button" className="button-primary" onClick={() => dispatch({ type: "start-manual" })}>
            Започни деня
          </button>
          <button type="button" onClick={() => dispatch({ type: "start-autopilot" })}>
            Първо гледай Автопилота
          </button>
        </div>
      </section>
      <section className="panel" aria-labelledby="fleet-title">
        <div className="panel-head">
          <h2 id="fleet-title">Колите днес</h2>
          <span className="muted">Заявени от шофьорите</span>
        </div>
        <div className="table-scroll" style={{ maxHeight: "none", marginTop: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Шофьор</th>
                <th scope="col">Пристига</th>
                <th scope="col">Тръгва</th>
                <th scope="col" className="right">
                  Нужни
                </th>
              </tr>
            </thead>
            <tbody>
              {scenario.evs.map((ev) => (
                <tr key={ev.id}>
                  <td>
                    {ev.driver}
                    <span className="sub muted" style={{ display: "block", fontSize: 12 }}>
                      {ev.model} · до {formatKwBg(ev.maxW)}
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
          Обектът, устройствата и техните граници са същите като на обекта Office в таблото на живо. Времето тече на
          интервали от 15 минути; мощността е във W, а енергията във Wh, както в договора за устройствата.
        </p>
      </section>
    </div>
  );
}
