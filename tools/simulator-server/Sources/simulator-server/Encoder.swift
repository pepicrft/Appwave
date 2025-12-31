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

    init(width: Int, height: Int, quality: Float) {
        self.width = width
        self.height = height
        self.quality = quality

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
        }
    }

    deinit {
        if let session = compressionSession {
            VTCompressionSessionInvalidate(session)
        }
    }

    func encode(_ pixelBuffer: CVPixelBuffer) -> Data? {
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
            guard status == noErr, let sampleBuffer = sampleBuffer else { return }

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
            return resultData
        }

        return encodeWithCoreGraphics(pixelBuffer)
    }

    private func encodeWithCoreGraphics(_ pixelBuffer: CVPixelBuffer) -> Data? {
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
            return nil
        }

        guard let cgImage = context.makeImage() else {
            return nil
        }

        let mutableData = CFDataCreateMutable(nil, 0)!
        guard let destination = CGImageDestinationCreateWithData(mutableData, "public.jpeg" as CFString, 1, nil) else {
            return nil
        }

        let options: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: quality
        ]
        CGImageDestinationAddImage(destination, cgImage, options as CFDictionary)

        guard CGImageDestinationFinalize(destination) else {
            return nil
        }

        return mutableData as Data
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
