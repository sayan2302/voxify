// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Enforce single instance on Windows: focuses running instance and exits if already open
    voxify_lib::single_instance::check_single_instance();

    // Disable background throttling and enable SharedArrayBuffer in WebView2
    // so multi-threaded WASM SIMD & Web Workers run at 100% full speed across all CPU cores
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --enable-features=SharedArrayBuffer",
    );
    voxify_lib::run()
}
