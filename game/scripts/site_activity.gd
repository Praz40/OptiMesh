extends Node2D
var model
var reduced := false
var accumulator := 0.0
var phase := 0.0

func _process(delta: float) -> void:
	accumulator+=delta
	if accumulator<0.05: return
	phase+=accumulator
	accumulator=0
	queue_redraw()

func vehicle_position(bay: Vector2, arrival: float, departure: float, t: float) -> Vector3:
	if t<arrival or t>departure+8: return Vector3(0,0,-1)
	if t<arrival+8 and arrival>480:
		var p: float=(t-arrival)/8.0
		if p<0.75: return Vector3(lerpf(1440,bay.x,p/0.75),530,-PI/2)
		return Vector3(bay.x,lerpf(530,bay.y,(p-0.75)/0.25),0)
	if t<departure: return Vector3(bay.x,bay.y,0)
	var p: float=(t-departure)/8.0
	if p<0.25: return Vector3(bay.x,lerpf(bay.y,530,p/0.25),0)
	return Vector3(lerpf(bay.x,1440,(p-0.25)/0.75),530,PI/2)

func draw_vehicle(bay: Vector2, arrival: float, departure: float, color: Color) -> void:
	var pos := vehicle_position(bay,arrival,departure,model.time_minutes)
	if pos.z == -1: return
	draw_set_transform(Vector2(pos.x,pos.y),pos.z,Vector2.ONE*0.9)
	get_parent().car(Vector2(-24.5,-44),color,self)
	draw_set_transform(Vector2.ZERO)

func arrow(a: Vector2,b: Vector2,power: float,color: Color) -> void:
	if absf(power)<0.1: return
	if power<0:
		var swap:=a
		a=b
		b=swap
	draw_line(a,b,Color(color,0.3),2,true)
	var p:=a.lerp(b,fmod(phase*0.35,1))
	var direction:=(b-a).normalized()
	draw_circle(p,clampf(absf(power)/7.0,2,5),color)
	draw_line(p,p-direction.rotated(0.6)*10,color,2,true)
	draw_line(p,p-direction.rotated(-0.6)*10,color,2,true)

func status_badge(point: Vector2, text: String, color: Color, width: float=94) -> void:
	draw_style_box(get_parent().style(Color("#f8faf6"),5),Rect2(point,Vector2(width,25)))
	draw_string(ThemeDB.fallback_font,point+Vector2(6,18),text,HORIZONTAL_ALIGNMENT_LEFT,-1,15,color)

func _draw() -> void:
	if model==null: return
	var t: float=model.time_minutes
	var midday:=1.0-absf(t-780)/300
	draw_style_box(get_parent().style(Color(0.12,0.22,0.35,0.10*(1-clampf(midday,0,1))),28),Rect2(10,0,1360,610))
	if model.weather_factor(t)<1:
		draw_colored_polygon(get_parent().quad(345,65,355,110,35),Color(0.25,0.32,0.42,0.32))
	if model.dirty:
		for i in range(18): draw_circle(Vector2(370+i%6*60,80+i/6*34),4,Color(0.67,0.5,0.25,0.7))
	if model.cleaning_end>t:
		draw_rect(Rect2(360,80,380,100),Color(0.8,0.95,1,0.25))
		draw_string(ThemeDB.fallback_font,Vector2(390,125),"CLEANING · %d MIN LEFT" % ceili(model.cleaning_end-t),HORIZONTAL_ALIGNMENT_LEFT,-1,18,Color("#174e43"))
	draw_vehicle(Vector2(136.5,409),model.config.get("ev_arrival_minute",480),model.config.ev_departure_minute,Color("#f1f3e7"))
	for i in range(model.vehicles.size()):
		var v: Dictionary=model.vehicles[i]
		draw_vehicle(Vector2(241.5+i*105,409),v.arrival,v.departure,[Color("#75a8bc"),Color("#ddc280")][i])
	for i in range(3):
		var connected: bool=not model.ev_departed if i==0 else t>=model.vehicles[i-1].arrival and not model.vehicles[i-1].departed
		var ready: bool=model.ev_target_reached if i==0 else model.vehicles[i-1].energy>=model.vehicles[i-1].capacity*model.vehicles[i-1].target/100-0.001
		var power: float=model.ev_power_kw if i==0 else model.vehicles[i-1].power
		var remaining: float=model.ev_target_energy()-model.ev_energy_kwh if i==0 else model.vehicles[i-1].capacity*model.vehicles[i-1].target/100-model.vehicles[i-1].energy
		var deadline: float=model.config.ev_departure_minute if i==0 else model.vehicles[i-1].departure
		var risk: bool=connected and not ready and (power<=0 or remaining*60/maxf(power*0.9,0.0001)>deadline-t)
		var caption: String="Empty" if not connected else "Ready ✓" if ready else "%.0f kW%s" % [power," !" if risk else ""]
		status_badge(Vector2(90+i*105,480),caption,Color("#ad5143") if risk else Color("#248c77") if connected else Color("#6b8185"))
	status_badge(Vector2(1090,463),"%s %.0f%%" % [model.battery_mode,model.battery_soc()],Color("#248c77"),145)
	if model.flex_kw>0: draw_circle(Vector2(978,286),4+sin(phase*3),Color("#248c77"))
	for i in range(6):
		draw_vehicle(Vector2(484.5+i*87,409),490+i*11,980+i*12,Color("#9fbabb") if i%2==0 else Color("#d8b393"))
	var hub:=Vector2(1020,305)
	arrow(Vector2(590,125),hub,model.solar_kw,Color("#dfb654"))
	arrow(hub,Vector2(725,275),model.building_kw,Color("#2b9985"))
	arrow(hub,Vector2(1150,410),model.battery_power_kw,Color("#2b9985"))
	arrow(Vector2(1270,330),hub,model.grid_kw,Color("#9386b0"))
	var ev_total: float=model.ev_power_kw
	for v in model.vehicles: ev_total+=v.power
	arrow(hub,Vector2(275,335),ev_total,Color("#6d99ba"))
	if reduced: return
	# Bounded decorative actors. Walking is a deterministic time-of-day loop.
	if t<1020:
		for i in range(4):
			var p:=fmod(t/14.0+i*0.23,1.0)
			var point:=Vector2(410+i*105,465).lerp(Vector2(620+i*20,305),p if t<900 else 1-p)
			draw_line(point+Vector2(-3,10),point+Vector2(sin(phase*4+i)*4,19),Color("#526f78"),3,true)
			draw_circle(point,5,Color("#d8b393"))
			draw_line(point+Vector2(0,5),point+Vector2(0,12),Color("#6d99ba"),6,true)
	if t>=680 and t<745:
		for i in range(3):
			var p:=Vector2(1450-(t-680)*28+i*200,75+i*65)
			for offset in [Vector2.ZERO,Vector2(35,-10),Vector2(70,5)]: draw_circle(p+offset,45,Color(0.8,0.85,0.88,0.35))
	if fmod(t-480,110)<12:
		var x:=fmod(t-480,110)*120
		for i in range(2):
			var p:=Vector2(x+i*35,35+i*17)
			draw_polyline(PackedVector2Array([p+Vector2(-8,-3),p,p+Vector2(8,-3)]),Color("#526f78"),2,true)
