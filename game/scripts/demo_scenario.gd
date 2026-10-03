extends RefCounted
## One fair, local exhibition challenge. Minutes after midnight.
const EVS = [
	{"id":"ev_2", "capacity":70.0, "initial":30.0, "target":80.0, "arrival":630.0, "departure":990.0, "maximum":11.0},
	{"id":"ev_3", "capacity":45.0, "initial":35.0, "target":75.0, "arrival":810.0, "departure":1005.0, "maximum":11.0}
]
const EVENTS = [
	[540.0,"comfort","The office is filling up. Check Climate: Eco saves power, but warm rooms lose comfort.","hvac"],
	[600.0,"forecast","Clouds arrive at 11:30, until 12:15. Our battery is a reserve; check its charge before spending it.","battery"],
	[630.0,"arrival","EV 02 arrived: 30% → 80% by 16:30. Choose its rate; three chargers share your grid.","ev_2"],
	[660.0,"tariff","Cheap power until 15:00. The equipment wash needs 60 minutes before 15:00; start it during surplus.","flex"],
	[690.0,"cloud","Clouds are cutting solar to 40%. The battery can bridge this dip.","battery"],
	[735.0,"clear","The cloud front has passed. Solar is recovering.","solar"],
	[750.0,"departure","EV 01 leaves now. Its task records the actual departure charge.","ev_1"],
	[780.0,"dust","Dust has reduced solar by 25%. Cleaning costs €2 and takes 15 minutes offline.","solar"],
	[810.0,"arrival","Visitor EV 03 arrived. It needs 75% before 16:45. Check its target ETA.","ev_3"],
	[870.0,"surprise","Change of plan: EV 03 now leaves at 16:00. Compare its ETA with departure; faster charging may be needed.","ev_3"],
	[900.0,"tariff","Power now costs €0.32/kWh. An 18 kW grid limit begins at 15:30 for 45 minutes. Keep battery reserve for it.","grid"],
	[930.0,"limit","Grid challenge active: stay below 18 kW until 16:15. Coordinate battery, chargers and cooling.","grid"],
	[960.0,"departure","EV 03 leaves on its revised schedule. See its task for the result.","ev_3"],
	[975.0,"limit_end","Grid challenge ended. Its result measures every minute above the limit.","grid"],
	[990.0,"departure","EV 02 leaves now. Keep the office comfortable until closing.","ev_2"],
	[1020.0,"tariff","Final hour: power is €0.24/kWh. Review remaining tasks and battery charge.","battery"]
]
