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
    
    typealias SurfaceUpdateHandler = (IOSurface?) -> Void
    private var surfaceUpdateHandler: SurfaceUpdateHandler?
    
    init(udid: String) {
        self.udid = udid
    }
    
    func start(surfaceHandler: @escaping SurfaceUpdateHandler) -> Bool {
        guard let device = getSimDevice(udid: udid) as? NSObject else {
            fputs("Error: Cannot get simulator device\n", stderr)
            return false
        }
        
        guard let ioClient = getIOClient(from: device) else {
            fputs("Error: Cannot get IO client\n", stderr)
            return false
        }
        
        guard let ioPorts = getIOPorts(from: ioClient) else {
            fputs("Error: Cannot get IO ports\n", stderr)
            return false
        }
        
        fputs("Found \(ioPorts.count) IO ports\n", stderr)
        
        var mainDisplaySurface: IOSurface?
        
        for port in ioPorts {
            guard let portObj = port as? NSObject else { continue }
            
            let descriptorSelector = NSSelectorFromString("descriptor")
            guard portObj.responds(to: descriptorSelector),
                  let descriptor = portObj.perform(descriptorSelector)?.takeUnretainedValue() as? NSObject else {
                continue
            }
            
            let ioSurfaceSelector = NSSelectorFromString("ioSurface")
            let framebufferSurfaceSelector = NSSelectorFromString("framebufferSurface")
            
            var surface: IOSurface?
            
            if descriptor.responds(to: framebufferSurfaceSelector),
               let fb = descriptor.perform(framebufferSurfaceSelector)?.takeUnretainedValue() as? IOSurface {
                surface = fb
            } else if descriptor.responds(to: ioSurfaceSelector),
                      let ios = descriptor.perform(ioSurfaceSelector)?.takeUnretainedValue() as? IOSurface {
                surface = ios
            }
            
            if let surface = surface {
                let width = IOSurfaceGetWidth(surface)
                let height = IOSurfaceGetHeight(surface)
                fputs("Found surface: \(width)x\(height)\n", stderr)
                
                let stateSelector = NSSelectorFromString("state")
                if descriptor.responds(to: stateSelector),
                   let state = descriptor.perform(stateSelector)?.takeUnretainedValue() as? NSObject {
                    let displayClassSelector = NSSelectorFromString("displayClass")
                    if state.responds(to: displayClassSelector) {
                        typealias DisplayClassMethod = @convention(c) (AnyObject, Selector) -> UInt16
                        let displayClassImp = unsafeBitCast(type(of: state).instanceMethod(for: displayClassSelector)!, to: DisplayClassMethod.self)
                        let displayClass = displayClassImp(state, displayClassSelector)
                        fputs("  Display class: \(displayClass)\n", stderr)
                        if displayClass == 0 {
                            mainDisplaySurface = surface
                            self.displayDescriptor = descriptor
                            fputs("  -> Selected as main display\n", stderr)
                            break
                        }
                    }
                }
                
                if mainDisplaySurface == nil || (width * height > IOSurfaceGetWidth(mainDisplaySurface!) * IOSurfaceGetHeight(mainDisplaySurface!)) {
                    mainDisplaySurface = surface
                    self.displayDescriptor = descriptor
                }
            }
        }
        
        guard let surface = mainDisplaySurface, let descriptor = self.displayDescriptor else {
            fputs("Error: Cannot find display surface\n", stderr)
            return false
        }
        
        self.currentSurface = surface
        self.surfaceUpdateHandler = surfaceHandler
        
        // Register persistent callback
        if let renderable = descriptor as? SimDisplayRenderable {
            renderable.registerCallbackWithUUID(callbackID, ioSurfaceChangeCallback: { [weak self] surface in
                self?.surfaceUpdateQueue.async {
                    self?.currentSurface = surface
                    self?.surfaceUpdateHandler?(surface)
                }
            })
            fputs("Registered IOSurface callback\n", stderr)
        }
        
        return true
    }
    
    func stop() {
        if let descriptor = displayDescriptor as? SimDisplayRenderable {
            descriptor.unregisterIOSurfaceChangeCallbackWithUUID(callbackID)
            descriptor.unregisterIOSurfacesChangeCallbackWithUUID(callbackID)
            descriptor.unregisterDamageRectanglesCallbackWithUUID(callbackID)
        }
    }
    
    func getSurface() -> IOSurface? {
        return currentSurface
    }
    
    // MARK: - Private Helpers
    
    private func getSimDevice(udid: String) -> Any? {
        guard let coreSimBundle = Bundle(path: "/Library/Developer/PrivateFrameworks/CoreSimulator.framework") else {
            fputs("Error: Cannot load CoreSimulator.framework\n", stderr)
            return nil
        }
        
        guard coreSimBundle.load() else {
            fputs("Error: Cannot load CoreSimulator bundle\n", stderr)
            return nil
        }
        
        guard let contextClass = NSClassFromString("SimServiceContext") as? NSObject.Type else {
            fputs("Error: Cannot find SimServiceContext class\n", stderr)
            return nil
        }
        
        let sharedSelector = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
        guard contextClass.responds(to: sharedSelector) else {
            fputs("Error: SimServiceContext doesn't respond to sharedServiceContextForDeveloperDir:error:\n", stderr)
            return nil
        }
        
        let developerDir = "/Applications/Xcode.app/Contents/Developer" as NSString
        
        typealias SharedContextMethod = @convention(c) (AnyClass, Selector, NSString, AutoreleasingUnsafeMutablePointer<NSError?>?) -> AnyObject?
        let sharedContextImp = unsafeBitCast(contextClass.method(for: sharedSelector), to: SharedContextMethod.self)
        
        var error: NSError?
        let context = sharedContextImp(contextClass, sharedSelector, developerDir, &error) as? NSObject
        
        if let error = error {
            fputs("Error getting service context: \(error)\n", stderr)
            return nil
        }
        
        guard let context = context else {
            fputs("Error: Cannot get SimServiceContext\n", stderr)
            return nil
        }
        
        let deviceSetSelector = NSSelectorFromString("defaultDeviceSetWithError:")
        guard context.responds(to: deviceSetSelector) else {
            fputs("Error: Context doesn't respond to defaultDeviceSetWithError:\n", stderr)
            return nil
        }
        
        typealias DeviceSetMethod = @convention(c) (AnyObject, Selector, AutoreleasingUnsafeMutablePointer<NSError?>?) -> AnyObject?
        let deviceSetImp = unsafeBitCast(type(of: context).instanceMethod(for: deviceSetSelector)!, to: DeviceSetMethod.self)
        
        let deviceSet = deviceSetImp(context, deviceSetSelector, &error) as? NSObject
        
        if let error = error {
            fputs("Error getting device set: \(error)\n", stderr)
            return nil
        }
        
        guard let deviceSet = deviceSet else {
            fputs("Error: Cannot get device set\n", stderr)
            return nil
        }
        
        let devicesSelector = NSSelectorFromString("devices")
        guard deviceSet.responds(to: devicesSelector) else {
            fputs("Error: DeviceSet doesn't respond to devices\n", stderr)
            return nil
        }
        
        guard let devices = deviceSet.perform(devicesSelector)?.takeUnretainedValue() as? [AnyObject] else {
            fputs("Error: Cannot get devices array\n", stderr)
            return nil
        }
        
        let targetUUID = UUID(uuidString: udid)
        for device in devices {
            let udidSelector = NSSelectorFromString("UDID")
            if device.responds(to: udidSelector),
               let deviceUUID = device.perform(udidSelector)?.takeUnretainedValue() as? UUID,
               deviceUUID == targetUUID {
                return device
            }
        }
        
        fputs("Error: Device with UDID \(udid) not found\n", stderr)
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
