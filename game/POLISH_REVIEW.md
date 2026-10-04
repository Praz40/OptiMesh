# Exhibition refinement review — 2026-10-03

Baseline verified: clean `62a2bfa`. This report records fresh evidence from the current pass. Previous reports were historical context, not validation.

## Development rounds and complete playthroughs

Three development rounds: baseline desktop play and diagnosis; guidance/layout/scoring changes followed by replay; deadline/rounding/control-state/reliability refinement followed by final replay and regression.

**34 complete main-scenario playthroughs:** three desktop-interacted days and 31 accelerated rendered strategy replays. The desktop days included periods running while development continued; they are developer review, not uninterrupted visitor usability studies. The rendered scripts route actions through the real scene selection/control handlers and yield rendered frames through the day; they are not human playthroughs. Headless/reference runs, exhibition integration runs and consecutive stress cycles are additional and excluded from 34.

- Desktop 1, baseline 1280×720: full tutorial, first-time / late reaction, 08:00–18:00, 1×/5×/15×. Wash and cleaning completed, EV 03 missed, grid recovered. 500 points, €16.73, peak 39 kW, 2/3 EVs, comfort 100%. Inspector/companion overlap, hidden visitor risk and unhelpful score cap were visible during play.
- Desktop 2, 1366×768: skipped intro, wash at 13:06, late EV response, battery discharge then Hold. 385 points, €13.60, peak 22.5 kW, 2/3 EVs, comfort 100%, wash/grid met. Found a failed EV displayed as 75% / 75% because progress rounded upward; fixed before final review. Results → leaderboard → menu exercised.
- Desktop 3, 1280×720: Final QA, EV 02 Fast, wash, battery discharge during cloud event, focused-button Space pause/resume and speed changes. Later maintenance/EV 03 were neglected during development. 387 points, €14.24, peak 17.7 kW, 2/3 EVs, comfort 100%, wash/grid met. Results clearly explained EV 03 at 70.0% / 75% and the 50% service factor.
- Rendered round 1: ten complete Demo personas at 1280×720, 116 checks, zero failures.
- Rendered round 2: ten complete Demo personas at 1366×768, 116 checks, zero failures.
- Rendered final round: ten Demo personas plus Strong in Normal Mode at 1920×1080, 128 checks, zero failures. Normal and Demo strong policies produce the same scenario outcome despite different wall-clock pacing.

## Issue log

| Priority | Evidence / problem | Resolution and validation |
|---|---|---|
| P1 | First desktop day: revised visitor deadline gave little reaction time; impossible ETA looked neutral. | Departure moved 15:45 → 16:00. Risk appears in ETA, ribbon and bay badge. Late recovery tests succeed when reacting at 15:15, fail at 15:30; boundaries are tested. |
| P1 | First desktop day: visitor hidden behind wash, cleaning and ready EV tasks. | Ribbon sorts by actual risk/urgency; ready cars and already-running work move down. Active visitor remains visible. |
| P1 | First desktop day: recovering wash/grid after missing one EV still ended at the same hard cap. | Rule-3 service multiplier replaces caps. Recovery earns points while serious service failures limit scores. Old ranking entries remain stored but do not compete with rule 3. |
| P1 | Second desktop day: failed car appeared to meet 75% / 75%. | Below-target task/departure percentages floor to one decimal; reached targets show the target. Near-miss regression added. |
| P1 | Desktop controls: Space after clicking a mode could activate that focused button instead of pausing. | Handle transport shortcuts before GUI consumes them; block them under settings/history. Real focused-button pause/resume and regression passed. |
| P2 | First desktop day: clouds skipped at fast-forward; detail always said 1×. | Cloud/tariff/arrival/critical notices return playback to 1× as soon as pending. Clock reports actual speed and game minutes/second; known forecast remains visible. |
| P2 | Live inspectors: companion touched both inspector edges and hid feedback. | Narrowed/moved companion within the central gap; larger text and taller message area. Reviewed at all three sizes. |
| P2 | Notice review: rapid replacement, resolved tasks interrupting urgent warnings, duplicate cleaning completion. | Priority and reading dwell; single cleaning completion; recent six delivered notes pause for rereading; bounded eight-note storage. |
| P2 | Replay: stale cleaning status/feedback after completion; finished EV controls still enabled. | Synchronize selected mode and control availability as model state changes; expire action feedback into live contextual advice. |
| P2 | Passive/battery replay: a seen early hint could starve later useful hints. | Check seen state on each candidate; add battery export and depleted-reserve advice. Regression covers later advice after last-hour hint. |
| P2 | First results: cost dominated service success and penalties were opaque. | Service-first comparison cards; actual weakest-service advice; visible base × service factor; cost bars use actual run comparison. |
| P2 | Baseline shutdown: intermittent ObjectDB audio resource leak. | Verbose probe isolated paused WAV playback; resume before stop/release. Final complete suite and rendered UI shutdowns produced no leak warning. |
| P3 | Inspector: generic control wording; wash waiting/complete ambiguity; EV action hid grid effect. | CHOOSE A MODE, specific wash states/latest restart, HVAC trend, EV power/ETA/grid before→after. |
| P3 | Settings: focused toggle pale text, volume values absent, no cue preview. | Dark focus text, volume percentages, Test sound and effects-slider preview. Rendered and regression checked. |

