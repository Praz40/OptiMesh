# Database

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
