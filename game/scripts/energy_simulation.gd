extends RefCounted
## Deterministic office day. Time is minutes after midnight; powers are AC-side kW.
## Grid + = import, - = export. Battery + = charge, - = discharge.
## Piecewise-linear profiles and exact segment integration avoid frame-size drift.

const START_MINUTE := 480.0
const END_MINUTE := 1080.0
const EPS := 1e-9
# [minute after midnight, kW]. Interpolate linearly; no random variation.
const BUILDING_PROFILE := [[480.0, 8.0], [540.0, 14.0], [600.0, 18.0], [720.0, 20.0], [780.0, 15.0], [840.0, 19.0], [960.0, 17.0], [1020.0, 13.0], [1080.0, 8.0]]
# Clear-day AC output, including conversion losses: 35 kWp, 31.5 kW peak.
const SOLAR_PROFILE := [[480.0, 4.0], [600.0, 20.0], [720.0, 30.0], [780.0, 31.5], [840.0, 28.0], [960.0, 15.0], [1080.0, 2.0]]
# [inclusive start minute, import €/kWh]. Export earns €0, without net metering.
const TARIFF := [[480.0, 0.18], [660.0, 0.10], [900.0, 0.32], [1020.0, 0.24]]
const DEFAULTS := {
	"solar_capacity_kwp": 35.0,
	"battery_capacity_kwh": 50.0, "battery_initial_soc": 64.0,
	"battery_charge_limit_kw": 15.0, "battery_discharge_limit_kw": 15.0,
	"battery_charge_efficiency": 0.95, "battery_discharge_efficiency": 0.95,
	"ev_capacity_kwh": 60.0, "ev_initial_soc": 38.0, "ev_target_soc": 80.0,
	"ev_departure_minute": 750.0, "ev_max_power_kw": 11.0,
	"ev_charge_efficiency": 0.90
}
const EV_POWERS := {"Pause": 0.0, "Low": 3.0, "Normal": 7.0, "Fast": 11.0}
const EXPORT_PRICE := 0.0

var config: Dictionary
var time_minutes := START_MINUTE
var paused := false
var day_finished := false
var building_kw := 0.0
var solar_kw := 0.0
var price_eur_per_kwh := 0.0
var grid_kw := 0.0
var imported_kwh := 0.0
var exported_kwh := 0.0
var electricity_cost_eur := 0.0
var max_grid_import_kw := 0.0
var solar_generated_kwh := 0.0
var building_energy_kwh := 0.0
var battery_energy_kwh := 0.0
var battery_power_kw := 0.0
var battery_mode := "Hold"
var ev_energy_kwh := 0.0
var ev_power_kw := 0.0
var ev_mode := "Normal"
var ev_departed := false
var ev_target_reached := false
var ev_departed_below_target := false
var ev_soc_at_departure := -1.0

func _init(overrides: Dictionary = {}) -> void:
	config = DEFAULTS.duplicate(true)
	config.merge(overrides, true)
	reset()

func reset() -> void:
	time_minutes = START_MINUTE
	paused = false
	day_finished = false
	imported_kwh = 0.0
	exported_kwh = 0.0
	electricity_cost_eur = 0.0
	max_grid_import_kw = 0.0
	solar_generated_kwh = 0.0
	building_energy_kwh = 0.0
	battery_energy_kwh = config.battery_capacity_kwh * clampf(config.battery_initial_soc, 0.0, 100.0) / 100.0
	battery_mode = "Hold"
	ev_energy_kwh = config.ev_capacity_kwh * clampf(config.ev_initial_soc, 0.0, 100.0) / 100.0
	ev_mode = "Normal"
	ev_departed = false
	ev_target_reached = false
	ev_departed_below_target = false
	ev_soc_at_departure = -1.0
	_refresh_power()

static func profile_at(profile: Array, minute: float) -> float:
	for index in range(1, profile.size()):
		if minute <= profile[index][0]:
			var left: Array = profile[index - 1]
			var right: Array = profile[index]
			return lerpf(left[1], right[1], clampf((minute - left[0]) / (right[0] - left[0]), 0.0, 1.0))
	return profile.back()[1]

static func tariff_at(minute: float) -> float:
	var price: float = TARIFF[0][1]
	for period in TARIFF:
		if minute >= period[0]: price = period[1]
	return price

func battery_soc() -> float:
	return 100.0 * battery_energy_kwh / config.battery_capacity_kwh

func ev_soc() -> float:
	return 100.0 * ev_energy_kwh / config.ev_capacity_kwh

func ev_target_energy() -> float:
	return config.ev_capacity_kwh * clampf(config.ev_target_soc, 0.0, 100.0) / 100.0

func _solar_at(minute: float) -> float:
	return profile_at(SOLAR_PROFILE, minute) * config.solar_capacity_kwp / 35.0

func set_battery_mode(mode: String) -> void:
	if day_finished or mode not in ["Charge", "Hold", "Discharge"]: return
	battery_mode = mode
	_refresh_power()

func set_ev_mode(mode: String) -> void:
	if day_finished or not EV_POWERS.has(mode): return
	ev_mode = mode
	_refresh_power()

