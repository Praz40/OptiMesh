extends "res://scripts/main.gd"
const Model = preload("res://scripts/management_simulation.gd")
const Reference = preload("res://scripts/reference_runs.gd")
const Store = preload("res://scripts/local_store.gd")
const Audio = preload("res://scripts/game_audio.gd")
const Activity = preload("res://scripts/site_activity.gd")
const Face = preload("res://scripts/opti_face.gd")
const MenuActivity = preload("res://scripts/menu_activity.gd")
var menu_activity
var name_keyboard_requested := false
var ribbon_timers: Array=[]
var store = Store.new()
var sound
var mode_name := "Demo"
var pacing := 1.25
var task_panel: Panel
var task_buttons: Array = []
var face
var activity
var message_target := "building"
var message_age := 0.0
var known_status: Dictionary = {}
var rank := 0
var compared: Dictionary = {}
var session_recorded := false
var settings_overlay: Control
var speech_tween: Tween
var last_speech := ""
var grid_warning := false
var comfort_warning := false
var task_toggle: Button
var ribbon_buttons: Array=[]
var ribbon_targets: Array=[]
var companion: Panel
var opti_chip: Button
var guidance_clock := 0.0
var hint_cooldown := 0.0
var hints_seen: Dictionary={}
var message_priority := 0
var message_history: Array=[]
var forecast_label: Label
var notes_overlay: Control
var action_feedback_until := -1.0

func small_button(text: String,rect: Rect2,callback: Callable,parent: Node=null) -> Button:
	var item=button(text,rect,callback,parent)
	item.add_theme_font_size_override("font_size",17)
	for state in ["normal","hover","pressed","focus"]:
		var box=item.get_theme_stylebox(state).duplicate()
		box.content_margin_left=8
		box.content_margin_right=8
		item.add_theme_stylebox_override(state,box)
	item.size=rect.size
	return item

func hud_card(rect: Rect2,title: String,color: Color=INK) -> Label:
	var card=panel(rect)
	label(title,Rect2(12,3,rect.size.x-24,22),14,MUTED,card)
	var value=label("",Rect2(12,25,rect.size.x-24,41),29,color,card)
	label("",Rect2(12,68,rect.size.x-24,19),12,MUTED,card)
	return value

func _ready() -> void:
	simulation=Model.new()
	sound=Audio.new()
	sound.settings=store.data
	add_child(sound)
	super._ready()
	theme.set_color("font_focus_color","CheckButton",INK)

func button(text: String, rect: Rect2, callback: Callable, parent: Node = null, primary: bool = false) -> Button:
	var item=super.button(text,rect,func():
		if is_instance_valid(sound): sound.cue("click")
		callback.call()
	,parent,primary)
	item.add_theme_color_override("font_focus_color",Color.WHITE if primary else INK)
	return item

func toggle_fullscreen() -> void:
	var mode := DisplayServer.window_get_mode()
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if mode in [DisplayServer.WINDOW_MODE_FULLSCREEN,DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN] else DisplayServer.WINDOW_MODE_FULLSCREEN)

func keyboard_supported() -> bool:
	return DisplayServer.has_feature(DisplayServer.FEATURE_VIRTUAL_KEYBOARD)

func show_name_keyboard() -> void:
	DisplayServer.virtual_keyboard_show(name_input.text,name_input.get_screen_transform()*Rect2(Vector2.ZERO,name_input.size),DisplayServer.KEYBOARD_TYPE_DEFAULT,24,name_input.caret_column,name_input.caret_column)

func hide_name_keyboard() -> void:
	if name_keyboard_requested and keyboard_supported(): DisplayServer.virtual_keyboard_hide()
	name_keyboard_requested=false

func request_name_keyboard() -> void:
	name_input.grab_focus()
	name_input.edit()
	if keyboard_supported() and not name_keyboard_requested:
		name_keyboard_requested=true
		show_name_keyboard()

func clear_screen(next: String) -> void:
	hide_name_keyboard()
	menu_activity=null
	# Touch-to-mouse dispatch may still be visiting the old controls. Keep them
	# in the tree, hidden, until queue_free retires them at the end of the frame.
	if is_instance_valid(ui):
		ui.hide()
		ui.queue_free()
	ui=Control.new()
	ui.name="Screen"
	ui.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(ui)
	screen=next

func menu_background() -> void:
	super.menu_background()
	if screen!="start": return
	for node in ui.get_children():
		if node is SiteMap:
			node.living_site=true
			node.modulate=Color(1,1,1,0.85)
			menu_activity=MenuActivity.new()
			menu_activity.reduced=not store.data.ambient
			node.add_child(menu_activity)

func show_name() -> void:
	super.show_name()
	name_input.virtual_keyboard_show_on_focus=false
	name_input.size.y=84
	name_input.focus_exited.connect(hide_name_keyboard)
	find_caption(ui,"← Back").size=Vector2(220,64)
	button("Use Guest",Rect2(280,550,180,64),func(): name_input.text="Guest"; submit_name(),name_input.get_parent())
	if not keyboard_supported():
		name_error.text="Windows: open the system touch keyboard to type."
		name_error.add_theme_font_size_override("font_size",17)
		name_error.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
		name_error.add_theme_color_override("font_color",MUTED)

func show_start() -> void:
	super.show_start()
	button("Fullscreen",Rect2(1690,105,205,64),toggle_fullscreen)
	for item in all_labels(ui):
		if "local desktop prototype" in item.text: item.text="Local office challenge · 8 or 20 min"
		elif "Explore a small workplace" in item.text: item.text="Run an office day. Keep services ready and discover what coordinated energy can do."
	# Separate menu links, comfortably outside the welcome card.
	button("Leaderboard",Rect2(80,910,240,55),show_leaderboard)
	button("Audio / display",Rect2(335,910,245,55),show_settings)

func brand(show_version: bool = true) -> void:
	super.brand(show_version)
	for item in all_labels(ui):
		if item.text=="GUIDED OFFICE DAY  /  03": item.text="EXHIBITION OFFICE DAY  /  04"

func show_modes() -> void:
	super.show_modes()
	var demo_button=find_caption(ui,"Start Demo  →")
	for connection in demo_button.pressed.get_connections(): demo_button.pressed.disconnect(connection.callable)
	demo_button.pressed.connect(func(): mode_name="Demo"; start_demo())
	var unavailable=find_caption(ui,"Not available yet")
	if unavailable:
		unavailable.text="Start Normal  →"
		unavailable.disabled=false
		for connection in unavailable.pressed.get_connections(): unavailable.pressed.disconnect(connection.callable)
		unavailable.pressed.connect(func(): mode_name="Normal"; start_demo())
	for node in all_labels(ui):
		if node.text=="COMING LATER": node.text="TAKE YOUR TIME"
		elif "More scenarios" in node.text: node.text="The same fair office challenge at a slower pace: about 20 minutes, plus time to plan."
		elif "Simulate a clear office day" in node.text: node.text="Eight minutes of site management: EVs, comfort, weather, maintenance and a grid challenge."

