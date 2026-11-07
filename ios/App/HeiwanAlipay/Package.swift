// swift-tools-version: 5.9
import PackageDescription

// 黑湾代驾自研支付宝支付插件（本地 Swift Package，结构与 CapApp-SPM 的本地包引用同款）。
// - 插件本体：Sources/HeiwanAlipayPlugin（CAPPlugin，jsName = "HeiwanAlipay"）
// - 支付宝官方 iOS SDK 15.8.30 以 binaryTarget 形式 vendored 在 Vendor/ 下，
//   来源：支付宝官方 CocoaPods 渠道 AlipaySDK-iOS 15.8.30 的 podspec source
//   （mdn.alipayobjects.com 官方 CDN zip，zip 内含 AlipaySDK.xcframework 与 AlipaySDK.bundle）。
// - 本包由 App.xcodeproj 以 XCLocalSwiftPackageReference 引用（同 CapApp-SPM 的挂法），
//   不写入 CapApp-SPM/Package.swift（该文件由 Capacitor CLI 托管，cap sync 会重写）。
let package = Package(
    name: "HeiwanAlipay",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "HeiwanAlipayPlugin",
            targets: ["HeiwanAlipayPlugin"])
    ],
    dependencies: [
        // 与 CapApp-SPM 钉的 capacitor-swift-pm 版本保持一致，避免重复解析出两个版本
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "7.6.9")
    ],
    targets: [
        .target(
            name: "HeiwanAlipayPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .target(name: "AlipaySDK")
            ],
            path: "Sources/HeiwanAlipayPlugin",
            // 以下系统框架/库清单与官方 podspec（AlipaySDK-iOS 15.8.30）的
            // frameworks / libraries 声明逐项对齐，CocoaPods 集成时会自动链接，SPM 需在此显式声明
            linkerSettings: [
                .linkedFramework("CFNetwork"),
                .linkedFramework("SystemConfiguration"),
                .linkedFramework("QuartzCore"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("CoreMotion"),
                .linkedFramework("CoreTelephony"),
                .linkedFramework("CoreText"),
                .linkedFramework("WebKit"),
                .linkedLibrary("c++"),
                .linkedLibrary("z")
            ]
        ),
        .binaryTarget(
            name: "AlipaySDK",
            path: "Vendor/AlipaySDK.xcframework")
    ]
)
