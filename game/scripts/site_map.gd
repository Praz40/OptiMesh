extends Control
## Cached, code-native vector drawing. No physics, textures or per-frame redraw.
signal object_selected(id: String)

var selected_id := ""
var guided_id := ""
var hovered_id := ""
var hit_regions: Array[Dictionary] = []
var font: Font = ThemeDB.fallback_font
const INK = Color("#263f49")
const MINT = Color("#2b9985")
const ROAD_RIGHT := 1370.0
const DEPARTURE_DURATION := 6.0
var ev_departed_visual := false
var ev_vehicle_visible := true
var departure_elapsed := 0.0
var departure_car: Node2D
var living_site := false

func _ready() -> void:
	set_process(false)
	departure_car = Node2D.new()
	add_child(departure_car)
	departure_car.visible = false
	departure_car.draw.connect(func(): car(Vector2(-24.5, -44), Color("#f1f3e7"), departure_car))
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	mouse_exited.connect(func(): hovered_id = ""; queue_redraw())
	hit_regions = [
		{"id": "building", "polygon": quad(270, 30, 700, 190, 60, 85)},
		{"id": "solar", "polygon": quad(345, 65, 355, 110, 35)},
		{"id": "hvac", "polygon": quad(805, 95, 105, 65, 20, 20)},
		{"id": "inverter", "polygon": quad(1080, 235, 85, 45, 18, 75)},
		{"id": "battery", "polygon": quad(1070, 365, 130, 55, 20, 65)},
		{"id": "grid", "polygon": quad(1220, 270, 85, 60, 20, 70)},
	]
	for index in range(3):
		hit_regions.append({"id": "ev_%d" % (index + 1), "polygon": quad(90 + index * 105, 335, 92, 142, 0, 0)})
	if living_site: hit_regions.append({"id":"flex","polygon":quad(945,270,85,30,10,40)})

func quad(x: float, y: float, w: float, d: float, skew: float, height: float = 0.0) -> PackedVector2Array:
	if height == 0.0:
		return PackedVector2Array([Vector2(x, y), Vector2(x + w, y), Vector2(x + w + skew, y + d), Vector2(x + skew, y + d)])
	return PackedVector2Array([Vector2(x, y), Vector2(x + w, y), Vector2(x + w + skew, y + d), Vector2(x + w + skew, y + d + height), Vector2(x + skew, y + d + height), Vector2(x, y + height)])

func object_at(point: Vector2) -> String:
	var badges := {"solar": Rect2(435, 15, 145, 32), "hvac": Rect2(798, 54, 80, 32), "inverter": Rect2(1083, 194, 105, 32), "battery": Rect2(1076, 490, 100, 32), "grid": Rect2(1240, 230, 80, 32)}
	if living_site: badges["flex"]=Rect2(948,315,145,32)
	for id in badges:
		if badges[id].has_point(point): return id
	# Reverse order prioritizes roof equipment over its parent building.
	for index in range(hit_regions.size() - 1, -1, -1):
		if Geometry2D.is_point_in_polygon(point, hit_regions[index].polygon):
			return hit_regions[index].id
	return ""

func select(id: String) -> void:
	selected_id = id
	queue_redraw()

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		var next := object_at(event.position)
		if next != hovered_id:
			hovered_id = next
			mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if next != "" else Control.CURSOR_ARROW
			queue_redraw()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		var id := object_at(event.position)
		if id != "":
			object_selected.emit(id)
			accept_event()

func poly(points: Array, color: Color) -> void:
	draw_colored_polygon(PackedVector2Array(points), color)

