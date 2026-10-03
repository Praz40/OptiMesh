import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Costs } from "@/lib/api";
import { costsFixture, costsNoMeterFixture } from "@/lib/insights.fixtures";
import type { PollFailure, PollState } from "@/lib/poll";
import { CostsView, costTiles } from "./site-costs";

const NBSP = " ";
const render = (state: PollState<Costs>) => renderToStaticMarkup(<CostsView state={state} />);
const ready = (data: Costs, failure: PollFailure | null = null) =>
  render({ status: "ready", data, updatedAt: Date.parse("2026-10-04T07:20:05Z"), failure });

describe("CostsView", () => {
  it("shows a loading state before the first response", () => {
    const html = render({ status: "loading" });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Зареждане на разходите…");
  });

  it("says when the API cannot be reached or fails", () => {
    expect(render({ status: "failed", failure: { kind: "offline" } })).toContain("Няма връзка с OptiMesh API.");
    expect(render({ status: "failed", failure: { kind: "error", status: 500, message: "Internal error" } })).toContain(
      "API върна грешка 500.",
    );
  });

  it("shows today's cost, energy, the projected day and every hour", () => {
    const html = ready(costsFixture);
    expect(html).toContain("Разход досега днес");
    expect(html).toContain(`0,93${NBSP}€`);
    expect(html).toContain("6,4 kWh");
    expect(html).toContain("650 Wh");
    expect(html).toContain("Очакван разход за деня");
    expect(html).toContain(`5,45${NBSP}€`);
    expect(html.match(/<tbody>.*<\/tbody>/s)?.[0].match(/<tr>/g)).toHaveLength(costsFixture.intervals.length);
    expect(html).toContain("00:00–01:00");
    expect(html).toContain(`0,11${NBSP}€/kWh`);
    // The current hour is still being measured.
    expect(html).toMatch(/10:00–11:00<span class="tag">досега<\/span>/);
    expect(html).toContain("от полунощ до 10:20 (Europe/Sofia)");
    for (const assumption of costsFixture.assumptions) expect(html).toContain(assumption);
  });

  it("leaves out the projected day when the API gives none", () => {
    // As the API sends it: no projection, and no assumption about one.
    const unprojected: Costs = {
      ...costsFixture,
      projected_day_cost: null,
      assumptions: costsFixture.assumptions.filter((a) => !a.startsWith("Очакван разход")),
    };
    expect(costTiles(unprojected).map((t) => t.key)).toEqual(["cost", "import", "export"]);
    const html = ready(unprojected);
    expect(html).toContain("Разход досега днес</dt>");
    expect(html).not.toContain("Очакван разход за деня");
  });

  it("says clearly that a site without a grid meter has no measured cost", () => {
    const html = ready(costsNoMeterFixture);
    expect(html).toContain("Разходът не се измерва.");
    expect(html).toContain("Обектът няма електромер към мрежата.");
    expect(html).not.toContain("Разход досега днес");
    expect(html).not.toContain("<table");
    expect(html).toContain("Обектът няма електромер към мрежата, затова разходът не се измерва.");
  });

  it("has an empty state when the meter has sent nothing today", () => {
    const html = ready({ ...costsFixture, intervals: [], import_wh: 0, export_wh: 0, cost: 0 });
    expect(html).toContain("Още няма измервания днес");
    expect(html).not.toContain("Разход досега днес");
    expect(html).toContain("Очакван разход за деня");
  });

  it("keeps the last costs when a refresh fails, and says how old they are", () => {
    const html = ready(costsFixture, { kind: "error", status: 503, message: "Database unavailable" });
    expect(html).toContain("Обновяването не успя: API няма връзка с базата данни. Показани са данните от 10:20.");
    expect(html).toContain("Разход досега днес");
  });
});
