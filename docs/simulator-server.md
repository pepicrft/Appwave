# Simulator Server

## Overview
Simulator streaming now uses a persistent `simulator-server` process instead of spawning a new process per request. This keeps IOSurface callbacks alive, stabilizes frame delivery, and allows multiple clients to connect without freezing.

## Architecture

### Old (freezing)
```
HTTP request → spawn plasma-stream → stream → exit
```

### New (stable)
```
HTTP request → get/create cached session → proxy stream from simulator-server
```

## Components

### simulator-server (Swift)
**Location**: `tools/simulator-server/`  
**Binary**: `app/bin/simulator-server`

- Maintains a persistent simulator connection
- Serves MJPEG over HTTP at `/stream.mjpeg`
- Accepts stdin commands for future interactive features
- Reports FPS metrics on stdout

#### Protocol (summary)
```
stdin:  rotate <rotation>
        touch <type> <x,y> <x,y> ...
        button <type> <direction>
        key <code> <direction>
        fps true|false
        shutdown

stdout: stream_ready http://127.0.0.1:<port>/stream.mjpeg
        fps_report {json}
```

### Rust Backend (Axum)
**Location**: `app/src/simulator/mod.rs`

- Caches a session per simulator UDID
- Spawns `simulator-server` once, reuses it for later requests
- Proxies MJPEG stream to `/api/simulator/stream?udid=...`
- Exposes logs via `/api/simulator/stream/logs` (SSE)

### Frontend (React)
**Location**: `frontend/src/components/BuildAndRun.tsx`

- Starts streaming with `/api/simulator/stream?udid=...&fps=60&quality=0.7`
- Displays stream in the right-hand panel

## Binary Lookup Order
1. `$SIMULATOR_SERVER`
2. `tools/simulator-server/.build/debug/simulator-server`
3. `tools/simulator-server/.build/release/simulator-server`
4. `app/bin/simulator-server`

## Building

Simulator server:
```bash
cd tools/simulator-server
swift build -c release
```

Backend:
```bash
cd app
cargo build --release
```

## Debugging

Check that simulator-server is running:
```bash
ps aux | grep simulator-server
```

Manual stream test:
```bash
curl http://127.0.0.1:<port>/stream.mjpeg > test.mjpeg
ffplay test.mjpeg
```
