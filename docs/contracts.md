# Device contract v1 (MQTT)

This is everything a device — ESP32, gateway, third-party adapter or the simulator — needs to talk to OptiMesh. You do not need to read backend or frontend code. JSON Schemas live in [`contracts/`](../contracts) and are generated from the backend models, so they cannot drift.

The simulator (`services/api/app/simulator.py`) implements exactly this contract and is a working reference.

## 1. Connection

| Setting | Value |
|---|---|
| Broker | Mosquitto, `<laptop-ip>:1883` (plain MQTT for the local demo) |
| Auth | none locally; username/password once we leave the LAN (open question 1) |
| Client ID | `optimesh-<device_id>` (must be unique per device) |
| Keep-alive | 15 s |
| Topic prefix | `optimesh/v1` (the `v1` changes only on a breaking change) |

## 2. Identity

Each device has a fixed **site UUID** and **device UUID**, created by the seed script (`python -m app.seed`). Flash them into the firmware.

The physical demo device:

| | UUID |
|---|---|
| Site "Workshop" | `5e000000-0000-4000-8000-000000000002` |
| Device "ESP32 demo load" | `de000000-0000-4000-8000-000000002003` |

It is registered as kind `load` with capabilities `measure_power`, `measure_energy`, `switch`. A new device must be registered in `app/seed.py` first; the backend rejects telemetry from unknown devices.

## 3. Topics

```text
optimesh/v1/sites/{site_id}/devices/{device_id}/telemetry   device → platform
optimesh/v1/sites/{site_id}/devices/{device_id}/command     platform → device
optimesh/v1/sites/{site_id}/devices/{device_id}/ack         device → platform
```

Never set the MQTT retain flag. A device subscribes only to its own `command` topic.

## 4. Telemetry (device → platform)

Publish every **2–5 s**. More often than once per second is unnecessary. If nothing arrives for **15 s**, the dashboard shows the device as offline.

```json
{
  "version": 1,
  "site_id": "5e000000-0000-4000-8000-000000000002",
  "device_id": "de000000-0000-4000-8000-000000002003",
  "message_id": "6f1c2a8e-3b7d-4c51-9a0e-2d4b8f7e1c33",
  "observed_at": "2026-10-02T18:00:00Z",
  "metrics": { "power_w": 58.4, "energy_wh": 125.7, "voltage_v": 229.6, "current_a": 0.254 },
  "state": { "on": true }
}
```

| Field | Required | Notes |
|---|---|---|
| `version` | yes | Always `1`. |
| `site_id`, `device_id` | yes | Must match the topic, or the message is dropped. |
| `message_id` | yes | A new random UUID v4 per message. Re-sending the same id is ignored, so retries are safe. |
| `observed_at` | yes | UTC, ISO 8601, with `Z` or an offset. Needs NTP. Timestamps older than 24 hours or more than 5 min in the future are rejected (inclusive bounds). |
| `metrics.power_w` | one of power/energy/soc | Instantaneous power in **W**. The sign depends on the kind; see below. |
| `metrics.energy_wh` | optional | Lifetime counter in **Wh**, ≥ 0, never resets while running. |
| `metrics.soc_pct` | optional | Battery state of charge, 0–100. |
| `metrics.voltage_v`, `metrics.current_a` | optional | RMS values, for diagnostics. |
| `state.on` | if switchable | The relay state **as actually applied**. |
| `state.setpoint_w` | if it has a setpoint | The power limit as actually applied. |

Unknown fields are **rejected**, so typos fail loudly. Send `null` or omit a field rather than inventing one.

**Power sign convention** (per device kind):

| Kind | Positive `power_w` means |
|---|---|
| `grid_meter` | importing from the grid (export is negative) |
| `solar_inverter` | producing |
| `battery` | charging (discharging is negative) |
| everything else (`load`, `smart_plug`, `boiler`, `hvac`, `ev_charger`) | consuming |

## 5. Commands (platform → device)

```json
{
  "version": 1,
  "command_id": "44444444-4444-4444-8444-444444444444",
  "issued_at": "2026-10-02T18:00:00Z",
  "expires_at": "2026-10-02T18:00:15Z",
  "type": "switch",
  "params": { "on": false }
}
```

| `type` | `params` | Requires capability |
|---|---|---|
| `switch` | `{"on": true \| false}` | `switch` |
| `power_setpoint` | `{"power_w": number ≥ 0}`; 0 means stop | `power_setpoint` |

The backend validates commands against the device's capabilities and limits before sending, but the device stays responsible for its own safety.

