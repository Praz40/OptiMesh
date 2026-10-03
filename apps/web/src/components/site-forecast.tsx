"use client";

import { useMemo } from "react";
import { ChartIcon } from "@/components/icons";
import { AssumptionList, PollPending, StaleNotice } from "@/components/poll-status";
import { TimeChart } from "@/components/time-chart";
import { usePolled } from "@/hooks/use-polled";
import { useSiteLive } from "@/hooks/use-site-live";
import { api, type Forecast } from "@/lib/api";
import { formatHourRange, formatKwBg, formatMoney, formatSiteTime } from "@/lib/format";
import { FORECAST_POLL_MS, forecastCharts, hasForecastValues } from "@/lib/insights";
import type { PollState } from "@/lib/poll";

function ForecastPanels({ forecast }: { forecast: Forecast }) {
  const charts = useMemo(() => forecastCharts(forecast), [forecast]);
  const tz = forecast.timezone;
  const hourly = (t: number) => {
    const interval = forecast.intervals.find((i) => Date.parse(i.start) === t);
    return interval ? formatHourRange(interval.start, interval.end, tz) : formatSiteTime(t, tz);
  };
  // Only on the price chart: on the energy chart it would cross the "Прогноза" band label.
  const nowMarker = { x: Date.parse(forecast.generated_at), label: "сега" };

  return (
    <>
      <section className="panel" aria-labelledby="forecast-energy-title">
        <div className="panel-head">
          <h2 id="forecast-energy-title">Очаквано производство и консумация</h2>
          <span className="muted">средно за всеки час · следващите {forecast.intervals.length} часа</span>
        </div>
        <TimeChart
          title="Прогноза за слънчевото производство и консумацията"
          x={charts.x}
          series={charts.energy}
          height={250}
          formatY={formatKwBg}
          formatX={(t) => formatSiteTime(t, tz)}
          formatXLong={hourly}
          shadeFrom={charts.x[0]}
          shadeLabel="Прогноза"
          emptyText={
            hasForecastValues(forecast)
              ? "Твърде малко часове за графика."
              : "Няма какво да се прогнозира: обектът няма инвертор, а консумацията още не е измерена."
          }
        />
      </section>

      <section className="panel" aria-labelledby="forecast-price-title">
        <div className="panel-head">
          <h2 id="forecast-price-title">Цена на енергията</h2>
          <span className="muted">
            {forecast.tariff} · {forecast.currency} за kWh
          </span>
        </div>
        <TimeChart
          title="Цена за покупка и изкупуване на енергия по часове"
          x={charts.x}
          series={charts.prices}
          height={170}
          curve="step"
          formatY={(value) => formatMoney(value, forecast.currency)}
          formatX={(t) => formatSiteTime(t, tz)}
          formatXLong={hourly}
          marker={nowMarker}
          emptyText="Няма цени за показване."
        />
      </section>
    </>
  );
}

/** The Forecast tab for any poll state. Exported for tests; the page uses SiteForecast. */
export function ForecastView({ state }: { state: PollState<Forecast> }) {
  if (state.status !== "ready") {
    return <PollPending failure={state.status === "failed" ? state.failure : null} loadingText="Зареждане на прогнозата…" />;
  }
  const forecast = state.data;
  return (
    <div className="stack">
      {state.failure && <StaleNotice failure={state.failure} updatedAt={state.updatedAt} timeZone={forecast.timezone} />}
      <p className="notice" data-tone="info" role="note">
        <ChartIcon />
        <span>
          <strong>Прогноза, не измерване.</strong> Очаквания за следващите часове, изчислени в{" "}
          {formatSiteTime(forecast.generated_at, forecast.timezone)} ({forecast.timezone}). Измерените стойности са
          в „Overview“.
        </span>
      </p>
      <ForecastPanels forecast={forecast} />
      <AssumptionList id="forecast-assumptions-title" items={forecast.assumptions} />
    </div>
  );
}

export function SiteForecast() {
  const { siteId } = useSiteLive();
  const state = usePolled(api.forecast, siteId, FORECAST_POLL_MS);
  return <ForecastView state={state} />;
}
