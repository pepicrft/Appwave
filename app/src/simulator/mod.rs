use axum::{
    body::Body,
    extract::Query,
    http::{header, StatusCode},
    response::{IntoResponse, Response, sse::{Event, KeepAlive, Sse}},
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::process::{Command, Child, ChildStdin};
use tokio::sync::broadcast;
use tokio::sync::Mutex;
use tokio::io::AsyncWriteExt;
use tracing::{debug, error, info};
use std::convert::Infallible;
use futures::stream::Stream;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Deserialize)]
pub struct StreamQuery {
    pub udid: String,
    pub fps: Option<u32>,
    pub quality: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum StreamLogEvent {
    #[serde(rename = "info")]
    Info { message: String },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "debug")]
    Debug { message: String },
    #[serde(rename = "frame")]
    Frame { frame_number: u64 },
}

// Global broadcast channel for log events - allows multiple listeners
static STREAM_LOG_SENDER: Lazy<broadcast::Sender<StreamLogEvent>> = Lazy::new(|| {
    let (tx, _) = broadcast::channel(256);
    tx
});

// Global simulator session cache - one per UDID
type SessionCache = Mutex<HashMap<String, SimulatorSession>>;
static SESSION_CACHE: Lazy<SessionCache> = Lazy::new(|| Mutex::new(HashMap::new()));

// MARK: - SimulatorSession

/// Represents a persistent connection to a simulator via simulator-server
struct SimulatorSession {
    #[allow(dead_code)]
    udid: String,
    process: Child,
    stream_url: String,
    #[allow(dead_code)]
    stdin: Arc<Mutex<ChildStdin>>,
}

impl SimulatorSession {
    /// Start a new simulator-server session
    async fn new(udid: String, fps: u32, quality: f32, log_tx: &broadcast::Sender<StreamLogEvent>) -> Result<Self, String> {
        let simulator_server_path = find_simulator_server_binary()
            .ok_or_else(|| "simulator-server binary not found".to_string())?;

        let _ = log_tx.send(StreamLogEvent::Info {
            message: format!("Spawning simulator-server for {}", udid),
        });

        let mut cmd = Command::new(&simulator_server_path);
        cmd.args([
            "--udid", &udid,
            "--fps", &fps.to_string(),
            "--quality", &quality.to_string(),
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::piped());

        let mut child = cmd.spawn()
            .map_err(|e| format!("Failed to spawn simulator-server: {}", e))?;

        // Capture stdin for sending commands
        let stdin = child.stdin.take()
            .ok_or_else(|| "Failed to capture simulator-server stdin".to_string())?;

        // Read stdout to find "stream_ready <URL>"
        let stdout = child.stdout.take()
            .ok_or_else(|| "Failed to capture simulator-server stdout".to_string())?;

        let log_tx_clone = log_tx.clone();
        let stream_url = Self::read_stream_ready_async(stdout, &log_tx_clone)
            .await
            .map_err(|e| e.to_string())?;

        // Log stderr in background - this is where all the Swift Logger output goes
        if let Some(stderr) = child.stderr.take() {
            let log_tx_stderr = log_tx.clone();
            let udid_for_stderr = udid.clone();
            tokio::spawn(async move {
                let reader = tokio::io::BufReader::new(stderr);
                let mut lines = tokio::io::AsyncBufReadExt::lines(reader);
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.is_empty() {
                        // Log to tracing so it appears in terminal
                        info!("[simulator-server stderr] {}", line);
                        // Also broadcast to SSE log stream
                        let _ = log_tx_stderr.send(StreamLogEvent::Debug {
                            message: format!("simulator-server stderr: {}", line),
                        });
                    }
                }
                info!("[simulator-server {}] stderr closed", udid_for_stderr);
            });
        }

        let _ = log_tx.send(StreamLogEvent::Info {
            message: format!("simulator-server ready at {}", stream_url),
        });

        Ok(SimulatorSession {
            udid,
            process: child,
            stream_url,
            stdin: Arc::new(Mutex::new(stdin)),
        })
    }

