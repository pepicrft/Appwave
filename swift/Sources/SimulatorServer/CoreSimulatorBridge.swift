import Foundation
import IOSurface

// MARK: - CoreSimulator Private APIs

@objc protocol SimDisplayRenderable {
    var ioSurface: IOSurface? { get }
    @objc optional var framebufferSurface: IOSurface? { get }
    func registerCallbackWithUUID(_ uuid: UUID, ioSurfaceChangeCallback: @escaping (IOSurface?) -> Void)
    func registerCallbackWithUUID(_ uuid: UUID, ioSurfacesChangeCallback: @escaping (IOSurface?) -> Void)
    func registerCallbackWithUUID(_ uuid: UUID, damageRectanglesCallback: @escaping ([NSValue]) -> Void)
    func unregisterIOSurfaceChangeCallbackWithUUID(_ uuid: UUID)
    func unregisterIOSurfacesChangeCallbackWithUUID(_ uuid: UUID)
    func unregisterDamageRectanglesCallbackWithUUID(_ uuid: UUID)
}

@objc protocol SimDeviceIOPortInterface {
    var descriptor: Any { get }
}

@objc protocol SimDeviceIOProtocol {
    var ioPorts: [Any] { get }
}

@objc protocol SimDevice {
    var io: Any? { get }
    var udid: UUID { get }
    var name: String { get }
}

@objc protocol SimDeviceSet {
    var devices: [Any] { get }
}

@objc protocol SimDisplayDescriptorState {
    var displayClass: UInt16 { get }
}

// MARK: - CoreSimulator Bridge

class CoreSimulatorBridge {
    private let udid: String
    private var displayDescriptor: NSObject?
    private var currentSurface: IOSurface?
    private let callbackID = UUID()
    private let surfaceUpdateQueue = DispatchQueue(label: "com.simulator-server.surface", qos: .userInteractive)
    private var surfaceCallbackCount: UInt64 = 0

    typealias SurfaceUpdateHandler = (IOSurface?) -> Void
    private var surfaceUpdateHandler: SurfaceUpdateHandler?

    init(udid: String) {
        self.udid = udid
        Logger.debug("CoreSimulatorBridge initialized with UDID: \(udid)")
    }

