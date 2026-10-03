extends SceneTree
const Simulation = preload("res://scripts/energy_simulation.gd")
var checks := 0
var failures := 0
const STATE_FIELDS := ["time_minutes", "building_kw", "solar_kw", "price_eur_per_kwh", "grid_kw", "imported_kwh", "exported_kwh", "electricity_cost_eur", "max_grid_import_kw", "solar_generated_kwh", "building_energy_kwh", "battery_energy_kwh", "battery_power_kw", "battery_mode", "ev_energy_kwh", "ev_power_kw", "ev_mode", "ev_departed", "ev_target_reached", "ev_departed_below_target", "ev_soc_at_departure", "paused", "day_finished"]

func _initialize() -> void:
	call_deferred("run")

func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures += 1
		push_error("SIMULATION CHECK FAILED: " + message)

func near(actual: float, expected: float, message: String, tolerance: float = 1e-7) -> void:
	check(absf(actual - expected) <= tolerance, "%s: %.10f expected %.10f" % [message, actual, expected])

func state(sim: RefCounted) -> Dictionary:
	var values := {}
	for field in STATE_FIELDS: values[field] = sim.get(field)
	return values

func same(left: RefCounted, right: RefCounted, context: String) -> void:
	for field in STATE_FIELDS:
		var a: Variant = left.get(field)
		var b: Variant = right.get(field)
		if a is float: near(a, b, context + "/" + field)
		else: check(a == b, context + "/" + field)

func advance_to(sim: RefCounted, endpoint: float, steps: Array) -> void:
	var index := 0
	while sim.time_minutes < endpoint:
		sim.advance(minf(steps[index % steps.size()], endpoint - sim.time_minutes))
		index += 1

func run_schedule(steps: Array) -> RefCounted:
	var sim = Simulation.new()
	sim.set_battery_mode("Charge")
	sim.set_ev_mode("Low")
	advance_to(sim, 610.0, steps)
	sim.set_battery_mode("Hold")
	sim.set_ev_mode("Fast")
	advance_to(sim, 840.0, steps)
	sim.set_battery_mode("Discharge")
	advance_to(sim, 1080.0, steps)
	return sim

