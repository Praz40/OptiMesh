extends "res://scripts/energy_simulation.gd"
const Scenario = preload("res://scripts/demo_scenario.gd")
var vehicles: Array = []
var events_seen := 0
var notices: Array = []
var tasks: Array = []
var hvac_mode := "Normal"
var hvac_kw := 4.0
var inside_c := 22.0
var outside_c := 24.0
var comfortable_minutes := 0.0
var temperature_slope := 0.0
var thermal_slot := -1
var flex_running := false
var flex_minutes := 0.0
var flex_kw := 0.0
var dirty := false
var cleaned := false
var cleaned_minute := -1.0
var cleaning_end := -1.0
var maintenance_cost := 0.0
var battery_throughput := 0.0
var battery_charge_kwh := 0.0
var battery_discharge_kwh := 0.0
var limit_excess_minutes := 0.0
var served_kwh := 0.0

func reset() -> void:
	vehicles = Scenario.EVS.duplicate(true)
	for v in vehicles:
		v.energy = v.capacity * v.initial / 100.0
		v.mode = "Normal"
		v.power = 0.0
		v.departed = false
		v.departure_soc = -1.0
		v.success = false
	tasks = []
	events_seen = 0
	notices = []
	hvac_mode = "Normal"
	inside_c = 22.0
	comfortable_minutes = 0.0
	thermal_slot = -1
	flex_running = false
	flex_minutes = 0.0
	dirty = false
	cleaned = false
	cleaned_minute = -1.0
	cleaning_end = -1.0
	maintenance_cost = 0.0
	battery_throughput = 0.0
	battery_charge_kwh = 0.0
	battery_discharge_kwh = 0.0
	limit_excess_minutes = 0.0
	served_kwh = 0.0
	super.reset()
	add_task("ev_1", "EV 01 to 80%", "Reach 80%", 750.0)
	add_task("comfort", "Comfortable office", "Keep rooms between 20–25°C", 1080.0, "hvac")

func add_task(id: String, title: String, description: String, deadline: float, object: String = "") -> void:
	tasks.append({"id":id, "title":title, "description":description, "deadline":deadline, "object":object if object != "" else id, "status":"active", "progress":""})

func vehicle(id: String) -> Dictionary:
	for v in vehicles:
		if v.id == id: return v
	return {}

func weather_factor(at: float) -> float:
	return 0.4 if at >= 690.0 and at < 735.0 else 1.0

func _solar_at(at: float) -> float:
	if cleaning_end > time_minutes: return 0.0
	return super._solar_at(at) * weather_factor(time_minutes) * (0.75 if dirty else 1.0)

func control(id: String, mode: String) -> bool:
	if day_finished: return false
	if id == "ev_1": set_ev_mode(mode)
	elif id == "battery": set_battery_mode(mode)
	elif id.begins_with("ev_"):
		var v := vehicle(id)
		if v.is_empty() or v.departed or not EV_POWERS.has(mode): return false
		v.mode = mode
	elif id == "hvac" and mode in ["Eco","Normal","Boost"]:
		hvac_mode = mode
		thermal_slot = -1
	elif id == "flex": flex_running = mode == "Run" and time_minutes >= 660 and time_minutes < 900 and flex_minutes < 60
	elif id == "solar" and mode == "Clean":
		if not dirty or cleaning_end > 0: return false
		cleaning_end = time_minutes + 15.0
		maintenance_cost += 2.0
	else: return false
	_refresh_power()
	return true

func _refresh_power() -> void:
	var saved_peak := max_grid_import_kw
	super._refresh_power()
	max_grid_import_kw = saved_peak
	if time_minutes < float(config.get("ev_arrival_minute",START_MINUTE)): ev_power_kw=0.0
	outside_c = profile_at([[480.0,24.0],[840.0,34.0],[1080.0,27.0]], time_minutes)
	hvac_kw = {"Eco":1.5,"Normal":4.0,"Boost":7.0}[hvac_mode]
	for v in vehicles:
		if time_minutes >= v.departure and not v.departed:
			v.departed = true
			v.departure_soc = v.energy / v.capacity * 100.0
			v.success = v.departure_soc >= v.target - 1e-7
		v.power = minf(EV_POWERS[v.mode],v.maximum) if time_minutes >= v.arrival and not v.departed and v.energy < v.capacity * v.target / 100.0 - EPS else 0.0
	flex_kw = 6.0 if flex_running and flex_minutes < 60.0 - EPS and time_minutes < 900.0 else 0.0
	# Existing building profile includes services. Remove a fixed 4 kW allowance,
	# then add the actual HVAC; this avoids counting climate power twice.
	building_kw = maxf(0.0, building_kw - 4.0) + hvac_kw + flex_kw
	grid_kw = building_kw + ev_power_kw + battery_power_kw - solar_kw
	for v in vehicles: grid_kw += v.power
	max_grid_import_kw = maxf(max_grid_import_kw, grid_kw)
	var slot := floori(time_minutes * 4.0 + 1e-7)
	if slot != thermal_slot:
		thermal_slot = slot
		# Piecewise constant thermal derivative on an absolute quarter-minute grid.
		temperature_slope = (outside_c - inside_c) * 0.003 + 0.012 - hvac_kw * 0.009
		if inside_c < 21.0 and temperature_slope < 0: temperature_slope = 0.0

