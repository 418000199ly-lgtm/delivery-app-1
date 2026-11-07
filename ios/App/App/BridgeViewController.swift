import UIKit
import Capacitor
import HeiwanAlipayPlugin

/// Capacitor 桥接 ViewController（Main.storyboard 的根控制器）。
/// 工程内自研插件（如支付宝支付 HeiwanAlipay）不在 npm 依赖中，
/// `cap sync` 生成的 packageClassList 不会包含它们，必须在这里显式注册；
/// npm 插件仍走 packageClassList 自动注册，互不影响。
class BridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HeiwanAlipayPlugin())
    }
}
