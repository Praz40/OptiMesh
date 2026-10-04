extends SceneTree
## Complete rendered strategy review. Journal is evidence, not a human usability claim.
const Store=preload("res://scripts/local_store.gd")
var app
var capture:=false
var round_name:="review"
var checks:=0
var failures:=0
var journal: Array=[]
var styles: Array=["Naive","EV-first","Cost-focused","Chaotic","Passive","Strong","Comfort-ignoring","Battery-abuse","Late-reaction","Optimizer","Normal-Strong"]

func _initialize() -> void:
	capture="--capture" in OS.get_cmdline_user_args()
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--round="): round_name=arg.trim_prefix("--round=")
	call_deferred("run")

func check(ok: bool,text: String) -> void:
	checks+=1
	if not ok:
		failures+=1
		push_error(text)

func action(id: String,mode: String) -> void:
	if app.objects.has(id) and app.objects[id].mode!=mode:
		app.select_object(id)
		app.apply_control(mode)

func decide(style: String,minute: int) -> void:
	var sim=app.simulation
	var t: float=sim.time_minutes
	if style=="Passive": return
	if style=="Chaotic":
		action("battery",["Charge","Hold","Discharge"][int(t/15)%3])
		action("hvac","Boost" if int(t/20)%3==0 else "Eco")
		for id in ["ev_1","ev_2","ev_3"]: action(id,"Pause" if t<930 else "Fast")
		return
	if style=="Battery-abuse":
		action("battery","Charge" if int(t/60)%2==0 else "Discharge")
		for id in ["ev_1","ev_2","ev_3"]: action(id,"Fast")
		if sim.dirty and sim.cleaning_end<0: action("solar","Clean")
		if t>=735 and t<795: action("flex","Run")
		return
	if style=="Comfort-ignoring":
		action("hvac","Eco")
		for id in ["ev_1","ev_2","ev_3"]: action(id,"Fast")
		if sim.dirty and sim.cleaning_end<0: action("solar","Clean")
		if t>=735 and t<795: action("flex","Run")
		return
	if style=="Late-reaction":
		if t>=837 and t<840: action("flex","Run")
		if t>=882 and sim.dirty and sim.cleaning_end<0: action("solar","Clean")
		if t>=915: action("ev_3","Fast")
		if t>=933 and t<975: action("battery","Discharge")
		return
	if style=="EV-first":
		for id in ["ev_1","ev_2","ev_3"]: action(id,"Fast")
		return
	if style=="Naive":
		# Read the currently visible message, with no access to unrevealed future events.
		var text: String=app.assistant_message.text.to_lower()
		if "dust" in text or "dirty" in text: action("solar","Clean")
		elif "wash" in text and t<900: action("flex","Run")
		elif "change of plan" in text or "new departure" in text or "isn't on track" in text: action("ev_3","Fast")
		elif "cloud" in text and t>=690 and t<735: action("battery","Discharge")
		elif "passed" in text or "recovering" in text: action("battery","Hold")
		elif "limit" in text and t>=930 and t<975: action("battery","Discharge")
		elif "warm" in text: action("hvac","Normal")
		return
	if sim.dirty and sim.cleaning_end<0:
		if style=="Optimizer": action("battery","Discharge")
		action("solar","Clean")
	if t>=735 and t<795: action("flex","Run")
	if style=="Cost-focused":
		action("hvac","Eco" if sim.inside_c<25.2 else "Boost")
	else: action("hvac","Eco" if sim.inside_c<22.8 else "Normal" if sim.inside_c<24.5 else "Boost")
	for id in ["ev_1","ev_2","ev_3"]:
		var remaining: float
		var deadline: float
		if id=="ev_1":
			remaining=sim.ev_target_energy()-sim.ev_energy_kwh
			deadline=sim.config.ev_departure_minute
		else:
			var v: Dictionary=sim.vehicle(id)
			remaining=v.capacity*v.target/100-v.energy
			deadline=v.departure
		var needed: float=remaining*60/(maxf(deadline-t-15,1)*0.9)
		var choice: String="Fast" if needed>7 else "Normal" if needed>3 else "Low"
		if remaining<0.001: choice="Pause"
		if style=="Cost-focused" and sim.price_eur_per_kwh>=0.24 and deadline-t>90: choice="Pause"
		action(id,choice)
	# Evaluate the net demand with battery power removed; avoid trial control changes.
	var net: float=sim.grid_kw-sim.battery_power_kw
	var battery: String="Hold"
	if net < -10 and sim.battery_soc()<95: battery="Charge"
	elif net>8 and (sim.price_eur_per_kwh>=0.24 or sim.weather_factor(t)<1 or net>18) and sim.battery_soc()>12: battery="Discharge"
	action("battery",battery)

