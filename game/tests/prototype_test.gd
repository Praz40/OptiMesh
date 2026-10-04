extends SceneTree
## Integration checks against the real scene, buttons, input picking and clock.
var app: Control
var failures := 0
var checks := 0
var capture := false

func _initialize() -> void:
	capture = "--capture" in OS.get_cmdline_user_args()
	call_deferred("run")

func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures += 1
		push_error("CHECK FAILED: " + message)

func find_button(node: Node, caption: String) -> Button:
	if node is Button and node.text == caption:
		return node
	for child in node.get_children():
		var found := find_button(child, caption)
		if found: return found
	return null

func press(caption: String, parent: Node = null) -> void:
	var item := find_button(parent if parent != null else app, caption)
	check(item != null, "button exists: " + caption)
	if item:
		check(not item.disabled, "button enabled: " + caption)
		item.pressed.emit()

func snapshot(caption: String) -> void:
	if not capture: return
	await process_frame
	await RenderingServer.frame_post_draw
	var pixels := root.get_texture().get_image()
	var resolution := DisplayServer.window_get_size()
	var path := "res://artifacts/%s_%dx%d.png" % [caption, resolution.x, resolution.y]
	check(pixels.save_png(path) == OK, "saved screenshot: " + caption)

func click_viewport(point: Vector2) -> void:
	# Feed the real viewport input dispatcher in logical canvas coordinates.
	for down in [true, false]:
		var event := InputEventMouseButton.new()
		event.button_index = MOUSE_BUTTON_LEFT
		event.pressed = down
		event.position = point
		event.global_position = point
		root.push_input(event, true)

func check_panel_bounds(node: Node) -> void:
	for child in node.get_children():
		if child is Control and node is Panel:
			check(child.position.x + child.size.x <= node.size.x + 1, "panel horizontal bounds: " + str(child.name))
			check(child.position.y + child.size.y <= node.size.y + 1, "panel vertical bounds: %s (%s at %s in %s)" % [str(child.name), child.size, child.position, node.size])
		check_panel_bounds(child)

