# Simulator Streaming Roadmap

## Goals
Deliver a stable, low-latency simulator stream with a persistent backend session, and add interactive controls over time.

## Phase 1: Core Streaming (complete)
- Swift `simulator-server` with persistent IOSurface callbacks
- MJPEG HTTP endpoint on localhost
- Hardware-accelerated JPEG encoding

## Phase 2: Backend Integration (complete)
- Rust session cache per simulator UDID
- `/api/simulator/stream` proxies the MJPEG stream
- `/api/simulator/stream/logs` SSE for diagnostics

## Phase 3: Interactive Features (planned)
- Stdin command channel wired through the backend
- REST endpoints for rotation, touch, and button events
- Frontend UI controls and coordinate transformation

## Phase 4: Advanced Features (optional)
- Screenshot capture
- Video recording
- FPS dashboard and stream health metrics
