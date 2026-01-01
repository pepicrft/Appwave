import Foundation
import IOSurface

// MARK: - Main

func printUsage() {
    fputs("""
    Usage: simulator-server --udid <simulator-udid> [options]

    Options:
      --udid <udid>     Simulator UDID (required)
      --fps <fps>       Target frames per second (default: 60)
      --quality <q>     JPEG quality 0.0-1.0 (default: 0.7)
      --port <port>     HTTP server port (default: 0 = auto)
      --help            Show this help

    Output:
      - "stream_ready <URL>" when server is ready
      - "fps_report <json>" for periodic FPS updates
      - Accepts commands via stdin

    """, stderr)
}

func main() {
    var udid: String?
    var fps: Int = 60
    var quality: Float = 0.7
    var port: UInt16 = 0

    Logger.info("Parsing command line arguments...")

    var args = CommandLine.arguments.dropFirst()
    while let arg = args.popFirst() {
        switch arg {
        case "--udid":
            udid = args.popFirst()
            Logger.debug("UDID: \(udid ?? "nil")")
        case "--fps":
            if let val = args.popFirst(), let intVal = Int(val) {
                fps = min(120, max(1, intVal))
                Logger.debug("FPS: \(fps)")
            }
        case "--quality":
            if let val = args.popFirst(), let fltVal = Float(val) {
                quality = min(1.0, max(0.1, fltVal))
                Logger.debug("Quality: \(quality)")
            }
        case "--port":
            if let val = args.popFirst(), let portVal = UInt16(val) {
                port = portVal
                Logger.debug("Port: \(port)")
            }
        case "--help", "-h":
            printUsage()
            exit(0)
        default:
            Logger.warn("Unknown argument: \(arg)")
        }
    }

    guard let udid = udid else {
        Logger.error("--udid is required")
        printUsage()
        exit(1)
    }

    Logger.info("Starting simulator-server")
    Logger.info("  UDID: \(udid)")
    Logger.info("  FPS: \(fps)")
    Logger.info("  Quality: \(quality)")
    Logger.info("  Port: \(port == 0 ? "auto" : String(port))")

    // Initialize CoreSimulator bridge
    Logger.info("Initializing CoreSimulator bridge...")
    let bridge = CoreSimulatorBridge(udid: udid)

    // Initialize HTTP server
    Logger.info("Initializing HTTP server...")
    let httpServer = HTTPServer(port: port)
    guard let boundPort = httpServer.start() else {
        Logger.error("Failed to start HTTP server")
        exit(1)
    }

    let streamURL = "http://127.0.0.1:\(boundPort)/stream.mjpeg"
    Logger.info("HTTP server started on port \(boundPort)")
    Logger.info("Stream URL: \(streamURL)")

    // Initialize touch handler
    Logger.info("Initializing touch handler...")
    var touchHandler: TouchHandler?
    let th = TouchHandler(udid: udid)
    if th.start() {
        touchHandler = th
        Logger.info("Touch handler started successfully")
    } else {
        Logger.warn("Touch handler failed to start - touch events will not work")
    }

    // Initialize command handler
    Logger.info("Initializing command handler...")
    let commandHandler = CommandHandler()

    // State for streaming
    var frameCount: UInt64 = 0
    var encodedFrameCount: UInt64 = 0
    let startTime = CFAbsoluteTimeGetCurrent()
    var lastFrameTime = startTime
    var lastFPSReportTime = startTime
    let frameInterval = 1.0 / Double(fps)

    var fpsReporting = false

    // Start command handler
    Logger.info("Starting command handler...")
    commandHandler.start { command in
        switch command {
        case .rotate(let rotation):
            Logger.info("Command received: rotate \(rotation)")
        case .touch(let type, let points):
            Logger.debug("Command received: touch \(type.rawValue) at \(points)")
            touchHandler?.sendTouch(type: type, points: points)
        case .button(let button, let direction):
            Logger.info("Command received: \(button.rawValue) button \(direction.rawValue)")
        case .key(let code, let direction):
            Logger.debug("Command received: key \(code) \(direction.rawValue)")
        case .fps(let enabled):
            Logger.info("Command received: fps reporting \(enabled ? "enabled" : "disabled")")
            fpsReporting = enabled
        case .shutdown:
            Logger.info("Command received: shutdown")
            exit(0)
        case .unknown:
            Logger.warn("Command received: unknown")
        }
    }

    // Initialize encoder once with initial surface size
    var encoder: JPEGEncoder?

    // Start monitoring simulator surface
    Logger.info("Starting CoreSimulator bridge...")
    let bridgeStarted = bridge.start { surface in
        guard let surface = surface else {
            Logger.warn("Received nil surface from bridge")
            return
        }

        // Encode JPEG and submit to HTTP server
        let width = IOSurfaceGetWidth(surface)
        let height = IOSurfaceGetHeight(surface)

        // Create encoder on first surface, or recreate if dimensions change
        if encoder == nil {
            Logger.info("Creating JPEG encoder: \(width)x\(height), quality=\(quality)")
            encoder = JPEGEncoder(width: width, height: height, quality: quality)
        } else if encoder?.width != width || encoder?.height != height {
            Logger.info("Recreating JPEG encoder due to size change: \(width)x\(height)")
            encoder = JPEGEncoder(width: width, height: height, quality: quality)
        }

        if let encoder = encoder,
           let pixelBuffer = createPixelBuffer(from: surface),
           let jpegData = encoder.encode(pixelBuffer) {
            encodedFrameCount += 1
            httpServer.submitFrame(jpegData)

            // Log every 60 frames
            if encodedFrameCount % 60 == 0 {
                Logger.debug("Encoded frame \(encodedFrameCount), size: \(jpegData.count) bytes")
            }
        } else {
            Logger.warn("Failed to encode frame")
        }
    }

    guard bridgeStarted else {
        Logger.error("Failed to start CoreSimulator bridge")
        exit(1)
    }

    Logger.info("CoreSimulator bridge started successfully")

    // Output stream_ready with URL (this is parsed by the Rust backend)
    print("stream_ready \(streamURL)")
    fflush(stdout)
    Logger.info("Sent stream_ready signal")

    Logger.info("Entering main streaming loop...")

    // Main loop for frame timing and FPS reporting
    while true {
        // Precise frame timing using spin-wait for the last microseconds
        let targetTime = lastFrameTime + frameInterval
        while CFAbsoluteTimeGetCurrent() < targetTime - 0.001 {
            usleep(500) // 0.5ms sleep
        }
        while CFAbsoluteTimeGetCurrent() < targetTime {
            // Spin-wait for precise timing
        }
        lastFrameTime = targetTime
        frameCount += 1

        // Report FPS periodically
        if fpsReporting && CFAbsoluteTimeGetCurrent() - lastFPSReportTime >= 1.0 {
            let elapsed = CFAbsoluteTimeGetCurrent() - startTime
            let actualFps = Double(frameCount) / elapsed
            let fpsReport = """
            {
              "frame_count": \(frameCount),
              "encoded_frames": \(encodedFrameCount),
              "fps": \(String(format: "%.1f", actualFps)),
              "elapsed": \(String(format: "%.2f", elapsed))
            }
            """
            print("fps_report \(fpsReport)")
            fflush(stdout)
            lastFPSReportTime = CFAbsoluteTimeGetCurrent()
        }

        // Debug output periodically (every second at target fps)
        if frameCount % UInt64(fps) == 0 {
            let elapsed = CFAbsoluteTimeGetCurrent() - startTime
            let actualFps = Double(frameCount) / elapsed
            let encodedFps = Double(encodedFrameCount) / elapsed
            Logger.debug("Stats: frames=\(frameCount), encoded=\(encodedFrameCount), fps=\(String(format: "%.1f", actualFps)), encoded_fps=\(String(format: "%.1f", encodedFps))")
        }
    }
}

main()
