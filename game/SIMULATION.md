# Legacy energy-core specification

This documents the preserved original scenario used by `scenes/legacy_regression.tscn`. The playable exhibition game extends this core; its actual HVAC, multiple EVs, weather, tasks, score and comparison assumptions are in **SCENARIO.md**. All numbers are illustrative, not live measurements.

## Architecture and units

`scripts/energy_simulation.gd` is a Godot-native `RefCounted` model, independent of scene nodes, rendering and wall-clock time. It owns simulated minutes after midnight, current kW, €/kWh, cumulative kWh/cost, battery energy/intent, and EV energy/intent/departure records. `advance(simulated_minutes)` is the sole progression entry point. `reset()` restores all owned state.

`scripts/main.gd` translates real frame seconds to simulated minutes using the existing 1×/5×/15× controls. 1× = one simulated minute per real second. The model owns pause and day completion; pause advances nothing. Explicit control changes while paused may change intent/current power, but not time, energy or accumulated cost. UI labels observe the model at 5 Hz and immediately after control actions. Inspector values update in place, preserving focus/selection.

`scripts/site_catalog.gd` owns presentation metadata and placeholder readings. The map has no simulation logic. There are no autoload singletons, timers driving a second clock, physics, random inputs, services or future-system scaffolding.

## Scenario

Office day: **08:00–18:00**. Demand and clear-day AC solar are piecewise linear between these knots:

| Time | Building kW | Solar kW |
| --- | ---: | ---: |
| 08:00 | 8 | 4 |
| 09:00 | 14 | 12 (interpolated) |
| 10:00 | 18 | 20 |
| 12:00 | 20 | 30 |
| 13:00 | 15 | 31.5 |
| 14:00 | 19 | 28 |
| 16:00 | 17 | 15 |
| 17:00 | 13 | 8.5 (interpolated) |
| 18:00 | 8 | 2 |

The demand curve includes aggregate office electrical services; HVAC is not modeled separately. Demand falls at lunch and near closing. The installed solar capacity is **35 kWp**, with a **31.5 kW** clear-day AC peak. Inverter/conversion losses are already folded into the AC curve; no additional inverter efficiency multiplier is applied. Solar capacity overrides scale this baseline proportionally. Default daily building consumption is **161 kWh**; solar generation is **194.5 kWh**.

Import tariff periods are start-inclusive/end-exclusive:

| Period | €/kWh |
| --- | ---: |
| 08:00–11:00 | 0.18 |
| 11:00–15:00 | 0.10 |
| 15:00–17:00 | 0.32 |
| 17:00–18:00 | 0.24 |

Export earns **€0.00/kWh**. Imports and exports accumulate separately; export does not offset the bill through net metering. There are no demand charges, peak penalties or enforced grid connection limits. Peak observed grid import is recorded for future use but is not a score.

| Equipment assumption | Value |
| --- | --- |
| Site battery capacity | 50 kWh |
| Initial battery energy / SoC | 32 kWh / 64% |
| Default battery intent | Hold |
| Charge / discharge AC limit | 15 / 15 kW |
| Battery charge / discharge efficiency | 95% / 95% (90.25% round trip) |
| EV 01 battery capacity | 60 kWh |
| Initial EV energy / SoC | 22.8 kWh / 38% |
| EV target | 80% (48 kWh) |
| EV departure | 12:30 (preserved from the visual prototype) |
| Default EV intent | Normal |
| EV Pause / Low / Normal / Fast AC power | 0 / 3 / 7 / 11 kW |
| EV charger/vehicle maximum | 11 kW |
| EV charging efficiency | 90% |

Battery Charge/Discharge request their full limits until full/empty; Hold requests zero. Discharge may export to the grid. There is no intelligent control or solar-only charging rule. Stored battery energy gains `AC_charge_kW × hours × 0.95` or loses `AC_discharge_kW × hours / 0.95` and stays within 0–50 kWh.

