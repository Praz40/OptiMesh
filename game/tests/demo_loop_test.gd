extends SceneTree
## Guidance, presentation departure and actual-run results integration.
const Guidance = preload("res://scripts/demo_guidance.gd")
var app: Control
var checks := 0
var failures := 0
var capture := false

func _initialize() -> void:
	capture = "--capture" in OS.get_cmdline_user_args()
	call_deferred("run")

func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures += 1
		push_error("DEMO LOOP CHECK FAILED: " + message)

func find_button(node: Node, caption: String) -> Button:
	if node is Button and node.text == caption: return node
	for child in node.get_children():
		var found := find_button(child, caption)
		if found: return found
	return null

func press(caption: String) -> void:
	var item := find_button(app, caption)
	check(item != null and not item.disabled, "usable action " + caption)
	if item: item.pressed.emit()

func click_viewport(point: Vector2) -> void:
	for down in [true, false]:
		var event := InputEventMouseButton.new()
		event.position = point
		event.global_position = point
		event.button_index = MOUSE_BUTTON_LEFT
		event.pressed = down
		root.push_input(event, true)

func snapshot(caption: String) -> void:
	if not capture: return
	await process_frame
	await RenderingServer.frame_post_draw
	var resolution := DisplayServer.window_get_size()
	check(root.get_texture().get_image().save_png("res://artifacts/%s_%dx%d.png" % [caption, resolution.x, resolution.y]) == OK, "capture " + caption)

func bounds(node: Node) -> void:
	for child in node.get_children():
		if child is Control and node is Panel:
			check(child.position.x + child.size.x <= node.size.x + 1, "horizontal bounds %s: %s at %s in %s" % [child.text if child is Label else str(child.name), child.size, child.position, node.size])
			check(child.position.y + child.size.y <= node.size.y + 1, "vertical bounds " + str(child.name))
		bounds(child)

