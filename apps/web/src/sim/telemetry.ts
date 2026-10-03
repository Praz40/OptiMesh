import type { SimState } from "./engine";
import { seededRandom } from "./random";
import { OFFICE_SITE_ID, type Scenario } from "./scenario";

/** Device contract v1 telemetry (contracts/telemetry-v1.schema.json). */
export type TelemetryMessage = {
  version: 1;
  site_id: string;
  device_id: string;
  message_id: string;
  observed_at: string;
  metrics: { power_w?: number; energy_wh?: number; soc_pct?: number };
  state?: { on?: boolean; setpoint_w?: number };
};

function uuid4(random: () => number): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * The run as the devices would have reported it: one message per device per interval,
 * stamped at the end of the interval, with the platform's sign conventions. Message
 * ids are seeded, so exporting the same run twice gives identical files.
 */
export function telemetryFor(scenario: Scenario, state: SimState): TelemetryMessage[] {
  const random = seededRandom(scenario.seed * 7919);
  const [grid, solar, battery, hvac, ...chargers] = scenario.devices;
  const dtH = scenario.stepMinutes / 60;
  const energy: Record<string, number> = {};
  const messages: TelemetryMessage[] = [];

  const message = (deviceId: string, t: number, metrics: TelemetryMessage["metrics"], deviceState?: TelemetryMessage["state"]) => {
    messages.push({
      version: 1,
      site_id: OFFICE_SITE_ID,
      device_id: deviceId,
      message_id: uuid4(random),
      observed_at: new Date(t).toISOString().replace(".000Z", "Z"),
      metrics,
      ...(deviceState ? { state: deviceState } : {}),
    });
  };
  const counter = (deviceId: string, watts: number) => {
    energy[deviceId] = (energy[deviceId] ?? 0) + Math.max(watts, 0) * dtH;
    return round(energy[deviceId], 2);
  };

  for (const record of state.records) {
    const t = record.t + scenario.stepMinutes * 60_000;
    message(grid.id, t, { power_w: round(record.gridW), energy_wh: counter(grid.id, record.gridW) });
    message(solar.id, t, { power_w: round(record.solarW), energy_wh: counter(solar.id, record.solarW) });
    message(battery.id, t, {
      power_w: round(record.batteryW),
      soc_pct: round((record.socWh / scenario.site.battery.capacityWh) * 100, 2),
    });
    message(hvac.id, t, { power_w: round(record.hvacW) }, { on: record.hvacSetpointC !== null });
    scenario.chargers.forEach((charger, index) => {
      const power = record.chargerW[charger.id] ?? 0;
      message(chargers[index].id, t, { power_w: round(power) }, { on: power > 0 });
    });
  }
  return messages;
}

export function toJsonLines(messages: TelemetryMessage[]): string {
  return messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
}