func find_caption(node: Node, caption: String) -> Button:
	if node is Control and not node.visible: return null
	if node is Button and node.text==caption: return node
	for child in node.get_children():
		var found=find_caption(child,caption)
		if found: return found
	return null

func all_labels(node: Node) -> Array:
	var items: Array=[]
	if node is Label: items.append(node)
	for child in node.get_children(): items.append_array(all_labels(child))
	return items

func start_demo() -> void:
	if screen=="modes" and mode_name!="Normal": mode_name="Demo"
	pacing=0.5 if mode_name=="Normal" else 1.25
	known_status.clear()
	session_recorded=false
	compared.clear()
	task_buttons.clear()
	task_panel=null
	face=null
	activity=null
	message_age=0
	grid_warning=false
	comfort_warning=false
	hints_seen.clear()
	hint_cooldown=0
	guidance_clock=0
	message_priority=0
	message_history.clear()
	last_speech=""
	message_target="ev_1"
	action_feedback_until=-1
	super.start_demo()
	for item in all_labels(intro_overlay):
		if "Get EV 01" in item.text: item.text="Keep the office ready for everyone."
		elif "Manage one office" in item.text: item.text="Charge vehicles on time, keep people comfortable and finish tasks. Coordinate power to lower costs and peaks."
		elif "Inspect the site" in item.text: item.text="Opti will flag arrivals, weather and changing deadlines. Click a task to find its controls. Learn the basics first, or skip."

func show_game() -> void:
	clear_screen("game")
	label("◈ OptiMesh",Rect2(30,15,300,40),30,GREEN)
	label(mode_name+" · "+player_name,Rect2(34,58,310,28),16,MUTED)
	clock_label=hud_card(Rect2(350,12,175,92),"OFFICE DAY",GREEN)
	clock_detail=clock_label.get_parent().get_child(2)
	clock_detail.add_theme_font_size_override("font_size",14)
	price_label=hud_card(Rect2(540,12,210,92),"POWER PRICE")
	price_label.get_parent().get_child(2).text="Import / kWh · export earns €0"
	grid_label=hud_card(Rect2(765,12,260,92),"GRID")
	grid_title=grid_label.get_parent().get_child(0)
	grid_detail=grid_label.get_parent().get_child(2)
	solar_label=hud_card(Rect2(1040,12,215,92),"SOLAR",GREEN)
	solar_detail=solar_label.get_parent().get_child(2)
	var transport=panel(Rect2(1270,12,420,92))
	pause_button=small_button("Pause",Rect2(10,12,92,38),toggle_pause,transport)
	for index in range(3):
		var rate: int=[1,5,15][index]
		var item=small_button("%d×" % rate,Rect2(110+index*75,12,67,38),set_speed.bind(rate),transport)
		item.name="Speed%d" % rate
	small_button("Reset day",Rect2(10,56,130,29),reset_clock,transport)
	label("Space: pause · 1/2/3: speed",Rect2(150,59,255,23),13,MUTED,transport)
	small_button("Settings",Rect2(1705,14,105,40),show_settings)
	small_button("Menu",Rect2(1820,14,75,40),show_start)
	objective_label=paragraph("",Rect2(34,120,370,45),18,INK)
	forecast_label=label("",Rect2(34,171,370,26),15,MUTED)
	ribbon_buttons.clear()
	ribbon_timers.clear()
	for i in range(2):
		var index: int=i
		var item=small_button("",Rect2(420+i*635,120,620,105),func(): select_ribbon(index))
		item.alignment=HORIZONTAL_ALIGNMENT_LEFT
		item.add_theme_font_size_override("font_size",19)
		ribbon_buttons.append(item)
		var timer=ProgressBar.new()
		timer.show_percentage=false
		timer.mouse_filter=Control.MOUSE_FILTER_IGNORE
		place(timer,Rect2(12,96,596,5),item)
		ribbon_timers.append(timer)
	task_toggle=small_button("All tasks",Rect2(1700,130,195,50),toggle_tasks)
	site=SiteMap.new()
	site.living_site=true
	place(site,Rect2(85,235,1380,620))
	site.scale=Vector2.ONE*1.27
	site.clip_contents=true
	site.object_selected.connect(select_object)
	activity=Activity.new()
	activity.model=simulation
	activity.reduced=not store.data.ambient
	site.add_child(activity)
	inspector=panel(Rect2(1480,228,406,800))
	show_inspector_empty()
	task_panel=panel(Rect2(34,225,380,650))
	label("ALL TASKS · RESULTS STAY HERE",Rect2(18,12,342,30),16,GREEN,task_panel)
	task_buttons.clear()
	for i in range(7):
		var item=small_button("",Rect2(12,53+i*80,356,74),func(): pass,task_panel)
		item.add_theme_font_size_override("font_size",18)
		item.alignment=HORIZONTAL_ALIGNMENT_LEFT
		task_buttons.append(item)
	task_panel.visible=false
	# Inherited refresh fields remain available; their detailed card is hidden.
	var hidden=Control.new()
	place(hidden,Rect2(0,0,1,1))
	hidden.visible=false
	snapshot_label=label("",Rect2(0,0,1,1),12,INK,hidden)
	fps_label=label("",Rect2(0,0,1,1),12,INK,hidden)
	upcoming_label=label("",Rect2(0,0,1,1),12,INK,hidden)
	ev_status_label=label("",Rect2(0,0,1,1),12,INK,hidden)
	companion=panel(Rect2(450,936,1020,130),Color("#dae9e0"))
	face=Face.new()
	place(face,Rect2(15,24,56,56),companion)
	guide_title=label("OPTI · YOUR COLLEAGUE",Rect2(85,8,780,26),15,GREEN,companion)
	assistant_message=paragraph("",Rect2(85,38,825,88),20,INK,companion)
	guide_button=small_button("Inspect",Rect2(816,7,184,32),guide_action,companion)
	small_button("Recent notes",Rect2(656,7,150,32),show_notice_history,companion)
	guide_skip=small_button("Skip",Rect2(924,90,75,32),skip_tutorial,companion)
	opti_chip=small_button("Opti · current tip",Rect2(805,1015,280,45),func(): companion.visible=true; opti_chip.visible=false; guidance_clock=0)
	opti_chip.visible=false
	_update_speed_buttons()
	refresh_guidance()
	refresh_simulation_ui()

func toggle_tasks() -> void:
	task_panel.visible=not task_panel.visible
	if task_panel.visible: inspector.visible=false

func select_ribbon(index: int) -> void:
	if ribbon_targets[index]=="__speed": set_speed(5)
	else: select_object(ribbon_targets[index])

func select_object(id: String) -> void:
	if not objects.has(id): return
	task_panel.visible=false
	inspector.visible=true
	inspector.position.x=34 if id in ["battery","grid","inverter","flex"] else 1480
	super.select_object(id)
	refresh_simulation_ui()

func close_inspector() -> void:
	super.close_inspector()
	inspector.visible=false

func guide_action() -> void:
	if guidance.active():
		super.guide_action()
		if not guidance.active(): close_inspector()
	else:
		select_object(message_target)

