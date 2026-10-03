# Exhibition usability pass — v0.1.1-demo

Based on Daniel's fullscreen/menu/name-entry feedback and Mitko's information-overload/task-timer feedback. This pass changes presentation and input handling, not energy assumptions, scenario timing, scoring, reference controllers or leaderboard rules.

## Findings and fixes

| Finding / root cause | Fix and validation |
|---|---|
| F11 was behind a gameplay-only early return; focused controls and modal overlays could consume it. | Handle F11 before GUI dispatch on every screen, ignore key-repeat, and retain window mode across screen transitions. Add menu and Settings fullscreen buttons. Export tests exercise menu, name, modes, game, settings, results and leaderboard. |
| Menu preview used a static SiteMap with no activity node. | One cosmetic Node2D draws energy pulses, two slow clouds and a periodic car. Refresh capped at 20 Hz; phase wraps at 600 seconds. It never advances the gameplay model. Reduced ambient disables car/cloud decoration; New Game stays stationary and prominent. |
| Touch name entry depended on LineEdit focus alone, and Windows Godot 4.5 does not implement FEATURE_VIRTUAL_KEYBOARD. | Screen-touch explicitly focuses/edits the field; feature-gated DisplayServer.virtual_keyboard_show uses current text, caret and length. Requests are guarded, and focus exit/screen change hides the keyboard. Larger field/Back targets, Windows help and Use Guest allow a no-typing exhibition path. Physical typing/Enter remain available. |
| Three simultaneous task cards, permanent bill/peak and duplicate battery/climate metrics competed with the site and Opti. | Show two ranked task cards; primary/at-risk cards have stronger treatment. Ready EVs and healthy continuous comfort leave the focus ribbon. Complete task history stays under All tasks. Peak/bill move to grid inspection; battery remains visible on the site and climate in its inspector/tasks. Site dimensions remain dominant. |
| Tasks exposed clock deadlines but no remaining simulated duration. | Countdown plus shrinking bar uses actual model time and current task deadline. Ceil remaining minutes; clamp the bar. Text labels Due in / SOON / ACT NOW / DEADLINE do not rely on color. Grid says Ends in, and comfort has no countdown. Completed/failed/ready tasks stop counting. EV 03 immediately switches from 16:45 to 16:00. |
| Opti repeated task deadlines and targets. | Intro explains shared power and inspecting rates. Revised-departure warning explains reduced charging time and suggests comparing ETA; exact deadline/countdown stays on the task. Reading intervals, pause/speed reduction and recent notes remain intact. |
| Actual simulated touch button navigation produced can_process errors during screen changes. | Hide the old tree immediately and queue_free it at frame end rather than removing it during input dispatch; apply the same retirement to onboarding, inspectors and modal overlays. Real ScreenTouch-to-mouse emulation now traverses screens without those errors. |
| A running review executable caused Godot to leave a temporary executable beside the export. | Close the owned review process, remove its generated file, rebuild. Builder now checks post-export contents; ZIP validation rejects anything other than the four expected player files. |

## Final regression

| Suite | Checks | Failures |
|---|---:|---:|
| Energy simulation | 258 | 0 |
| Prototype | 557 | 0 |
| Demo loop | 171 | 0 |
| Management model | 131 | 0 |
| Exhibition UI | 1079 | 0 |
| Playstyles | 29 | 0 |
| Polish | 40 | 0 |
| New usability suite | 48 | 0 |
| **Total** | **2313** | **0** |

New checks cover global F11 delivery despite focus/Settings, name ScreenTouch focus/editing, one guarded keyboard request, Enter/Guest, simulated touch navigation via Input.parse_input_event and mouse emulation, countdown calculations at 1×/5×/15×, revised departure, completed/failed/comfort states, and 20 repeated attract-menu reentries with bounded phase/nodes and unchanged model time. Polish assertions now expect the revised complementary warning copy; their warning-priority/reading-interval behavior remains tested.

