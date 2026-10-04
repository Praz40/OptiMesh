# Exhibition scenario, accounting and scoring

This is a deliberately simplified deterministic management game, not a building-control or production OptiMesh model. All profiles/tariffs are illustrative. Every comparison uses the same model, initial state and scenario events; no final result numbers are hard-coded.

## Scenario timeline

| Time | Event / decision |
| --- | --- |
| 08:00 | EV 01 present at 38%; target 80%, leaves 12:30. Battery starts at 64%. Tutorial pauses time. |
| 09:00 | Occupied-office comfort introduced; aim for 20–25°C for at least 95% of the day. |
| 10:00 | Cloud-front forecast. |
| 10:30 | EV 02 arrives: 70 kWh, 30% → 80%, leaves 16:30. |
| 11:00 | Price drops €0.18 → €0.10/kWh. Equipment-wash task opens. |
| 11:30–12:15 | Cloud front multiplies actual solar by 0.4. |
| 12:30 | EV 01 leaves; its actual SoC determines success. |
| 13:00 | Dust cuts panel output by 25%; clean before 15:00. |
| 13:30 | EV 03 arrives: 45 kWh, 35% → 75%, initially leaves 16:45. |
| 14:30 | Surprise: EV 03 departure moves to 16:00. The task and inspector update. |
| 15:00 | Price rises to €0.32/kWh; wash/cleaning deadline. |
| 15:30–16:15 | Keep actual grid import ≤18 kW. Five total simulated minutes above the limit is a recovery budget; exceeding it fails the task. |
| 16:00 | Visitor leaves on revised schedule. |
| 16:30 | EV 02 leaves. |
| 17:00 | Price €0.24/kWh; remaining office management. |
| 18:00 | Freeze model; calculate score, comparison and local rank. |

`demo_scenario.gd` contains the event timeline/messages/object links and additional vehicle definitions. `management_simulation.gd` applies events and owns task states, device behavior and accounting. Presentation observes it; actor animation cannot change energy. Scenario numerical rules are simple constants in these two files rather than an editor framework. Events are delivered once even when a large advance crosses several events.

## Energy and comfort

The preserved core supplies piecewise-linear demand/solar profiles, tariff, EV 01, battery limits/efficiencies and exact import/export zero-crossing integration. Full legacy assumptions remain in SIMULATION.md.

All EVs default to Normal, use 90% charging efficiency and Pause/Low/Normal/Fast = 0/3/7/11 kW, capped at their configured 11 kW limits. They consume no power before arrival, stop at their targets, and permanently disconnect at departure. EV 01 remains 60 kWh, 38% initial, 80% target; its optional `ev_arrival_minute` configuration defaults to 08:00. Later arrival/departure records use the same stored-energy principles. Normal alone cannot meet EV 03's revised deadline; reacting at 14:30 can.

The existing building profile contains aggregate services. The extended model subtracts a fixed **4 kW climate allowance**, then adds actual climate power and the wash. Other office demand follows the original profile; no extra occupancy power is added. This avoids double counting HVAC.

Outside temperature interpolates 24°C at 08:00, 34°C at 14:00, 27°C at 18:00. Inside starts at 22°C. Eco/Normal/Boost consume 1.5/4/7 kW. The simplified temperature derivative in °C/min is `(outside − inside) × 0.003 + 0.012 − HVAC_kW × 0.009`. Cooling stops below 21°C. The derivative is held on an absolute quarter-minute lattice, or recalculated when HVAC mode changes. Temperature evolves linearly within each interval; comfortable duration is integrated at exact 20/25°C crossings. This is an illustrative thermal approximation, not a calibrated building model.

The wash consumes 6 kW for 60 accumulated simulated minutes between 11:00–15:00. Run/Pause retains progress, and completion/deadline stops power. Solar cleaning costs €2, takes 15 minutes completely offline, then removes the dust multiplier. Late cleaning still restores panels but cannot retroactively complete the deadline task or earn its points. Clouds and dirt multiply the existing clear-day AC curve.