func box(x: float, y: float, w: float, d: float, h: float, skew: float, top: Color, front: Color) -> void:
	poly([Vector2(x + 10, y + h + 10), Vector2(x + w + 14, y + h + 10), Vector2(x + w + skew + 28, y + d + h + 18), Vector2(x + skew + 18, y + d + h + 18)], Color(0.15, 0.28, 0.26, 0.10))
	poly([Vector2(x + skew, y + d), Vector2(x + w + skew, y + d), Vector2(x + w + skew, y + d + h), Vector2(x + skew, y + d + h)], front)
	poly([Vector2(x + w, y), Vector2(x + w + skew, y + d), Vector2(x + w + skew, y + d + h), Vector2(x + w, y + h)], front.darkened(0.15))
	poly([Vector2(x, y), Vector2(x + w, y), Vector2(x + w + skew, y + d), Vector2(x + skew, y + d)], top)

func txt(point: Vector2, text: String, size_px: int = 18, color: Color = INK) -> void:
	draw_string(font, point, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size_px, color)

func badge(point: Vector2, caption: String, color: Color = INK) -> void:
	var width := font.get_string_size(caption, HORIZONTAL_ALIGNMENT_LEFT, -1, 17).x + 28
	draw_style_box(style(Color("#ffffff"), 8), Rect2(point, Vector2(width, 32)))
	draw_circle(point + Vector2(13, 16), 3, color)
	txt(point + Vector2(23, 22), caption, 17)

func style(color: Color, radius: int) -> StyleBoxFlat:
	var result := StyleBoxFlat.new()
	result.bg_color = color
	result.set_corner_radius_all(radius)
	return result

func tree(point: Vector2, radius: float = 25) -> void:
	draw_circle(point + Vector2(10, 10), radius + 3, Color(0.1, 0.25, 0.2, 0.08))
	draw_circle(point, radius, Color("#8fbaa5"))
	draw_circle(point + Vector2(-6, -7), radius * 0.72, Color("#a5cbb5"))
	draw_circle(point + Vector2(7, 3), radius * 0.50, Color("#79a990"))

func car(point: Vector2, color: Color, canvas: CanvasItem = null) -> void:
	if canvas == null: canvas = self
	canvas.draw_style_box(style(Color(0, 0, 0, 0.12), 13), Rect2(point + Vector2(5, 7), Vector2(49, 88)))
	canvas.draw_style_box(style(color, 12), Rect2(point, Vector2(49, 88)))
	canvas.draw_style_box(style(color.lightened(0.15), 8), Rect2(point + Vector2(5, 24), Vector2(39, 36)))
	canvas.draw_style_box(style(Color("#345c68"), 4), Rect2(point + Vector2(6, 15), Vector2(37, 15)))
	canvas.draw_style_box(style(Color("#345c68"), 4), Rect2(point + Vector2(6, 63), Vector2(37, 10)))
	for offset in [Vector2(5, 5), Vector2(35, 5)]:
		canvas.draw_rect(Rect2(point + offset, Vector2(9, 4)), Color("#eef6e7"))

func begin_ev_departure() -> void:
	if ev_departed_visual: return
	ev_departed_visual = true
	departure_elapsed = 0.0
	departure_car.visible = true
	departure_car.queue_redraw()
	advance_departure_visual(0.0)
	set_process(true)
	queue_redraw() # Remove the parked car once; the map stays cached thereafter.

func reset_ev_visual() -> void:
	ev_departed_visual = false
	ev_vehicle_visible = true
	departure_elapsed = 0.0
	departure_car.visible = false
	set_process(false)
	queue_redraw()

func advance_departure_visual(seconds: float) -> void:
	if not ev_departed_visual: return
	departure_elapsed = clampf(departure_elapsed + maxf(seconds, 0.0), 0.0, DEPARTURE_DURATION)
	departure_car.scale = Vector2.ONE * lerpf(1.0, 0.8, minf(departure_elapsed / 1.5, 1.0))
	if departure_elapsed <= 1.5:
		var progress := departure_elapsed / 1.5
		departure_car.position = Vector2(136.5, lerpf(409.0, 530.0, progress))
		departure_car.rotation = 0.0 # Reverse out of the bay.
	elif departure_elapsed <= 2.0:
		departure_car.position = Vector2(136.5, 530.0)
		departure_car.rotation = (departure_elapsed - 1.5) * PI
	else:
		departure_car.position = Vector2(lerpf(136.5, 1440.0, (departure_elapsed - 2.0) / 4.0), 530.0)
		departure_car.rotation = PI * 0.5
	ev_vehicle_visible = departure_elapsed < DEPARTURE_DURATION
	departure_car.visible = ev_vehicle_visible
	if not ev_vehicle_visible: set_process(false)

