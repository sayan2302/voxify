use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

pub static MASTER_SERVICE_ENABLED: AtomicBool = AtomicBool::new(true);
pub static AUTO_READ_SELECTION: AtomicBool = AtomicBool::new(false);
pub static AUTO_COPY_SELECTION: AtomicBool = AtomicBool::new(false);
pub static AUTO_READ_COPY: AtomicBool = AtomicBool::new(false);
pub static SETTLE_DELAY_MS: AtomicU32 = AtomicU32::new(10);
pub static EARCON_ENABLED: AtomicBool = AtomicBool::new(true);
pub static API_SERVICE_ENABLED: AtomicBool = AtomicBool::new(true);
pub static READ_HISTORY_SHORTCUT_ENABLED: AtomicBool = AtomicBool::new(true);
pub static IS_PRO_LICENSE_ACTIVE: AtomicBool = AtomicBool::new(false);
pub static DAILY_QUOTA_REACHED: AtomicBool = AtomicBool::new(false);

pub fn is_speech_blocked_by_quota() -> bool {
    !IS_PRO_LICENSE_ACTIVE.load(Ordering::Relaxed) && DAILY_QUOTA_REACHED.load(Ordering::Relaxed)
}

static IS_SIMULATING_COPY: AtomicBool = AtomicBool::new(false);
static WORKER_THREAD_ID: AtomicU32 = AtomicU32::new(0);
static CURRENT_SHORTCUT: Mutex<String> = Mutex::new(String::new());
static ACTIVE_SHORTCUT_MODS: AtomicU32 = AtomicU32::new(0x4006); // MOD_CONTROL (0x0002) | MOD_SHIFT (0x0004) | MOD_NOREPEAT (0x4000)
static ACTIVE_SHORTCUT_VK: AtomicU32 = AtomicU32::new(0x20); // VK_SPACE

// Keep track of the last read text to avoid duplicate loops
static LAST_READ_TEXT: Mutex<Option<String>> = Mutex::new(None);
static CURRENT_SELECTION_TEXT: Mutex<Option<String>> = Mutex::new(None);
static SELECTION_SEQUENCE: AtomicU32 = AtomicU32::new(0);
static APP_HANDLE_STORAGE: Mutex<Option<AppHandle>> = Mutex::new(None);

fn default_true() -> bool {
    true
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct AutoReadConfig {
    pub master_enabled: bool,
    pub auto_read_selection: bool,
    pub auto_copy_selection: bool,
    pub auto_read_copy: bool,
    pub activation_shortcut: String,
    pub settle_delay_ms: u32,
    pub earcon_enabled: bool,
    #[serde(default = "default_true")]
    pub api_service_enabled: bool,
    #[serde(default = "default_true")]
    pub read_history_shortcut_enabled: bool,
}

impl Default for AutoReadConfig {
    fn default() -> Self {
        Self {
            master_enabled: true,
            auto_read_selection: false,
            auto_copy_selection: false,
            auto_read_copy: false,
            activation_shortcut: "Win + Alt + S".to_string(),
            settle_delay_ms: 10,
            earcon_enabled: true,
            api_service_enabled: true,
            read_history_shortcut_enabled: true,
        }
    }
}

pub fn get_config_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|p| p.join("config.json"))
}

pub fn load_config_from_disk(app: &AppHandle) -> AutoReadConfig {
    if let Some(path) = get_config_path(app) {
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(cfg) = serde_json::from_str::<AutoReadConfig>(&content) {
                    println!("[GlobalReader] Loaded saved preferences from disk: {:?}", path);
                    return cfg;
                }
            }
        }
    }
    AutoReadConfig::default()
}

pub fn save_config_to_disk(app: &AppHandle, config: &AutoReadConfig) {
    if let Some(path) = get_config_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(config) {
            let _ = std::fs::write(&path, json);
            println!("[GlobalReader] Persisted preferences to disk: {:?}", path);
        }
    }
}

pub fn persist_current_config() {
    if let Ok(guard) = APP_HANDLE_STORAGE.lock() {
        if let Some(ref app) = *guard {
            let cfg = get_auto_read_config();
            save_config_to_disk(app, &cfg);
        }
    }
}

#[cfg(target_os = "windows")]
mod win32 {
    use super::*;
    use std::ptr::null_mut;

    pub type HWND = *mut std::ffi::c_void;
    pub type HHOOK = *mut std::ffi::c_void;
    pub type HINSTANCE = *mut std::ffi::c_void;
    pub type HGLOBAL = *mut std::ffi::c_void;
    pub type HANDLE = *mut std::ffi::c_void;
    pub type BOOL = i32;
    pub type WPARAM = usize;
    pub type LPARAM = isize;
    pub type LRESULT = isize;
    pub type ATOM = u16;

    pub const WH_KEYBOARD_LL: i32 = 13;
    pub const WH_MOUSE_LL: i32 = 14;
    pub const WM_KEYDOWN: u32 = 0x0100;
    pub const WM_SYSKEYDOWN: u32 = 0x0104;
    pub const WM_LBUTTONDOWN: u32 = 0x0201;
    pub const WM_LBUTTONUP: u32 = 0x0202;
    pub const WM_HOTKEY: u32 = 0x0312;
    pub const WM_CLIPBOARDUPDATE: u32 = 0x031D;
    pub const WM_USER_SELECTION_ACTION: u32 = 0x0400 + 101;
    pub const WM_USER_UPDATE_HOTKEY: u32 = 0x0400 + 102;
    pub const WM_USER_ACTIVATION_SHORTCUT: u32 = 0x0400 + 103;
    pub const WM_USER_STOP_SHORTCUT: u32 = 0x0400 + 104;
    pub const WM_USER_READ_HISTORY_SHORTCUT: u32 = 0x0400 + 105;
    pub const CF_UNICODETEXT: u32 = 13;

    pub const MOD_ALT: u32 = 0x0001;
    pub const MOD_CONTROL: u32 = 0x0002;
    pub const MOD_SHIFT: u32 = 0x0004;
    pub const MOD_WIN: u32 = 0x0008;
    pub const MOD_NOREPEAT: u32 = 0x4000;