    /// Send a command to the simulator-server via stdin
    async fn send_command(&self, command: &str) -> Result<(), String> {
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(format!("{}\n", command).as_bytes()).await
            .map_err(|e| format!("Failed to write command: {}", e))?;
        stdin.flush().await
            .map_err(|e| format!("Failed to flush command: {}", e))?;
        Ok(())
    }

    async fn read_stream_ready_async(
        stdout: tokio::process::ChildStdout,
        log_tx: &broadcast::Sender<StreamLogEvent>,
    ) -> Result<String, String> {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        // Read until we find "stream_ready <URL>"
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let trimmed = line.trim();
                    info!("[simulator-server stdout] {}", trimmed);
                    let _ = log_tx.send(StreamLogEvent::Debug {
                        message: format!("simulator-server stdout: {}", trimmed),
                    });

                    if trimmed.starts_with("stream_ready ") {
                        let url = trimmed.strip_prefix("stream_ready ")
                            .ok_or_else(|| "Invalid stream_ready format".to_string())?
                            .to_string();

                        // Continue reading stdout in background after stream_ready
                        let log_tx_clone = log_tx.clone();
                        tokio::spawn(async move {
                            while let Ok(Some(line)) = lines.next_line().await {
                                let trimmed = line.trim();
                                if !trimmed.is_empty() {
                                    info!("[simulator-server stdout] {}", trimmed);
                                    let _ = log_tx_clone.send(StreamLogEvent::Debug {
                                        message: format!("simulator-server stdout: {}", trimmed),
                                    });
                                }
                            }
                            info!("[simulator-server] stdout closed");
                        });

                        return Ok(url);
                    }
                }
                Ok(None) => {
                    return Err("simulator-server closed without sending stream_ready".to_string());
                }
                Err(e) => {
                    return Err(format!("Failed to read from simulator-server: {}", e));
                }
            }
        }
    }
}

/// Send a command to a simulator session by UDID
async fn send_session_command(udid: &str, command: &str) -> Result<(), String> {
    let cache = SESSION_CACHE.lock().await;
    match cache.get(udid) {
        Some(session) => session.send_command(command).await,
        None => Err(format!("No active session for simulator {}", udid)),
    }
}

impl Drop for SimulatorSession {
    fn drop(&mut self) {
        let _ = self.process.kill();
    }
}