Final complete regression ran with an isolated profile and reported no errors or resource leaks. Earlier sandbox-only runs could not read Windows' certificate store; unrestricted final runs did not emit that environment error. A test cleanup leak was resolved by allowing the audio server to retire playback after freeing the app.

## Rendered review and issue log

Four scripted rendered review passes, 11 styles each: **44 full strategy playthroughs**. Final pass reran all 11 after the screen-lifetime fix and passed **128 checks**. Styles: Naive, Passive, EV-first, Strong, Cost-focused, Chaotic, Comfort-ignoring, Battery-abuse, Late-reaction, Optimizer and Normal-Strong. These are automated strategies, not independent human visitor tests.

Final outcomes: Naive 945; Passive 299; EV-first 536; Strong 955. The final outcomes match the pre-pass baseline; Normal remains €17.961874 / 22.50 kW / 2 ready EVs, reference €10.473692 / 20.00 kW / 3 ready EVs.

Rendered observations/fixes: strengthened timer-bar contrast; removed healthy comfort/ready EVs from the attention ribbon; reset a card's strong background when it becomes a quiet opportunity; shortened duplicate Opti guidance; fixed touch screen-transition errors; rejected stray export artifacts. Reviewed captured revised-departure gameplay at 1280×720, plus menu/game/results/ranking at all target sizes. The highlighted revised EV is immediately clickable and shows ACT NOW and remaining time; ETA remains available in its card/inspector. No claim is made that two-second recognition was measured with visitors.

Three rendered exhibition UI days at 1920×1080, 1366×768 and 1280×720 passed **1099 checks each**. Three-second live samples: **60.5 / 60.4 / 60.5 FPS** respectively, two app root nodes, zero child actor nodes in the single activity renderer. This is a short desktop measurement, not sustained exhibition-laptop validation.

## Exported validation

Final ZIP runs independently of the checkout, using a new extracted temporary directory and isolated AppData. Three complete exported days at all target resolutions; settings/rankings survive reopen. Tests also exercise simulated touch fullscreen → New Game → Guest → Demo → Skip tutorial → Menu → window restore; fullscreen persists between screens. These are three exported touch-oriented navigation loops, not physical touchscreen tests.

Exported checks: **66 + 67 + 67 = 200**, all passing. The package contains exactly OptiMesh.exe, OptiMesh.pck and the two Godot legal notices. Compatibility renderer retained. The stock Windows template still emits its common-controls initialization warning; tested Godot controls work, and no script/resource/audio-leak errors were reported.

Direct native desktop review confirmed the animated normal exported startup at 1366×768 and main-menu F11 expansion to 2560×1440. Concurrent user pointer activity limited further manual navigation; automated exported input checks supply the remaining coverage. No physical touchscreen, OS keyboard popup, sustained tablet performance or subjective audio listening was validated.

Godot's official 4.5 documentation lists virtual-keyboard support for Android/iOS/Web, not Windows: https://docs.godotengine.org/en/4.5/classes/class_displayserver.html#class-displayserver-constant-feature-virtual-keyboard. On Windows, open the system touch keyboard manually or use Guest. Physical hardware must still verify touch targeting, DPI/fullscreen transitions, keyboard layout/focus/hide behavior and audio balance.

## Release

Tag: v0.1.1-demo. Title: OptiMesh Game — Exhibition Demo v0.1.1. GitHub pre-release: https://github.com/DGtao13/OptiMesh-Game/releases/tag/v0.1.1-demo.

ZIP: OptiMesh-Game-v0.1.1-demo-windows-x86_64.zip; **35,129,175 bytes**.
SHA-256: `c4acafc80c0ed6366fd1fabf69d72eb639055a63d4b60a546f992f80e4690150`.

The OptiMesh reference is illustrative, not the production optimization engine. Main/tag are published only after validation; no history rewriting or changes to Praz40/OptiMesh.
