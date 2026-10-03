extends Control
## UI observes the simulation; only placeholders retain catalog readings.
const Catalog = preload("res://scripts/site_catalog.gd")
const SiteMap = preload("res://scripts/site_map.gd")
const Simulation = preload("res://scripts/energy_simulation.gd")
const Guidance = preload("res://scripts/demo_guidance.gd")
const INK = Color("#243e48")
const MUTED = Color("#6b8185")
const GREEN = Color("#248c77")
const PAPER = Color("#f8faf6")
var screen := ""
var player_name := ""
var objects: Dictionary = Catalog.objects()
var selected_id := ""
var simulation = Simulation.new()
var elapsed_minutes: float:
	get: return simulation.time_minutes
var paused: bool:
	get: return simulation.paused
	set(value): simulation.paused = value
var speed := 1
var day_finished: bool:
	get: return simulation.day_finished
var ui: Control
var site: Control
var name_input: LineEdit
var name_error: Label
var clock_label: Label
var pause_button: Button
var inspector: Panel
var control_buttons: Dictionary = {}
var selection_mode: Label
var feedback: Label
var assistant_message: Label
var fps_label: Label
var price_label: Label
var grid_label: Label
var solar_label: Label
var grid_title: Label
var grid_detail: Label
var clock_detail: Label
var solar_detail: Label
var snapshot_label: Label
var ev_status_label: Label
var inspector_values: Array[Label] = []
var hud_refresh := 0.0
var guidance = Guidance.new()
var intro_overlay: Control
var guide_button: Button
var guide_skip: Button
var guide_title: Label
var objective_label: Label
var upcoming_label: Label
var departure_announced := false
var departure_outcome := ""
var last_price := 0.18
var context_note := "Meet the EV deadline, then manage cost and peak grid use."
var results_values: Dictionary = {}
var results_labels: Dictionary = {}

func _ready() -> void:
	Engine.max_fps = 60
	_apply_theme()
	show_start()

func _apply_theme() -> void:
	var skin := Theme.new()
	skin.default_font_size = 23
	skin.set_color("font_color", "Label", INK)
	skin.set_color("font_color", "Button", INK)
	skin.set_color("font_hover_color", "Button", GREEN)
	skin.set_color("font_pressed_color", "Button", GREEN)
	skin.set_color("font_disabled_color", "Button", Color("#9aa9a9"))
	for state in ["normal", "hover", "pressed", "focus", "disabled"]:
		var color := Color("#e8efea")
		if state == "hover": color = Color("#d6e8df")
		if state == "pressed": color = Color("#c5e1d4")
		var style := panel_style(color, 12)
		if state == "focus":
			style.bg_color = Color.TRANSPARENT
			style.border_color = GREEN
			style.set_border_width_all(3)
		skin.set_stylebox(state, "Button", style)
	skin.set_stylebox("normal", "LineEdit", panel_style(Color("#eaf0eb"), 12))
	var focus := panel_style(Color("#eaf0eb"), 12)
	focus.border_color = GREEN
	focus.set_border_width_all(2)
	skin.set_stylebox("focus", "LineEdit", focus)
	skin.set_color("font_color", "LineEdit", INK)
	skin.set_color("caret_color", "LineEdit", GREEN)
	skin.set_color("font_placeholder_color", "LineEdit", MUTED)
	theme = skin

func panel_style(color: Color, radius: int = 18) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.set_corner_radius_all(radius)
	style.content_margin_left = 18
	style.content_margin_right = 18
	return style

func place(node: Control, rect: Rect2, parent: Node = null) -> Control:
	node.position = rect.position
	node.size = rect.size
	(parent if parent != null else ui).add_child(node)
	return node

func panel(rect: Rect2, color: Color = PAPER, parent: Node = null) -> Panel:
	var node := Panel.new()
	node.add_theme_stylebox_override("panel", panel_style(color))
	place(node, rect, parent)
	return node

func label(text: String, rect: Rect2, size_px: int = 23, color: Color = INK, parent: Node = null) -> Label:
	var node := Label.new()
	node.text = text
	node.add_theme_font_size_override("font_size", size_px)
	node.add_theme_color_override("font_color", color)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	place(node, rect, parent)
	return node

func paragraph(text: String, rect: Rect2, size_px: int = 23, color: Color = MUTED, parent: Node = null) -> Label:
	var node := Label.new()
	# Configure wrapping before text enters the tree and computes its minimum size.
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.size = rect.size
	node.text = text
	node.add_theme_font_size_override("font_size", size_px)
	node.add_theme_color_override("font_color", color)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	place(node, rect, parent)
	return node