pub async fn stream_simulator(Query(query): Query<StreamQuery>) -> Response {
    let log_tx = STREAM_LOG_SENDER.clone();

    let fps = query.fps
        .or_else(|| {
            std::env::var("PLASMA_STREAM_FPS")
                .ok()
                .and_then(|value| value.parse::<u32>().ok())
        })
        .unwrap_or(60)
        .min(60);

    let quality = query.quality
        .or_else(|| {
            std::env::var("PLASMA_STREAM_QUALITY")
                .ok()
                .and_then(|value| value.parse::<f32>().ok())
        })
        .unwrap_or(0.7)
        .clamp(0.1, 1.0);

    let _ = log_tx.send(StreamLogEvent::Info {
        message: format!("Stream request for simulator {}", query.udid),
    });
    let _ = log_tx.send(StreamLogEvent::Info {
        message: format!("Using FPS: {}, Quality: {}", fps, quality),
    });

    // Get or create session
    let cache = SESSION_CACHE.lock().await;
    let stream_url = match cache.get(&query.udid) {
        Some(session) => {
            let _ = log_tx.send(StreamLogEvent::Info {
                message: format!("Reusing cached session for {}", query.udid),
            });
            session.stream_url.clone()
        }
        None => {
            drop(cache); // Release lock before spawning

            match SimulatorSession::new(query.udid.clone(), fps, quality, &log_tx).await {
                Ok(session) => {
                    let stream_url = session.stream_url.clone();
                    SESSION_CACHE.lock().await.insert(query.udid.clone(), session);
                    stream_url
                }
                Err(e) => {
                    let _ = log_tx.send(StreamLogEvent::Error {
                        message: format!("Failed to start session: {}", e),
                    });
                    return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to start session: {}", e)).into_response();
                }
            }
        }
    };

    // Proxy the stream from simulator-server through the backend
    let _ = log_tx.send(StreamLogEvent::Info {
        message: format!("Proxying stream from: {}", stream_url),
    });

    // Stream the MJPEG from simulator-server
    let log_tx_stream = log_tx.clone();
    let mut chunk_count: u64 = 0;
    let stream = async_stream::stream! {
        // Use reqwest to fetch the stream from simulator-server
        let _ = log_tx_stream.send(StreamLogEvent::Debug {
            message: "Starting reqwest connection to simulator-server...".to_string(),
        });

        match reqwest::Client::new().get(&stream_url).send().await {
            Ok(response) => {
                let status = response.status();
                let content_type = response.headers().get("content-type").map(|v| v.to_str().unwrap_or("unknown")).unwrap_or("none");
                let _ = log_tx_stream.send(StreamLogEvent::Debug {
                    message: format!("Connected to simulator-server: status={}, content-type={}", status, content_type),
                });

                let mut bytes_stream = response.bytes_stream();
                let mut total_bytes: u64 = 0;

                while let Some(chunk_result) = futures::stream::StreamExt::next(&mut bytes_stream).await {
                    match chunk_result {
                        Ok(chunk) => {
                            total_bytes += chunk.len() as u64;
                            chunk_count += 1;

                            // Log every 100 chunks to avoid flooding
                            if chunk_count % 100 == 0 {
                                let _ = log_tx_stream.send(StreamLogEvent::Debug {
                                    message: format!("Stream progress: {} chunks, {} bytes total", chunk_count, total_bytes),
                                });
                            }

                            yield Ok::<_, Infallible>(chunk);
                        }
                        Err(e) => {
                            let _ = log_tx_stream.send(StreamLogEvent::Error {
                                message: format!("Stream chunk error after {} chunks: {}", chunk_count, e),
                            });
                            break;
                        }
                    }
                }

                let _ = log_tx_stream.send(StreamLogEvent::Info {
                    message: format!("Stream ended after {} chunks, {} bytes", chunk_count, total_bytes),
                });
            }
            Err(e) => {
                let _ = log_tx_stream.send(StreamLogEvent::Error {
                    message: format!("Failed to connect to simulator-server: {}", e),
                });
            }
        }
    };

    let mut response = Response::new(Body::from_stream(stream));
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        "multipart/x-mixed-replace; boundary=--mjpegstream".parse().unwrap(),
    );
    headers.insert(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate".parse().unwrap());
    headers.insert(header::PRAGMA, "no-cache".parse().unwrap());
    headers.insert(header::EXPIRES, "0".parse().unwrap());
    // CORS headers for cross-origin image loading
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, OPTIONS".parse().unwrap());
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, "*".parse().unwrap());

    let _ = log_tx.send(StreamLogEvent::Debug {
        message: "Response headers set, starting stream...".to_string(),
    });

    response
}

/// SSE endpoint for streaming logs
pub async fn stream_logs() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = STREAM_LOG_SENDER.subscribe();

    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let json = serde_json::to_string(&event).unwrap_or_default();
                    yield Ok(Event::default().data(json));
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    let event = StreamLogEvent::Debug {
                        message: format!("Skipped {} log messages due to buffer overflow", n)
                    };
                    let json = serde_json::to_string(&event).unwrap_or_default();
                    yield Ok(Event::default().data(json));
                }
                Err(broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

// MARK: - Touch API (using AXe)

#[derive(Debug, Deserialize)]
pub struct TouchRequest {
    pub udid: String,
    /// Touch type: "began", "moved", or "ended"
    #[serde(rename = "type")]
    pub touch_type: String,
    /// Array of touch points, each with x and y in normalized coordinates (0.0-1.0)
    pub touches: Vec<TouchPoint>,
    /// Screen width in pixels (for coordinate conversion)
    pub screen_width: Option<u32>,
    /// Screen height in pixels (for coordinate conversion)
    pub screen_height: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct TouchPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize)]
