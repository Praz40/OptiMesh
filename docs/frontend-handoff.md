# Frontend, simulator and insights: handoff

State of the web app, the scenario simulator and the started forecast/cost/recommendation work, for whoever continues it. Everything below is on branch `claude/focused-ptolemy-g292a4`, one commit per area.

| Commit | Issue | Status |
|---|---|---|
| `feat(web): app shell, live dashboard and site switching` | #7, #17 (partly) | Done, tested |
| `feat(web): office scenario simulator with Autopilot comparison` | #11, #14 | Done, tested |
| `fix(simulator): run the MQTT client on a selector loop on Windows` | none | Done |
| `feat(api): tariff, forecast, cost and recommendation modules` | #12, #10 (backend half) | **Not routed yet**, see "Next steps" |

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

## 3. Forecast, costs, recommendations (backend started, not exposed)

New modules in `services/api/app`, pure and type-checked, **not yet called by any route**:

- `tariff.py`: `DEFAULT_TARIFF`, the same time-of-use bands as the simulator (EUR, export 0.06).
- `forecast.py`: `build_forecast(site, devices, tariff, now, load_by_hour)` -> `ForecastOut`, 24 hourly intervals. Solar = clear-sky curve × inverter `max_power_w` × 0.85. Load = past week's mean at that hour, else current consumption. Response lists its assumptions.
- `costs.py`: `build_costs(...)` -> `CostsOut` for the local day. Import energy from the grid meter's `energy_wh` counter per hour (falls back to average power on a counter reset), export from average negative power, priced per hour; projected day cost = so far + forecast net load (battery ignored).
- `recommendations.py`: `recommend(snapshot, tariff, forecast, now)` -> up to 5 `Recommendation`s, each a single command validated with `validate_command`, never for offline devices. Rules: raise EV limit to absorb exported solar, run a switched-off plug/load on surplus, slow EV charging until a cheaper hour, pause the boiler at peak price, trim HVAC at peak price.
- `platform.py`: two read-only queries, `hourly_power()` and `meter_hours()`.
- `schemas.py`: `ForecastInterval`, `ForecastOut`, `CostInterval`, `CostsOut`, `Recommendation`.

## Next steps

1. **Wire the API** (planned: an `app/insights.py` beside `platform.py`, because `recommendations.py` imports `platform`):
   - `forecast(platform, site_id, now)`: snapshot -> `hourly_power(site, tz, now − 7 d)` -> per hour `grid + solar − battery` when all those devices have data -> `build_forecast`.
   - `costs(...)`: grid meter ids from the snapshot, `day_start` = local midnight, `meter_hours(...)` -> `build_costs`.
   - `recommendations(...)`: `recommend(snapshot, DEFAULT_TARIFF, forecast, now)`.
   - Routes in `api.py`: `GET /api/v1/sites/{id}/forecast`, `/costs`, `/recommendations`.
   - Tests: unit tests for `Tariff.import_price`, `hour_energy` (counter, reset, coverage), `build_costs`, each recommendation rule (fires / does not fire, offline device skipped); one integration test that ingests telemetry and reads `/costs`.
2. **Frontend for #12**: add `forecast`, `costs`, `recommendations` to `src/lib/api.ts`; a Forecast tab (expected solar vs load with `TimeChart`, prices as a separate step chart, never on a second axis, assumptions listed); a Costs tab (today so far, by hour, projected day); a "Cost now" KPI tile (`grid_w × current price`). Add tabs in `SITE_TABS` (`components/site-frame.tsx`).
3. **Monitor / Assist / Autopilot (#10)**: a mode switch in the site header, stored per site (localStorage until auth exists). Monitor passes `readOnly` to `DeviceList` (already supported). Assist shows recommendations with an Apply button that calls the existing `sendCommand` and shows the command status. Autopilot stays disabled for hardware with a note linking to the simulator.
4. **#17 leftovers**: membership/auth (#3) and cost totals only over comparable periods and currencies.
5. Confirm the demo tariff with whoever owns tariffs (Mitko), and agree whether PRs target `main` or `develop`: they have diverged (`develop` does not have the live slice from #21).
