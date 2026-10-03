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

## Payload validation

Command and acknowledgement payloads must validate against their respective
`contracts/*-v1.schema.json` files, including required fields, enums, types and
rejection of additional properties. All UUID and `date-time` formats MUST be
asserted by the validator. Draft 2020-12 treats `format` as an annotation by
default: a validator without format checking is not sufficient for this contract.

Identifiers are UUID strings, consistent with telemetry v1 and the backend's UUID
fields. Timestamps are RFC 3339 strings with an explicit `Z` or numeric UTC offset;
producers should emit UTC with `Z`. Consumers compare instants in UTC, consistent
with the backend's timezone-aware telemetry model. Malformed identifiers, invalid
calendar dates and timestamps without a timezone must be rejected.

Schema validation does not establish publisher authorization, trustworthy device
time or expiry. These runtime checks remain required. The existing telemetry v1
schema and backend validation rules are unchanged.

Focused checks run from `services/api` with:

```sh
uv run --frozen pytest -q tests/test_contract.py tests/test_mqtt_contract.py
```

## MQTT transport security

Production and public deployments MUST use TLS for every device and backend MQTT
connection. Clients must verify the broker certificate chain against a trusted CA
and verify the broker hostname; disabling certificate verification is not allowed.
The broker must authenticate clients and enforce the topic ACLs below. TLS server
authentication does not replace device authentication or authorization.

No plaintext or certificate-verification exception is established by this
contract. Any proposed development-only exception needs team agreement and must
never become a production/public deployment default. Credentials must not be
committed to source or included in logs.

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
Devices must discard command deliveries marked as retained without applying them.

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

Every new telemetry observation must use a new `message_id`. Retransmission of
that same observation must preserve its ID and payload so the backend can
recognize a duplicate.

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
issued_at
expires_at
command
parameters
local hardware limits
```

`expires_at` must be later than `issued_at`; the backend and device must check
this ordering after schema validation. JSON Schema does not compare timestamps.
A command is expired when the current UTC instant is equal to or later than
`expires_at`. Check expiry immediately before applying the action, not only when
receiving or queueing the command.

The device must establish synchronized UTC time and be able to bound its clock
error within the team's agreed maximum before applying any command. If time is
unsynchronized, validity has been lost, or the clock-error bound is not configured
or cannot be established, reject the command without changing state. An ESP32
must not use uptime or a default boot date as UTC.

When time is valid, only apply if the latest possible current UTC instant
(current UTC plus the established error bound) is still before `expires_at`.
This conservative check prevents clock uncertainty from extending the deadline.
The maximum clock error and synchronization validity criteria still require team
agreement; this contract supplies no arbitrary numeric value.

If a rejected command cannot be acknowledged with a trustworthy `observed_at`,
do not fabricate a timestamp or claim success. Record the rejection locally. The
wire error code and reporting/retry behavior for unavailable device time remain
pending team agreement; the current schema has no clock-error code.

The device must not blindly trust the backend.

## Command idempotency

The backend assigns one `command_id` to one immutable command for one device.
Retries must preserve the ID and all command fields, including the original
expiry. A new requested action needs a new ID; a retry must not extend expiry.

A device must track commands in progress and cache each final acknowledgement
with its command. A duplicate while processing must not start another action.
For an identical completed command, republish the original final acknowledgement,
including its original `observed_at` and state; do not reapply the action or replace
that result with the device's current state. This also applies when the retry
arrives after expiry: replaying a stored result is not a new action.

Reusing an ID with different command fields is a protocol violation: do not apply
the changed command or overwrite the original result. Backend consumers must
correlate acknowledgements by site/device/command ID and treat repeated identical
final results as duplicates, rather than new state observations.

Retain results at least while the original command could still be applied. If a
result is unavailable, perform all validation and expiry checks before any action;
an expired command must never execute. Cache capacity, retry horizon and whether
results survive reboot still need team agreement. Cross-reboot exactly-once
execution is not guaranteed by this draft. `set_enabled` is an absolute desired
state, not a toggle; future non-idempotent actions require their own replay policy.

---

# Command acknowledgement

After processing a command, the device publishes an acknowledgement when valid
correlation IDs and a trustworthy observation timestamp are available, subject to
the invalid-envelope and unavailable-time rules below.

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

Allowed error codes:

```text
expired
invalid_payload
unsupported_command
out_of_range
interlock
hardware_failure
```

For the current `set_enabled`-only MVP, the acknowledgement schema enforces:

- `applied`: `error_code` is null and `state.enabled` is required. Report the
  resulting observed boolean state, not merely the requested value. It must
  match the original command's `params.enabled`; otherwise report a failed
  application. This comparison requires the correlated command at runtime.
- `rejected`: the request was not applied; `error_code` is a non-null allowed
  code explaining why validation, expiry or a local safety check refused it.
- `failed`: application was attempted but did not complete successfully;
  `error_code` is a non-null allowed code explaining the failure.

`state` is always required. For rejected/failed outcomes, include `enabled` only
when the resulting state is known; otherwise use `{}`. Null is not a boolean.
The acknowledgement describes the original processing result, not live state
at the time of a duplicate replay. Adding another command requires reviewing
this schema's applied-state requirement.

Only publish a correlated rejection when `command_id` is a valid UUID and the
command targets this device's configured site/device IDs. Malformed JSON or an
invalid/missing correlation ID cannot produce a schema-valid acknowledgement;
discard it without applying it and record a local diagnostic. Do not echo another
device's IDs or invent identifiers to acknowledge an invalid envelope.

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

The broker MUST authenticate each device and bind that authenticated identity
to a fixed ACL for its assigned `site_id` and `device_id`. IDs chosen by a client
in a topic, payload or MQTT client ID are not proof of ownership. The broker must
enforce both publish and subscribe permissions, denying other topic namespaces
and wildcard subscriptions that could expose another device's commands.

A physical device must only have permission to:

```text
PUBLISH
its own telemetry
its own acknowledgement
its own availability

SUBSCRIBE
its own command topic
```

It should not be able to publish telemetry for another device or subscribe to another site's commands.

The backend must authenticate separately and be authorized only for the sites
it serves. Within that authorization, the backend may:

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
