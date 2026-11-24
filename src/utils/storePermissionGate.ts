// ============================================================
// 商店版权限用途告知门（2026-11-24 华为审核第 6 条整改，仅商店版生效）：
// 首次申请定位/通知等敏感权限前，先弹 App 内说明框同步告知权限名称、
// 具体功能与用途（不自动消失），用户点「知道了，继续」后才触发系统
// 权限弹窗。司机版（自家渠道）不走本门，行为零变化。
// 用法：App 初始化 effect 里先 await ensurePermissionPurposeConsent()，
// 再 initNotificationSystem()/initGlobalPowerManager()；
// 界面由 StorePermissionPurpose 组件注册回调后渲染。
// ============================================================
import { Capacitor } from '@capacitor/core';
import { IS_STORE_BUILD } from '../lib/channel';

const STORAGE_KEY = 'dd_store_perm_purpose_v1';

let showUi: (() => void) | null = null;
let pendingPromise: Promise<boolean> | null = null;
let pendingResolve: ((v: boolean) => void) | null = null;

export function registerPermissionPurposeUi(fn: () => void): void {
  showUi = fn;
}

export function confirmPermissionPurpose(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch (_) {}
  if (pendingResolve) {
    const r = pendingResolve;
    pendingResolve = null;
    pendingPromise = null;
    r(true);
  }
}

export function hasPermissionPurposeConsent(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

export function ensurePermissionPurposeConsent(): Promise<boolean> {
  if (!IS_STORE_BUILD) return Promise.resolve(true);
  try {
    if (!Capacitor.isNativePlatform()) return Promise.resolve(true);
  } catch (_) {
    return Promise.resolve(true);
  }
  if (hasPermissionPurposeConsent()) return Promise.resolve(true);
  if (pendingPromise) return pendingPromise;
  pendingPromise = new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
    if (showUi) {
      showUi();
    } else {
      // 界面还没挂载就放行，避免初始化被永久挂起（理论上不应发生）
      pendingResolve = null;
      pendingPromise = null;
      resolve(true);
    }
  });
  return pendingPromise;
}