pub struct TouchResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Find the AXe binary
fn find_axe_binary() -> Option<PathBuf> {
    // 1. Environment variable override
    if let Ok(path) = std::env::var("AXE_BINARY") {
        let candidate = PathBuf::from(&path);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // 2. Development: app/binaries/axe
    if let Some(project_root) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent() {
        let dev_path = project_root.join("app").join("binaries").join("axe");
        if dev_path.exists() {
            return Some(dev_path);
        }
        // Also check directly in app/binaries (if CARGO_MANIFEST_DIR is app)
        let dev_path2 = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("axe");
        if dev_path2.exists() {
            return Some(dev_path2);
        }
    }

    // 3. Bundled binary in app resources (for release builds)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(macos_dir) = exe_path.parent() {
            let resources_dir = macos_dir.parent().map(|p| p.join("Resources"));
            if let Some(resources) = resources_dir {
                let bundled = resources.join("binaries").join("axe");
                if bundled.exists() {
                    return Some(bundled);
                }
            }
        }
    }

    // 4. Check if axe is in PATH (Homebrew install)
    if let Ok(output) = std::process::Command::new("which").arg("axe").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    None
}

/// Send touch events to the simulator via simulator-server stdin
/// Uses the protocol: touch <type> <x,y> where coordinates are normalized 0.0-1.0
pub async fn send_touch(Json(request): Json<TouchRequest>) -> impl IntoResponse {
    // Validate we have at least one touch point
    if request.touches.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(TouchResponse {
                success: false,
                error: Some("At least one touch point is required".to_string()),
            }),
        ).into_response();
    }

    // Map touch type to simulator-server protocol
    let touch_type = match request.touch_type.as_str() {
        "began" => "Down",
        "moved" => "Move",
        "ended" => "Up",
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(TouchResponse {
                    success: false,
                    error: Some(format!("Invalid touch type: {}. Must be 'began', 'moved', or 'ended'", request.touch_type)),
                }),
            ).into_response();
        }
    };

    // Build touch coordinates string (normalized 0.0-1.0)
    let coords: Vec<String> = request.touches.iter()
        .map(|t| format!("{:.4},{:.4}", t.x, t.y))
        .collect();
    let coords_str = coords.join(" ");

    // Build command: touch <type> <x,y> [<x,y> ...]
    let command = format!("touch {} {}", touch_type, coords_str);

    debug!("Sending touch command: {}", command);

    // Send via simulator-server stdin (fast, no process spawn)
    match send_session_command(&request.udid, &command).await {
        Ok(()) => {
            Json(TouchResponse { success: true, error: None }).into_response()
        }
        Err(e) => {
            error!("Touch command failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(TouchResponse {
                    success: false,
                    error: Some(e),
                }),
            ).into_response()
        }
    }
}

// MARK: - Tap API (using AXe tap command - more efficient for single taps)

#[derive(Debug, Deserialize)]
pub struct TapRequest {
    pub udid: String,
    /// X coordinate (normalized 0.0-1.0)
    pub x: f64,
    /// Y coordinate (normalized 0.0-1.0)
    pub y: f64,
    /// Screen width in pixels (for coordinate conversion)
    pub screen_width: Option<u32>,
    /// Screen height in pixels (for coordinate conversion)
    pub screen_height: Option<u32>,
}

