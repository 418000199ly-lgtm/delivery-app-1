import React, { useState, useEffect } from 'react';
import { 
  Telescope, 
  X, 
  ArrowLeft,
  UserPlus, 
  Trash2, 
  Check, 
  Settings, 
  ShieldCheck, 
  Sparkles,
  Phone,
  User,
  Search,
  ExternalLink
} from 'lucide-react';
import { db, collection, doc, setDoc, deleteDoc, onSnapshot, getBaseApiUrl } from '../lib/dbProxy';
import { safeSetItem } from '../utils/safeStorage';

interface HubbleManagerModalProps {
  userPhone: string;
  isDeveloper: boolean; // 15509601222
  onClose: () => void;
  onOpenHubbleSettings?: () => void;
}

interface HubbleAuthorizedDriver {
  phone: string;
  name: string;
  addedAt?: number;
  addedBy?: string;
}

export default function HubbleManagerModal({
  userPhone,
  isDeveloper,
  onClose,
  onOpenHubbleSettings
}: HubbleManagerModalProps) {
  const [authorizedList, setAuthorizedList] = useState<HubbleAuthorizedDriver[]>([]);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tipMessage, setTipMessage] = useState<string | null>(null);

  const [pendingDeleteDriver, setPendingDeleteDriver] = useState<{ phone: string; name: string } | null>(null);

  // Load authorized drivers list in real-time from db and localStorage fallback
  useEffect(() => {
    let unsubscribe = () => {};
    if (db) {
      const colRef = collection(db, 'hubble_authorized_drivers');
      unsubscribe = onSnapshot(colRef, (snapshot) => {
        const list: HubbleAuthorizedDriver[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            phone: docSnap.id || d.phone,
            name: d.name || `司机${(docSnap.id || d.phone).slice(-4)}`,
            addedAt: d.addedAt || Date.now(),
            addedBy: d.addedBy || '开发者'
          });
        });

        // Always update from snapshot (if empty, it means all removed)
        setAuthorizedList(list);
        safeSetItem('hubble_authorized_list_cache', JSON.stringify(list));
      }, (err) => {
        console.warn('Firestore hubble listener error, fallback to cache', err);
        try {
          const cached = localStorage.getItem('hubble_authorized_list_cache');
          if (cached) {
            setAuthorizedList(JSON.parse(cached));
          }
        } catch (_) {}
      });
    } else {
      // Offline / no db fallback
      try {
        const cached = localStorage.getItem('hubble_authorized_list_cache');
        if (cached) {
          setAuthorizedList(JSON.parse(cached));
        }
      } catch (_) {}
    }

    // Try fetch via Baota backend if available
    const fetchBaota = async () => {
      try {
        const baseUrl = getBaseApiUrl();
        const res = await fetch(`${baseUrl}/api/hubble/authorized_drivers`);
        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.list)) {
            setAuthorizedList(json.list);
          }
        }
      } catch (_) {}
    };
    fetchBaota();

    return () => {
      unsubscribe();
    };
  }, []);

  const showToast = (msg: string) => {
    setTipMessage(msg);
    setTimeout(() => setTipMessage(null), 2500);
  };

  // Add a driver to Hubble permission
  const handleAddDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = newPhone.replace(/\D/g, '').trim();
    if (!cleanPhone || cleanPhone.length < 7) {
      showToast('请输入有效的司机手机号');
      return;
    }

    if (cleanPhone === '15509601222') {
      showToast('开发者账号默认拥有全部哈勃权限');
      return;
    }

    if (authorizedList.some((d) => d.phone === cleanPhone)) {
      showToast('该司机已在哈勃权限列表中');
      return;
    }

    setIsSubmitting(true);
    const newEntry: HubbleAuthorizedDriver = {
      phone: cleanPhone,
      name: newName.trim() || `司机${cleanPhone.slice(-4)}`,
      addedAt: Date.now(),
      addedBy: userPhone
    };

    try {
      if (db) {
        await setDoc(doc(db, 'hubble_authorized_drivers', cleanPhone), newEntry);
      }
      // Also post to Baota REST API if online
      try {
        const baseUrl = getBaseApiUrl();
        await fetch(`${baseUrl}/api/hubble/authorize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newEntry)
        });
      } catch (_) {}

      const updated = [newEntry, ...authorizedList.filter((d) => d.phone !== cleanPhone)];
      setAuthorizedList(updated);
      safeSetItem('hubble_authorized_list_cache', JSON.stringify(updated));

      setNewPhone('');
      setNewName('');
      showToast(`已成功为 ${newEntry.name} 开通哈勃权限！`);
    } catch (err) {
      showToast('添加失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Trigger Remove a driver's Hubble permission (in-app modal)
  const handleRequestRemove = (phone: string, name: string) => {
    setPendingDeleteDriver({ phone, name });
  };

  // Confirm delete driver
  const handleConfirmRemove = async () => {
    if (!pendingDeleteDriver) return;
    const { phone, name } = pendingDeleteDriver;
    setPendingDeleteDriver(null);

    try {
      // 1. Instantly update local state & cache for instant UI feedback
      const filtered = authorizedList.filter((d) => d.phone !== phone);
      setAuthorizedList(filtered);
      safeSetItem('hubble_authorized_list_cache', JSON.stringify(filtered));

      // 2. Delete from Cloud Firestore
      if (db) {
        await deleteDoc(doc(db, 'hubble_authorized_drivers', phone));
      }

      // 3. Revoke on Baota server if available
      try {
        const baseUrl = getBaseApiUrl();
        await fetch(`${baseUrl}/api/hubble/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone })
        });
      } catch (_) {}

      showToast(`已成功取消 ${name} 的哈勃权限`);
    } catch (err) {
      showToast('移除失败，请重试');
    }
  };

  const filteredList = authorizedList.filter((d) => 
    d.phone.includes(searchFilter) || d.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

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
            <div className="flex items-center space-x-1.5">
              <h1 className="text-base font-extrabold text-slate-900 tracking-tight">哈勃管理中心</h1>
              {isDeveloper && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-amber-400 text-slate-950 uppercase">
                  开发者
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              {isDeveloper ? '权限分发与功能配置控制台' : '哈勃功能配置与调试'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center">
            <Telescope className="w-4.5 h-4.5" />
          </div>
        </div>
      </header>

      {/* Page Body - Scrollable Container */}
      <main className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 overscroll-contain touch-pan-y">
        {/* Action Button: 进入哈勃设置 */}
        <div className="p-3.5 bg-gradient-to-r from-sky-500 via-sky-600 to-blue-600 rounded-2xl text-white shadow-md shadow-sky-500/20">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center">
                <Settings className="w-4 h-4 text-white" />
              </div>
              <span className="text-xs font-bold">哈勃地图全局显示设置</span>
            </div>
            <span className="text-[10px] text-sky-100 font-medium">即时生效</span>
          </div>
          <p className="text-[11px] text-sky-100/90 mb-3 leading-relaxed">
            配置空闲司机、做单中司机、下线司机的地图显示状态，支持开启全名模式与一键搜索定位。
          </p>
          <button
            type="button"
            onClick={() => {
              if (onOpenHubbleSettings) {
                onOpenHubbleSettings();
              } else {
                showToast('已进入哈勃设置模式');
              }
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-sky-50 active:scale-98 text-sky-700 font-extrabold text-xs shadow-sm flex items-center justify-center space-x-2 transition cursor-pointer"
          >
            <Settings className="w-4 h-4 text-sky-600 animate-spin-slow" />
            <span>点击进入哈勃设置</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
          </button>
        </div>

        {/* Tip Toast Message if active */}
        {tipMessage && (
          <div className="p-2.5 rounded-xl bg-sky-600 text-white text-xs font-bold text-center animate-in fade-in duration-150 shadow-sm">
            {tipMessage}
          </div>
        )}

        {/* Developer Exclusive Area: 添加司机哈勃权限 & 司机权限列表 */}
        {isDeveloper ? (
          <div className="space-y-4">
            {/* Form: 添加司机哈勃权限 */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
              <div className="flex items-center space-x-1.5 mb-3">
                <UserPlus className="w-4 h-4 text-sky-600" />
                <span className="text-xs font-bold text-slate-800">添加司机哈勃权限</span>
              </div>
              
              <form onSubmit={handleAddDriver} className="space-y-2.5">
                <div className="grid grid-cols-5 gap-2">
                  <div className="col-span-3 relative">
                    <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                    <input
                      type="tel"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="司机手机号"
                      maxLength={11}
                      className="w-full pl-8 pr-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:border-sky-500 focus:bg-white"
                    />
                  </div>
                  <div className="col-span-2 relative">
                    <User className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-3" />
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="姓名/备注"
                      maxLength={8}
                      className="w-full pl-7 pr-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:border-sky-500 focus:bg-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !newPhone.trim()}
                  className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 active:scale-98 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm shadow-sky-600/20"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? '添加中...' : '授权该司机使用哈勃'}</span>
                </button>
              </form>
            </div>

            {/* Authorized Drivers List */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold text-slate-800">已授权司机列表</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-slate-100 text-slate-700">
                    {authorizedList.length}
                  </span>
                </div>

                {/* Developer Default Entry */}
                <span className="text-[10px] text-slate-400">开发者自动放行</span>
              </div>

              {/* Search filter if list > 3 */}
              {authorizedList.length > 3 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="按手机号或姓名过滤..."
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-800 focus:outline-hidden focus:bg-white"
                  />
                </div>
              )}

              {/* List Container */}
              <div className="space-y-2">
                {/* 15509601222 Developer Fixed Item */}
                <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-8 h-8 rounded-full bg-amber-500 text-white font-black text-xs flex items-center justify-center shadow-xs">
                      吴
                    </div>
                    <div>
                      <div className="flex items-center space-x-1.5">
                        <span className="text-xs font-extrabold text-slate-900">吴彦祖 (开发者)</span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-amber-500 text-white">
                          超级管理员
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-medium">15509601222</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-amber-600">全权常驻</span>
                </div>

                {filteredList.length === 0 ? (
                  <div className="py-6 text-center text-slate-400 text-xs">
                    {searchFilter ? '未匹配到符合条件的授权司机' : '暂无手动授权的司机，请在上方输入添加'}
                  </div>
                ) : (
                  filteredList.map((driver) => (
                    <div
                      key={driver.phone}
                      className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/70 hover:border-slate-300 flex items-center justify-between transition"
                    >
                      <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-full bg-sky-500 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                          {driver.name.slice(0, 1)}
                        </div>
                        <div>
                          <div className="flex items-center space-x-1.5">
                            <span className="text-xs font-bold text-slate-800">{driver.name}</span>
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-50 text-sky-600 border border-sky-200">
                              哈勃已授权
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-medium">{driver.phone}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRequestRemove(driver.phone, driver.name)}
                        className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 active:scale-95 transition cursor-pointer"
                        title="取消授权"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Non-developer authorized driver view */
          <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-800">您已获得哈勃功能使用权限</h4>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                开发者已为您开通哈勃专属功能，您可以点击上方按钮进入哈勃设置。
              </p>
            </div>
          </div>
        )}
      </main>

      {/* In-app safe confirmation modal for revoking driver Hubble permission */}
      {pendingDeleteDriver && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-xs bg-white rounded-2xl p-4 shadow-2xl border border-slate-200 space-y-3 animate-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-2.5 text-red-600">
              <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">取消哈勃权限</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              确定取消 <strong className="text-slate-900 font-bold">{pendingDeleteDriver.name}</strong> ({pendingDeleteDriver.phone}) 的哈勃权限吗？取消后该司机将无法使用哈勃功能。
            </p>
            <div className="flex items-center space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingDeleteDriver(null)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmRemove}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 active:scale-95 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-sm shadow-red-600/20"
              >
                确定取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Page Bottom Footer - 自动适配所有安卓手机底部导航栏与手势条，防止遮挡 */}
      <footer 
        className="p-3 bg-white border-t border-slate-200/80 flex items-center justify-end shrink-0 z-20"
        style={{
          paddingBottom: 'calc(max(env(safe-area-inset-bottom, 0px), var(--android-nav-bar-height, 0px), 28px) + 10px)'
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 text-sm font-bold rounded-xl transition cursor-pointer shadow-xs"
        >
          返回地图
        </button>
      </footer>
    </div>
  );
}
