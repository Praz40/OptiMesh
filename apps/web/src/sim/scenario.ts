import type { Device } from "@/lib/api";
import { seededRandom } from "./random";

/**
 * A reproducible day at a site. Everything that varies (weather, base load
 * noise) is derived from `seed`, so a manual run, the baseline and Autopilot
 * replay exactly the same conditions.
 *
 * Units follow the device contract: power in W, energy in Wh, time in UTC ms.
 */
export type EvSpec = {
  id: string;
  driver: string;
  model: string;
  /** UTC ms. */
  arrival: number;
  /** UTC ms. The deadline: the car leaves with whatever it has by then. */
  departure: number;
  /** Energy the driver asked for, Wh. */
  needWh: number;
  /** Onboard charger limit, W. */
  maxW: number;
};

export type Scenario = {
  id: string;
  name: string;
  description: string;
  seed: number;
  timezone: string;
  currency: string;
  /** UTC ms of the first interval. */
  start: number;
  stepMinutes: number;
  steps: number;
  /** Registry entries, identical to the seeded Office devices (same ids, kinds and limits). */
  devices: Device[];
  site: {
    solarPeakW: number;
    battery: { capacityWh: number; maxW: number; minSoc: number; maxSoc: number; efficiency: number; initialSoc: number };
    hvac: { minW: number; maxW: number; comfortMinC: number; comfortMaxC: number; initialIndoorC: number };
    /** Grid connection limits, W. Import above the limit is an overload; export above it is curtailed. */
    importLimitW: number;
    exportLimitW: number;
  };
  chargers: { id: string; name: string; minW: number; maxW: number }[];
  evs: EvSpec[];
  /** Per-interval inputs. Actual values include seeded noise; forecasts do not. */
  series: {
    solarW: number[];
    solarForecastW: number[];
    baseLoadW: number[];
    outdoorC: number[];
    occupied: boolean[];
    importPrice: number[];
    exportPrice: number[];
  };
};

// Fixed ids: the seeded Office site (services/api/app/seed.py).
export const OFFICE_SITE_ID = "5e000000-0000-4000-8000-000000000003";
const OFFICE = {
  grid: "de000000-0000-4000-8000-000000003001",
  solar: "de000000-0000-4000-8000-000000003002",
  battery: "de000000-0000-4000-8000-000000003003",
  hvac: "de000000-0000-4000-8000-000000003004",
  chargers: [
    "de000000-0000-4000-8000-000000003011",
    "de000000-0000-4000-8000-000000003012",
    "de000000-0000-4000-8000-000000003013",
  ],
};

function device(
  id: string,
  name: string,
  kind: Device["kind"],
  capabilities: Device["capabilities"],
  limits: Partial<Device["limits"]> = {},
): Device {
  return {
    id,
    site_id: OFFICE_SITE_ID,
    name,
    kind,
    source: "simulator",
    capabilities,
    limits: { min_power_w: null, max_power_w: null, capacity_wh: null, ...limits },
  };
}

/** Clear-sky shape, the same curve the live simulator uses, shifted to local solar time. */
export function sunFactor(localHour: number, sunrise = 6, sunset = 21): number {
  if (localHour <= sunrise || localHour >= sunset) return 0;
  const angle = ((localHour - sunrise) / (sunset - sunrise)) * Math.PI;
  return Math.sin(angle) ** 1.3;
}

/** Local hour in the scenario timezone, e.g. 13.25 for 13:15. */
export function localHour(t: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") + get("minute") / 60;
}

/** Day-ahead style tariff, EUR/kWh: cheap at night and in the solar glut, expensive in the evening. */
export function importPriceAt(hour: number): number {
  if (hour < 7) return 0.11;
  if (hour < 11) return 0.19;
  if (hour < 15) return 0.13;
  if (hour < 17) return 0.21;
  if (hour < 21) return 0.32;
  return 0.14;
}

export const EXPORT_PRICE = 0.06;

type EvTemplate = [driver: string, model: string, arrive: string, leave: string, needKwh: number, maxKw: number];

/**
 * The office fleet: 10 cars, 3 chargers. Long-stay cars arrive first, so plugging
 * in order of arrival blocks the chargers while short-stay cars run out of time.
 * A schedule that meets every deadline exists (see the tests).
 */
const FLEET: EvTemplate[] = [
  ["Boris", "VW ID.4", "07:30", "17:30", 30, 11],
  ["Georgi", "Kia EV6", "07:45", "18:00", 28, 11],
  ["Nikolay", "BMW i4", "08:00", "18:30", 25, 11],
  ["Ana", "Tesla Model 3", "08:15", "11:30", 18, 11],
  ["Elena", "Renault Zoe", "08:30", "12:00", 12, 7.4],
  ["Ivan", "Nissan Leaf", "08:45", "13:30", 14, 7.4],
  ["Maria", "Hyundai Kona", "09:00", "16:30", 20, 11],
  ["Petya", "Fiat 500e", "10:00", "13:00", 10, 7.4],
  ["Stefan", "Skoda Enyaq", "11:00", "19:00", 32, 11],
  ["Vesela", "Peugeot e-208", "13:00", "16:00", 15, 7.4],
];

