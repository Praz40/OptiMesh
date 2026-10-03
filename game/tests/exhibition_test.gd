extends SceneTree
const Reference=preload("res://scripts/reference_runs.gd")
const Store=preload("res://scripts/local_store.gd")
var app
var checks:=0
var failures:=0
var capture:=false
func _initialize() -> void:
	capture="--capture" in OS.get_cmdline_user_args()
	call_deferred("run")
func check(ok: bool,message: String) -> void:
	checks+=1
	if not ok:
		failures+=1
		push_error(message)
func press(caption: String) -> void:
	var item=app.find_caption(app.ui,caption)
	check(item!=null and not item.disabled,"Action available: "+caption)
	if item: item.pressed.emit()
func click(point: Vector2) -> void:
	for down in [true,false]:
		var event=InputEventMouseButton.new()
		event.position=point
		event.global_position=point
		event.button_index=MOUSE_BUTTON_LEFT
		event.pressed=down
		root.push_input(event,true)
func snapshot(caption: String) -> void:
	if not capture: return
	await process_frame
	await RenderingServer.frame_post_draw
	var size:=DisplayServer.window_get_size()
	check(root.get_texture().get_image().save_png("res://artifacts/exhibition_%s_%dx%d.png" % [caption,size.x,size.y])==OK,"Capture "+caption)
func bounds(node: Node) -> void:
	for child in node.get_children():
		if child is Control and node is Panel and child.visible:
			check(child.position.x+child.size.x<=node.size.x+1,"Width containment: "+str(child.name))
			check(child.position.y+child.size.y<=node.size.y+1,"Height containment: "+str(child.name))
		bounds(child)
