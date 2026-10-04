# Audio provenance

All audio is original and synthesized locally by `scripts/game_audio.gd`. No external recording, commercial music, downloaded sample or third-party asset is used. There are no external source URLs or attribution obligations.

Music: a quiet 32-second looping sequence of sixteen simple tones, fundamental plus a low-amplitude fifth, with note/loop fades. Mono 22050 Hz, 16-bit PCM; about 1.4 MB generated once at application startup. The longer phrase reduces repetition. It continues across menus and repeated games using one player.

Effects: seven short enveloped tones for click, task completion, warning, EV arrival/departure, cleaning and results. Completion/arrival/results rise, departure falls, warning pulses twice, and clicks last 80 ms. Repeated warnings have a two-second cooldown. Buttons play their click before their action; a click cannot interrupt an active event cue. One effects player prevents layers accumulating. They are subtle cues rather than recorded vehicle/office sounds.

Music/effects percentages, a Test sound button and mute are available from Settings and persisted with the local leaderboard/settings file. Finishing an effects-slider drag previews a completion cue. Muting pauses music and suppresses new cues. Task-completion sounds play when the corresponding note is delivered; cleaning no longer announces completion twice. On shutdown a paused music stream is resumed before stopping/releasing it, allowing Godot's audio server to retire its playback buffer; this removed the observed intermittent ObjectDB leak in final validation.

Sound files are not stored in the repository; synthesis introduces no asset licensing dependency. Audio controls, routing and playback were exercised during rendered runs. Final perceived loudness, cue distinction and music repetition still need listening on the exhibition laptop speakers; this pass does not claim subjective listening verification.