func refresh_guidance() -> void:
	super.refresh_guidance()
	if not guidance.active():
		guide_button.visible=true
		guide_button.text="Open "+({"ev_1":"EV 01","ev_2":"EV 02","ev_3":"EV 03","battery":"battery","hvac":"climate","solar":"solar","grid":"grid","flex":"wash"}.get(message_target,"site"))
		guide_skip.visible=true
		guide_skip.text="Got it"
	if is_instance_valid(face):
		face.worried=simulation.grid_kw>18 or simulation.inside_c>25
		face.queue_redraw()
	if last_speech!=assistant_message.text:
		last_speech=assistant_message.text
		if speech_tween and speech_tween.is_valid(): speech_tween.kill()
		guidance_clock=0
		companion.visible=true
		opti_chip.visible=false
		assistant_message.modulate.a=0.75
		speech_tween=assistant_message.create_tween()
		speech_tween.tween_property(assistant_message,"modulate:a",1.0,0.25)

func dismiss_intro() -> void:
	if is_instance_valid(intro_overlay):
		intro_overlay.hide()
		intro_overlay.queue_free()
	intro_overlay=null

func empty_inspector() -> void:
	for child in inspector.get_children():
		if child is CanvasItem: child.hide()
		child.queue_free()
	control_buttons.clear()
	inspector_values.clear()

func skip_tutorial() -> void:
	if guidance.active():
		super.skip_tutorial()
		context_note="Charging uses power alongside the office. Tap the highlighted task to compare charge rates; pause while you plan."
		message_target="ev_1"
		refresh_guidance()
	else:
		companion.visible=false
		opti_chip.visible=true

func show_inspector_empty() -> void:
	empty_inspector()
	inspector.visible=false

func _sync_readings() -> void:
	super._sync_readings()
	for id in ["building","grid","inverter"]: objects[id].controls=[]
	objects.solar.description="Weather and dust affect generation. Cleaning costs €2 and takes 15 minutes offline."
	objects.solar.controls=["Clean"]
	objects.solar.mode="Cleaning" if simulation.cleaning_end>elapsed_minutes else "Dirty" if simulation.dirty else "Clean"
	objects.solar.values[3]=["Panels / weather",("Cleaning" if simulation.cleaning_end>elapsed_minutes else ("Dirty · 75%" if simulation.dirty else "Clean"))+" / "+("Clouds" if simulation.weather_factor(elapsed_minutes)<1 else "Clear")]
	if simulation.ev_power_kw>0: objects.ev_1.values[4][1]=time_text(ceil(simulation.ev_completion_minute()))
	objects.hvac.type="OFFICE CLIMATE"
	objects.hvac.description="Eco saves power but allows heat buildup. Normal balances cooling; Boost cools faster. Aim for 20–25°C."
	objects.hvac.mode=simulation.hvac_mode
	objects.hvac.values=[["Inside / outside","%.1f / %.1f°C" % [simulation.inside_c,simulation.outside_c]],["Cooling / trend","%.1f kW · %+.1f°C / hour" % [simulation.hvac_kw,simulation.temperature_slope*60]],["Comfortable time","%.0f%% · goal 95%%" % simulation.comfort_percent()],["Comfort range","20–25°C"]]
	var wash_state: String="Done · power stopped" if simulation.flex_minutes>=60-0.001 else "Deadline missed" if elapsed_minutes>=900 else "Opens at 11:00" if elapsed_minutes<660 else "Running" if simulation.flex_kw>0 else "Paused · progress saved" if simulation.flex_minutes>0 else "Ready to start"
	objects.flex={"name":"Equipment wash","type":"FLEXIBLE OFFICE LOAD","code":"WASH","color":"#6d99ba","description":"Run a 6 kW equipment wash for 60 minutes between 11:00 and 15:00. You may pause and resume; progress is retained.","values":[["Runtime","%.0f / 60 min" % simulation.flex_minutes],["Power","%.1f kW" % simulation.flex_kw],["Latest restart",time_text(900-maxf(0,60-simulation.flex_minutes))],["State",wash_state]],"controls":["Run","Pause"],"mode":"Run" if simulation.flex_running else "Pause"}
	if simulation.flex_minutes>=60-0.001: objects.flex.mode="Complete"
	elif elapsed_minutes>=900: objects.flex.mode="Window closed"
	for v in simulation.vehicles:
		var soc: float=v.energy/v.capacity*100
		var eta: float=elapsed_minutes+(v.capacity*v.target/100-v.energy)*60/maxf(v.power*0.9,0.0001)
		var state: String="Departed" if v.departed else ("Connected" if elapsed_minutes>=v.arrival else "Not arrived")
		objects[v.id].type="EV CHARGING BAY"
		objects[v.id].description="Choose its charge rate. Meet the target before departure; arrival and deadline are shown below."
		objects[v.id].mode=v.mode
		objects[v.id].values=[["Charge / target","%.1f%% / %.0f%%" % [soc,v.target]],["Power / maximum","%.1f / %.0f kW" % [v.power,v.maximum]],["Arrival / departure",time_text(v.arrival)+" / "+time_text(v.departure)],["State",state],["Target ETA",time_text(ceil(eta)) if v.power>0 else ("Target reached" if soc>=v.target-0.001 else "No charging")],["Departure result","%.1f%% · %s" % [v.departure_soc if v.success else floorf(v.departure_soc*10)/10,"Ready" if v.success else "Missed"] if v.departed else "Pending"]]

func _control_note() -> String:
	match selected_id:
		"solar": return "Solar offline until %s; cleaning is paid and in progress." % time_text(ceil(simulation.cleaning_end)) if simulation.cleaning_end>0 else "Dust reduces generation by 25%. Cleaning costs €2 and takes solar offline for 15 minutes." if simulation.dirty else "Panels are clean. No maintenance needed."
		"battery":
			if simulation.battery_soc()<0.1: return "Battery empty. Charge in a low-demand period to rebuild reserve."
			if simulation.battery_soc()>99.9: return "Battery full. Charging stops automatically; Hold keeps the reserve."
			return "Charge buys or stores 15 kW. Discharge supplies 15 kW, even if the surplus is exported for €0."
		"flex": return "Wash complete; its power draw has stopped." if simulation.flex_minutes>=60-0.001 else "Latest restart: %s. Pausing keeps your progress." % time_text(900-(60-simulation.flex_minutes))
		"hvac": return "Trend %+.1f°C/hour. Keep 20–25°C for 95%% of the day. Normal is a safe starting point." % (simulation.temperature_slope*60)
	if selected_id.begins_with("ev_"):
		var plan: Dictionary=ev_plan(selected_id)
		if plan.departed: return "Departure result is final. Other services still earn points."
		if plan.ready: return "Target reached. Charging stopped automatically; this car is ready to leave."
		if not plan.connected: return "The selected rate applies on arrival. No power is used yet."
		return "Compare ETA with departure. Fast uses 11 kW; Normal 7 kW; Low 3 kW."
	return "Monitoring only. The grid supplies demand left after solar and storage."