func button(text: String, rect: Rect2, callback: Callable, parent: Node = null, primary: bool = false) -> Button:
	var node := Button.new()
	node.text = text
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	if primary:
		node.add_theme_stylebox_override("normal", panel_style(GREEN, 12))
		node.add_theme_stylebox_override("hover", panel_style(GREEN.lightened(0.1), 12))
		node.add_theme_stylebox_override("pressed", panel_style(GREEN.darkened(0.12), 12))
		for state in ["font_color", "font_hover_color", "font_pressed_color"]:
			node.add_theme_color_override(state, Color.WHITE)
	node.pressed.connect(callback)
	place(node, rect, parent)
	return node

func clear_screen(next: String) -> void:
	if is_instance_valid(ui):
		remove_child(ui)
		ui.queue_free()
	ui = Control.new()
	ui.name = "Screen"
	ui.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(ui)
	screen = next

func brand(show_version: bool = true) -> void:
	label("◈", Rect2(52, 28, 50, 55), 46, GREEN)
	label("OptiMesh", Rect2(108, 27, 300, 60), 36)
	label("OFFICE ENERGY LAB", Rect2(320, 44, 350, 35), 16, MUTED)
	if show_version:
		label("GUIDED OFFICE DAY  /  03", Rect2(1530, 43, 330, 35), 17, MUTED)

func menu_background() -> void:
	brand()
	var preview := SiteMap.new()
	place(preview, Rect2(590, 330, 1380, 620))
	preview.scale = Vector2(0.90, 0.90)
	preview.modulate = Color(1, 1, 1, 0.66)
	preview.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label("ONE SITE. MANY POSSIBILITIES.", Rect2(650, 250, 1000, 50), 21, GREEN)
	label("A little energy intelligence goes a long way.", Rect2(650, 925, 1100, 60), 26, MUTED)

func show_start() -> void:
	clear_screen("start")
	menu_background()
	var card := panel(Rect2(80, 240, 500, 640))
	label("WELCOME TO", Rect2(40, 42, 420, 40), 19, GREEN, card)
	label("OptiMesh", Rect2(40, 90, 420, 90), 62, INK, card)
	paragraph("Your office.\nYour energy decisions.", Rect2(40, 194, 410, 115), 32, INK, card)
	paragraph("Explore a small workplace and get to know the systems that power it.", Rect2(40, 334, 410, 104), 23, MUTED, card)
	button("New Game  →", Rect2(40, 472, 420, 64), show_name, card, true)
	label("Demo Mode · local desktop prototype", Rect2(40, 550, 420, 45), 19, MUTED, card)

func show_name() -> void:
	clear_screen("name")
	menu_background()
	var card := panel(Rect2(80, 240, 500, 640))
	label("01  /  MEET THE MANAGER", Rect2(40, 40, 420, 40), 18, GREEN, card)
	label("Hello there.", Rect2(40, 108, 420, 80), 48, INK, card)
	paragraph("What should we call you?", Rect2(40, 208, 420, 60), 27, INK, card)
	name_input = LineEdit.new()
	name_input.placeholder_text = "Your name"
	name_input.max_length = 24
	name_input.text = player_name
	place(name_input, Rect2(40, 302, 420, 70), card)
	name_input.text_submitted.connect(func(_text: String): submit_name())
	name_input.text_changed.connect(func(_text: String): name_error.text = "")
	name_error = label("", Rect2(40, 385, 420, 50), 20, Color("#ad5143"), card)
	button("Continue  →", Rect2(40, 465, 420, 64), submit_name, card, true)
	button("← Back", Rect2(40, 550, 160, 48), show_start, card)
	name_input.grab_focus()

func submit_name() -> void:
	var cleaned := name_input.text.strip_edges()
	if cleaned.is_empty():
		name_error.text = "Please enter a name to continue."
		name_input.grab_focus()
		return
	player_name = cleaned
	show_modes()