    func start(surfaceHandler: @escaping SurfaceUpdateHandler) -> Bool {
        Logger.info("Starting CoreSimulatorBridge...")

        guard let device = getSimDevice(udid: udid) as? NSObject else {
            Logger.error("Cannot get simulator device for UDID: \(udid)")
            return false
        }
        Logger.debug("Got simulator device")

        guard let ioClient = getIOClient(from: device) else {
            Logger.error("Cannot get IO client from device")
            return false
        }
        Logger.debug("Got IO client")

        guard let ioPorts = getIOPorts(from: ioClient) else {
            Logger.error("Cannot get IO ports from IO client")
            return false
        }

        Logger.info("Found \(ioPorts.count) IO ports")
        
        var mainDisplaySurface: IOSurface?
        var portIndex = 0

        for port in ioPorts {
            portIndex += 1
            guard let portObj = port as? NSObject else {
                Logger.debug("Port \(portIndex): not an NSObject, skipping")
                continue
            }

            let descriptorSelector = NSSelectorFromString("descriptor")
            guard portObj.responds(to: descriptorSelector),
                  let descriptor = portObj.perform(descriptorSelector)?.takeUnretainedValue() as? NSObject else {
                Logger.debug("Port \(portIndex): no descriptor, skipping")
                continue
            }

            let ioSurfaceSelector = NSSelectorFromString("ioSurface")
            let framebufferSurfaceSelector = NSSelectorFromString("framebufferSurface")

            var surface: IOSurface?

            if descriptor.responds(to: framebufferSurfaceSelector),
               let fb = descriptor.perform(framebufferSurfaceSelector)?.takeUnretainedValue() as? IOSurface {
                surface = fb
                Logger.debug("Port \(portIndex): found framebufferSurface")
            } else if descriptor.responds(to: ioSurfaceSelector),
                      let ios = descriptor.perform(ioSurfaceSelector)?.takeUnretainedValue() as? IOSurface {
                surface = ios
                Logger.debug("Port \(portIndex): found ioSurface")
            }

            if let surface = surface {
                let width = IOSurfaceGetWidth(surface)
                let height = IOSurfaceGetHeight(surface)
                Logger.info("Port \(portIndex): surface \(width)x\(height)")

                let stateSelector = NSSelectorFromString("state")
                if descriptor.responds(to: stateSelector),
                   let state = descriptor.perform(stateSelector)?.takeUnretainedValue() as? NSObject {
                    let displayClassSelector = NSSelectorFromString("displayClass")
                    if state.responds(to: displayClassSelector) {
                        typealias DisplayClassMethod = @convention(c) (AnyObject, Selector) -> UInt16
                        let displayClassImp = unsafeBitCast(type(of: state).instanceMethod(for: displayClassSelector)!, to: DisplayClassMethod.self)
                        let displayClass = displayClassImp(state, displayClassSelector)
                        Logger.debug("Port \(portIndex): displayClass=\(displayClass)")
                        if displayClass == 0 {
                            mainDisplaySurface = surface
                            self.displayDescriptor = descriptor
                            Logger.info("Port \(portIndex): selected as main display (class=0)")
                            break
                        }
                    }
                }

                if mainDisplaySurface == nil || (width * height > IOSurfaceGetWidth(mainDisplaySurface!) * IOSurfaceGetHeight(mainDisplaySurface!)) {
                    mainDisplaySurface = surface
                    self.displayDescriptor = descriptor
                    Logger.debug("Port \(portIndex): selected as candidate (largest so far)")
                }
            }
        }

        guard let surface = mainDisplaySurface, let descriptor = self.displayDescriptor else {
            Logger.error("Cannot find display surface after scanning all ports")
            return false
        }

        let width = IOSurfaceGetWidth(surface)
        let height = IOSurfaceGetHeight(surface)
        Logger.info("Main display surface selected: \(width)x\(height)")

        self.currentSurface = surface
        self.surfaceUpdateHandler = surfaceHandler

        // Register persistent callback using Objective-C runtime
        // The descriptor object has a method: registerCallbackWithUUID:ioSurfaceChangeCallback:
        let registerSelector = NSSelectorFromString("registerCallbackWithUUID:ioSurfaceChangeCallback:")

        if descriptor.responds(to: registerSelector) {
            Logger.debug("Descriptor responds to registerCallbackWithUUID:ioSurfaceChangeCallback:")

            // Create a callback block that will be invoked when the surface changes
            let callback: @convention(block) (IOSurface?) -> Void = { [weak self] newSurface in
                self?.surfaceUpdateQueue.async {
                    guard let self = self else { return }
                    self.surfaceCallbackCount += 1
                    self.currentSurface = newSurface

                    // Log every 60 callbacks
                    if self.surfaceCallbackCount % 60 == 0 {
                        if let newSurface = newSurface {
                            let w = IOSurfaceGetWidth(newSurface)
                            let h = IOSurfaceGetHeight(newSurface)
                            Logger.debug("Surface callback #\(self.surfaceCallbackCount): \(w)x\(h)")
                        } else {
                            Logger.debug("Surface callback #\(self.surfaceCallbackCount): nil surface")
                        }
                    }

                    self.surfaceUpdateHandler?(newSurface)
                }
            }

            // Use NSInvocation-style calling via imp
            typealias RegisterCallbackMethod = @convention(c) (AnyObject, Selector, UUID, Any) -> Void
            let imp = descriptor.method(for: registerSelector)
            let registerFunc = unsafeBitCast(imp, to: RegisterCallbackMethod.self)
            registerFunc(descriptor, registerSelector, callbackID, callback)

            Logger.info("Registered IOSurface change callback (UUID: \(callbackID))")
        } else {
            // Try alternative approach: poll-based streaming since callbacks aren't available
            Logger.warn("Descriptor does not respond to registerCallbackWithUUID:ioSurfaceChangeCallback:")
            Logger.info("Will use poll-based surface reading instead")

            // Start a polling timer to read the surface periodically
            startPollingTimer(descriptor: descriptor)
        }

        return true
    }

    private var pollingTimer: DispatchSourceTimer?

    private func startPollingTimer(descriptor: NSObject) {
        let timer = DispatchSource.makeTimerSource(queue: surfaceUpdateQueue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(16)) // ~60fps

        let ioSurfaceSelector = NSSelectorFromString("ioSurface")
        let framebufferSurfaceSelector = NSSelectorFromString("framebufferSurface")

        timer.setEventHandler { [weak self] in
            guard let self = self else { return }

            var surface: IOSurface?

            if descriptor.responds(to: framebufferSurfaceSelector),
               let fb = descriptor.perform(framebufferSurfaceSelector)?.takeUnretainedValue() as? IOSurface {
                surface = fb
            } else if descriptor.responds(to: ioSurfaceSelector),
                      let ios = descriptor.perform(ioSurfaceSelector)?.takeUnretainedValue() as? IOSurface {
                surface = ios
            }

            if let surface = surface {
                self.surfaceCallbackCount += 1
                self.currentSurface = surface

                // Log every 60 polls
                if self.surfaceCallbackCount % 60 == 0 {
                    let w = IOSurfaceGetWidth(surface)
                    let h = IOSurfaceGetHeight(surface)
                    Logger.debug("Poll #\(self.surfaceCallbackCount): \(w)x\(h)")
                }

                self.surfaceUpdateHandler?(surface)
            }
        }

        timer.resume()
        self.pollingTimer = timer
        Logger.info("Started polling timer for surface updates")
    }

