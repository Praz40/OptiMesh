// Real 422 bodies of the API (services/api, FastAPI + app/registry_schemas.py), captured with TestClient on
// 2026-10-04; `input` and `ctx` trimmed. Used by the tests of the site and device forms.

export const SITE_422 = {
  detail: [
    { type: "string_too_short", loc: ["body", "name"], msg: "String should have at least 1 character" },
    { type: "value_error", loc: ["body", "timezone"], msg: "Value error, Use a valid IANA timezone" },
    { type: "string_pattern_mismatch", loc: ["body", "currency"], msg: "String should match pattern '^[A-Z]{3}$'" },
  ],
};

export const DEVICE_422 = {
  detail: [
    { type: "string_too_short", loc: ["body", "name"], msg: "String should have at least 1 character" },
    {
      type: "enum",
      loc: ["body", "kind"],
      msg: "Input should be 'grid_meter', 'solar_inverter', 'battery', 'ev_charger', 'hvac', 'boiler', 'smart_plug' or 'load'",
    },
    { type: "literal_error", loc: ["body", "source"], msg: "Input should be 'hardware' or 'simulator'" },
    {
      type: "enum",
      loc: ["body", "capabilities", 2],
      msg: "Input should be 'measure_power', 'measure_energy', 'switch', 'power_setpoint', 'battery_soc' or 'charging'",
    },
    { type: "greater_than", loc: ["body", "limits", "max_power_w"], msg: "Input should be greater than 0" },
    { type: "greater_than", loc: ["body", "limits", "capacity_wh"], msg: "Input should be greater than 0" },
  ],
};

/** DeviceCreate's model-level rule: its loc is the whole body. */
export const DEVICE_MIN_ABOVE_MAX_422 = {
  detail: [
    { type: "value_error", loc: ["body"], msg: "Value error, Minimum operating limit must not exceed maximum" },
  ],
};

export const DEVICE_DUPLICATE_CAPABILITIES_422 = {
  detail: [{ type: "value_error", loc: ["body", "capabilities"], msg: "Value error, Capabilities must be unique" }],
};