func show_modes() -> void:
	clear_screen("modes")
	brand()
	label("Choose your first day.", Rect2(170, 195, 1400, 100), 54)
	label("Welcome, %s. Start with a guided look around the site." % player_name, Rect2(174, 300, 1500, 65), 26, MUTED)
	var demo := panel(Rect2(170, 425, 760, 390))
	label("READY TO EXPLORE", Rect2(40, 34, 680, 40), 19, GREEN, demo)
	label("Demo Mode", Rect2(40, 93, 680, 70), 43, INK, demo)
	paragraph("Simulate a clear office day. Manage the battery and EV 01 while demand, solar and prices change.", Rect2(40, 181, 675, 105), 25, MUTED, demo)
	button("Start Demo  →", Rect2(40, 300, 680, 60), start_demo, demo, true)
	var normal := panel(Rect2(975, 425, 760, 390), Color("#e1e9e3"))
	label("COMING LATER", Rect2(40, 34, 680, 40), 19, MUTED, normal)
	label("Normal Mode", Rect2(40, 93, 680, 70), 43, MUTED, normal)
	paragraph("More scenarios and scoring will arrive in a future milestone.", Rect2(40, 181, 675, 105), 25, MUTED, normal)
	var disabled := button("Not available yet", Rect2(40, 300, 680, 60), func(): pass, normal)
	disabled.disabled = true
	button("← Your name", Rect2(170, 880, 250, 60), show_name)

func start_demo() -> void:
	simulation.reset()
	guidance.begin()
	paused = true
	speed = 1
	selected_id = ""
	objects = Catalog.objects()
	departure_announced = false
	departure_outcome = ""
	results_values.clear()
	results_labels.clear()
	last_price = simulation.price_eur_per_kwh
	context_note = "Meet the EV deadline, then manage cost and peak grid use."
	hud_refresh = 0.0
	show_game()
	show_intro()

func metric(x: float, title: String, value: String, detail: String, color: Color = INK) -> Label:
	var card := panel(Rect2(x, 111, 265, 100))
	label(title, Rect2(20, 10, 225, 28), 16, MUTED, card)
	var result := label(value, Rect2(20, 38, 225, 44), 32, color, card)
	label(detail, Rect2(20, 78, 225, 20), 13, MUTED, card)
	return result

func show_game() -> void:
	clear_screen("game")
	brand(false)
	button("Menu", Rect2(1736, 30, 130, 50), show_start)
	label("DEMO", Rect2(715, 42, 90, 32), 19, GREEN)
	label("Manager: " + player_name, Rect2(835, 42, 650, 34), 20, MUTED)
	clock_label = metric(55, "OFFICE DAY  /  01", "08:00", "1× = 1 min/s", GREEN)
	clock_detail = clock_label.get_parent().get_child(2)
	price_label = metric(340, "ELECTRICITY PRICE", "", "Time-of-day import tariff")
	grid_label = metric(625, "GRID IMPORT", "", "")
	grid_title = grid_label.get_parent().get_child(0)
	grid_detail = grid_label.get_parent().get_child(2)
	solar_label = metric(910, "SOLAR GENERATION", "", "", GREEN)
	solar_detail = solar_label.get_parent().get_child(2)
	var transport := panel(Rect2(1195, 111, 671, 100))
	label("CLOCK CONTROLS", Rect2(20, 9, 310, 28), 16, MUTED, transport)
	pause_button = button("Pause", Rect2(20, 42, 125, 44), toggle_pause, transport)
	for index in range(3):
		var rate: int = [1, 5, 15][index]
		var rate_button := button("%d×" % rate, Rect2(160 + index * 115, 42, 100, 44), set_speed.bind(rate), transport)
		rate_button.name = "Speed%d" % rate
	button("Reset day", Rect2(510, 42, 142, 44), reset_clock, transport)
	_update_speed_buttons()
	label("WESTBROOK CAMPUS", Rect2(65, 228, 650, 38), 22)
	objective_label = label("", Rect2(405, 222, 1010, 35), 22, GREEN)
	label("Keep energy cost and grid peak low. Click a system to make decisions.", Rect2(405, 257, 1010, 24), 17, MUTED)
	site = SiteMap.new()
	place(site, Rect2(45, 285, 1380, 620))
	site.object_selected.connect(select_object)
	inspector = panel(Rect2(1460, 235, 406, 800))
	show_inspector_empty()
	var events := panel(Rect2(55, 929, 370, 106))
	label("UPCOMING", Rect2(20, 9, 330, 28), 16, MUTED, events)
	upcoming_label = label("", Rect2(20, 39, 330, 32), 20, INK, events)
	ev_status_label = label("", Rect2(20, 77, 330, 23), 15, MUTED, events)
	var performance := panel(Rect2(445, 929, 320, 106))
	label("SITE SNAPSHOT", Rect2(20, 9, 280, 28), 16, MUTED, performance)
	snapshot_label = label("", Rect2(20, 39, 280, 32), 24, GREEN, performance)
	fps_label = label("", Rect2(20, 77, 280, 23), 15, MUTED, performance)
	var assistant := panel(Rect2(785, 929, 640, 106), Color("#dae9e0"))
	guide_title = label("OPTI  /  SITE GUIDE", Rect2(20, 9, 410, 28), 16, GREEN, assistant)
	assistant_message = paragraph("", Rect2(20, 40, 600, 62), 19, INK, assistant)
	guide_button = button("Inspect", Rect2(445, 7, 106, 29), guide_action, assistant)
	guide_skip = button("Skip", Rect2(559, 7, 65, 29), skip_tutorial, assistant)
	for item in [guide_button, guide_skip]:
		item.add_theme_font_size_override("font_size", 14)
		for state in ["normal", "hover", "pressed", "focus"]:
			var compact := item.get_theme_stylebox(state).duplicate() as StyleBoxFlat
			compact.content_margin_left = 8
			compact.content_margin_right = 8
			item.add_theme_stylebox_override(state, compact)
		item.size.y = 29
	refresh_simulation_ui()
	refresh_guidance()