func update_tasks() -> void:
	for task in tasks:
		if task.id == "ev_1":
			task.progress = "%.1f%% / 80%%" % (80.0 if ev_target_reached else floorf(ev_soc()*10)/10)
			if ev_departed: task.status = "failed" if ev_departed_below_target else "completed"
		elif task.id.begins_with("ev_"):
			var v := vehicle(task.id)
			task.deadline = v.departure
			var at_target: bool=v.energy>=v.capacity*v.target/100-EPS
			task.progress = "%.1f%% / %.0f%%" % [v.target if at_target else floorf(v.energy/v.capacity*1000)/10,v.target]
			if v.departed: task.status = "completed" if v.success else "failed"
		elif task.id == "flex":
			task.progress = "%.0f / 60 min" % flex_minutes
			if flex_minutes >= 60.0 - EPS: task.status = "completed"
			elif time_minutes >= 900: task.status = "failed"
		elif task.id == "solar":
			task.progress = "Cleaning…" if cleaning_end > time_minutes else "€2 · 15 min offline"
			if cleaned and cleaned_minute<=900:
				task.status = "completed"
				task.progress = "Full output restored"
			elif time_minutes >= 900: task.status = "failed"
		elif task.id == "grid":
			task.progress = "%.1f kW / 18 kW" % maxf(grid_kw,0)
			if time_minutes >= 975:
				task.status = "completed" if limit_excess_minutes <= 5.0+EPS else "failed"
				task.progress = "%.1f / 5 min above limit" % limit_excess_minutes
		elif task.id == "comfort":
			task.progress = "%.1f°C · %.0f%% comfortable" % [inside_c, comfort_percent()]
			if day_finished: task.status = "completed" if comfort_percent() >= 95 else "failed"

func process_events() -> void:
	while events_seen < Scenario.EVENTS.size() and Scenario.EVENTS[events_seen][0] <= time_minutes + EPS:
		var event: Array = Scenario.EVENTS[events_seen]
		events_seen += 1
		notices.append({"time":event[0],"text":event[2],"object":event[3],"type":event[1]})
		match event[1]:
			"arrival":
				var v := vehicle(event[3])
				add_task(v.id, "EV 0" + v.id.right(1) + " to %.0f%%" % v.target, "Meet its charge target", v.departure)
			"tariff":
				if event[0] == 660: add_task("flex", "Equipment wash", "Run for 60 min before 15:00", 900.0)
			"dust":
				dirty = true
				add_task("solar", "Clean rooftop solar", "Recover the lost 25% output", 900.0)
			"surprise": vehicle("ev_3").departure = 960.0
			"limit": add_task("grid", "Grid below 18 kW", "15:30–16:15 · 5 min grace total", 975.0)
	if cleaning_end > 0 and time_minutes >= cleaning_end - EPS:
		dirty = false
		cleaned = true
		cleaned_minute = time_minutes
		cleaning_end = -1.0
		# The task transition announces completion once, in the presentation layer.

func comfort_percent() -> float:
	return 100.0 * comfortable_minutes / maxf(time_minutes - START_MINUTE, EPS) if time_minutes > START_MINUTE else 100.0

