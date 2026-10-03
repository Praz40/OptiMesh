// The seeded Home site's controllable devices (services/api/app/seed.py) and live readings,
// to pair with the recommendation fixtures in insights.fixtures.ts.

import type { Command, Device, DeviceLive } from "./api";

const SITE = "5e000000-0000-4000-8000-000000000001";
export const EV_CHARGER = "de000000-0000-4000-8000-000000001004";
export const BOILER = "de000000-0000-4000-8000-000000001005";
export const PLUG = "de000000-0000-4000-8000-000000001006";

const limits = (max: number, min: number | null = null) => ({ min_power_w: min, max_power_w: max, capacity_wh: null });

export const homeDevices: Device[] = [
  {
    id: EV_CHARGER,
    site_id: SITE,
    name: "EV charger",
    kind: "ev_charger",
    source: "simulator",
    capabilities: ["measure_power", "charging", "switch", "power_setpoint"],
    limits: limits(11000, 1400),
  },
  {
    id: BOILER,
    site_id: SITE,
    name: "Water boiler",
    kind: "boiler",
    source: "simulator",
    capabilities: ["measure_power", "switch"],
    limits: limits(2000),
  },
  {
    id: PLUG,
    site_id: SITE,
    name: "Washing machine plug",
    kind: "smart_plug",
    source: "simulator",
    capabilities: ["measure_power", "switch"],
    limits: limits(2300),
  },
];

export function reading(deviceId: string, online = true, on: boolean | null = null, setpoint: number | null = null): DeviceLive {
  return {
    device_id: deviceId,
    online,
    observed_at: "2026-10-04T10:05:00Z",
    received_at: "2026-10-04T10:05:00Z",
    metrics: { power_w: 1500, energy_wh: null, soc_pct: null, voltage_v: null, current_a: null },
    state: on === null && setpoint === null ? null : { on, setpoint_w: setpoint },
  };
}

export const homeLive: DeviceLive[] = [reading(EV_CHARGER, true, true, 1500), reading(BOILER, true, false), reading(PLUG, true, false)];

export function command(id: string, deviceId: string, status: Command["status"], extra: Partial<Command> = {}): Command {
  return {
    id,
    site_id: SITE,
    device_id: deviceId,
    type: "power_setpoint",
    params: { power_w: 4900 },
    status,
    reason: null,
    created_at: "2026-10-04T10:05:10Z",
    expires_at: "2026-10-04T10:05:25Z",
    acknowledged_at: null,
    ...extra,
  };
}
