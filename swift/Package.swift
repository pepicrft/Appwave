// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PlasmaTools",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "simulator-server", targets: ["SimulatorServer"])
    ],
    targets: [
        .executableTarget(
            name: "SimulatorServer",
            path: "Sources/SimulatorServer",
            linkerSettings: [
                .linkedFramework("CoreSimulator", .when(platforms: [.macOS])),
                .linkedFramework("IOSurface"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("VideoToolbox"),
                .linkedFramework("ImageIO"),
                .linkedFramework("Foundation"),
                .unsafeFlags([
                    "-F/Library/Developer/PrivateFrameworks",
                    "-F/Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks"
                ])
            ]
        )
    ]
)
