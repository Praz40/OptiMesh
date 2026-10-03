import { describe, expect, it } from "vitest";
import { run } from "./engine";
import { autopilotPolicy } from "./policies";
import { OFFICE_SITE_ID, officeScenario } from "./scenario";
import { telemetryFor } from "./telemetry";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("telemetryFor", () => {
  const scenario = officeScenario(7);
  const messages = telemetryFor(scenario, run(scenario, autopilotPolicy));

  it("emits one contract v1 message per device per interval", () => {
    expect(messages).toHaveLength(scenario.steps * scenario.devices.length);
    for (const message of messages) {
      expect(Object.keys(message).every((key) => ["version", "site_id", "device_id", "message_id", "observed_at", "metrics", "state"].includes(key))).toBe(true);
      expect(message.version).toBe(1);
      expect(message.site_id).toBe(OFFICE_SITE_ID);
      expect(message.message_id).toMatch(UUID_V4);
      expect(message.observed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(Object.keys(message.metrics).length).toBeGreaterThan(0);
    }
    expect(new Set(messages.map((m) => m.message_id)).size).toBe(messages.length);
  });

  it("keeps lifetime energy counters monotonic and is reproducible", () => {
    const grid = messages.filter((m) => m.device_id === scenario.devices[0].id).map((m) => m.metrics.energy_wh ?? 0);
    expect(grid.every((value, i) => i === 0 || value >= grid[i - 1])).toBe(true);
    expect(telemetryFor(scenario, run(scenario, autopilotPolicy))).toEqual(messages);
  });
});
