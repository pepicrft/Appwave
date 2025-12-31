import Foundation
import CoreGraphics
import ImageIO
import CoreVideo
import VideoToolbox
import CoreMedia

// MARK: - Hardware-accelerated JPEG Encoder using VideoToolbox

class JPEGEncoder {
    private var compressionSession: VTCompressionSession?
    private var encodedData: Data?
    private let quality: Float
    private let semaphore = DispatchSemaphore(value: 0)
    let width: Int
    let height: Int
    private var encodeCount: UInt64 = 0
    private var hwEncodeCount: UInt64 = 0
    private var swEncodeCount: UInt64 = 0
    private var totalEncodedBytes: UInt64 = 0

    init(width: Int, height: Int, quality: Float) {
        self.width = width
        self.height = height
        self.quality = quality

        Logger.info("Creating JPEGEncoder: \(width)x\(height), quality=\(quality)")

        var session: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: Int32(width),
            height: Int32(height),
            codecType: kCMVideoCodecType_JPEG,
            encoderSpecification: [
                kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: true
            ] as CFDictionary,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: nil,
            refcon: nil,
            compressionSessionOut: &session
        )

        if status == noErr, let session = session {
            self.compressionSession = session
            VTSessionSetProperty(session, key: kVTCompressionPropertyKey_Quality, value: quality as CFNumber)
            VTCompressionSessionPrepareToEncodeFrames(session)
            Logger.info("Hardware JPEG encoder initialized successfully")
        } else {
            Logger.warn("Failed to create hardware encoder (status=\(status)), will use CoreGraphics fallback")
        }
    }

    deinit {
        if let session = compressionSession {
            VTCompressionSessionInvalidate(session)
        }
        Logger.info("JPEGEncoder destroyed (total: \(encodeCount) frames, HW: \(hwEncodeCount), SW: \(swEncodeCount), bytes: \(totalEncodedBytes))")
    }

    func encode(_ pixelBuffer: CVPixelBuffer) -> Data? {
        encodeCount += 1

        guard let session = compressionSession else {
            return encodeWithCoreGraphics(pixelBuffer)
        }

        var resultData: Data?
        let presentationTime = CMTime(value: 0, timescale: 1)

        let status = VTCompressionSessionEncodeFrame(
            session,
            imageBuffer: pixelBuffer,
            presentationTimeStamp: presentationTime,
            duration: .invalid,
            frameProperties: nil,
            infoFlagsOut: nil
        ) { [weak self] status, _, sampleBuffer in
            guard status == noErr, let sampleBuffer = sampleBuffer else {
                Logger.warn("Hardware encode callback failed: status=\(status)")
                return
            }

            if let dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) {
                var length = 0
                var dataPointer: UnsafeMutablePointer<Int8>?
                CMBlockBufferGetDataPointer(dataBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer)

                if let dataPointer = dataPointer {
                    resultData = Data(bytes: dataPointer, count: length)
                }
            }
            self?.semaphore.signal()
        }

        if status == noErr {
            _ = semaphore.wait(timeout: .now() + 0.1)
            if let data = resultData {
                hwEncodeCount += 1
                totalEncodedBytes += UInt64(data.count)

                // Log every 60 frames
                if hwEncodeCount % 60 == 0 {
                    Logger.debug("HW encoded frame #\(hwEncodeCount): \(data.count) bytes")
                }
                return data
            }
        }

        Logger.debug("Hardware encode failed (status=\(status)), falling back to CoreGraphics")
        return encodeWithCoreGraphics(pixelBuffer)
    }

    private func encodeWithCoreGraphics(_ pixelBuffer: CVPixelBuffer) -> Data? {
        swEncodeCount += 1

        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer)

        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
        guard let context = CGContext(
            data: baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else {
            Logger.error("Failed to create CGContext for CoreGraphics encoding")
            return nil
        }

        guard let cgImage = context.makeImage() else {
            Logger.error("Failed to create CGImage from context")
            return nil
        }

        let mutableData = CFDataCreateMutable(nil, 0)!
        guard let destination = CGImageDestinationCreateWithData(mutableData, "public.jpeg" as CFString, 1, nil) else {
            Logger.error("Failed to create image destination")
            return nil
        }

        let options: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: quality
        ]
        CGImageDestinationAddImage(destination, cgImage, options as CFDictionary)

        guard CGImageDestinationFinalize(destination) else {
            Logger.error("Failed to finalize image destination")
            return nil
        }

        let data = mutableData as Data
        totalEncodedBytes += UInt64(data.count)

        // Log every 60 software encodes
        if swEncodeCount % 60 == 0 {
            Logger.debug("SW encoded frame #\(swEncodeCount): \(data.count) bytes (\(width)x\(height))")
        }

        return data
    }
}

// MARK: - IOSurface to CVPixelBuffer

func createPixelBuffer(from surface: IOSurface) -> CVPixelBuffer? {
    var pixelBuffer: Unmanaged<CVPixelBuffer>?
    let status = CVPixelBufferCreateWithIOSurface(
        kCFAllocatorDefault,
        surface,
        nil,
        &pixelBuffer
    )
    return status == kCVReturnSuccess ? pixelBuffer?.takeRetainedValue() : nil
}
