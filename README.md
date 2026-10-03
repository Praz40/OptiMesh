# OptiMesh

Hackathon foundation for a modular energy-management platform. Read [the feasibility review](docs/project-review.md) before dividing the work. [The original brief](docs/project-brief.md) is reference material; the full product roadmap is not implemented.

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
- **API**: site/device registry, measurement history, idempotent telemetry ingestion (MQTT or `POST /api/v1/telemetry`), a live WebSocket per site, and commands that are validated against device capabilities. Commands are persisted with the `pending → sent → applied/rejected/expired/failed` lifecycle.
- **Simulator**: virtual devices for the demo sites, speaking the same MQTT contract as hardware. It can stand in for the ESP32 with `--include-hardware`.
- **Dashboard**: a Portfolio page (all sites) and a Site page with KPIs, an animated energy flow, a live device list with switch and power-limit controls, and a command log.
- Demo seed: Home, Workshop (where the physical ESP32 lives) and Office, with fixed UUIDs.

Not built yet: authentication (any client can read and command; **keep the API on localhost or a trusted LAN**), tariffs/costs, forecasts, the optimizer, the scenario game and deployment.

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

On Windows, keep `--reload` on the API command: without it uvicorn uses the Proactor event loop, which the MQTT client cannot run on.

Open http://localhost:3000, pick a site and flip a switch. The command log shows `Applied` only after the device acknowledges it. The Workshop's "ESP32 demo load" stays offline until the real board connects, or until you run the simulator with `--include-hardware`.

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

The `optimesh` schema must stay outside Supabase's exposed Data API schemas. Public schema access is revoked. Supabase Auth and application tenant authorization are a P0 issue; the migration's privileged DB role bypasses RLS, so enabling RLS alone would not replace backend authorization.

Compose also provides an optional API container: `docker compose --profile api up --build -d`. Apply migrations separately with `docker compose --profile tools run --rm migrate`.

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

## GitFlow and committing manually

Changes are prepared on local `feature/project-template`, based on local `develop`. The template source changes are left uncommitted for you; this agent has made no commits or pushes. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and required CI checks.

With your own Git identity configured, review and commit:

```sh
git diff
git add .
git diff --cached --stat
git commit -m "chore: bootstrap OptiMesh hackathon foundation"
git push -u origin develop
git push -u origin feature/project-template
```

Open a PR from feature/project-template into develop. Publish a release to main through release/* when ready. The local portable tools used to verify this template are ignored under .codex-tools; they are not project dependencies.

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
