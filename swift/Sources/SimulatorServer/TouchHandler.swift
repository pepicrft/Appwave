import Foundation

// MARK: - Indigo HID Structures (from FBSimulatorControl)

/// Mach message header
struct IndigoMessageHeader {
    var msgh_bits: UInt32
    var msgh_size: UInt32
    var msgh_remote_port: UInt32
    var msgh_local_port: UInt32
    var msgh_voucher_port: UInt32
    var msgh_id: Int32
}

/// Touch event payload - matches FBSimulatorControl's IndigoTouch
struct IndigoTouch {
    var field1: UInt32      // 0x00400002 for touch
    var field2: UInt32      // 0x1
    var field3: UInt32      // 0x3
    var xRatio: Double      // 0.0 to 1.0
    var yRatio: Double      // 0.0 to 1.0
    var field6: Double      // 0
    var field7: Double      // 0
    var field8: Double      // 0
    var field9: UInt32      // 1 for down, 0 for up
    var field10: UInt32     // 1 for down, 0 for up
    var field11: UInt32     // 0x32
    var field12: UInt32     // 0x1
    var field13: UInt32     // 0x2
    var field14: Double     // 0
    var field15: Double     // 0
    var field16: Double     // 0
    var field17: Double     // 0
    var field18: Double     // 0
}

/// Button event payload
struct IndigoButton {
    var eventSource: UInt32
    var eventType: UInt32
    var eventTarget: UInt32
    var keyCode: UInt32
    var field5: UInt32
}

/// Union wrapper for event types
struct IndigoEventUnion {
    var touch: IndigoTouch
}

/// Payload embedded in message
struct IndigoPayload {
    var field1: UInt32
    var timestamp: UInt64
    var field3: UInt32
    var event: IndigoEventUnion
}

/// Complete Indigo message - size should be 320 bytes for touch
struct IndigoMessage {
    var header: IndigoMessageHeader
    var innerSize: UInt32
    var eventType: UInt8
    var padding: (UInt8, UInt8, UInt8)
    var payload: IndigoPayload
}

// Event type constants
let IndigoEventTypeButton: UInt8 = 1
let IndigoEventTypeTouch: UInt8 = 2

// MARK: - Touch Handler

/// Handles sending touch events to the iOS Simulator using SimulatorKit
class TouchHandler {
    private let udid: String
    private var device: NSObject?
    private var hidClient: NSObject?
    private let queue = DispatchQueue(label: "com.plasma.touch", qos: .userInteractive)

    // Screen properties for coordinate conversion
    private var screenSize: CGSize = CGSize(width: 390, height: 844) // Default iPhone 15 size
    private var screenScale: Float = 3.0

    init(udid: String) {
        self.udid = udid
        Logger.debug("TouchHandler created for UDID: \(udid)")
    }

    /// Start the touch handler - loads frameworks and creates HID client
    func start() -> Bool {
        // 1. Load CoreSimulator framework
        guard loadCoreSimulatorFramework() else {
            Logger.error("TouchHandler: Failed to load CoreSimulator framework")
            return false
        }

        // 2. Load SimulatorKit framework (this contains SimDeviceLegacyHIDClient)
        guard loadSimulatorKitFramework() else {
            Logger.error("TouchHandler: Failed to load SimulatorKit framework")
            return false
        }

        // 3. Get the SimDevice
        guard let simDevice = getSimDevice(udid: udid) else {
            Logger.error("TouchHandler: Failed to get SimDevice for UDID: \(udid)")
            return false
        }
        self.device = simDevice

        // 4. Get screen size and scale from device type
        if let deviceType = getDeviceType(from: simDevice) {
            if let size = getMainScreenSize(from: deviceType) {
                self.screenSize = size
                Logger.info("TouchHandler: Screen size: \(size.width)x\(size.height)")
            }
            if let scale = getMainScreenScale(from: deviceType) {
                self.screenScale = scale
                Logger.info("TouchHandler: Screen scale: \(scale)")
            }
        }

        // 5. Create the HID client from SimulatorKit
        guard let client = createHIDClient(device: simDevice) else {
            Logger.error("TouchHandler: Failed to create HID client")
            return false
        }
        self.hidClient = client

        Logger.info("TouchHandler: Started successfully for \(udid)")
        return true
    }

