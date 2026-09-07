mod global_reader;
pub mod native_tts;
pub mod native_kokoro;

use std::sync::atomic::Ordering;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

#[cfg(target_os = "windows")]
pub fn remove_window_border(window: &tauri::WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            use std::ffi::c_void;
            #[link(name = "dwmapi")]
            extern "system" {
                fn DwmSetWindowAttribute(
                    hwnd: *mut c_void,
                    dwAttribute: u32,
                    pvAttribute: *const c_void,
                    cbAttribute: u32,
                ) -> i32;
            }
            // DWMWA_BORDER_COLOR = 34, DWMWA_COLOR_NONE = 0xFFFFFFFE
            let color: u32 = 0xFFFFFFFE;
            let _ = DwmSetWindowAttribute(
                hwnd.0 as *mut c_void,
                34,
                &color as *const _ as *const c_void,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

pub fn show_or_focus_hud(app: &tauri::AppHandle) {
    if let Some(pill_window) = app.get_webview_window("mini-pill") {
        #[cfg(target_os = "windows")]
        remove_window_border(&pill_window);
        if let Ok(Some(monitor)) = app.primary_monitor() {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            let screen_w = size.width as f64 / scale;
            let x = (screen_w - 300.0) / 2.0;
            let _ = pill_window.set_size(tauri::LogicalSize::new(300.0, 100.0));
            let _ = pill_window.set_position(tauri::LogicalPosition::new(x, 0.0));
        }
        let _ = pill_window.show();
        let _ = pill_window.unminimize();
        let _ = pill_window.set_always_on_top(true);
    } else {
        let mut builder = tauri::WebviewWindowBuilder::new(
            app,
            "mini-pill",
            tauri::WebviewUrl::App("index.html?mode=mini-pill".into()),
        )
        .title("Voxify Quick Reader")
        .inner_size(300.0, 100.0)
        .resizable(false)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true);

        if let Ok(Some(monitor)) = app.primary_monitor() {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            let screen_w = size.width as f64 / scale;
            let x = (screen_w - 300.0) / 2.0;
            builder = builder.position(x, 0.0);
        } else {
            builder = builder.center();
        }

        if let Ok(win) = builder.build() {
            #[cfg(target_os = "windows")]
            remove_window_border(&win);
        }
    }
}

fn toggle_or_create_quick_reader(app: &tauri::AppHandle) {
    if let Some(pill_window) = app.get_webview_window("mini-pill") {
        if pill_window.is_visible().unwrap_or(false) {
            let _ = pill_window.hide();
        } else {
            let _ = pill_window.show();
            let _ = pill_window.set_focus();
        }
    } else {
        show_or_focus_hud(app);
    }
}

#[tauri::command]
fn show_quick_reader(app_handle: tauri::AppHandle) {
    if let Some(pill_window) = app_handle.get_webview_window("mini-pill") {
        let _ = pill_window.show();
        let _ = pill_window.set_focus();
    } else {
        toggle_or_create_quick_reader(&app_handle);
    }
}

#[tauri::command]
fn hide_quick_reader(app_handle: tauri::AppHandle) {
    if let Some(pill_window) = app_handle.get_webview_window("mini-pill") {
        let _ = pill_window.hide();
    }
}

#[tauri::command]
fn hide_main_window_to_tray(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn speak_native(text: String) -> Result<(), String> {
    native_tts::speak(&text, true)
}

#[tauri::command]
fn stop_native() -> Result<(), String> {
    native_tts::stop()
}

#[tauri::command]
fn set_native_rate(rate: f32) -> Result<(), String> {
    native_tts::set_rate(rate)
}

#[tauri::command]
fn get_native_voices() -> Result<Vec<native_tts::NativeVoiceInfo>, String> {
    native_tts::get_voices()
}

#[tauri::command]
fn set_native_voice(name: String) -> Result<(), String> {
    native_tts::set_voice_by_name(&name)
}

#[tauri::command]
fn speak_kokoro_native(text: String, voice: Option<String>, speed: Option<f32>) -> Result<(), String> {
    let v = voice.unwrap_or_else(|| native_kokoro::get_current_voice_name());
    let s = speed.unwrap_or_else(|| native_kokoro::get_current_speed());
    std::thread::spawn(move || {
        let _ = native_kokoro::speak(&text, &v, s);
    });
    Ok(())
}

#[tauri::command]
fn stop_kokoro_native() -> Result<(), String> {
    native_kokoro::stop()
}

#[tauri::command]
fn get_kokoro_voices() -> Vec<native_kokoro::KokoroVoiceInfo> {
    native_kokoro::get_available_voices()
}

#[tauri::command]
fn set_kokoro_voice(voice: String) {
    native_kokoro::set_current_voice(&voice);
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct SynthesizedAudioResult {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub duration: f32,
}

#[tauri::command]
fn synthesize_kokoro_raw(text: String, voice: Option<String>, speed: Option<f32>) -> Result<SynthesizedAudioResult, String> {
    let v = voice.unwrap_or_else(|| native_kokoro::get_current_voice_name());
    let s = speed.unwrap_or_else(|| native_kokoro::get_current_speed());
    let (samples, sample_rate) = native_kokoro::synthesize_raw(&text, &v, s)?;
    let duration = if sample_rate > 0 { samples.len() as f32 / sample_rate as f32 } else { 0.0 };
    Ok(SynthesizedAudioResult {
        samples,
        sample_rate,
        duration,
    })
}

#[tauri::command]
fn set_kokoro_speed(speed: f32) {
    native_kokoro::set_current_speed(speed);
}

#[tauri::command]
fn get_kokoro_speed() -> f32 {
    native_kokoro::get_current_speed()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            show_quick_reader,
            hide_quick_reader,
            hide_main_window_to_tray,
            speak_native,
            stop_native,
            set_native_rate,
            get_native_voices,
            set_native_voice,
            speak_kokoro_native,
            stop_kokoro_native,
            get_kokoro_voices,
            set_kokoro_voice,
            set_kokoro_speed,
            get_kokoro_speed,
            synthesize_kokoro_raw,
            global_reader::get_auto_read_config,
            global_reader::set_auto_read_enabled,
            global_reader::set_auto_read_copy_enabled,
            global_reader::set_settle_delay_ms,
            global_reader::set_earcon_enabled,
            global_reader::play_test_earcon,
            global_reader::play_selection,
            global_reader::trigger_read_selection,
            global_reader::stop_speech
        ])
        .setup(|app| {
            // Pre-create mini-pill overlay window hidden for 0ms instant display at Top-Center
            let mut pill_builder = tauri::WebviewWindowBuilder::new(
                app,
                "mini-pill",
                tauri::WebviewUrl::App("index.html?mode=mini-pill".into()),
            )
            .title("Voxify Quick Reader")
            .inner_size(300.0, 100.0)
            .resizable(false)
            .decorations(false)
            .shadow(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false);

            if let Ok(Some(monitor)) = app.primary_monitor() {
                let size = monitor.size();
                let scale = monitor.scale_factor();
                let screen_w = size.width as f64 / scale;
                let x = (screen_w - 300.0) / 2.0;
                pill_builder = pill_builder.position(x, 0.0);
            } else {
                pill_builder = pill_builder.center();
            }
            if let Ok(win) = pill_builder.build() {
                #[cfg(target_os = "windows")]
                remove_window_border(&win);
            }

            // Register AppHandle with native_kokoro for prebuffer events
            native_kokoro::set_app_handle(app.handle().clone());

            // Initialize native speech engines
            let _ = native_tts::init();
            std::thread::spawn(|| {
                let _ = native_kokoro::init(None);
            });

            // Start the native Windows background selection reader hook
            global_reader::start_global_reader_thread(app.handle().clone());

            // Build Context Menu for Windows System Tray
            let is_sel = global_reader::AUTO_READ_SELECTION.load(Ordering::Relaxed);
            let is_copy = global_reader::AUTO_READ_COPY.load(Ordering::Relaxed);
            let is_earcon = global_reader::EARCON_ENABLED.load(Ordering::Relaxed);

            let auto_read_item = MenuItem::with_id(
                app,
                "toggle_auto_read",
                if is_sel { "🔊 Auto-Read on Selection: [ON]" } else { "🔇 Auto-Read on Selection: [OFF]" },
                true,
                None::<&str>
            )?;

            let auto_copy_item = MenuItem::with_id(
                app,
                "toggle_auto_copy",
                if is_copy { "📋 Auto-Read on Copy: [ON]" } else { "📋 Auto-Read on Copy: [OFF]" },
                true,
                None::<&str>
            )?;

            let earcon_item = MenuItem::with_id(
                app,
                "toggle_earcon",
                if is_earcon { "🔔 Selection Chime: [ON]" } else { "🔕 Selection Chime: [OFF]" },
                true,
                None::<&str>
            )?;

            let read_now_item = MenuItem::with_id(
                app,
                "read_selection",
                "⚡ Read Current Selection (Win+Alt+S)",
                true,
                None::<&str>
            )?;

            let stop_speech_item = MenuItem::with_id(
                app,
                "stop_speech",
                "⏹ Stop Speech (Win+Alt+X)",
                true,
                None::<&str>
            )?;

            let pill_item = MenuItem::with_id(
                app,
                "quick_pill",
                "🎛 Toggle Quick-Reader Pill",
                true,
                None::<&str>
            )?;

            let open_item = MenuItem::with_id(
                app,
                "open",
                "⚙️ Preferences & Voice Settings",
                true,
                None::<&str>
            )?;

            let quit_item = MenuItem::with_id(
                app,
                "quit",
                "✕ Quit Voxify",
                true,
                None::<&str>
            )?;

            let tray_menu = Menu::with_items(app, &[
                &auto_read_item,
                &auto_copy_item,
                &earcon_item,
                &read_now_item,
                &stop_speech_item,
                &pill_item,
                &open_item,
                &quit_item,
            ])?;

            // Create System Tray Icon
            let icon = app.default_window_icon().cloned().expect("Default window icon must be defined");
            let _tray = TrayIconBuilder::with_id("voxify_tray")
                .icon(icon)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .tooltip("Voxify - Background Windows Selection Reader")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "toggle_auto_read" => {
                        let current = global_reader::AUTO_READ_SELECTION.load(Ordering::Relaxed);
                        global_reader::AUTO_READ_SELECTION.store(!current, Ordering::Relaxed);
                        let _ = app.emit("auto-read-config-changed", ());
                    }
                    "toggle_auto_copy" => {
                        let current = global_reader::AUTO_READ_COPY.load(Ordering::Relaxed);
                        global_reader::AUTO_READ_COPY.store(!current, Ordering::Relaxed);
                        let _ = app.emit("auto-read-config-changed", ());
                    }
                    "toggle_earcon" => {
                        let current = global_reader::EARCON_ENABLED.load(Ordering::Relaxed);
                        global_reader::EARCON_ENABLED.store(!current, Ordering::Relaxed);
                        if !current {
                            global_reader::play_test_earcon();
                        }
                        let _ = app.emit("auto-read-config-changed", ());
                    }
                    "read_selection" => {
                        global_reader::trigger_read_selection();
                    }
                    "stop_speech" => {
                        let _ = native_kokoro::stop();
                        let _ = native_tts::stop();
                        let _ = app.emit("global-stop-speech", ());
                    }
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quick_pill" => {
                        toggle_or_create_quick_reader(app);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to hidden system tray on close request instead of terminating
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                } else if window.label() == "mini-pill" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running voxify application");
}