    pub const VK_SHIFT: u8 = 0x10;
    pub const VK_CONTROL: u8 = 0x11;
    pub const VK_MENU: u8 = 0x12; // Alt key
    pub const VK_SPACE: u8 = 0x20;
    pub const VK_C: u8 = 0x43;
    pub const VK_H: u8 = 0x48;
    pub const VK_X: u8 = 0x58;
    pub const VK_LWIN: u8 = 0x5B;
    pub const VK_RWIN: u8 = 0x5C;
    pub const KEYEVENTF_KEYUP: u32 = 0x0002;

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct KBDLLHOOKSTRUCT {
        pub vk_code: u32,
        pub scan_code: u32,
        pub flags: u32,
        pub time: u32,
        pub dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct POINT {
        pub x: i32,
        pub y: i32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct MSLLHOOKSTRUCT {
        pub pt: POINT,
        pub mouse_data: u32,
        pub flags: u32,
        pub time: u32,
        pub dw_extra_info: usize,
    }

    #[repr(C)]
    pub struct MSG {
        pub hwnd: HWND,
        pub message: u32,
        pub w_param: WPARAM,
        pub l_param: LPARAM,
        pub time: u32,
        pub pt: POINT,
    }

    #[repr(C)]
    pub struct WNDCLASSW {
        pub style: u32,
        pub lpfn_wnd_proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT,
        pub cb_cls_extra: i32,
        pub cb_wnd_extra: i32,
        pub h_instance: HINSTANCE,
        pub h_icon: HANDLE,
        pub h_cursor: HANDLE,
        pub hbr_background: HANDLE,
        pub lpsz_menu_name: *const u16,
        pub lpsz_class_name: *const u16,
    }

    extern "system" {
        pub fn SetWindowsHookExW(idHook: i32, lpfn: unsafe extern "system" fn(i32, WPARAM, LPARAM) -> LRESULT, hmod: HINSTANCE, dwThreadId: u32) -> HHOOK;
        pub fn UnhookWindowsHookEx(hhk: HHOOK) -> BOOL;
        pub fn CallNextHookEx(hhk: HHOOK, nCode: i32, wParam: WPARAM, lParam: LPARAM) -> LRESULT;
        pub fn GetMessageW(lpMsg: *mut MSG, hWnd: HWND, wMsgFilterMin: u32, wMsgFilterMax: u32) -> BOOL;
        pub fn TranslateMessage(lpMsg: *const MSG) -> BOOL;
        pub fn DispatchMessageW(lpMsg: *const MSG) -> LRESULT;
        pub fn PostThreadMessageW(idThread: u32, Msg: u32, wParam: WPARAM, lParam: LPARAM) -> BOOL;
        pub fn RegisterHotKey(hWnd: HWND, id: i32, fsModifiers: u32, vk: u32) -> BOOL;
        pub fn UnregisterHotKey(hWnd: HWND, id: i32) -> BOOL;
        pub fn AddClipboardFormatListener(hwnd: HWND) -> BOOL;
        pub fn RemoveClipboardFormatListener(hwnd: HWND) -> BOOL;
        pub fn RegisterWindowMessageW(lpString: *const u16) -> u32;
        pub fn GetClipboardSequenceNumber() -> u32;
        pub fn OpenClipboard(hWndNewOwner: HWND) -> BOOL;
        pub fn CloseClipboard() -> BOOL;
        pub fn GetClipboardData(uFormat: u32) -> HANDLE;
        pub fn GlobalLock(hMem: HGLOBAL) -> *mut std::ffi::c_void;
        pub fn GlobalUnlock(hMem: HGLOBAL) -> BOOL;
        pub fn GetCurrentThreadId() -> u32;
        pub fn Sleep(dwMilliseconds: u32);
        pub fn keybd_event(bVk: u8, bScan: u8, dwFlags: u32, dwExtraInfo: usize);
        pub fn GetAsyncKeyState(vKey: i32) -> i16;
        pub fn RegisterClassW(lpWndClass: *const WNDCLASSW) -> ATOM;
        pub fn CreateWindowExW(
            dwExStyle: u32,
            lpClassName: *const u16,
            lpWindowName: *const u16,
            dwStyle: u32,
            X: i32,
            Y: i32,
            nWidth: i32,
            nHeight: i32,
            hWndParent: HWND,
            hMenu: HANDLE,
            hInstance: HINSTANCE,
            lpParam: *mut std::ffi::c_void,
        ) -> HWND;
        pub fn DefWindowProcW(hWnd: HWND, Msg: u32, wParam: WPARAM, lParam: LPARAM) -> LRESULT;
        pub fn GetModuleHandleW(lpModuleName: *const u16) -> HINSTANCE;
        pub fn DestroyWindow(hWnd: HWND) -> BOOL;
    }

    static mut DOWN_PT: POINT = POINT { x: 0, y: 0 };
    static mut DOWN_TIME: u32 = 0;
    static mut LAST_UP_TIME: u32 = 0;
    static mut LAST_UP_PT: POINT = POINT { x: 0, y: 0 };

    pub unsafe extern "system" fn mouse_hook_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        let is_tracking = (AUTO_READ_SELECTION.load(Ordering::Relaxed) || AUTO_COPY_SELECTION.load(Ordering::Relaxed))
            && MASTER_SERVICE_ENABLED.load(Ordering::Relaxed);
        if n_code >= 0 && is_tracking {
            let hook_struct = *(l_param as *const MSLLHOOKSTRUCT);
            let msg = w_param as u32;

            if msg == WM_LBUTTONDOWN {
                DOWN_PT = hook_struct.pt;
                DOWN_TIME = hook_struct.time;
            } else if msg == WM_LBUTTONUP {
                let dx = (hook_struct.pt.x - DOWN_PT.x).abs();
                let dy = (hook_struct.pt.y - DOWN_PT.y).abs();
                let is_drag = dx > 6 || dy > 6;

                let double_click_dt = hook_struct.time.saturating_sub(LAST_UP_TIME);
                let last_dx = (hook_struct.pt.x - LAST_UP_PT.x).abs();
                let last_dy = (hook_struct.pt.y - LAST_UP_PT.y).abs();
                let is_double_click = double_click_dt < 400 && last_dx < 6 && last_dy < 6;

                LAST_UP_TIME = hook_struct.time;
                LAST_UP_PT = hook_struct.pt;

                if is_drag || is_double_click {
                    let thread_id = WORKER_THREAD_ID.load(Ordering::Relaxed);
                    if thread_id != 0 {
                        PostThreadMessageW(thread_id, WM_USER_SELECTION_ACTION, 0, 0);
                    }
                }
            }
        }
        CallNextHookEx(null_mut(), n_code, w_param, l_param)
    }

    pub unsafe extern "system" fn keyboard_hook_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 && MASTER_SERVICE_ENABLED.load(Ordering::Relaxed) {
            let msg = w_param as u32;
            if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
                let hook_struct = *(l_param as *const KBDLLHOOKSTRUCT);

                let win_down = (GetAsyncKeyState(VK_LWIN as i32) as u16 & 0x8000 != 0)
                    || (GetAsyncKeyState(VK_RWIN as i32) as u16 & 0x8000 != 0);
                let ctrl_down = GetAsyncKeyState(VK_CONTROL as i32) as u16 & 0x8000 != 0;
                let shift_down = GetAsyncKeyState(VK_SHIFT as i32) as u16 & 0x8000 != 0;
                let alt_down = GetAsyncKeyState(VK_MENU as i32) as u16 & 0x8000 != 0;

                // 1. Global Master Kill Switch: Win + Alt + X (or Ctrl + Alt + X fallback)
                let is_x = hook_struct.vk_code == (VK_X as u32);
                if is_x && ((win_down && alt_down && !ctrl_down && !shift_down) || (ctrl_down && alt_down && !win_down && !shift_down)) {
                    keybd_event(0xE8, 0, 0, 0);
                    keybd_event(0xE8, 0, KEYEVENTF_KEYUP, 0);

                    let thread_id = WORKER_THREAD_ID.load(Ordering::Relaxed);
                    if thread_id != 0 {
                        PostThreadMessageW(thread_id, WM_USER_STOP_SHORTCUT, 0, 0);
                    }
                    return 1;
                }

                // 2. Re-Read Last History Item: Win + Alt + H (or Ctrl + Alt + H fallback)
                let is_h = hook_struct.vk_code == (VK_H as u32);
                if is_h && ((win_down && alt_down && !ctrl_down && !shift_down) || (ctrl_down && alt_down && !win_down && !shift_down)) {
                    if READ_HISTORY_SHORTCUT_ENABLED.load(Ordering::Relaxed) && MASTER_SERVICE_ENABLED.load(Ordering::Relaxed) {
                        keybd_event(0xE8, 0, 0, 0);
                        keybd_event(0xE8, 0, KEYEVENTF_KEYUP, 0);

                        let thread_id = WORKER_THREAD_ID.load(Ordering::Relaxed);
                        if thread_id != 0 {
                            PostThreadMessageW(thread_id, WM_USER_READ_HISTORY_SHORTCUT, 0, 0);
                        }
                        return 1;
                    }
                }

                // 2. Configured Activation Shortcut (e.g. Win + Alt + S)
                let mods = ACTIVE_SHORTCUT_MODS.load(Ordering::Relaxed);
                let req_vk = ACTIVE_SHORTCUT_VK.load(Ordering::Relaxed);

                let req_win = (mods & MOD_WIN) != 0;
                if req_win && hook_struct.vk_code == req_vk {
                    let req_ctrl = (mods & MOD_CONTROL) != 0;
                    let req_shift = (mods & MOD_SHIFT) != 0;
                    let req_alt = (mods & MOD_ALT) != 0;

                    if win_down && (ctrl_down == req_ctrl) && (shift_down == req_shift) && (alt_down == req_alt) {
                        // Mask the Windows key with dummy unassigned key 0xE8 so releasing Win does not pop open the Start menu
                        keybd_event(0xE8, 0, 0, 0);
                        keybd_event(0xE8, 0, KEYEVENTF_KEYUP, 0);

                        let thread_id = WORKER_THREAD_ID.load(Ordering::Relaxed);
                        if thread_id != 0 {
                            PostThreadMessageW(thread_id, WM_USER_ACTIVATION_SHORTCUT, 0, 0);
                        }
                        // Return 1 to consume the key: Windows language switcher or default shell actions will NOT trigger!
                        return 1;
                    }
                }

                // Companion fallback activation shortcut: Ctrl + Alt + S
                let is_s = hook_struct.vk_code == (VK_C as u32 + 16); // 0x53 = 'S'
                if is_s && ctrl_down && alt_down && !win_down && !shift_down {
                    let thread_id = WORKER_THREAD_ID.load(Ordering::Relaxed);
                    if thread_id != 0 {
                        PostThreadMessageW(thread_id, WM_USER_ACTIVATION_SHORTCUT, 0, 0);
                    }
                    return 1;
                }
            }
        }
        CallNextHookEx(null_mut(), n_code, w_param, l_param)
    }

    pub unsafe extern "system" fn dummy_wnd_proc(hwnd: HWND, msg: u32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        DefWindowProcW(hwnd, msg, w_param, l_param)
    }

    pub fn simulate_copy_keystrokes() {
        unsafe {
            IS_SIMULATING_COPY.store(true, Ordering::SeqCst);

            // If modifier keys are held down by the user,
            // release them before sending Ctrl+C so the target application receives pure Ctrl+C
            let lwin_down = (GetAsyncKeyState(VK_LWIN as i32) as u16 & 0x8000) != 0;
            let rwin_down = (GetAsyncKeyState(VK_RWIN as i32) as u16 & 0x8000) != 0;
            let ctrl_down = (GetAsyncKeyState(VK_CONTROL as i32) as u16 & 0x8000) != 0;
            let alt_down = (GetAsyncKeyState(VK_MENU as i32) as u16 & 0x8000) != 0;
            let shift_down = (GetAsyncKeyState(VK_SHIFT as i32) as u16 & 0x8000) != 0;

            if lwin_down {
                keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, 0);
            }
            if rwin_down {
                keybd_event(VK_RWIN, 0, KEYEVENTF_KEYUP, 0);
            }
            if ctrl_down {
                keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
            }
            if alt_down {
                keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
            }
            if shift_down {
                keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, 0);
            }

            Sleep(10);

            // Press Ctrl
            keybd_event(VK_CONTROL, 0, 0, 0);
            // Press C
            keybd_event(VK_C, 0, 0, 0);
            // Release C
            keybd_event(VK_C, 0, KEYEVENTF_KEYUP, 0);
            // Release Ctrl
            keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
        }
    }

    pub fn read_clipboard_text() -> Option<String> {
        unsafe {
            // Attempt opening clipboard up to 4 times in case of busy lock
            let mut opened = false;
            for _ in 0..4 {
                if OpenClipboard(null_mut()) != 0 {
                    opened = true;
                    break;
                }
                Sleep(5);
            }

            if !opened {
                return None;
            }

            let h_data = GetClipboardData(CF_UNICODETEXT);
            if h_data.is_null() {
                CloseClipboard();
                return None;
            }

            let ptr = GlobalLock(h_data) as *const u16;
            if ptr.is_null() {
                CloseClipboard();
                return None;
            }

            let mut len = 0;
            while *ptr.add(len) != 0 {
                len += 1;
            }

            let slice = std::slice::from_raw_parts(ptr, len);
            let text = String::from_utf16_lossy(slice);

            GlobalUnlock(h_data);
            CloseClipboard();

            let trimmed = text.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
    }
}