    /// Send a touch event
    func sendTouch(type: CommandHandler.TouchType, points: [(Double, Double)]) {
        guard let client = hidClient else {
            Logger.warn("TouchHandler: No HID client available")
            return
        }

        queue.async { [weak self] in
            guard let self = self else { return }
            for (x, y) in points {
                self.sendTouchEvent(client: client, x: x, y: y, touchType: type)
            }
        }
    }

    // MARK: - Private: Framework Loading

    private func loadCoreSimulatorFramework() -> Bool {
        let path = "/Library/Developer/PrivateFrameworks/CoreSimulator.framework"
        guard let bundle = Bundle(path: path) else {
            Logger.error("TouchHandler: Cannot find CoreSimulator.framework at \(path)")
            return false
        }

        if bundle.isLoaded {
            Logger.debug("TouchHandler: CoreSimulator.framework already loaded")
            return true
        }

        guard bundle.load() else {
            Logger.error("TouchHandler: Failed to load CoreSimulator.framework")
            return false
        }

        Logger.debug("TouchHandler: Loaded CoreSimulator.framework")
        return true
    }

    private func loadSimulatorKitFramework() -> Bool {
        // SimulatorKit is inside Xcode
        let xcodePath = "/Applications/Xcode.app/Contents/Developer"
        let path = "\(xcodePath)/Library/PrivateFrameworks/SimulatorKit.framework"

        guard let bundle = Bundle(path: path) else {
            Logger.error("TouchHandler: Cannot find SimulatorKit.framework at \(path)")
            return false
        }

        if bundle.isLoaded {
            Logger.debug("TouchHandler: SimulatorKit.framework already loaded")
            return true
        }

        guard bundle.load() else {
            Logger.error("TouchHandler: Failed to load SimulatorKit.framework")
            return false
        }

        Logger.debug("TouchHandler: Loaded SimulatorKit.framework")
        return true
    }

    // MARK: - Private: SimDevice Access

    private func getSimDevice(udid: String) -> NSObject? {
        guard let contextClass = NSClassFromString("SimServiceContext") as? NSObject.Type else {
            Logger.error("TouchHandler: SimServiceContext class not found")
            return nil
        }

        let sharedSelector = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
        guard contextClass.responds(to: sharedSelector) else {
            Logger.error("TouchHandler: sharedServiceContextForDeveloperDir:error: not found")
            return nil
        }

        let developerDir = "/Applications/Xcode.app/Contents/Developer" as NSString

        typealias SharedContextMethod = @convention(c) (AnyClass, Selector, NSString, AutoreleasingUnsafeMutablePointer<NSError?>?) -> AnyObject?
        let sharedContextImp = unsafeBitCast(contextClass.method(for: sharedSelector), to: SharedContextMethod.self)

        var error: NSError?
        guard let context = sharedContextImp(contextClass, sharedSelector, developerDir, &error) as? NSObject else {
            Logger.error("TouchHandler: Cannot get SimServiceContext: \(error?.localizedDescription ?? "unknown")")
            return nil
        }

        let deviceSetSelector = NSSelectorFromString("defaultDeviceSetWithError:")
        guard context.responds(to: deviceSetSelector) else {
            Logger.error("TouchHandler: defaultDeviceSetWithError: not found")
            return nil
        }

        typealias DeviceSetMethod = @convention(c) (AnyObject, Selector, AutoreleasingUnsafeMutablePointer<NSError?>?) -> AnyObject?
        let deviceSetImp = unsafeBitCast(type(of: context).instanceMethod(for: deviceSetSelector)!, to: DeviceSetMethod.self)

        guard let deviceSet = deviceSetImp(context, deviceSetSelector, &error) as? NSObject else {
            Logger.error("TouchHandler: Cannot get device set: \(error?.localizedDescription ?? "unknown")")
            return nil
        }

        let devicesSelector = NSSelectorFromString("devices")
        guard deviceSet.responds(to: devicesSelector),
              let devices = deviceSet.perform(devicesSelector)?.takeUnretainedValue() as? [AnyObject] else {
            Logger.error("TouchHandler: Cannot get devices")
            return nil
        }

        let targetUUID = UUID(uuidString: udid)
        for device in devices {
            let udidSelector = NSSelectorFromString("UDID")
            if device.responds(to: udidSelector),
               let deviceUUID = device.perform(udidSelector)?.takeUnretainedValue() as? UUID,
               deviceUUID == targetUUID {
                return device as? NSObject
            }
        }

        Logger.error("TouchHandler: Device with UDID \(udid) not found")
        return nil
    }

