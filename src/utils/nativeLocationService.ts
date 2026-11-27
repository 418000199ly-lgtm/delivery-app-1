/**
 * 原生听单定位服务桥（仅安卓，2026-11-26）。
 *
 * 背景：网页层 JS 在 App 切后台/锁屏后会被系统冻结，定位上报整条链
 * 停摆、司机被看门狗误踢下线（附近页变灰）。安卓改由原生前台服务
 * HeiwanLocationService 独立完成定位与上报，本模块只是 JS 侧的
 * 配置传递口：上线时 start、下线时 stop、忙闲变化时 updateState。
 * iOS 与网页预览环境全部为空操作（iOS 沿用原有保活链路）。
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface HeiwanLocationConfig {
  phone: string;
  token: string;
  driverName?: string;
  city?: string;
  isBusy?: boolean;
  todayOrders?: number;
}

interface HeiwanLocationPluginShape {
  start(opts: HeiwanLocationConfig): Promise<{ ok: boolean }>;
  updateState(opts: Partial<HeiwanLocationConfig>): Promise<{ ok: boolean }>;
  stop(): Promise<{ ok: boolean }>;
  batteryStatus(): Promise<{ ignoring: boolean }>;
  requestBatteryExemption(): Promise<{ requested: boolean; ignoring: boolean }>;
}

const HeiwanLocation = registerPlugin<HeiwanLocationPluginShape>('HeiwanLocation');

export function isNativeLocationServiceAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch (_) {
    return false;
  }
}

export async function startNativeLocationService(cfg: HeiwanLocationConfig): Promise<void> {
  if (!isNativeLocationServiceAvailable()) return;
  if (!cfg.phone || !cfg.token) return;
  if (_stopTimer) {
    clearTimeout(_stopTimer);
    _stopTimer = null;
  }
  try {
    await HeiwanLocation.start(cfg);
  } catch (_) {}
}

export async function updateNativeLocationState(patch: Partial<HeiwanLocationConfig>): Promise<void> {
  if (!isNativeLocationServiceAvailable()) return;
  try {
    await HeiwanLocation.updateState(patch);
  } catch (_) {}
}

export async function stopNativeLocationService(immediate = false): Promise<void> {
  if (!isNativeLocationServiceAvailable()) return;
  // 延迟 3 秒真停：上报器因依赖变化（切页/单数变化）会频繁销毁重建，
  // 立即停会与紧随其后的 start 竞态把服务误杀；新的 start 会取消待停。
  // 但真下线/退出/被踢时必须 immediate=true 立刻停——2026-11-26 生产实证：
  // 下线 2 秒后一笔原生上报（isOnline 写死 true）把刚写下的下线翻回在线，
  // 附近页持续绿约 5 分钟才被看门狗踢下；3 秒防抖窗口就是这个洞。
  if (_stopTimer) {
    clearTimeout(_stopTimer);
    _stopTimer = null;
  }
  if (immediate) {
    try {
      await HeiwanLocation.stop();
    } catch (_) {}
    return;
  }
  _stopTimer = setTimeout(() => {
    _stopTimer = null;
    try {
      HeiwanLocation.stop().catch(() => {});
    } catch (_) {}
  }, 3000);
}

let _stopTimer: any = null;

/**
 * 上线时至多请求一次电池优化豁免（系统弹窗）。已豁免或已请求过都不再弹，
 * 避免上报器每次重启都打扰司机；没豁免时前台服务+唤醒锁仍是主力机制。
 */
export async function requestBatteryExemptionOnce(): Promise<void> {
  if (!isNativeLocationServiceAvailable()) return;
  try {
    if (localStorage.getItem('dd_batt_exempt_asked_v1') === '1') return;
    const st: any = await HeiwanLocation.batteryStatus().catch(() => null);
    if (st && st.ignoring) {
      localStorage.setItem('dd_batt_exempt_asked_v1', '1');
      return;
    }
    localStorage.setItem('dd_batt_exempt_asked_v1', '1');
    await HeiwanLocation.requestBatteryExemption().catch(() => {});
  } catch (_) {}
}
