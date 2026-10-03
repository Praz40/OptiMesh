# Raspberry Pi broker and MQTT ingestion

## MQTT over TLS

The hardware team's broker (Mosquitto on the Raspberry Pi) uses TLS on port 8883 with a username/password and per-device ACLs. Point the API at it in services/api/.env:

```sh
MQTT_HOST=broker.example.lan        # must match the broker certificate (DNS name or IP in its SAN)
MQTT_PORT=8883
MQTT_TLS=true
MQTT_CA_FILE=/path/to/broker-ca.crt # CA that signed the broker certificate
MQTT_USERNAME=...
MQTT_PASSWORD=...
MQTT_CLIENT_ID=optimesh-backend-demo
```

TLS defaults to enabled. With `MQTT_TLS=true` the API's MQTT bridge and `python -m app.simulator` verify the broker certificate chain and hostname; there is no setting to disable verification. A missing or unreadable `MQTT_CA_FILE` stops the API at startup, and `MQTT_CA_FILE` without `MQTT_TLS=true` is rejected so credentials are never sent in plain text by mistake. The local `docker compose` broker explicitly sets `MQTT_TLS=false` and port 1883; remote plaintext is rejected. Set a stable `MQTT_CLIENT_ID` and use separate backend credentials. `MQTT_CA_CERT` remains supported for existing Pi configurations.

## Raspberry Pi MQTT telemetry ingestion

The aiomqtt `MqttBridge` feeds the shared `Platform` persistence/live pipeline.
Command publishing, acknowledgements, WebSockets and the simulator remain supported.
The Raspberry Pi path uses verified TLS and separate backend credentials.

From `services/api`, run `uv sync --frozen --python 3.12` and configure the ignored
`.env` using `.env.example`. MQTT stays disabled when `MQTT_HOST` is unset.
TLS is enabled by default; these variables configure the real broker:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Existing backend PostgreSQL connection URI |
| `MQTT_HOST` | `192.168.0.23` for the verified Raspberry Pi broker |
| `MQTT_PORT` | `8883` (default) |
| `MQTT_CA_FILE` | Absolute path to the trusted public CA certificate, outside Git (`MQTT_CA_CERT` is the legacy alias) |
| `MQTT_USERNAME` | Separate backend subscriber identity |
| `MQTT_PASSWORD` | Its password, only in local environment/configuration |
| `MQTT_CLIENT_ID` | Stable, unique backend ID, e.g. `optimesh-backend-demo` |
| `MQTT_TELEMETRY_TOPIC` | Optional exact `optimesh/v1/sites/{site_id}/devices/{device_id}/telemetry` |

Use assigned canonical UUIDs in the topic. The currently verified topic is
`optimesh/v1/sites/0e708814-7d96-4d44-8c6b-6e841346bd34/devices/42c485b1-f4f0-436b-ae5c-f86b7285055b/telemetry`.
These IDs must already belong to the same device/site registry pair in the target
database. Broker identities and ACLs authorize MQTT publications/subscriptions;
payload UUIDs alone are not credentials. The backend identity needs read access
to this telemetry topic and its sibling `ack` topic, plus write access to the
`command` topic when commands are used. Never reuse the ESP32 publish identity for the subscriber.

For real brokers TLS is mandatory, verifies the CA chain and hostname/IP, and requires TLS 1.2 or
newer. The verified broker certificate includes `192.168.0.23` in its IP SAN.
There is no insecure/plaintext fallback. No CA private key is needed. Do not
commit passwords, local `.env` files, private keys, firmware configuration or CA
files. Credentials and payload/error contents are omitted from application logs.
`SUPABASE_URL` remains necessary to use the existing authenticated history API.

Run one ingest-enabled API process using `uv run --frozen uvicorn app.main:app`.
Avoid `--reload` and multiple workers for this first hardware test; two consumers
sharing a client ID disconnect each other. `GET /status` and `/api/v1/status` return only
`{"mqtt":"disabled"}`, `{"mqtt":"disconnected"}` or `{"mqtt":"connected"}`.
Connected means the broker accepted the QoS 1 subscription, not that a measurement
has already committed. `/health` and `/ready` retain their existing behavior.

QoS 0 deliveries remain supported for existing devices, but cannot be replayed
after failures; use QoS 1 for reliable hardware ingestion.

The bridge dispatches telemetry and acknowledgements sequentially through `Platform`.
Telemetry schema, canonical topic/payload IDs and registered site/device membership
are checked before persistence. `observed_at` must be within 24 hours in the past
and 5 minutes in the future (inclusive), compared with the current UTC clock.
Each measurement has its own transaction, with 5s statement and 3s lock timeouts.
The `(device_id, message_id)` unique constraint preserves the first reading on replay.

aiomqtt uses Paho with manual acknowledgements, MQTT 3.1.1 and a persistent session
for the configured stable client ID. PUBACK follows committed ingestion or duplicate
handling; permanently invalid messages and deliveries without a configured database are consumed.
Unexpected processing bugs are retried up to three times per topic/payload digest,
then consumed so they cannot block later telemetry; the retry cache is bounded.
Transient database failures remain unacknowledged and reconnect
with exponential backoff (1–30s), without PUBACK, allowing broker replay. Both the
telemetry and ack subscriptions must receive QoS 1 grants before status is connected.
Broker queue retention/persistence still bounds replay; this is not an unconditional
end-to-end delivery guarantee. Changing client ID abandons the previous session.
An exact telemetry topic also scopes acknowledgements to that device; when unset,
the bridge subscribes across sites under `MQTT_TOPIC_PREFIX` (default `optimesh/v1`).

The anonymous local simulator broker is an explicit exception: set `MQTT_TLS=false`
and `MQTT_PORT=1883` for a loopback host or the Compose service `mqtt`, without credentials or a CA. There is
no automatic downgrade and other remote plaintext configuration is rejected.
On Windows, aiomqtt requires the selector event loop. Launch one API worker with:

```powershell
python -c "import asyncio,uvicorn; asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy()); uvicorn.run('app.main:app',loop='asyncio',workers=1)"
```

Physical verification:

1. Confirm migrations are applied and the exact site/device registry pair exists.
   Configure local backend credentials/CA and keep the ESP32 publishing normally.
2. Start the backend; poll `/status` until `connected`. With application INFO
   logging enabled, logs show sanitized `stored` or `duplicate` outcomes. Expect a new observation around every 5s.
3. Check PostgreSQL `optimesh.measurements` for the configured IDs and matching
   `message_id`, `observed_at`, `power_w`, `energy_wh`, and server `received_at`.
   Alternatively, query `/sites/{site_id}/measurements` with a valid owner bearer
   token and timezone-aware `start`/`end` covering the current readings.
4. Briefly stop/restart the backend using the same client ID. Confirm reconnection,
   new rows and replay where the broker retains messages; repeated message IDs
   must leave exactly one row. Stop with Ctrl+C and confirm the worker exits.

Never publish malformed/replayed test data using the real device identity. Use an
isolated test broker/database for destructive or failure-injection tests.