func run() -> void:
	app = load("res://scenes/legacy_regression.tscn").instantiate()
	root.add_child(app)
	await process_frame
	check(app.screen == "start", "start screen loaded")
	await snapshot("01_start")
	click_viewport(Vector2(320, 745))
	check(app.screen == "name", "start routes to name entry")
	app.name_input.text = "   "
	press("Continue  →")
	check(app.screen == "name" and not app.name_error.text.is_empty(), "whitespace name blocked")
	await snapshot("02_name_validation")
	app.name_input.text = "  Alex  "
	# Test the actual LineEdit submission signal as well as button routing.
	app.name_input.text_submitted.emit(app.name_input.text)
	check(app.player_name == "Alex" and app.screen == "modes", "name trimmed and Enter opens modes")
	check(find_button(app, "Not available yet").disabled, "Normal Mode is disabled")
	await snapshot("03_modes")
	press("Start Demo  →")
	app.skip_tutorial() # Onboarding has its own action/flow regression suite.
	app.set_process(false)
	check(app.screen == "game", "Demo enters main scene")
	check(app.elapsed_minutes < 481.0 and app.speed == 1, "demo starts at 08:00 / 1x")
	await snapshot("04_site")
	click_viewport(Vector2(1185, 738))
	check(app.selected_id == "battery", "viewport mouse selects battery through GUI dispatcher")
	click_viewport(Vector2(1540, 912))
	check(app.objects.battery.mode == "Charge", "viewport mouse activates panel control")
	check(app.site.object_at(Vector2(1110, 505)) == "battery", "battery badge is clickable")
	var points := {
		"building": Vector2(540, 262), "solar": Vector2(520, 115),
		"hvac": Vector2(855, 132), "inverter": Vector2(1130, 307),
		"battery": Vector2(1140, 453), "grid": Vector2(1270, 353),
		"ev_1": Vector2(135, 410), "ev_2": Vector2(240, 410), "ev_3": Vector2(345, 410)
	}
	for id in points:
		check(app.site.object_at(points[id]) == id, "hit polygon for " + id)
		var click := InputEventMouseButton.new()
		click.button_index = MOUSE_BUTTON_LEFT
		click.pressed = true
		click.position = points[id]
		app.site._gui_input(click)
		check(app.selected_id == id and app.site.selected_id == id, "selection and highlight: " + id)
		check(app.control_buttons.size() == app.objects[id].controls.size(), "panel controls: " + id)
		for mode in app.objects[id].controls:
			app.control_buttons[mode].pressed.emit()
			check(app.objects[id].mode == mode and app.selection_mode.text == "Setting: " + mode, "control state: " + id + "/" + mode)
		if id in ["hvac", "ev_2", "ev_3"]:
			check(app.objects[id].values == app.Catalog.objects()[id].values, "placeholder readings unchanged: " + id)
		await snapshot("panel_" + id)
		check_panel_bounds(app.inspector)
	app.select_object("battery")
	app.apply_control("Charge")
	app.select_object("hvac")
	app.select_object("battery")
	check(app.objects.battery.mode == "Charge", "intent survives switching objects")
	app.close_inspector()
	check(app.selected_id == "" and app.site.selected_id == "", "close clears selection")
	app.reset_clock()
	app.advance_clock(10.0)
	check(app.elapsed_minutes == 490.0, "1x clock advancement")
	press("Pause")
	app.advance_clock(20.0)
	check(app.elapsed_minutes == 490.0, "paused clock stays fixed")
	press("Resume")
	press("5×")
	app.advance_clock(10.0)
	check(app.elapsed_minutes == 540.0, "5x clock advancement")
	press("15×")
	app.advance_clock(2.0)
	check(app.elapsed_minutes == 570.0, "15x clock advancement")
	app._update_clock_text()
	check(app.clock_label.text == "09:30", "HUD time formatting")
	app.advance_clock(100.0)
	check(app.elapsed_minutes == 1080.0 and app.day_finished and app.paused, "clock clamps at office close")
	check(app.screen == "results", "end-of-day results transition")
	await snapshot("05_day_end")
	press("Play Again  →")
	app.skip_tutorial()
	check(app.elapsed_minutes == 480.0 and not app.paused and not app.day_finished, "reset restores playable clock")
	check(not app.pause_button.disabled, "reset re-enables pause")
	check(app.objects.battery.mode == "Hold" and app.simulation.battery_mode == "Hold", "clock reset restores battery intent")
	check(app.objects.ev_1.mode == "Normal" and app.simulation.ev_mode == "Normal", "clock reset restores EV intent")
	check(app.simulation.imported_kwh == 0.0 and app.simulation.exported_kwh == 0.0 and app.simulation.electricity_cost_eur == 0.0, "reset clears energy metrics")
	check(app.simulation.battery_soc() == 64.0 and is_equal_approx(app.simulation.ev_soc(), 38.0), "reset restores SoC")
	check(app.speed == 1, "reset restores clock speed")
	# Verify real controls and live inspector values without rebuilding selection.
	app.select_object("battery")
	var before_grid: float = app.simulation.grid_kw
	press("Charge")
	check(is_equal_approx(app.simulation.grid_kw, before_grid + 15.0), "Charge immediately changes real grid flow")
	var selected_label: Label = app.inspector_values[0]
	app.advance_clock(30.0)
	app.refresh_simulation_ui()
	check(is_instance_valid(selected_label) and selected_label == app.inspector_values[0], "live panel updates in place")
	check(app.inspector_values[0].text == "78.3 %", "battery SoC visibly increases")
	check(app.solar_label.text == "8.0 kW", "solar HUD follows simulated time")
	check(app.clock_label.text == "08:30", "clock HUD follows simulated time")
	await snapshot("07_battery_charging")
	press("Discharge")
	check(app.simulation.battery_power_kw == -15.0, "Discharge changes simulation power")
	check(app.grid_title.text == "GRID EXPORT", "HUD labels export direction")
	app.advance_clock(30.0)
	app.refresh_simulation_ui()
	check(app.simulation.battery_soc() < 64.0, "battery loses energy when discharging")
	await snapshot("08_battery_discharging")
	app.reset_clock()
	app.select_object("ev_1")
	press("Pause", app.inspector)
	check(app.simulation.ev_power_kw == 0.0 and app.simulation.grid_kw == 4.0, "EV Pause changes real grid")
	press("Low")
	check(app.simulation.ev_power_kw == 3.0, "EV Low changes simulation")
	press("Normal")
	check(app.simulation.ev_power_kw == 7.0, "EV Normal changes simulation")
	press("Fast")
	check(app.simulation.ev_power_kw == 11.0, "EV Fast changes simulation")
	app.advance_clock(60.0)
	app.refresh_simulation_ui()
	check(app.inspector_values[0].text == "54.5 % / 60 kWh", "EV inspector shows live charging")
	check(app.inspector_values[4].text == "10:33", "EV inspector shows target ETA")
	await snapshot("09_ev_charging")
	var grid_before_placeholder: float = app.simulation.grid_kw
	app.select_object("ev_2")
	press("Fast")
	app.select_object("hvac")
	press("Boost")
	check(app.simulation.grid_kw == grid_before_placeholder, "placeholder controls excluded from energy model")
	app.select_object("ev_1")
	press("Low")
	app.advance_clock(210.0)
	app.select_object("ev_1") # Departure feedback takes the inspector first.
	app.refresh_simulation_ui()
	check(app.simulation.ev_departed_below_target and app.simulation.ev_power_kw == 0.0, "EV departure shuts off power and records missed target")
	check(app.inspector_values[4].text == "Departed below target", "inspector shows missed departure")
	check(app.price_label.text == "€0.10 / kWh", "midday tariff visible")
	await snapshot("10_ev_departed")
	app.advance_clock(150.0)
	app.select_object("grid")
	app.refresh_simulation_ui()
	check(app.price_label.text == "€0.32 / kWh", "late-afternoon tariff visible")
	check(app.simulation.building_kw == 18.0 and app.simulation.solar_kw == 21.5, "late-afternoon profiles evolve")
	await snapshot("11_grid_live")
	app.reset_clock()
	var paused_energy: float = app.simulation.ev_energy_kwh
	app.toggle_pause()
	app.advance_clock(20.0)
	check(app.simulation.ev_energy_kwh == paused_energy and app.simulation.imported_kwh == 0.0, "UI pause freezes energy, not just time")
	app.toggle_pause()
	# Exercise the actual frame callback and HUD refresh timer, not just manual dt.
	app.select_object("solar")
	app.set_speed(15)
	app.set_process(true)
	await create_timer(0.6).timeout
	check(app.elapsed_minutes > 485.0 and app.simulation.imported_kwh > 0.0, "real frames advance clock and energy at 15x")
	check(app.solar_label.text != "4.0 kW" and app.inspector_values[0].text == app.solar_label.text, "real frames refresh HUD and selected inspector")
	await snapshot("12_live_clock")
	app.toggle_pause()
	var paused_minute: float = app.elapsed_minutes
	var paused_import: float = app.simulation.imported_kwh
	await create_timer(0.25).timeout
	check(app.elapsed_minutes == paused_minute and app.simulation.imported_kwh == paused_import, "actual frame loop respects pause")
	app.set_process(false)
	app.reset_clock()
	# Keyboard navigation uses the same state as the buttons.
	var key := InputEventKey.new()
	key.keycode = KEY_SPACE
	key.pressed = true
	app._unhandled_key_input(key)
	check(app.paused, "Space pauses")
	key.keycode = KEY_1
	app._unhandled_key_input(key)
	check(app.speed == 1, "1 key sets 1x")
	app.select_object("battery")
	await snapshot("06_battery")
	press("Menu")
	check(app.screen == "start", "Menu returns to start")
	press("New Game  →")
	check(app.name_input.text == "Alex", "name retained when returning to menu")
	press("Continue  →")
	press("Start Demo  →")
	check(app.objects.battery.mode == "Hold", "new demo resets object settings")
	print("PROTOTYPE TESTS: %d checks, %d failures" % [checks, failures])
	app.queue_free()
	await process_frame
	quit(0 if failures == 0 else 1)
