import { describe, expect, it, vi } from "vitest";
import type { Command, CommandStatus, Recommendation } from "./api";
import { BOILER, command, EV_CHARGER, homeDevices, PLUG, reading } from "./assist.fixtures";
import { applyBlocker, applyRecommendation, describeAction, manualOverride, statusView } from "./assist";
import { recommendationsPeakFixture, recommendationsSurplusFixture } from "./insights.fixtures";

const [absorb, runPlug] = recommendationsSurplusFixture;
const [deferEv, pauseBoiler] = recommendationsPeakFixture;
const device = (id: string) => homeDevices.find((d) => d.id === id);

describe("describeAction", () => {
  it("says what will be sent", () => {
    expect(describeAction(absorb.action)).toBe("лимит 4,9 kW");
    expect(describeAction(runPlug.action)).toBe("включване");
    expect(describeAction(pauseBoiler.action)).toBe("изключване");
    expect(describeAction({ type: "power_setpoint", params: { power_w: 0 } })).toBe("спиране");
  });
});

describe("applyBlocker", () => {
  it("allows an online device with the needed capability", () => {
    expect(applyBlocker(absorb, device(EV_CHARGER), reading(EV_CHARGER))).toBeNull();
    expect(applyBlocker(runPlug, device(PLUG), reading(PLUG))).toBeNull();
  });

  it("blocks an offline device", () => {
    expect(applyBlocker(deferEv, device(EV_CHARGER), reading(EV_CHARGER, false))).toBe("Устройството не е на линия.");
    expect(applyBlocker(deferEv, device(EV_CHARGER), undefined)).toBe("Устройството не е на линия.");
  });

  it("blocks a device without the capability the command needs", () => {
    const setpointForBoiler: Recommendation = { ...pauseBoiler, action: { type: "power_setpoint", params: { power_w: 1000 } } };
    expect(applyBlocker(setpointForBoiler, device(BOILER), reading(BOILER))).toBe("Устройството не поддържа тази команда.");
  });

  it("blocks a device that is no longer on the site", () => {
    expect(applyBlocker(absorb, undefined, undefined)).toBe("Устройството вече не е в обекта.");
  });
});

describe("statusView", () => {
  const cases: [CommandStatus, "busy" | "good" | "bad", boolean, string][] = [
    ["pending", "busy", false, "Изпраща се…"],
    ["sent", "busy", false, "Изпратено, чака потвърждение от устройството…"],
    ["applied", "good", true, "Приложено: устройството потвърди."],
    ["rejected", "bad", true, "Отказано от устройството."],
    ["expired", "bad", true, "Устройството не отговори навреме."],
    ["failed", "bad", true, "Не можа да се изпрати до устройството."],
  ];

  it.each(cases)("%s -> %s", (status, tone, final, text) => {
    expect(statusView(command("c1", EV_CHARGER, status))).toEqual({ tone, final, text });
  });

  it("adds the device's reason to a rejection", () => {
    expect(statusView(command("c1", BOILER, "rejected", { reason: "locked" }))?.text).toBe("Отказано от устройството: locked");
  });

  it("shows a send error, and nothing before Приложи", () => {
    expect(statusView(undefined, "Device is offline")).toEqual({ tone: "bad", final: true, text: "Не е изпратено: Device is offline" });
    expect(statusView(undefined)).toBeNull();
  });
});

describe("manualOverride", () => {
  const applied = command("c1", EV_CHARGER, "applied");
  const later = command("c2", EV_CHARGER, "applied", { created_at: "2026-10-04T10:06:00Z" });

  it("finds a later command on the device that Приложи did not send", () => {
    expect(manualOverride(applied, later, new Set(["c1"]))).toBe(later);
  });

  it("ignores the applied command itself, earlier commands and other recommendations", () => {
    expect(manualOverride(applied, applied, new Set(["c1"]))).toBeNull();
    expect(manualOverride(later, applied, new Set(["c2"]))).toBeNull();
    expect(manualOverride(applied, later, new Set(["c1", "c2"]))).toBeNull();
    expect(manualOverride(undefined, later, new Set())).toBeNull();
  });
});

describe("applyRecommendation", () => {
  it("sends exactly the recommended action to the recommended device, once", async () => {
    const send = vi.fn(async () => command("c1", EV_CHARGER, "sent"));
    await applyRecommendation(absorb, send);
    expect(send).toHaveBeenCalledExactlyOnceWith(EV_CHARGER, { type: "power_setpoint", params: { power_w: 4900 } });
    const result: Command = await applyRecommendation(runPlug, send);
    expect(send).toHaveBeenLastCalledWith(PLUG, { type: "switch", params: { on: true } });
    expect(result.id).toBe("c1");
  });
});
