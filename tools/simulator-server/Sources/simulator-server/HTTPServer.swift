import Foundation

// MARK: - HTTP Server

class HTTPServer {
    private let port: UInt16
    private var socket: Int32 = -1
    private let frameQueue = DispatchQueue(label: "com.simulator-server.http-frames", qos: .userInteractive)
    private var frameBuffer = CircularFrameBuffer(capacity: 5)
    
    typealias FrameData = (jpegData: Data, timestamp: TimeInterval)
    
    init(port: UInt16 = 0) {
        self.port = port
    }
    
    func start() -> UInt16? {
        var serverAddr = sockaddr_in()
        serverAddr.sin_family = UInt8(AF_INET)
        serverAddr.sin_port = in_port_t(port).bigEndian
        serverAddr.sin_addr.s_addr = inet_addr("127.0.0.1")
        
        socket = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard socket >= 0 else {
            fputs("Error: Cannot create socket\n", stderr)
            return nil
        }
        
        var reuseAddr: Int32 = 1
        if setsockopt(socket, SOL_SOCKET, SO_REUSEADDR, &reuseAddr, socklen_t(MemoryLayout<Int32>.size)) < 0 {
            fputs("Error: Cannot set SO_REUSEADDR\n", stderr)
            Darwin.close(socket)
            return nil
        }
        
        let bindResult = withUnsafePointer(to: &serverAddr) { ptr in
            Darwin.bind(socket, UnsafeRawPointer(ptr).assumingMemoryBound(to: sockaddr.self), socklen_t(MemoryLayout<sockaddr_in>.size))
        }
        
        guard bindResult == 0 else {
            fputs("Error: Cannot bind socket: \(errno)\n", stderr)
            Darwin.close(socket)
            return nil
        }
        
        guard Darwin.listen(socket, 128) == 0 else {
            fputs("Error: Cannot listen on socket\n", stderr)
            Darwin.close(socket)
            return nil
        }
        
        var actualAddr = sockaddr_in()
        var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        
        if withUnsafeMutablePointer(to: &actualAddr, { ptr in
            Darwin.getsockname(socket, UnsafeMutableRawPointer(ptr).assumingMemoryBound(to: sockaddr.self), &addrLen)
        }) != 0 {
            fputs("Error: Cannot get socket name\n", stderr)
            Darwin.close(socket)
            return nil
        }
        
        let boundPort = UInt16(bigEndian: actualAddr.sin_port)
        fputs("HTTP server listening on 127.0.0.1:\(boundPort)\n", stderr)
        
        // Start accepting connections in background
        DispatchQueue.global().async { [weak self] in
            self?.acceptConnections()
        }
        
        return boundPort
    }
    
    func submitFrame(_ jpegData: Data) {
        frameQueue.async { [weak self] in
            self?.frameBuffer.append(jpegData: jpegData, timestamp: CFAbsoluteTimeGetCurrent())
        }
    }
    
    func stop() {
        if socket >= 0 {
            Darwin.close(socket)
            socket = -1
        }
    }
    
    // MARK: - Private
    
    private func acceptConnections() {
        while true {
            var clientAddr = sockaddr_in()
            var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
            
            let clientSocket = withUnsafeMutablePointer(to: &clientAddr) { ptr in
                Darwin.accept(socket, UnsafeMutableRawPointer(ptr).assumingMemoryBound(to: sockaddr.self), &addrLen)
            }
            
            guard clientSocket >= 0 else { continue }
            
            DispatchQueue.global().async { [weak self] in
                self?.handleClient(clientSocket)
            }
        }
    }
    
    private func handleClient(_ clientSocket: Int32) {
        defer { Darwin.close(clientSocket) }
        
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
        defer { buffer.deallocate() }
        
        // Read HTTP request (and discard)
        let bytesRead = Darwin.read(clientSocket, buffer, 4096)
        _ = bytesRead // Suppress unused variable warning
        
        // Send HTTP response header
        let responseHeader = "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=--mjpegstream\r\nConnection: close\r\n\r\n"
        _ = responseHeader.withCString { cstr in
            Darwin.write(clientSocket, cstr, strlen(cstr))
        }
        
        // Stream frames to client
        let frameBufferSnapshot = frameQueue.sync { frameBuffer.getAllFrames() }
        
        for frame in frameBufferSnapshot {
            let frameData = writeMJPEGFrame(frame.jpegData)
            _ = frameData.withUnsafeBytes { ptr in
                Darwin.write(clientSocket, ptr.baseAddress, frameData.count)
            }
        }
        
        // Keep streaming new frames
        while true {
            let newFrames = frameQueue.sync { frameBuffer.getNewFrames() }
            
            guard !newFrames.isEmpty else {
                usleep(1000) // 1ms sleep to avoid busy waiting
                continue
            }
            
            for frame in newFrames {
                let frameData = writeMJPEGFrame(frame.jpegData)
                let writeResult = frameData.withUnsafeBytes { ptr in
                    Darwin.write(clientSocket, ptr.baseAddress, frameData.count)
                }
                
                if writeResult < 0 {
                    // Client disconnected
                    return
                }
            }
        }
    }
    
    private func writeMJPEGFrame(_ jpegData: Data) -> Data {
        let boundary = "--mjpegstream"
        let contentLength = jpegData.count
        
        var result = Data()
        
        // Write boundary and headers
        let headerString = "\(boundary)\r\nContent-Type: image/jpeg\r\nContent-Length: \(contentLength)\r\n\r\n"
        result.append(headerString.data(using: .utf8)!)
        
        // Write JPEG data
        result.append(jpegData)
        
        // Write trailing CRLF
        result.append("\r\n".data(using: .utf8)!)
        
        return result
    }
}

// MARK: - Circular Frame Buffer

class CircularFrameBuffer {
    private let capacity: Int
    private var frames: [(jpegData: Data, timestamp: TimeInterval)] = []
    private var readIndex: Int = 0
    private let lock = NSLock()
    
    init(capacity: Int) {
        self.capacity = capacity
    }
    
    func append(jpegData: Data, timestamp: TimeInterval) {
        lock.lock()
        defer { lock.unlock() }
        
        frames.append((jpegData, timestamp))
        if frames.count > capacity {
            frames.removeFirst()
        }
    }
    
    func getAllFrames() -> [(jpegData: Data, timestamp: TimeInterval)] {
        lock.lock()
        defer { lock.unlock() }
        
        readIndex = frames.count
        return frames
    }
    
    func getNewFrames() -> [(jpegData: Data, timestamp: TimeInterval)] {
        lock.lock()
        defer { lock.unlock() }
        
        if readIndex >= frames.count {
            return []
        }
        
        let newFrames = Array(frames[readIndex...])
        readIndex = frames.count
        return newFrames
    }
}
