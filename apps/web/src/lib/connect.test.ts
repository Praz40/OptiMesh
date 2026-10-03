import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deviceTopics, esp32ConfigLines, exampleTelemetry, uuid4 } from "./connect";
import { DEFAULT_CAPABILITIES, DEVICE_KINDS, type OwnedDevice } from "./registry";

const repoFile = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

type Schema = {
  type?: string;
  const?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  anyOf?: Schema[];
  $ref?: string;
};

const TELEMETRY_SCHEMA = JSON.parse(repoFile("contracts/telemetry-v1.schema.json")) as Schema & {
  $defs: Record<string, Schema>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The parts of JSON Schema that contracts/telemetry-v1.schema.json uses; returns the problems found. */
function validate(value: unknown, schema: Schema, path = "$"): string[] {
  if (schema.$ref) return validate(value, TELEMETRY_SCHEMA.$defs[schema.$ref.split("/").pop() ?? ""], path);
  if (schema.anyOf) {
    return schema.anyOf.some((option) => validate(value, option, path).length === 0) ? [] : [`${path}: matches no option`];
  }
  const problems: string[] = [];
  if (schema.const !== undefined && value !== schema.const) problems.push(`${path}: not ${String(schema.const)}`);
  if (schema.type === "null" && value !== null) problems.push(`${path}: not null`);
  if (schema.type === "boolean" && typeof value !== "boolean") problems.push(`${path}: not a boolean`);
  if (schema.type === "integer" && !Number.isInteger(value)) problems.push(`${path}: not an integer`);
  if (schema.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) problems.push(`${path}: not a number`);
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) problems.push(`${path}: below minimum`);
  if (typeof value === "number" && schema.maximum !== undefined && value > schema.maximum) problems.push(`${path}: above maximum`);
  if (schema.type === "string" && typeof value !== "string") problems.push(`${path}: not a string`);
  if (schema.format === "uuid" && !UUID.test(String(value))) problems.push(`${path}: not a UUID`);
  if (schema.format === "date-time" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(String(value))) {
    problems.push(`${path}: not a date-time`);
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object") return [...problems, `${path}: not an object`];
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in record)) problems.push(`${path}.${key}: missing`);
    for (const [key, item] of Object.entries(record)) {
      const property = schema.properties?.[key];
      if (property) problems.push(...validate(item, property, `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}.${key}: not in the contract`);
    }
  }
  return problems;
}

const SITE = "5e000000-0000-4000-8000-000000000009";
const DEVICE = "de000000-0000-4000-8000-000000009001";
const MESSAGE = "6f1c2a8e-3b7d-4c51-9a0e-2d4b8f7e1c33";
const AT = new Date("2026-10-04T08:15:30.250Z");

function device(overrides: Partial<OwnedDevice> = {}): OwnedDevice {
  return {
    id: DEVICE,
    site_id: SITE,
    name: "Пералня",
    kind: "smart_plug",
    source: "simulator",
    capabilities: ["measure_power", "switch"],
    limits: {},
    created_at: "2026-10-04T08:00:00Z",
    ...overrides,
  };
}

describe("deviceTopics", () => {
  it("builds the three topics of docs/contracts.md section 3", () => {
    expect(deviceTopics(SITE, DEVICE)).toEqual({
      telemetry: `optimesh/v1/sites/${SITE}/devices/${DEVICE}/telemetry`,
      command: `optimesh/v1/sites/${SITE}/devices/${DEVICE}/command`,
      ack: `optimesh/v1/sites/${SITE}/devices/${DEVICE}/ack`,
    });
    for (const topic of ["telemetry", "command", "ack"]) {
      expect(repoFile("docs/contracts.md")).toContain(`optimesh/v1/sites/{site_id}/devices/{device_id}/${topic}`);
    }
  });
});

describe("exampleTelemetry", () => {
  it("validates against contracts/telemetry-v1.schema.json for every kind with its default capabilities", () => {
    for (const kind of DEVICE_KINDS) {
      const message = exampleTelemetry(device({ kind, capabilities: DEFAULT_CAPABILITIES[kind] }), MESSAGE, AT);
      expect(validate(message, TELEMETRY_SCHEMA), kind).toEqual([]);
      // The API also needs one of power_w, energy_wh or soc_pct (app/schemas.py Metrics).
      expect(Object.keys(message.metrics).length, kind).toBeGreaterThan(0);
    }
  });

  it("reports what the capabilities say, with the device's IDs and a UTC time without milliseconds", () => {
    expect(exampleTelemetry(device(), MESSAGE, AT)).toEqual({
      version: 1,
      site_id: SITE,
      device_id: DEVICE,
      message_id: MESSAGE,
      observed_at: "2026-10-04T08:15:30Z",
      metrics: { power_w: 60 },
      state: { on: true },
    });
    const battery = exampleTelemetry(device({ kind: "battery", capabilities: ["measure_power", "battery_soc"] }), MESSAGE, AT);
    expect(battery.metrics).toEqual({ power_w: 1500, soc_pct: 55 });
    expect(battery).not.toHaveProperty("state");
  });

  it("stays within the configured limits", () => {
    const charger = device({ kind: "ev_charger", capabilities: DEFAULT_CAPABILITIES.ev_charger, limits: { min_power_w: 1400, max_power_w: 3700 } });
    const message = exampleTelemetry(charger, MESSAGE, AT);
    expect(message.metrics.power_w).toBe(3700);
    expect(message.state).toEqual({ on: true, setpoint_w: 3700 });
    expect(exampleTelemetry(device({ limits: { min_power_w: 100 } }), MESSAGE, AT).metrics.power_w).toBe(100);
  });

  it("still sends power_w for a device that declares no measurement, because the contract needs one", () => {
    const message = exampleTelemetry(device({ capabilities: ["switch"] }), MESSAGE, AT);
    expect(message.metrics).toEqual({ power_w: 60 });
    expect(validate(message, TELEMETRY_SCHEMA)).toEqual([]);
  });

  it("is caught by the validator when a field is not in the contract", () => {
    const message = { ...exampleTelemetry(device(), MESSAGE, AT), metrics: { power_w: 1, watts: 2 } };
    expect(validate(message, TELEMETRY_SCHEMA)).toEqual(["$.metrics.watts: not in the contract"]);
  });
});

describe("esp32ConfigLines", () => {
  it("uses the names of firmware/esp32-telemetry/include/config.example.h", () => {
    const example = repoFile("firmware/esp32-telemetry/include/config.example.h");
    expect(example).toMatch(/^#define SITE_ID "/m);
    expect(example).toMatch(/^#define DEVICE_ID "/m);
    expect(esp32ConfigLines(SITE, DEVICE)).toBe(`#define SITE_ID "${SITE}"\n#define DEVICE_ID "${DEVICE}"`);
  });
});

describe("uuid4", () => {
  it("makes a version 4, variant 1 UUID", () => {
    expect(uuid4(() => new Uint8Array(16).fill(0xff))).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(uuid4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid4()).not.toBe(uuid4());
  });
});