/// Send a tap event using AXe's tap command (more efficient than touch down + up)
pub async fn send_tap(Json(request): Json<TapRequest>) -> impl IntoResponse {
    info!("=== TAP API CALLED === udid={}, x={:.3}, y={:.3}", request.udid, request.x, request.y);

    // Get screen dimensions from request (these are in PIXELS from the stream)
    let pixel_width = request.screen_width.unwrap_or(393) as f64;
    let pixel_height = request.screen_height.unwrap_or(852) as f64;

    // AXe expects POINT coordinates, not pixel coordinates
    // iOS uses @2x or @3x scaling. We detect the scale factor based on common device sizes.
    // Common point sizes: 390x844 (iPhone 14/15/16), 393x852 (iPhone 14/15/16 Pro), 430x932 (Pro Max)
    // Common pixel sizes: 1170x2532 (@3x), 1179x2556 (@3x), 1290x2796 (@3x)
    let scale_factor = if pixel_width > 1000.0 { 3.0 } else if pixel_width > 700.0 { 2.0 } else { 1.0 };

    let point_width = pixel_width / scale_factor;
    let point_height = pixel_height / scale_factor;

    // Convert normalized coordinates to POINT coordinates (not pixels)
    let x = (request.x * point_width).round() as i32;
    let y = (request.y * point_height).round() as i32;

    info!("Tap: normalized({:.3}, {:.3}) -> points({}, {}) [pixels={}x{}, scale={}x, points={}x{}]",
          request.x, request.y, x, y, pixel_width, pixel_height, scale_factor, point_width, point_height);

    // Find AXe binary
    let axe_path = match find_axe_binary() {
        Some(path) => path,
        None => {
            error!("AXe binary not found");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(TouchResponse {
                    success: false,
                    error: Some("AXe binary not found".to_string()),
                }),
            ).into_response();
        }
    };

    // Set up library path for AXe's frameworks
    let frameworks_path = axe_path.parent()
        .map(|p| p.join("Frameworks"))
        .unwrap_or_default();

    info!("Executing: axe tap -x {} -y {} --udid {}", x, y, request.udid);

    let result = Command::new(&axe_path)
        .args(["tap", "-x", &x.to_string(), "-y", &y.to_string(), "--udid", &request.udid])
        .env("DYLD_FRAMEWORK_PATH", &frameworks_path)
        .output()
        .await;

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            info!("AXe tap result: status={}, stdout='{}', stderr='{}'", output.status, stdout.trim(), stderr.trim());

            if output.status.success() {
                Json(TouchResponse { success: true, error: None }).into_response()
            } else {
                error!("AXe tap failed: {}", stderr);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(TouchResponse {
                        success: false,
                        error: Some(format!("AXe command failed: {}", stderr)),
                    }),
                ).into_response()
            }
        }
        Err(e) => {
            error!("Failed to execute AXe: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(TouchResponse {
                    success: false,
                    error: Some(format!("Failed to execute AXe: {}", e)),
                }),
            ).into_response()
        }
    }
}

// MARK: - Swipe API (using AXe swipe command - single command for entire gesture)

#[derive(Debug, Deserialize)]
pub struct SwipeRequest {
    pub udid: String,
    /// Start X coordinate (normalized 0.0-1.0)
    pub start_x: f64,
    /// Start Y coordinate (normalized 0.0-1.0)
    pub start_y: f64,
    /// End X coordinate (normalized 0.0-1.0)
    pub end_x: f64,
    /// End Y coordinate (normalized 0.0-1.0)
    pub end_y: f64,
    /// Screen width in pixels
    pub screen_width: Option<u32>,
    /// Screen height in pixels
    pub screen_height: Option<u32>,
    /// Duration of swipe in seconds (optional)
    pub duration: Option<f64>,
}

