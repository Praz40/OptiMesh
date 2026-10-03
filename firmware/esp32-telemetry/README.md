# ESP32 simulated load telemetry

One ESP32 publishes telemetry v1 for a constant positive consuming load. Default
target: generic ESP32 DevKit / ESP32-WROOM-32 (`esp32dev`). No GPIO, command
subscription, command acknowledgements, availability, backend ingestion or control
is implemented. Command/control is intentionally deferred while PR #19 is reviewed.

## Toolchain and transport

Use PlatformIO Core (or the PlatformIO IDE extension), pinned to
`platformio/espressif32@6.9.0`, ESP-IDF 5.3.1. The built-in ESP-MQTT client supports
QoS 1 publishing, an outbox with retransmission, TLS with a trusted CA and broker
hostname verification, authentication and reconnection. No third-party MQTT library
is needed. See the [PlatformIO release](https://github.com/platformio/platform-espressif32/releases/tag/v6.9.0)
and [ESP-MQTT documentation](https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32/api-reference/protocols/mqtt.html).

## Configure locally

From this directory in PowerShell:

```powershell
Copy-Item include/config.example.h include/config.local.h
```

Edit the ignored `include/config.local.h`:

- `WIFI_SSID`, `WIFI_PASSWORD`: your 2.4 GHz network.
- `MQTT_HOST`, `MQTT_PORT`: broker DNS name matching its certificate, normally 8883.
  Supply a hostname only, without a URI scheme, credentials or path.
- `MQTT_USERNAME`, `MQTT_PASSWORD`: broker-issued device credentials. If using
  mutual TLS instead, set these to empty strings and supply the client PEM pair.
- `SITE_ID`, `DEVICE_ID`: assigned canonical UUIDs from the team's device/site
  registration; IDs in the example JSON are illustrative only.
- `MQTT_CA_PEM`: trusted root CA (and intermediate CA if needed) provided by your
  broker administrator, as C string literals. For example:
  `"-----BEGIN CERTIFICATE-----\n" "...\n" "-----END CERTIFICATE-----\n"`.
- `MQTT_CLIENT_CERT_PEM`, `MQTT_CLIENT_KEY_PEM`: optional mutual TLS client
  certificate and matching private key, both set or both empty.
- `NTP_SERVER`: reachable SNTP server; the network must allow UDP port 123.
- `BASE_POWER_W`: constant consuming load, default 1200 W, range 0.001..1000000.
- `PUBLISH_INTERVAL_MS`: default 5000 ms, permitted range 1000..60000 ms.

TLS and CA/hostname verification are always enabled. Configure broker
authentication and an ACL granting this identity publish access to its exact
telemetry topic. Client IDs/UUIDs do not establish authorization. A missing local
header fails the build with setup guidance; invalid/template values disable
telemetry at boot without printing them. Local configuration, `certs/`, build
outputs and generated SDK configuration are ignored. Credentials are embedded in
the locally built firmware: do not share its binary or commit local files.

## Build, flash and monitor

Run from this firmware directory:

```powershell
pio run -e esp32dev
pio run -e esp32dev -t upload --upload-port COM5
pio device monitor --port COM5 --baud 115200
```

Replace `COM5` with the board's port (`pio device list`). First build downloads
the pinned ESP32 toolchain. If PlatformIO is missing, install the PlatformIO IDE
extension, or, if Python is already installed, run `py -m pip install --user platformio`.
If `pio` is not on PATH, use `py -m platformio` in place of `pio`.

## Wire behavior

Topic follows the unchanged telemetry convention in the current
[contract PR #19](https://github.com/Praz40/OptiMesh/pull/19), head `707d50e`,
checked 2026-10-03. No review comment disputed this telemetry topic. The unchanged
`contracts/telemetry-v1.schema.json` and `services/api/app/schemas.py` on `develop`
remain the payload source of truth; this firmware does not require the command PR
to be merged.

```text
optimesh/v1/sites/{site_id}/devices/{device_id}/telemetry
MQTT 3.1.1, QoS 1, retained=false, payload below 4 KiB
```

Default: one new observation approximately every 5 seconds while connected with
valid time and no outstanding observation. Each uses a fresh random UUID v4 from
`esp_fill_random`, a UTC RFC3339 `observed_at` ending in `Z`, `power_w` and
`energy_wh`. No `soc_pct` is reported for this consuming load. Example:

```json
{
  "version": 1,
  "site_id": "11111111-1111-4111-8111-111111111111",
  "device_id": "22222222-2222-4222-8222-222222222222",
  "message_id": "33333333-3333-4333-8333-333333333333",
  "observed_at": "2026-10-03T08:00:05Z",
  "metrics": {"power_w": 1200.0, "energy_wh": 1.666667}
}
```

Energy starts at zero at simulator startup and accumulates
`power_w * elapsed_microseconds / 3600000000`, including network outages. It resets
on reboot and is not a lifetime meter. Monotonic time, rather than UTC, drives
integration, so SNTP corrections do not change energy. UUID and device MAC form a
stable unique MQTT client ID. Do not assign the same registered device ID to two
devices even though their MQTT client IDs would differ.

Wi-Fi association/DHCP attempts are limited to 20 seconds, followed by 1, 2, 4,
8, 16, then 30 seconds of backoff; success resets the backoff. MQTT network
operations have a 10-second timeout and a 5-second reconnect interval. Before
connecting MQTT or creating observations, the device requires a real SNTP reply
and a plausible UTC date (2024 or later). Wi-Fi/IP loss invalidates readiness and
requires a fresh reply. SNTP resynchronizes hourly; publishing pauses after two
hours without a valid reply. This is a telemetry freshness policy, not a command
clock-error guarantee. SNTP is unauthenticated; use a trustworthy network/server.

Only one telemetry packet is held in the RAM outbox (4096-byte limit). The client
retransmits the same stored bytes/UUID/timestamp at QoS 1, including across a
reconnection. While it is outstanding, new observations are skipped. Unconfirmed
packets expire after 60 seconds; no offline history is queued and reboot loses
pending telemetry. QoS 1 permits duplicates. The subscriber/backend should dedupe
by `message_id`. A serial "Queued" line means accepted into the outbox; "Broker
confirmed" means MQTT PUBACK, not backend acceptance.

## Verify with a subscriber

With a separately authorized subscriber identity, use Mosquitto's `mosquitto_sub`:

```powershell
mosquitto_sub -h BROKER_DNS -p 8883 --cafile C:\local\broker-root-ca.pem -q 1 -v -t "optimesh/v1/sites/SITE_UUID/devices/DEVICE_UUID/telemetry"
```

Replace placeholders and configure subscriber authentication with your broker's
local Mosquitto client config; keep that file outside the repository. If your
broker uses mutual TLS, add `--cert C:\local\subscriber.pem --key C:\local\subscriber.key`.
Do not disable certificate verification. Expect a positive 1200 W load, increasing
energy, new UUIDs and current UTC timestamps roughly every 5 seconds. Subscriber
QoS 1 requests delivery at QoS 1; firmware publication also explicitly uses QoS 1.

## Local validation

From the repository root with the API dependencies already installed:

```powershell
.\services\api\.venv\Scripts\python.exe firmware/esp32-telemetry/tests/validate_telemetry.py
```

Or from `services/api`:

```powershell
uv run --frozen python ../../firmware/esp32-telemetry/tests/validate_telemetry.py
uv run --frozen pytest -q tests/test_contract.py
```

To exercise the actual portable C encoding code, compile the host probe from this
directory. On Linux/macOS with an existing C compiler:

```sh
cc -std=c11 -D_POSIX_C_SOURCE=200809L -Wall -Wextra -Werror -Isrc src/telemetry.c tests/host_telemetry.c -lm -o /tmp/optimesh-host-telemetry
python tests/validate_telemetry.py --producer /tmp/optimesh-host-telemetry
```

On Windows, in an existing Visual Studio x64 Native Tools prompt:

```bat
mkdir build
cl /nologo /W4 /WX /std:c11 /Isrc src\telemetry.c tests\host_telemetry.c /Fobuild\ /Febuild\host_telemetry.exe
..\..\services\api\.venv\Scripts\python.exe tests\validate_telemetry.py --producer build\host_telemetry.exe
```

The probe checks UUID version/variant bits, leap-day UTC formatting, rejection of
boot timestamps and invalid inputs, elapsed-time energy and unchanged retransmit
encoding. Python checks 256 actual C payloads against JSON Schema with UUID/date
format assertion and the backend Pydantic model. It does not emulate the ESP32
radio, TLS or MQTT event loop.

## Hardware acceptance checks still required

- Build/flash with the configured local header; confirm a current UTC timestamp
  and broker PUBACKs, then inspect messages with the subscriber.
- Block NTP at startup: no MQTT connection or timestamped observations before
  synchronization. Restore NTP: publishing resumes.
- Restart the access point and broker independently: recovery, stable client ID,
  no unbounded outbox growth, valid timestamps after reconnection.
- Try an untrusted CA, wrong broker hostname and bad device credentials: connection
  must fail. Restore valid configuration and confirm recovery.
- Delay PUBACKs/disconnect during publishing: retransmissions keep the original
  observation identity, with no more than one observation outstanding.
- Reboot: energy resets; new observations have new message IDs. Confirm logs do
  not disclose SSID/password, broker credentials, certificate/key or assigned IDs.

Backend MQTT ingestion is a separate integration dependency; a broker PUBACK
alone cannot make this telemetry appear on the dashboard.