func show_object_panel() -> void:
	action_feedback_until=-1
	super.show_object_panel()
	for value in inspector_values: value.get_parent().get_child(0).add_theme_font_size_override("font_size",15)
	feedback.position.y=712
	feedback.size.y=78
	for item in all_labels(inspector):
		if item.text=="CONTROL INTENT": item.text="CHOOSE A MODE"
	if objects[selected_id].controls.is_empty():
		for item in all_labels(inspector):
			if item.text=="CHOOSE A MODE": item.visible=false
		selection_mode.visible=false
		feedback.position.y=555
		feedback.text="Monitoring only. The grid automatically supplies whatever solar and storage cannot cover."
		inspector.size.y=640
	else: inspector.size.y=800

func apply_control(mode: String) -> void:
	if selected_id=="" or day_finished: return
	var previous_grid: float=simulation.grid_kw
	var accepted: bool=simulation.control(selected_id,mode)
	if selected_id in ["grid","building","inverter"] or (selected_id=="solar" and mode=="Overview"): accepted=true
	if accepted: objects[selected_id].mode=mode
	guidance.controlled(selected_id)
	sound.cue("clean" if selected_id=="solar" and mode=="Clean" and accepted else "click")
	refresh_simulation_ui()
	_update_mode_buttons()
	feedback.text=action_explanation(selected_id,mode,previous_grid) if accepted else "Unavailable now. Check arrival, completion or the task window."
	action_feedback_until=elapsed_minutes+10
	if not guidance.active() and accepted and (message_priority<3 or message_age>=6):
		var key: String="action_"+selected_id+mode
		if selected_id in ["solar","flex"] and not hints_seen.has(key):
			context_note=feedback.text
			message_target=selected_id
			hints_seen[key]=true
		elif selected_id.begins_with("ev_") and "on track" in feedback.text and hints_seen.get("ev_risk_"+selected_id,false) and not hints_seen.has("recovery_"+selected_id):
			context_note="Nice recovery! "+feedback.text
			message_target=selected_id
			hints_seen["recovery_"+selected_id]=true
	refresh_guidance()

func action_explanation(id: String,mode: String,previous_grid: float) -> String:
	var grid: String="Grid %+.1f → %+.1f kW (+ importing)." % [previous_grid,simulation.grid_kw]
	if id=="battery": return mode+" · battery %+.1f kW. " % simulation.battery_power_kw+grid
	if id=="hvac": return "%s · %.1f kW · %+.1f°C/hour. " % [mode,simulation.hvac_kw,simulation.temperature_slope*60]+("Watch 25°C. " if mode=="Eco" else "Comfort goal: 95%. ")+grid
	if id=="flex": return ("Wash running at 6 kW. Finish 60 minutes by 15:00. " if simulation.flex_kw>0 else "Wash paused or complete; progress is saved. ")+grid
	if id=="solar": return "Cleaning underway: €2, solar offline until "+time_text(simulation.cleaning_end)+". Then full output returns."
	if id.begins_with("ev_"):
		var info: Dictionary=ev_plan(id)
		if info.departed: return "Vehicle departed; its recorded result is final."
		if info.ready: return "Target reached. Charging has stopped."
		if not info.connected: return "No car yet. This mode applies at arrival; there is no power draw now."
		if info.power==0: return "Charging paused. The departure deadline still applies."
		return "%s · %.1f kW · ETA %s, %s.\nGrid %+.1f → %+.1f kW." % [mode,info.power,time_text(ceil(info.eta)),"on track" if info.eta<=info.deadline else "too late",previous_grid,simulation.grid_kw]
	return "Live readings; the grid balances site demand."

func ev_plan(id: String) -> Dictionary:
	if id=="ev_1": return {"power":simulation.ev_power_kw,"eta":simulation.ev_completion_minute(),"deadline":simulation.config.ev_departure_minute,"ready":simulation.ev_target_reached,"departed":simulation.ev_departed,"connected":true}
	var v: Dictionary=simulation.vehicle(id)
	return {"power":v.power,"eta":elapsed_minutes+(v.capacity*v.target/100-v.energy)*60/maxf(v.power*0.9,0.0001),"deadline":v.departure,"ready":v.energy>=v.capacity*v.target/100-0.001,"departed":v.departed,"connected":elapsed_minutes>=v.arrival}

func _update_mode_buttons() -> void:
	super._update_mode_buttons()
	refresh_control_availability()

func refresh_control_availability() -> void:
	for mode in control_buttons:
		var disabled:=false
		if selected_id.begins_with("ev_"):
			var info: Dictionary=ev_plan(selected_id)
			disabled=info.departed or info.ready
		elif selected_id=="solar" and mode=="Clean": disabled=not simulation.dirty or simulation.cleaning_end>0
		elif selected_id=="flex": disabled=elapsed_minutes<660 or elapsed_minutes>=900 or simulation.flex_minutes>=60
		control_buttons[mode].disabled=disabled or day_finished

