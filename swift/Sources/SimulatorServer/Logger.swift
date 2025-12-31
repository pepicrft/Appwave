import Foundation

/// Simple logger that writes to stderr with timestamps
enum Logger {
    static func debug(_ message: String, file: String = #file, line: Int = #line) {
        log("DEBUG", message, file: file, line: line)
    }

    static func info(_ message: String, file: String = #file, line: Int = #line) {
        log("INFO", message, file: file, line: line)
    }

    static func warn(_ message: String, file: String = #file, line: Int = #line) {
        log("WARN", message, file: file, line: line)
    }

    static func error(_ message: String, file: String = #file, line: Int = #line) {
        log("ERROR", message, file: file, line: line)
    }

    private static func log(_ level: String, _ message: String, file: String, line: Int) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let filename = (file as NSString).lastPathComponent
        let output = "[\(timestamp)] [\(level)] [\(filename):\(line)] \(message)\n"
        fputs(output, stderr)
    }
}
