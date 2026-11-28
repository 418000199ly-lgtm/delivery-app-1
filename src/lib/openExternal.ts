import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/**
 * 打开外部网页（购买页/充值页/下载页）。
 *
 * 2026-11-28 根因修复：旧写法 window.open(url, '_system') 是 Cordova InAppBrowser 的约定，
 * 本 App 是 Capacitor 壳且未装任何接管该约定的插件，在 iOS 上是静默空操作——
 * 349 真机实证：买会员/充钱包点了之后提示「已打开」却根本没打开网页。
 * 原生端统一走官方 @capacitor/browser（iOS Safari 弹层 / 安卓 Chrome 自定义标签），
 * 网页预览回退 window.open('_blank')。
 *
 * 返回 true 表示已确认发起打开；失败抛错或返回 false，调用方必须据此提示，
 * 禁止再无条件报「已打开」。
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (!url) return false;
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
    return true;
  }
  const w = window.open(url, '_blank');
  return !!w;
}

/** 把打开/请求失败翻译成人话，禁止把「Fetch is aborted」这类英文原文直接弹给司机。 */
export function friendlyNetworkError(err: unknown, fallback = '打开失败，请稍后重试'): string {
  const msg = err instanceof Error ? err.message : String((err as any)?.message || err || '');
  if (/abort/i.test(msg)) return '网络请求超时，请检查网络后重试';
  if (/failed to fetch|network|load failed/i.test(msg)) return '网络连接失败，请检查网络后重试';
  return msg || fallback;
}