// 2026-06-17 is a Wednesday; Sofia is UTC+3 in summer, so 06:00 local = 03:00Z.
const DAY_START_UTC = Date.UTC(2026, 5, 17, 3, 0);
const LOCAL_OFFSET_H = 3;

function localTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 5, 17, h - LOCAL_OFFSET_H, m);
}

export function officeScenario(seed = 7): Scenario {
  const timezone = "Europe/Sofia";
  const stepMinutes = 15;
  const steps = 60; // 06:00 -> 21:00 local
  const random = seededRandom(seed);

  const solarPeakW = 30_000;
  const series: Scenario["series"] = {
    solarW: [],
    solarForecastW: [],
    baseLoadW: [],
    outdoorC: [],
    occupied: [],
    importPrice: [],
    exportPrice: [],
  };

  // Clouds: a slow random walk plus one passing front whose timing depends on the seed.
  let clouds = 1;
  const frontStart = 12.5 + random() * 2.5;
  for (let i = 0; i < steps; i++) {
    const t = DAY_START_UTC + i * stepMinutes * 60_000;
    const hour = localHour(t, timezone) + stepMinutes / 120; // interval midpoint
    clouds = Math.min(1, Math.max(0.7, clouds + (random() - 0.5) * 0.12));
    const front = hour >= frontStart && hour < frontStart + 1.25 ? 0.35 + random() * 0.15 : 1;
    const clear = solarPeakW * sunFactor(hour);
    series.solarForecastW.push(Math.round(clear * 0.92));
    series.solarW.push(Math.round(clear * clouds * front));

    const occupied = hour >= 8 && hour < 18;
    series.occupied.push(occupied);
    const base = occupied ? 5200 : hour >= 7 && hour < 19 ? 2600 : 1500;
    series.baseLoadW.push(Math.round(base * (0.92 + random() * 0.16)));
    // Hot June day: 19 C at dawn, 32 C mid-afternoon.
    series.outdoorC.push(Math.round((25.5 + 6.5 * Math.sin(((hour - 9.5) / 12) * Math.PI)) * 10) / 10);
    series.importPrice.push(importPriceAt(hour));
    series.exportPrice.push(EXPORT_PRICE);
  }

  const chargers = OFFICE.chargers.map((id, i) => ({ id, name: `Charger ${i + 1}`, minW: 1400, maxW: 11_000 }));

  return {
    id: `office-${seed}`,
    name: "Office, hot summer weekday",
    description: "30 kW carport solar, a 50 kWh battery, office HVAC, and 10 electric cars sharing 3 chargers.",
    seed,
    timezone,
    currency: "EUR",
    start: DAY_START_UTC,
    stepMinutes,
    steps,
    devices: [
      device(OFFICE.grid, "Grid meter", "grid_meter", ["measure_power", "measure_energy"]),
      device(OFFICE.solar, "Carport solar", "solar_inverter", ["measure_power", "measure_energy"], { max_power_w: solarPeakW }),
      device(OFFICE.battery, "Office battery", "battery", ["measure_power", "battery_soc"], {
        max_power_w: 25_000,
        capacity_wh: 50_000,
      }),
      device(OFFICE.hvac, "HVAC", "hvac", ["measure_power", "switch", "power_setpoint"], {
        min_power_w: 2000,
        max_power_w: 15_000,
      }),
      ...chargers.map((charger) =>
        device(charger.id, `EV charger ${charger.name.slice(-1)}`, "ev_charger", ["measure_power", "charging", "switch", "power_setpoint"], {
          min_power_w: charger.minW,
          max_power_w: charger.maxW,
        }),
      ),
    ],
    site: {
      solarPeakW,
      battery: { capacityWh: 50_000, maxW: 25_000, minSoc: 0.1, maxSoc: 0.95, efficiency: 0.95, initialSoc: 0.4 },
      hvac: { minW: 2000, maxW: 15_000, comfortMinC: 21, comfortMaxC: 25, initialIndoorC: 23.5 },
      importLimitW: 50_000,
      exportLimitW: 25_000,
    },
    chargers,
    evs: FLEET.map(([driver, model, arrive, leave, needKwh, maxKw], i) => ({
      id: `ev-${i + 1}`,
      driver,
      model,
      arrival: localTime(arrive),
      departure: localTime(leave),
      needWh: needKwh * 1000,
      maxW: maxKw * 1000,
    })),
    series,
  };
}
