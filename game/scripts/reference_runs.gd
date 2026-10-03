extends RefCounted
const Model = preload("res://scripts/management_simulation.gd")

static func policy(sim, coordinated: bool) -> void:
	var t: float = sim.time_minutes
	var previous_peak: float=sim.max_grid_import_kw
	if not coordinated:
		if t >= 900: sim.control("flex","Run") # Default starts at 14:00, below.
		elif t >= 840: sim.control("flex","Run")
		return
	# Forecast-aware heuristic, evaluated every simulated minute. No final numbers.
	if sim.dirty and sim.cleaning_end < 0: sim.control("solar","Clean")
	if t>=735 and t<795: sim.control("flex","Run")
	sim.control("hvac","Boost" if sim.inside_c>24.0 else ("Eco" if sim.inside_c<22.8 else "Normal"))
	for id in ["ev_1","ev_2","ev_3"]:
		var remaining: float
		var deadline: float
		if id=="ev_1":
			remaining = sim.ev_target_energy()-sim.ev_energy_kwh
			deadline = sim.config.ev_departure_minute
		else:
			var v: Dictionary = sim.vehicle(id)
			remaining = v.capacity*v.target/100-v.energy
			deadline = v.departure # Respond to the revised deadline only after its event.
		var needed := remaining*60.0/(maxf(deadline-t-15.0,1.0)*0.9)
		var mode := "Fast" if needed>7 else ("Normal" if needed>3 else "Low")
		if remaining<0.001: mode="Pause"
		elif t<660 and needed<5 and id=="ev_2": mode="Pause"
		sim.control(id,mode)
	sim.control("battery","Hold")
	if sim.grid_kw < -4 and sim.battery_soc()<95: sim.control("battery","Charge")
	elif (sim.price_eur_per_kwh>=0.24 or sim.grid_kw>18 or sim.weather_factor(t)<1) and sim.grid_kw>5 and sim.battery_soc()>12:
		sim.control("battery","Discharge")
	if sim.battery_power_kw>0 and sim.grid_kw>18: sim.control("battery","Hold")
	# Policy decisions are simultaneous at this minute, not transient trial states.
	sim.max_grid_import_kw=maxf(previous_peak,sim.grid_kw)

static func run(coordinated: bool) -> Dictionary:
	var sim = Model.new()
	while not sim.day_finished:
		policy(sim,coordinated)
		sim.advance(1.0)
	return sim.summary()