func refresh_simulation_ui() -> void:
	super.refresh_simulation_ui()
	if not is_instance_valid(task_panel): return
	simulation.update_tasks()
	objective_label.text="Next decision\nTap a task for its controls"
	clock_detail.text="Paused · take your time" if paused else "%d× · %.2f game min/s" % [speed,pacing*speed]
	grid_title.text="GRID · IMPORTING" if simulation.grid_kw>=0 else "GRID · EXPORTING"
	grid_label.add_theme_color_override("font_color",Color("#ad5143") if elapsed_minutes>=930 and elapsed_minutes<975 and simulation.grid_kw>18 else INK)
	grid_detail.text="18 kW LIMIT · %.1f / 5 min over" % simulation.limit_excess_minutes if elapsed_minutes>=930 and elapsed_minutes<975 else "Tap grid for peak and bill"
	solar_detail.text="Live generation · tap for details"
	var next: Array=[]
	for event in Model.Scenario.EVENTS:
		if event[0]>elapsed_minutes:
			next=event
			break
	upcoming_label.text=time_text(next[0])+" · "+str(next[1]).replace("_"," ").capitalize() if not next.is_empty() else "18:00 · Results"
	var forecasts: Array=[[660,"11:00 cheap power"],[690,"11:30 clouds"],[735,"12:15 solar returns"],[900,"15:00 higher price"],[930,"15:30 grid limit"],[975,"16:15 limit ends"],[1080,"18:00 results"]]
	for forecast in forecasts:
		if elapsed_minutes<forecast[0]:
			forecast_label.text="Next · "+forecast[1]
			break
	ev_status_label.text="18 kW grid limit at 15:30" if elapsed_minutes<930 else "Comfort target: 95% of day"
	task_toggle.text="All tasks (%d)" % simulation.tasks.size()
	var ordered: Array=[]
	for task in simulation.tasks:
		if task.status!="active": continue
		if task.id.begins_with("ev_") and ev_plan(task.id).ready: continue
		if task.id=="comfort" and not task_at_risk(task): continue
		ordered.append(task)
	ordered.sort_custom(func(a,b):
		var urgency_a: float=task_urgency(a)
		var urgency_b: float=task_urgency(b)
		return urgency_a<urgency_b if not is_equal_approx(urgency_a,urgency_b) else a.deadline<b.deadline)
	ribbon_targets.clear()
	for i in range(ribbon_buttons.size()):
		var item: Button=ribbon_buttons[i]
		var timer: ProgressBar=ribbon_timers[i]
		timer.visible=false
		if i<ordered.size():
			var task: Dictionary=ordered[i]
			var countdown: Dictionary=task_timer(task)
			item.text=task.title+"\n"+task_detail(task)+("\n"+countdown.text if countdown.visible else "")
			timer.visible=countdown.visible
			timer.value=countdown.ratio*100
			style_task_card(item,timer,"risk" if task_at_risk(task) else "primary" if i==0 else "quiet")
			item.add_theme_color_override("font_color",Color("#ad5143") if task_at_risk(task) else INK)
			item.add_theme_color_override("font_focus_color",Color("#ad5143") if task_at_risk(task) else INK)
			item.add_theme_color_override("font_hover_color",Color("#ad5143") if task_at_risk(task) else GREEN)
			item.tooltip_text=task.description+". Click for controls."
			ribbon_targets.append(task.object)
		else:
			style_task_card(item,timer,"quiet")
			var tip: Dictionary=opportunity()
			if i==2 and ordered.size()==1: tip={"title":"Climate · %.1f°C" % simulation.inside_c,"text":"%.0f%% comfortable · goal 95%%" % simulation.comfort_percent(),"object":"hvac"}
			if i==2 and elapsed_minutes>=990: tip={"title":"Ready for the last hour?","text":"Click for 5× · comfort still matters","object":"__speed"}
			item.text=tip.title+"\n"+tip.text
			item.add_theme_color_override("font_color",GREEN)
			item.add_theme_color_override("font_focus_color",INK)
			item.add_theme_color_override("font_hover_color",GREEN)
			item.tooltip_text="Planning opportunity · click to inspect"
			ribbon_targets.append(tip.object)
	for i in range(task_buttons.size()):
		var item: Button=task_buttons[i]
		item.visible=i<simulation.tasks.size()
		if not item.visible: continue
		var task: Dictionary=simulation.tasks[i]
		item.text=("✓ " if task.status=="completed" else ("× " if task.status=="failed" else "• "))+task.title+" · "+time_text(task.deadline)+"\n"+(task_detail(task) if task.status=="active" else task.progress)
		item.tooltip_text=task.description+" · "+task.status.capitalize()
		item.add_theme_color_override("font_color",Color("#ad5143") if task.status=="failed" else GREEN if task.status=="completed" else INK)
		if item.get_meta("target","")!=task.object:
			for connection in item.pressed.get_connections(): item.pressed.disconnect(connection.callable)
			item.pressed.connect(select_object.bind(task.object))
			item.set_meta("target",task.object)
		if known_status.get(task.id,"active")!=task.status and not task.id.begins_with("ev_"):
			simulation.notices.append({"time":elapsed_minutes,"type":"resolved","object":task.object,"text":task_explanation(task)})
		known_status[task.id]=task.status
	if selected_id.begins_with("ev_") and inspector_values.size()>=5:
		var plan: Dictionary=ev_plan(selected_id)
		inspector_values[4].add_theme_color_override("font_color",Color("#ad5143") if not plan.ready and not plan.departed and plan.connected and (plan.power==0 or plan.eta>plan.deadline) else GREEN)
		if plan.departed and not plan.ready: inspector_values[4].text="Departed below target"
	elif selected_id=="hvac" and inspector_values.size()>=3:
		inspector_values[0].add_theme_color_override("font_color",Color("#ad5143") if simulation.inside_c>24.5 else INK)
	if selected_id!="" and is_instance_valid(feedback) and elapsed_minutes>=action_feedback_until: feedback.text=_control_note()
	if selected_id!="" and is_instance_valid(selection_mode):
		var current_mode: String="Setting: "+objects[selected_id].mode
		if selection_mode.text!=current_mode: _update_mode_buttons()
		else: refresh_control_availability()

func style_task_card(item: Button,timer: ProgressBar,state: String) -> void:
	if item.get_meta("visual_state","")==state: return
	item.set_meta("visual_state",state)
	var fill=StyleBoxFlat.new()
	fill.bg_color=Color("#ad5143") if state=="risk" else GREEN
	timer.add_theme_stylebox_override("fill",fill)
	var card_style=item.get_theme_stylebox("normal").duplicate()
	card_style.bg_color=Color("#f1dfd5") if state=="risk" else Color("#dae9e0") if state=="primary" else PAPER
	item.add_theme_stylebox_override("normal",card_style)

func task_timer(task: Dictionary) -> Dictionary:
	var result := {"visible":false,"text":"","ratio":0.0,"minutes":0}
	if task.status!="active" or task.id=="comfort": return result
	if task.id.begins_with("ev_") and ev_plan(task.id).ready: return result
	var starts := {"ev_1":480.0,"ev_2":630.0,"ev_3":810.0,"flex":660.0,"solar":780.0,"grid":930.0}
	if not starts.has(task.id): return result
	var remaining: float=maxf(0,task.deadline-elapsed_minutes)
	result.visible=true
	result.minutes=ceili(remaining)
	result.ratio=clampf(remaining/maxf(1,task.deadline-starts[task.id]),0,1)
	var prefix: String="Ends in " if task.id=="grid" else "Due in "
	if remaining<=0: prefix="DEADLINE · "
	elif task_at_risk(task): prefix="ACT NOW · "
	elif remaining<=20 and task.id!="grid": prefix="SOON · "
	result.text=prefix+"%d min · %s" % [result.minutes,time_text(task.deadline)]
	return result

func task_urgency(task: Dictionary) -> float:
	if task.id.begins_with("ev_"):
		var plan: Dictionary=ev_plan(task.id)
		if plan.ready: return 2000.0
		if plan.connected and (plan.power==0 or plan.eta>plan.deadline): return -200.0+maxf(0,plan.deadline-elapsed_minutes)*0.1
	if task.id=="grid" and elapsed_minutes>=930 and elapsed_minutes<975: return -300.0 if simulation.grid_kw>18 else -50.0
	if task.id=="comfort": return -250.0 if simulation.inside_c>24.5 or simulation.comfort_percent()<95 else 1500.0
	if task.id=="flex": return 1200.0 if simulation.flex_running else task.deadline-elapsed_minutes-(60-simulation.flex_minutes)
	if task.id=="solar": return 1200.0 if simulation.cleaning_end>0 else task.deadline-elapsed_minutes-15
	return task.deadline-elapsed_minutes

func task_at_risk(task: Dictionary) -> bool:
	if task.id.begins_with("ev_"):
		var plan: Dictionary=ev_plan(task.id)
		return plan.connected and not plan.ready and not plan.departed and (plan.power<=0 or plan.eta>plan.deadline)
	if task.id=="grid": return simulation.grid_kw>18 or simulation.limit_excess_minutes>5
	if task.id=="comfort": return simulation.inside_c>24.5 or simulation.comfort_percent()<95
	if task.id=="flex": return elapsed_minutes+60-simulation.flex_minutes>900
	if task.id=="solar": return (simulation.cleaning_end if simulation.cleaning_end>0 else elapsed_minutes+15)>900
	return false

