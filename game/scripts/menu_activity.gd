extends "res://scripts/site_activity.gd"
## Cosmetic, bounded attract loop; never advances the gameplay model.
func _process(delta: float) -> void:
	accumulator+=delta
	if accumulator<0.05: return
	phase=fmod(phase+accumulator,600.0)
	accumulator=0
	queue_redraw()

func _draw() -> void:
	var hub:=Vector2(1020,305)
	arrow(Vector2(590,125),hub,16,Color("#dfb654"))
	arrow(hub,Vector2(725,275),12,Color("#2b9985"))
	arrow(hub,Vector2(1150,410),5,Color("#2b9985"))
	if reduced: return
	var car_x:=lerpf(1440,350,clampf(fmod(phase,35)/12.0,0,1))
	draw_set_transform(Vector2(car_x,530),-PI/2,Vector2.ONE*0.9)
	get_parent().car(Vector2(-24.5,-44),Color("#75a8bc"),self)
	draw_set_transform(Vector2.ZERO)
	for i in range(2):
		var point:=Vector2(fmod(phase*12+i*700,1550)-100,45+i*40)
		for offset in [Vector2.ZERO,Vector2(35,-10),Vector2(70,5)]:
			draw_circle(point+offset,32,Color(0.8,0.85,0.88,0.3))