pub fn parse_shortcut_string(s: &str) -> Option<(u32, u32)> {
    let clean = s.trim();
    if clean.is_empty() {
        return None;
    }

    let mut mods = win32::MOD_NOREPEAT;
    let mut vk = None;

    let parts: Vec<&str> = clean.split('+').map(|p| p.trim()).collect();
    for part in parts {
        let lower = part.to_lowercase();
        match lower.as_str() {
            "shift" => mods |= win32::MOD_SHIFT,
            "ctrl" | "control" => mods |= win32::MOD_CONTROL,
            "alt" => mods |= win32::MOD_ALT,
            "win" | "windows" | "super" | "meta" => mods |= win32::MOD_WIN,
            "space" => vk = Some(win32::VK_SPACE as u32),
            "esc" | "escape" => vk = Some(0x1B),
            "enter" | "return" => vk = Some(0x0D),
            "tab" => vk = Some(0x09),
            other => {
                if other.starts_with('f') && other.len() <= 3 {
                    if let Ok(num) = other[1..].parse::<u32>() {
                        if (1..=12).contains(&num) {
                            vk = Some(0x70 + num - 1);
                        }
                    }
                } else if other.len() == 1 {
                    let c = other.chars().next().unwrap().to_ascii_uppercase();
                    if c.is_ascii_alphanumeric() {
                        vk = Some(c as u32);
                    }
                }
            }
        }
    }

    vk.map(|k| (mods, k))
}

