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

    var args = CommandLine.arguments.dropFirst()
    while let arg = args.popFirst() {
        switch arg {
        case "--udid":
            udid = args.popFirst()
        case "--fps":
            if let val = args.popFirst(), let intVal = Int(val) {
                fps = min(120, max(1, intVal))
            }
        case "--quality":
            if let val = args.popFirst(), let fltVal = Float(val) {
                quality = min(1.0, max(0.1, fltVal))
            }
        case "--port":
            if let val = args.popFirst(), let portVal = UInt16(val) {
                port = portVal
            }
        case "--help", "-h":
            printUsage()
            exit(0)
        default:
            break
        }
    }

    guard let udid = udid else {
        fputs("Error: --udid is required\n", stderr)
        printUsage()
        exit(1)
    }

    fputs("Starting simulator-server for \(udid)\n", stderr)
    fputs("FPS: \(fps), Quality: \(quality)\n", stderr)

    // Initialize CoreSimulator bridge
    let bridge = CoreSimulatorBridge(udid: udid)
    
    // Initialize HTTP server
    let httpServer = HTTPServer(port: port)
    guard let boundPort = httpServer.start() else {
        fputs("Error: Failed to start HTTP server\n", stderr)
        exit(1)
    }
    
    let streamURL = "http://127.0.0.1:\(boundPort)/stream.mjpeg"
    
    // Initialize command handler
    let commandHandler = CommandHandler()
    
    // State for streaming
    var frameCount: UInt64 = 0
    let startTime = CFAbsoluteTimeGetCurrent()
    var lastFrameTime = startTime
    var lastFPSReportTime = startTime
    let frameInterval = 1.0 / Double(fps)
    
    var fpsReporting = false
    
    // Start command handler
    commandHandler.start { command in
        switch command {
        case .rotate(let rotation):
            fputs("Command: rotate \(rotation)\n", stderr)
        case .touch(let type, let points):
            fputs("Command: touch \(type.rawValue) at \(points)\n", stderr)
        case .button(let button, let direction):
            fputs("Command: \(button.rawValue) button \(direction.rawValue)\n", stderr)
        case .key(let code, let direction):
            fputs("Command: key \(code) \(direction.rawValue)\n", stderr)
        case .fps(let enabled):
            fputs("Command: fps reporting \(enabled ? "enabled" : "disabled")\n", stderr)
            fpsReporting = enabled
        case .shutdown:
            fputs("Command: shutdown\n", stderr)
            exit(0)
        case .unknown:
            fputs("Command: unknown\n", stderr)
        }
    }
    
    // Initialize encoder once with initial surface size
    var encoder: JPEGEncoder?
    
    // Start monitoring simulator surface
    let bridgeStarted = bridge.start { surface in
        guard let surface = surface else { return }
        
        // Encode JPEG and submit to HTTP server
        let width = IOSurfaceGetWidth(surface)
        let height = IOSurfaceGetHeight(surface)
        
        // Create encoder on first surface, or recreate if dimensions change
        if encoder == nil || encoder?.width != width || encoder?.height != height {
            encoder = JPEGEncoder(width: width, height: height, quality: quality)
        }
        
        if let encoder = encoder,
           let pixelBuffer = createPixelBuffer(from: surface),
           let jpegData = encoder.encode(pixelBuffer) {
            httpServer.submitFrame(jpegData)
        }
    }
    
    guard bridgeStarted else {
        fputs("Error: Failed to start CoreSimulator bridge\n", stderr)
        exit(1)
    }
    
    // Output stream_ready with URL
    print("stream_ready \(streamURL)")
    fflush(stdout)
    
    fputs("Streaming started...\n", stderr)
    
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
              "fps": \(String(format: "%.1f", actualFps)),
              "elapsed": \(String(format: "%.2f", elapsed))
            }
            """
            print("fps_report \(fpsReport)")
            fflush(stdout)
            lastFPSReportTime = CFAbsoluteTimeGetCurrent()
        }
        
        // Debug output periodically
        if frameCount % UInt64(fps) == 0 {
            let elapsed = CFAbsoluteTimeGetCurrent() - startTime
            let actualFps = Double(frameCount) / elapsed
            fputs("Frames: \(frameCount), FPS: \(String(format: "%.1f", actualFps))\n", stderr)
        }
    }
}

main()
