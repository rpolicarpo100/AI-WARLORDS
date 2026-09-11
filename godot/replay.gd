extends Node2D
## Vale of Echoes chronicle replay (Godot 4).
## Loads res://data/state.json — genuine engine snapshots/outcomes/events —
## and replays the 15 dispatches on a pointy-top hex map with Kenney
## sprites + synthesized SFX. Open this folder in Godot 4.3+ and press F5.
## NOTE: authored carefully against the Godot 4 API but NOT executed in
## this sandbox (no Godot binary here). Logic mirrors mockups/match.html.

const W := 8
const H := 6
const SQ3 := 1.7320508075688772
const SQUASH := 0.56
const BASE_DUR := 2.2

const TERRAIN_COL := {
	"field": Color("5d8a41"), "forest": Color("3f7038"),
	"mountain": Color("6f7a68"), "river": Color("2e6f9e"),
	"road": Color("a88954"), "bridge": Color("2e6f9e"),
	"village": Color("6da054"), "city": Color("8f8a76"),
	"resource": Color("8a6f3c"),
}
const HOUSE_SLOTS := [Vector2i(2, 3), Vector2i(1, 2), Vector2i(2, 1), Vector2i(1, 3)]
const TOWER_SLOT := Vector2i(0, 2)
const STORAGE_SLOT := Vector2i(0, 1)
# Same dispatch flavor as the web chronicle (illustrative lines; data genuine).
const SCRIPT := ["", "economy.gather", "unit.move", "unit.move", "economy.gather",
	"city.build", "match.advance", "unit.move", "city.build", "match.advance",
	"unit.move", "unit.move", "match.advance", "city.upgrade", "match.advance",
	"economy.gather"]
const HERALD := {
	"economy.gather": "Thy workers toil, sire.",
	"unit.move": "Thy host marches.",
	"city.build": "Masons to work!",
	"match.advance": "Time flows ever onward...",
	"city.upgrade": "Thy city grows in splendor!",
}
const SFX_FOR := {
	"economy.gather": "coin", "unit.move": "step", "city.build": "hammer",
	"match.advance": "whoosh", "city.upgrade": "fanfare",
}
const SPRITES := ["treePine_large", "treePine_small", "treeRound_large",
	"treeRound_small", "rockGrey_large", "rockGrey_medium1", "rockBrown_small",
	"campingTent", "farm", "farmland", "house", "house_small", "mine", "tower",
	"towerRuin", "well", "windmill_complete", "fence", "banner", "box1", "box2",
	"crystals1", "logPile"]
const SFX := ["click", "coin", "step", "hammer", "whoosh", "fanfare"]

var S: Dictionary = {}
var N := 1
var pos := 0.0
var playing := true
var speed := 1.0
var fired_rev := 0
var fog := true
var sel := 18
var muted := false
var shake := 0.0

var cell_s := 40.0
var ox := 0.0
var oy := 0.0
var tex := {}
var snd := {}
var max_hp := {}

var res_label: Label
var tick_label: Label
var now_label: Label
var herald_label: Label
var play_btn: Button
var slider: HSlider


func _ready() -> void:
	load_data()
	load_art()
	build_ui()
	refit()
	get_tree().root.size_changed.connect(refit)


func load_data() -> void:
	var path := "res://data/state.json"
	if not FileAccess.file_exists(path):
		push_error("missing " + path + " — run: npm run godot:sync")
		return
	var f := FileAccess.open(path, FileAccess.READ)
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("state.json did not parse as a Dictionary")
		return
	S = parsed as Dictionary
	N = (S["snapshots"] as Array).size()
	for sn in S["snapshots"] as Array:
		for u in ((sn as Dictionary).get("units", {}) as Dictionary).get("units", []) as Array:
			var ud := u as Dictionary
			max_hp[ud["id"]] = maxi(int(max_hp.get(ud["id"], 0)), int(ud["hp"]))


func load_art() -> void:
	for n in SPRITES:
		var p := "res://assets/kenney/" + n + ".png"
		if ResourceLoader.exists(p):
			tex[n] = load(p)
	for n in SFX:
		var p := "res://sfx/" + n + ".wav"
		var pl := AudioStreamPlayer.new()
		pl.name = "sfx_" + n
		if ResourceLoader.exists(p):
			pl.stream = load(p) as AudioStream
		add_child(pl)
		snd[n] = pl


func mk_button(parent: Container, text: String) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	parent.add_child(b)
	return b