func show_intro() -> void:
	intro_overlay = Control.new()
	place(intro_overlay, Rect2(0, 0, 1920, 1080))
	var shade := ColorRect.new()
	shade.color = Color(0.12, 0.22, 0.25, 0.30)
	place(shade, Rect2(0, 0, 1920, 1080), intro_overlay)
	var card := panel(Rect2(535, 270, 850, 530), PAPER, intro_overlay)
	label("OPTI  /  YOUR OFFICE DAY", Rect2(40, 30, 770, 40), 20, GREEN, card)
	label("Let's make a plan.", Rect2(40, 87, 770, 75), 48, INK, card)
	label("Get EV 01 to 80% before 12:30.", Rect2(40, 178, 770, 55), 32, GREEN, card)
	paragraph("Manage one office workday. Keep energy cost and grid peaks low as demand, solar and prices change.", Rect2(40, 251, 770, 86), 25, INK, card)
	paragraph("Inspect the site → choose EV charging → try the battery → plan around prices. The clock waits while you learn.", Rect2(40, 350, 770, 70), 21, MUTED, card)
	var next := button("Continue  →", Rect2(40, 439, 485, 60), continue_tutorial, card, true)
	button("Skip tutorial", Rect2(545, 439, 265, 60), skip_tutorial, card)
	next.grab_focus()

func dismiss_intro() -> void:
	if is_instance_valid(intro_overlay):
		intro_overlay.get_parent().remove_child(intro_overlay)
		intro_overlay.queue_free()
	intro_overlay = null

func continue_tutorial() -> void:
	guidance.continue_intro()
	dismiss_intro()
	refresh_guidance()

func guide_action() -> void:
	if guidance.step == Guidance.Step.PLANNING:
		guidance.finish()
		paused = false
		context_note = "You're in charge. Watch the EV deadline, solar, price and grid use together."
		refresh_guidance()
	else:
		var target: String = guidance.target_object()
		if target != "": select_object(target)

func skip_tutorial() -> void:
	guidance.skip()
	dismiss_intro()
	paused = false
	context_note = "Reach 80% by 12:30. Keep cost and peak grid use low throughout the day."
	refresh_guidance()

func refresh_guidance() -> void:
	var active: bool = guidance.active()
	pause_button.disabled = active or day_finished
	pause_button.text = "Learning" if active else ("Resume" if paused else "Pause")
	guide_button.visible = active and guidance.step != Guidance.Step.INTRO
	guide_skip.visible = active and guidance.step != Guidance.Step.INTRO
	guide_button.text = "Got it" if guidance.step == Guidance.Step.PLANNING else ("Open EV" if guidance.step == Guidance.Step.EV else "Inspect")
	guide_title.text = "OPTI  /  LEARN THE SITE" if active else "OPTI  /  SITE GUIDE"
	assistant_message.text = guidance.instruction(simulation.ev_soc(), simulation.config.ev_target_soc, time_text(simulation.config.ev_departure_minute)) if active else context_note
	site.guided_id = guidance.target_object()
	site.queue_redraw()

func empty_inspector() -> void:
	for child in inspector.get_children():
		inspector.remove_child(child)
		child.queue_free()
	control_buttons.clear()
	inspector_values.clear()