func run() -> void:
	var sim = Simulation.new()
	near(sim.time_minutes, 480.0, "08:00 start")
	near(sim.building_kw, 8.0, "morning building")
	near(sim.solar_kw, 4.0, "morning solar")
	near(sim.grid_kw, 11.0, "initial balance")
	near(sim.battery_energy_kwh, 32.0, "initial battery")
	near(sim.ev_soc(), 38.0, "initial EV")
	near(sim.ev_completion_minute(), 720.0, "Normal ETA is noon")
	for data in [[540.0, 14.0, 12.0, 0.18], [660.0, 19.0, 25.0, 0.10], [780.0, 15.0, 31.5, 0.10], [900.0, 18.0, 21.5, 0.32], [1020.0, 13.0, 8.5, 0.24], [1080.0, 8.0, 2.0, 0.24]]:
		var sample = Simulation.new()
		sample.advance(data[0] - 480.0)
		near(sample.building_kw, data[1], "representative building " + str(data[0]))
		near(sample.solar_kw, data[2], "representative solar " + str(data[0]))
		near(sample.price_eur_per_kwh, data[3], "representative tariff " + str(data[0]))
		near(sample.grid_kw, sample.building_kw + sample.ev_power_kw + sample.battery_power_kw - sample.solar_kw, "power conservation")
	# Known hand-integrated first hour: load 11 kWh, PV 8 kWh, EV AC 7 kWh.
	sim.advance(60.0)
	near(sim.time_minutes, 540.0, "clock progression")
	near(sim.building_energy_kwh, 11.0, "first-hour building integral")
	near(sim.solar_generated_kwh, 8.0, "first-hour solar integral")
	near(sim.imported_kwh, 10.0, "first-hour grid integral")
	near(sim.electricity_cost_eur, 1.8, "first-hour cost")
	near(sim.ev_soc(), 48.5, "EV stored energy with efficiency")
	near(sim.self_supply_percent(), 100.0 * 12.0 / 21.0, "self-supply formula")
	var before := state(sim)
	sim.paused = true
	var paused_state := state(sim)
	sim.advance(100.0)
	check(state(sim) == paused_state, "pause freezes all simulation state")
	sim.paused = false
	check(state(sim) == before, "resume alone does not advance")
	sim.advance(0.0)
	sim.advance(-10.0)
	check(state(sim) == before, "zero/negative dt do not advance")
	# A line crosses import/export in 09:00–10:00 with EV paused.
	sim.reset()
	sim.set_ev_mode("Pause")
	sim.advance(120.0)
	near(sim.imported_kwh, 3.5, "zero-crossing import triangle")
	near(sim.exported_kwh, 0.5, "zero-crossing export triangle")
	near(sim.electricity_cost_eur, 0.63, "export earns zero, no net metering")
	for mode in ["Charge", "Hold", "Discharge"]:
		sim.reset()
		sim.set_battery_mode(mode)
		near(sim.battery_power_kw, {"Charge": 15.0, "Hold": 0.0, "Discharge": -15.0}[mode], "battery mode power")
		near(sim.grid_kw, sim.building_kw + sim.ev_power_kw + sim.battery_power_kw - sim.solar_kw, "battery affects grid immediately")
		sim.advance(60.0)
		near(sim.battery_energy_kwh, {"Charge": 46.25, "Hold": 32.0, "Discharge": 32.0 - 15.0 / 0.95}[mode], "battery efficiency/energy " + mode)
	for mode in ["Charge", "Discharge"]:
		sim.reset()
		sim.set_ev_mode("Pause")
		sim.set_battery_mode(mode)
		sim.advance(600.0)
		near(sim.battery_soc(), 100.0 if mode == "Charge" else 0.0, "battery bound " + mode)
		near(sim.battery_power_kw, 0.0, "battery stops at bound")
		var battery_ac := 18.0 / 0.95 if mode == "Charge" else -32.0 * 0.95
		near(sim.imported_kwh - sim.exported_kwh, sim.building_energy_kwh + battery_ac - sim.solar_generated_kwh, "grid accounting through saturation " + mode)
	for mode in ["Pause", "Low", "Normal", "Fast"]:
		sim.reset()
		sim.set_ev_mode(mode)
		var power: float = {"Pause": 0.0, "Low": 3.0, "Normal": 7.0, "Fast": 11.0}[mode]
		near(sim.ev_power_kw, power, "EV mode power " + mode)
		near(sim.grid_kw, 4.0 + power, "EV affects grid immediately")
		sim.advance(60.0)
		near(sim.ev_energy_kwh, 22.8 + power * 0.9, "EV actual elapsed energy " + mode)
	# Fast stops exactly at target, even when a large step crosses completion.
	sim.reset()
	sim.set_ev_mode("Fast")
	near(sim.ev_completion_minute(), 480.0 + 25.2 / 9.9 * 60.0, "Fast ETA")
	sim.advance(260.0)
	near(sim.ev_soc(), 80.0, "EV stops at target")
	near(sim.ev_power_kw, 0.0, "target shuts off EV draw")
	check(sim.ev_target_reached and not sim.ev_departed, "target reached before departure")
	sim.advance(10.0)
	check(sim.ev_departed and not sim.ev_departed_below_target, "successful departure recorded")
	near(sim.ev_soc_at_departure, 80.0, "departure SoC captured")
	sim.reset()
	sim.set_ev_mode("Low")
	check(sim.ev_completion_minute() > sim.config.ev_departure_minute, "Low ETA indicates missed departure")
	sim.advance(270.0)
	near(sim.ev_soc(), 58.25, "Low energy stops exactly at departure")
	check(sim.ev_departed and sim.ev_departed_below_target, "missed target recorded")
	var departed_energy: float = sim.ev_energy_kwh
	sim.set_ev_mode("Fast")
	sim.advance(60.0)
	near(sim.ev_energy_kwh, departed_energy, "departed EV cannot charge")
	near(sim.ev_power_kw, 0.0, "departed draw zero")
	near(sim.ev_completion_minute(), -1.0, "no ETA after departure")
	var full_ev = Simulation.new({"ev_target_soc": 100.0, "ev_initial_soc": 99.0})
	full_ev.set_ev_mode("Fast")
	full_ev.advance(240.0)
	near(full_ev.ev_soc(), 100.0, "EV 100 percent hard bound")
	var limited_ev = Simulation.new({"ev_max_power_kw": 5.0})
	limited_ev.set_ev_mode("Fast")
	near(limited_ev.ev_power_kw, 5.0, "vehicle/charger limit respected")
	var smaller_solar = Simulation.new({"solar_capacity_kwp": 17.5})
	near(smaller_solar.solar_kw, 2.0, "capacity scales solar profile")
	smaller_solar.advance(60.0)
	near(smaller_solar.solar_generated_kwh, 4.0, "capacity scales solar energy")
	# A frame just below 15:00 must not price the next frame at the midday rate.
	var tariff_edge = Simulation.new({"solar_capacity_kwp": 0.0})
	tariff_edge.advance(420.0 - 1e-10)
	var edge_cost: float = tariff_edge.electricity_cost_eur
	tariff_edge.advance(1.0)
	near(tariff_edge.electricity_cost_eur - edge_cost, (18.0 + 18.0 - 1.0 / 60.0) * 0.5 / 60.0 * 0.32, "near-boundary tariff regression")
	# Full default day expectations derived independently from profile trapezoids.
	sim.reset()
	sim.advance(600.0)
	near(sim.building_energy_kwh, 161.0, "full-day demand integral")
	near(sim.solar_generated_kwh, 194.5, "full-day solar integral")
	near(sim.imported_kwh, 28.988636363636, "default full-day imports")
	near(sim.exported_kwh, 34.488636363636, "default full-day exports")
	near(sim.electricity_cost_eur, 6.028863636364, "cost split across tariff boundaries")
	near(sim.max_grid_import_kw, 11.0, "maximum import tracked")
	near(sim.imported_kwh - sim.exported_kwh, 161.0 + 28.0 - 194.5, "whole-day power/energy conservation")
	check(sim.day_finished and sim.paused and sim.ev_departed, "18:00 clean stop")
	var final_state := state(sim)
	sim.advance(1000.0)
	sim.set_battery_mode("Charge")
	sim.set_ev_mode("Fast")
	check(state(sim) == final_state, "end state preserved")
	sim.reset()
	same(sim, Simulation.new(), "reset restores every field")
	same(run_schedule([600.0]), run_schedule([600.0]), "deterministic repeated run")
	var reference = run_schedule([600.0])
	for steps in [[1.0], [0.25], [0.1], [1.0 / 60.0], [0.017, 0.231, 2.75, 0.5, 7.123]]:
		same(reference, run_schedule(steps), "subdivision independence " + str(steps))
	print("ENERGY SIMULATION TESTS: %d checks, %d failures" % [checks, failures])
	quit(0 if failures == 0 else 1)
