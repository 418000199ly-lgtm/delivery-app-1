// ============================================================
// 2026-11-01 App 自更新弹窗（桥接版）。
// 强制模式：无关闭按钮，下线时弹出、不升不让上线（拦截在 App.tsx）；
// 下载在 App 内完成（进度条），下完自动拉起系统安装页。
// 可选模式：可点「稍后再说」。
// 失败兜底：重试；强制模式连续失败可「暂缓 30 分钟」应急上线，避免司机被锁死。
// iOS：系统限制不能 App 内安装，引导打开下载页走 TrollStore。
// ============================================================
import React, { useState } from 'react';
import { AppUpdateInfo, performAppUpdate, setUpdateSnooze, nativePlatform } from '../lib/appUpdate';

interface Props {
  info: AppUpdateInfo;
  forced: boolean;
  onClose?: () => void; // 仅可选模式
  onSnooze?: () => void; // 强制模式暂缓后关闭弹窗
}

type Phase = 'idle' | 'downloading' | 'need_permission' | 'failed' | 'opened_browser' | 'installer_opened';

export default function AppUpdateModal({ info, forced, onClose, onSnooze }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const isIos = nativePlatform() === 'ios';
  const sizeMb = info.size > 0 ? (info.size / 1024 / 1024).toFixed(1) : '';

  const start = async () => {
    setPhase('downloading');
    setProgress(0);
    setError('');
    const r = await performAppUpdate(info, (ratio) => setProgress(ratio));
    if (r.result === 'installer_opened') {
      setPhase('installer_opened');
    } else if (r.result === 'need_permission') {
      setPhase('need_permission');
    } else if (r.result === 'opened_browser') {
      setPhase('opened_browser');
    } else {
      setError(r.error || '下载失败，请检查网络后重试');
      setPhase('failed');
    }
  };

  const snooze = () => {
    setUpdateSnooze(30);
    if (onSnooze) onSnooze();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-5">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="text-center">
          <div className="text-4xl mb-2">🚀</div>
          <div className="text-lg font-bold text-gray-900">
            {forced ? '必须升级到新版本' : '发现新版本'}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            新版本 {info.name || `构建 ${info.latestBuild}`}{sizeMb ? `（${sizeMb} MB）` : ''}
          </div>
        </div>

        {info.notes ? (
          <div className="mt-4 max-h-32 overflow-y-auto rounded-lg bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-wrap">
            {info.notes}
          </div>
        ) : null}

        {phase === 'downloading' && (
          <div className="mt-5">
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-200"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="mt-2 text-center text-sm text-gray-600">
              正在下载… {Math.round(progress * 100)}%
            </div>
          </div>
        )}

        {phase === 'need_permission' && (
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            已为你打开系统设置，请开启「允许安装应用 / 允许来自此来源的应用」，然后回到这里点「继续安装」。安装包已经下载好了，不用重新下载。
          </div>
        )}

        {phase === 'failed' && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {phase === 'opened_browser' && (
          <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
            已打开下载页。下载完成后，请把文件分享/导入 TrollStore 安装；安装是覆盖安装，不用重新登录。
          </div>
        )}

        {phase === 'installer_opened' && (
          <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            已打开系统安装页面，请点「安装」。装完打开 App 就是新版本，不用重新登录。
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {phase !== 'downloading' && phase !== 'installer_opened' && (
            <button
              onClick={start}
              className="w-full rounded-xl bg-blue-600 py-3 text-base font-semibold text-white active:bg-blue-700"
            >
              {phase === 'need_permission' ? '我已开启，继续安装' : phase === 'failed' ? '重新下载' : '立即升级'}
            </button>
          )}
          {isIos && phase === 'idle' && (
            <div className="text-center text-xs text-gray-400">苹果手机需通过 TrollStore 安装（仅限已装巨魔的设备）</div>
          )}
          {!forced && phase !== 'downloading' && onClose && (
            <button onClick={onClose} className="w-full rounded-xl bg-gray-100 py-3 text-base text-gray-700 active:bg-gray-200">
              稍后再说
            </button>
          )}
          {forced && (phase === 'failed') && (
            <button onClick={snooze} className="w-full rounded-xl bg-gray-100 py-3 text-sm text-gray-600 active:bg-gray-200">
              网络不好？暂缓 30 分钟先上线跑单
            </button>
          )}
        </div>

        {forced && phase === 'idle' && (
          <div className="mt-3 text-center text-xs text-gray-400">本次为强制升级，升级后才能上线接单</div>
        )}
      </div>
    </div>
  );
}
