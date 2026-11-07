import Foundation
import Capacitor
import AlipaySDK

/// 支付宝 APP 支付插件（iOS）。
///
/// JS 契约（src/lib/alipayPay.ts）：插件名 HeiwanAlipay，方法 pay({ orderString })
/// → Promise<{ resultStatus: string, memo: string }>，resultStatus 与支付宝 SDK
/// 回调字典同口径（9000 成功 / 8000 处理中 / 6001 取消 / 其它失败）。
/// 注意：resolve 只代表客户端流程结束，是否到账以服务端查单/异步通知为准。
///
/// 注册方式：本插件是工程内本地 Swift Package，不在 npm 依赖里，`cap sync` 生成的
/// capacitor.config.json packageClassList 不会包含它，因此由 App 目标的
/// BridgeViewController.capacitorDidLoad() 显式 registerPluginInstance 注册
/// （见 ios/App/App/BridgeViewController.swift）。
@objc(HeiwanAlipayPlugin)
public class HeiwanAlipayPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HeiwanAlipayPlugin"
    public let jsName = "HeiwanAlipay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pay", returnType: CAPPluginReturnPromise)
    ]

    /// 本应用专用的支付宝回跳 scheme（Info.plist CFBundleURLTypes 中注册，必须与下单时传入的一致）
    private static let appScheme = "heiwanalipay"
    /// 支付宝支付结果回跳 URL 的 host（官方集成示例即以此判定支付结果 URL）
    private static let paymentResultHost = "safepay"

    /// 挂起中的 pay 调用。已安装支付宝时 payOrder 的 callback 不会触发，
    /// 结果要等支付宝 App 通过 openURL 跳回后由 processOrder 的 standbyCallback 给出，
    /// 两条路径都汇入 finish(with:)，且只允许 resolve 一次。
    private var pendingCall: CAPPluginCall?
    private var urlObserver: NSObjectProtocol?

    override public func load() {
        // 与官方 @capacitor/app 的 AppPlugin 同款机制：监听 Capacitor 转发的 openURL 通知。
        // AppDelegate 已把 openURL 交给 ApplicationDelegateProxy，它会发此通知。
        urlObserver = NotificationCenter.default.addObserver(
            forName: .capacitorOpenURL,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleOpenURL(notification)
        }
    }

    deinit {
        if let urlObserver = urlObserver {
            NotificationCenter.default.removeObserver(urlObserver)
        }
    }

    // MARK: - pay

    @objc func pay(_ call: CAPPluginCall) {
        guard let orderString = call.getString("orderString"), !orderString.isEmpty else {
            call.reject("orderString 不能为空")
            return
        }
        // 支付宝 SDK 拉起收银台涉及 UI/跳应用，切主线程调用
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.reject("插件已释放")
                return
            }
            // 同一时刻只允许一笔进行中的支付：新的一笔进来时，先结束旧的挂起调用，避免其 Promise 永久悬挂
            if let stale = self.pendingCall {
                self.pendingCall = nil
                stale.reject("上一笔支付已被新的支付请求取代")
            }
            self.pendingCall = call
            AlipaySDK.defaultService().payOrder(orderString, fromScheme: Self.appScheme) { [weak self] resultDic in
                // 未安装支付宝走 H5 支付时，结果由这个 callback 给出；
                // 已安装支付宝跳 App 支付时，官方头文件注明：只要 processOrder 的
                // standbyCallback 非 nil，跳转结果就走 standbyCallback，不走这里。
                self?.finish(with: resultDic)
            }
        }
    }

    // MARK: - 支付宝 App 回跳处理

    private func handleOpenURL(_ notification: Notification) {
        // 通知 object 结构与 ApplicationDelegateProxy 的发送方约定一致：["url": URL, "options": ...]
        guard let object = notification.object as? [String: Any?],
              let url = object["url"] as? URL else {
            return
        }
        // 只处理本插件的支付回跳：scheme 为 heiwanalipay 且 host 为 safepay
        guard url.scheme?.lowercased() == Self.appScheme,
              url.host?.lowercased() == Self.paymentResultHost else {
            return
        }
        guard pendingCall != nil else {
            return
        }
        DispatchQueue.main.async {
            AlipaySDK.defaultService().processOrder(withPaymentResult: url) { [weak self] resultDic in
                self?.finish(with: resultDic)
            }
        }
    }

    // MARK: - 结果回传（只 resolve 一次）

    private func finish(with resultDic: Any?) {
        guard let call = pendingCall else {
            return
        }
        pendingCall = nil
        let dict = resultDic as? NSDictionary
        var data: PluginCallResultData = [
            "resultStatus": (dict?["resultStatus"] as? String) ?? "",
            "memo": (dict?["memo"] as? String) ?? ""
        ]
        if let result = dict?["result"] as? String {
            data["result"] = result
        }
        call.resolve(data)
    }
}