    func stop() {
        Logger.info("Stopping CoreSimulatorBridge...")

        // Cancel polling timer if active
        if let timer = pollingTimer {
            timer.cancel()
            pollingTimer = nil
            Logger.debug("Cancelled polling timer")
        }

        // Try to unregister callbacks using Objective-C runtime
        if let descriptor = displayDescriptor {
            let unregisterSelector = NSSelectorFromString("unregisterIOSurfaceChangeCallbackWithUUID:")
            if descriptor.responds(to: unregisterSelector) {
                _ = descriptor.perform(unregisterSelector, with: callbackID)
                Logger.debug("Unregistered IOSurface change callback")
            }
        }

        Logger.info("CoreSimulatorBridge stopped (total callbacks: \(surfaceCallbackCount))")
    }

    func getSurface() -> IOSurface? {
        return currentSurface
    }
    
    // MARK: - Private Helpers
    
    private func getSimDevice(udid: String) -> Any? {
        Logger.debug("Loading CoreSimulator.framework...")
        guard let coreSimBundle = Bundle(path: "/Library/Developer/PrivateFrameworks/CoreSimulator.framework") else {
            Logger.error("Cannot find CoreSimulator.framework at expected path")
            return nil
        }

        guard coreSimBundle.load() else {
            Logger.error("Cannot load CoreSimulator.framework bundle")
            return nil
        }
        Logger.debug("CoreSimulator.framework loaded")

        guard let contextClass = NSClassFromString("SimServiceContext") as? NSObject.Type else {
            Logger.error("Cannot find SimServiceContext class")
            return nil
        }
        Logger.debug("Found SimServiceContext class")

        let sharedSelector = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
        guard contextClass.responds(to: sharedSelector) else {
            Logger.error("SimServiceContext doesn't respond to sharedServiceContextForDeveloperDir:error:")
            return nil
        }

        let developerDir = "/Applications/Xcode.app/Contents/Developer" as NSString
        Logger.debug("Using developer dir: \(developerDir)")

        typealias SharedContextMethod = @convention(c) (AnyClass, Selector, NSString, AutoreleasingUnsafeMutablePointer<NSError?>?) -> AnyObject?
        let sharedContextImp = unsafeBitCast(contextClass.method(for: sharedSelector), to: SharedContextMethod.self)

        var error: NSError?
        let context = sharedContextImp(contextClass, sharedSelector, developerDir, &error) as? NSObject

        if let error = error {
            Logger.error("Error getting service context: \(error.localizedDescription)")
            return nil
        }

        guard let context = context else {
            Logger.error("Cannot get SimServiceContext (nil result)")
            return nil
        }
        Logger.debug("Got SimServiceContext")

        let deviceSetSelector = NSSelectorFromString("defaultDeviceSetWithError:")
        guard context.responds(to: deviceSetSelector) else {
            Logger.error("Context doesn't respond to defaultDeviceSetWithError:")
            return nil
        }

        typealias DeviceSetMethod = @convention(c) (AnyObject, Selector, AutoreleasingUnsafeMutablePointer<NSError?>?) -> AnyObject?
        let deviceSetImp = unsafeBitCast(type(of: context).instanceMethod(for: deviceSetSelector)!, to: DeviceSetMethod.self)

        let deviceSet = deviceSetImp(context, deviceSetSelector, &error) as? NSObject

        if let error = error {
            Logger.error("Error getting device set: \(error.localizedDescription)")
            return nil
        }

        guard let deviceSet = deviceSet else {
            Logger.error("Cannot get device set (nil result)")
            return nil
        }
        Logger.debug("Got device set")

        let devicesSelector = NSSelectorFromString("devices")
        guard deviceSet.responds(to: devicesSelector) else {
            Logger.error("DeviceSet doesn't respond to devices selector")
            return nil
        }

        guard let devices = deviceSet.perform(devicesSelector)?.takeUnretainedValue() as? [AnyObject] else {
            Logger.error("Cannot get devices array")
            return nil
        }

        Logger.info("Found \(devices.count) simulator devices")

        let targetUUID = UUID(uuidString: udid)
        for device in devices {
            let udidSelector = NSSelectorFromString("UDID")
            if device.responds(to: udidSelector),
               let deviceUUID = device.perform(udidSelector)?.takeUnretainedValue() as? UUID,
               deviceUUID == targetUUID {
                Logger.info("Found device with matching UDID")
                return device
            }
        }

        Logger.error("Device with UDID \(udid) not found among \(devices.count) devices")
        return nil
    }
    
    private func getIOClient(from device: NSObject) -> NSObject? {
        let ioSelector = NSSelectorFromString("io")
        guard device.responds(to: ioSelector),
              let ioClient = device.perform(ioSelector)?.takeUnretainedValue() as? NSObject else {
            return nil
        }
        return ioClient
    }
    
    private func getIOPorts(from ioClient: NSObject) -> [AnyObject]? {
        let ioPortsSelector = NSSelectorFromString("ioPorts")
        guard ioClient.responds(to: ioPortsSelector),
              let ioPorts = ioClient.perform(ioPortsSelector)?.takeUnretainedValue() as? [AnyObject] else {
            return nil
        }
        return ioPorts
    }
}
