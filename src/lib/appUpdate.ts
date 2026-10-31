// ============================================================
// 2026-11-01 App 自更新（桥接版）：版本问询 + 强制/可选升级状态 + App 内下载安装。
// 口径（用户定型）：
// - App 每 60 秒（带随机错峰）向阿里云问询 /api/app/version；
// - 有强制升级且司机时才弹窗，上线跑单中不弹、行程中不弹；
// - 强制未升不让上线（拦截点在 App.tsx 的 handleToggleOnline）；
// - 安卓走原生插件 HeiwanInstaller 在 App 内下载（进度/断点续传/SHA-256 校验）
// 并自动拉起系统安装页；iOS 只能打开下载页走 TrollStore 手动安装。
// 本地构建号由 CI 注入（VITE_APP_BUILD=GitHub 构建序号）；无注入时为 0。
// ============================================================
import { Capacitor, registerPlugin} from '@capacitor/core';

export const APP_BUILD: number = (() => {
try {
const v = parseInt(String((import.meta as any).env?.VITE_APP_BUILD || '0'), 10);
return isNaN(v)? 0: v;
} catch (_) {
return 0;
}
})();
export const APP_VERSION_LABEL = APP_BUILD > 0? `2.1.${APP_BUILD}`: '2.1';

const API_BASE = 'https://api.lyheiwandaijiamax.com';

export interface AppUpdateInfo {
hasUpdate: boolean;
force: boolean;
latestBuild: number;
name: string;
notes: string;
size: number;
sha256: string;
downloadUrl: string; // 绝对地址（带时效签名）
publishedAt: number;
}

interface HeiwanInstallerPlugin {
canInstall(): Promise<{ allowed: boolean}>;
openInstallSettings(): Promise<void>;
downloadAndInstall(opts: {
url: string;
fileName: string;
sha256?: string;
size?: number;
}): Promise<{ success: boolean; bytes: number}>;
addListener(
eventName: 'downloadProgress',
listenerFunc: (e: { loaded: number; total: number}) => void
): Promise<{ remove: () => Promise<void>}>;
}

let _installer: HeiwanInstallerPlugin | null = null;
function installer(): HeiwanInstallerPlugin {
if (!_installer) _installer = registerPlugin<HeiwanInstallerPlugin>('HeiwanInstaller');
return _installer;
}

export function isNativeApp(): boolean {
try {
return Capacitor.isNativePlatform();
} catch (_) {
return false;
}
}
export function nativePlatform(): 'android' | 'ios' | 'web' {
try {
const p = Capacitor.getPlatform();
return p === 'ios'? 'ios': p === 'android'? 'android': 'web';
} catch (_) {
return 'web';
}
}

let _lastInfo: AppUpdateInfo | null = null;
export function getLastUpdateInfo(): AppUpdateInfo | null {
return _lastInfo;
}

// 问询服务器。失败返回 null（静默，绝不打扰司机）。
export async function checkAppUpdate(): Promise<AppUpdateInfo | null> {
if (!isNativeApp()) return null;
try {
const phone = (localStorage.getItem('dd_user_phone') || '').replace(/\D/g, '');
const platform = nativePlatform() === 'ios'? 'ios': 'android';
const url = `${API_BASE}/api/app/version?platform=${platform}&build=${APP_BUILD}&phone=${encodeURIComponent(phone)}`;
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 8000);
const resp = await fetch(url, { signal: ctrl.signal});
clearTimeout(timer);
if (!resp.ok) return null;
const data: any = await resp.json();
if (!data ||!data.success) return null;
const info: AppUpdateInfo = {
hasUpdate:!!data.hasUpdate,
force:!!data.force,
latestBuild: Number(data.latestBuild || 0),
name: String(data.name || ''),
notes: String(data.notes || ''),
size: Number(data.size || 0),
sha256: String(data.sha256 || ''),
downloadUrl: data.downloadUrl
? data.downloadUrl.startsWith('http')
? data.downloadUrl
: API_BASE + data.downloadUrl
: '',
publishedAt: Number(data.publishedAt || 0),
};
_lastInfo = info;
try {
localStorage.setItem('dd_app_update_cache', JSON.stringify({...info, downloadUrl: '', at: Date.now()}));
} catch (_) {}
return info;
} catch (_) {
return null;
}
}

// 强制升级待处理判定（上线拦截与弹窗共用）：有新版 + 强制。
export function hasPendingForcedUpdate(): boolean {
return!!(_lastInfo && _lastInfo.hasUpdate && _lastInfo.force);
}

// 执行升级。onProgress(0~1) 回调进度。返回结果码：
// 'installer_opened' 已拉起系统安装页 | 'need_permission' 已引导去开安装权限 |
// 'opened_browser' iOS/兜底已打开浏览器下载页 | 'failed' 失败（err 带原因）
export async function performAppUpdate(
info: AppUpdateInfo,
onProgress?: (ratio: number) => void
): Promise<{ result: string; error?: string}> {
if (!info.downloadUrl) return { result: 'failed', error: '下载地址为空，请稍后重试'};
if (nativePlatform()!== 'android') {
// iOS：系统不允许 App 内安装，只能打开下载页走 TrollStore
try {
window.open(info.downloadUrl, '_system');
} catch (_) {}
return { result: 'opened_browser'};
}
let handle: { remove: () => Promise<void>} | null = null;
try {
handle = await installer().addListener('downloadProgress', (e) => {
if (onProgress && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
});
await installer().downloadAndInstall({
url: info.downloadUrl,
fileName: `heiwan-${info.latestBuild}.apk`,
sha256: info.sha256 || undefined,
size: info.size || undefined,
});
if (onProgress) onProgress(1);
return { result: 'installer_opened'};
} catch (e: any) {
const msg = String(e?.message || e || '');
if (msg.includes('NEED_INSTALL_PERMISSION')) return { result: 'need_permission'};
return { result: 'failed', error: msg};
} finally {
try {
await handle?.remove();
} catch (_) {}
}
}

// 应急暂缓（强制模式下载反复失败时用）：暂缓期内不弹窗、不拦上线，
// 防止司机因网络问题被锁死不能跑单。到期自动恢复强制。
export function setUpdateSnooze(minutes: number): void {
  try {
    localStorage.setItem('dd_app_update_snooze_until', String(Date.now() + minutes * 60 * 1000));
  } catch (_) {}
}
export function isUpdateSnoozed(): boolean {
  try {
    return Date.now() < Number(localStorage.getItem('dd_app_update_snooze_until') || 0);
  } catch (_) {
    return false;
  }
}
