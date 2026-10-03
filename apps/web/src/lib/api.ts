// Types mirror services/api/app/schemas.py. Keep them in sync when the contract changes.

export type DeviceKind =
  | "grid_meter"
  | "solar_inverter"
  | "battery"
  | "ev_charger"
  | "hvac"
  | "boiler"
  | "smart_plug"
  | "load";

export type Capability =
  | "measure_power"
  | "measure_energy"
  | "switch"
  | "power_setpoint"
  | "battery_soc"
  | "charging";

export type Device = {
  id: string;
  site_id: string;
  name: string;
  kind: DeviceKind;
  source: "hardware" | "simulator";
  capabilities: Capability[];
  limits: { min_power_w: number | null; max_power_w: number | null; capacity_wh: number | null };
};

export type Metrics = {
  power_w: number | null;
  energy_wh: number | null;
  soc_pct: number | null;
  voltage_v: number | null;
  current_a: number | null;
};

export type DeviceLive = {
  device_id: string;
  online: boolean;
  observed_at: string | null;
  received_at: string | null;
  metrics: Metrics | null;
  state: { on: boolean | null; setpoint_w: number | null } | null;
};

/** One stored telemetry reading, from the measurement history endpoint. */
export type Measurement = {
  observed_at: string;
  power_w: number | null;
  energy_wh: number | null;
  soc_pct: number | null;
  voltage_v: number | null;
  current_a: number | null;
  state: { on?: boolean; setpoint_w?: number } | null;
};

export type SiteSummary = {
  solar_w: number | null;
  grid_w: number | null;
  battery_w: number | null;
  battery_soc_pct: number | null;
  ev_w: number | null;
  loads_w: number | null;
  consumption_w: number | null;
  unmeasured_w: number | null;
  devices_online: number;
  devices_total: number;
  updated_at: string | null;
};

export type Site = {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  summary: SiteSummary;
};

export type SiteSnapshot = { site: Site; devices: Device[]; live: DeviceLive[] };

export type CommandStatus = "pending" | "sent" | "applied" | "rejected" | "expired" | "failed";

export type Command = {
  id: string;
  site_id: string;
  device_id: string;
  type: "switch" | "power_setpoint";
  params: Record<string, unknown>;
  status: CommandStatus;
  reason: string | null;
  created_at: string;
  expires_at: string;
  acknowledged_at: string | null;
};

export type CommandRequest =
  | { type: "switch"; params: { on: boolean } }
  | { type: "power_setpoint"; params: { power_w: number } };

export type LiveEvent =
  | { type: "snapshot"; data: SiteSnapshot }
  | { type: "command"; data: Command };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Browser-facing API URL. Defaults to port 8000 on the host serving the page (works on a LAN). */
export function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window === "undefined") return "http://127.0.0.1:8000";
  return `${window.location.protocol}//${window.location.hostname}:8000`;
}

export function liveUrl(siteId: string, base = apiBaseUrl()): string {
  const url = new URL(`/api/v1/sites/${siteId}/live`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Keep the generic message.
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export const api = {
  sites: (signal?: AbortSignal) => request<Site[]>("/api/v1/sites", { signal }),
  measurements: (siteId: string, deviceId: string, limit: number, signal?: AbortSignal) =>
    request<Measurement[]>(`/api/v1/sites/${siteId}/devices/${deviceId}/measurements?limit=${limit}`, {
      signal,
    }),
  commands: (siteId: string, signal?: AbortSignal) =>
    request<Command[]>(`/api/v1/sites/${siteId}/commands?limit=50`, { signal }),
  sendCommand: (siteId: string, deviceId: string, body: CommandRequest) =>
    request<Command>(`/api/v1/sites/${siteId}/devices/${deviceId}/commands`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
