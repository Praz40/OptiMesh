# Contributing

## Branches and pull requests

- `develop` is the integration branch; `main` holds what has been released for a demo. Nobody pushes to either directly, and nobody force-pushes a shared branch.
- Pick one issue (#2–#18). Branch `feature/<slug>` from `develop`, work on that issue only, and open a PR into `develop`.
- Fill in the PR template (Change / Verification / Review notes) and write `Closes #N` for the issue it finishes.
- CI and CodeRabbit run on every PR into `develop`. Merge after CI passes.
- Releases go from `develop` to `main` through a `release/*` PR.

## Commits

Conventional commits in English: `feat(api): ...`, `fix(web): ...`, `docs: ...`, `test: ...`, `chore: ...`.

Never commit `.env` files, tokens, credentials or local tool folders.

## Checks CI runs

From the repository root:

```sh
npm ci
npm run lint && npm run typecheck && npm test && npm run build
```

From `services/api`:

```sh
uv sync --frozen --python 3.12
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen mypy app
uv run --frozen pytest -q
```

With `DATABASE_URL` and `TEST_DATABASE_URL` pointing at a disposable PostgreSQL (`docker compose up -d db`), CI also runs the migration round trip and the database tests:

```sh
uv run --frozen alembic upgrade head && uv run --frozen alembic check
uv run --frozen alembic downgrade base && uv run --frozen alembic upgrade head
uv run --frozen pytest -q
```

## Schema and contract changes

- Database changes are a new Alembic revision on top of the single head (`uv run --frozen alembic heads` must print one revision). Never edit a revision that has been merged.
- Device contracts are the Pydantic models in `services/api/app/schemas.py`. After changing one, run `uv run --frozen python -m app.export_contract` and commit the regenerated `contracts/*.schema.json`. A contract change is its own PR, agreed with the team; `docs/contracts.md` is the reference for hardware.
- After changing dependencies, run `uv lock` (or `uv add ...`) and commit `uv.lock`. Never edit the lock file by hand.
