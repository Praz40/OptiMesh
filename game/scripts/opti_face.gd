extends Control
var worried := false
func _draw() -> void:
	draw_circle(Vector2(28,27),24,Color("#248c77"))
	for x in [20,36]: draw_circle(Vector2(x,23),3,Color.WHITE)
	draw_arc(Vector2(28,29 if not worried else 40),10,0.2 if not worried else PI+0.2,PI-0.2 if not worried else TAU-0.2,12,Color.WHITE,2,true)
