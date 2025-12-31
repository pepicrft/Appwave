import Foundation
import Darwin

// MARK: - Command Handler

class CommandHandler {
    typealias CommandCallback = (Command) -> Void

    enum Command {
        case rotate(String)
        case touch(TouchType, [(Double, Double)])
        case button(ButtonType, Direction)
        case key(Int, Direction)
        case fps(Bool)
        case shutdown
        case unknown
    }

    enum TouchType: String {
        case began = "began"
        case moved = "moved"
        case ended = "ended"
    }

    enum ButtonType: String {
        case home = "home"
        case lock = "lock"
        case sideButton = "side"
    }

    enum Direction: String {
        case down = "down"
        case up = "up"
    }

    private let commandQueue = DispatchQueue(label: "com.simulator-server.commands")
    private var callback: CommandCallback?
    private var commandCount: UInt64 = 0

    init() {
        Logger.debug("CommandHandler initialized")
    }

    func start(callback: @escaping CommandCallback) {
        self.callback = callback
        Logger.info("CommandHandler started, listening on stdin")

        // Read commands from stdin in background
        commandQueue.async { [weak self] in
            self?.readCommands()
        }
    }

    private func readCommands() {
        let fileHandle = FileHandle.standardInput
        Logger.debug("Command reader loop started")

        while true {
            if let line = fileHandle.readLineString() {
                commandCount += 1
                Logger.debug("Received command #\(commandCount): '\(line)'")
                let command = parseCommand(line)
                callback?(command)
            } else {
                Logger.info("stdin closed, stopping command reader (total commands: \(commandCount))")
                break
            }
        }
    }
    
    private func parseCommand(_ line: String) -> Command {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return .unknown }
        
        let parts = trimmed.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true).map(String.init)
        guard let command = parts.first else { return .unknown }
        
        switch command {
        case "rotate":
            if parts.count > 1 {
                return .rotate(parts[1])
            }
            return .unknown
            
        case "touch":
            if parts.count > 1 {
                let args = parts[1]
                let components = args.split(separator: ",", omittingEmptySubsequences: true).map(String.init)
                
                guard components.count >= 3 else { return .unknown }
                
                if let touchType = TouchType(rawValue: components[0]) {
                    var points: [(Double, Double)] = []
                    for i in stride(from: 1, to: components.count - 1, by: 2) {
                        if let x = Double(components[i]),
                           let y = Double(components[i + 1]) {
                            points.append((x, y))
                        }
                    }
                    
                    if !points.isEmpty {
                        return .touch(touchType, points)
                    }
                }
            }
            return .unknown
            
        case "button":
            if parts.count > 1 {
                let args = parts[1]
                let components = args.split(separator: ",", omittingEmptySubsequences: true).map(String.init)
                
                guard components.count == 2 else { return .unknown }
                
                if let buttonType = ButtonType(rawValue: components[0]),
                   let direction = Direction(rawValue: components[1]) {
                    return .button(buttonType, direction)
                }
            }
            return .unknown
            
        case "key":
            if parts.count > 1 {
                let args = parts[1]
                let components = args.split(separator: ",", omittingEmptySubsequences: true).map(String.init)
                
                guard components.count == 2 else { return .unknown }
                
                if let keyCode = Int(components[0]),
                   let direction = Direction(rawValue: components[1]) {
                    return .key(keyCode, direction)
                }
            }
            return .unknown
            
        case "fps":
            if parts.count > 1 {
                return .fps(parts[1].lowercased() == "true")
            }
            return .unknown
            
        case "shutdown":
            return .shutdown
            
        default:
            return .unknown
        }
    }
}

// MARK: - FileHandle Extension

extension FileHandle {
    func readLineString() -> String? {
        guard let data = try? readLineData() else { return nil }
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .newlines)
    }
    
    private func readLineData() throws -> Data? {
        var lineData = Data()
        
        while true {
            let byte = try readByte()
            guard byte >= 0 else { return lineData.isEmpty ? nil : lineData }
            
            lineData.append(UInt8(byte))
            if byte == UInt8(ascii: "\n") {
                return lineData
            }
        }
    }
    
    private func readByte() throws -> Int {
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 1)
        defer { buffer.deallocate() }
        
        let bytesRead = Darwin.read(STDIN_FILENO, buffer, 1)
        return bytesRead > 0 ? Int(buffer[0]) : -1
    }
}
