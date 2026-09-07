// Native Windows Autostart Manager for Voxify
// Configures HKCU\Software\Microsoft\Windows\CurrentVersion\Run with --autostart flag

#[cfg(target_os = "windows")]
mod win_reg {
    use std::ptr::null_mut;

    type HKEY = *mut std::ffi::c_void;
    const HKEY_CURRENT_USER: HKEY = 0x80000001 as HKEY;
    const KEY_READ: u32 = 0x20019;
    const KEY_WRITE: u32 = 0x20006;
    const REG_SZ: u32 = 1;

    extern "system" {
        fn RegOpenKeyExW(
            hKey: HKEY,
            lpSubKey: *const u16,
            ulOptions: u32,
            samDesired: u32,
            phkResult: *mut HKEY,
        ) -> i32;
        fn RegQueryValueExW(
            hKey: HKEY,
            lpValueName: *const u16,
            lpReserved: *mut u32,
            lpType: *mut u32,
            lpData: *mut u8,
            lpcbData: *mut u32,
        ) -> i32;
        fn RegSetValueExW(
            hKey: HKEY,
            lpValueName: *const u16,
            Reserved: u32,
            dwType: u32,
            lpData: *const u8,
            cbData: u32,
        ) -> i32;
        fn RegDeleteValueW(hKey: HKEY, lpValueName: *const u16) -> i32;
        fn RegCloseKey(hKey: HKEY) -> i32;
    }

    pub fn check_is_enabled() -> bool {
        let subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Run\0"
            .encode_utf16()
            .collect();
        let val_name: Vec<u16> = "Voxify\0".encode_utf16().collect();
        let mut key: HKEY = null_mut();

        let open_res = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut key) };
        if open_res != 0 || key.is_null() {
            return false;
        }

        let mut data_type: u32 = 0;
        let mut len: u32 = 0;
        let query_res = unsafe {
            RegQueryValueExW(
                key,
                val_name.as_ptr(),
                null_mut(),
                &mut data_type,
                null_mut(),
                &mut len,
            )
        };
        unsafe { RegCloseKey(key) };
        query_res == 0 && len > 0
    }

    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        let subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Run\0"
            .encode_utf16()
            .collect();
        let val_name: Vec<u16> = "Voxify\0".encode_utf16().collect();
        let mut key: HKEY = null_mut();

        let open_res = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_WRITE, &mut key) };
        if open_res != 0 || key.is_null() {
            return Err("Failed to open Windows Run registry key".into());
        }

        if enabled {
            let current_exe = match std::env::current_exe() {
                Ok(p) => p,
                Err(e) => {
                    unsafe { RegCloseKey(key) };
                    return Err(format!("Could not determine executable path: {}", e));
                }
            };
            let exe_str = current_exe.to_string_lossy();
            let cmd = format!("\"{}\" --autostart\0", exe_str);
            let wide_cmd: Vec<u16> = cmd.encode_utf16().collect();
            let byte_len = (wide_cmd.len() * 2) as u32;

            let set_res = unsafe {
                RegSetValueExW(
                    key,
                    val_name.as_ptr(),
                    0,
                    REG_SZ,
                    wide_cmd.as_ptr() as *const u8,
                    byte_len,
                )
            };
            unsafe { RegCloseKey(key) };
            if set_res != 0 {
                return Err("Failed to write autostart registry entry".into());
            }
        } else {
            let _ = unsafe { RegDeleteValueW(key, val_name.as_ptr()) };
            unsafe { RegCloseKey(key) };
        }
        Ok(())
    }
}

#[tauri::command]
pub fn get_autostart_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        win_reg::check_is_enabled()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[tauri::command]
pub fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win_reg::set_enabled(enabled)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Ok(())
    }
}
