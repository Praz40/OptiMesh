# Authenticated provisioning and history (`/sites`)

The live slice under `/api/v1` does not check tokens yet (issue #3). The routes in this section do.

Set `SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co` in services/api/.env to the same project as the database. The backend verifies access tokens against that project's public signing keys, requiring ES256 or RS256, a valid signature, the project issuer, the `authenticated` audience and role, an unexpired token and a UUID subject. Legacy HS256 tokens are rejected. No service-role key or shared JWT signing secret is needed. Missing configuration or an unavailable signing-key provider fails closed with 503; missing or invalid credentials receive 401.

Run `uv sync --frozen` and `uv run --frozen alembic upgrade head` from services/api for your development database. Revision 0002 adds the device `limits` column (with commands and extra measurement fields); revision 0003 requires `limits` to be a JSON object and extends the history indexes with the measurement ID. Existing rows receive empty limits; no device-specific bounds are invented.

Send a Supabase user access token as `Authorization: Bearer <access_token>`, or use **Authorize** in http://127.0.0.1:8000/docs. The REST authorization policy is ownership: the verified token subject must match `Site.owner_id`. Memberships, role delegation and login UI remain part of issue #3.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | /sites | List the current user's sites |
| POST | /sites | Create a site owned by the current user |
| GET | /sites/{site_id}/devices | List the devices of an owned site |
| POST | /sites/{site_id}/devices | Provision a device |
| GET | /sites/{site_id}/measurements | Read bounded measurement history |

`GET /sites` and `GET /sites/{site_id}/devices` return only the current user's sites and devices. Live readings, the energy summary and commands stay under `/api/v1` (`GET /api/v1/sites`, `GET /api/v1/sites/{site_id}`), which is not authenticated yet and lists every site.

`GET /sites` answers 200 with a JSON array of the sites the user owns, newest first (`created_at` descending, then `id`), or `[]` when there are none. Each item has the same shape as the `POST /sites` response:

```json
{
  "id": "5e000000-0000-4000-8000-000000000002",
  "owner_id": "0a000000-0000-4000-8000-000000000001",
  "name": "Office",
  "timezone": "Europe/Sofia",
  "currency": "EUR",
  "created_at": "2026-10-01T10:00:00Z"
}
```

`GET /sites/{site_id}/devices` answers 200 with a JSON array of the site's devices ordered by `name`, then `id` (the `/api/v1` snapshot also orders by name), or `[]` for an owned site without devices. Each item has the same shape as the `POST /sites/{site_id}/devices` response; `limits` lists only the configured bounds and is `{}` when none are set:

```json
{
  "id": "de000000-0000-4000-8000-000000000002",
  "site_id": "5e000000-0000-4000-8000-000000000001",
  "name": "Battery",
  "kind": "battery",
  "source": "simulator",
  "capabilities": ["measure_power", "battery_soc", "power_setpoint"],
  "limits": {"min_power_w": 100.0, "max_power_w": 2000.0, "capacity_wh": 10000.0},
  "created_at": "2026-10-01T09:00:00Z"
}
```

Both lists are complete, without pagination. Another user's site and an unknown site return 404.

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

The limits above are example configuration values, not hardware specifications. `kind`, `capabilities` and `limits` use the device contract types in `app/schemas.py` (`DeviceKind`, `Capability`, `DeviceLimits`), so every provisioned device is readable by `/api/v1`. Bounds are optional; power bounds are finite, non-negative W, `capacity_wh` is positive, and a configured minimum must not exceed its maximum. Unknown fields, duplicate/unknown capabilities, unknown kinds and invalid sources are rejected. A site created with `POST /sites` is in `GET /api/v1/sites` at once. A device provisioned with `POST /sites/{site_id}/devices` is in the next `GET /api/v1/sites/{site_id}` snapshot at once, offline until its first telemetry (the snapshot's device list is cached per API process, and the API runs as one process).

History requires timezone-aware `start` and `end` query parameters, normalizes them to UTC and uses the half-open interval `[start, end)`. The maximum window is 30 days. `limit` defaults to 100 and accepts 1–500; `device_id` optionally narrows the query to a device belonging to the site. For example: `/sites/{site_id}/measurements?start=2026-10-01T00:00:00Z&end=2026-10-02T00:00:00Z&limit=100`.

Responses contain `items` and `next_cursor`. Follow a non-null cursor using the same site, device and time bounds; the page size may change. Ordering is ascending by `observed_at` and then `id`, so equal timestamps paginate without duplicates. Cursors are validated pagination positions, not authorization credentials or a snapshot of concurrent ingestion.

An authorized empty history returns 200 with an empty page. Missing, foreign and site/device-mismatched resources return 404 to avoid exposing another user's data. Invalid input returns 422; database failures return 503 without internal details.
