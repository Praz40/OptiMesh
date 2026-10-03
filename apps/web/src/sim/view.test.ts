import { describe, expect, it } from "vitest";
import { run } from "./engine";
import { metricsFor, type RunMetrics } from "./metrics";
import { autopilotPolicy, baselinePolicy, idlePolicy } from "./policies";
import { officeScenario } from "./scenario";
import { carViews, formatDuration, verdict } from "./view";

const scenario = officeScenario(7);
const autopilot = metricsFor(scenario, run(scenario, autopilotPolicy));
const baseline = metricsFor(scenario, run(scenario, baselinePolicy));

describe("verdict", () => {
  it("leads with missed deadlines instead of calling a run that charged less cheaper", () => {
    const idle = metricsFor(scenario, run(scenario, idlePolicy)); // charges nothing, so it is "cheap"
    expect(idle.adjustedCostEur).toBeLessThan(autopilot.adjustedCostEur);
    const { headline, detail } = verdict(idle, autopilot, baseline);
    expect(headline).toBe("Автопилотът зареди навреме 10/10 коли; вие — 0/10.");
    expect(detail).toContain("не е сравним");
  });

  it("compares against simple rules when the player has not played", () => {
    expect(verdict(null, autopilot, baseline).headline).toContain("простите правила — 7/10");
  });

  it("admits it when the player wins on cost with every car charged", () => {
    const better: RunMetrics = { ...autopilot, adjustedCostEur: autopilot.adjustedCostEur - 1 };
    expect(verdict(better, autopilot, baseline).headline).toBe("Победихте Автопилота с 1,00\u00a0€.");
  });
});

describe("carViews", () => {
  it("shows every car's status at the current time", () => {
    const views = carViews(scenario, run(scenario, autopilotPolicy), {});
    expect(views).toHaveLength(10);
    expect(views.every((view) => view.status === "left-ok")).toBe(true);
  });
});

describe("formatDuration", () => {
  it("formats hours as h and min", () => {
    expect(formatDuration(1.5)).toBe("1 ч 30 мин");
    expect(formatDuration(0.25)).toBe("15 мин");
    expect(formatDuration(2)).toBe("2 ч");
    expect(formatDuration(-0.5)).toBe("−30 мин");
  });
});
