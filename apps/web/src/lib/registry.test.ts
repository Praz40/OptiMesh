import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Capability } from "./api";
import { KIND_LABELS } from "./energy";
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  DEFAULT_CAPABILITIES,
  DEVICE_KINDS,
  RegistryError,
  deviceBody,
  fieldErrors,
  initialDeviceForm,
  registry,
  registryErrorText,
  withKind,
} from "./registry";
import { DEVICE_422, DEVICE_DUPLICATE_CAPABILITIES_422, DEVICE_MIN_ABOVE_MAX_422, SITE_422 } from "./registry.fixtures";

/** The values of a StrEnum class in services/api/app/schemas.py, in order. */
function backendEnum(name: string): string[] {
  const source = readFileSync(new URL("../../../../services/api/app/schemas.py", import.meta.url), "utf8");
  const body = source.split(`class ${name}(StrEnum):`)[1]?.split(/\n\n\n|\nclass /)[0] ?? "";
  return [...body.matchAll(/^\s+[A-Z_]+ = "([a-z_]+)"$/gm)].map((match) => match[1]);
}

describe("device options", () => {
  it("offers exactly the backend's DeviceKind and Capability values, each with a Bulgarian label", () => {
    expect(DEVICE_KINDS).toEqual(backendEnum("DeviceKind"));
    expect(CAPABILITIES).toEqual(backendEnum("Capability"));
    for (const kind of DEVICE_KINDS) expect(KIND_LABELS[kind]).toMatch(/^[А-Я][а-я ]+$/);
    for (const capability of CAPABILITIES) expect(CAPABILITY_LABELS[capability]).toMatch(/^[А-Я][а-я ]+$/);
  });

  it("defaults every kind to capabilities like its demo device; batteries stay measure-only", () => {
    for (const kind of DEVICE_KINDS) {
      expect(DEFAULT_CAPABILITIES[kind].length).toBeGreaterThan(0);
      expect(DEFAULT_CAPABILITIES[kind].every((capability) => CAPABILITIES.includes(capability))).toBe(true);
    }
    expect(DEFAULT_CAPABILITIES.smart_plug).toEqual(["measure_power", "switch"]);
    expect(DEFAULT_CAPABILITIES.battery).toEqual(["measure_power", "battery_soc"]);
    expect(DEFAULT_CAPABILITIES.ev_charger).toContain("power_setpoint");
  });
});

describe("deviceBody", () => {
  it("trims the name, keeps the contract's capability order and leaves empty limits out", () => {
    const values = { ...initialDeviceForm("smart_plug"), name: "  Пералня ", capabilities: ["switch", "measure_power"] as Capability[] };
    expect(deviceBody(values)).toEqual({
      name: "Пералня",
      kind: "smart_plug",
      source: "hardware",
      capabilities: ["measure_power", "switch"],
      limits: {},
    });
  });

  it("sends the limits in W and Wh as numbers, accepts a decimal comma, and a capacity only for a battery", () => {
    const battery = { ...initialDeviceForm("battery"), name: "Батерия", minPowerW: "100", maxPowerW: "2000,5", capacityWh: "10000" };
    expect(deviceBody(battery).limits).toEqual({ min_power_w: 100, max_power_w: 2000.5, capacity_wh: 10000 });
    expect(deviceBody({ ...battery, kind: "boiler" }).limits).toEqual({ min_power_w: 100, max_power_w: 2000.5 });
  });

  it("passes a 0 through, so the API can answer that a maximum must be above 0", () => {
    expect(deviceBody({ ...initialDeviceForm(), name: "x", maxPowerW: "0" }).limits).toEqual({ max_power_w: 0 });
  });

  it("resets the capabilities to the new kind's defaults and drops a capacity when the kind changes", () => {
    const battery = { ...initialDeviceForm("battery"), capacityWh: "5000" };
    expect(withKind(battery, "ev_charger")).toMatchObject({ kind: "ev_charger", capabilities: DEFAULT_CAPABILITIES.ev_charger, capacityWh: "" });
    expect(withKind(battery, "battery").capacityWh).toBe("5000");
  });
});

describe("fieldErrors", () => {
  it("places the API's 422 messages by field, without pydantic's 'Value error, ' prefix", () => {
    expect(fieldErrors(SITE_422.detail)).toEqual({
      name: "String should have at least 1 character",
      timezone: "Use a valid IANA timezone",
      currency: "String should match pattern '^[A-Z]{3}$'",
    });
    const device = fieldErrors(DEVICE_422.detail);
    expect(Object.keys(device)).toEqual(["name", "kind", "source", "capabilities", "limits.max_power_w", "limits.capacity_wh"]);
    expect(fieldErrors(DEVICE_DUPLICATE_CAPABILITIES_422.detail)).toEqual({ capabilities: "Capabilities must be unique" });
  });

  it("keys a rule on the whole body as ''", () => {
    expect(fieldErrors(DEVICE_MIN_ABOVE_MAX_422.detail)).toEqual({ "": "Minimum operating limit must not exceed maximum" });
  });

  it("ignores anything that is not a 422 list", () => {
    expect(fieldErrors("Site not found")).toEqual({});
    expect(fieldErrors([{ loc: "body" }, null])).toEqual({});
  });
});

describe("registry requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  function answer(status: number, body: unknown) {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("sends the bearer token and the JSON body to the /sites routes", async () => {
    const fetch = answer(201, { id: "s1" });
    await registry.createSite("token-1", { name: "Офис", timezone: "Europe/Sofia", currency: "EUR" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/sites");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer token-1", "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Офис", timezone: "Europe/Sofia", currency: "EUR" });

    const list = answer(200, []);
    await registry.devices("token-2", "site-1");
    expect(list.mock.calls[0][0]).toBe("http://127.0.0.1:8000/sites/site-1/devices");
    expect(list.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer token-2" });
  });

  it("turns a 422 into a RegistryError with the field messages", async () => {
    answer(422, DEVICE_MIN_ABOVE_MAX_422);
    const error = await registry.createDevice("t", "s", deviceBody(initialDeviceForm())).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RegistryError);
    expect((error as RegistryError).status).toBe(422);
    expect((error as RegistryError).fields).toEqual({ "": "Minimum operating limit must not exceed maximum" });
  });

  it("keeps the API's detail string for other errors and reports an unreachable API as offline", async () => {
    answer(503, { detail: "Authentication unavailable" });
    const error = await registry.sites("t").catch((reason: unknown) => reason);
    expect(error).toMatchObject({ status: 503, message: "Authentication unavailable", fields: {} });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(registryErrorText(await registry.sites("t").catch((reason: unknown) => reason))).toBe("Няма връзка с OptiMesh API.");
  });
});

describe("registryErrorText", () => {
  it("says in Bulgarian what went wrong", () => {
    expect(registryErrorText(new TypeError("няма връзка с API"))).toBe("Няма връзка с OptiMesh API.");
    expect(registryErrorText(new ApiError(401, "Invalid or missing authentication"))).toBe("API не прие входа. Излезте и влезте отново.");
    expect(registryErrorText(new ApiError(404, "Site not found"))).toBe("Обектът не е намерен или не е ваш.");
    expect(registryErrorText(new RegistryError(422, "x", { name: "y" }))).toBe("Проверете отбелязаните полета.");
    expect(registryErrorText(new ApiError(503, "Authentication unavailable"))).toContain("SUPABASE_URL");
    expect(registryErrorText(new ApiError(503, "Database unavailable"))).toBe("API няма връзка с базата данни.");
    expect(registryErrorText(new ApiError(500, "boom"))).toBe("API върна грешка 500.");
  });
});