/// Send a swipe gesture using AXe's swipe command
pub async fn send_swipe(Json(request): Json<SwipeRequest>) -> impl IntoResponse {
    // Get screen dimensions from request (these are in PIXELS from the stream)
    let pixel_width = request.screen_width.unwrap_or(393) as f64;
    let pixel_height = request.screen_height.unwrap_or(852) as f64;

    // AXe expects POINT coordinates, not pixel coordinates
    let scale_factor = if pixel_width > 1000.0 { 3.0 } else if pixel_width > 700.0 { 2.0 } else { 1.0 };

    let point_width = pixel_width / scale_factor;
    let point_height = pixel_height / scale_factor;

    // Convert normalized coordinates to POINT coordinates
    let start_x = (request.start_x * point_width).round() as i32;
    let start_y = (request.start_y * point_height).round() as i32;
    let end_x = (request.end_x * point_width).round() as i32;
    let end_y = (request.end_y * point_height).round() as i32;

    info!("Swipe: ({:.2},{:.2})->({:.2},{:.2}) => points ({},{})->({},{}) [scale={}x]",
          request.start_x, request.start_y, request.end_x, request.end_y,
          start_x, start_y, end_x, end_y, scale_factor);

    // Find AXe binary
    let axe_path = match find_axe_binary() {
        Some(path) => path,
        None => {
            error!("AXe binary not found");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(TouchResponse {
                    success: false,
                    error: Some("AXe binary not found".to_string()),
                }),
            ).into_response();
        }
    };

    // Set up library path for AXe's frameworks
    let frameworks_path = axe_path.parent()
        .map(|p| p.join("Frameworks"))
        .unwrap_or_default();

    // Build swipe command
    let duration = request.duration.unwrap_or(0.3);
    let args = vec![
        "swipe".to_string(),
        "--start-x".to_string(), start_x.to_string(),
        "--start-y".to_string(), start_y.to_string(),
        "--end-x".to_string(), end_x.to_string(),
        "--end-y".to_string(), end_y.to_string(),
        "--duration".to_string(), duration.to_string(),
        "--udid".to_string(), request.udid.clone(),
    ];

    info!("Executing: axe {}", args.join(" "));

    let result = Command::new(&axe_path)
        .args(&args)
        .env("DYLD_FRAMEWORK_PATH", &frameworks_path)
        .output()
        .await;

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            info!("AXe swipe result: status={}, stdout='{}', stderr='{}'",
                  output.status, stdout.trim(), stderr.trim());

            if output.status.success() {
                Json(TouchResponse { success: true, error: None }).into_response()
            } else {
                error!("AXe swipe failed: {}", stderr);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(TouchResponse {
                        success: false,
                        error: Some(format!("AXe command failed: {}", stderr)),
                    }),
                ).into_response()
            }
        }
        Err(e) => {
            error!("Failed to execute AXe: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(TouchResponse {
                    success: false,
                    error: Some(format!("Failed to execute AXe: {}", e)),
                }),
            ).into_response()
        }
    }
}

/// Find the simulator-server binary (persistent connection with persistent callbacks)
fn find_simulator_server_binary() -> Option<PathBuf> {
    // 1. Environment variable override
    if let Ok(path) = std::env::var("SIMULATOR_SERVER") {
        let candidate = PathBuf::from(&path);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // 2. Development: swift/.build/debug/simulator-server or swift/.build/release/simulator-server
    if let Some(project_root) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent() {
        let swift_debug = project_root.join("swift").join(".build").join("debug").join("simulator-server");
        if swift_debug.exists() {
            return Some(swift_debug);
        }

        let swift_release = project_root.join("swift").join(".build").join("release").join("simulator-server");
        if swift_release.exists() {
            return Some(swift_release);
        }
    }

    // 3. Bundled binary in app resources (for release builds)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(macos_dir) = exe_path.parent() {
            let resources_dir = macos_dir.parent().map(|p| p.join("Resources"));
            if let Some(resources) = resources_dir {
                let bundled = resources.join("binaries").join("simulator-server");
                if bundled.exists() {
                    return Some(bundled);
                }
            }
        }
    }

    None
}

// --- Simulator listing and launching ---

#[derive(Debug, Serialize, Clone)]
pub struct Simulator {
    pub udid: String,
    pub name: String,
    pub state: String,
    pub runtime: String,
}

#[derive(Debug, Serialize)]
pub struct SimulatorListResponse {
    pub simulators: Vec<Simulator>,
}

