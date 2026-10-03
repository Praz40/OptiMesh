# Frontend, simulator and insights: handoff

> **Status note, 03.10.2026.** The document below is kept as it was written. This note says what has changed since.
>
> - Branch `claude/focused-ptolemy-g292a4` was merged into `develop` through PR #28 (merge commit `396fa46`) and then deleted. `feature/forecast-tariff` was merged through PR #30.
> - `develop` has the live slice from #21: PR #23 brought `main` into `develop`. The second half of item 5 in "Next steps" (`main` or `develop`) no longer applies; PRs go into `develop` ([CONTRIBUTING.md](../CONTRIBUTING.md)).
> - Test counts on `develop` at `26507b4`: `npm test` 150 passed in 19 files; `pytest` 237 passed and 45 skipped without `TEST_DATABASE_URL`, and 307 passed in CI with PostgreSQL. The 74 and 52 below are from the time of writing.
> - The game's results in section 2, checked against `apps/web/src/sim/*.test.ts`. Covered by tests: Autopilot charges 10/10 cars on time and keeps import at or below 22 kW (seeds 7, 1, 42); the simple rules peak above 28.6 kW, which is 1.3 × 22 kW (same seeds); Autopilot's battery-adjusted cost is lower than the simple rules' (no amount is checked); the simple rules charge 7/10 cars on time (seed 7). Not covered by any test: the simple rules' "32–35 kW" peak and the "9–11 % lower" cost.
> - No test validates the game's telemetry export against `app.schemas.Telemetry`. `telemetry.test.ts` checks, in TypeScript only, one message per device per interval (60 × 7 = 420 for the Office scenario), the allowed keys, `version`, `site_id`, a UUID v4 `message_id`, the timestamp format and non-empty metrics. The "420/420 messages" in section 2 is not reproduced by any command or test in the repository.

State of the web app, the scenario simulator and the started forecast/cost/recommendation work, for whoever continues it. Everything below is on branch `claude/focused-ptolemy-g292a4`, one commit per area.

| Commit | Issue | Status |
|---|---|---|
| `feat(web): app shell, live dashboard and site switching` | #7, #17 (partly) | Done, tested |
| `feat(web): office scenario simulator with Autopilot comparison` | #11, #14 | Done, tested |
| `fix(simulator): run the MQTT client on a selector loop on Windows` | none | Done |
| `feat(api): tariff, forecast, cost and recommendation modules` | #12, #10 (backend half) | Routed by `feature/forecast-tariff`, see section 3 |

Checks at the time of writing: `npm test` 74 passed, `npm run lint`, `npm run typecheck` and `npm run build` clean; backend `ruff`, `ruff format --check`, `mypy app` clean and `pytest` 52 passed. The dashboard was verified in a browser against the real API, PostgreSQL, MQTT broker and Python simulator: command round trip, site switching, API restart and reconnect, mobile width and dark mode.

## Run it

Same as the README (database, broker, API, `python -m app.simulator`, `npm run dev`). Then:

- http://localhost:3000: portfolio
- http://localhost:3000/sites/5e000000-0000-4000-8000-000000000003: Office dashboard
- http://localhost:3000/simulator: the game (needs no backend at all)

On Windows keep `--reload` on the API command (see README).

`next dev` writes `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`, and builds touch `apps/web/next-env.d.ts`. They are not part of these commits; decide as a team whether to commit them.

## 1. Live dashboard (`apps/web`)

### Structure

```text
src/app/layout.tsx                 SitesProvider + AppShell (sidebar, mobile menu)
src/app/page.tsx                   Portfolio
src/app/sites/[siteId]/layout.tsx  SiteLiveProvider keyed by siteId + SiteFrame (header, switcher, tabs)
src/app/sites/[siteId]/page.tsx    Overview      -> components/site-dashboard.tsx
src/app/sites/[siteId]/devices     Devices       -> components/site-devices.tsx
src/app/sites/[siteId]/activity    Command log   -> components/site-activity.tsx
src/hooks/use-sites.tsx            polls GET /api/v1/sites every 3 s, once for the whole app
src/hooks/use-site-live.tsx        one WebSocket per site, commands, 30-min power trend
src/lib/energy.ts                  formatting, flow directions, supply mix, freshness, health
src/lib/trend.ts                   trend buffer + backfill from measurement history
src/components/time-chart.tsx      reusable SVG line/area chart: crosshair tooltip, keyboard, table view
src/components/icons.tsx           icon set and the OptiMesh mark
```