func task_detail(task: Dictionary) -> String:
	if task.id.begins_with("ev_"):
		var plan: Dictionary=ev_plan(task.id)
		if plan.ready: return "✓ Target reached · charging stopped"
		if plan.power<=0: return task.progress+" · paused!"
		return "%s · ETA %s%s" % [task.progress,time_text(ceil(plan.eta))," !" if plan.eta>plan.deadline else ""]
	if task.id=="flex": return "%s · %s" % [task.progress,"running" if simulation.flex_running else "start by "+time_text(900-(60-simulation.flex_minutes))]
	if task.id=="solar" and simulation.cleaning_end>0: return "Offline until "+time_text(ceil(simulation.cleaning_end))
	return task.progress

func opportunity() -> Dictionary:
	if elapsed_minutes<630: return {"title":"Plan ahead · 11:30 clouds","text":"Battery reserve can bridge the dip","object":"battery"}
	if elapsed_minutes<690: return {"title":"Cheap price until 15:00","text":"Check rates before clouds arrive","object":"ev_2"}
	if elapsed_minutes<735: return {"title":"Clouds until 12:15","text":"Keep stored energy for the grid","object":"battery"}
	if elapsed_minutes<900: return {"title":"Watch the grid before 15:30","text":"Keep battery charge for the limit","object":"battery"}
	if elapsed_minutes<975: return {"title":"Grid challenge · 18 kW","text":"5 min total over is the grace budget","object":"grid"}
	return {"title":"Finish well · results at 18:00","text":"Use the battery, or choose 5× to finish","object":"battery"}

func task_explanation(task: Dictionary) -> String:
	if task.id.begins_with("ev_"):
		var vehicle_name: String=task.id.replace("ev_","EV 0")
		return vehicle_name+" left ready. "+task.progress+" at departure." if task.status=="completed" else vehicle_name+" left below target: "+task.progress+". Start faster charging earlier; other services still earn points."
	if task.status=="completed":
		return {"flex":"Wash finished—nice timing. It draws no more power now.","solar":"Panels are clean again. Full generation is back.","grid":"Grid challenge met. You kept overload within the five-minute grace budget.","comfort":"The office stayed comfortable. Good work."}.get(task.id,"Nice, "+task.title+". "+task.progress+" at departure.")
	match task.id:
		"flex": return "The wash deadline passed at 15:00 with %.0f / 60 minutes done. Next run, start it by 14:00." % simulation.flex_minutes
		"solar": return "Cleaning missed its 15:00 deadline. Dust keeps reducing output; you can still clean to recover generation."
		"grid": return "Grid task missed: %.1f minutes above 18 kW, beyond the 5-minute grace budget. Cooling and charging share this limit." % simulation.limit_excess_minutes
		"comfort": return "Rooms were comfortable for %.0f%% of the day; 95%% was required. Cheap power can't replace comfortable people." % simulation.comfort_percent()
		_: return task.title+" missed its departure target. "+task.progress+". Check charging ETA against the deadline next run."

func advance_clock(delta: float) -> void:
	if screen!="game" or paused or day_finished: return
	simulation.advance(delta*speed*pacing)
	message_age+=delta
	guidance_clock+=delta
	hint_cooldown=maxf(0,hint_cooldown-delta)
	if guidance_clock>18 and not guidance.active():
		companion.visible=false
		opti_chip.visible=true
	var overloaded: bool=elapsed_minutes>=930 and elapsed_minutes<975 and simulation.grid_kw>18
	var hot: bool=simulation.inside_c>24.5 and simulation.hvac_mode=="Eco"
	if (overloaded and not grid_warning) or (hot and not comfort_warning):
		simulation.notices.push_front({"time":elapsed_minutes,"type":"warning","object":"grid" if overloaded else "hvac","text":"We're above 18 kW. There's a 5-minute total grace budget—battery discharge or slower charging can help now." if overloaded else "Rooms are getting warm. Try Normal or Boost before we lose comfort above 25°C."})
	grid_warning=overloaded
	comfort_warning=hot
	if hint_cooldown<=0 and message_age>=12 and simulation.notices.is_empty(): offer_hint()
	var urgent_index: int=-1
	var next_priority := -1
	for index in range(simulation.notices.size()):
		var priority: int=notice_priority(simulation.notices[index].type)
		if priority>next_priority:
			urgent_index=index
			next_priority=priority
	# Give a displayed sentence time to be read. A warning can interrupt a tip,
	# but simultaneous warnings never flicker past one another every frame.
	if urgent_index>=0 and next_priority>=2 and speed>1: set_speed(1)
	if not guidance.active() and urgent_index>=0 and (message_age>=6 or (next_priority>message_priority and message_age>=2)):
		var note: Dictionary=simulation.notices.pop_at(urgent_index)
		if not day_finished and note.type in ["hint","forecast","cloud","clear","tariff","arrival"] and elapsed_minutes-note.time>45:
			return # An old tip should not describe weather or a price that has passed.
		if note.type=="departure":
			for task in simulation.tasks:
				if task.id==note.object: note.text=task_explanation(task)
		if note.type=="surprise" and note.object=="ev_3":
			note.text="Change of plan: the visitor has less charging time. Compare its ETA; faster charging may be needed."
		context_note=note.text
		message_target=note.object
		message_age=0
		message_priority=next_priority
		message_history.push_front({"time":note.time,"text":note.text})
		if message_history.size()>8: message_history.pop_back()
		if note.type in ["arrival","surprise","dust","limit","warning","cloud","tariff"] and speed>1:
			set_speed(1) # Give players time to read and react at exhibition speed.
		sound.cue("warning" if note.type in ["surprise","limit","dust","warning"] else "arrival" if note.type=="arrival" else "departure" if note.type=="departure" else "complete")
		refresh_guidance()
	if day_finished: show_results()

func notice_priority(kind: String) -> int:
	if kind in ["surprise","limit","warning"]: return 3
	if kind in ["arrival","dust","cloud","tariff"]: return 2
	if kind in ["departure","resolved","limit_end"]: return 1
	return 0

func show_notice_history() -> void:
	if is_instance_valid(notes_overlay): return
	var was_paused: bool=paused
	paused=true
	var overlay=Control.new()
	notes_overlay=overlay
	place(overlay,Rect2(0,0,1920,1080))
	var shade=ColorRect.new()
	shade.color=Color(0.12,0.22,0.25,0.45)
	place(shade,Rect2(0,0,1920,1080),overlay)
	var card=panel(Rect2(450,160,1020,760),PAPER,overlay)
	label("Opti's recent notes · day paused",Rect2(30,20,960,55),32,INK,card)
	var history_text:="No events yet. Click tasks to inspect their controls; Space pauses the day."
	if not message_history.is_empty():
		history_text=""
		for note in message_history.slice(0,6): history_text+="%s · %s\n\n" % [time_text(note.time),note.text]
	paragraph(history_text,Rect2(30,90,960,570),20,INK,card)
	button("Back to the site",Rect2(30,680,960,55),func(): overlay.hide(); overlay.queue_free(); notes_overlay=null; paused=was_paused,card,true)

