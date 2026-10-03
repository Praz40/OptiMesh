# OptiMesh

Hackathon foundation for a modular energy-management platform. Read [the feasibility review](docs/project-review.md) before dividing the work. [The original brief](docs/project-brief.md) is reference material; the full product roadmap is not implemented.

**Frontend:** Next.js App Router, TypeScript, Tailwind CSS.
**Backend:** Python 3.12, FastAPI, SQLAlchemy, psycopg, Alembic.
**Database:** PostgreSQL, hosted in Supabase when deployed.

## What works now

- Starter web app showing live API/database connection status and handling offline states.
- `GET /health` for API liveness and `GET /ready` for database connectivity.
- ORM models and Alembic migrations for sites, devices and measurements in the private `optimesh` schema.
- Authenticated site/device registry, device provisioning with capabilities and configured operating limits, and paginated UTC measurement history.
- REST bearer-token verification using Supabase Auth public signing keys and owner-based site authorization.
- Validated [shared telemetry contract](docs/contracts.md), example payload and generated JSON Schema.
- GitFlow documentation, PR/issue templates, one `.coderabbit.yaml`, CI and GitHub backlog setup.

Optional verified-TLS MQTT telemetry ingestion is implemented. WebSockets, login UI, membership/role authorization, commands, optimizer and simulator are future issues. No hosted database or deployment is provisioned by this template.

## Quick start