func show_inspector_empty() -> void:
	empty_inspector()
	label("SITE INSPECTOR", Rect2(28, 27, 350, 40), 17, MUTED, inspector)
	label("A connected\nworkplace.", Rect2(28, 110, 350, 145), 38, INK, inspector)
	paragraph("Select an object on the map to view readings and explore its controls.", Rect2(28, 290, 350, 120), 25, MUTED, inspector)
	paragraph("Solar · Building · HVAC\nBattery · Grid · Inverter\nEV bays 01, 02 and 03", Rect2(28, 457, 350, 130), 23, INK, inspector)
	paragraph("LIVE SIMULATION\nBattery and EV 01 controls affect power. HVAC and EV 02/03 are placeholders.", Rect2(28, 642, 350, 120), 20, MUTED, inspector)

func select_object(id: String) -> void:
	if not objects.has(id): return
	selected_id = id
	site.select(id)
	show_object_panel()
	guidance.inspected(id)
	refresh_guidance()

func show_object_panel() -> void:
	_sync_readings()
	empty_inspector()
	var data: Dictionary = objects[selected_id]
	label(data.type, Rect2(28, 28, 310, 40), 16, Color(data.color), inspector)
	button("×", Rect2(335, 23, 44, 44), close_inspector, inspector)
	label(data.name, Rect2(28, 87, 350, 65), 30, INK, inspector)
	paragraph(data.description, Rect2(28, 168, 350, 90), 19, MUTED, inspector)
	var compact_rows: bool = data.values.size() > 4
	for index in range(data.values.size()):
		var entry: Array = data.values[index]
		var row := panel(Rect2(23, (265 + index * 48) if compact_rows else (305 + index * 61), 360, 46 if compact_rows else 54), Color("#edf2ed"), inspector)
		label(entry[0], Rect2(12, 0 if compact_rows else 4, 325, 22), 13 if compact_rows else 15, MUTED, row)
		inspector_values.append(label(entry[1], Rect2(12, 18 if compact_rows else 22, 325, 28 if compact_rows else 30), 19 if compact_rows else 23, INK, row))
	label("CONTROL INTENT", Rect2(28, 563, 350, 30), 16, MUTED, inspector)
	selection_mode = label("", Rect2(28, 598, 350, 34), 23, GREEN, inspector)
	var count: int = data.controls.size()
	var gap := 8.0
	var width := (350.0 - gap * (count - 1)) / maxi(count, 1)
	for index in range(count):
		var mode: String = data.controls[index]
		var item := button(mode, Rect2(28 + index * (width + gap), 652, width, 52), apply_control.bind(mode), inspector)
		item.add_theme_font_size_override("font_size", 16)
		for state in ["normal", "hover", "pressed", "focus"]:
			var compact := item.get_theme_stylebox(state).duplicate() as StyleBoxFlat
			compact.content_margin_left = 8
			compact.content_margin_right = 8
			item.add_theme_stylebox_override(state, compact)
		item.size = Vector2(width, 52)
		control_buttons[mode] = item
	feedback = paragraph(_control_note(), Rect2(28, 722, 350, 65), 18, MUTED, inspector)
	_update_mode_buttons()

func apply_control(mode: String) -> void:
	if selected_id.is_empty(): return
	if selected_id in ["battery", "ev_1"]:
		if day_finished: return
		if selected_id == "battery": simulation.set_battery_mode(mode)
		else: simulation.set_ev_mode(mode)
	objects[selected_id].mode = mode
	refresh_simulation_ui()
	_update_mode_buttons()
	feedback.text = _control_note()
	guidance.controlled(selected_id)
	if not guidance.active():
		if selected_id == "battery": context_note = "%s · Battery power %+.1f kW. Watch the grid and tariff together." % [mode, simulation.battery_power_kw]
		elif selected_id == "ev_1": context_note = "EV 01 · %s selected. Check its target ETA against the 12:30 deadline." % mode
	refresh_guidance()

func _control_note() -> String:
	if selected_id == "battery": return "Live control · + charge / − discharge. Efficiency: 95 % each way."
	if selected_id == "ev_1": return "Live charging · stops at target or departure. Charging efficiency: 90 %."
	return "View only / placeholder control. Does not change simulated demand."