pub fn handle_new_selection(app_handle: &AppHandle, text: String) {
    // 1. Immediately stop any current playback without emitting global-stop-speech (which hides the HUD)
    let _ = crate::native_kokoro::stop();
    let _ = crate::native_tts::stop();

    let _seq = SELECTION_SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut current = CURRENT_SELECTION_TEXT.lock().unwrap();
        *current = Some(text.clone());
    }

    let voice_name = crate::native_kokoro::get_current_voice_name();
    let speed = crate::native_kokoro::get_current_speed();
    let word_count = text.split_whitespace().count();

    // Check if daily free reading quota has been exhausted
    let is_test_sample = text.contains("Voxify Audio Pill is running")
        || text.contains("Hi, I'm Sarah");

    if !is_test_sample && is_speech_blocked_by_quota() {
        println!("[GlobalReader] Speech blocked: Daily free reading quota reached. Displaying paywall pill.");
        let _ = app_handle.emit("global-hud-status", serde_json::json!({
            "status": "paywall",
            "text": text,
            "voiceName": voice_name,
            "speed": speed,
            "wordCount": word_count,
        }));
        let _ = app_handle.emit("global-selection-text", text);
        crate::show_or_focus_hud(app_handle);
        return;
    }

    // 2. Dynamic Island summon: Emit event first so WebView renders fresh staging state
    let _ = app_handle.emit("global-hud-status", serde_json::json!({
        "status": "staging",
        "text": text,
        "voiceName": voice_name,
        "speed": speed,
        "wordCount": word_count,
    }));
    let _ = app_handle.emit("global-selection-text", text.clone());
    crate::show_or_focus_hud(app_handle);

    // 3. Start deep multi-chunk pre-buffering immediately in background
    crate::native_kokoro::prebuffer_first_chunk(&text, &voice_name, speed);
}

pub fn play_current_selection(app_handle: &AppHandle) {
    play_current_selection_ext(app_handle, false);
}

pub fn play_current_selection_ext(app_handle: &AppHandle, is_api_call: bool) {
    let text_opt = {
        let guard = CURRENT_SELECTION_TEXT.lock().unwrap();
        guard.clone()
    };

    if let Some(text) = text_opt {
        let clean = text.trim().to_string();
        if clean.is_empty() {
            return;
        }

        // Check if daily free reading quota has been exhausted
        let is_test_sample = clean.contains("Voxify Audio Pill is running")
            || clean.contains("Hi, I'm Sarah");

        let is_cached = {
            if let Ok(last) = LAST_READ_TEXT.lock() {
                last.as_ref().map(|l| l.trim() == clean).unwrap_or(false)
            } else {
                false
            }
        };

        if !is_api_call && !is_test_sample && !is_cached && is_speech_blocked_by_quota() {
            println!("[GlobalReader] Play blocked: Daily free reading quota reached. Displaying paywall pill.");
            let _ = crate::native_kokoro::stop();
            let _ = crate::native_tts::stop();
            let voice_name = crate::native_kokoro::get_current_voice_name();
            let speed = crate::native_kokoro::get_current_speed();
            let word_count = clean.split_whitespace().count();

            let _ = app_handle.emit("global-hud-status", serde_json::json!({
                "status": "paywall",
                "text": clean,
                "voiceName": voice_name,
                "speed": speed,
                "wordCount": word_count,
            }));
            crate::show_or_focus_hud(app_handle);
            return;
        }

        // Play 75ms acoustic earcon chime ON CLICKING PLAY (silent on selection)
        if EARCON_ENABLED.load(Ordering::Relaxed) {
            crate::native_kokoro::play_earcon_chime();
        }

        let voice_name = crate::native_kokoro::get_current_voice_name();
        let speed = crate::native_kokoro::get_current_speed();

        let _ = app_handle.emit("global-hud-status", serde_json::json!({
            "status": "speaking",
            "text": clean,
            "voiceName": voice_name,
            "speed": speed,
        }));

        let seq = SELECTION_SEQUENCE.load(Ordering::SeqCst);
        let app_h = app_handle.clone();
        let t_speak = clean.clone();
        let v_speak = voice_name.clone();

        std::thread::spawn(move || {
            let _ = crate::native_kokoro::speak(&t_speak, &v_speak, speed);

            // Background watcher to detect when audio sink has finished draining
            std::thread::sleep(std::time::Duration::from_millis(200));
            while crate::native_kokoro::is_speaking() {
                std::thread::sleep(std::time::Duration::from_millis(100));
                if SELECTION_SEQUENCE.load(Ordering::SeqCst) != seq {
                    return;
                }
            }

            if SELECTION_SEQUENCE.load(Ordering::SeqCst) == seq {
                let _ = app_h.emit("global-hud-status", serde_json::json!({
                    "status": "finished",
                    "text": t_speak,
                }));
                if let Ok(mut last) = LAST_READ_TEXT.lock() {
                    *last = None;
                }
            }
        });
    }
}

fn stop_all_speech(app_handle: &AppHandle) {
    let _ = crate::native_kokoro::stop();
    let _ = crate::native_tts::stop();
    if let Ok(mut last) = LAST_READ_TEXT.lock() {
        *last = None;
    }
    if let Ok(mut cur) = CURRENT_SELECTION_TEXT.lock() {
        *cur = None;
    }
    crate::hide_hud(app_handle);
    let _ = app_handle.emit("global-stop-speech", ());
    let _ = app_handle.emit("global-hud-status", serde_json::json!({
        "status": "idle",
        "text": "",
    }));
}

