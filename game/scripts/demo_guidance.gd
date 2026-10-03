extends RefCounted
## Small action-driven onboarding state; no timers or energy calculations.
enum Step { INTRO, SITE, EV, BATTERY, PLANNING, COMPLETE }
var step := Step.INTRO

func begin() -> void:
	step = Step.INTRO

func continue_intro() -> void:
	if step == Step.INTRO: step = Step.SITE

func inspected(id: String) -> void:
	if step == Step.SITE and id in ["building", "solar", "grid"]:
		step = Step.EV

func controlled(id: String) -> void:
	if step == Step.EV and id == "ev_1": step = Step.BATTERY
	elif step == Step.BATTERY and id == "battery": step = Step.PLANNING

func finish() -> void:
	if step == Step.PLANNING: step = Step.COMPLETE

func skip() -> void:
	step = Step.COMPLETE

func active() -> bool:
	return step != Step.COMPLETE

func target_object() -> String:
	match step:
		Step.SITE: return "building"
		Step.EV: return "ev_1"
		Step.BATTERY: return "battery"
	return ""

func instruction(soc: float, target: float, departure: String) -> String:
	match step:
		Step.INTRO: return "Welcome! Learn the controls before your office day begins."
		Step.SITE: return "1/4 · Building uses power; solar supplies it; the grid balances the rest. Inspect one."
		Step.EV: return "2/4 · EV 01 is at %.0f%%. Reach %.0f%% by %s or miss the requirement. Open it and choose a mode." % [soc, target, departure]
		Step.BATTERY: return "3/4 · Charge stores, Hold waits, Discharge supplies the site. Plan around solar/price; open it and try a mode."
		Step.PLANNING: return "4/4 · Grid price: €0.10 from 11:00, €0.32 from 15:00. Watch solar, the EV deadline and grid use together."
	return "Tutorial complete. Meet the EV deadline, then watch cost and peak grid use."
