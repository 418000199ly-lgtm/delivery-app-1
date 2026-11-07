// 支付宝 App 支付原生插件包装（插件名 HeiwanAlipay，原生实现另行接入 Android/iOS 工程）。
// 与 appUpdate.ts 的 HeiwanInstaller 同一模式：registerPlugin 懒注册。
// 非原生环境（web 预览）调用 pay() 时直接抛出明确的不可用错误，供 UI 提示，绝不假装拉起成功。
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface HeiwanAlipayPlugin {
  pay(options: { orderString: string }): Promise<{ resultStatus: string; memo?: string; result?: string }>;
}

export interface AlipayPayResult {
  /** 支付宝 SDK 同步返回状态：9000 支付成功（仍须以服务端查单为准）、8000 处理中、6001 用户取消、4000/6002 等失败 */
  resultStatus: string;
  memo?: string;
}

let _alipay: HeiwanAlipayPlugin | null = null;
function alipayPlugin(): HeiwanAlipayPlugin {
  if (!_alipay) _alipay = registerPlugin<HeiwanAlipayPlugin>('HeiwanAlipay');
  return _alipay;
}

export function isAlipayPayAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch (_) {
    return false;
  }
}

/**
 * 拉起支付宝 App 支付。
 * @param orderString 服务端 /api/pay/alipay/create-order 返回的签名订单串
 * 注意：resolve 只代表支付宝客户端流程结束，是否真正到账必须由调用方再查服务端 order-status。
 */
export async function payWithAlipay(orderString: string): Promise<AlipayPayResult> {
  if (!isAlipayPayAvailable()) {
    throw new Error('当前环境不支持支付宝支付，请在黑湾代驾MAX App 内购买');
  }
  if (!orderString) {
    throw new Error('订单参数缺失，请重试');
  }
  const res = await alipayPlugin().pay({ orderString });
  return {
    resultStatus: String((res as any)?.resultStatus ?? ''),
    memo: (res as any)?.memo ? String((res as any).memo) : undefined,
  };
}
