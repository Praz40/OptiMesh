import type { ChartSeries } from "@/components/time-chart";
import type { Costs, Forecast, ForecastInterval } from "./api";

/** Polling periods agreed for the dashboard: the forecast changes slowly, costs every few seconds. */
export const FORECAST_POLL_MS = 5 * 60_000;
export const COSTS_POLL_MS = 30_000;

export type ForecastCharts = { x: number[]; energy: ChartSeries[]; prices: ChartSeries[] };

/** Chart data for the Forecast tab. Both charts share the x axis (interval starts) so they line up. */
export function forecastCharts(forecast: Forecast): ForecastCharts {
  const { intervals } = forecast;
  const energy: ChartSeries[] = [];
  // Dashed lines: the dashboard's mark for an expectation rather than a measurement.
  if (intervals.some((i) => i.solar_w !== null)) {
    energy.push({ key: "solar", label: "Очаквано слънце", tone: "solar", style: "dash", values: intervals.map((i) => i.solar_w) });
  }
  if (intervals.some((i) => i.load_w !== null)) {
    energy.push({
      key: "load",
      label: "Очаквана консумация",
      tone: "consumption",
      style: "dash",
      values: intervals.map((i) => i.load_w),
    });
  }
  const prices: ChartSeries[] = [
    { key: "import", label: "Покупка от мрежата", tone: "price", values: intervals.map((i) => i.import_price) },
    { key: "export", label: "Изкупуване на излишък", tone: "price", style: "dash", values: intervals.map((i) => i.export_price) },
  ];
  return { x: intervals.map((i) => Date.parse(i.start)), energy, prices };
}

/** The forecast interval that contains `at`, or null when the forecast does not cover it. */
export function intervalAt(forecast: Forecast, at: number): ForecastInterval | null {
  return forecast.intervals.find((i) => Date.parse(i.start) <= at && at < Date.parse(i.end)) ?? null;
}

export type CostNow = {
  /** Currency per hour at the current grid power; negative while exporting (revenue). */
  perHour: number;
  gridW: number;
  price: number;
  direction: "import" | "export";
  currency: string;
};

/**
 * What the grid exchange costs right now: grid_w × the price of the current hour. Import is
 * priced at the import price; export at the export price, as /costs does. Null when the grid
 * power, its timestamp or a forecast hour covering it is missing.
 */
export function costNow(
  gridW: number | null,
  measuredAt: string | null,
  forecast: Forecast | null,
): CostNow | null {
  if (gridW === null || !Number.isFinite(gridW) || measuredAt === null || forecast === null) return null;
  const interval = intervalAt(forecast, Date.parse(measuredAt));
  if (!interval) return null;
  const direction = gridW < 0 ? "export" : "import";
  const price = direction === "import" ? interval.import_price : interval.export_price;
  return { perHour: (gridW / 1000) * price, gridW, price, direction, currency: forecast.currency };
}

/** True when the forecast has at least one expected solar or load value to draw. */
export function hasForecastValues(forecast: Forecast): boolean {
  return forecast.intervals.some((i) => i.solar_w !== null || i.load_w !== null);
}

/** The hour row still being measured: it ends after the response's `as_of`. */
export function isOpenHour(costs: Costs, end: string): boolean {
  return Date.parse(end) > Date.parse(costs.as_of);
}