func offer_hint() -> void:
	var key:=""
	var text:=""
	var object:="battery"
	for id in ["ev_1","ev_2","ev_3"]:
		var info: Dictionary=ev_plan(id)
		if not hints_seen.has("ev_risk_"+id) and info.connected and not info.ready and not info.departed and info.deadline-elapsed_minutes<90 and (info.power==0 or info.eta>info.deadline):
			key="ev_risk_"+id
			text=id.replace("ev_","EV 0")+" isn't on track. Open it and compare its ETA with departure; a faster mode may help."
			object=id
			break
	if key=="" and not hints_seen.has("battery_buying") and elapsed_minutes<930 and simulation.battery_mode=="Charge" and simulation.grid_kw>18:
		key="battery_buying"
		text="Charging the battery is pushing our grid demand up. Hold would save that peak; keep some stored energy for 15:30."
	elif key=="" and not hints_seen.has("wash_reminder") and elapsed_minutes>=790 and elapsed_minutes<=835 and simulation.flex_minutes<60 and not simulation.flex_running:
		key="wash_reminder"
		text="The wash still needs %.0f minutes. Start by %s to finish at 15:00; midday power is cheap now." % [60-simulation.flex_minutes,time_text(900-(60-simulation.flex_minutes))]
		object="flex"
	elif key=="" and not hints_seen.has("dust_reminder") and elapsed_minutes>=840 and elapsed_minutes<=875 and simulation.dirty and simulation.cleaning_end<0:
		key="dust_reminder"
		text="Panels are still dirty. Cleaning takes 15 minutes; start by 14:45 to meet the task."
		object="solar"
	elif key=="" and not hints_seen.has("last_hour") and elapsed_minutes>=990:
		key="last_hour"
		text="All cars have left. Keep rooms comfortable and use the battery to lower the bill—or choose 5× in the ribbon to finish."
	elif key=="" and not hints_seen.has("battery_export") and simulation.battery_mode=="Discharge" and simulation.grid_kw< -2:
		key="battery_export"
		text="Stored energy is leaving the site for no payment. Hold keeps that reserve for later demand."
	elif key=="" and not hints_seen.has("battery_low") and simulation.battery_soc()<10 and elapsed_minutes<930:
		key="battery_low"
		text="Our battery is nearly empty. The 15:30 grid limit is still ahead; look for a low-demand window to recharge."
	elif key=="" and not hints_seen.has("solar_export") and simulation.battery_mode!="Discharge" and simulation.grid_kw< -2 and simulation.battery_soc()<90:
		key="solar_export"
		text="We're exporting surplus solar. You could store some in the battery; check the grid after choosing Charge."
	elif key=="" and not hints_seen.has("early_plan") and elapsed_minutes>=550 and elapsed_minutes<630:
		key="early_plan"
		text="EV 01 is set to %s. Check its ETA against departure; faster charging costs power now but frees capacity later." % simulation.ev_mode
		object="ev_1"
	if key!="" and not hints_seen.has(key):
		hints_seen[key]=true
		simulation.notices.append({"time":elapsed_minutes,"type":"hint","object":object,"text":text})
		hint_cooldown=30

func reset_clock() -> void:
	start_demo()

func show_results() -> void:
	results_values=simulation.summary()
	compared={"Normal":Reference.run(false),"Player":results_values,"OptiMesh demo":Reference.run(true)}
	if not session_recorded:
		rank=store.record(player_name,results_values,mode_name)
		session_recorded=true
	clear_screen("results")
	brand()
	sound.cue("results")
	label("Every service ready. Nicely managed." if results_values.ev_met==3 and results_values.comfort>=95 and results_values.flex and results_values.grid else "Day complete. Every decision counted.",Rect2(100,125,1700,80),45)
	label("%s · %d / 1000 points · Local rank #%d (%s)" % [player_name,results_values.score,rank,mode_name],Rect2(105,213,1700,55),29,GREEN)
	label("Same day, real simulations · Normal uses fixed settings; OptiMesh demo coordinates them.",Rect2(105,278,1700,40),22,MUTED)
	var columns: Array=["Normal","Player","OptiMesh demo"]
	for i in range(3):
		var r: Dictionary=compared[columns[i]]
		var card=panel(Rect2(100+i*580,340,540,475),Color("#dae9e0") if i==1 else PAPER)
		label(columns[i],Rect2(28,20,484,50),30,GREEN,card)
		label("%d / 3 vehicles ready" % r.ev_met,Rect2(28,82,484,43),29,GREEN if r.ev_met==3 else Color("#ad5143"),card)
		label("Comfort %.0f%% · goal 95%%" % r.comfort,Rect2(28,131,484,35),23,GREEN if r.comfort>=95 else Color("#ad5143"),card)
		label("Wash %s  ·  Grid %s" % ["done" if r.flex else "missed","met" if r.grid else "missed"],Rect2(28,177,484,35),23,GREEN if r.flex and r.grid else Color("#ad5143"),card)
		label("€%.2f" % r.cost,Rect2(28,230,240,60),44,INK,card)
		label("Energy + maintenance",Rect2(28,289,484,27),17,MUTED,card)
		var bar=ColorRect.new()
		bar.color=GREEN if i==1 else Color("#91b7ab")
		place(bar,Rect2(28,327,clampf(r.cost/maxf(compared.Normal.cost,maxf(compared.Player.cost,compared["OptiMesh demo"].cost)),0,1)*460,9),card)
		paragraph("Peak %.1f kW · import %.1f kWh\nExport %.1f kWh · solar used* %.0f%%\nBattery %.0f%% left · cycles %.2f" % [r.peak,r.import,r.export,r.utilization,r.battery_soc,r.cycles],Rect2(28,352,484,105),20,MUTED,card)
	paragraph(results_advice(),Rect2(105,825,1700,66),21,INK)
	label("About %d base points × %.0f%% service factor → %d. Every recovered service earns points." % [results_values.base_score,results_values.service_factor*100,results_values.score],Rect2(105,891,1340,30),18,GREEN)
	label("*Solar used excludes export. Offline demo controller; not the production optimizer.",Rect2(105,925,1330,25),16,MUTED)
	button("How scoring works",Rect2(1470,903,330,45),show_score_help)
	if store.last_error!="": label(store.last_error,Rect2(105,875,1700,30),18,Color("#ad5143"))
	button("Play Again  →",Rect2(100,966,520,60),start_demo,null,true)
	button("Leaderboard",Rect2(665,966,520,60),show_leaderboard)
	button("Main Menu",Rect2(1230,966,570,60),func(): mode_name="Demo"; show_start())

