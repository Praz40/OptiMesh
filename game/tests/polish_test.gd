extends SceneTree
## Regressions discovered in desktop play and rendered strategy review.
const Model=preload("res://scripts/management_simulation.gd")
const Store=preload("res://scripts/local_store.gd")
var app
var checks:=0
var failures:=0

func _initialize() -> void: call_deferred("run")

func check(ok: bool,message: String) -> void:
	checks+=1
	if not ok:
		failures+=1
		push_error(message)

func key(code: Key) -> void:
	for pressed in [true,false]:
		var event=InputEventKey.new()
		event.keycode=code
		event.pressed=pressed
		root.push_input(event,true)

func run() -> void:
	var passive=Model.new()
	passive.advance(600)
	var recovered=Model.new()
	recovered.advance(255)
	recovered.control("flex","Run")
	recovered.advance(45)
	recovered.control("solar","Clean")
	recovered.advance(150)
	recovered.control("battery","Discharge")
	recovered.advance(150)
	check(passive.summary().ev_met==2 and recovered.summary().ev_met==2,"Score comparison holds EV outcome constant")
	check(recovered.summary().score>passive.summary().score+50,"Recovery after a missed EV earns meaningful points instead of hitting the same cap")
	check(recovered.summary().score<=500,"Service multiplier still limits incomplete vehicle service")
	for response_time in [870.0,890.0,910.0,915.0]:
		var late=Model.new()
		late.advance(response_time-480)
		late.control("ev_3","Fast")
		late.advance(1080-response_time)
		check(late.summary().ev_met==3,"Visitor recovery remains possible after reading and navigating, response at "+str(response_time))
	var too_late=Model.new()
	too_late.advance(450)
	too_late.control("ev_3","Fast")
	too_late.advance(150)
	check(too_late.summary().ev_met==2,"An excessively late response still has a real consequence")
	var almost=Model.new()
	almost.advance(445)
	almost.control("ev_3","Fast")
	almost.advance(155)
	for task in almost.tasks:
		if task.id=="ev_3": check(task.status=="failed" and task.progress.begins_with("74."),"A near miss never displays 75% / 75% as a failure")
	app=load("res://scenes/main.tscn").instantiate()
	app.store=Store.new("user://polish_test.json")
	app.store.data.entries=[]
	app.store.data.mute=true
	root.add_child(app)
	await process_frame
	app.set_process(false)
	app.player_name="Polish QA"
	app.start_demo()
	app.skip_tutorial()
	app.select_object("battery")
	app.control_buttons.Charge.grab_focus()
	key(KEY_SPACE)
	check(app.paused and app.simulation.battery_mode=="Hold","Space pauses with a mode button focused instead of activating Charge")
	key(KEY_SPACE)
	check(not app.paused,"Space resumes with button focus")
	app.set_speed(5)
	app.refresh_simulation_ui()
	check("5×" in app.clock_detail.text and "6.25" in app.clock_detail.text,"Clock detail reports actual selected speed")
	app.set_speed(1)
	app.message_age=10
	app.simulation.notices=[{"time":480,"type":"surprise","object":"ev_3","text":"Read this deadline warning"},{"time":480,"type":"resolved","object":"flex","text":"A task finished"}]
	app.advance_clock(0.01)
	check("visitor has less charging time" in app.assistant_message.text,"Urgent message takes priority with complementary action guidance")
	app.advance_clock(0.1)
	check("visitor has less charging time" in app.assistant_message.text,"Task completion cannot erase a warning in the next frame")
	app.advance_clock(6)
	check(app.assistant_message.text=="A task finished","Queued completion gets its own reading interval")
	check(app.message_history.size()==2,"Delivered notes can be reviewed")
	app.show_notice_history()
	key(KEY_SPACE)
	check(app.paused,"Reading history cannot accidentally resume via keyboard")
	app.find_caption(app.ui,"Back to the site").pressed.emit()
	check(not app.paused and app.notes_overlay==null,"History restores previous pause state")
	app.start_demo()
	app.skip_tutorial()
	app.simulation.advance(390)
	app.refresh_simulation_ui()
	check(app.ribbon_targets[0]=="ev_3" and "ETA" in app.ribbon_buttons[0].text,"Revised visitor is visible ahead of maintenance backlog")
	check(app.ribbon_buttons[0].get_theme_color("font_color")==Color("#ad5143"),"Late EV plan is visibly flagged")
	app.select_object("ev_3")
	check(app.inspector_values[4].text==app.time_text(ceil(app.ev_plan("ev_3").eta)),"Inspector and ribbon use the same conservative ETA rounding")
	app.apply_control("Fast")
	check("Grid" in app.feedback.text and "on track" in app.feedback.text,"EV action explains both grid consequence and recovery")
	app.select_object("solar")
	app.apply_control("Clean")
	app.simulation.advance(16)
	app.refresh_simulation_ui()
	check("Panels are clean" in app.feedback.text and not "underway" in app.feedback.text,"Cleaning completion replaces stale action feedback")
	check(app.selection_mode.text=="Setting: Clean" and app.control_buttons.Clean.disabled,"Automatic maintenance completion updates mode and availability")
	app.select_object("battery")
	check(app.companion.position.x>app.inspector.position.x+app.inspector.size.x,"Companion leaves left inspector feedback clear")
	app.select_object("ev_2")
	check(app.companion.position.x+app.companion.size.x<app.inspector.position.x,"Companion leaves right inspector feedback clear")
	app.simulation.advance(930-app.elapsed_minutes)
	app.simulation.control("battery","Discharge")
	app.refresh_simulation_ui()
	for task in app.simulation.tasks:
		if task.id=="grid": check(not app.task_at_risk(task),"Safe grid task is important without being falsely coloured as failure")
	app.show_settings()
	for node in app.settings_overlay.get_children()[1].get_children():
		if node is CheckButton: check(node.get_theme_color("font_focus_color").get_luminance()<0.3,"Focused settings toggles stay readable")
	check(app.find_caption(app.ui,"Test sound")!=null,"Audio balance can be previewed from settings")
	app.find_caption(app.ui,"Done").pressed.emit()
	app.start_demo()
	app.skip_tutorial()
	app.select_object("ev_1")
	app.simulation.advance(250)
	app.refresh_simulation_ui()
	check(app.control_buttons.Fast.disabled and app.control_buttons.Pause.disabled,"Charging controls disable automatically when the target is reached")
	app.start_demo()
	app.skip_tutorial()
	app.simulation.advance(209)
	app.simulation.notices=[]
	app.set_speed(15)
	app.message_age=0
	app.advance_clock(0.1)
	check(app.speed==1,"Cloud event slows fast-forward before its message finishes waiting")
	app.start_demo()
	app.skip_tutorial()
	app.simulation.advance(520)
	app.simulation.control("battery","Discharge")
	app.simulation.notices=[]
	app.hints_seen["last_hour"]=true
	app.offer_hint()
	check(app.hints_seen.has("battery_export"),"An already-seen last-hour hint cannot starve useful battery-export advice")
	for i in range(6):
		app.start_demo()
		app.skip_tutorial()
		app.advance_clock(480)
		app.show_start()
		await process_frame
		check(app.get_child_count()==2 and app.sound.get_child_count()==2,"Repeated sessions retain one UI and two audio players")
	app.start_demo()
	check(app.message_history.is_empty() and app.message_target=="ev_1","Replay clears stale notes and action target")
	app.queue_free()
	await process_frame
	await create_timer(0.3).timeout
	DirAccess.remove_absolute("user://polish_test.json")
	print("POLISH REGRESSIONS: %d checks, %d failures" % [checks,failures])
	quit(0 if failures==0 else 1)