pub fn start_global_reader_thread(app_handle: AppHandle) {
    #[cfg(target_os = "windows")]
    thread::spawn(move || {
        use win32::*;
        use std::ptr::null_mut;

        unsafe {
            let thread_id = GetCurrentThreadId();
            WORKER_THREAD_ID.store(thread_id, Ordering::SeqCst);

            // Store app_handle for config persistence
            if let Ok(mut storage) = APP_HANDLE_STORAGE.lock() {
                *storage = Some(app_handle.clone());
            }

            // Load saved preferences from disk
            let saved_cfg = load_config_from_disk(&app_handle);
            MASTER_SERVICE_ENABLED.store(saved_cfg.master_enabled, Ordering::SeqCst);
            AUTO_READ_SELECTION.store(saved_cfg.auto_read_selection, Ordering::SeqCst);
            AUTO_COPY_SELECTION.store(saved_cfg.auto_copy_selection, Ordering::SeqCst);
            AUTO_READ_COPY.store(saved_cfg.auto_read_copy, Ordering::SeqCst);
            SETTLE_DELAY_MS.store(saved_cfg.settle_delay_ms, Ordering::SeqCst);
            EARCON_ENABLED.store(saved_cfg.earcon_enabled, Ordering::SeqCst);
            API_SERVICE_ENABLED.store(saved_cfg.api_service_enabled, Ordering::SeqCst);
            READ_HISTORY_SHORTCUT_ENABLED.store(saved_cfg.read_history_shortcut_enabled, Ordering::SeqCst);

            let initial_sc = if !saved_cfg.activation_shortcut.trim().is_empty() {
                saved_cfg.activation_shortcut
            } else {
                "Win + Alt + S".to_string()
            };
            if let Ok(mut current) = CURRENT_SHORTCUT.lock() {
                *current = initial_sc;
            }

            // Register hidden window class for message reception
            let class_name: Vec<u16> = "VoxifyGlobalReaderMsgClass\0".encode_utf16().collect();
            let wc = WNDCLASSW {
                style: 0,
                lpfn_wnd_proc: dummy_wnd_proc,
                cb_cls_extra: 0,
                cb_wnd_extra: 0,
                h_instance: null_mut(),
                h_icon: null_mut(),
                h_cursor: null_mut(),
                hbr_background: null_mut(),
                lpsz_menu_name: null_mut(),
                lpsz_class_name: class_name.as_ptr(),
            };
            RegisterClassW(&wc);

            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                class_name.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
            );

            // Check if launched silently via Windows startup or minimized flag
            let is_silent_start = std::env::args().any(|arg| arg == "--autostart" || arg == "--minimized" || arg == "--tray");
            if is_silent_start {
                // Settle delay on boot so the interactive user desktop and message subsystem are ready
                Sleep(1500);
            }

            let h_mod = GetModuleHandleW(null_mut());

            // Install low-level mouse hook
            let mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, mouse_hook_proc, h_mod, 0);
            if mouse_hook.is_null() {
                eprintln!("Failed to install low-level mouse hook for Voxify global reader");
            }

            // Install low-level keyboard hook (captures Win + Space and custom Win shortcuts without Windows shell interference)
            let kbd_hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_hook_proc, h_mod, 0);
            if kbd_hook.is_null() {
                eprintln!("Failed to install low-level keyboard hook for Voxify global reader");
            }

            // Register global hotkeys
            // ID 1: Configurable Activation Shortcut
            let (init_mods, init_vk) = {
                let current = CURRENT_SHORTCUT.lock().unwrap().clone();
                let parsed = parse_shortcut_string(&current).unwrap_or((MOD_WIN | MOD_ALT | MOD_NOREPEAT, 0x53));
                ACTIVE_SHORTCUT_MODS.store(parsed.0, Ordering::Relaxed);
                ACTIVE_SHORTCUT_VK.store(parsed.1, Ordering::Relaxed);
                parsed
            };
            if MASTER_SERVICE_ENABLED.load(Ordering::Relaxed) {
                let reg_ok = RegisterHotKey(hwnd, 1, init_mods, init_vk);
                println!("[GlobalReader] Registered kernel activation shortcut '{}' (success: {})", *CURRENT_SHORTCUT.lock().unwrap(), reg_ok != 0);

                // ID 2: Companion fallback shortcut: Ctrl + Alt + S
                let fallback_ok = RegisterHotKey(hwnd, 2, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 0x53);
                println!("[GlobalReader] Registered companion hotkey 'Ctrl + Alt + S' (success: {})", fallback_ok != 0);
            } else {
                println!("[GlobalReader] Master switch is OFF on launch; activation shortcut not registered to hotkey");
            }

            // ID 3: Win + Alt + X (Stop Speech)
            RegisterHotKey(hwnd, 3, MOD_WIN | MOD_ALT | MOD_NOREPEAT, 0x58);
            // ID 4: Ctrl + Alt + X (Stop Speech fallback)
            RegisterHotKey(hwnd, 4, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 0x58);

            // Listen to clipboard updates
            AddClipboardFormatListener(hwnd);

            // Register single-instance wake message
            let wake_msg_name: Vec<u16> = "VOXIFY_WAKE_INSTANCE_MSG\0".encode_utf16().collect();
            let wake_msg = RegisterWindowMessageW(wake_msg_name.as_ptr());

            let mut msg: MSG = std::mem::zeroed();

            while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
                if wake_msg != 0 && msg.message == wake_msg {
                    println!("[GlobalReader] Received wake message from secondary instance. Restoring main window.");
                    if let Some(main_win) = app_handle.get_webview_window("main") {
                        let _ = main_win.show();
                        let _ = main_win.unminimize();
                        let _ = main_win.set_focus();
                    }
                    continue;
                }

                if msg.message == WM_USER_UPDATE_HOTKEY {
                    UnregisterHotKey(hwnd, 1);
                    UnregisterHotKey(hwnd, 2);
                    if MASTER_SERVICE_ENABLED.load(Ordering::Relaxed) {
                        let sc = CURRENT_SHORTCUT.lock().unwrap().clone();
                        if let Some((mods, vk)) = parse_shortcut_string(&sc) {
                            ACTIVE_SHORTCUT_MODS.store(mods, Ordering::Relaxed);
                            ACTIVE_SHORTCUT_VK.store(vk, Ordering::Relaxed);
                            let ok1 = RegisterHotKey(hwnd, 1, mods, vk);
                            let ok2 = RegisterHotKey(hwnd, 2, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 0x53);
                            println!("[GlobalReader] Re-registered activation shortcut '{}' (ok: {}) + fallback 'Ctrl+Alt+S' (ok: {})", sc, ok1 != 0, ok2 != 0);
                        }
                    } else {
                        println!("[GlobalReader] Master switch is OFF: activation shortcut unregistered");
                    }
                } else if msg.message == WM_USER_SELECTION_ACTION {
                    if !MASTER_SERVICE_ENABLED.load(Ordering::Relaxed) {
                        continue;
                    }
                    // Let target application finalize text selection
                    let delay = SETTLE_DELAY_MS.load(Ordering::Relaxed);
                    Sleep(delay);

                    simulate_copy_keystrokes();
                    Sleep(15);
                    IS_SIMULATING_COPY.store(false, Ordering::SeqCst);

                    let do_read = AUTO_READ_SELECTION.load(Ordering::Relaxed);
                    let do_copy = AUTO_COPY_SELECTION.load(Ordering::Relaxed);

                    if do_copy {
                        println!("[GlobalReader] Auto-copied selected text to clipboard.");
                    }

                    if do_read {
                        if let Some(text) = read_clipboard_text() {
                            if text.len() >= 2 {
                                if let Ok(mut last) = LAST_READ_TEXT.lock() {
                                    *last = Some(text.clone());
                                }
                                handle_new_selection(&app_handle, text);
                            }
                        }
                    }
                } else if msg.message == WM_USER_ACTIVATION_SHORTCUT || (msg.message == WM_HOTKEY && (msg.w_param == 1 || msg.w_param == 2)) {
                    if !MASTER_SERVICE_ENABLED.load(Ordering::Relaxed) {
                        continue;
                    }

                    // 1. Check clipboard sequence number before simulating copy
                    let seq_before = GetClipboardSequenceNumber();
                    simulate_copy_keystrokes();
                    Sleep(30);
                    IS_SIMULATING_COPY.store(false, Ordering::SeqCst);
                    let seq_after = GetClipboardSequenceNumber();

                    let is_currently_speaking = crate::native_kokoro::is_speaking();

                    // If clipboard sequence didn't change, copy keystroke didn't register (e.g. elevated admin window or no selection)
                    if seq_after == seq_before {
                        let current_opt = {
                            let guard = CURRENT_SELECTION_TEXT.lock().unwrap();
                            guard.clone()
                        };
                        if let Some(_staged) = current_opt {
                            if is_currently_speaking {
                                println!("[GlobalReader] Shortcut pressed without new selection while speaking -> stopping");
                                stop_all_speech(&app_handle);
                            } else {
                                println!("[GlobalReader] Shortcut pressed with existing staged selection -> toggling play");
                                play_current_selection(&app_handle);
                            }
                        } else if is_currently_speaking {
                            println!("[GlobalReader] Shortcut pressed with no selection while speaking -> stopping");
                            stop_all_speech(&app_handle);
                        } else {
                            println!("[GlobalReader] No text selection detected or active window blocked copy keystrokes (elevated window).");
                        }
                        continue;
                    }

                    let copied_text = read_clipboard_text();

                    if let Some(text) = copied_text {
                        let clean = text.trim().to_string();
                        if clean.len() >= 2 {
                            let is_same_text = {
                                let current = CURRENT_SELECTION_TEXT.lock().unwrap();
                                current.as_ref().map(|c| c.trim() == clean).unwrap_or(false)
                            };

                            if is_same_text && is_currently_speaking {
                                // User pressed shortcut while this exact text is actively speaking: toggle stop
                                println!("[GlobalReader] Shortcut pressed while speaking same text -> stopping");
                                stop_all_speech(&app_handle);
                            } else if is_same_text {
                                // Text is already staged in the audio pill: check if runway is safe to play
                                let is_safe = crate::native_kokoro::is_active_session_runway_safe(
                                    &clean,
                                    &crate::native_kokoro::get_current_voice_name(),
                                    crate::native_kokoro::get_current_speed(),
                                );
                                if is_safe {
                                    play_current_selection(&app_handle);
                                } else {
                                    handle_new_selection(&app_handle, clean);
                                }
                            } else {
                                // NEW text highlighted!
                                println!("[GlobalReader] New text selection captured via shortcut. Preempting earlier playback!");
                                // Immediately halt earlier running playback and flush pipeline
                                let _ = crate::native_kokoro::stop();
                                let _ = crate::native_tts::stop();
                                if let Ok(mut last) = LAST_READ_TEXT.lock() {
                                    *last = Some(clean.clone());
                                }
                                // Prioritize and ready the next selection in the audio pill
                                handle_new_selection(&app_handle, clean);
                            }
                            continue;
                        }
                    }

                    // If no valid text in clipboard and audio is speaking: stop speech
                    if is_currently_speaking {
                        println!("[GlobalReader] Shortcut pressed with no selection while speaking -> stopping");
                        stop_all_speech(&app_handle);
                    }
                } else if msg.message == WM_USER_STOP_SHORTCUT || (msg.message == WM_HOTKEY && (msg.w_param == 3 || msg.w_param == 4)) {
                    println!("[GlobalReader] Master Kill Switch (Win + Alt + X) triggered! Halting speech, purging pipeline & hiding audio pill.");
                    stop_all_speech(&app_handle);
                } else if msg.message == WM_USER_READ_HISTORY_SHORTCUT {
                    println!("[GlobalReader] Re-Read Last History Shortcut (Win + Alt + H) triggered!");
                    let _ = app_handle.emit("trigger-read-last-history", ());
                } else if msg.message == WM_CLIPBOARDUPDATE {
                    if IS_SIMULATING_COPY.load(Ordering::SeqCst) {
                        // Ignore our own simulated copy
                    } else if AUTO_READ_COPY.load(Ordering::Relaxed) && MASTER_SERVICE_ENABLED.load(Ordering::Relaxed) {
                        Sleep(30);
                        if let Some(text) = read_clipboard_text() {
                            let mut last = LAST_READ_TEXT.lock().unwrap();
                            let is_new = last.as_ref().map(|l| l != &text).unwrap_or(true);
                            if is_new && text.len() >= 2 {
                                *last = Some(text.clone());
                                handle_new_selection(&app_handle, text);
                            }
                        }
                    }
                }

                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            if !mouse_hook.is_null() {
                UnhookWindowsHookEx(mouse_hook);
            }
            if !kbd_hook.is_null() {
                UnhookWindowsHookEx(kbd_hook);
            }
            RemoveClipboardFormatListener(hwnd);
            UnregisterHotKey(hwnd, 1);
            UnregisterHotKey(hwnd, 3);
            UnregisterHotKey(hwnd, 4);
            DestroyWindow(hwnd);
        }
    });
}

