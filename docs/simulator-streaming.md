# Simulator Streaming (Tauri)

This document describes the simulator streaming path used by the Tauri backend.

## Overview

The server exposes a MJPEG endpoint at:

`GET /api/simulator/stream?udid=<SIM_UDID>&fps=<optional>`

The handler spawns [AXe](https://github.com/cameroncooke/AXe), a utility for
interacting with iOS Simulators that uses FBSimulatorControl under the hood.

## Data flow

1) `axe stream-video --udid <udid> --format mjpeg --fps <n> --quality 80` is spawned.
2) axe outputs an HTTP multipart response to stdout with `Content-Type: multipart/x-mixed-replace`.
3) Each frame part includes `Content-Length` header followed by image data (PNG format).
4) Frames are extracted using Content-Length and re-emitted as `multipart/x-mixed-replace` to the client.

## Binary location

The `axe` binary is searched in this order:

1. `PLASMA_AXE` environment variable
2. Bundled in app resources at `Contents/Resources/binaries/axe`
3. Standard locations (`/opt/homebrew/bin/axe`, `/usr/local/bin/axe`)
4. `PATH`

## Environment knobs

- `PLASMA_AXE=/path/to/axe` to override the binary path.
- `PLASMA_AXE_FPS=30` to set the default FPS (max 30).

## Bundling for release

Run `mise run prepare-binaries` before building to copy `axe` and its
frameworks to `app/binaries/`. The Tauri config bundles these into the
app's Resources directory.

## Notes

- The stream captures frames using screenshot-based capture.
- The Simulator UI does not need to be visible for streaming to work.
- axe is installed via mise using the github backend (see `mise.toml`).
