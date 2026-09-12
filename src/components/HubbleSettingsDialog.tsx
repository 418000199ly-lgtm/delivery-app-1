import React, { useState } from 'react';
import { 
  Telescope, 
  ArrowLeft, 
  Check, 
  Search, 
  MapPin, 
  Car, 
  PowerOff, 
  Eye
} from 'lucide-react';

export interface HubbleFilterSettings {
  showIdle: boolean;          // 空闲中 (绿色)
  showBusy: boolean;          // 做单中 (红色)
  showOffline: boolean;       // 下线司机 (灰色/下线时位置)
  showFullName: boolean;      // 显示全名 (不再使用“师傅”隐藏)
}

interface HubbleSettingsDialogProps {
  initialSettings: HubbleFilterSettings;
  onConfirm: (newSettings: HubbleFilterSettings) => void;
  onClose: () => void;
  onSearchDriver: (query: string) => void;
  searchFeedback?: string | null;
}

export default function HubbleSettingsDialog({
  initialSettings,
  onConfirm,
  onClose,
  onSearchDriver,
  searchFeedback
}: HubbleSettingsDialogProps) {
  // Local state for checkboxes
  const [showIdle, setShowIdle] = useState(initialSettings.showIdle);
  const [showBusy, setShowBusy] = useState(initialSettings.showBusy);
  const [showOffline, setShowOffline] = useState(initialSettings.showOffline);
  const [showFullName, setShowFullName] = useState(initialSettings.showFullName);

  // Search input query
  const [searchQuery, setSearchQuery] = useState('');

  // 1. 点击“显示全名”后：空闲中、做单中小方框里自动显示对钩，自身切换对钩
  const handleToggleFullName = () => {
    const nextVal = !showFullName;
    setShowFullName(nextVal);
    if (nextVal) {
      // 需求：点击显示全名后（空闲中、做单中小方框里自动显示对钩）
      setShowIdle(true);
      setShowBusy(true);
    }
  };

  // 2. 点击“下线司机”：小方框里自动显示对钩，空闲中、做单中小方框里对钩自动取消显示
  const handleToggleOffline = () => {
    const nextVal = !showOffline;
    setShowOffline(nextVal);
    if (nextVal) {
      // 需求：点击下线司机（小方框里自动显示对钩，空闲中、做单中小方框里对钩自动取消显示）
      setShowIdle(false);
      setShowBusy(false);
    }
  };

  // 3. 点击“空闲中”
  const handleToggleIdle = () => {
    setShowIdle((prev) => !prev);
  };

  // 4. 点击“做单中”
  const handleToggleBusy = () => {
    setShowBusy((prev) => !prev);
  };

  // 5. 点击“确定”
  const handleSave = () => {
    onConfirm({
      showIdle,
      showBusy,
      showOffline,
      showFullName
    });
  };

  // 6. 搜索定位司机
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    onSearchDriver(searchQuery.trim());
  };

  return (
    <div 
      className="absolute inset-0 z-50 bg-[#F4F6F9] flex flex-col h-full w-full overflow-hidden animate-in slide-in-from-right duration-250 select-none pointer-events-auto"
    >
      {/* 手机顶部电量/信号/状态栏安全占位区 (保留系统电量、网络信号、时间与打孔屏空间，彻底避免遮挡) */}
      <div 
        className="w-full shrink-0 bg-white select-none pointer-events-none"
        style={{ 
          height: 'max(env(safe-area-inset-top, 0px), var(--status-bar-height, 0px), 36px)' 
        }} 
      />

      {/* Top Mobile App Page Header */}
      <header className="relative w-full bg-white border-b border-slate-200/80 px-4 py-2.5 flex items-center justify-between shadow-2xs shrink-0 z-20">
        <div className="flex items-center space-x-3">
          <button 
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 flex items-center justify-center text-slate-700 transition cursor-pointer"
            aria-label="返回"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base font-extrabold text-slate-900 tracking-tight">哈勃设置</h1>
            <p className="text-[11px] text-slate-400 font-medium">
              高空广域全局监控与司机定位检索
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center">
            <Telescope className="w-4.5 h-4.5" />
          </div>
        </div>
      </header>

      {/* Page Body - Scrollable Area with full height flex-1 */}
      <main className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0 overscroll-contain touch-pan-y">
        {/* Section 1: 司机搜索与定位 */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center space-x-1.5 mb-2.5">
            <MapPin className="w-4 h-4 text-sky-600" />
            <span className="text-xs font-bold text-slate-800">搜索定位小队司机</span>
          </div>
          <form onSubmit={handleSearchSubmit} className="flex items-center space-x-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="输入手机号码或司机姓名"
                className="w-full pl-8 pr-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:border-sky-500 focus:bg-white shadow-2xs"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-sky-600 hover:bg-sky-700 active:scale-95 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-sm shadow-sky-600/20 shrink-0"
            >
              搜索定位
            </button>
          </form>
          {searchFeedback && (
            <p className="text-[11px] text-sky-700 font-semibold mt-2 pl-1 animate-in fade-in">
              {searchFeedback}
            </p>
          )}
        </div>

        {/* Section 2: 地图图层与状态多选过滤 */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-slate-700">地图显示选项</span>
            <span className="text-[10px] text-slate-400">点击勾选 / 取消</span>
          </div>

          <div className="space-y-2.5">
            {/* Option 1: 空闲中 */}
            <div 
              onClick={handleToggleIdle}
              className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/70 hover:border-emerald-300 flex items-center justify-between cursor-pointer transition shadow-2xs active:bg-slate-100 select-none"
            >
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-100/70 text-emerald-600 flex items-center justify-center font-bold">
                  <Car className="w-4.5 h-4.5" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-800">空闲中</span>
                  <p className="text-[10px] text-slate-400">显示当前已上线、空闲中的司机实时位置</p>
                </div>
              </div>

              {/* Checkbox */}
              <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition ${
                showIdle 
                  ? 'bg-emerald-500 border-emerald-600 text-white' 
                  : 'bg-white border-slate-300 text-transparent'
              }`}>
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
            </div>

            {/* Option 2: 做单中 */}
            <div 
              onClick={handleToggleBusy}
              className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/70 hover:border-red-300 flex items-center justify-between cursor-pointer transition shadow-2xs active:bg-slate-100 select-none"
            >
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-red-100/70 text-red-600 flex items-center justify-center font-bold">
                  <Car className="w-4.5 h-4.5" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-800">做单中</span>
                  <p className="text-[10px] text-slate-400">显示当前正在做单、报单中的司机实时位置</p>
                </div>
              </div>

              {/* Checkbox */}
              <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition ${
                showBusy 
                  ? 'bg-red-500 border-red-600 text-white' 
                  : 'bg-white border-slate-300 text-transparent'
              }`}>
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
            </div>

            {/* Option 3: 下线司机 */}
            <div 
              onClick={handleToggleOffline}
              className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/70 hover:border-slate-400 flex items-center justify-between cursor-pointer transition shadow-2xs active:bg-slate-100 select-none"
            >
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-slate-200/70 text-slate-600 flex items-center justify-center font-bold">
                  <PowerOff className="w-4.5 h-4.5" />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-800">下线司机</span>
                  <p className="text-[10px] text-slate-400">显示所有下线司机下线时候的最后位置</p>
                </div>
              </div>

              {/* Checkbox */}
              <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition ${
                showOffline 
                  ? 'bg-slate-700 border-slate-800 text-white' 
                  : 'bg-white border-slate-300 text-transparent'
              }`}>
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
            </div>

            {/* Option 4: 显示全名 */}
            <div 
              onClick={handleToggleFullName}
              className="p-3 rounded-xl bg-sky-50/70 border border-sky-200/80 hover:border-sky-300 flex items-center justify-between cursor-pointer transition shadow-2xs active:bg-sky-100/60 select-none"
            >
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center font-bold">
                  <Eye className="w-4.5 h-4.5" />
                </div>
                <div>
                  <span className="text-xs font-bold text-sky-950">显示全名</span>
                  <p className="text-[10px] text-sky-600/80">地图上直接显示司机真实全名，不隐藏师傅称呼</p>
                </div>
              </div>

              {/* Checkbox */}
              <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition ${
                showFullName 
                  ? 'bg-sky-600 border-sky-700 text-white' 
                  : 'bg-white border-slate-300 text-transparent'
              }`}>
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Page Bottom Buttons: 取消 / 确定 (Sticky fixed at bottom, fully visible, auto-adapted to all Android nav bars) */}
      <footer 
        className="p-3 bg-white border-t border-slate-200/80 flex items-center justify-between space-x-3 shrink-0 z-30 shadow-lg"
        style={{
          paddingBottom: 'calc(max(env(safe-area-inset-bottom, 0px), var(--android-nav-bar-height, 0px), 28px) + 10px)'
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 text-sm font-bold rounded-xl transition cursor-pointer"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 py-3 bg-sky-600 hover:bg-sky-700 active:scale-98 text-white text-sm font-bold rounded-xl transition cursor-pointer shadow-md shadow-sky-600/20"
        >
          确定
        </button>
      </footer>
    </div>
  );
}