func _update_mode_buttons() -> void:
	var mode: String = objects[selected_id].mode
	selection_mode.text = "Setting: " + mode
	for key in control_buttons:
		var item: Button = control_buttons[key]
		item.disabled = day_finished and selected_id in ["battery", "ev_1"]
		var compact := panel_style(Color("#c5e1d4") if key == mode else Color("#e8efea"), 10)
		compact.content_margin_left = 8
		compact.content_margin_right = 8
		item.add_theme_stylebox_override("normal", compact)
		item.add_theme_color_override("font_color", GREEN if key == mode else INK)

func close_inspector() -> void:
	selected_id = ""
	site.select("")
	show_inspector_empty()
	refresh_guidance()

func toggle_pause() -> void:
	if day_finished or guidance.active(): return
	paused = not paused
	pause_button.text = "Resume" if paused else "Pause"

func set_speed(rate: int) -> void:
	speed = rate
	_update_speed_buttons()

func _update_speed_buttons() -> void:
	for rate in [1, 5, 15]:
		var item: Button = ui.find_child("Speed%d" % rate, true, false)
		if item:
			item.add_theme_stylebox_override("normal", panel_style(Color("#c5e1d4") if speed == rate else Color("#e8efea"), 10))

func reset_clock() -> void:
	if screen == "results":
		start_demo()
		return
	simulation.reset()
	speed = 1
	_update_speed_buttons()
	objects = Catalog.objects()
	departure_announced = false
	departure_outcome = ""
	last_price = simulation.price_eur_per_kwh
	site.reset_ev_visual()
	paused = guidance.active()
	pause_button.disabled = false
	pause_button.text = "Pause"
	refresh_simulation_ui()
	if selected_id != "":
		show_object_panel()
	context_note = "Office day reset to 08:00. Energy, metrics and controls restored."
	refresh_guidance()

func advance_clock(delta: float) -> void:
	if screen != "game" or paused or day_finished: return
	simulation.advance(delta * speed)
	if simulation.price_eur_per_kwh != last_price:
		last_price = simulation.price_eur_per_kwh
		context_note = "%s · Grid import now €%.2f/kWh. Review your power choices." % [time_text(elapsed_minutes), last_price]
		refresh_guidance()
	if simulation.ev_departed and not departure_announced:
		departure_announced = true
		departure_outcome = "missed" if simulation.ev_departed_below_target else "ready"
		site.begin_ev_departure()
		show_departure_panel()
	if day_finished:
		show_results()

func show_departure_panel() -> void:
	selected_id = ""
	site.select("")
	empty_inspector()
	var failed: bool = simulation.ev_departed_below_target
	var color := Color("#ad5143") if failed else GREEN
	label("12:30  /  EV DEPARTURE", Rect2(28, 28, 350, 40), 18, color, inspector)
	label("EV 01 missed target" if failed else "EV 01 ready", Rect2(28, 100, 350, 70), 30, color, inspector)
	label("%.1f %%" % simulation.ev_soc_at_departure, Rect2(28, 203, 350, 100), 56, color, inspector)
	label("Departure SoC · required 80%", Rect2(28, 313, 350, 40), 21, MUTED, inspector)
	paragraph("Vehicle left undercharged. The EV requirement was missed." if failed else "Target reached. Vehicle departed successfully.", Rect2(28, 404, 350, 100), 26, INK, inspector)
	paragraph("Your office day continues. Keep watching the tariff, battery and grid peak.", Rect2(28, 542, 350, 120), 23, MUTED, inspector)
	button("Keep managing  →", Rect2(28, 699, 350, 60), close_inspector, inspector, true)
	context_note = "EV 01 %s · %.1f%% at departure. Continue managing the site until 18:00." % ["missed its target" if failed else "departed ready", simulation.ev_soc_at_departure]
	refresh_guidance()
	refresh_simulation_ui()