func build_ui() -> void:
	var ui := CanvasLayer.new()
	ui.name = "UI"
	add_child(ui)
	var top := HBoxContainer.new()
	top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	top.offset_left = 12
	top.offset_right = -12
	top.offset_bottom = 40
	top.add_theme_constant_override("separation", 8)
	ui.add_child(top)
	res_label = Label.new()
	top.add_child(res_label)
	tick_label = Label.new()
	top.add_child(tick_label)
	var rst := mk_button(top, "|<")
	rst.pressed.connect(_on_restart)
	var back := mk_button(top, "<")
	back.pressed.connect(_on_back)
	play_btn = mk_button(top, "Pause")
	play_btn.pressed.connect(_on_play)
	var fwd := mk_button(top, ">")
	fwd.pressed.connect(_on_fwd)
	var spd := mk_button(top, "1x")
	spd.pressed.connect(_on_speed.bind(spd))
	var fogb := mk_button(top, "Fog: on")
	fogb.pressed.connect(_on_fog.bind(fogb))
	var mut := mk_button(top, "Sound: on")
	mut.pressed.connect(_on_mute.bind(mut))
	var bottom := VBoxContainer.new()
	bottom.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	bottom.offset_left = 12
	bottom.offset_right = -12
	bottom.offset_top = -104
	bottom.offset_bottom = -8
	bottom.add_theme_constant_override("separation", 4)
	ui.add_child(bottom)
	slider = HSlider.new()
	slider.min_value = 0
	slider.max_value = maxi(1, N - 1)
	slider.step = 0.01
	slider.value_changed.connect(_on_seek)
	bottom.add_child(slider)
	now_label = Label.new()
	bottom.add_child(now_label)
	herald_label = Label.new()
	bottom.add_child(herald_label)


func refit() -> void:
	var vs := get_viewport_rect().size
	var cw := vs.x - 32.0
	var ch := vs.y - 64.0 - 112.0
	var min_x := -0.95
	var max_x := SQ3 * (W - 0.5) + 0.95
	var min_y := -3.4
	var max_y := 1.5 * (H - 1) * SQUASH + 1.5
	cell_s = minf(cw / (max_x - min_x), ch / (max_y - min_y))
	ox = 16.0 + cw / 2.0 - cell_s * (min_x + max_x) / 2.0
	oy = 64.0 + ch / 2.0 - cell_s * (min_y + max_y) / 2.0


# ── Chronicle math (mirrors the web player) ──
func kf(i: int) -> Dictionary:
	return S["snapshots"][clampi(i, 0, N - 1)] as Dictionary


func kf_index() -> int:
	return mini(int(floor(pos)), N - 1)


func frac() -> float:
	var k := kf_index()
	return 0.0 if pos >= N - 1 else pos - k


func rev() -> int:
	var k := kf_index()
	if pos >= N - 1:
		return N - 1
	return k + 1 if pos > k else k


func easef(t: float) -> float:
	if t < 0.5:
		return 2.0 * t * t
	return 1.0 - pow(-2.0 * t + 2.0, 2.0) / 2.0


func centerf(c: float, r: float) -> Vector2:
	var rr := int(round(r))
	var off := 0.5 * float(rr & 1)
	return Vector2(ox + cell_s * SQ3 * (c + off), oy + cell_s * 1.5 * r * SQUASH)