func run() -> void:
	app=load("res://scenes/main.tscn").instantiate()
	app.store=Store.new("user://exhibition_test.json")
	app.store.data.entries=[]
	app.store.data.mute=true
	root.add_child(app)
	await process_frame
	app.set_process(false)
	check(app.screen=="start" and app.sound.get_child_count()==2,"Menu and bounded audio players")
	check(app.sound.music.stream.loop_mode==AudioStreamWAV.LOOP_FORWARD and app.sound.tones.size()==7,"Original looping music and all SFX generated")
	await snapshot("01_menu")
	press("New Game  →")
	await snapshot("02_name")
	app.name_input.text="  "
	press("Continue  →")
	check(app.screen=="name" and app.name_error.text!="","Invalid name handled")
	app.name_input.text="Exhibition tester"
	press("Continue  →")
	await snapshot("02_modes")
	press("Start Normal  →")
	check(app.mode_name=="Normal" and app.pacing==0.5,"Normal pacing")
	app.skip_tutorial()
	app.show_modes()
	press("Start Demo  →")
	check(app.pacing==1.25 and app.mode_name=="Demo" and app.paused,"Demo introduction/pacing")
	await snapshot("03_intro")
	press("Continue  →")
	app.guide_action()
	app.guide_action()
	await snapshot("tutorial_ev")
	app.apply_control("Normal")
	app.guide_action()
	app.apply_control("Hold")
	press("Got it")
	check(not app.guidance.active() and not app.paused,"Existing onboarding completes on real controls")
	app.skip_tutorial()
	check(app.opti_chip.visible and not app.companion.visible,"Acknowledged tip collapses to compact chip")
	press("Opti · current tip")
	check(app.companion.visible and not app.opti_chip.visible,"Reopening current tip restores one readable message")
	await snapshot("quiet_site")
	check(app.site.size.x*app.site.scale.x>1700 and not app.inspector.visible and not app.task_panel.visible,"World dominates with contextual panels collapsed")
	app.toggle_tasks()
	check(app.task_panel.visible,"Task history discoverable on demand")
	await snapshot("task_drawer")
	click(Vector2(560,160))
	check(app.selected_id=="ev_1","Real viewport task click selects system")
	check(app.ribbon_buttons[0].get_theme_color("font_focus_color").get_luminance()<0.3,"Focused task text retains contrast on pale card")
	press("×")
	click(Vector2(1482,850))
	check(app.selected_id=="battery","Scaled live map badge picks battery")
	check(not app.task_panel.visible and app.inspector.visible,"Selection closes task drawer and opens contextual inspector")
	app.apply_control("Discharge")
	check("kW" in app.feedback.text,"Battery action explains numeric power consequence")
	app.apply_control("Hold")
	press("×")
	click(Vector2(1350,637))
	check(app.selected_id=="flex","Wash equipment is directly clickable on map")
	app.select_object("grid")
	check(app.control_buttons.is_empty(),"Monitoring-only grid has no misleading mode controls")
	app.select_object("battery")
	await snapshot("04_tasks")
	bounds(app.ui)
	# Reactive player plan, routed through actual inspector actions, not the reference.
	for minute in range(600):
		var actions: Dictionary={255:["flex","Run"],270:["battery","Charge"],300:["solar","Clean"],330:["battery","Hold"],390:["ev_3","Fast"],450:["battery","Discharge"],495:["battery","Hold"]}
		if actions.has(minute):
			app.select_object(actions[minute][0])
			app.apply_control(actions[minute][1])
		app.advance_clock(0.8)
		if app.screen=="game": app.refresh_simulation_ui()
		if minute in [149,210,299,389,449,494]:
			if app.screen=="game":
				app.select_object("hvac" if minute==210 else "ev_3" if minute==389 else "grid" if minute==449 else "solar" if minute==299 else "ev_2")
				await snapshot("day_%d" % minute)
				bounds(app.ui)
				if minute==389:
					app.show_notice_history()
					await snapshot("recent_notes")
					bounds(app.ui)
					press("Back to the site")
	check(app.screen=="results" and app.results_values.ev_met==3,"Full management playthrough reaches results")
	check(app.results_values.flex and app.results_values.grid and app.results_values.comfort>=95,"All services feasible together")
	check(app.compared.Normal==Reference.run(false) and app.compared["OptiMesh demo"]==Reference.run(true),"Comparison calculated from same scenario")
	check(app.store.data.entries.size()==1,"One entry per finished run")
	await snapshot("05_results")
	bounds(app.ui)
	press("How scoring works")
	await snapshot("score_help")
	bounds(app.ui)
	press("Got it")
	press("Leaderboard")
	check(app.screen=="leaderboard","Leaderboard navigates")
	await snapshot("06_leaderboard")
	press("Main Menu")
	press("Audio / display")
	check(app.sound.settings.mute,"Mute applied")
	for item in app.settings_overlay.get_children()[1].get_children():
		if item is CheckButton and "Ambient" in item.text:
			item.button_pressed=false
			check(not app.store.data.ambient,"Ambient can be disabled from menu")
	await snapshot("07_settings")
	bounds(app.settings_overlay)
	press("Done")
	check(app.settings_overlay==null,"Settings dismiss")
	app.sound.settings.mute=false
	app.sound.apply_settings()
	app.sound.cue("complete")
	check(not app.sound.music.stream_paused and app.sound.effects.stream==app.sound.tones.complete,"Unmute and sound routing")
	app.sound.settings.mute=true
	app.sound.apply_settings()
	check(not app.sound.effects.playing,"Mute stops the current cue immediately")
	app.start_demo()
	app.skip_tutorial()
	app.set_speed(15)
	app.advance_clock(8)
	app.advance_clock(0.8)
	check(app.speed==1,"Important event automatically restores readable speed")
	app.start_demo()
	app.skip_tutorial()
	app.simulation.notices.append({"time":480,"type":"hint","object":"ev_1","text":"Keep this pending message"})
	app.guide_action()
	check(not app.simulation.notices.is_empty(),"Acknowledging Opti does not discard unseen notices")
	# Repeat full sessions while animations/audio are alive. No actor/player accumulation.
	for i in range(12):
		app.start_demo()
		app.skip_tutorial()
		app.select_object("ev_2")
		app.apply_control("Fast")
		app.advance_clock(480)
		check(app.screen=="results","Repeated session results")
		app.show_start()
		await process_frame
		check(app.get_child_count()==2 and app.sound.get_child_count()==2,"No leaked screen/audio nodes")
	app.start_demo()
	app.skip_tutorial()
	app.advance_clock(360)
	app.reset_clock()
	check(app.simulation.time_minutes==480 and app.simulation.tasks.size()==2 and app.simulation.events_seen==0,"Reset all state")
	check(app.site.living_site and app.activity.get_parent()==app.site,"One activity layer")
	app.activity.phase=2
	check(app.activity.vehicle_position(Vector2(241.5,409),630,990,629).z==-1,"Not arrived car hidden")
	check(app.activity.vehicle_position(Vector2(241.5,409),630,990,634).y==530,"Arrival follows road")
	check(app.activity.vehicle_position(Vector2(241.5,409),630,990,995).y==530,"Departure follows road")
	check(app.activity.vehicle_position(Vector2(241.5,409),630,990,999).z==-1,"Departed car exits")
	app.store.data.ambient=false
	app.activity.reduced=true
	check(app.activity.reduced,"Reduced effects supported")
	if capture:
		app.skip_tutorial()
		app.store.data.ambient=true
		app.activity.reduced=false
		app.set_process(true)
		var start_ms: int=Time.get_ticks_msec()
		var frames:=0
		while Time.get_ticks_msec()-start_ms<3000:
			await process_frame
			frames+=1
		print("LIVE FRAME SAMPLE: %.1f FPS over 3 seconds, %d root nodes, %d activity nodes" % [frames*1000.0/(Time.get_ticks_msec()-start_ms),app.get_child_count(),app.activity.get_child_count()])
		check(app.simulation.time_minutes>480 and app.get_child_count()==2,"Live clock/animation sample retains bounded nodes")
		app.set_process(false)
	app.queue_free()
	await process_frame
	await create_timer(0.15).timeout # Let the audio server release its final playback.
	DirAccess.remove_absolute("user://exhibition_test.json")
	print("EXHIBITION UI: %d checks, %d failures" % [checks,failures])
	quit(0 if failures==0 else 1)