func _process(delta: float) -> void:
	advance_departure_visual(delta)

func _draw() -> void:
	# Landscaped campus slab and a quiet access lane.
	draw_style_box(style(Color("#d8e5dd"), 28), Rect2(10, 0, 1360, 610))
	draw_style_box(style(Color("#e4ebe3"), 20), Rect2(55, 20, 1260, 480))
	var road := style(Color("#7d9193"), 16)
	road.corner_radius_top_right = 0
	road.corner_radius_bottom_right = 0
	draw_style_box(road, Rect2(40, 510, ROAD_RIGHT - 40, 80))
	for x in range(85, 1330, 95):
		draw_line(Vector2(x, 550), Vector2(x + 45, 550), Color("#d5e1dc"), 3, true)
	txt(Vector2(1055, 580), "ENTRY / EXIT  →", 16, Color("#eef4ef"))
	# Pedestrian strip and energy cable routes.
	draw_style_box(style(Color("#c9d8d0"), 8), Rect2(300, 295, 720, 42))
	draw_line(Vector2(980, 220), Vector2(1125, 220), Color("#b8cbbf"), 8)
	draw_line(Vector2(1125, 220), Vector2(1125, 435), Color("#b8cbbf"), 8)
	draw_line(Vector2(1130, 355), Vector2(1270, 355), Color("#b8cbbf"), 8)
	# Office roof, glazing, door, parapet and roof arrays.
	box(270, 30, 700, 190, 85, 60, Color("#b6c9c7"), Color("#f4f4e9"))
	poly([Vector2(285, 39), Vector2(957, 39), Vector2(1009, 207), Vector2(342, 207)], Color("#cad8d2"))
	for x in range(360, 960, 72):
		draw_rect(Rect2(x, 237, 52, 42), Color("#4b7280"))
		draw_rect(Rect2(x + 3, 240, 22, 36), Color("#739aa2"))
		draw_line(Vector2(x + 28, 238), Vector2(x + 28, 279), Color("#d3e6e2"), 2)
	draw_rect(Rect2(645, 235, 63, 70), Color("#355a65"))
	draw_line(Vector2(676, 239), Vector2(676, 302), Color("#bad3d1"), 2)
	txt(Vector2(394, 299), "WESTBROOK   /   OFFICE", 15, Color("#49646b"))
	for row in range(4):
		for column in range(8):
			var px := 345.0 + column * 44 + row * 8.5
			var py := 65.0 + row * 28
			poly([Vector2(px, py), Vector2(px + 40, py), Vector2(px + 47, py + 23), Vector2(px + 7, py + 23)], Color("#315f78"))
			draw_line(Vector2(px + 3, py + 11), Vector2(px + 43, py + 11), Color("#6a9eae"), 1, true)
			draw_line(Vector2(px + 20, py), Vector2(px + 27, py + 23), Color("#6a9eae"), 1, true)
	box(805, 95, 105, 65, 20, 20, Color("#e8efed"), Color("#98adb2"))
	for center in [Vector2(842.5, 127.5), Vector2(892.5, 127.5)]:
		draw_circle(center, 18, Color("#657f86"))
		draw_arc(center, 12, 0, TAU, 20, Color("#c8d7d6"), 2, true)
		draw_line(center - Vector2(9, 0), center + Vector2(9, 0), Color("#c8d7d6"), 2, true)
	# EV spaces and small freestanding charging stations.
	for index in range(3):
		var x := 90 + index * 105
		draw_style_box(style(Color("#c5dfd0"), 6), Rect2(x, 335, 92, 142))
		draw_rect(Rect2(x + 4, 339, 84, 134), Color("#67a88e"), false, 2)
		box(x + 25, 322, 30, 15, 35, 5, Color("#f3f6ef"), Color("#4d6970"))
		draw_rect(Rect2(x + 34, 341, 13, 9), MINT)
		if not living_site and (index != 0 or not ev_departed_visual):
			car(Vector2(x + 22, 365), [Color("#f1f3e7"), Color("#75a8bc"), Color("#ddc280")][index])
		txt(Vector2(x + 23, 468), "EV 0%d" % (index + 1), 14, Color("#2a7965"))
	# Conventional parking row.
	for index in range(6):
		var x := 445 + index * 87
		draw_rect(Rect2(x, 354, 80, 133), Color("#d4ddd7"))
		draw_rect(Rect2(x + 3, 357, 74, 127), Color("#f8faf2"), false, 2)
		txt(Vector2(x + 33, 474), "P", 17, Color("#83968a"))
		if not living_site and index in [0, 2, 3, 5]:
			car(Vector2(x + 16, 370), [Color("#839aa2"), Color("#b7c3bc"), Color("#d79d81"), Color("#e7eadd")][index % 4])
	# Inverter, battery cabinets, transformer/meter.
	if living_site:
		box(945,270,85,30,40,10,Color("#d8e4e7"),Color("#f4f8f5"))
		draw_circle(Vector2(990,315),12,Color("#537f8b"))
	box(1080, 235, 85, 45, 75, 18, Color("#e4e8d8"), Color("#f5f5e9"))
	draw_rect(Rect2(1105, 289, 46, 30), Color("#3e646a"))
	txt(Vector2(1116, 309), "AC", 17, Color("#d4f0e3"))
	box(1070, 365, 130, 55, 65, 20, Color("#d5e8de"), Color("#f6f7ef"))
	for index in range(3):
		draw_rect(Rect2(1102 + index * 36, 430, 28, 41), Color("#c5d8d0"))
		draw_rect(Rect2(1109 + index * 36, 437, 13, 4), MINT)
	box(1220, 270, 85, 60, 70, 20, Color("#b7bbc8"), Color("#d4d7dd"))
	for x in range(1244, 1298, 9):
		draw_line(Vector2(x, 340), Vector2(x, 381), Color("#9b9fb0"), 3)
	draw_rect(Rect2(1230, 287, 28, 30), Color("#4c6271"))
	draw_rect(Rect2(1235, 293, 18, 9), Color("#aad5ba"))
	for point in [Vector2(125, 95), Vector2(175, 155), Vector2(100, 220), Vector2(1030, 60), Vector2(1250, 110), Vector2(1290, 160), Vector2(65, 485), Vector2(1035, 480)]:
		tree(point)
	# Hover and selected outlines use exactly the same polygons as picking.
	for region in hit_regions:
		if region.id == selected_id or region.id == hovered_id or region.id == guided_id:
			var outline: PackedVector2Array = region.polygon.duplicate()
			outline.append(outline[0])
			draw_colored_polygon(region.polygon, Color(0.13, 0.67, 0.55, 0.10))
			var outline_color := MINT if region.id == selected_id else (Color("#ddaa3b") if region.id == guided_id else Color("#7cb6a3"))
			draw_polyline(outline, outline_color, 4 if region.id == selected_id or region.id == guided_id else 2, true)
	badge(Vector2(435, 15), "Rooftop solar", Color("#ddaa3b"))
	if living_site: badge(Vector2(948,315),"Equipment wash",MINT)
	badge(Vector2(798, 54), "HVAC", Color("#6d99ba"))
	badge(Vector2(98, 281), "EV charging · 3 bays", MINT)
	badge(Vector2(1083, 194), "Inverter", Color("#c99242"))
	badge(Vector2(1076, 490), "Battery", MINT)
	badge(Vector2(1240, 230), "Grid", Color("#8b80ad"))