EV energy gains `AC_charging_kW × hours × 0.90`. It stops at the configured target (clamped to 0–100%) or exactly at departure. It cannot exceed capacity. Departure SoC and `ev_departed_below_target` are recorded; departure is permanent until reset. Changing a departed EV's intent does not restart charging. ETA uses remaining target energy and the current rate/efficiency, rounds up to the next displayed minute, and explicitly indicates when completion would be after departure. ETA is unavailable while paused by charger intent, after target attainment or after departure. Clock pause preserves the simulated-time ETA.

Normal reaches the default EV target at **12:00**, Fast at approximately **10:32:43** (displayed 10:33). Low reaches only **58.25%** by departure if used all morning.

Profiles, tariff and `DEFAULTS` live at the top of `energy_simulation.gd`. A constructor dictionary can override equipment assumptions for tests or a later scenario. There is no scenario editor or configuration UI in this milestone.

## Balance and integration

All current powers are measured on the **AC side**. Grid positive means import, negative means export. Battery positive means charging, negative means discharging:

`grid_kW = building_kW + EV_kW + battery_kW − solar_kW`

Integration subdivides only where a profile knot, tariff change, battery bound, EV target or departure occurs. Within a segment, demand/solar/grid power are linear and device power/tariff are constant. Trapezoid integration gives exact linear energy. Import/export integrate the positive/negative parts separately, splitting their areas at zero crossings. Cost applies the segment's import tariff and the zero export tariff. This avoids ordinary frame-step/Euler drift and tariff-boundary dependence without a fixed-step accumulator or a second clock. Tests compare large steps, minute steps, 0.25/0.1 minute steps, 1/60 minute steps and irregular subdivisions at identical control-change times, with **1e-7 absolute tolerance**.

The instantaneous site snapshot is:

`100 × min(local_supply, consumption) / consumption`

where `consumption = building + EV + max(battery_power, 0)` and `local_supply = solar + max(−battery_power, 0)`. It is capped at 100%; zero consumption yields 0%. This is the **local supply share**, including battery discharge and battery charging demand. It does not trace whether stored energy originally came from solar or the grid, and is not a renewable percentage or final score.

With default controls left unchanged all day, independent integration predicts **28.988636 kWh imported**, **34.488636 kWh exported**, **€6.028864 energy cost**, **11 kW peak import**, battery **64%**, and EV **80%** at departure.

At 18:00 progression freezes and the UI opens results from the preserved model: actual cost, import/export, peak import, generated solar, final battery SoC, EV requirement result and departure SoC. Local supply is explicitly the instantaneous 18:00 reading, not a daily renewable metric or score.

Reset Day restores all initial energies, default intents, counters, departure flags, time and UI speed to 1×. Completed guidance stays completed; active guidance keeps the reset clock paused. Play Again starts the complete scenario and introduction again. Main Menu retains the entered player name.

## Guidance and departure presentation

The clock waits during onboarding. Continue opens the action-driven sequence: inspect building/solar/grid, choose an EV 01 charging mode, try a battery mode, then acknowledge price planning. Actions use the existing real controls; guidance does not calculate or change energy itself. Skip is available throughout. Completing or skipping guidance resumes the day. The persistent objective shows EV 01's requirement, then its actual departure result. Upcoming sorts the remaining EV deadline and tariff transitions by simulated time.

At departure, the model's existing target flag and recorded SoC drive a prominent ready/missed message. The map empties bay 01 and moves a drawn vehicle out to the bottom road and through the right exit over six real seconds. This cosmetic animation runs independently of simulation speed/pause; it changes no model values. Reset restores the parked car. Selecting the empty charger still shows departed status.

## Scope limits

HVAC and EV 02/03 are visually interactive placeholders and contribute no separately controlled power. View/forecast/diagnostic/schedule buttons retain presentation intent only. No automated optimization, scoring, comparison baseline, random events, weather variation, multiple simulated EVs, save/load, networking or hardware integration is included. The energy model and its independent regression tests are unchanged by the guided demo milestone.