func hex_pts(p: Vector2, s: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for k in 6:
		var a := deg_to_rad(60.0 * k - 90.0)
		pts.append(Vector2(p.x + s * cos(a), p.y + s * sin(a) * SQUASH))
	return pts


func tracks(e: float) -> Array:
	var k := kf_index()
	var kk := mini(k + 1, N - 1)
	var au: Array = ((kf(k).get("units", {}) as Dictionary).get("units", []) as Array)
	var bu: Array = ((kf(kk).get("units", {}) as Dictionary).get("units", []) as Array)
	var am := {}
	for u in au:
		am[(u as Dictionary)["id"]] = u
	var out := []
	for u in bu:
		var ud := u as Dictionary
		var ad: Dictionary = am.get(ud["id"], ud) as Dictionary
		out.append({"u": ud, "col": lerpf(float(ad["col"]), float(ud["col"]), e),
			"row": lerpf(float(ad["row"]), float(ud["row"]), e)})
	return out


func vis_now() -> Dictionary:
	var k := kf_index()
	var kk := mini(k + 1, N - 1)
	var f := frac()
	var va: Array = S["visibilityBySnap"][k] as Array
	var vb: Array = S["visibilityBySnap"][kk] as Array
	var vis := {}
	if f > 0.0 and f < 1.0:
		for i in va:
			vis[int(i)] = true
		for i in vb:
			vis[int(i)] = true
	else:
		var src: Array = vb if (pos >= N - 1 or rev() > k) else va
		for i in src:
			vis[int(i)] = true
	return {"vis": vis, "r": rev(), "k": k, "e": easef(f)}


# ── Transport ──
func _on_restart() -> void:
	pos = 0.0
	fired_rev = 0
	play_sfx("click")


func _on_back() -> void:
	pos = maxi(0, int(floor(pos)) - 1) if frac() == 0.0 else floor(pos)
	fired_rev = rev()
	play_sfx("click")


func _on_play() -> void:
	if not playing and pos >= N - 1:
		pos = 0.0
		fired_rev = 0
	playing = not playing
	play_btn.text = "Pause" if playing else "Play"


func _on_fwd() -> void:
	playing = false
	play_btn.text = "Play"
	pos = mini(N - 1, int(floor(pos)) + 1)
	fired_rev = rev()
	var r := rev()
	if r > 0:
		show_now(r)
	play_sfx("click")


func _on_speed(b: Button) -> void:
	speed = 2.0 if speed == 1.0 else (4.0 if speed == 2.0 else (0.5 if speed == 4.0 else 1.0))
	b.text = ("%.1fx" % speed).replace(".0x", "x")


func _on_fog(b: Button) -> void:
	fog = not fog
	b.text = "Fog: on" if fog else "Fog: off"


func _on_mute(b: Button) -> void:
	muted = not muted
	AudioServer.set_bus_mute(0, muted)
	b.text = "Sound: on" if not muted else "Sound: off"


func _on_seek(v: float) -> void:
	pos = v
	fired_rev = rev()
	if rev() > 0:
		show_now(rev())


func show_now(r: int) -> void:
	var o: Dictionary = (S["outcomes"] as Array)[r - 1] as Dictionary
	now_label.text = "#%d %s" % [r, str(o.get("summary", ""))]


func fire_transition(from: int, to: int) -> void:
	fired_rev = to
	show_now(to)
	herald_label.text = "Herald: " + str(HERALD.get(SCRIPT[to], "..."))
	var sfx_name: String = str(SFX_FOR.get(SCRIPT[to], ""))
	if sfx_name != "":
		play_sfx(sfx_name)
	var a := kf(from)
	var b := kf(to)
	for e in S["events"] as Array:
		var ed := e as Dictionary
		if int(ed["revision"]) == to and str(ed["type"]) == "build.completed":
			shake = 1.0
	var ac: Dictionary = (a["cities"] as Dictionary)["cities"] as Dictionary
	var bc: Dictionary = (b["cities"] as Dictionary)["cities"] as Dictionary
	var la := int((ac["p1"] as Dictionary).get("level", 0))
	var lb := int((bc["p1"] as Dictionary).get("level", 0))
	if lb > la:
		shake = 1.0
		play_sfx("fanfare")


func play_sfx(n: String) -> void:
	if muted or not snd.has(n):
		return
	var pl: AudioStreamPlayer = snd[n]
	if pl.stream != null:
		pl.play()


func _process(delta: float) -> void:
	if N <= 1:
		return
	if playing and pos < N - 1:
		pos = minf(N - 1, pos + delta * speed / BASE_DUR)
		var r := rev()
		if r > fired_rev:
			fire_transition(r - 1, r)
		if pos >= N - 1:
			playing = false
			play_btn.text = "Replay"
	shake = maxf(0.0, shake - delta * 2.0)
	update_hud()
	slider.set_value_no_signal(pos)
	queue_redraw()


func update_hud() -> void:
	var vn := vis_now()
	var r: int = vn["r"]
	var k: int = vn["k"]
	var e: float = vn["e"]
	var kk := mini(k + 1, N - 1)
	var pa: Dictionary = ((kf(k).get("stockpiles", {}) as Dictionary).get("stockpiles", {}) as Dictionary).get("p1", {})
	var pb: Dictionary = ((kf(kk).get("stockpiles", {}) as Dictionary).get("stockpiles", {}) as Dictionary).get("p1", {})
	var parts := []
	for res in ["food", "wood", "stone", "gold"]:
		parts.append("%s %d" % [res.capitalize(), int(round(lerpf(float(pa.get(res, 0)), float(pb.get(res, 0)), e)))])
	res_label.text = "  ".join(parts)
	tick_label.text = "TICK %d   order %d/15" % [int(kf(r).get("tick", 0)), r]


func _unhandled_input(event: v
...[truncated 6904 chars]