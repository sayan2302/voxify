use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter};

pub static AUTO_READ_SELECTION: AtomicBool = AtomicBool::new(true);
pub static AUTO_READ_COPY: AtomicBool = AtomicBool::new(false);
pub static SETTLE_DELAY_MS: AtomicU32 = AtomicU32::new(10);
pub static EARCON_ENABLED: AtomicBool = AtomicBool::new(true);
static IS_SIMULATING_COPY: AtomicBool = AtomicBool::new(false);
static WORKER_THREAD_ID: AtomicU32 = AtomicU32::new(0);

// Keep track of the last read text to avoid duplicate loops
static LAST_READ_TEXT: Mutex<Option<String>> = Mutex::new(None);
static CURRENT_SELECTION_TEXT: Mutex<Option<String>> = Mutex::new(None);
static SELECTION_SEQUENCE: AtomicU32 = AtomicU32::new(0);

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct AutoReadConfig {
    pub auto_read_selection: bool,
    pub auto_read_copy: bool,
    pub settle_delay_ms: u32,
    pub earcon_enabled: bool,
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

    pub const WH_MOUSE_LL: i32 = 14;
    pub const WM_LBUTTONDOWN: u32 = 0x0201;
    pub const WM_LBUTTONUP: u32 = 0x0202;
    pub const WM_HOTKEY: u32 = 0x0312;
    pub const WM_CLIPBOARDUPDATE: u32 = 0x031D;
    pub const WM_USER_SELECTION_ACTION: u32 = 0x0400 + 101;
    pub const CF_UNICODETEXT: u32 = 13;

    pub const MOD_ALT: u32 = 0x0001;
    pub const MOD_CONTROL: u32 = 0x0002;
    pub const MOD_WIN: u32 = 0x0008;
    pub const MOD_NOREPEAT: u32 = 0x4000;

    pub const VK_CONTROL: u8 = 0x11;
    pub const VK_C: u8 = 0x43;
    pub const KEYEVENTF_KEYUP: u32 = 0x0002;

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
        pub fn OpenClipboard(hWndNewOwner: HWND) -> BOOL;
        pub fn CloseClipboard() -> BOOL;
        pub fn GetClipboardData(uFormat: u32) -> HANDLE;
        pub fn GlobalLock(hMem: HGLOBAL) -> *mut std::ffi::c_void;
        pub fn GlobalUnlock(hMem: HGLOBAL) -> BOOL;
        pub fn GetCurrentThreadId() -> u32;
        pub fn Sleep(dwMilliseconds: u32);
        pub fn keybd_event(bVk: u8, bScan: u8, dwFlags: u32, dwExtraInfo: usize);
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
        pub fn DestroyWindow(hWnd: HWND) -> BOOL;
    }

    static mut DOWN_PT: POINT = POINT { x: 0, y: 0 };
    static mut DOWN_TIME: u32 = 0;
    static mut LAST_UP_TIME: u32 = 0;
    static mut LAST_UP_PT: POINT = POINT { x: 0, y: 0 };

    pub unsafe extern "system" fn mouse_hook_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 && AUTO_READ_SELECTION.load(Ordering::Relaxed) {
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

    pub unsafe extern "system" fn dummy_wnd_proc(hwnd: HWND, msg: u32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        DefWindowProcW(hwnd, msg, w_param, l_param)
    }

    pub fn simulate_copy_keystrokes() {
        unsafe {
            IS_SIMULATING_COPY.store(true, Ordering::SeqCst);
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

    // 2. Dynamic Island summon: Reveal HUD at Top-Center immediately
    crate::show_or_focus_hud(app_handle);
    let _ = app_handle.emit("global-hud-status", serde_json::json!({
        "status": "staging",
        "text": text,
        "voiceName": voice_name,
        "speed": speed,
        "wordCount": word_count,
    }));
    let _ = app_handle.emit("global-selection-text", text.clone());

    // 3. Start deep multi-chunk pre-buffering immediately in background
    crate::native_kokoro::prebuffer_first_chunk(&text, &voice_name, speed);
}

pub fn play_current_selection(app_handle: &AppHandle) {
    let text_opt = {
        let guard = CURRENT_SELECTION_TEXT.lock().unwrap();
        guard.clone()
    };

    if let Some(text) = text_opt {
        let clean = text.trim().to_string();
        if clean.is_empty() {
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
    let _ = app_handle.emit("global-stop-speech", ());
    let _ = app_handle.emit("global-hud-status", serde_json::json!({
        "status": "idle"
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

            // Install low-level mouse hook
            let mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, mouse_hook_proc, null_mut(), 0);
            if mouse_hook.is_null() {
                eprintln!("Failed to install low-level mouse hook for Voxify global reader");
            }

            // Register global hotkeys
            // ID 1: Win + Alt + S (Read Selection)
            RegisterHotKey(hwnd, 1, MOD_WIN | MOD_ALT | MOD_NOREPEAT, 0x53);
            // ID 2: Ctrl + Alt + S (Read Selection fallback)
            RegisterHotKey(hwnd, 2, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 0x53);
            // ID 3: Win + Alt + X (Stop Speech)
            RegisterHotKey(hwnd, 3, MOD_WIN | MOD_ALT | MOD_NOREPEAT, 0x58);
            // ID 4: Ctrl + Alt + X (Stop Speech fallback)
            RegisterHotKey(hwnd, 4, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 0x58);

            // Listen to clipboard updates
            AddClipboardFormatListener(hwnd);

            let mut msg: MSG = std::mem::zeroed();

            while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
                if msg.message == WM_USER_SELECTION_ACTION {
                    // Let target application finalize text selection
                    let delay = SETTLE_DELAY_MS.load(Ordering::Relaxed);
                    Sleep(delay);

                    simulate_copy_keystrokes();
                    Sleep(15);
                    IS_SIMULATING_COPY.store(false, Ordering::SeqCst);

                    if let Some(text) = read_clipboard_text() {
                        if text.len() >= 2 {
                            if let Ok(mut last) = LAST_READ_TEXT.lock() {
                                *last = Some(text.clone());
                            }
                            handle_new_selection(&app_handle, text);
                        }
                    }
                } else if msg.message == WM_HOTKEY {
                    let hotkey_id = msg.w_param as i32;
                    if hotkey_id == 1 || hotkey_id == 2 {
                        // User pressed Read Selection hotkey
                        simulate_copy_keystrokes();
                        Sleep(15);
                        IS_SIMULATING_COPY.store(false, Ordering::SeqCst);

                        if let Some(text) = read_clipboard_text() {
                            let mut last = LAST_READ_TEXT.lock().unwrap();
                            *last = Some(text.clone());
                            let mut current = CURRENT_SELECTION_TEXT.lock().unwrap();
                            *current = Some(text.clone());
                        }
                        play_current_selection(&app_handle);
                    } else if hotkey_id == 3 || hotkey_id == 4 {
                        // User pressed Stop Speech hotkey
                        stop_all_speech(&app_handle);
                    }
                } else if msg.message == WM_CLIPBOARDUPDATE {
                    if IS_SIMULATING_COPY.load(Ordering::SeqCst) {
                        // Ignore our own simulated copy
                    } else if AUTO_READ_COPY.load(Ordering::Relaxed) {
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
            RemoveClipboardFormatListener(hwnd);
            UnregisterHotKey(hwnd, 1);
            UnregisterHotKey(hwnd, 2);
            UnregisterHotKey(hwnd, 3);
            UnregisterHotKey(hwnd, 4);
            DestroyWindow(hwnd);
        }
    });
}

// Tauri commands to control the Global Reader
#[tauri::command]
pub fn get_auto_read_config() -> AutoReadConfig {
    AutoReadConfig {
        auto_read_selection: AUTO_READ_SELECTION.load(Ordering::Relaxed),
        auto_read_copy: AUTO_READ_COPY.load(Ordering::Relaxed),
        settle_delay_ms: SETTLE_DELAY_MS.load(Ordering::Relaxed),
        earcon_enabled: EARCON_ENABLED.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub fn set_auto_read_enabled(enabled: bool) {
    AUTO_READ_SELECTION.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_auto_read_copy_enabled(enabled: bool) {
    AUTO_READ_COPY.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_settle_delay_ms(delay_ms: u32) {
    SETTLE_DELAY_MS.store(delay_ms.clamp(5, 500), Ordering::Relaxed);
}

#[tauri::command]
pub fn set_earcon_enabled(enabled: bool) {
    EARCON_ENABLED.store(enabled, Ordering::Relaxed);
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
pub fn trigger_read_selection() {
    #[cfg(target_os = "windows")]
    {
        let thread_id = WORKER_THREAD_ID.load(Ordering::Relaxed);
        if thread_id != 0 {
            unsafe {
                win32::PostThreadMessageW(thread_id, win32::WM_USER_SELECTION_ACTION, 0, 0);
            }
        }
    }
}

#[tauri::command]
pub fn stop_speech(app_handle: AppHandle) {
    stop_all_speech(&app_handle);
}
