extends SceneTree
class Probe:
	extends "res://scripts/management_game.gd"
	var toggles:=0
	var keyboard_shows:=0
	func toggle_fullscreen() -> void: toggles+=1
	func keyboard_supported() -> bool: return true
	func show_name_keyboard() -> void: keyboard_shows+=1
	func hide_name_keyboard() -> void: name_keyboard_requested=false

var app
var checks:=0
var failures:=0
func _initialize() -> void: call_deferred("run")
func check(ok: bool,text: String) -> void:
	checks+=1
	if not ok:
		failures+=1
		push_error(text)
func key() -> void:
	var event:=InputEventKey.new()
	event.keycode=KEY_F11
	event.pressed=true
	root.push_input(event,true)
func tap(caption: String) -> void:
	var item=app.find_caption(app.ui,caption)
	check(item!=null,"Touch action exists: "+caption)
	if item==null: return
	for pressed in [true,false]:
		var event=InputEventScreenTouch.new()
		event.position=root.get_final_transform()*item.get_global_rect().get_center()
		event.pressed=pressed
		Input.parse_input_event(event)
		await process_frame
func run() -> void:
	app=Probe.new()
	app.store=load("res://scripts/local_store.gd").new("user://usability_test.json")
	app.store.data.mute=true
	root.add_child(app)
	await process_frame
	app.set_process(false)
	var model_time: float=app.simulation.time_minutes
	var initial_nodes: int=app.ui.get_child_count()
	for i in range(20):
		app.menu_activity._process(6001)
		check(app.menu_activity.phase<600,"Attract phase bounded")
		app.show_start()
		await process_frame
	check(app.ui.get_child_count()==initial_nodes and app.simulation.time_minutes==model_time,"Menu reentry has bounded nodes and does not advance gameplay")
	key()
	app.show_name()
	key()
	app.name_input.release_focus()
	var touch:=InputEventScreenTouch.new()
	touch.pressed=true
	touch.position=app.name_input.get_global_rect().get_center()
	root.push_input(touch,true)
	check(app.name_input.has_focus() and app.name_input.is_editing(),"Screen touch focuses name and starts editing")
	root.push_input(touch,true)
	check(app.keyboard_shows==1,"Repeated taps do not spam system keyboard")
	app.name_input.text="Touch QA"
	app.name_input.text_submitted.emit(app.name_input.text)
	check(app.screen=="modes" and not app.name_keyboard_requested,"Enter accepts name and dismisses keyboard")
	key()
	app.start_demo()
	app.skip_tutorial()
	key()
	app.show_settings()
	key()
	app.find_caption(app.ui,"Done").pressed.emit()
	check(app.toggles==5,"F11 reaches menu/name/modes/game/settings despite focused controls")
	var ev: Dictionary=app.simulation.tasks[0]
	check(app.task_timer(ev).minutes==270 and is_equal_approx(app.task_timer(ev).ratio,1),"Initial simulated deadline countdown")
	for rate in [1,5,15]:
		app.start_demo()
		app.skip_tutorial()
		app.set_speed(rate)
		app.paused=false
		var before: float=app.elapsed_minutes
		app._process(1)
		check(is_equal_approx(app.elapsed_minutes-before,app.pacing*rate),"Clock advances at selected speed "+str(rate))
		check(app.task_timer(app.simulation.tasks[0]).minutes==ceili(750-app.elapsed_minutes),"Timer follows simulated time at "+str(rate))
	app.start_demo()
	app.skip_tutorial()
	app.simulation.advance(330)
	app.refresh_simulation_ui()
	var visitor: Dictionary={}
	for task in app.simulation.tasks:
		if task.id=="ev_3": visitor=task
	check(visitor.deadline==1005 and app.task_timer(visitor).minutes==195,"Original visitor departure countdown")
	app.simulation.advance(60)
	app.refresh_simulation_ui()
	check(visitor.deadline==960 and app.task_timer(visitor).minutes==90,"Changed departure immediately revises timer")
	check("ACT NOW" in app.task_timer(visitor).text,"Risk is expressed in text as well as color")
	for state in ["completed","failed"]:
		var terminal: Dictionary=visitor.duplicate()
		terminal.status=state
		check(not app.task_timer(terminal).visible,"Terminal tasks have no active countdown")
	for task in app.simulation.tasks:
		if task.id=="comfort": check(not app.task_timer(task).visible,"Comfort has no misleading deadline")
	check(app.ribbon_buttons.size()==2 and app.ribbon_timers.size()==2,"HUD limits focus to two tasks")
	app.simulation.advance(210)
	app.show_results()
	key()
	app.show_leaderboard()
	key()
	check(app.toggles==7,"F11 also reaches results and leaderboard")
	app.show_name()
	Input.set_emulate_mouse_from_touch(true)
	await tap("Use Guest")
	check(app.screen=="modes" and app.player_name=="Guest","Guest lets touch visitors proceed without a physical keyboard")
	await tap("Start Demo  →")
	check(app.screen=="game","Simulated touch starts the game")
	app.skip_tutorial()
	await tap("All tasks (2)")
	check(app.task_panel.visible,"Simulated touch opens all tasks")
	await tap("Menu")
	check(app.screen=="start","Simulated touch returns to menu")
	app.queue_free()
	await process_frame
	await create_timer(0.3).timeout
	print("Usability: %d checks, %d failures" % [checks,failures])
	quit(1 if failures else 0)

