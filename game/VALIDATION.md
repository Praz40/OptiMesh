# Validation — refinement from 62a2bfa

Fresh final validation on 2026-10-03. Qualitative issues, direct play and outcomes are in POLISH_REVIEW.md. PLAYTEST.md is an explicitly marked historical report.

## Final full regression

`./Test-Prototype.ps1` with AppData redirected into ignored `.tools/profile` ran all seven suites successfully: **2263 checks, zero failures**.

| Suite | Final headless checks |
|---|---:|
| Original energy model | 258 |
| Preserved prototype | 557 |
| Preserved guided demo | 171 |
| Extended management model | 131 |
| Exhibition scene/UI | 1077 |
| Eleven strategy runs | 29 |
| New polish regressions | 40 |

Final full-suite output is `artifacts/final_regression.log`. No script/runtime or ObjectDB leak warnings occurred in that run. Earlier sandbox certificate warnings were environmental; earlier paused-audio playback leaks were reproduced and fixed.

## Rendered validation

Actual exhibition UI suite: **1097 checks, zero failures at each of 1920×1080, 1366×768 and 1280×720**. Logs: `layout_final_1920.log`, `layout_final_1366.log`, `final_1280.log`. All live samples reported 60.5 FPS over three seconds on RX 5700 XT at the 60 FPS cap. Two root nodes/two audio players remained bounded; activity drawing adds no actor nodes. This does not establish sustained low-power laptop performance.

31 complete accelerated rendered strategy replays: ten Demo strategies at 1280×720 (116 checks), ten at 1366×768 (116), and ten plus Normal-Strong at 1920×1080 (128); all zero failures. Three separate complete desktop-interacted days are recorded in POLISH_REVIEW.md. Regression/reference/stress cycles are excluded from those counts. The first two render batches preceded the last minor control/rounding/shutdown fixes; the final full regression and affected UI reruns validate those fixes.

Reviewed captures cover menu/name/modes, onboarding, quiet site, task drawer, inspectors, cloud/cleaning/visitor/grid events, recent notes, results/scoring, ranking and settings. Captures and journals remain in ignored `artifacts/`. No unresolved clipping was observed in reviewed final frames.

## Coverage and reliability

Preserved independent energy/UI tests retain existing expectations. Extended coverage checks timestep partition invariance, all actual comparison policies, service factors/ranking separation, recoverable late EV decisions, near-miss charge display, focused-button transport keys, notice priority/dwell, history pause/reset, task risk ordering, ETA consistency, control grid effects, expired feedback, automatic mode/control changes, sound preview and later hint delivery.

Each exhibition test completes twelve consecutive stress sessions and retry/menu/name/settings/ranking flows; polish tests add six resets. Screen/audio counts remain bounded, message history resets, and one completed player run creates one ranking entry. Isolated test stores prevent production leaderboard contamination.

Reproduce headless validation with `./Test-Prototype.ps1`. For complete rendered coverage use `./Test-Prototype.ps1 -Capture -Resolution 1920x1080` (or 1366x768 / 1280x720). Godot 4.5+ is required. Current targeted rendered runs use `--script tests/exhibition_test.gd --resolution <size> -- --capture`; the strategy capture batch uses `--script tests/playstyle_test.gd --resolution <size> -- --capture --round=<name>`.

## Practical limits

A real first-time visitor without coaching, sustained exhibition-laptop performance/scaling/fullscreen, and perceived speaker loudness/music repetition remain hardware/usability checks. Actual audio output/control routing was exercised, but subjective listening was not verified. The scenario, thermal model, solar-use proxy and reference remain illustrative and deterministic. Passing assertions alone are not evidence of fun.