/// List all available iOS simulators using `xcrun simctl list devices`
pub async fn list_simulators() -> impl IntoResponse {
    match get_simulators().await {
        Ok(simulators) => Json(SimulatorListResponse { simulators }).into_response(),
        Err(e) => {
            error!("Failed to list simulators: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e).into_response()
        }
    }
}

async fn get_simulators() -> Result<Vec<Simulator>, String> {
    let output = Command::new("xcrun")
        .args(["simctl", "list", "devices", "-j"])
        .output()
        .await
        .map_err(|e| format!("Failed to run simctl: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "simctl failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse simctl output: {}", e))?;

    let mut simulators = Vec::new();

    if let Some(devices) = json.get("devices").and_then(|d| d.as_object()) {
        for (runtime, device_list) in devices {
            if let Some(arr) = device_list.as_array() {
                for device in arr {
                    let udid = device.get("udid").and_then(|v| v.as_str()).unwrap_or("");
                    let name = device.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let state = device.get("state").and_then(|v| v.as_str()).unwrap_or("");

                    if !udid.is_empty() && state != "Unavailable" {
                        simulators.push(Simulator {
                            udid: udid.to_string(),
                            name: name.to_string(),
                            state: state.to_string(),
                            runtime: runtime.clone(),
                        });
                    }
                }
            }
        }
    }

    // Sort by state (Booted first) then by name
    simulators.sort_by(|a, b| {
        let a_booted = a.state == "Booted";
        let b_booted = b.state == "Booted";
        match (a_booted, b_booted) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });

    Ok(simulators)
}

#[derive(Debug, Deserialize)]
pub struct InstallAndLaunchRequest {
    pub udid: String,
    pub app_path: String,
    pub bundle_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct InstallAndLaunchResponse {
    pub success: bool,
    pub message: String,
}

/// Boot simulator, install app, and launch it
pub async fn install_and_launch(
    Json(request): Json<InstallAndLaunchRequest>,
) -> impl IntoResponse {
    match do_install_and_launch(&request.udid, &request.app_path, request.bundle_id.as_deref()).await
    {
        Ok(msg) => Json(InstallAndLaunchResponse {
            success: true,
            message: msg,
        })
        .into_response(),
        Err(e) => {
            error!("Failed to install and launch: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InstallAndLaunchResponse {
                    success: false,
                    message: e,
                }),
            )
                .into_response()
        }
    }
}

async fn do_install_and_launch(
    udid: &str,
    app_path: &str,
    bundle_id: Option<&str>,
) -> Result<String, String> {
    // Boot simulator if not already booted
    info!("Booting simulator {}...", udid);
    let boot_output = Command::new("xcrun")
        .args(["simctl", "boot", udid])
        .output()
        .await
        .map_err(|e| format!("Failed to boot simulator: {}", e))?;

    // Ignore error if already booted
    if !boot_output.status.success() {
        let stderr = String::from_utf8_lossy(&boot_output.stderr);
        if !stderr.contains("current state: Booted") {
            debug!("Boot warning (may already be booted): {}", stderr);
        }
    }

    // Install the app
    info!("Installing app at {}...", app_path);
    let install_output = Command::new("xcrun")
        .args(["simctl", "install", udid, app_path])
        .output()
        .await
        .map_err(|e| format!("Failed to install app: {}", e))?;

    if !install_output.status.success() {
        return Err(format!(
            "Install failed: {}",
            String::from_utf8_lossy(&install_output.stderr)
        ));
    }

    // Extract bundle ID from app if not provided
    let bundle_id = match bundle_id {
        Some(id) => id.to_string(),
        None => extract_bundle_id(app_path)?,
    };

    // Launch the app
    info!("Launching app with bundle ID {}...", bundle_id);
    let launch_output = Command::new("xcrun")
        .args(["simctl", "launch", udid, &bundle_id])
        .output()
        .await
        .map_err(|e| format!("Failed to launch app: {}", e))?;

    if !launch_output.status.success() {
        return Err(format!(
            "Launch failed: {}",
            String::from_utf8_lossy(&launch_output.stderr)
        ));
    }

    Ok(format!("App {} launched successfully", bundle_id))
}

fn extract_bundle_id(app_path: &str) -> Result<String, String> {
    let plist_path = PathBuf::from(app_path).join("Info.plist");

    // Use PlistBuddy to read the bundle identifier
    let output = std::process::Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIdentifier", plist_path.to_str().unwrap()])
        .output()
        .map_err(|e| format!("Failed to read bundle ID: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to read bundle ID: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
