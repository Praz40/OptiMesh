# Developer playtest review — October 2026

**Historical report from before baseline `62a2bfa`.** Counts, timings, scores and fixes below describe that earlier pass, not the current build. The current refinement and fresh evidence are in **POLISH_REVIEW.md** and **VALIDATION.md**; current rules are in **SCENARIO.md**. In particular, rule-2 hard caps below have been replaced by rule-3 service factors, and EV 03 now leaves at 16:00.

The goal was first-time comprehension and a site-focused exhibition game, without adding management systems. Review used the actual rendered main scene, controls, complete scenario, audio enabled, nine screenshots per strategy and message/result journals. Strategies execute in one-minute decision steps faster than wall-clock exhibition pace; this is developer input automation and visual review, not a claim of a human usability or listening study.

## Iteration log

1. **Before: six complete rendered runs at 1920×1080.** Naive follows only current visible Opti instructions; EV-first charges every car Fast; cost-focused minimizes spending even at the expense of comfort; chaotic delays EVs and misuses battery/climate; passive takes no action; strong reacts to live energy/deadline information without knowing the surprise in advance.
2. **Layout/guidance: six complete rendered runs at 1366×768.** Inspected clouds, maintenance, changed deadline, grid challenge and results. Compared scores, task reasons, messages and selected-object panels with the first round.
3. **Refinement: six complete rendered runs at 1920×1080.** Added service score caps, concrete result coaching, preserved/versioned ranking and moved right-side equipment inspectors to the left. Rechecked failure and success screens and feedback.
4. **Final regression: six complete rendered strategies at each of 1920×1080, 1366×768 and 1280×720.** Also full exhibition UI playthrough, repeated-session stress runs and preserved legacy suites at each size. Main strategy review totals **36 complete rendered Demo runs**; stress/headless/model/reference runs are additional and excluded from that count.

| Priority / category | Observation before | Fix / review after |
| --- | --- | --- |
| High · visual hierarchy | Permanent panels squeezed the map to 966×434 logical pixels, about 20% of screen area. Cars and activity were background decoration. | Site now 1753×787, about 67% of screen area and 3.3× the previous area. Compact top HUD/ribbon, task drawer, contextual inspector and temporary Opti leave cars/office prominent. Map vectors retain their proportions. |
| High · fairness / feedback | Naive and strong players failed grid task after only 2.7/1.9 minutes overload; warning waited until the irreversible failure. A resolved task showed current power instead of why it failed. | Immediate warning, five-minute total recovery budget, live budget in HUD, actual overload duration in resolved task and explanation. Sustained 15-minute overload still fails. |
| High · clarity / guidance | Cost-focused generated 235 message changes; strong 109. Routine control feedback displaced events. Open-system/Got-it discarded pending notices. | Numeric consequences stay in inspector. Opti prioritizes events, once-per-condition hints and real recovery. Opening/acknowledging a tip keeps unseen messages. Cost-focused now changes messages 36 times; strong 27. |
| High · balance / results | Cost-focused comfort was 43%, yet scored 650, equal to EV-first with 100% comfort. Passive scored 600. Generic failure advice always suggested charging deadlines, even for comfort. | Severe comfort caps at 400; missed EV caps depend on ready count; below-target comfort caps at 700. Results use actual weakest service and retry advice plus computed spending comparison. Ranking isolates new rules without overwriting old records. |
| Medium · discoverability / controls | Wash was available only through its task. Monitoring objects offered pointless modes. Finished EV controls still suggested action. | Added code-drawn wash equipment and map pick/label. Monitoring-only inspectors have no modes. Finished/departed EV and unavailable cleaning/wash controls are disabled. |
| Medium · pacing | Calm intervals gave little preparation guidance. Repeated control acknowledgments crowded meaningful opportunities. | Upcoming deadline ribbon and reserve/price opportunities; ETA risk, heat, dirty panels and latest wash start hints; optional 5× final hour. Kept deterministic timestamps and roughly eight-minute Demo duration so new players retain thinking time. |
| Medium · audio | Click after callback could replace completion/cleaning; short loop repeats frequently. | Click ordering and interruption guard, distinct rising/falling/pulsed cues, repeated warning cooldown, 32-second music phrase. Actual output enabled during strategy runs; perceptual speaker listening remains a manual check. |
| Medium · final visual review | Expanded score explanation touched its dismiss button; a focused task used pale text on a pale background. | Smaller score-help type leaves a clear gap; explicit focus text contrast keeps the selected task readable. Affected rendered UI suite repeated at all three sizes. |

## Strategy outcomes

| Strategy | Before score | Final score | Cost | EV ready | Comfort | Wash / grid |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Naive, follows visible advice | 874 | 945 | €16.06 | 3/3 | 100% | Done / met |
| EV-first | 650 | 650 | €15.62 | 3/3 | 100% | Missed / met |
| Cost-focused | 650 | 400 | €9.65 | 3/3 | 43% | Done / met |
| Chaotic | 231 | 231 | €12.45 | 0/3 | 58% | Missed / exceeded |
| Passive | 600 | 500 | €16.80 | 2/3 | 100% | Missed / exceeded |
| Strong, reacts to live data | 885 | 955 | €11.03 | 3/3 | 100% | Done / met |

Examples: naive play can now recover when grid crosses 18 kW rather than discover failure afterward. Cost play's cheap bill now explicitly says comfort was only 43% and recommends cooling before 25°C. Passive play receives the wash reminder with remaining runtime and latest start, and EV-risk hints with a link to the actual controls. Strong play meets services and beats naive spending, while the reference's 20 kW peak leaves a meaningful retry goal against its 28 kW peak.

The first-time style is a simulated persona, not proof that real visitors will follow every instruction. Its success assumes it responds to a visible cue. Deadlines remain the main source of decisions; a real first-time observer may still need tuning of the tutorial or last hour. No new ambient simulation was added: existing bounded cars, people, clouds, birds and energy flows are easier to see because the map is larger and the panels collapse. Inspectors avoid covering selected right-side equipment.

## Remaining checks

One real first-time visitor should complete an eight-minute Demo without coaching, and the exhibition laptop needs sustained frame-rate/scaling and speaker-volume/repetition checks. The tools exercise real audio playback but do not let the developer hear the physical speakers. See VALIDATION.md for exact regression counts and desktop frame sample. No claim is made that automated strategies establish subjective fun.