func advance(minutes: float) -> void:
	if paused or day_finished or minutes <= 0: return
	var end := minf(time_minutes + minutes, END_MINUTE)
	while time_minutes < end - EPS:
		process_events()
		_refresh_power()
		var boundary := minf(end, (floor(time_minutes * 4.0 + 1e-7) + 1.0) / 4.0)
		for schedule_time in [float(config.get("ev_arrival_minute",START_MINUTE)),config.ev_departure_minute]:
			if schedule_time>time_minutes+EPS: boundary=minf(boundary,schedule_time)
		for v in vehicles:
			for schedule_time in [v.arrival,v.departure]:
				if schedule_time>time_minutes+EPS: boundary=minf(boundary,schedule_time)
		if ev_power_kw > EPS: boundary = minf(boundary,time_minutes + (ev_target_energy()-ev_energy_kwh)*60/(ev_power_kw*config.ev_charge_efficiency))
		if battery_power_kw > EPS: boundary = minf(boundary,time_minutes+(config.battery_capacity_kwh-battery_energy_kwh)*60/(battery_power_kw*config.battery_charge_efficiency))
		elif battery_power_kw < -EPS: boundary = minf(boundary,time_minutes+battery_energy_kwh*60*config.battery_discharge_efficiency/-battery_power_kw)
		for v in vehicles:
			if v.power > EPS: boundary = minf(boundary,time_minutes+(v.capacity*v.target/100-v.energy)*60/(v.power*0.9))
		if flex_kw > EPS: boundary = minf(boundary,time_minutes+60-flex_minutes)
		if cleaning_end > time_minutes: boundary = minf(boundary,cleaning_end)
		var dt := boundary - time_minutes
		var hours := dt / 60.0
		var building_end := profile_at(BUILDING_PROFILE,boundary)-4.0+hvac_kw+flex_kw
		var solar_end := _solar_at(boundary)
		var grid_end := building_end+ev_power_kw+battery_power_kw-solar_end
		for v in vehicles: grid_end += v.power
		var imported := positive_energy(grid_kw,grid_end,hours)
		var exported := positive_energy(-grid_kw,-grid_end,hours)
		imported_kwh += imported
		exported_kwh += exported
		electricity_cost_eur += imported*price_eur_per_kwh
		max_grid_import_kw = maxf(max_grid_import_kw,grid_end)
		solar_generated_kwh += (solar_kw+solar_end)*0.5*hours
		building_energy_kwh += (building_kw+building_end)*0.5*hours
		served_kwh += (building_kw+building_end+2*ev_power_kw)*0.5*hours
		battery_throughput += absf(battery_power_kw)*hours
		battery_charge_kwh += maxf(battery_power_kw,0)*hours
		battery_discharge_kwh += maxf(-battery_power_kw,0)*hours
		battery_energy_kwh = clampf(battery_energy_kwh+battery_power_kw*hours*(config.battery_charge_efficiency if battery_power_kw>=0 else 1.0/config.battery_discharge_efficiency),0,config.battery_capacity_kwh)
		ev_energy_kwh = minf(ev_target_energy(),ev_energy_kwh+ev_power_kw*hours*config.ev_charge_efficiency)
		for v in vehicles:
			v.energy = minf(v.capacity*v.target/100,v.energy+v.power*hours*0.9)
			served_kwh += v.power*hours
		if flex_kw > 0: flex_minutes += dt
		# Exact duration of a linear temperature segment inside the comfort band.
		if absf(temperature_slope) < EPS:
			if inside_c >= 20 and inside_c <= 25: comfortable_minutes += dt
		else:
			var a := (20-inside_c)/temperature_slope
			var b := (25-inside_c)/temperature_slope
			comfortable_minutes += maxf(0,minf(dt,maxf(a,b))-maxf(0,minf(a,b)))
		inside_c += temperature_slope*dt
		if time_minutes >= 930 and time_minutes < 975:
			if grid_kw > 18 and grid_end > 18: limit_excess_minutes += dt
			elif maxf(grid_kw,grid_end) > 18: limit_excess_minutes += dt*(maxf(grid_kw,grid_end)-18)/absf(grid_end-grid_kw)
		time_minutes = boundary
	process_events()
	_refresh_power()
	day_finished = time_minutes >= END_MINUTE-EPS
	if day_finished: paused = true
	update_tasks()

func summary() -> Dictionary:
	var met := int(ev_departed and not ev_departed_below_target)
	for v in vehicles: met += int(v.departed and v.success)
	var utilization := 100.0*(solar_generated_kwh-exported_kwh)/maxf(solar_generated_kwh,EPS)
	var cycles: float = battery_throughput/(2*config.battery_capacity_kwh)
	var score := met*150.0 + comfort_percent()*1.5 + (100.0 if flex_minutes>=60-EPS else 0.0) + (70.0 if limit_excess_minutes<=5.0+EPS else 0.0) + (30.0 if cleaned else 0.0)
	if cleaned and cleaned_minute>900: score-=30.0
	score += 80.0*clampf(1.0-(electricity_cost_eur+maintenance_cost)/45.0,0,1)
	score += 50.0*clampf(1.0-max_grid_import_kw/60.0,0,1)+50.0*clampf(utilization/100,0,1)+20.0*clampf(1.0-cycles/3,0,1)
	# Scale instead of clipping: recovering another service always earns points,
	# even after an EV is missed. Serious service failures still limit the total.
	var service_factor := 1.0
	if met < 3: service_factor = 0.4+0.05*met
	if comfort_percent()<80: service_factor = minf(service_factor,0.4)
	elif comfort_percent()<95: service_factor = minf(service_factor,0.7)
	if flex_minutes<60-EPS: service_factor = minf(service_factor,0.65)
	return {"cost":electricity_cost_eur+maintenance_cost,"import":imported_kwh,"export":exported_kwh,"peak":max_grid_import_kw,"solar":solar_generated_kwh,"utilization":clampf(utilization,0,100),"battery_soc":battery_soc(),"cycles":cycles,"comfort":comfort_percent(),"ev_met":met,"flex":flex_minutes>=60-EPS,"grid":limit_excess_minutes<=5.0+EPS,"overload_minutes":limit_excess_minutes,"score":roundi(score*service_factor),"base_score":roundi(score),"service_factor":service_factor,"tasks":tasks.duplicate(true)}
