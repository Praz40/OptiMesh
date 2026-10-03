extends RefCounted
## Presentation metadata. Live readings are populated from EnergySimulation.

static func objects() -> Dictionary:
	return {
		"building": {"name": "Westbrook Office", "type": "BUILDING", "code": "BLD", "color": "#537f8b", "description": "A compact workplace with rooftop generation and three charging bays.", "values": [], "controls": ["Overview", "Schedule"], "mode": "Overview"},
		"solar": {"name": "Rooftop solar", "type": "SOLAR ARRAY", "code": "PV", "color": "#ddaa3b", "description": "A 35 kWp installation follows a clear-day AC production curve. No weather events.", "values": [], "controls": ["Overview", "Forecast"], "mode": "Overview"},
		"hvac": {"name": "Climate system", "type": "HVAC · PLACEHOLDER", "code": "AC", "color": "#6d99ba", "description": "Preview comfort settings. HVAC is not separately simulated; controls do not change building load.", "values": [["Preview temperature", "22.4 °C"], ["Preview target", "22.0 °C"], ["Preview power", "6.2 kW"], ["Preview comfort", "Comfortable"]], "controls": ["Eco", "Normal", "Boost"], "mode": "Normal"},
		"inverter": {"name": "Solar inverter", "type": "ELECTRICAL EQUIPMENT", "code": "INV", "color": "#c99242", "description": "Converts rooftop DC generation to the site's AC supply. Conversion losses are included in the solar curve.", "values": [], "controls": ["Overview", "Diagnostics"], "mode": "Overview"},
		"battery": {"name": "Site battery", "type": "BATTERY STORAGE", "code": "BAT", "color": "#2b9985", "description": "Manually charge, hold or discharge the site battery. Power stops at empty or full.", "values": [], "controls": ["Charge", "Hold", "Discharge"], "mode": "Hold"},
		"grid": {"name": "Grid connection", "type": "METER & TRANSFORMER", "code": "GRID", "color": "#8b80ad", "description": "The site's connection to the public electricity grid. Export earns €0.00 per kWh.", "values": [], "controls": ["Overview", "Meter"], "mode": "Overview"},
		"ev_1": ev("01", "38 %", "80 %", "12:30", "Normal"),
		"ev_2": ev("02", "62 %", "90 %", "17:00", "Low"),
		"ev_3": ev("03", "21 %", "80 %", "15:45", "Pause")
	}

static func ev(number: String, soc: String, target: String, departure: String, mode: String) -> Dictionary:
	return {"name": "EV charger " + number, "type": "EV CHARGING BAY" + ("" if number == "01" else " · PLACEHOLDER"), "code": "EV " + number, "color": "#2b9985", "description": "Charge EV 01 before 12:30. Charging stops at the target or departure." if number == "01" else "Visual preview only. This bay draws no simulated power and does not affect the site balance.", "values": [["EV state of charge", soc], ["Charge target", target], ["Departure", departure], ["Charger capacity", "11.0 kW"]], "controls": ["Pause", "Low", "Normal", "Fast"], "mode": mode}
