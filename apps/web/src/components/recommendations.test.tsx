import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Command, DeviceLive, Recommendation } from "@/lib/api";
import { command, EV_CHARGER, homeDevices, homeLive, PLUG, reading } from "@/lib/assist.fixtures";
import { recommendationsSurplusFixture } from "@/lib/insights.fixtures";
import type { PollState } from "@/lib/poll";
import { RecommendationList, type Applied } from "./recommendations";

const NBSP = " ";
const [absorb, runPlug] = recommendationsSurplusFixture;

function render({
  state = { status: "ready", data: recommendationsSurplusFixture, updatedAt: Date.parse("2026-10-04T10:05:00Z"), failure: null },
  live = homeLive,
  commands = {},
  applied = {},
}: {
  state?: PollState<Recommendation[]>;
  live?: DeviceLive[];
  commands?: Record<string, Command>;
  applied?: Record<string, Applied>;
}) {
  return renderToStaticMarkup(
    <RecommendationList
      state={state}
      devices={homeDevices}
      live={live}
      commands={commands}
      applied={applied}
      onApply={() => undefined}
      timeZone="Europe/Sofia"
    />,
  );
}

/** The HTML of one recommendation row. */
function row(html: string, recommendation: Recommendation): string {
  const start = html.indexOf(`aria-labelledby="rec-${recommendation.id}"`);
  const end = html.indexOf("</li>", start);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, end);
}

const buttonOf = (rowHtml: string) => rowHtml.match(/<button[^>]*>[^<]*<\/button>/)?.[0] ?? "";

describe("RecommendationList", () => {
  it("shows loading, offline, error and empty states", () => {
    expect(render({ state: { status: "loading" } })).toContain("Зареждане на препоръките…");
    expect(render({ state: { status: "failed", failure: { kind: "offline" } } })).toContain(
      "Препоръките не са налични. Няма връзка с OptiMesh API.",
    );
    expect(
      render({ state: { status: "failed", failure: { kind: "error", status: 503, message: "Database unavailable" } } }),
    ).toContain("API няма връзка с базата данни.");
    expect(render({ state: { status: "ready", data: [], updatedAt: 0, failure: null } })).toContain("Няма препоръки в момента.");
  });

  it("shows title, detail, the exact command and the saving per hour, with an enabled Приложи", () => {
    const html = render({});
    const ev = row(html, absorb);
    expect(ev).toContain(absorb.title.replace(/„/g, "„"));
    expect(ev).toContain(absorb.detail);
    expect(ev).toContain("Команда към „EV charger“: <strong>лимит 4,9 kW</strong>");
    expect(ev).toContain(`спестява около <strong>0,39${NBSP}€</strong> на час`);
    expect(buttonOf(ev)).toMatch(/^<button type="button" class="button-primary button-small">Приложи<\/button>$/);
  });

  it("disables Приложи for an offline device and says why", () => {
    const html = render({ live: [reading(EV_CHARGER, false), reading(PLUG)] });
    const ev = row(html, absorb);
    expect(buttonOf(ev)).toContain("disabled");
    expect(ev).toContain("Устройството не е на линия.");
    expect(buttonOf(row(html, runPlug))).not.toContain("disabled");
  });

  it("disables Приложи when the device lacks the capability", () => {
    const setpoint: Recommendation = { ...runPlug, action: { type: "power_setpoint", params: { power_w: 1000 } } };
    const html = render({ state: { status: "ready", data: [setpoint], updatedAt: 0, failure: null } });
    expect(buttonOf(row(html, setpoint))).toContain("disabled");
    expect(html).toContain("Устройството не поддържа тази команда.");
  });

  it("follows the command status after Приложи: pending, sent, applied, rejected, expired, failed", () => {
    const show = (status: Command["status"], reason: string | null = null) =>
      row(
        render({
          commands: { c1: command("c1", EV_CHARGER, status, { reason }) },
          applied: { [absorb.id]: { commandId: "c1" } },
        }),
        absorb,
      );
    expect(show("pending")).toContain('data-status="pending">Изпраща се…');
    expect(buttonOf(show("pending"))).toContain("disabled");
    expect(show("sent")).toContain("Изпратено, чака потвърждение от устройството…");
    expect(buttonOf(show("sent"))).toMatch(/disabled[^>]*>Изчакване…</);
    expect(show("applied")).toContain('data-tone="good"');
    expect(buttonOf(show("applied"))).toMatch(/disabled[^>]*>Приложено</);
    expect(show("rejected", "Charger is locked")).toContain("Отказано от устройството: Charger is locked");
    expect(buttonOf(show("rejected"))).not.toContain("disabled");
    expect(show("expired")).toContain("Устройството не отговори навреме.");
    expect(show("failed")).toContain("Не можа да се изпрати до устройството.");
  });

  it("shows a send error and a submitting row", () => {
    expect(row(render({ applied: { [absorb.id]: { error: "Device is offline" } } }), absorb)).toContain(
      "Не е изпратено: Device is offline",
    );
    expect(buttonOf(row(render({ applied: { [absorb.id]: { submitting: true } } }), absorb))).toMatch(
      /disabled[^>]*>Изпраща се…</,
    );
  });

  it("marks a manual change of the device after the applied recommendation", () => {
    const html = render({
      commands: {
        c1: command("c1", EV_CHARGER, "applied"),
        c2: command("c2", EV_CHARGER, "applied", { created_at: "2026-10-04T10:07:00Z" }),
      },
      applied: { [absorb.id]: { commandId: "c1" } },
    });
    expect(row(html, absorb)).toContain("По-късно устройството е променено ръчно.");
  });

  it("keeps the last list when a refresh fails", () => {
    const html = render({
      state: { status: "ready", data: recommendationsSurplusFixture, updatedAt: Date.parse("2026-10-04T07:05:00Z"), failure: { kind: "offline" } },
    });
    expect(html).toContain("Обновяването не успя: Няма връзка с OptiMesh API. Показани са препоръките от 10:05.");
    expect(html).toContain(absorb.detail);
  });
});
