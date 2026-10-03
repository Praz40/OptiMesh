"use client";

import { ChartIcon, CoinIcon, GridIcon, SolarIcon } from "@/components/icons";
import { AssumptionList, PollPending, StaleNotice } from "@/components/poll-status";
import { KpiTiles, type Tile } from "@/components/site-kpis";
import { usePolled } from "@/hooks/use-polled";
import { useSiteLive } from "@/hooks/use-site-live";
import { api, type Costs } from "@/lib/api";
import { formatEnergyBg, formatHourRange, formatMoney, formatPrice, formatSiteTime } from "@/lib/format";
import { COSTS_POLL_MS, isOpenHour } from "@/lib/insights";
import type { PollState } from "@/lib/poll";

export function costTiles(costs: Costs): Tile[] {
  const money = (value: number) => formatMoney(value, costs.currency);
  const tiles: Tile[] = [
    {
      key: "cost",
      label: "Разход досега днес",
      icon: <CoinIcon />,
      tone: "price",
      value: money(costs.cost),
      note: `покупка ${money(costs.import_cost)} − изкупуване ${money(costs.export_revenue)}`,
    },
    {
      key: "import",
      label: "Взета от мрежата",
      icon: <GridIcon />,
      tone: "grid",
      value: formatEnergyBg(costs.import_wh),
      note: "измерено на електромера",
    },
    {
      key: "export",
      label: "Отдадена към мрежата",
      icon: <SolarIcon />,
      tone: "solar",
      value: formatEnergyBg(costs.export_wh),
      note: "излишък, изкупен по тарифата",
    },
  ];
  if (costs.projected_day_cost !== null) {
    tiles.push({
      key: "projected",
      label: "Очакван разход за деня",
      icon: <ChartIcon />,
      tone: "price",
      value: money(costs.projected_day_cost),
      note: "прогноза до полунощ, без батерията",
    });
  }
  return tiles;
}

function HourTable({ costs }: { costs: Costs }) {
  const tz = costs.timezone;
  return (
    <div className="table-scroll table-tall">
      <table className="data-table">
        <caption className="sr-only">Разход по часове за днес</caption>
        <thead>
          <tr>
            <th scope="col">Час</th>
            <th scope="col" className="right">Взета</th>
            <th scope="col" className="right">Отдадена</th>
            <th scope="col" className="right">Цена покупка</th>
            <th scope="col" className="right">Разход</th>
          </tr>
        </thead>
        <tbody>
          {costs.intervals.map((interval) => (
            <tr key={interval.start}>
              <td>
                {formatHourRange(interval.start, interval.end, tz)}
                {isOpenHour(costs, interval.end) && <span className="tag">досега</span>}
              </td>
              <td className="right">{formatEnergyBg(interval.import_wh)}</td>
              <td className="right">{formatEnergyBg(interval.export_wh)}</td>
              <td className="right">{formatPrice(interval.import_price, costs.currency)}</td>
              <td className="right">{formatMoney(interval.cost, costs.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Общо</th>
            <td className="right">{formatEnergyBg(costs.import_wh)}</td>
            <td className="right">{formatEnergyBg(costs.export_wh)}</td>
            <td />
            <td className="right">{formatMoney(costs.cost, costs.currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function CostPanels({ costs }: { costs: Costs }) {
  const asOf = formatSiteTime(costs.as_of, costs.timezone);
  if (!costs.has_meter) {
    return (
      <p className="notice" role="status" data-variant="no-meter">
        <GridIcon />
        <span>
          <strong>Разходът не се измерва.</strong> Обектът няма електромер към мрежата. Добавете електромер, за да
          виждате колко струва енергията днес.
        </span>
      </p>
    );
  }
  if (costs.intervals.length === 0) {
    return (
      <>
        {costs.projected_day_cost !== null && <KpiTiles tiles={costTiles(costs).filter((t) => t.key === "projected")} />}
        <section className="empty-state" data-variant="no-readings">
          <h2>Още няма измервания днес</h2>
          <p>Електромерът не е изпратил данни от полунощ до {asOf}. Разходът ще се появи с първите измервания.</p>
        </section>
      </>
    );
  }
  return (
    <>
      <KpiTiles tiles={costTiles(costs)} />
      <section className="panel" aria-labelledby="costs-hours-title">
        <div className="panel-head">
          <h2 id="costs-hours-title">По часове</h2>
          <span className="muted">
            от полунощ до {asOf} ({costs.timezone}) · {costs.tariff}
          </span>
        </div>
        <HourTable costs={costs} />
      </section>
    </>
  );
}

/** The Costs tab for any poll state. Exported for tests; the page uses SiteCosts. */
export function CostsView({ state }: { state: PollState<Costs> }) {
  if (state.status !== "ready") {
    return <PollPending failure={state.status === "failed" ? state.failure : null} loadingText="Зареждане на разходите…" />;
  }
  const costs = state.data;
  return (
    <div className="stack">
      {state.failure && <StaleNotice failure={state.failure} updatedAt={state.updatedAt} timeZone={costs.timezone} />}
      <CostPanels costs={costs} />
      <AssumptionList id="costs-assumptions-title" items={costs.assumptions} />
    </div>
  );
}

export function SiteCosts() {
  const { siteId } = useSiteLive();
  const state = usePolled(api.costs, siteId, COSTS_POLL_MS);
  return <CostsView state={state} />;
}
