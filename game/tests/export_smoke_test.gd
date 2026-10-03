extends SceneTree
var app
var checks: int=0
var failures: int=0
func _initialize() -> void: call_deferred("run")
func check(ok: bool, caption: String) -> void:
    checks+=1
    if not ok:
        failures+=1
        push_error(caption)
func press(caption: String) -> void:
    var item=app.find_caption(app.ui,caption)
    check(item!=null,"Available: "+caption)
    if item: item.pressed.emit()
func shot(name: String) -> void:
    await process_frame
    await RenderingServer.frame_post_draw
    root.get_texture().get_image().save_png(OS.get_environment("OPTIMESH_CAPTURE_DIR").path_join(name+".png"))
func fullscreen_at(screen_name: String) -> void:
    var original: int=DisplayServer.window_get_mode()
    var event=InputEventKey.new()
    event.keycode=KEY_F11
    event.pressed=true
    root.push_input(event,true)
    await create_timer(0.15).timeout
    check(DisplayServer.window_get_mode()==DisplayServer.WINDOW_MODE_FULLSCREEN,"Global F11 at "+screen_name)
    root.push_input(event,true)
    await create_timer(0.15).timeout
    check(DisplayServer.window_get_mode()==original,"Window restore at "+screen_name)
func tap(caption: String) -> void:
    var item=app.find_caption(app.ui,caption)
    check(item!=null,"Touch control: "+caption)
    if not item: return
    for pressed in [true,false]:
        var event=InputEventScreenTouch.new()
        event.position=root.get_final_transform()*item.get_global_rect().get_center()
        event.pressed=pressed
        Input.parse_input_event(event)
        await process_frame