    private func getDeviceType(from device: NSObject) -> NSObject? {
        let selector = NSSelectorFromString("deviceType")
        guard device.responds(to: selector),
              let result = device.perform(selector)?.takeUnretainedValue() as? NSObject else {
            return nil
        }
        return result
    }

    private func getMainScreenSize(from deviceType: NSObject) -> CGSize? {
        let selector = NSSelectorFromString("mainScreenSize")
        guard deviceType.responds(to: selector) else { return nil }

        // mainScreenSize returns a CGSize
        typealias ScreenSizeMethod = @convention(c) (AnyObject, Selector) -> CGSize
        let imp = unsafeBitCast(type(of: deviceType).instanceMethod(for: selector)!, to: ScreenSizeMethod.self)
        return imp(deviceType, selector)
    }

    private func getMainScreenScale(from deviceType: NSObject) -> Float? {
        let selector = NSSelectorFromString("mainScreenScale")
        guard deviceType.responds(to: selector) else { return nil }

        typealias ScreenScaleMethod = @convention(c) (AnyObject, Selector) -> Float
        let imp = unsafeBitCast(type(of: deviceType).instanceMethod(for: selector)!, to: ScreenScaleMethod.self)
        return imp(deviceType, selector)
    }

    // MARK: - Private: HID Client Creation

    private func createHIDClient(device: NSObject) -> NSObject? {
        // SimDeviceLegacyHIDClient is in SimulatorKit, not CoreSimulator!
        // The class name in the runtime is "SimulatorKit.SimDeviceLegacyHIDClient"
        let className = "SimDeviceLegacyHIDClient"

        guard let clientClass = NSClassFromString(className) else {
            // Try with module prefix
            guard let clientClassWithPrefix = NSClassFromString("SimulatorKit.\(className)") else {
                Logger.error("TouchHandler: \(className) class not found in runtime")
                return nil
            }
            return initializeHIDClient(clientClass: clientClassWithPrefix, device: device)
        }

        return initializeHIDClient(clientClass: clientClass, device: device)
    }

    private func initializeHIDClient(clientClass: AnyClass, device: NSObject) -> NSObject? {
        // Allocate instance
        let allocSelector = NSSelectorFromString("alloc")
        guard let allocResult = (clientClass as AnyObject).perform(allocSelector),
              let allocatedClient = allocResult.takeUnretainedValue() as? NSObject else {
            Logger.error("TouchHandler: Failed to alloc HID client")
            return nil
        }

        // Initialize with device
        var error: NSError?
        let initSelector = NSSelectorFromString("initWithDevice:error:")

        guard allocatedClient.responds(to: initSelector) else {
            Logger.error("TouchHandler: initWithDevice:error: not found on HID client")
            return nil
        }

        typealias InitMethod = @convention(c) (AnyObject, Selector, AnyObject, AutoreleasingUnsafeMutablePointer<NSError?>?) -> AnyObject?
        let imp = type(of: allocatedClient).instanceMethod(for: initSelector)!
        let initFunc = unsafeBitCast(imp, to: InitMethod.self)

        if let initializedClient = initFunc(allocatedClient, initSelector, device, &error) {
            Logger.info("TouchHandler: HID client created successfully")
            return initializedClient as? NSObject
        } else {
            Logger.error("TouchHandler: Failed to init HID client: \(error?.localizedDescription ?? "unknown")")
            return nil
        }
    }