**On every command, the device must:**

1. If `expires_at` has passed (and the clock is NTP-synced), reject it with reason `"expired"`.
2. Apply it, or refuse it if unsafe or unsupported.
3. Publish an **ack** within 15 s.
4. Publish a telemetry message straight away with the new `state`, so the UI updates immediately.
5. If the same `command_id` arrives again (QoS 1 can duplicate), re-send the same ack **without** applying it twice.

## 6. Ack (device → platform)

```json
{
  "version": 1,
  "command_id": "44444444-4444-4444-8444-444444444444",
  "status": "applied",
  "reason": null,
  "observed_at": "2026-10-02T18:00:00.350Z"
}
```

`status` is `applied` or `rejected`. Put a short human-readable `reason` (max 200 characters) on rejections; the dashboard shows it.

Command lifecycle shown to the user: `pending` → `sent` (the broker accepted it, which **is not** confirmation) → `applied` / `rejected`. Without an ack it becomes `expired`, and a late ack still updates it. The status `failed` means the broker was unreachable.

## 7. ESP32 notes

- **PubSubClient** works. Call `client.setBufferSize(1024)`: the default 256 bytes is too small and messages are silently dropped. It publishes QoS 0 only, which is acceptable because `message_id` makes retries safe.
- **ArduinoJson** for building and parsing payloads.
- **Time**: `configTime(0, 0, "pool.ntp.org")`, and don't publish until the year is ≥ 2025.
- **UUID v4** from `esp_random()`:

```cpp
void uuid4(char out[37]) {
  uint8_t b[16];
  for (int i = 0; i < 16; i += 4) { uint32_t r = esp_random(); memcpy(b + i, &r, 4); }
  b[6] = (b[6] & 0x0F) | 0x40; b[8] = (b[8] & 0x3F) | 0x80;
  snprintf(out, 37, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);
}
```

**HTTP fallback**: if MQTT is a problem during bring-up, `POST /api/v1/telemetry` accepts the same telemetry JSON. Commands still need MQTT.

## 8. Testing without the backend

```sh
# Watch everything
mosquitto_sub -h <broker> -t 'optimesh/v1/#' -v
# Send a command to the ESP32 by hand
mosquitto_pub -h <broker> -t optimesh/v1/sites/5e000000-0000-4000-8000-000000000002/devices/de000000-0000-4000-8000-000000002003/command \
  -m '{"version":1,"command_id":"44444444-4444-4444-8444-444444444444","issued_at":"2026-10-03T10:00:00Z","expires_at":"2030-01-01T00:00:00Z","type":"switch","params":{"on":true}}'
```

To validate payloads offline, check them against `contracts/*.schema.json`, or use the examples in `contracts/*.example.json`.

## 9. Open questions for the hardware team

1. Broker auth: per-device username/password with ACLs (one device can only publish its own topics) before any non-LAN demo. Agree on credentials provisioning.
2. ESP32 demo load: what is the actual load and its maximum power (for `limits.max_power_w`)? Does it measure voltage/current (which sensor)?
3. Safe default state after a reboot or a lost connection: relay off, or the last state?
4. Batteries: are `+charge / −discharge` and a meaning for `power_setpoint` (force charge? discharge limit?) acceptable? Battery control is disabled until agreed.
5. Zigbee or third-party devices: will a gateway translate them to this contract (recommended), or do they need a different adapter?

## Frontend API (for the dashboard)

REST and WebSocket are documented at `http://127.0.0.1:8000/docs`. The main endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/sites` | All sites with a live `summary` (portfolio) |
| `GET /api/v1/sites/{id}` | Site, devices and the latest reading per device |
| `WS /api/v1/sites/{id}/live` | `{"type":"snapshot","data":…}` on every change (and at least every 5 s), `{"type":"command","data":…}` on command updates. Close code 4404 means the site was not found. |
| `POST /api/v1/sites/{id}/devices/{device}/commands` | Body `{"type":"switch","params":{"on":true}}`. Returns 202 with the command; 422 if the device cannot do it. |
| `GET /api/v1/sites/{id}/commands` | Recent commands |
| `GET /api/v1/sites/{id}/devices/{device}/measurements?limit=` | History, newest first |
| `GET /api/v1/status` | `{"mqtt": "connected" \| "disconnected" \| "disabled"}` |

Summary values are in W: `grid_w` is + import, `battery_w` is + charging. `consumption_w` is derived from the balance (grid + solar − battery) only when all of those devices are online. Otherwise it is the sum of the measured loads.