func run() -> void:
    check(OS.has_feature("template") and not OS.has_feature("editor"),"Running exported template, not editor")
    check(not DirAccess.dir_exists_absolute("res://tests") and not DirAccess.dir_exists_absolute("res://docs") and not DirAccess.dir_exists_absolute("res://artifacts"),"Player package excludes development content")
    app=load("res://scenes/main.tscn").instantiate()
    root.add_child(app)
    await process_frame
    check(app.screen=="start","Export main menu")
    await fullscreen_at("menu")
    var nodes: int=app.ui.get_child_count()
    var phase: float=app.menu_activity.phase
    await create_timer(0.2).timeout
    check(app.menu_activity.phase>phase and app.ui.get_child_count()==nodes,"Export attract loop animates without new nodes")
    var old_entries: int=app.store.current_entries().size()
    if "--reopen" in OS.get_cmdline_user_args():
        check(old_entries>0 and app.store.data.effects==0.4,"Leaderboard and settings survive closing/reopening")
    await shot("menu")
    press("New Game  →")
    check(app.screen=="name","Name screen")
    await fullscreen_at("name")
    app.name_input.release_focus()
    var touch=InputEventScreenTouch.new()
    touch.pressed=true
    touch.position=app.name_input.get_global_rect().get_center()
    root.push_input(touch,true)
    check(app.name_input.has_focus() and app.name_input.is_editing(),"Export simulated touch focuses editable name")
    check(not app.keyboard_supported(),"Windows template reports system virtual keyboard unsupported")
    app.name_input.text="Release QA"
    press("Continue  →")
    await fullscreen_at("modes")
    press("Start Demo  →")
    check(app.screen=="game" and app.guidance.active(),"Demo starts with tutorial")
    app.skip_tutorial()
    app.set_process(false)
    await shot("gameplay")
    app.show_settings()
    await fullscreen_at("settings")
    check(app.paused,"Settings pause game")
    app.store.data.effects=0.4
    app.sound.apply_settings()
    press("Test sound")
    check(app.sound.effects.stream==app.sound.tones.complete and app.sound.music.playing,"Exported music/effects playback routes")
    app.store.data.mute=true
    app.sound.apply_settings()
    check(app.sound.music.stream_paused and not app.sound.effects.playing,"Mute controls output")
    app.store.data.mute=false
    app.sound.apply_settings()
    press("Done")
    check(app.settings_overlay==null and app.store.last_error=="","Settings save")
    var original: int=DisplayServer.window_get_mode()
    var key=InputEventKey.new()
    key.keycode=KEY_F11
    key.pressed=true
    app._unhandled_key_input(key)
    await create_timer(0.25).timeout
    check(DisplayServer.window_get_mode()==DisplayServer.WINDOW_MODE_FULLSCREEN,"Fullscreen shortcut")
    app._unhandled_key_input(key)
    await create_timer(0.25).timeout
    check(DisplayServer.window_get_mode()==original,"Return to window")
    for minute in range(600):
        if app.screen=="game":
            var t: float=app.simulation.time_minutes
            if t>=630 and t<640:
                app.select_object("ev_2")
                app.apply_control("Fast")
            if t>=735 and t<740:
                app.select_object("flex")
                app.apply_control("Run")
            if app.simulation.dirty and app.simulation.cleaning_end<0:
                app.select_object("solar")
                app.apply_control("Clean")
            if t>=870 and t<875:
                app.select_object("ev_3")
                app.apply_control("Fast")
            if t>=930 and t<975:
                app.select_object("battery")
                app.apply_control("Discharge")
            app.advance_clock(1.0/app.pacing)
        if minute%10==0: await process_frame
    check(app.screen=="results" and app.results_values.ev_met==3,"Complete rendered exported day reaches results")
    check(app.store.current_entries().size()==old_entries+1 and app.store.last_error=="","Leaderboard writes locally")
    await shot("results")
    await fullscreen_at("results")
    press("Play Again  →")
    check(app.screen=="game" and app.simulation.time_minutes==480,"Retry resets day")
    app.show_start()
    press("Leaderboard")
    check(app.screen=="leaderboard","Ranking screen")
    await fullscreen_at("leaderboard")
    await shot("leaderboard")
    press("Main Menu")
    check(app.screen=="start","Return to menu")
    Input.set_emulate_mouse_from_touch(true)
    await tap("Fullscreen")
    await create_timer(0.15).timeout
    check(DisplayServer.window_get_mode()==DisplayServer.WINDOW_MODE_FULLSCREEN,"Touch fullscreen button")
    await tap("New Game  →")
    check(app.screen=="name" and DisplayServer.window_get_mode()==DisplayServer.WINDOW_MODE_FULLSCREEN,"Fullscreen persists into touch name entry")
    await tap("Use Guest")
    check(app.screen=="modes" and app.player_name=="Guest","Touch Guest bypasses unsupported Windows keyboard")
    await tap("Start Demo  →")
    check(app.screen=="game","Touch Demo starts")
    await tap("Skip tutorial")
    check(not app.guidance.active(),"Touch skips onboarding")
    app.select_object("ev_1")
    await tap("Fast")
    check(app.objects.ev_1.mode=="Fast","Touch changes an inspector control")
    await tap("×")
    check(not app.inspector.visible,"Touch closes inspector")
    await tap("All tasks (2)")
    check(app.task_panel.visible,"Touch opens tasks")
    await tap("All tasks (2)")
    await tap("Settings")
    await tap("Done")
    check(app.settings_overlay==null,"Touch dismisses Settings")
    await tap("Recent notes")
    await tap("Back to the site")
    check(app.notes_overlay==null,"Touch dismisses notes")
    await tap("Menu")
    check(app.screen=="start","Touch returns to menu")
    await tap("Fullscreen")
    await create_timer(0.15).timeout
    check(DisplayServer.window_get_mode()==DisplayServer.WINDOW_MODE_WINDOWED,"Touch restores window")
    print("EXPORTED RELEASE SMOKE: %d checks, %d failures" % [checks,failures])
    print("EXPORTED USER DATA: "+OS.get_user_data_dir())
    app.queue_free()
    await process_frame
    await create_timer(0.3).timeout
    quit(0 if failures==0 else 1)
