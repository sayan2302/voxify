// Local HTTP REST API Service for Voxify
// Binds strictly to 127.0.0.1:18200 (Loopback only - zero firewall warnings, 100% private)
// Allows external tools, scripts, and extensions to POST raw markdown directly into Voxify's Audio Pill.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

static SERVICE_INITIALIZED: AtomicBool = AtomicBool::new(false);

pub fn start_api_service(app_handle: AppHandle) {
    if SERVICE_INITIALIZED.swap(true, Ordering::SeqCst) {
        return;
    }

    thread::spawn(move || {
        let bind_addr = "127.0.0.1:18200";
        println!("[ApiService] Binding local HTTP API service on http://{}...", bind_addr);

        let listener = match TcpListener::bind(bind_addr) {
            Ok(l) => {
                println!("[ApiService] Local API successfully listening on http://{}", bind_addr);
                l
            }
            Err(e) => {
                eprintln!("[ApiService] Failed to bind local API to {}: {}. Port may be occupied.", bind_addr, e);
                return;
            }
        };

        if let Err(e) = listener.set_nonblocking(true) {
            eprintln!("[ApiService] Failed to set nonblocking mode on listener: {}", e);
        }

        loop {
            match listener.accept() {
                Ok((stream, _remote)) => {
                    let app_h = app_handle.clone();
                    thread::spawn(move || {
                        handle_client(stream, &app_h);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(e) => {
                    eprintln!("[ApiService] Connection accept error: {}", e);
                    thread::sleep(Duration::from_millis(100));
                }
            }
        }
    });
}

fn handle_client(mut stream: TcpStream, app_handle: &AppHandle) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    let mut buffer = [0u8; 4096];
    let mut header_bytes = Vec::new();
    let mut body_bytes = Vec::new();
    let mut content_length: Option<usize> = None;
    let mut method = String::new();
    let mut path = String::new();

    // 1. Read headers
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                header_bytes.extend_from_slice(&buffer[..n]);
                if let Some(pos) = find_header_end(&header_bytes) {
                    let headers_part = &header_bytes[..pos];
                    let remaining_body = &header_bytes[pos + 4..];

                    let headers_str = String::from_utf8_lossy(headers_part);
                    let mut lines = headers_str.lines();
                    if let Some(req_line) = lines.next() {
                        let parts: Vec<&str> = req_line.split_whitespace().collect();
                        if parts.len() >= 2 {
                            method = parts[0].to_uppercase();
                            path = parts[1].to_string();
                        }
                    }

                    for line in lines {
                        let lower = line.to_lowercase();
                        if lower.starts_with("content-length:") {
                            if let Some(val) = line.split(':').nth(1) {
                                content_length = val.trim().parse::<usize>().ok();
                            }
                        }
                    }

                    body_bytes.extend_from_slice(remaining_body);
                    break;
                }
                // Safety limit for headers
                if header_bytes.len() > 64 * 1024 {
                    break;
                }
            }
            Err(_) => return,
        }
    }

    // 2. CORS Preflight: OPTIONS * or /api/read
    if method == "OPTIONS" {
        let response = "HTTP/1.1 204 No Content\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type, Authorization, Accept\r\n\
Access-Control-Max-Age: 86400\r\n\
Connection: close\r\n\r\n";
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    // 3. Health check: GET /api/health
    if method == "GET" && (path == "/api/health" || path == "/health") {
        let body = serde_json::json!({
            "status": "ok",
            "app": "Voxify",
            "version": "1.0.3",
            "api": "active"
        }).to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\n\
Content-Type: application/json\r\n\
Access-Control-Allow-Origin: *\r\n\
Content-Length: {}\r\n\
Connection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    // 4. Verify API enabled in settings
    if !crate::global_reader::API_SERVICE_ENABLED.load(Ordering::Relaxed) {
        let body = serde_json::json!({
            "error": "Local Markdown API service is currently disabled in Voxify Settings"
        }).to_string();
        let response = format!(
            "HTTP/1.1 503 Service Unavailable\r\n\
Content-Type: application/json\r\n\
Access-Control-Allow-Origin: *\r\n\
Content-Length: {}\r\n\
Connection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    // 5. Read remaining body if Content-Length specified
    if let Some(len) = content_length {
        let max_allowed = 10 * 1024 * 1024; // 10MB limit
        let target_len = len.min(max_allowed);
        while body_bytes.len() < target_len {
            let to_read = (target_len - body_bytes.len()).min(buffer.len());
            match stream.read(&mut buffer[..to_read]) {
                Ok(0) => break,
                Ok(n) => body_bytes.extend_from_slice(&buffer[..n]),
                Err(_) => break,
            }
        }
    }

    // 6. Ingestion Endpoint: POST /api/read
    if method == "POST" && (path == "/api/read" || path == "/read") {
        let raw_text = String::from_utf8_lossy(&body_bytes).to_string();
        let trimmed = raw_text.trim();

        if trimmed.is_empty() {
            let body = serde_json::json!({
                "error": "Request body is empty. Please provide markdown or plain text to read."
            }).to_string();
            let response = format!(
                "HTTP/1.1 400 Bad Request\r\n\
Content-Type: application/json\r\n\
Access-Control-Allow-Origin: *\r\n\
Content-Length: {}\r\n\
Connection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
            return;
        }

        // Trigger reading pipeline in Audio Pill
        let (word_count, estimated_seconds) = crate::global_reader::handle_direct_text(app_handle, trimmed);

        let body = serde_json::json!({
            "success": true,
            "word_count": word_count,
            "estimated_seconds": estimated_seconds,
            "message": "Playback started in Voxify Audio Pill"
        }).to_string();

        let response = format!(
            "HTTP/1.1 200 OK\r\n\
Content-Type: application/json\r\n\
Access-Control-Allow-Origin: *\r\n\
Content-Length: {}\r\n\
Connection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    // 7. Route not found
    let body = serde_json::json!({
        "error": "Route not found. Supported endpoints: POST /api/read, GET /api/health"
    }).to_string();
    let response = format!(
        "HTTP/1.1 404 Not Found\r\n\
Content-Type: application/json\r\n\
Access-Control-Allow-Origin: *\r\n\
Content-Length: {}\r\n\
Connection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < 4 {
        return None;
    }
    for i in 0..=bytes.len() - 4 {
        if bytes[i] == b'\r' && bytes[i + 1] == b'\n' && bytes[i + 2] == b'\r' && bytes[i + 3] == b'\n' {
            return Some(i);
        }
    }
    None
}
