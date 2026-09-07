// Windows Native Single-Instance Manager for Voxify
// Prevents duplicate processes and focuses existing window if launched again.

#[cfg(target_os = "windows")]
mod win_single_instance {
    use std::ptr::null_mut;

    type HWND = *mut std::ffi::c_void;
    type HANDLE = *mut std::ffi::c_void;

    extern "system" {
        fn CreateMutexW(lpMutexAttributes: *mut std::ffi::c_void, bInitialOwner: i32, lpName: *const u16) -> HANDLE;
        fn GetLastError() -> u32;
        fn RegisterWindowMessageW(lpString: *const u16) -> u32;
        fn PostMessageW(hWnd: HWND, Msg: u32, wParam: usize, lParam: isize) -> i32;
        fn FindWindowW(lpClassName: *const u16, lpWindowName: *const u16) -> HWND;
        fn ShowWindow(hWnd: HWND, nCmdShow: i32) -> i32;
        fn SetForegroundWindow(hWnd: HWND) -> i32;
    }

    const ERROR_ALREADY_EXISTS: u32 = 183;
    const HWND_BROADCAST: HWND = 0xffff as HWND;

    pub fn enforce_single_instance() {
        let mutex_name: Vec<u16> = "Global\\Voxify_App_SingleInstance_Mutex_v1\0".encode_utf16().collect();
        let mutex = unsafe { CreateMutexW(null_mut(), 1, mutex_name.as_ptr()) };
        let last_err = unsafe { GetLastError() };

        if mutex.is_null() || last_err == ERROR_ALREADY_EXISTS {
            eprintln!("[Voxify] Another instance is already running. Signaling existing instance and exiting.");

            // 1. Broadcast window message to running instance
            let msg_name: Vec<u16> = "VOXIFY_WAKE_INSTANCE_MSG\0".encode_utf16().collect();
            let show_msg = unsafe { RegisterWindowMessageW(msg_name.as_ptr()) };
            if show_msg != 0 {
                unsafe { PostMessageW(HWND_BROADCAST, show_msg, 0, 0) };
            }

            // 2. Direct HWND restore & focus
            let title: Vec<u16> = "Voxify\0".encode_utf16().collect();
            let hwnd = unsafe { FindWindowW(null_mut(), title.as_ptr()) };
            if !hwnd.is_null() {
                unsafe {
                    ShowWindow(hwnd, 9); // SW_RESTORE
                    SetForegroundWindow(hwnd);
                }
            }

            // Exit this second instance cleanly
            std::process::exit(0);
        }

        static mut APP_MUTEX: HANDLE = null_mut();
        unsafe { APP_MUTEX = mutex; }
    }
}

pub fn check_single_instance() {
    #[cfg(target_os = "windows")]
    {
        win_single_instance::enforce_single_instance();
    }
}