### Data flow

- Portfolio and sidebar share one poll (`SitesProvider`).
- A site's tabs share one WebSocket (`SiteLiveProvider`), so switching tabs does not reconnect. The provider is rendered with `key={siteId}`: switching sites closes the old socket and starts from empty state, so nothing leaks between sites (#17 criterion).
- The 30-minute chart is backfilled on load from `GET /sites/{id}/devices/{device}/measurements` for grid, solar, battery and EV devices, using the backend's balance rule (consumption = grid + solar − battery, unknown when a device is missing in a 10 s bucket), then extended by live snapshots.
- Commands go through `POST .../commands`; a device row shows "Waiting for device…" until the ack arrives over the WebSocket. Controls are disabled for offline devices.

### Design system

All colors are CSS variables in `src/app/globals.css`, with a dark theme under `prefers-color-scheme`. Energy roles are fixed: solar yellow, consumption magenta, grid violet, battery aqua, EV blue, price orange. They were checked with a colour-blindness validator; always pair them with a label or icon, never colour alone. Charts take a `tone` name (e.g. `tone: "solar"` -> `var(--solar)`).

## 2. Simulator (`apps/web/src/sim`, `/simulator`)

Pure TypeScript, no backend, deterministic. That makes it the offline fallback for the demo (#16) too.

```text
sim/scenario.ts   officeScenario(seed): devices = the seeded Office (same UUIDs and limits),
                  30 kW solar, 50 kWh / 25 kW battery, HVAC 2–15 kW, 3 × 11 kW chargers,
                  10 cars with arrival/departure/kWh, ToU tariff, weather from the seed.
                  06:00–21:00 local in 60 UTC quarter-hours. Units W/Wh.
sim/engine.ts     step(scenario, state, controls) -> state. Pure. Energy balance, battery
                  efficiency and SOC limits, charger and car limits, thermal model,
                  export curtailment, events. toSiteSummary() speaks the API's SiteSummary,
                  so EnergyFlow and KPI tiles render the simulation unchanged.
sim/policies.ts   baselinePolicy (first come first served, full power) and autopilotPolicy.
sim/metrics.ts    cost (battery-adjusted), peak, import/export, solar used, battery
                  throughput, cars on time, unserved kWh, comfort °C·h, car moves.
sim/game.ts       game reducer: intro -> manual -> autopilot replay -> results.
sim/view.ts       car status/slack for the UI and the results verdict.
sim/telemetry.ts  exports a run as device contract v1 JSON Lines (validated against
                  app.schemas.Telemetry: 420/420 messages).
components/simulator/*  the UI.
```

**Autopilot** (a transparent heuristic, the bar the optimizer in #13 should beat):

- Cars: each parked car's remaining energy is planned into the cheapest quarter-hours before it leaves, earliest deadline first, within 3 chargers and a 22 kW peak budget per interval. Solar-surplus intervals count at the export price. If a deadline cannot be met within the budget, the deadline wins.
- Short-term solar "nowcast": the next hour follows how the last interval compared to forecast, so clouds do not create peaks.
- Battery: shave import above 22 kW, cover expensive hours, keep a reserve for the evening.
- HVAC: pre-cool on cheap or solar energy, coast in expensive hours, off when the office is empty.

It sees only the day-ahead forecast and the past, never future arrivals or actual clouds.

**Results on three seeds** (7, 1, 42), from the tests:

| | Simple rules | Autopilot |
|---|---|---|
| Cars on time | 7/10 | 10/10 |
| Peak import | 32–35 kW | 22 kW |
| Battery-adjusted cost | baseline | 9–11 % lower |

**Fairness rules** (#14): same seed and inputs for every run; cost adjusted for the battery's final charge at the day's average price; missed charging reported as kWh short; ✓ marks for cost/peak/import only compare runs that charged the most cars, and the verdict leads with missed deadlines.

To swap in a real optimizer: implement `Policy = (scenario, state) => Controls` and add it as a column in `components/simulator/sim-results.tsx`.

## 3. Forecast, costs, recommendations (routed)

Routed in `feature/forecast-tariff` (#12) through `app/insights.py`, which reads the platform and calls the pure modules below. Same rules as the other `/api/v1` routes: no authentication yet (#3), 404 for an unknown site, 503 without a database.

| Route | Response |
|---|---|
| `GET /api/v1/sites/{site_id}/forecast` | `ForecastOut`: 24 hourly intervals from the current local hour, expected solar and load, import/export price, timezone, currency, assumptions |
| `GET /api/v1/sites/{site_id}/costs` | `CostsOut`: today (local day) at the grid meter, per hour and in total, plus the projected day cost |
| `GET /api/v1/sites/{site_id}/recommendations` | `list[Recommendation]`: up to 5 proposed commands; nothing is sent until Assist posts `action` to `/commands` |

- `assumptions`, recommendation `title`/`detail` and the tariff name are Bulgarian; show them verbatim. Rule ids and field names stay English.
- `DEFAULT_TARIFF` is an invented demo time-of-use tariff, not the day-ahead prices `app/sim` replays; the response says so in `assumptions`.
- A new database has no week of history, so the load forecast falls back to the current consumption; `assumptions` says how many hours used which source.
- The 7-day load profile is cached per site for 5 minutes. `/costs` still aggregates today's grid-meter readings on every call, so poll it every 10–30 s, not every second.

The modules behind them, in `services/api/app`, pure and type-checked:

- `tariff.py`: `DEFAULT_TARIFF`, the same time-of-use bands as the simulator (EUR, export 0.06).
- `forecast.py`: `build_forecast(site, devices, tariff, now, load_by_hour)` -> `ForecastOut`, 24 hourly intervals. Solar = clear-sky curve × inverter `max_power_w` × 0.85. Load = past week's mean at that hour, else current consumption. Response lists its assumptions.
- `costs.py`: `build_costs(...)` -> `CostsOut` for the local day. Import energy from the grid meter's `energy_wh` counter per hour (falls back to average power on a counter reset), export from average negative power, priced per hour; projected day cost = so far + forecast net load (battery ignored).
- `recommendations.py`: `recommend(snapshot, tariff, forecast, now)` -> up to 5 `Recommendation`s, each a single command validated with `validate_command`, never for offline devices. Rules: raise EV limit to absorb exported solar, run a switched-off plug/load on surplus, slow EV charging until a cheaper hour, pause the boiler at peak price, trim HVAC at peak price.
- `platform.py`: two read-only queries, `hourly_power()` and `meter_hours()`.
- `schemas.py`: `ForecastInterval`, `ForecastOut`, `CostInterval`, `CostsOut`, `Recommendation`.

## Next steps

1. **Wire the API** (done in `feature/forecast-tariff`, see section 3; kept here as the record of the plan):
   - `forecast(platform, site_id, now)`: snapshot -> `hourly_power(site, tz, now − 7 d)` -> per hour `grid + solar − battery` when all those devices have data -> `build_forecast`.
   - `costs(...)`: grid meter ids from the snapshot, `day_start` = local midnight, `meter_hours(...)` -> `build_costs`.
   - `recommendations(...)`: `recommend(snapshot, DEFAULT_TARIFF, forecast, now)`.
   - Routes in `api.py`: `GET /api/v1/sites/{id}/forecast`, `/costs`, `/recommendations`.
   - Tests: unit tests for `Tariff.import_price`, `hour_energy` (counter, reset, coverage), `build_costs`, each recommendation rule (fires / does not fire, offline device skipped); one integration test that ingests telemetry and reads `/costs`.
2. **Frontend for #12**: add `forecast`, `costs`, `recommendations` to `src/lib/api.ts`; a Forecast tab (expected solar vs load with `TimeChart`, prices as a separate step chart, never on a second axis, assumptions listed); a Costs tab (today so far, by hour, projected day); a "Cost now" KPI tile (`grid_w × current price`). Add tabs in `SITE_TABS` (`components/site-frame.tsx`).
3. **Monitor / Assist / Autopilot (#10)**: a mode switch in the site header, stored per site (localStorage until auth exists). Monitor passes `readOnly` to `DeviceList` (already supported). Assist shows recommendations with an Apply button that calls the existing `sendCommand` and shows the command status. Autopilot stays disabled for hardware with a note linking to the simulator.
4. **#17 leftovers**: membership/auth (#3) and cost totals only over comparable periods and currencies.
5. Confirm the demo tariff with whoever owns tariffs (Mitko), and agree whether PRs target `main` or `develop`: they have diverged (`develop` does not have the live slice from #21).
