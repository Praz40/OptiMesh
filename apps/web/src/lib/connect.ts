// What a device needs to report to OptiMesh, built from docs/contracts.md.
import type { DeviceKind } from "./api";
import type { OwnedDevice } from "./registry";

export const TOPIC_PREFIX = "optimesh/v1";

export type DeviceTopics = { telemetry: string; command: string; ack: string };

/** docs/contracts.md section 3: optimesh/v1/sites/{site_id}/devices/{device_id}/{channel}. */
export function deviceTopics(siteId: string, deviceId: string): DeviceTopics {
  const base = `${TOPIC_PREFIX}/sites/${siteId}/devices/${deviceId}`;
  return { telemetry: `${base}/telemetry`, command: `${base}/command`, ack: `${base}/ack` };
}

/** A plausible reading per kind, in W. Positive: importing, producing, charging or consuming (contract signs). */
const EXAMPLE_POWER_W: Record<DeviceKind, number> = {
  grid_meter: 1200,
  solar_inverter: 3500,
  battery: 1500,
  ev_charger: 7400,
  hvac: 1800,
  boiler: 2000,
  smart_plug: 60,
  load: 1200,
};

export type TelemetryExample = {
  version: 1;
  site_id: string;
  device_id: string;
  message_id: string;
  observed_at: string;
  metrics: { power_w?: number; energy_wh?: number; soc_pct?: number };
  state?: { on?: boolean; setpoint_w?: number };
};

/**
 * One telemetry message that the API accepts for this device: the metrics and state its capabilities report,
 * within its limits. The contract needs at least one of power_w, energy_wh or soc_pct, so a device that
 * declares none of them still gets power_w.
 */
export function exampleTelemetry(device: OwnedDevice, messageId: string, observedAt: Date): TelemetryExample {
  const capabilities = new Set(device.capabilities);
  const { min_power_w: min, max_power_w: max } = device.limits;
  const power = Math.max(min ?? 0, Math.min(max ?? Infinity, EXAMPLE_POWER_W[device.kind]));

  const metrics: TelemetryExample["metrics"] = {};
  if (capabilities.has("measure_power") || !(capabilities.has("measure_energy") || capabilities.has("battery_soc"))) {
    metrics.power_w = power;
  }
  if (capabilities.has("measure_energy")) metrics.energy_wh = 1250;
  if (capabilities.has("battery_soc")) metrics.soc_pct = 55;

  const state: NonNullable<TelemetryExample["state"]> = {};
  if (capabilities.has("switch")) state.on = true;
  if (capabilities.has("power_setpoint")) state.setpoint_w = power;

  return {
    version: 1,
    site_id: device.site_id,
    device_id: device.id,
    message_id: messageId,
    observed_at: observedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    metrics,
    ...(Object.keys(state).length > 0 ? { state } : {}),
  };
}

/**
 * A random UUID v4 for message_id, as in the ESP32 snippet of docs/contracts.md. Uses getRandomValues
 * because crypto.randomUUID is missing outside a secure context (e.g. the dashboard opened by LAN IP).
 */
export function uuid4(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const b = random(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The two lines for firmware/esp32-telemetry/include/config.local.h (names from config.example.h). */
export function esp32ConfigLines(siteId: string, deviceId: string): string {
  return `#define SITE_ID "${siteId}"\n#define DEVICE_ID "${deviceId}"`;
}