Install Node.js 24 LTS and [uv](https://docs.astral.sh/uv/getting-started/installation/). uv can install Python 3.12. Run commands from the Git repository root (the nested OptiMesh folder).

Frontend:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The frontend uses server-only `API_URL`, defaulting to http://127.0.0.1:8000. Copy apps/web/.env.example to apps/web/.env.local to override it.

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

## Registry and measurement history

Set `SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co` in services/api/.env to the same project as the database. The backend verifies access tokens against that project's public signing keys, requiring ES256 or RS256, a valid signature, the project issuer, the `authenticated` audience and role, an unexpired token and a UUID subject. Legacy HS256 tokens are rejected. No service-role key or shared JWT signing secret is needed. Missing configuration or an unavailable signing-key provider fails closed with 503; missing or invalid credentials receive 401.

Run `uv sync --frozen` and `uv run --frozen alembic upgrade head` from services/api for your development database. Revision 0002 adds configured device limits and extends history indexes with the measurement ID. Existing rows receive empty limits; no device-specific bounds are invented.

Send a Supabase user access token as `Authorization: Bearer <access_token>`, or use **Authorize** in http://127.0.0.1:8000/docs. The REST authorization policy is ownership: the verified token subject must match `Site.owner_id`. Memberships, role delegation and login UI remain part of issue #3.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | /sites | List the current user's sites |
| POST | /sites | Create a site owned by the current user |
| GET | /sites/{site_id} | Read an owned site |
| GET | /sites/{site_id}/devices | List its devices |
| POST | /sites/{site_id}/devices | Provision a device |
| GET | /sites/{site_id}/devices/{device_id} | Read a device under that site |
| GET | /sites/{site_id}/measurements | Read bounded measurement history |

Create a site with `{"name":"Home","timezone":"Europe/Sofia","currency":"EUR"}`. Names are trimmed and bounded, timezones use IANA names and currency is a three-letter uppercase code. Provision a device with, for example:

```json
{
  "name": "Demo battery",
  "kind": "battery",
  "source": "simulator",
  "capabilities": ["measure_power", "battery_soc"],
  "operating_limits": {
    "min_power_w": -500,
    "max_power_w": 2000,
    "min_soc_pct": 20,
    "max_soc_pct": 90
  }
}
```

The limits above are example configuration values, not hardware specifications. Bounds are optional; power is finite and signed in W, and SOC is finite and between 0 and 100 percent. Each configured minimum must not exceed its maximum. Unknown fields, duplicate/unknown capabilities and invalid sources are rejected. Capabilities reuse the existing telemetry contract enum.

History requires timezone-aware `start` and `end` query parameters, normalizes them to UTC and uses the half-open interval `[start, end)`. The maximum window is 30 days. `limit` defaults to 100 and accepts 1?500; `device_id` optionally narrows the query to a device belonging to the site. For example: `/sites/{site_id}/measurements?start=2026-10-01T00:00:00Z&end=2026-10-02T00:00:00Z&limit=100`.

Responses contain `items` and `next_cursor`. Follow a non-null cursor using the same site, device and time bounds; the page size may change. Ordering is ascending by `observed_at` and then `id`, so equal timestamps paginate without duplicates. Cursors are validated pagination positions, not authorization credentials or a snapshot of concurrent ingestion.

Authorized empty collections return 200 with an empty list (or empty history page). Missing, foreign and site/device-mismatched resources return 404 to avoid exposing another user's data. Invalid input returns 422; database failures return 503 without internal details.

## Raspberry Pi MQTT telemetry ingestion

The subscriber uses the existing telemetry v1 Pydantic contract and PostgreSQL
`Measurement` table. No additional migration, HTTP ingestion endpoint, device
auto-registration, command publisher or dashboard change is needed.

From `services/api`, run `uv sync --frozen --python 3.12` and configure the ignored
`.env` using `.env.example`. MQTT stays disabled when `MQTT_HOST` is unset.
When enabled, these variables are required:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Existing backend PostgreSQL connection URI |
| `MQTT_HOST` | `192.168.0.23` for the verified Raspberry Pi broker |
| `MQTT_PORT` | `8883` (default) |
| `MQTT_CA_CERT` | Absolute path to the trusted public CA certificate, outside Git |
| `MQTT_USERNAME` | Separate backend subscriber identity |
| `MQTT_PASSWORD` | Its password, only in local environment/configuration |
| `MQTT_CLIENT_ID` | Stable, unique backend ID, e.g. `optimesh-backend-demo` |
| `MQTT_TELEMETRY_TOPIC` | Exact `optimesh/v1/sites/{site_id}/devices/{device_id}/telemetry` |

Use assigned canonical UUIDs in the topic. The currently verified topic is
`optimesh/v1/sites/0e708814-7d96-4d44-8c6b-6e841346bd34/devices/42c485b1-f4f0-436b-ae5c-f86b7285055b/telemetry`.
These IDs must already belong to the same device/site registry pair in the target
database. Broker identities and ACLs authorize MQTT publications/subscriptions;
payload UUIDs alone are not credentials. The backend identity needs read access
to this topic. Never reuse the ESP32 publish identity for the subscriber.

TLS is mandatory, verifies the CA chain and hostname/IP, and requires TLS 1.2 or
newer. The verified broker certificate includes `192.168.0.23` in its IP SAN.
There is no insecure/plaintext fallback. No CA private key is needed. Do not
commit passwords, local `.env` files, private keys, firmware configuration or CA
files. Credentials and payload/error contents are omitted from application logs.
`SUPABASE_URL` remains necessary to use the existing authenticated history API.

Run one ingest-enabled API process using `uv run --frozen uvicorn app.main:app`.
Avoid `--reload` and multiple workers for this first hardware test; two consumers
sharing a client ID disconnect each other. `GET /status` returns only
`{"mqtt":"disabled"}`, `{"mqtt":"disconnected"}` or `{"mqtt":"connected"}`.
Connected means the broker accepted the QoS 1 subscription, not that a measurement
has already committed. `/health` and `/ready` retain their existing behavior.

One background worker processes deliveries sequentially using a separate DB
session/transaction each time. PostgreSQL statement/lock waits are limited locally
to 5s/3s. The MQTT network loop can pause during that transaction; this design is
for the current approximately five-second stream, not high-volume ingestion.

MQTT 3.1.1 uses QoS 1, Paho 2.x `manual_ack=True`, and `clean_session=False` with
the stable client ID. PUBACK is sent only after commit or a committed duplicate
check. The named `(device_id, message_id)` unique constraint implements
first-write-wins: redelivery never overwrites the original reading/receipt time.
Malformed/oversized payloads, invalid topics, schema failures, mismatched IDs,
unknown devices and deliveries outside the configured topic are permanent
rejections; they are consumed with PUBACK to prevent poison-message loops.

Transient database/processing failures receive no PUBACK. The worker disconnects
and reconnects with backoff, allowing the broker to redeliver outstanding QoS 1
messages. Transport reconnects resubscribe and require a successful SUBACK.
This is at-least-once processing with idempotent persistence, not an unconditional
end-to-end delivery guarantee. Confirm Mosquitto persistent-session retention,
queue limits and disk persistence: messages published before the first
subscription or beyond broker retention may be unavailable. QoS 0 publications
are rejected and cannot be recovered. Changing the client ID abandons the old
session; when changing the topic under the same ID, clear obsolete broker
subscriptions operationally (the adapter rejects deliveries outside its new topic).

Paho's [2.1.0 receive path](https://github.com/eclipse-paho/paho.mqtt.python/blob/v2.1.0/src/paho/mqtt/client.py)
skips automatic QoS 1 PUBACK with manual acknowledgement enabled; `ack(mid, 1)`
sends PUBACK explicitly. Paho client-side session state is in memory. Incoming
unacknowledged QoS 1 replay relies on the broker's persistent session; this feature
does not use QoS 2 or promise durable client-side MQTT state.

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

Regenerate the shared schema from services/api with `uv run --frozen python -m app.export_contract`. CI compares it to the Pydantic contract.

## GitFlow and committing manually

Issue #4 is developed on `feature/registry`, based on `develop`. Review your changes before committing; keep local environment files and tools out of Git.

```sh
git status --short
git diff
git add README.md services/api/.env.example services/api/app services/api/tests services/api/alembic/versions/0002_registry.py services/api/pyproject.toml services/api/uv.lock
git diff --cached --stat
git commit -m "feat(api): add site/device registry and measurement history"
git push -u origin feature/registry
```

Open a PR from feature/registry into develop and link issue #4. Merge after CI passes. Publish a release to main through release/* when ready. Portable development tools under .codex-tools are ignored and are not project dependencies.

## GitHub issues, labels and milestones

[.github/project-plan.json](.github/project-plan.json) defines **17 issues, 6 milestones and 13 labels** with acceptance criteria. No due dates or GitHub assignees are invented.

The connected account lacks write access, so no live GitHub issue/label/milestone was created in this session. Publish them with a user account or fine-grained token that has repository access, metadata read and Issues read/write:

```sh
python scripts/setup_github.py --repo Praz40/OptiMesh --dry-run
gh auth login
python scripts/setup_github.py --repo Praz40/OptiMesh
```

The script accepts GH_TOKEN/GITHUB_TOKEN or uses an existing gh login. Never put a token in source or command arguments. It checks write access before mutation, paginates results and uses stable markers to avoid duplicate issues. Existing issue state/body and extra human-added labels are preserved; planned labels and milestones are synchronized.

Alternatively, once the setup workflow exists on the default branch, run **Actions -> Set up GitHub project -> Run workflow**. The workflow uses its own repository-scoped issues:write token and serializes runs.

CodeRabbit uses the required root filename `.coderabbit.yaml` (with a leading dot). A repository owner must install/enable the CodeRabbit GitHub app for actual PR reviews; the YAML alone does not install it. It reviews develop, release/* and main.

## First demo target

Hardware/simulator -> MQTT -> API -> PostgreSQL -> WebSocket -> dashboard, then one validated device command with acknowledgement. Expand to the deterministic manual/autopilot comparison once that loop works. See [project review](docs/project-review.md), [contracts](docs/contracts.md) and [project manifest](.github/project-plan.json).