    // MARK: - Private: Touch Event Sending

    private func sendTouchEvent(client: NSObject, x: Double, y: Double, touchType: CommandHandler.TouchType) {
        // Create the touch message (320 bytes)
        let messageSize = MemoryLayout<IndigoMessage>.size + MemoryLayout<IndigoPayload>.size
        let messagePtr = UnsafeMutableRawPointer.allocate(byteCount: messageSize, alignment: 8)

        // Zero the memory
        memset(messagePtr, 0, messageSize)

        // Cast to IndigoMessage
        let message = messagePtr.bindMemory(to: IndigoMessage.self, capacity: 1)

        // Set message metadata
        message.pointee.innerSize = UInt32(MemoryLayout<IndigoPayload>.size)
        message.pointee.eventType = IndigoEventTypeTouch

        // Set payload
        message.pointee.payload.field1 = 0x0000000b
        message.pointee.payload.timestamp = mach_absolute_time()

        // Set touch event - coordinates are normalized 0.0-1.0
        message.pointee.payload.event.touch.field1 = 0x00400002
        message.pointee.payload.event.touch.field2 = 0x1
        message.pointee.payload.event.touch.field3 = 0x3
        message.pointee.payload.event.touch.xRatio = x
        message.pointee.payload.event.touch.yRatio = y
        message.pointee.payload.event.touch.field6 = 0
        message.pointee.payload.event.touch.field7 = 0
        message.pointee.payload.event.touch.field8 = 0

        // Set down/up based on touchType
        switch touchType {
        case .began, .moved:
            message.pointee.payload.event.touch.field9 = 1
            message.pointee.payload.event.touch.field10 = 1
        case .ended:
            message.pointee.payload.event.touch.field9 = 0
            message.pointee.payload.event.touch.field10 = 0
        }

        message.pointee.payload.event.touch.field11 = 0x32
        message.pointee.payload.event.touch.field12 = 0x1
        message.pointee.payload.event.touch.field13 = 0x2

        // Duplicate the payload (FBSimulatorControl does this)
        let stride = MemoryLayout<IndigoPayload>.size
        let secondPayloadPtr = messagePtr.advanced(by: MemoryLayout<IndigoMessage>.size - MemoryLayout<IndigoPayload>.size + stride)
        memcpy(secondPayloadPtr, &message.pointee.payload, stride)

        // Adjust second payload slightly
        let secondPayload = secondPayloadPtr.bindMemory(to: IndigoPayload.self, capacity: 1)
        secondPayload.pointee.event.touch.field1 = 0x00000001
        secondPayload.pointee.event.touch.field2 = 0x00000002

        // Send using the async method with completion
        let sendSelector = NSSelectorFromString("sendWithMessage:freeWhenDone:completionQueue:completion:")

        if client.responds(to: sendSelector) {
            // Use the full async method
            typealias SendMethod = @convention(c) (AnyObject, Selector, UnsafeMutableRawPointer, Bool, DispatchQueue, @escaping (Error?) -> Void) -> Void
            let imp = type(of: client).instanceMethod(for: sendSelector)!
            let sendFunc = unsafeBitCast(imp, to: SendMethod.self)

            sendFunc(client, sendSelector, messagePtr, true, queue) { error in
                if let error = error {
                    Logger.error("TouchHandler: Send failed: \(error)")
                }
            }
            Logger.debug("TouchHandler: Sent touch \(touchType.rawValue) at (\(x), \(y))")
        } else {
            // Try simpler sendWithMessage: method
            let simpleSendSelector = NSSelectorFromString("sendWithMessage:")
            if client.responds(to: simpleSendSelector) {
                _ = client.perform(simpleSendSelector, with: messagePtr)
                messagePtr.deallocate() // We need to free since freeWhenDone isn't available
                Logger.debug("TouchHandler: Sent touch \(touchType.rawValue) at (\(x), \(y)) [simple]")
            } else {
                Logger.error("TouchHandler: No send method available on HID client")
                messagePtr.deallocate()
            }
        }
    }
}
