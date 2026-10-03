# OptiMesh Contracts v1

This document defines the first shared communication contract between physical devices, simulators, the MQTT broker, and the OptiMesh backend.

The goal is to keep real ESP32 devices and simulated devices interchangeable from the backend's point of view.

## MQTT topic structure

```text
optimesh/v1/sites/{site_id}/devices/{device_id}/telemetry
optimesh/v1/sites/{site_id}/devices/{device_id}/command
optimesh/v1/sites/{site_id}/devices/{device_id}/ack
optimesh/v1/sites/{site_id}/devices/{device_id}/availability
```

`site_id` and `device_id` must match the IDs inside the payload.

## MQTT delivery rules

### Telemetry

```text
QoS: 1
Retained: no
```

Recommended maximum rate for the MVP:

```text
1 message / second / device
```

Default rate should normally be slower unless the demo requires faster updates.

Maximum MQTT payload for MVP devices:

```text
4 KiB
```

### Commands

```text
QoS: 1
Retained: no
```

Commands must never be retained because an old command must not be automatically applied when a device reconnects.

### Acknowledgements

```text
QoS: 1
Retained: no
```

### Availability

```text
QoS: 1
Retained: yes
```

Devices should use MQTT Last Will and Testament so the broker can publish `offline` if the connection disappears unexpectedly.

---

# Telemetry

The existing `contracts/telemetry-v1.schema.json` file is the source of truth for telemetry v1.

Example:

```json
{
  "version": 1,
  "site_id": "11111111-1111-4111-8111-111111111111",
  "device_id": "22222222-2222-4222-8222-222222222222",
  "message_id": "33333333-3333-4333-8333-333333333333",
  "observed_at": "2026-10-03T08:00:00Z",
  "metrics": {
    "power_w": 1200,
    "energy_wh": 8500,
    "soc_pct": 62
  }
}
```

Every telemetry message must use a new `message_id`.

`observed_at` represents when the measurement was taken, not when the backend received it.

## Units

```text
power_w   = watts
energy_wh = watt-hours
soc_pct   = percent, 0 to 100
```

Do not mix watts with watt-hours.

## Power sign conventions

For v1:

```text
Normal loads:
positive = consuming power

Solar:
positive = generating power

Grid:
positive = importing from grid
negative = exporting to grid

Battery:
positive = charging
negative = discharging
```

The backend must interpret `power_w` together with the registered device type.

## Telemetry freshness

For the MVP:

```text
Fresh:   <= 15 seconds since last telemetry
Stale:   > 15 seconds
Offline: explicit availability=offline or prolonged connection loss
```

The frontend must not present stale measurements as live values.

## Telemetry limitations

Telemetry v1 currently supports only:

```text
power_w
energy_wh
soc_pct
```

Voltage, current, temperature and additional metrics must not be added to a v1 payload unless the shared schema is updated.

---

# Commands

The first hardware command supported by the MVP is:

```text
set_enabled
```

Example:

```json
{
  "version": 1,
  "command_id": "44444444-4444-4444-8444-444444444444",
  "site_id": "11111111-1111-4111-8111-111111111111",
  "device_id": "22222222-2222-4222-8222-222222222222",
  "issued_at": "2026-10-03T08:00:00Z",
  "expires_at": "2026-10-03T08:00:10Z",
  "command": "set_enabled",
  "params": {
    "enabled": true
  }
}
```

The device must validate:

```text
version
command_id
site_id
device_id
expires_at
command
parameters
local hardware limits
```

The device must reject an expired command.

The device must not blindly trust the backend.

## Command idempotency

A device must remember recently processed `command_id` values.

If the same command is received more than once because of MQTT QoS 1 delivery, the physical action must not be repeated unnecessarily.

The device should return the same final acknowledgement again.

---

# Command acknowledgement

After processing a command, the device publishes an acknowledgement.

Example successful acknowledgement:

```json
{
  "version": 1,
  "command_id": "44444444-4444-4444-8444-444444444444",
  "site_id": "11111111-1111-4111-8111-111111111111",
  "device_id": "22222222-2222-4222-8222-222222222222",
  "observed_at": "2026-10-03T08:00:01Z",
  "status": "applied",
  "error_code": null,
  "state": {
    "enabled": true
  }
}
```

Possible status values:

```text
applied
rejected
failed
```

Suggested error codes:

```text
expired
invalid_payload
unsupported_command
out_of_range
interlock
hardware_failure
```

A successful MQTT publish from the backend does not mean that the physical command succeeded.

Only an acknowledgement with:

```text
status = applied
```

confirms that the device applied the command.

---

# Availability

Example:

```json
{
  "version": 1,
  "site_id": "11111111-1111-4111-8111-111111111111",
  "device_id": "22222222-2222-4222-8222-222222222222",
  "observed_at": "2026-10-03T08:00:00Z",
  "status": "online"
}
```

Possible values:

```text
online
offline
```

When connecting, the device should:

1. configure an MQTT Last Will message containing `offline`;
2. connect;
3. publish retained `online`.

---

# MQTT access model

A physical device should only have permission to:

```text
PUBLISH
its own telemetry
its own acknowledgement
its own availability

SUBSCRIBE
its own command topic
```

It should not be able to publish telemetry for another device or subscribe to another site's commands.

The backend may:

```text
SUBSCRIBE
telemetry
acknowledgements
availability

PUBLISH
commands
```

---

# Safety

Commands are requests, not unquestionable instructions.

The physical device remains responsible for enforcing its own:

```text
voltage limits
current limits
power limits
temperature limits
interlocks
manual override
fail-safe state
```

Invalid or unsafe commands must be rejected locally.

---

# MVP communication loop

The first required end-to-end demonstration is:

```text
Device
  ↓ telemetry
MQTT
  ↓
Backend
  ↓
Dashboard
```

Then:

```text
Dashboard
  ↓
Backend
  ↓ command
MQTT
  ↓
Device
  ↓ acknowledgement
MQTT
  ↓
Backend
  ↓
Dashboard
```

This proves the complete OptiMesh measure → decide → control → verify loop.