## Final strategy outcomes

| Persona | Score | Cost | Peak kW | EVs | Comfort | Wash / grid |
|---|---:|---:|---:|---:|---:|---|
| Naive, follows current visible advice | 945 | €16.06 | 28.5 | 3/3 | 100% | Done / met |
| EV-first | 536 | €15.62 | 20.1 | 3/3 | 100% | Missed / met |
| Cost-focused | 347 | €9.71 | 31.0 | 3/3 | 43.1% | Done / met |
| Chaotic | 106 | €14.88 | 40.3 | 0/3 | 100% | Missed / missed |
| Passive | 299 | €17.36 | 22.5 | 2/3 | 100% | Missed / missed |
| Strong | 955 | €11.06 | 28.0 | 3/3 | 100% | Done / met |
| Comfort-ignoring | 348 | €10.83 | 30.5 | 3/3 | 43.1% | Done / met |
| Battery-abusing | 912 | €21.95 | 34.0 | 3/3 | 100% | Done / met |
| Late-reaction | 933 | €14.53 | 38.3 | 3/3 | 100% | Done / met |
| Optimizer | 959 | €11.06 | 22.5 | 3/3 | 100% | Done / met |
| Normal-Strong | 955 | €11.06 | 28.0 | 3/3 | 100% | Done / met |

Cost-focused beats the reference bill (€10.47), but sacrifices comfort. Battery abuse cycles 1.50 equivalents and costs nearly twice Strong; it retains a high service score because it actually meets requirements. Optimizer reduces Strong's peak by discharging during cleaning. These outcomes expose tradeoffs rather than assuming a single optimal route.

## Presentation, audio, reference and performance

The site retains its approximately 67% canvas footprint. New bay/battery status badges connect live state to the world; clouds tint panels even with ambient actors disabled; cleaning shows time remaining; the running wash pulses; evening pedestrians travel outward. No heavy assets, physics or new management systems were introduced. Task/font contrast, tutorials, quiet periods, active inspectors, revised departure, grid challenge, results, ranking and settings were reviewed across 1920×1080, 1366×768 and 1280×720.

Audio controls, mute/unmute, effects preview and actual playback were exercised. Completion cues follow delivered task notes, duplicate cleaning completion was removed, and paused-stream shutdown was fixed. Existing original synthesized music/effects and provenance remain; no external audio was added. Perceived loudness, repetition and cue distinction were not verified by listening to physical speakers.

The reference policy is unchanged: rerunning the real model gives €10.47, peak 20 kW, all services met. Normal operation gives €17.96, peak 22.5 kW, two EVs, wash completed and grid missed. Scenario timing changes affect computed results. The UI explicitly describes the reference as an offline demo heuristic rather than the production optimizer.

Rendered three-second live samples at each resolution reported 60.5 FPS including the initial frame, at the 60 FPS cap, on an AMD Radeon RX 5700 XT. Root nodes stayed at two, audio players at two, activity actor nodes at zero. Activity is bounded direct drawing at 20 Hz; HUD at 5 Hz. Repeated task updates no longer reconnect signals. This is short desktop evidence, not sustained modest-laptop benchmarking.

Each exhibition UI test exercises twelve consecutive stress sessions plus retry/menu/name/ranking/settings/reset flows. Additional polish regressions cover six resets with stable screen/audio counts and cleared message history. Final automated counts and commands are in VALIDATION.md.

## Remaining weaknesses

An independent first-time visitor has not been observed. Automated advice-following assumes the player notices and follows a cue; it cannot prove subjective fun or walk-up comprehension. The final hour has fewer deadlines, with comfort/battery optimization and optional 5× as its main activities. The scenario is deterministic, so repeated expert play will become predictable. Battery cycling currently contributes only twenty direct base points; misuse is penalized mainly through bill/peak, which is deliberate but may merit later visitor feedback. The thermal model and solar-use proxy remain illustrative. Exhibition laptop sustained performance, Windows scaling/fullscreen and speaker listening still require that hardware.

## Why the game is more fun now

The player can see the next decision and its consequence: EV ETA, departure risk, grid impact, climate trend and wash restart time. The visitor surprise has a recoverable response window, and urgent tasks stay visible. Mistakes still leave worthwhile goals because recovery earns points. Opti gives time to read and a way to reread rather than losing the warning. Results lead with services and explain the actual failure, making a retry goal concrete. These are defensible improvements in developer play; independent visitor feedback remains the test of enjoyment.