func shot(style: String,minute: int) -> void:
	if not capture: return
	await process_frame
	await RenderingServer.frame_post_draw
	var size:=DisplayServer.window_get_size()
	var path: String="res://artifacts/play_%s_%s_%03d_%dx%d.png" % [round_name,style,minute,size.x,size.y]
	check(root.get_texture().get_image().save_png(path)==OK,"Playstyle capture")

func run() -> void:
	app=load("res://scenes/main.tscn").instantiate()
	app.store=Store.new("user://playstyle_test.json")
	app.store.data.entries=[]
	app.store.data.mute=false # Rendered sessions exercise actual output and music.
	root.add_child(app)
	await process_frame
	app.set_process(false)
	for style in styles:
		app.player_name=style+" player"
		app.mode_name="Normal" if style=="Normal-Strong" else "Demo"
		app.start_demo()
		app.skip_tutorial()
		var messages: Array=[]
		var previous:=""
		for minute in range(600):
			decide(style,minute)
			app.advance_clock(1.0/app.pacing)
			if app.screen=="game":
				app.refresh_simulation_ui()
				if previous!=app.assistant_message.text:
					previous=app.assistant_message.text
					messages.append({"time":app.elapsed_minutes,"text":previous,"selected":app.selected_id})
			if minute in [0,119,209,299,389,449,509,598,599]: await shot(style,minute)
			elif capture or minute%30==0: await process_frame
		check(app.screen=="results","Every strategy completes day")
		var r: Dictionary=app.results_values.duplicate(true)
		r.erase("tasks")
		journal.append({"style":style,"result":r,"messages":messages})
		print("PLAYSTYLE %s: score %d, €%.2f, peak %.1f kW, EV %d/3, comfort %.1f%%, wash %s, grid %s" % [style,r.score,r.cost,r.peak,r.ev_met,r.comfort,str(r.flex),str(r.grid)])
		app.show_start()
		await process_frame
		check(app.get_child_count()==2,"Repeated strategy has no extra root nodes")
	var file=FileAccess.open("res://artifacts/play_%s_journal.json" % round_name,FileAccess.WRITE)
	check(journal[5].result.score>journal[0].result.score and journal[0].result.score>journal[1].result.score,"Planning improves efficiency after all services are met")
	check(journal[1].result.score>journal[4].result.score and journal[4].result.score>journal[3].result.score,"Partial service and disastrous outcomes rank below competent play")
	check(journal[2].result.score<=400 and journal[2].result.cost<journal[5].result.cost,"Cheap but uncomfortable strategy cannot exploit score")
	check(journal[6].result.score<400 and journal[6].result.comfort<80,"Ignoring comfort cannot earn a good result")
	check(journal[7].result.cycles>journal[5].result.cycles and journal[7].result.score<journal[5].result.score,"Wasteful cycling loses to coordination")
	check(journal[8].result.ev_met==3,"Revised visitor deadline allows delayed but viable recovery")
	check(journal[10].result.score==journal[5].result.score and is_equal_approx(journal[10].result.cost,journal[5].result.cost),"Full Normal run has the same fair result at slower pacing")
	file.store_string(JSON.stringify(journal,"\t"))
	file.close()
	app.queue_free()
	await process_frame
	await create_timer(0.15).timeout
	DirAccess.remove_absolute("user://playstyle_test.json")
	print("PLAYSTYLE REVIEW: %d checks, %d failures" % [checks,failures])
	quit(0 if failures==0 else 1)