func show_results() -> void:
	results_values = {
		"cost": simulation.electricity_cost_eur, "import": simulation.imported_kwh,
		"export": simulation.exported_kwh, "peak": simulation.max_grid_import_kw,
		"solar": simulation.solar_generated_kwh, "local_share": simulation.self_supply_percent(),
		"battery_soc": simulation.battery_soc(), "ev_success": not simulation.ev_departed_below_target,
		"ev_departure_soc": simulation.ev_soc_at_departure
	}
	clear_screen("results")
	brand()
	label("Your office day, complete.", Rect2(170, 158, 1560, 95), 54)
	label("18:00 · %s's run · Final energy totals" % player_name, Rect2(174, 269, 1560, 50), 26, MUTED)
	var ev_card := panel(Rect2(170, 355, 760, 190), Color("#dae9e0") if results_values.ev_success else Color("#f1dfd5"))
	var color := GREEN if results_values.ev_success else Color("#ad5143")
	label("EV 01 ready" if results_values.ev_success else "EV 01 missed target", Rect2(30, 22, 700, 52), 35, color, ev_card)
	label("Departure SoC %.1f%%  /  Required 80%%" % results_values.ev_departure_soc, Rect2(30, 86, 700, 42), 28, INK, ev_card)
	label("Target reached · departed at 12:30" if results_values.ev_success else "Vehicle left undercharged at 12:30", Rect2(30, 140, 700, 32), 22, MUTED, ev_card)
	var cost_card := panel(Rect2(975, 355, 760, 190))
	label("TOTAL ELECTRICITY COST", Rect2(30, 22, 700, 40), 20, MUTED, cost_card)
	results_labels.cost = label("€%.2f" % results_values.cost, Rect2(30, 80, 700, 85), 60, GREEN, cost_card)
	var metrics := [["import", "GRID IMPORT", "%.1f kWh" % results_values.import], ["export", "GRID EXPORT", "%.1f kWh" % results_values.export], ["peak", "PEAK GRID IMPORT", "%.1f kW" % results_values.peak], ["solar", "SOLAR GENERATED", "%.1f kWh" % results_values.solar], ["battery_soc", "FINAL BATTERY SOC", "%.1f %%" % results_values.battery_soc], ["local_share", "LOCAL SUPPLY AT 18:00", "%.0f %%" % results_values.local_share]]
	for index in range(metrics.size()):
		var item: Array = metrics[index]
		var card := panel(Rect2(170 + (index % 3) * 535, 580 + floori(float(index) / 3.0) * 135, 490, 110))
		label(item[1], Rect2(25, 12, 440, 32), 18, MUTED, card)
		results_labels[item[0]] = label(item[2], Rect2(25, 51, 440, 47), 32, INK, card)
	button("Play Again  →", Rect2(170, 895, 760, 70), start_demo, null, true)
	button("Main Menu", Rect2(975, 895, 760, 70), show_start)

static func time_text(minute: float) -> String:
	var minutes := int(floor(minute + 1e-7))
	return "%02d:%02d" % [floori(float(minutes) / 60.0), minutes % 60]

func _sync_readings() -> void:
	var sim = simulation
	objects.battery.mode = sim.battery_mode
	objects.ev_1.mode = sim.ev_mode
	objects.building.values = [["Building load", "%.1f kW" % sim.building_kw], ["Energy today", "%.1f kWh" % sim.building_energy_kwh], ["Floor area", "1,200 m²"], ["Opening hours", "08:00 – 18:00"]]
	objects.solar.values = [["Generation (AC)", "%.1f kW" % sim.solar_kw], ["Installed capacity", "%.0f kWp" % sim.config.solar_capacity_kwp], ["Energy today", "%.1f kWh" % sim.solar_generated_kwh], ["Baseline", "Clear day"]]
	objects.inverter.values = [["AC output", "%.1f kW" % sim.solar_kw], ["Array rating", "%.0f kWp" % sim.config.solar_capacity_kwp], ["Conversion", "Included in solar curve"], ["Status", "Online"]]
	objects.battery.values = [["State of charge", "%.1f %%" % sim.battery_soc()], ["Stored / capacity", "%.1f / %.0f kWh" % [sim.battery_energy_kwh, sim.config.battery_capacity_kwh]], ["AC power (+ charge / − discharge)", "%+.1f kW" % sim.battery_power_kw], ["Charge / discharge limit", "%.0f / %.0f kW" % [sim.config.battery_charge_limit_kw, sim.config.battery_discharge_limit_kw]]]
	objects.grid.values = [["Grid flow", "%s %.1f kW" % ["Import" if sim.grid_kw >= 0.0 else "Export", absf(sim.grid_kw)]], ["Import / export today", "%.1f / %.1f kWh" % [sim.imported_kwh, sim.exported_kwh]], ["Energy cost / peak import", "€%.2f / %.1f kW" % [sim.electricity_cost_eur, sim.max_grid_import_kw]], ["Import price / export price", "€%.2f / €0.00 per kWh" % sim.price_eur_per_kwh]]
	var eta: float = sim.ev_completion_minute()
	var completion := "Paused" if sim.ev_power_kw == 0.0 else time_text(ceil(eta - 1e-7))
	if sim.ev_target_reached: completion = "Target reached"
	elif sim.ev_departed: completion = "Departed below target"
	elif eta > sim.config.ev_departure_minute: completion += " · after departure"
	objects.ev_1.values = [["EV SoC / battery capacity", "%.1f %% / %.0f kWh" % [sim.ev_soc(), sim.config.ev_capacity_kwh]], ["Target / reached", "%.0f %% / %s" % [sim.config.ev_target_soc, "Yes" if sim.ev_target_reached else "No"]], ["AC charging power / limit", "%.1f / %.0f kW" % [sim.ev_power_kw, sim.config.ev_max_power_kw]], ["Departure", time_text(sim.config.ev_departure_minute) + (" · departed" if sim.ev_departed else " · connected")], ["Target ETA at current rate", completion], ["Stored energy", "%.1f kWh" % sim.ev_energy_kwh]]