// Tauri commands to control the Global Reader
#[tauri::command]
pub fn get_auto_read_config() -> AutoReadConfig {
    let sc = CURRENT_SHORTCUT.lock().unwrap().clone();
    let current_sc = if sc.is_empty() { "Win + Alt + S".to_string() } else { sc };
    AutoReadConfig {
        master_enabled: MASTER_SERVICE_ENABLED.load(Ordering::Relaxed),
        auto_read_selection: AUTO_READ_SELECTION.load(Ordering::Relaxed),
        auto_copy_selection: AUTO_COPY_SELECTION.load(Ordering::Relaxed),
        auto_read_copy: AUTO_READ_COPY.load(Ordering::Relaxed),
        activation_shortcut: current_sc,
        settle_delay_ms: SETTLE_DELAY_MS.load(Ordering::Relaxed),
        earcon_enabled: EARCON_ENABLED.load(Ordering::Relaxed),
        api_service_enabled: API_SERVICE_ENABLED.load(Ordering::Relaxed),
        read_history_shortcut_enabled: READ_HISTORY_SHORTCUT_ENABLED.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub fn set_master_enabled(enabled: bool) {
    MASTER_SERVICE_ENABLED.store(enabled, Ordering::SeqCst);
    persist_current_config();
    #[cfg(target_os = "windows")]
    {
        let thread_id = WORKER_THREAD_ID.load(Ordering::Relaxed);
        if thread_id != 0 {
            unsafe {
                win32::PostThreadMessageW(thread_id, win32::WM_USER_UPDATE_HOTKEY, 0, 0);
            }
        }
    }
}

#[tauri::command]
pub fn get_master_enabled() -> bool {
    MASTER_SERVICE_ENABLED.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_activation_shortcut(shortcut: String) {
    let clean = shortcut.trim().to_string();
    if !clean.is_empty() {
        if let Some((mods, vk)) = parse_shortcut_string(&clean) {
            ACTIVE_SHORTCUT_MODS.store(mods, Ordering::Relaxed);
            ACTIVE_SHORTCUT_VK.store(vk, Ordering::Relaxed);
        }
        if let Ok(mut lock) = CURRENT_SHORTCUT.lock() {
            *lock = clean;
        }
        persist_current_config();
        #[cfg(target_os = "windows")]
        {
            let thread_id = WORKER_THREAD_ID.load(Ordering::Relaxed);
            if thread_id != 0 {
                unsafe {
                    win32::PostThreadMessageW(thread_id, win32::WM_USER_UPDATE_HOTKEY, 0, 0);
                }
            }
        }
    }
}

#[tauri::command]
pub fn get_activation_shortcut() -> String {
    let sc = CURRENT_SHORTCUT.lock().unwrap().clone();
    if sc.is_empty() {
        "Win + Alt + S".to_string()
    } else {
        sc
    }
}

#[tauri::command]
pub fn set_auto_read_enabled(enabled: bool) {
    AUTO_READ_SELECTION.store(enabled, Ordering::Relaxed);
    persist_current_config();
}

#[tauri::command]
pub fn set_auto_copy_selection_enabled(enabled: bool) {
    AUTO_COPY_SELECTION.store(enabled, Ordering::Relaxed);
    persist_current_config();
}

#[tauri::command]
pub fn get_auto_copy_selection_enabled() -> bool {
    AUTO_COPY_SELECTION.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_auto_read_copy_enabled(enabled: bool) {
    AUTO_READ_COPY.store(enabled, Ordering::Relaxed);
    persist_current_config();
}

#[tauri::command]
pub fn set_settle_delay_ms(delay_ms: u32) {
    SETTLE_DELAY_MS.store(delay_ms.clamp(5, 500), Ordering::Relaxed);
    persist_current_config();
}

#[tauri::command]
pub fn set_earcon_enabled(enabled: bool) {
    EARCON_ENABLED.store(enabled, Ordering::Relaxed);
    persist_current_config();
}

#[tauri::command]
pub fn play_test_earcon() {
    crate::native_kokoro::play_earcon_chime();
}

#[tauri::command]
pub fn play_selection(app_handle: AppHandle) {
    play_current_selection(&app_handle);
}

#[tauri::command]
pub fn pause_speech(app_handle: AppHandle) {
    SELECTION_SEQUENCE.fetch_add(1, Ordering::SeqCst);
    let _ = crate::native_kokoro::stop();
    let _ = crate::native_tts::stop();
    let cur_text = {
        let guard = CURRENT_SELECTION_TEXT.lock().unwrap();
        guard.clone().unwrap_or_default()
    };
    let _ = app_handle.emit("global-hud-status", serde_json::json!({
        "status": "ready",
        "text": cur_text,
    }));
}

#[tauri::command]
pub fn trigger_read_selection() {
    #[cfg(target_os = "windows")]
    {
        let thread_id = WORKER_THREAD_ID.load(Ordering::Relaxed);
        if thread_id != 0 {
            unsafe {
                win32::PostThreadMessageW(thread_id, win32::WM_USER_ACTIVATION_SHORTCUT, 0, 0);
            }
        }
    }
}

#[tauri::command]
pub fn stop_speech(app_handle: AppHandle) {
    stop_all_speech(&app_handle);
}

#[tauri::command]
pub fn set_api_service_enabled(enabled: bool) {
    API_SERVICE_ENABLED.store(enabled, Ordering::Relaxed);
    persist_current_config();
}

#[tauri::command]
pub fn get_api_service_enabled() -> bool {
    API_SERVICE_ENABLED.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_read_history_shortcut_enabled(enabled: bool) {
    READ_HISTORY_SHORTCUT_ENABLED.store(enabled, Ordering::Relaxed);
    persist_current_config();
}

#[tauri::command]
pub fn get_read_history_shortcut_enabled() -> bool {
    READ_HISTORY_SHORTCUT_ENABLED.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_license_status(is_active: bool) {
    IS_PRO_LICENSE_ACTIVE.store(is_active, Ordering::SeqCst);
    println!("[GlobalReader] Pro license status updated: {}", is_active);
}

#[tauri::command]
pub fn set_daily_quota_status(is_reached: bool) {
    DAILY_QUOTA_REACHED.store(is_reached, Ordering::SeqCst);
    println!("[GlobalReader] Daily quota reached updated: {}", is_reached);
}

#[tauri::command]
pub fn get_speech_blocked() -> bool {
    is_speech_blocked_by_quota()
}

#[tauri::command]
pub fn open_membership_window(app_handle: AppHandle) {
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let _ = main_win.show();
        let _ = main_win.unminimize();
        let _ = main_win.set_focus();
        let _ = app_handle.emit("navigate-tab", "membership");
    }
}

pub fn set_current_selection_text(text: String) {
    if let Ok(mut current) = CURRENT_SELECTION_TEXT.lock() {
        *current = Some(text);
    }
}

/// Strip Markdown formatting into natural, spoken English prose for neural TTS.
pub fn strip_markdown_for_speech(raw: &str) -> String {
    let mut text = raw.trim();

    // 1. Strip YAML frontmatter at start
    if text.starts_with("---") {
        if let Some(rest) = text.strip_prefix("---") {
            if let Some(end_idx) = rest.find("\n---") {
                text = rest[end_idx + 4..].trim_start_matches(|c| c == '\r' || c == '\n' || c == ' ');
            }
        }
    }

    let mut result = String::with_capacity(text.len());
    let mut in_code_block = false;

    for line in text.lines() {
        let trimmed = line.trim();

        // Multi-line code fence: ``` or ~~~
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_code_block = !in_code_block;
            if !in_code_block && !result.is_empty() && !result.ends_with('\n') {
                result.push('\n');
            }
            continue;
        }

        if in_code_block {
            continue;
        }

        // Horizontal rules
        if trimmed == "---" || trimmed == "***" || trimmed == "___" || trimmed == "- - -" {
            continue;
        }

        // Heading tokens
        let mut clean_line = trimmed;
        let is_heading = clean_line.starts_with('#');
        if is_heading {
            clean_line = clean_line.trim_start_matches('#').trim_start();
        }

        // Blockquotes
        while clean_line.starts_with('>') {
            clean_line = clean_line.trim_start_matches('>').trim_start();
        }

        // List bullets
        if let Some(stripped) = clean_line.strip_prefix("- ")
            .or_else(|| clean_line.strip_prefix("* "))
            .or_else(|| clean_line.strip_prefix("+ ")) {
            clean_line = stripped.trim_start();
        } else if let Some(dot_pos) = clean_line.find(". ") {
            if dot_pos > 0 && clean_line[..dot_pos].chars().all(|c| c.is_ascii_digit()) {
                clean_line = clean_line[dot_pos + 2..].trim_start();
            }
        }

        if clean_line.is_empty() {
            if !result.ends_with("\n\n") {
                result.push('\n');
            }
            continue;
        }

        let processed = process_inline_markdown(clean_line);
        if !processed.is_empty() {
            if !result.is_empty() && !result.ends_with('\n') && !result.ends_with(' ') {
                result.push(' ');
            }
            result.push_str(&processed);

            if is_heading && !processed.ends_with('.') && !processed.ends_with('!') && !processed.ends_with('?') && !processed.ends_with(':') {
                result.push('.');
            }
            result.push('\n');
        }
    }

    result.trim().to_string()
}

fn process_inline_markdown(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Image: ![alt](url) -> omitted
        if chars[i] == '!' && i + 1 < len && chars[i + 1] == '[' {
            if let Some(close_bracket) = chars[i..].iter().position(|&c| c == ']') {
                let after_bracket = i + close_bracket + 1;
                if after_bracket < len && chars[after_bracket] == '(' {
                    if let Some(close_paren) = chars[after_bracket..].iter().position(|&c| c == ')') {
                        i = after_bracket + close_paren + 1;
                        continue;
                    }
                }
            }
        }

        // Link: [anchor](url) -> anchor
        if chars[i] == '[' {
            if let Some(close_bracket) = chars[i + 1..].iter().position(|&c| c == ']') {
                let bracket_end = i + 1 + close_bracket;
                let text_inside: String = chars[i + 1..bracket_end].iter().collect();
                let after_bracket = bracket_end + 1;
                if after_bracket < len && chars[after_bracket] == '(' {
                    if let Some(close_paren) = chars[after_bracket..].iter().position(|&c| c == ')') {
                        out.push_str(&process_inline_markdown(&text_inside));
                        i = after_bracket + close_paren + 1;
                        continue;
                    }
                }
            }
        }

        // HTML tag: <tag> -> stripped
        if chars[i] == '<' {
            if let Some(close_tag) = chars[i + 1..].iter().position(|&c| c == '>') {
                let tag_str: String = chars[i + 1..i + 1 + close_tag].iter().collect();
                if tag_str.starts_with('/') || tag_str.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false) {
                    i = i + 1 + close_tag + 1;
                    continue;
                }
            }
        }

        // Inline code: `code` -> code
        if chars[i] == '`' {
            i += 1;
            continue;
        }

        // Bold / Italics: **, *, __, _, ~~
        if chars[i] == '*' || chars[i] == '_' || chars[i] == '~' {
            let marker = chars[i];
            let is_double = i + 1 < len && chars[i + 1] == marker;
            i += if is_double { 2 } else { 1 };
            continue;
        }

        out.push(chars[i]);
        i += 1;
    }

    collapse_whitespace(&out)
}

fn collapse_whitespace(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut last_was_space = false;
    for c in s.chars() {
        if c == ' ' || c == '\t' {
            if !last_was_space {
                result.push(' ');
                last_was_space = true;
            }
        } else {
            result.push(c);
            last_was_space = false;
        }
    }
    result.trim().to_string()
}

/// Ingest external raw Markdown, strip formatting, summon the Audio Pill,
/// and immediately begin reading aloud without requiring any hotkey activation.
/// Returns (word_count, estimated_seconds).
pub fn handle_direct_text(app_handle: &AppHandle, raw_markdown: &str) -> (usize, u32) {
    let clean_text = strip_markdown_for_speech(raw_markdown);
    if clean_text.is_empty() {
        return (0, 0);
    }

    let word_count = clean_text.split_whitespace().count();
    let estimated_seconds = ((word_count as f32 / 2.5).ceil() as u32).max(1);

    // 1. Interrupt any current playback and clear last read state
    let _ = crate::native_kokoro::stop();
    let _ = crate::native_tts::stop();

    let _seq = SELECTION_SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut current = CURRENT_SELECTION_TEXT.lock().unwrap();
        *current = Some(clean_text.clone());
    }
    if let Ok(mut last) = LAST_READ_TEXT.lock() {
        *last = Some(clean_text.clone());
    }

    let voice_name = crate::native_kokoro::get_current_voice_name();
    let speed = crate::native_kokoro::get_current_speed();

    // 2. Summon Floating Audio Pill with staging information
    let _ = app_handle.emit("global-hud-status", serde_json::json!({
        "status": "staging",
        "text": clean_text.clone(),
        "voiceName": voice_name,
        "speed": speed,
        "wordCount": word_count,
    }));
    crate::show_or_focus_hud(app_handle);

    // Pre-buffer first chunk immediately
    crate::native_kokoro::prebuffer_first_chunk(&clean_text, &voice_name, speed);

    // 3. Immediately start speaking in background without user interaction
    let app_h = app_handle.clone();
    std::thread::spawn(move || {
        // Small delay to allow frontend staging animation to mount cleanly
        std::thread::sleep(std::time::Duration::from_millis(150));
        play_current_selection_ext(&app_h, true);
    });

    (word_count, estimated_seconds)
}

#[cfg(test)]
mod markdown_tests {
    use super::*;

    #[test]
    fn test_strip_markdown_frontmatter() {
        let md = "---\ntitle: Document\nauthor: Sayan\n---\n# Real Title\nThis is body text.";
        let clean = strip_markdown_for_speech(md);
        assert!(clean.starts_with("Real Title."));
        assert!(clean.contains("This is body text."));
        assert!(!clean.contains("author: Sayan"));
    }

    #[test]
    fn test_strip_code_blocks() {
        let md = "Here is an explanation:\n```python\ndef hello():\n    print('world')\n```\nAnd here is more prose.";
        let clean = strip_markdown_for_speech(md);
        assert!(clean.contains("Here is an explanation:"));
        assert!(clean.contains("And here is more prose."));
        assert!(!clean.contains("def hello"));
        assert!(!clean.contains("print"));
    }

    #[test]
    fn test_strip_links_and_formatting() {
        let md = "Please visit [our website](https://example.com) for **important** updates!";
        let clean = strip_markdown_for_speech(md);
        assert_eq!(clean, "Please visit our website for important updates!");
    }

    #[test]
    fn test_strip_images() {
        let md = "Look at this ![Logo](https://example.com/logo.png) diagram.";
        let clean = strip_markdown_for_speech(md);
        assert_eq!(clean, "Look at this diagram.");
    }
}

