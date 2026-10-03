extends RefCounted
const PATH = "user://exhibition_v1.json"
const SCORE_RULES = 3
var data := {"version":1,"entries":[],"music":0.22,"effects":0.35,"mute":false,"ambient":true}
var last_error := ""

func _init(path: String = PATH) -> void:
	storage_path = path
	if FileAccess.file_exists(path):
		var value = JSON.parse_string(FileAccess.get_file_as_string(path))
		if value is Dictionary and value.get("version",0)==1:
			for key in data:
				if value.has(key) and typeof(value[key])==typeof(data[key]): data[key]=value[key]
			data.music=clampf(float(data.music),0,1)
			data.effects=clampf(float(data.effects),0,1)
			var valid: Array=[]
			for entry in data.entries:
				if entry is Dictionary and entry.get("name") is String and entry.get("score") is float and entry.get("cost") is float and entry.get("mode") is String and is_finite(entry.score) and is_finite(entry.cost) and entry.score>=0 and entry.score<=1000:
					valid.append(entry)
			data.entries=valid.slice(0,50)
var storage_path := PATH

func save() -> bool:
	var file := FileAccess.open(storage_path+".tmp",FileAccess.WRITE)
	if file==null:
		last_error="Could not save local settings/ranking. This run is still playable."
		return false
	file.store_string(JSON.stringify(data))
	file.close()
	var error := DirAccess.rename_absolute(storage_path+".tmp",storage_path)
	last_error="" if error==OK else "Local storage unavailable. Ranking is in memory only."
	return error==OK

func record(name: String, result: Dictionary, mode: String) -> int:
	var entry := {"name":name.strip_edges().left(24),"score":result.score,"cost":result.cost,"ev":result.ev_met,"mode":mode,"rules":SCORE_RULES,"stamp":Time.get_datetime_string_from_system(),"token":str(Time.get_ticks_usec())}
	data.entries.append(entry)
	data.entries.sort_custom(func(a,b):
		if (a.get("rules",1)==SCORE_RULES)!=(b.get("rules",1)==SCORE_RULES): return a.get("rules",1)==SCORE_RULES
		return a.score>b.score if a.score!=b.score else a.cost<b.cost)
	var rank: int = current_entries().find(entry)+1
	data.entries=data.entries.slice(0,50)
	save()
	return rank

func current_entries() -> Array:
	return data.entries.filter(func(entry): return entry.get("rules",1)==SCORE_RULES)
