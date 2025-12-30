# Simulator Server Implementation Plan

## Overview
Replace the current per-request `plasma-stream` approach with a unified `simulator-server` binary that:
- Keeps a persistent connection to the simulator
- Serves MJPEG stream via HTTP
- Handles interactive commands (rotation, touches, etc.)
- Reports FPS metrics

This matches radon-ide's architecture and eliminates freezing issues.

## Phase 1: Core Streaming (baseline without freezing)

### 1.1 Create Swift Package Structure
```
Tools/
├── simulator-server/
│   ├── Package.swift
│   └── Sources/simulator-server/
│       ├── main.swift
│       ├── CoreSimulatorBridge.swift
│       ├── HTTPServer.swift
│       ├── CommandHandler.swift
│       └── Encoder.swift
```

### 1.2 Implement CoreSimulatorBridge.swift
Based on plasma-stream but with:
- **Persistent registration**: Register IOSurface callbacks that stay alive
- **Callback system**: Use closure-based updates instead of polling
- **State management**: Keep IOSurface reference alive

Key differences from plasma-stream:
```swift
class SimulatorBridge {
    private var ioSurface: IOSurface?
    private var callbackID = UUID()
    
    func startMonitoring(_ completion: @escaping (IOSurface?) -> Void) {
        // Register callback that persists across multiple frames
        display.registerCallbackWithUUID(callbackID) { surface in
            completion(surface)
        }
    }
}
```

### 1.3 Implement HTTPServer.swift
- Simple HTTP server on localhost:PORT (find available port)
- Multipart MJPEG endpoint at `/stream.mjpeg`
- Proper headers: `Content-Type: multipart/x-mixed-replace; boundary=frame`
- **Key difference from plasma-stream**: Don't spawn process per request, serve from running instance

### 1.4 Implement CommandHandler.swift
Read stdin for commands (like radon-ide):
```
rotate <DeviceRotation>
touch <type> <x,y> <x,y> ...
button <type> <direction>
key <keyCode> <direction>
fps true|false
```

### 1.5 Build & Integration
- Build to `app/bin/simulator-server`
- Update `build.rs` to compile Swift

## Phase 2: Rust Backend Integration

### 2.1 Create SimulatorSession Service
```rust
pub struct SimulatorSession {
    udid: String,
    process: Child,
    stream_url: String,
    command_tx: mpsc::UnboundedSender<String>,
}

impl SimulatorSession {
    pub async fn new(udid: String) -> Result<Self> {
        // Spawn simulator-server ONCE
        // Parse stdout for "stream_ready <URL>"
        // Create stdin channel for commands
    }
    
    pub async fn rotate(&mut self, rotation: &str) -> Result<()> {
        self.command_tx.send(format!("rotate {}\n", rotation))?;
    }
}
```

### 2.2 Global Session Cache
```rust
static SESSIONS: Lazy<Arc<Mutex<HashMap<String, SimulatorSession>>>> = ...;

// Endpoints
pub async fn get_stream(udid: String) -> String {
    let mut sessions = SESSIONS.lock().await;
    let session = sessions.entry(udid)
        .or_insert_with(|| SimulatorSession::new(...).await?);
    session.stream_url.clone()
}
```

### 2.3 REST Endpoints
- `GET /api/simulator/stream?udid=...` → Returns 302 redirect to stream_url
- `POST /api/simulator/rotate` → Sends command to session
- `POST /api/simulator/touch` → Sends command to session
- `POST /api/simulator/button` → Sends command to session
- `WS /api/simulator/commands` → WebSocket for real-time commands

## Phase 3: Frontend Integration

### 3.1 Update BuildAndRun.tsx
- Keep simple `<img>` tag (already working)
- Add command handlers for interactive features

### 3.2 Interactive Overlay Component
```tsx
<SimulatorOverlay
  streamUrl={streamUrl}
  onRotate={(rotation) => fetch('/api/simulator/rotate', ...)}
  onTouch={(point) => fetch('/api/simulator/touch', ...)}
/>
```

### 3.3 Gesture Detection
- Mouse down/move/up → touch events
- Multi-touch via ctrl/cmd+drag
- Right-click → context menu
- Scroll → wheel events

## Phase 4: Advanced Features (Optional)

### 4.1 Screenshot Capture
```rust
POST /api/simulator/screenshot
Response: { url: "...", tempPath: "..." }
```

### 4.2 Video Recording
```rust
POST /api/simulator/record/start
POST /api/simulator/record/stop
Response: { url: "...", tempPath: "..." }
```

### 4.3 FPS Dashboard
- Parse "fps_report" from simulator-server stdout
- Display current FPS, dropped frames, latency
- Graph over time

## Comparison: Old vs New Architecture

### Old (Current - freezes)
```
Request #1 → spawn plasma-stream → stream → kill
Request #2 → spawn plasma-stream → stream → kill
↑ IOSurface callbacks reset on each spawn
↑ No state persistence
↑ No way to send commands
```

### New (Proposed - stable)
```
Startup → spawn simulator-server (once) → stays alive
Request #1 → query cached stream_url → stream
Request #2 → query cached stream_url → stream
Command → send via stdin pipe → affects simulator
↑ IOSurface callbacks registered once and stay alive
↑ State fully persistent
↑ Bi-directional communication
```

## Why This Fixes Freezing

1. **No state loss**: IOSurface callbacks stay registered
2. **Continuous monitoring**: Simulator updates streamed continuously
3. **No restart lag**: No process spawn overhead per request
4. **Back-pressure aware**: Can track if clients are consuming frames
5. **Unified architecture**: Same process handles streaming + commands

## Timeline Estimate

- Phase 1 (Streaming): 3-4 hours
- Phase 2 (Rust Integration): 2 hours  
- Phase 3 (Frontend): 1-2 hours
- Phase 4 (Advanced): 3-4 hours per feature

## Success Criteria

- [ ] Stream runs for 30+ minutes without freezing
- [ ] FPS stays consistent (no drops below 40 FPS)
- [ ] Rotations work smoothly
- [ ] Touch events register correctly
- [ ] No memory leaks (check htop over time)
- [ ] Clean shutdown on app close