func _refresh_power() -> void:
	building_kw = profile_at(BUILDING_PROFILE, time_minutes)
	solar_kw = _solar_at(time_minutes)
	price_eur_per_kwh = tariff_at(time_minutes)
	battery_power_kw = 0.0
	if battery_mode == "Charge" and battery_energy_kwh < config.battery_capacity_kwh - EPS:
		battery_power_kw = config.battery_charge_limit_kw
	elif battery_mode == "Discharge" and battery_energy_kwh > EPS:
		battery_power_kw = -config.battery_discharge_limit_kw
	ev_target_reached = ev_energy_kwh >= ev_target_energy() - EPS
	if not ev_departed and time_minutes >= config.ev_departure_minute - EPS:
		ev_departed = true
		ev_soc_at_departure = ev_soc()
		ev_departed_below_target = not ev_target_reached
	ev_power_kw = 0.0
	if not ev_departed and not ev_target_reached:
		ev_power_kw = minf(EV_POWERS[ev_mode], config.ev_max_power_kw)
	grid_kw = building_kw + ev_power_kw + battery_power_kw - solar_kw
	max_grid_import_kw = maxf(max_grid_import_kw, grid_kw)

func self_supply_percent() -> float:
	# Instantaneous local supply share (solar + battery discharge) of AC consumption,
	# including battery charging. This is not renewable provenance or a score.
	var consumption := building_kw + ev_power_kw + maxf(battery_power_kw, 0.0)
	var local_supply := solar_kw + maxf(-battery_power_kw, 0.0)
	return 100.0 * minf(consumption, local_supply) / consumption if consumption > EPS else 0.0

func ev_completion_minute() -> float:
	# ETA at current charging rate, ignoring pause/speed. -1 means unavailable.
	# An ETA after departure is shown as unreachable before departure in the UI.
	if ev_target_reached or ev_departed or ev_power_kw <= EPS: return -1.0
	return time_minutes + (ev_target_energy() - ev_energy_kwh) * 60.0 / (ev_power_kw * config.ev_charge_efficiency)

static func positive_energy(start_kw: float, end_kw: float, hours: float) -> float:
	# Exact positive area of a line, split at the import/export zero crossing.
	if start_kw >= 0.0 and end_kw >= 0.0: return (start_kw + end_kw) * 0.5 * hours
	if start_kw <= 0.0 and end_kw <= 0.0: return 0.0
	var peak := maxf(start_kw, end_kw)
	return 0.5 * peak * peak / absf(end_kw - start_kw) * hours

func advance(simulated_minutes: float) -> void:
	if paused or day_finished or simulated_minutes <= 0.0: return
	var end := minf(time_minutes + simulated_minutes, END_MINUTE)
	while time_minutes < end:
		_refresh_power()
		var boundary := end
		# Each segment has linear building/solar power, constant price and controls.
		for profile in [BUILDING_PROFILE, SOLAR_PROFILE, TARIFF]:
			for point in profile:
				# Never skip a tariff boundary because a frame ends just below it.
				if point[0] > time_minutes: boundary = minf(boundary, point[0])
		if config.ev_departure_minute > time_minutes + EPS:
			boundary = minf(boundary, config.ev_departure_minute)
		if battery_power_kw > EPS:
			boundary = minf(boundary, time_minutes + (config.battery_capacity_kwh - battery_energy_kwh) * 60.0 / (battery_power_kw * config.battery_charge_efficiency))
		elif battery_power_kw < -EPS:
			boundary = minf(boundary, time_minutes + battery_energy_kwh * 60.0 * config.battery_discharge_efficiency / -battery_power_kw)
		if ev_power_kw > EPS:
			boundary = minf(boundary, time_minutes + (ev_target_energy() - ev_energy_kwh) * 60.0 / (ev_power_kw * config.ev_charge_efficiency))
		var hours := (boundary - time_minutes) / 60.0
		var building_end := profile_at(BUILDING_PROFILE, boundary)
		var solar_end := _solar_at(boundary)
		var grid_end := building_end + ev_power_kw + battery_power_kw - solar_end
		var imported := positive_energy(grid_kw, grid_end, hours)
		var exported := positive_energy(-grid_kw, -grid_end, hours)
		imported_kwh += imported
		exported_kwh += exported
		electricity_cost_eur += imported * price_eur_per_kwh - exported * EXPORT_PRICE
		max_grid_import_kw = maxf(max_grid_import_kw, grid_end)
		building_energy_kwh += (building_kw + building_end) * 0.5 * hours
		solar_generated_kwh += (solar_kw + solar_end) * 0.5 * hours
		var battery_delta := battery_power_kw * hours
		battery_delta *= config.battery_charge_efficiency if battery_delta >= 0.0 else 1.0 / config.battery_discharge_efficiency
		battery_energy_kwh = clampf(battery_energy_kwh + battery_delta, 0.0, config.battery_capacity_kwh)
		ev_energy_kwh = minf(ev_energy_kwh + ev_power_kw * hours * config.ev_charge_efficiency, config.ev_capacity_kwh)
		time_minutes = boundary
	time_minutes = end
	_refresh_power()
	if time_minutes >= END_MINUTE:
		day_finished = true
		paused = true
