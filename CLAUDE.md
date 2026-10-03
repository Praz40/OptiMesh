# OptiMesh — instructions for coding agents

Energy autopilot for one site: it measures, forecasts sun and price, and decides when each device runs.
School hackathon. First demo Sunday 10:00, submission (repo + slides) Sunday 12:30.

## Read first

- `README.md` — what works, how to run, checks.
- `CONTRIBUTING.md` — branches, PRs, migrations and contract changes.
- `docs/contracts.md` — MQTT topics, telemetry, commands, acknowledgements, sign conventions. It is the law.
- GitHub issues #2–#18 (defined in `.github/project-plan.json`) — the backlog. Work on exactly one issue at a time.

## Layout

```
apps/web/              Next.js 16 (App Router), TypeScript, Tailwind 4, vitest: portfolio + live site dashboard
services/api/          Python 3.12, FastAPI, SQLAlchemy, Alembic, uv
  app/schemas.py       device contracts (telemetry, command, ack) and API models
  app/api.py           /api/v1 REST + WebSocket: the live demo slice
  app/platform.py      transport-independent core: ingest, live snapshots, commands and acks
  app/mqtt.py          MQTT bridge: telemetry and acks in, commands out
  app/simulator.py     virtual MQTT devices for the demo sites (`python -m app.simulator`)
  app/seed.py          demo sites Home / Workshop / Office with fixed UUIDs
  app/auth.py          Supabase JWT verification
  app/registry.py      /sites: authenticated site/device provisioning and history
  alembic/versions/    one chain: 0001 core -> 0002 live loop -> 0003 registry history
contracts/             JSON Schemas generated from app/schemas.py, plus examples
docs/contracts.md      device contract for the hardware team
infra/mosquitto/       local broker config (anonymous, localhost only)
scripts/               GitHub backlog setup and config validation (run in CI)
```

## Routes and auth state

- `/api/v1/...` (sites, snapshot, measurements, telemetry, commands, WebSocket `/api/v1/sites/{id}/live`, status): **no authentication yet**. Any client that reaches the API can read every site and send commands. Keep it on localhost or a trusted LAN.
- `/sites` (`POST /sites`, `POST /sites/{id}/devices`, `GET /sites/{id}/measurements`): require a Supabase bearer token (`app/auth.py`) and check `Site.owner_id` (`app/registry.py`). Without a token they answer 401; without `SUPABASE_URL` they fail closed with 503.
- Issue #3 extends verification to `/api/v1`, the WebSocket and commands. Do not add or remove auth on existing routes as a side effect of another issue.
- `/health` (liveness) and `/ready` (database) are public.

## Git

- Branch `feature/<slug>` from `develop`. One issue, one branch, one PR into `develop`.
- PR body uses the template (Change / Verification / Review notes) and says `Closes #N`.
- Conventional commits in English: `feat(api): ...`, `fix(web): ...`, `docs: ...`, `test: ...`.
- Never commit to `main` or `develop` directly. Never commit `.env`, tokens or local tools.

## Checks that must pass before a PR

```
# repository root
npm run lint && npm run typecheck && npm test && npm run build

# services/api
uv sync --frozen --python 3.12
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen mypy app
uv run --frozen pytest -q
```

Database tests are skipped unless `TEST_DATABASE_URL` is set. CI runs them against PostgreSQL 17 together with the
migration round trip (`alembic upgrade head`, `alembic check`, `alembic downgrade base`, `alembic upgrade head`);
run the same locally with `docker compose up -d db` when you touch models or migrations.

After changing dependencies run `uv lock` (or `uv add ...`) and commit `uv.lock`.
After changing a Pydantic contract run `uv run --frozen python -m app.export_contract`.

## Rules

- Do not invent a field, topic or unit. A contract change is its own PR, agreed with the team.
- Watts and watt-hours on every interface, `soc_pct` 0–100, UTC timestamps. Signs as in `docs/contracts.md`.
- Database changes go through a new Alembic revision on the single head; never edit an applied one.
- Device rows must stay readable by the live slice: `kind`, `capabilities` and `limits` use `DeviceKind`,
  `Capability` and `DeviceLimits` from `app/schemas.py`.
- UI text in Bulgarian (team decision). The current dashboard strings are still English.
- No new dependency without saying why.

## Working style

- Small steps. Run the checks. Report what you ran and what you saw, including failures.
- Do not refactor code outside the issue.
- If the issue's acceptance criteria cannot be met in the time left, say which ones and why.