Integration splits at the absolute quarter-minute lattice plus EV target, battery bound, wash completion and cleaning boundaries. Device power/thermal slope are constant within a segment; base demand/solar are linear. AC power/energy/cost balance retains exact trapezoid/zero-crossing accounting for this model. Tests compare full-day and controlled schedules using large, minute, 0.1, frame-sized and irregular steps, including fractional-minute cleaning, at 1e-6 tolerance.

Cost is grid energy cost plus maintenance cost. Export earns zero. The displayed solar-use proxy is `clamp(100 × (generation − grid export) / generation, 0, 100)`; it does **not** trace battery provenance or claim a renewable fraction. Battery cycling = total AC charge+discharge throughput / (2 × 50 kWh). Initial stored energy has no purchase cost and final energy has no financial credit; all runs share the same initial battery.

## Score: 0–1000

Service points: 150 per EV meeting its actual departure target (450 total), 1.5 × comfortable-time percentage (150), completed wash 100, grid compliance 70, cleaning completed by 15:00 30.

Efficiency points:

- Cost: `80 × clamp(1 − total_cost / 45, 0, 1)`.
- Peak: `50 × clamp(1 − peak_import / 60, 0, 1)`.
- Solar-use proxy: `50 × utilization / 100`.
- Battery: `20 × clamp(1 − equivalent_cycles / 3, 0, 1)`.

Apply a service factor to the unrounded base points, then round once. Zero/one/two ready EVs retain **40% / 45% / 50%**. Comfort below 80% retains **40%**, or below the 95% target retains **70%**. An unfinished wash retains **65%**. Apply the lowest factor once, not their product. Scoring rules **3** replace the previous hard caps: recovering a wash or grid challenge after missing a car now earns points instead of disappearing under the same cap. Severe service failures still prevent high scores. Results show the approximate base points, factor, final score, actual failure and retry advice. EV/task status remains independent of score.

## Normal baseline and reference controller

`reference_runs.gd` actually simulates both full days in one-minute control intervals.

**Normal operation:** EVs charge Normal whenever connected; HVAC stays Normal; battery stays Hold; wash starts at 14:00; panels are not cleaned. It responds to no price/weather/grid forecast. All scenario events still occur, including the revised visitor departure.

**OptiMesh demo:** an offline forecast-aware heuristic, explicitly not the production algorithm or a proof of optimality. It cleans dust on discovery, runs the wash after the cloud front at 12:15, selects cooling from measured temperature, and chooses EV rates from remaining energy/deadline with a 15-minute buffer. It learns the revised visitor deadline only at the same 14:30 event as the player. It charges the battery during surplus where that does not push import above 18 kW, and discharges during clouds, high prices or high demand, retaining roughly 12% reserve. Commands at each minute are simultaneous policy decisions; transient trial settings do not count as real peaks. Integration between decisions is the identical model used for players.

Validated reference: all three EVs, wash, comfort, cleaning and grid requirement met. Default operation misses the revised visitor and maintenance/grid requirements. Exact metrics come from the run, and change if the model/scenario/policy changes. Player results need not beat or match the reference.

## Persistence and reliability

`local_store.gd` writes `user://exhibition_v1.json`: bounded top-50 entries (name, score, cost, EV count, mode, timestamp), music/effects volume, mute and ambient toggle. Standard Windows location: `%APPDATA%\Godot\app_userdata\OptiMesh Game\`. Test runs redirect AppData into ignored `.tools/profile` and use separate test files.

Current scoring-rule entries rank by score descending, then cost ascending. New entries carry `rules: 3`; older entries stay in the bounded file but do not compete on the current leaderboard. Current entries take priority when truncating to 50. Demo and Normal share the scenario and score, with mode shown. One completed player session creates one entry; comparison runs do not enter the board. Invalid/corrupt files fall back to defaults, malformed entries are filtered, and a storage failure leaves the game playable and reports that persistence failed. Temporary-file replacement avoids partially written JSON.

Administrator reset requires Ctrl+Shift+Delete on the leaderboard and explicit confirmation; settings are preserved. There is no account, LAN synchronization or server. Menus/retry replace one UI subtree. Two audio players persist for the app; activity actors are bounded drawing operations. Audio playback is stopped/released at shutdown.
