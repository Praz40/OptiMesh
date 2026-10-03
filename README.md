# OptiMesh

Hackathon foundation for a modular energy-management platform. The full product roadmap is not implemented; the backlog is GitHub issues #2–#18, defined in [.github/project-plan.json](.github/project-plan.json).

**Frontend:** Next.js App Router, TypeScript, Tailwind CSS.
**Backend:** Python 3.12, FastAPI, SQLAlchemy, psycopg, Alembic.
**Database:** PostgreSQL, hosted in Supabase when deployed.

## What works now

The first vertical slice runs end to end, in both directions:

```text
ESP32 / simulator --MQTT--> API --> PostgreSQL
                             +--WebSocket--> dashboard
dashboard --REST--> API --MQTT--> device --ack--> API --WebSocket--> dashboard
```

- **Device contract v1**: telemetry, command and ack over MQTT. The hardware-facing spec is in [docs/contracts.md](docs/contracts.md), with JSON Schemas and examples in `contracts/`.
- **API** (`/api/v1`): site/device registry, measurement history, idempotent telemetry ingestion (MQTT or `POST /api/v1/telemetry`), a live WebSocket per site, and commands that are validated against device capabilities. Commands are persisted with the `pending → sent → applied/rejected/expired/failed` lifecycle.
- **Simulator**: virtual devices for the demo sites, speaking the same MQTT contract as hardware. It can stand in for the ESP32 with `--include-hardware`.
- **Dashboard**: a Portfolio page (all sites) and a Site page with KPIs, an animated energy flow, a live device list with switch and power-limit controls, and a command log.
- Demo seed: Home, Workshop (where the physical ESP32 lives) and Office, with fixed UUIDs.
- **Scenario simulator and Autopilot** (`services/api/app/sim`, no API or UI yet): a deterministic office day (10 EVs, 3 chargers, battery, solar, Bulgarian day-ahead prices) and a rolling-horizon LP scheduler. `uv run --frozen python -m app.sim.scenario_office` from services/api prints the no-management / Autopilot / perfect-foresight comparison. This is separate from the MQTT device simulator above.
- **Authenticated provisioning and history** (`/sites`): Supabase bearer-token verification, site and device provisioning and paginated UTC history, owner-scoped. See [below](#authenticated-provisioning-and-history-sites).

Not built yet: authentication on `/api/v1` and the WebSocket (any client can read and command; **keep the API on localhost or a trusted LAN**), tariffs/costs and forecasts in the live slice, an API and screen for the scenario simulator (the game), and deployment.

## Run the live demo

Five terminals (or background them), from the repository root:

```sh
docker compose up -d db mqtt                               # PostgreSQL + Mosquitto
cd services/api && cp .env.example .env && uv sync --frozen --python 3.12
uv run --frozen alembic upgrade head && uv run --frozen python -m app.seed
uv run --frozen uvicorn app.main:app --reload              # API on :8000
uv run --frozen python -m app.simulator                    # virtual devices (add --hour 12 for midday sun)
npm ci && npm run dev                                      # dashboard on :3000 (repo root)
```

Open http://localhost:3000, pick a site and flip a switch. The command log shows `Applied` only after the device acknowledges it. The Workshop's "ESP32 demo load" stays offline until the real board connects, or until you run the simulator with `--include-hardware`.

### MQTT over TLS

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

## Quick start

Install Node.js 24 LTS and [uv](https://docs.astral.sh/uv/getting-started/installation/). uv can install Python 3.12. Run commands from the Git repository root (the nested OptiMesh folder).

Frontend:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The browser calls the API at `NEXT_PUBLIC_API_URL`, which defaults to port 8000 on the same host. The server-side status check uses `API_URL`. Copy apps/web/.env.example to apps/web/.env.local to override them. To open the dashboard from another device on the LAN, add its origin to the API's `CORS_ORIGINS`.

Backend, in another terminal:

```sh
cd services/api
uv sync --frozen --python 3.12
uv run --frozen uvicorn app.main:app --reload
```

API docs: http://127.0.0.1:8000/docs. The API starts without database credentials; readiness stays unavailable.

## Database

For an entirely local database, install Docker and run `docker compose up -d db` from the repository root. Copy services/api/.env.example to services/api/.env.

For Supabase, copy the connection URI from its Connect panel. Prefer a **session pooler on port 5432** on IPv4 hosts. Change the dialect to `postgresql+psycopg://`, URL-encode the password, and enable TLS (`sslmode=require`; use `verify-full` with the downloaded CA certificate for certificate verification).

Keep DATABASE_URL and optional MIGRATION_DATABASE_URL on the backend. The web app needs no database password, Supabase secret key or Supabase client package yet. Alembic owns the application schema; do not also create these tables through Prisma, Drizzle or a second migration system.

From services/api:

```sh
uv run --frozen alembic upgrade head
uv run --frozen alembic check
```

The `optimesh` schema must stay outside Supabase's exposed Data API schemas. Public schema access is revoked. REST JWT verification and ownership checks are implemented; broader Supabase Auth and membership/role authorization remain issue #3; the migration's privileged DB role bypasses RLS, so enabling RLS alone would not replace backend authorization.

Compose also provides an optional API container: `docker compose --profile api up --build -d`. Apply migrations separately with `docker compose --profile tools run --rm migrate`.

## Authenticated provisioning and history (`/sites`)

The live slice under `/api/v1` does not check tokens yet (issue #3). The routes in this section do.

Set `SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co` in services/api/.env to the same project as the database. The backend verifies access tokens against that project's public signing keys, requiring ES256 or RS256, a valid signature, the project issuer, the `authenticated` audience and role, an unexpired token and a UUID subject. Legacy HS256 tokens are rejected. No service-role key or shared JWT signing secret is needed. Missing configuration or an unavailable signing-key provider fails closed with 503; missing or invalid credentials receive 401.

Run `uv sync --frozen` and `uv run --frozen alembic upgrade head` from services/api for your development database. Revision 0002 adds the device `limits` column (with commands and extra measurement fields); revision 0003 requires `limits` to be a JSON object and extends the history indexes with the measurement ID. Existing rows receive empty limits; no device-specific bounds are invented.

Send a Supabase user access token as `Authorization: Bearer <access_token>`, or use **Authorize** in http://127.0.0.1:8000/docs. The REST authorization policy is ownership: the verified token subject must match `Site.owner_id`. Memberships, role delegation and login UI remain part of issue #3.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| POST | /sites | Create a site owned by the current user |
| POST | /sites/{site_id}/devices | Provision a device |
| GET | /sites/{site_id}/measurements | Read bounded measurement history |

Site and device reads are served by `GET /api/v1/sites` and `GET /api/v1/sites/{site_id}`, which are not authenticated yet.

Create a site with `{"name":"Home","timezone":"Europe/Sofia","currency":"EUR"}`. Names are trimmed and bounded, timezones use IANA names and currency is a three-letter uppercase code. Provision a device with, for example:

```json
{
  "name": "Demo battery",
  "kind": "battery",
  "source": "simulator",
  "capabilities": ["measure_power", "battery_soc", "power_setpoint"],
  "limits": {
    "min_power_w": 100,
    "max_power_w": 2000,
    "capacity_wh": 10000
  }
}
```

The limits above are example configuration values, not hardware specifications. `kind`, `capabilities` and `limits` use the device contract types in `app/schemas.py` (`DeviceKind`, `Capability`, `DeviceLimits`), so every provisioned device is readable by `/api/v1`. Bounds are optional; power bounds are finite, non-negative W, `capacity_wh` is positive, and a configured minimum must not exceed its maximum. Unknown fields, duplicate/unknown capabilities, unknown kinds and invalid sources are rejected. A device provisioned while the API is running appears in `/api/v1` snapshots after its first telemetry or an API restart.

History requires timezone-aware `start` and `end` query parameters, normalizes them to UTC and uses the half-open interval `[start, end)`. The maximum window is 30 days. `limit` defaults to 100 and accepts 1–500; `device_id` optionally narrows the query to a device belonging to the site. For example: `/sites/{site_id}/measurements?start=2026-10-01T00:00:00Z&end=2026-10-02T00:00:00Z&limit=100`.

Responses contain `items` and `next_cursor`. Follow a non-null cursor using the same site, device and time bounds; the page size may change. Ordering is ascending by `observed_at` and then `id`, so equal timestamps paginate without duplicates. Cursors are validated pagination positions, not authorization credentials or a snapshot of concurrent ingestion.

An authorized empty history returns 200 with an empty page. Missing, foreign and site/device-mismatched resources return 404 to avoid exposing another user's data. Invalid input returns 422; database failures return 503 without internal details.

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
| `MQTT_CA_CERT` | Absolute path to the trusted public CA certificate, outside Git |
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

## Checks

From the root:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

From services/api:

```sh
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen mypy app
uv run --frozen pytest -q
uv run --frozen python -m unittest discover -s ../../scripts/tests
uv run --frozen python ../../scripts/validate_config.py
```

PostgreSQL integration tests run only when TEST_DATABASE_URL is configured. Use a disposable migrated database, not a hosted production database. CI starts PostgreSQL 17, checks schema drift, upgrades/downgrades/re-upgrades migrations and runs the integration tests without cloud secrets.

Regenerate the shared schemas from services/api with `uv run --frozen python -m app.export_contract`. CI compares them to the Pydantic contracts.

## Contributing

Branch `feature/<slug>` from `develop`, one issue per branch, and open a PR into `develop` using the template. Never push to `main` or `develop` directly. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and the checks CI runs.

## GitHub issues, labels and milestones

[.github/project-plan.json](.github/project-plan.json) defines **17 issues, 6 milestones and 13 labels** with acceptance criteria. No due dates or GitHub assignees are invented.

The backlog is published as issues #2–#18. To re-synchronize labels, milestones and issues, use a user account or fine-grained token that has repository access, metadata read and Issues read/write:

```sh
python scripts/setup_github.py --repo Praz40/OptiMesh --dry-run
gh auth login
python scripts/setup_github.py --repo Praz40/OptiMesh
```

The script accepts GH_TOKEN/GITHUB_TOKEN or uses an existing gh login. Never put a token in source or command arguments. It checks write access before mutation, paginates results and uses stable markers to avoid duplicate issues. Existing issue state/body and extra human-added labels are preserved; planned labels and milestones are synchronized.

Alternatively, once the setup workflow exists on the default branch, run **Actions -> Set up GitHub project -> Run workflow**. The workflow uses its own repository-scoped issues:write token and serializes runs.

CodeRabbit uses the required root filename `.coderabbit.yaml` (with a leading dot). A repository owner must install/enable the CodeRabbit GitHub app for actual PR reviews; the YAML alone does not install it. It reviews develop, release/* and main.

## First demo target

Hardware/simulator -> MQTT -> API -> PostgreSQL -> WebSocket -> dashboard, then one validated device command with acknowledgement. Expand to the deterministic manual/autopilot comparison once that loop works. See [contracts](docs/contracts.md) and [project manifest](.github/project-plan.json).
