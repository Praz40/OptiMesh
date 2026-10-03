// The owner-scoped /sites API (docs/sites-api.md). Shapes mirror services/api/app/registry_schemas.py.
import { ApiError, apiBaseUrl, type Capability, type DeviceKind } from "./api";

export type DeviceSource = "hardware" | "simulator";

/** Only the configured bounds; `{}` when none are set. */
export type DeviceLimits = { min_power_w?: number; max_power_w?: number; capacity_wh?: number };

export type OwnedSite = {
  id: string;
  owner_id: string;
  name: string;
  timezone: string;
  currency: string;
  created_at: string;
};

export type OwnedDevice = {
  id: string;
  site_id: string;
  name: string;
  kind: DeviceKind;
  source: DeviceSource;
  capabilities: Capability[];
  limits: DeviceLimits;
  created_at: string;
};

export type SiteCreate = { name: string; timezone: string; currency: string };

export type DeviceCreate = {
  name: string;
  kind: DeviceKind;
  source: DeviceSource;
  capabilities: Capability[];
  limits: DeviceLimits;
};

/** API validation messages by field path inside the request body, e.g. "name" or "limits.max_power_w". */
export type FieldErrors = Record<string, string>;

/** A non-2xx answer from /sites; `fields` holds the 422 messages. */
export class RegistryError extends ApiError {
  constructor(
    status: number,
    message: string,
    readonly fields: FieldErrors = {},
  ) {
    super(status, message);
  }
}

/**
 * Maps FastAPI's 422 `detail` (a list of `{loc, msg}`) to field paths. List indexes are dropped, so every
 * capability error lands on "capabilities"; an error on the whole body has the path "".
 */
export function fieldErrors(detail: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!Array.isArray(detail)) return errors;
  for (const item of detail) {
    if (!item || typeof item !== "object") continue;
    const { loc, msg } = item as { loc?: unknown; msg?: unknown };
    if (!Array.isArray(loc) || typeof msg !== "string") continue;
    const path = (loc[0] === "body" ? loc.slice(1) : loc).filter((part) => typeof part === "string").join(".");
    const text = msg.replace(/^Value error, /, "");
    errors[path] = errors[path] ? `${errors[path]} ${text}` : text;
  }
  return errors;
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers },
    });
  } catch (error) {
    // As in lib/api.ts: fetch rejects with a TypeError when the API cannot be reached.
    throw error instanceof TypeError ? new TypeError("няма връзка с API") : error;
  }
  if (!response.ok) {
    let detail: unknown = null;
    try {
      detail = ((await response.json()) as { detail?: unknown }).detail;
    } catch {
      // Keep the generic message.
    }
    throw new RegistryError(
      response.status,
      typeof detail === "string" ? detail : `Заявката не успя (${response.status})`,
      response.status === 422 ? fieldErrors(detail) : {},
    );
  }
  return (await response.json()) as T;
}

export const registry = {
  sites: (token: string, signal?: AbortSignal) => request<OwnedSite[]>("/sites", token, { signal }),
  createSite: (token: string, body: SiteCreate) =>
    request<OwnedSite>("/sites", token, { method: "POST", body: JSON.stringify(body) }),
  devices: (token: string, siteId: string, signal?: AbortSignal) =>
    request<OwnedDevice[]>(`/sites/${siteId}/devices`, token, { signal }),
  createDevice: (token: string, siteId: string, body: DeviceCreate) =>
    request<OwnedDevice>(`/sites/${siteId}/devices`, token, { method: "POST", body: JSON.stringify(body) }),
};

/** One Bulgarian sentence for a failed /sites request, in the words of components/poll-status.tsx. */
export function registryErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return "Няма връзка с OptiMesh API.";
  if (error.status === 401) return "API не прие входа. Излезте и влезте отново.";
  if (error.status === 404) return "Обектът не е намерен или не е ваш.";
  if (error.status === 422) return "Проверете отбелязаните полета.";
  if (error.status === 503 && error.message === "Authentication unavailable") {
    return "API не може да провери входа: в services/api/.env няма SUPABASE_URL или Supabase е недостъпен.";
  }
  if (error.status === 503) return "API няма връзка с базата данни.";
  return `API върна грешка ${error.status}.`;
}

/** The order of the backend enums in app/schemas.py. */
export const DEVICE_KINDS: DeviceKind[] = [
  "grid_meter",
  "solar_inverter",
  "battery",
  "ev_charger",
  "hvac",
  "boiler",
  "smart_plug",
  "load",
];

export const CAPABILITIES: Capability[] = [
  "measure_power",
  "measure_energy",
  "switch",
  "power_setpoint",
  "battery_soc",
  "charging",
];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  measure_power: "Мери мощност",
  measure_energy: "Брояч на енергия",
  switch: "Включване и изключване",
  power_setpoint: "Лимит на мощността",
  battery_soc: "Заряд на батерията",
  charging: "Зарежда автомобил",
};

export const SOURCE_LABELS: Record<DeviceSource, string> = {
  hardware: "Истинско устройство",
  simulator: "Симулатор",
};

/** The capabilities of the demo devices of the same kind in app/seed.py. Battery control is not agreed yet. */
export const DEFAULT_CAPABILITIES: Record<DeviceKind, Capability[]> = {
  grid_meter: ["measure_power", "measure_energy"],
  solar_inverter: ["measure_power", "measure_energy"],
  battery: ["measure_power", "battery_soc"],
  ev_charger: ["measure_power", "switch", "power_setpoint", "charging"],
  hvac: ["measure_power", "switch", "power_setpoint"],
  boiler: ["measure_power", "switch"],
  smart_plug: ["measure_power", "switch"],
  load: ["measure_power", "switch"],
};

/** Only a battery has a storage capacity to configure. */
export const hasCapacity = (kind: DeviceKind) => kind === "battery";

/** What the device form holds; numbers stay text until submit, so an empty field means "not set". */
export type DeviceFormValues = {
  name: string;
  kind: DeviceKind;
  source: DeviceSource;
  capabilities: Capability[];
  minPowerW: string;
  maxPowerW: string;
  capacityWh: string;
};

export function initialDeviceForm(kind: DeviceKind = "smart_plug"): DeviceFormValues {
  return {
    name: "",
    kind,
    source: "hardware",
    capabilities: DEFAULT_CAPABILITIES[kind],
    minPowerW: "",
    maxPowerW: "",
    capacityWh: "",
  };
}

/** A new kind brings its default capabilities; a capacity is kept only for a battery. */
export function withKind(values: DeviceFormValues, kind: DeviceKind): DeviceFormValues {
  return {
    ...values,
    kind,
    capabilities: DEFAULT_CAPABILITIES[kind],
    capacityWh: hasCapacity(kind) ? values.capacityWh : "",
  };
}

function bound(text: string): number | undefined {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) ? value : undefined;
}

/** The POST /sites/{site_id}/devices body. Empty limits are left out; the API checks the rest. */
export function deviceBody(values: DeviceFormValues): DeviceCreate {
  const limits: DeviceLimits = {};
  const min = bound(values.minPowerW);
  const max = bound(values.maxPowerW);
  const capacity = hasCapacity(values.kind) ? bound(values.capacityWh) : undefined;
  if (min !== undefined) limits.min_power_w = min;
  if (max !== undefined) limits.max_power_w = max;
  if (capacity !== undefined) limits.capacity_wh = capacity;
  return {
    name: values.name.trim(),
    kind: values.kind,
    source: values.source,
    capabilities: CAPABILITIES.filter((capability) => values.capabilities.includes(capability)),
    limits,
  };
}
