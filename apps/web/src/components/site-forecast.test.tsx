import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Forecast } from "@/lib/api";
import { forecastFixture } from "@/lib/insights.fixtures";
import type { PollFailure, PollState } from "@/lib/poll";
import { ForecastView } from "./site-forecast";

const render = (state: PollState<Forecast>) => renderToStaticMarkup(<ForecastView state={state} />);
const ready = (data: Forecast, failure: PollFailure | null = null) =>
  render({ status: "ready", data, updatedAt: Date.parse("2026-10-04T07:20:05Z"), failure });

describe("ForecastView", () => {
  it("shows a loading state before the first response", () => {
    const html = render({ status: "loading" });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Зареждане на прогнозата…");
  });

  it("says when the API cannot be reached", () => {
    const html = render({ status: "failed", failure: { kind: "offline" } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Няма връзка с API");
    expect(html).toContain("Опитваме отново автоматично.");
  });

  it("says when the API answers with an error", () => {
    expect(render({ status: "failed", failure: { kind: "error", status: 503, message: "Database unavailable" } })).toContain(
      "API няма връзка с базата данни.",
    );
    const missing = render({ status: "failed", failure: { kind: "error", status: 404, message: "Site not found" } });
    expect(missing).toContain("Обектът не е намерен.");
    expect(missing).not.toContain("Опитваме отново");
  });

  it("marks the whole screen as a forecast and lists the assumptions verbatim", () => {
    const html = ready(forecastFixture);
    expect(html).toContain("Прогноза, не измерване.");
    expect(html).toContain("изчислени в 10:20 (Europe/Sofia)");
    expect(html).toContain("Очаквано слънце");
    expect(html).toContain("Очаквана консумация");
    expect(html).toContain("Покупка от мрежата");
    expect(html).toContain("Изкупуване на излишък");
    expect(html).toContain("Демо тарифа по часови зони · EUR за kWh");
    for (const assumption of forecastFixture.assumptions) expect(html).toContain(assumption);
  });

  it("draws energy and prices as two separate charts, prices as steps", () => {
    const html = ready(forecastFixture);
    expect(html.match(/<svg[^>]*role="img"/g)).toHaveLength(2);
    expect(html).toMatch(/<title[^>]*>Прогноза за слънчевото производство и консумацията/);
    expect(html).toMatch(/<title[^>]*>Цена за покупка и изкупуване на енергия по часове/);
    // Step curves are drawn with H/V segments only.
    const priceChart = html.slice(html.indexOf("Цена за покупка"));
    expect(priceChart).toMatch(/class="chart-line" d="M[\d.,]+H/);
  });

  it("has an empty state when there is nothing to forecast", () => {
    const empty: Forecast = {
      ...forecastFixture,
      intervals: forecastFixture.intervals.map((i) => ({ ...i, solar_w: null, load_w: null })),
    };
    expect(ready(empty)).toContain("Няма какво да се прогнозира");
  });

  it("keeps the last forecast when a refresh fails, and says how old it is", () => {
    const html = ready(forecastFixture, { kind: "offline" });
    expect(html).toContain("Обновяването не успя: Няма връзка с OptiMesh API. Показани са данните от 10:20.");
    expect(html).toContain("Очаквано слънце");
  });
});