func run() -> void:
	app = load("res://scenes/legacy_regression.tscn").instantiate()
	root.add_child(app)
	await process_frame
	app.player_name = "Alex"
	app.start_demo()
	app.set_process(false)
	check(app.guidance.step == Guidance.Step.INTRO and app.paused, "intro starts with paused clock")
	check(is_instance_valid(app.intro_overlay), "intro is visible")
	click_viewport(Vector2(180, 695))
	check(app.selected_id == "" and app.guidance.step == Guidance.Step.INTRO, "intro blocks unintended map input")
	app.advance_clock(60.0)
	check(app.elapsed_minutes == 480.0 and app.simulation.imported_kwh == 0.0, "onboarding does not consume the deadline")
	await snapshot("guide_01_intro")
	bounds(app.ui)
	press("Continue  →")
	check(app.guidance.step == Guidance.Step.SITE and app.intro_overlay == null, "Continue opens action-driven site step")
	check(app.site.guided_id == "building", "site target is highlighted")
	app.select_object("hvac")
	check(app.guidance.step == Guidance.Step.SITE, "unrelated inspection does not progress")
	app.guide_button.pressed.emit()
	check(app.selected_id == "building" and app.guidance.step == Guidance.Step.EV, "inspect site advances to EV")
	check("38%" in app.assistant_message.text and "80%" in app.assistant_message.text and "12:30" in app.assistant_message.text, "EV guidance explains charge, target and deadline")
	await snapshot("guide_02_ev")
	app.guide_button.pressed.emit()
	check(app.selected_id == "ev_1" and app.guidance.step == Guidance.Step.EV, "opening EV alone waits for a choice")
	app.apply_control("Low")
	check(app.guidance.step == Guidance.Step.BATTERY and app.simulation.ev_mode == "Low", "EV choice is real and advances guidance")
	await snapshot("guide_03_battery")
	app.select_object("grid")
	app.apply_control("Meter")
	check(app.guidance.step == Guidance.Step.BATTERY, "unrelated controls do not progress")
	app.guide_button.pressed.emit()
	app.apply_control("Hold")
	check(app.guidance.step == Guidance.Step.PLANNING, "battery action advances to planning")
	check("11:00" in app.assistant_message.text and "15:00" in app.assistant_message.text, "planning names upcoming tariff periods")
	await snapshot("guide_04_planning")
	press("Got it")
	check(app.guidance.step == Guidance.Step.COMPLETE and not app.paused, "tutorial completes and starts the clock")
	check(not app.guide_button.visible and not app.guide_skip.visible and app.site.guided_id == "", "guide actions/highlight end cleanly")
	check("80%" in app.objective_label.text and "12:30" in app.objective_label.text, "objective persists after tutorial")
	check(app.upcoming_label.text == "11:00 · Price €0.10/kWh", "nearest upcoming tariff shown")
	app.advance_clock(180.0)
	app.refresh_simulation_ui()
	check(app.upcoming_label.text == "12:30 · EV 01 departure", "EV becomes next upcoming item after 11:00")
	# Failure branch: Low throughout gives 58.25% on departure.
	app.advance_clock(90.0)
	check(app.departure_announced and app.departure_outcome == "missed", "failed requirement clearly recorded")
	check(app.simulation.ev_departed_below_target and app.simulation.ev_power_kw == 0.0, "departure stops simulated charging")
	check(is_equal_approx(app.simulation.ev_soc_at_departure, 58.25), "failure uses actual departure SoC")
	check("MISSED TARGET" in app.objective_label.text, "failure remains visible in objective")
	check(app.site.ev_departed_visual and app.site.ev_vehicle_visible, "visual departure starts")
	app.site.set_process(false) # Deterministic presentation checks without wall time.
	app.site.advance_departure_visual(3.0)
	check(app.site.departure_car.position.x > 136.5 and app.site.departure_car.position.y == 530.0, "car follows road toward right exit")
	await snapshot("guide_05_failed_departure")
	app.site.advance_departure_visual(3.0)
	check(not app.site.ev_vehicle_visible and not app.site.departure_car.visible, "car disappears after leaving")
	check(app.site.departure_car.position.x > app.site.ROAD_RIGHT, "car leaves beyond site edge")
	check(app.site.ROAD_RIGHT == 1370.0, "road reaches actual campus edge")
	app.select_object("ev_1")
	check("departed" in app.inspector_values[3].text, "empty charger remains selectable with departed status")
	await snapshot("guide_06_empty_bay")
	app.advance_clock(330.0)
	check(app.screen == "results" and app.day_finished and app.paused, "18:00 transitions to results")
	check(not app.results_values.ev_success and is_equal_approx(app.results_values.ev_departure_soc, 58.25), "failure results use departure record")
	check(app.results_values.cost == app.simulation.electricity_cost_eur, "results cost is actual")
	check(app.results_values.import == app.simulation.imported_kwh and app.results_values.export == app.simulation.exported_kwh, "results energy is actual")
	check(app.results_values.peak == app.simulation.max_grid_import_kw and app.results_values.battery_soc == app.simulation.battery_soc(), "peak and battery results are actual")
	check(app.results_values.local_share == app.simulation.self_supply_percent() and app.results_values.solar == app.simulation.solar_generated_kwh, "local share and solar results are actual")
	check(app.results_labels.cost.text == "€%.2f" % app.simulation.electricity_cost_eur, "result labels render real values")
	var end_cost: float = app.simulation.electricity_cost_eur
	app.advance_clock(100.0)
	check(app.simulation.electricity_cost_eur == end_cost, "results do not advance simulation")
	await snapshot("guide_07_failure_results")
	bounds(app.ui)
	press("Play Again  →")
	check(app.screen == "game" and app.guidance.step == Guidance.Step.INTRO and app.paused, "Retry restarts onboarding")
	check(app.elapsed_minutes == 480.0 and app.speed == 1 and app.simulation.imported_kwh == 0.0, "Retry resets time, speed and metrics")
	check(app.simulation.battery_soc() == 64.0 and is_equal_approx(app.simulation.ev_soc(), 38.0), "Retry restores initial energy")
	check(not app.departure_announced and app.departure_outcome == "" and not app.site.ev_departed_visual and app.site.ev_vehicle_visible, "Retry restores vehicle and feedback")
	check(app.results_values.is_empty() and app.simulation.battery_mode == "Hold" and app.simulation.ev_mode == "Normal", "Retry clears results and restores modes")
	press("Skip tutorial")
	check(not app.guidance.active() and not app.paused and app.intro_overlay == null, "intro skip starts normal play")
	# Success branch: untouched Normal charges to target at noon.
	app.advance_clock(270.0)
	check(app.departure_outcome == "ready" and not app.simulation.ev_departed_below_target, "successful departure feedback")
	check(is_equal_approx(app.simulation.ev_soc_at_departure, 80.0) and app.simulation.ev_power_kw == 0.0, "success uses real SoC and stops charging")
	await create_timer(0.2).timeout
	check(app.site.departure_elapsed > 0.0, "real frame callback runs cosmetic departure")
	app.site.set_process(false)
	await snapshot("guide_08_success_departure")
	app.site.advance_departure_visual(6.0)
	check(not app.site.ev_vehicle_visible, "large visual timestep also reaches exit")
	app.reset_clock()
	check(not app.site.ev_departed_visual and not app.departure_announced and app.site.ev_vehicle_visible, "Reset Day restores departure presentation")
	check(app.simulation.ev_soc_at_departure == -1.0 and not app.simulation.ev_departed_below_target, "Reset Day clears departure records")
	# Skip works after intro as well, without selecting equipment for the player.
	app.start_demo()
	app.continue_tutorial()
	app.guide_skip.pressed.emit()
	check(not app.guidance.active() and not app.paused and app.selected_id == "", "guide can be skipped mid-step")
	app.advance_clock(600.0)
	check(app.results_values.ev_success and is_equal_approx(app.results_values.cost, 6.028863636364), "default run produces known real success result")
	await snapshot("guide_09_success_results")
	press("Main Menu")
	check(app.screen == "start" and app.player_name == "Alex", "results Main Menu works and retains name")
	print("DEMO LOOP TESTS: %d checks, %d failures" % [checks, failures])
	app.queue_free()
	await process_frame
	quit(0 if failures == 0 else 1)