func results_advice() -> String:
	var r: Dictionary=results_values
	var saving: float=compared.Normal.cost-r.cost
	var cost_note: String="Saved €%.2f versus Normal. " % saving if saving>0 else "Spent €%.2f more than Normal. " % -saving
	if r.comfort<95:
		return cost_note+"Comfort was only %.0f%% (goal 95%%). Keep HVAC Normal or react before 25°C; a cheap bill needs comfortable rooms." % r.comfort
	if r.ev_met<3:
		var missed: Array=[]
		for task in r.tasks:
			if task.id.begins_with("ev_") and task.status=="failed": missed.append(task.title+": "+task.progress)
		return cost_note+"Missed: "+", ".join(missed)+". Compare ETA with departure; EV 03 moves to 16:00. Keep recovering other services for more points."
	if not r.flex: return cost_note+"The wash stopped at %.0f / 60 minutes. Run it by 14:00 to finish before 15:00; midday electricity is cheaper." % simulation.flex_minutes
	if not r.grid: return cost_note+"Grid overload lasted %.1f minutes (budget 5). Save battery charge for 15:30 and slow charging when the warning appears." % r.overload_minutes
	for task in r.tasks:
		if task.id=="solar" and task.status=="failed": return cost_note+"All core services ready, but cleaning missed 15:00. Start its 15-minute service by 14:45 next run."
	return "All services ready. "+cost_note+"Peak %.1f kW versus Normal %.1f kW. Try lowering peak while keeping every service ready." % [r.peak,compared.Normal.peak]

func show_score_help() -> void:
	var overlay=Control.new()
	place(overlay,Rect2(0,0,1920,1080))
	var shade=ColorRect.new()
	shade.color=Color(0.12,0.22,0.25,0.45)
	place(shade,Rect2(0,0,1920,1080),overlay)
	var card=panel(Rect2(490,220,940,640),PAPER,overlay)
	label("Balanced service, then efficiency",Rect2(40,30,860,60),36,INK,card)
	paragraph("Base points: EVs 450 · comfort 150 · wash 100 · grid 70 · cleaning 30 · cost 80 · peak 50 · solar use 50 · battery cycling 20.\n\nService factor: with 0 / 1 / 2 ready EVs, keep 40 / 45 / 50% of base points. Comfort below 80% keeps 40%; below 95% keeps 70%. An unfinished wash keeps 65%. Use the lowest factor, once. Recovering other services still earns points.\n\nCost and peak points fall as bill approaches €45 or peak approaches 60 kW. Solar points follow utilization; cycling points decline over three cycles. Grid allows five minutes over 18 kW.\n\nSame schedule/weather for all runs. The offline reference is a demo heuristic, not the production optimizer. Local ranking uses scoring rules 3.",Rect2(40,110,860,425),20,INK,card)
	button("Got it",Rect2(40,550,860,60),func(): overlay.hide(); overlay.queue_free(),card,true)

func show_leaderboard() -> void:
	clear_screen("leaderboard")
	brand()
	label("Local leaderboard",Rect2(170,150,1500,80),48)
	label("Top runs on this laptop · scoring rules 3 · same scenario for Demo and Normal",Rect2(175,245,1500,45),23,MUTED)
	var ranked: Array=store.current_entries()
	for i in range(mini(10,ranked.size())):
		var entry: Dictionary=ranked[i]
		var row=panel(Rect2(170,320+i*56,1560,50))
		label("#%d  %s" % [i+1,entry.name],Rect2(20,8,580,40),23,INK,row)
		label("%d pts · €%.2f · %s" % [entry.score,entry.cost,entry.mode],Rect2(650,8,850,40),23,GREEN,row)
	button("Main Menu",Rect2(170,940,350,60),func(): mode_name="Demo"; show_start())
	label("Administrator: Ctrl+Shift+Delete, then confirm reset",Rect2(650,950,1100,40),20,MUTED)

func show_settings() -> void:
	if is_instance_valid(settings_overlay): return
	var was_paused:=paused
	paused=true
	settings_overlay=Control.new()
	place(settings_overlay,Rect2(0,0,1920,1080))
	var shade=ColorRect.new()
	shade.color=Color(0.12,0.22,0.25,0.45)
	place(shade,Rect2(0,0,1920,1080),settings_overlay)
	var card=panel(Rect2(590,200,740,680),PAPER,settings_overlay)
	label("Audio and display",Rect2(40,30,660,60),38,INK,card)
	for i in range(2):
		var key: String=["music","effects"][i]
		var volume_label=label(key.capitalize()+" · %.0f%%" % (store.data[key]*100),Rect2(40,120+i*100,430,40),24,INK,card)
		var slider=HSlider.new()
		slider.max_value=1
		slider.step=0.01
		slider.value=store.data[key]
		place(slider,Rect2(40,167+i*100,660,35),card)
		slider.value_changed.connect(func(value): store.data[key]=value; volume_label.text=key.capitalize()+" · %.0f%%" % (value*100); sound.apply_settings())
		slider.drag_ended.connect(func(changed):
			if changed and key=="effects": sound.cue("complete")
		)
	small_button("Test sound",Rect2(505,220,190,40),func(): sound.cue("complete"),card)
	var mute=CheckButton.new()
	mute.text="Mute all audio"
	mute.button_pressed=store.data.mute
	place(mute,Rect2(40,338,660,50),card)
	mute.toggled.connect(func(value): store.data.mute=value; sound.apply_settings())
	var ambient=CheckButton.new()
	ambient.text="Ambient people, clouds and birds"
	ambient.button_pressed=store.data.ambient
	place(ambient,Rect2(40,405,660,50),card)
	ambient.toggled.connect(func(value):
		store.data.ambient=value
		if is_instance_valid(activity): activity.reduced=not value
		if is_instance_valid(menu_activity): menu_activity.reduced=not value
	)
	button("Toggle fullscreen",Rect2(40,475,660,64),toggle_fullscreen,card)
	button("Done",Rect2(40,585,660,64),func(): store.save(); settings_overlay.hide(); settings_overlay.queue_free(); settings_overlay=null; paused=was_paused,card,true)

func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode==KEY_F11:
		toggle_fullscreen()
		get_viewport().set_input_as_handled()
		return
	if screen=="leaderboard" and event is InputEventKey and event.pressed and event.keycode==KEY_DELETE and event.ctrl_pressed and event.shift_pressed:
		var dialog=ConfirmationDialog.new()
		dialog.dialog_text="Erase all local leaderboard entries? Audio settings will stay."
		add_child(dialog)
		dialog.confirmed.connect(func(): store.data.entries=[]; store.save(); show_leaderboard(); dialog.queue_free())
		dialog.canceled.connect(dialog.queue_free)
		dialog.popup_centered(Vector2i(600,180))
		return
	if is_instance_valid(settings_overlay) or is_instance_valid(notes_overlay): return
	super._unhandled_key_input(event)

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode==KEY_F11:
		_unhandled_key_input(event)
		return
	if screen=="name" and event is InputEventScreenTouch and event.pressed and name_input.get_global_rect().has_point(event.position):
		request_name_keyboard()
	# Space must pause even after a mode button has keyboard focus; otherwise
	# Godot activates that button before _unhandled_key_input can see the key.
	if screen=="game" and not is_instance_valid(settings_overlay) and not is_instance_valid(notes_overlay) and event is InputEventKey and event.pressed and not event.echo and event.keycode in [KEY_SPACE,KEY_1,KEY_2,KEY_3]:
		_unhandled_key_input(event)