func refresh_simulation_ui() -> void:
	_sync_readings()
	_update_clock_text()
	price_label.text = "€%.2f / kWh" % simulation.price_eur_per_kwh
	grid_title.text = "GRID IMPORT" if simulation.grid_kw >= 0.0 else "GRID EXPORT"
	grid_label.text = "%.1f kW" % absf(simulation.grid_kw)
	grid_detail.text = "In %.1f / out %.1f kWh · €%.2f" % [simulation.imported_kwh, simulation.exported_kwh, simulation.electricity_cost_eur]
	solar_label.text = "%.1f kW" % simulation.solar_kw
	clock_detail.text = "1× = 1 min/s · Building %.1f kW" % simulation.building_kw
	solar_detail.text = "Battery %.0f %% · EV 01 %.1f kW" % [simulation.battery_soc(), simulation.ev_power_kw]
	snapshot_label.text = "Self-supply  %.0f %%" % simulation.self_supply_percent()
	fps_label.text = "Local supply share · %d FPS live" % Engine.get_frames_per_second()
	if simulation.ev_departed:
		objective_label.text = "EV 01 %s · Departed at %.1f%% (target 80%%)" % ["MISSED TARGET" if simulation.ev_departed_below_target else "READY", simulation.ev_soc_at_departure]
		objective_label.add_theme_color_override("font_color", Color("#ad5143") if simulation.ev_departed_below_target else GREEN)
	else:
		objective_label.text = "EV 01 · Reach 80%% before 12:30 · Now %.1f%%" % simulation.ev_soc()
		objective_label.add_theme_color_override("font_color", GREEN)
	var upcoming: Array = []
	if not simulation.ev_departed: upcoming.append([simulation.config.ev_departure_minute, "EV 01 departure"])
	for period in Simulation.TARIFF:
		if period[0] > elapsed_minutes: upcoming.append([period[0], "Price €%.2f/kWh" % period[1]])
	upcoming.sort_custom(func(a: Array, b: Array): return a[0] < b[0])
	upcoming_label.text = "%s · %s" % [time_text(upcoming[0][0]), upcoming[0][1]] if not upcoming.is_empty() else "18:00 · Office day ends"
	ev_status_label.text = "Then %s · %s" % [time_text(upcoming[1][0]), upcoming[1][1]] if upcoming.size() > 1 else "Watch energy cost and grid peak"
	if selected_id != "" and inspector_values.size() == objects[selected_id].values.size():
		for index in range(inspector_values.size()):
			inspector_values[index].text = objects[selected_id].values[index][1]

func _update_clock_text() -> void:
	clock_label.text = time_text(elapsed_minutes)

func _process(delta: float) -> void:
	if screen != "game": return
	advance_clock(delta)
	if screen != "game": return # Day-end replaces the UI during advance_clock.
	hud_refresh += delta
	if hud_refresh >= 0.2:
		hud_refresh = 0.0
		refresh_simulation_ui()

func _unhandled_key_input(event: InputEvent) -> void:
	if screen != "game" or not event is InputEventKey or not event.pressed or event.echo: return
	match event.keycode:
		KEY_ESCAPE when guidance.step == Guidance.Step.INTRO: skip_tutorial()
		KEY_SPACE: toggle_pause()
		KEY_1: set_speed(1)
		KEY_2: set_speed(5)
		KEY_3: set_speed(15)
		KEY_ESCAPE: close_inspector()
		KEY_F11:
			var mode := DisplayServer.window_get_mode()
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if mode == DisplayServer.WINDOW_MODE_FULLSCREEN else DisplayServer.WINDOW_MODE_FULLSCREEN)
		_: return
	get_viewport().set_input_as_handled()
