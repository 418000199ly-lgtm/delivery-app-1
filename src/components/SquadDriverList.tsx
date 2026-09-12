import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ArrowLeft, 
  Users, 
  RefreshCw, 
  CheckCircle2, 
  Clock
} from 'lucide-react';
import { ChauffeurSettings } from '../types';
import { db, collection, onSnapshot, getBaseApiUrl } from '../lib/dbProxy';
import { formatDriverMaskedName } from '../utils/nameResolver';

interface SquadDriverListProps {
  userPhone?: string;
  settings?: ChauffeurSettings;
  isOnline?: boolean;
  currentTrip?: any;
  todayOrdersCount?: number;
  onClose: () => void;
}

interface DriverItem {
  phone: string;
  name: string;
  isMe: boolean;
  isOnline: boolean;
  isBusy: boolean; // true = 红色(做单、报单中); false = 绿色(空闲接单)
  todayOrders: number;
  lat?: number;
  lng?: number;
  uploadTime?: number;
  randomSortKey: number;
}

export default function SquadDriverList({
  userPhone = '15509601222',
  settings,
  isOnline = true,
  currentTrip,
  todayOrdersCount = 0,
  onClose
}: SquadDriverListProps) {
  const [squadList, setSquadList] = useState<any[]>([]);
  const [realtimeLocations, setRealtimeLocations] = useState<Record<string, any>>({});
  const [mySquadName, setMySquadName] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Normalize current user phone
  const effectiveMyPhone = String(
    userPhone || 
    (typeof window !== 'undefined' ? localStorage.getItem('dd_user_phone') : '') || 
    '15509601222'
  ).trim();

  const isMeMember = (phoneOrId?: string) => {
    const clean = String(phoneOrId || '').replace(/\D/g, '').trim();
    const myClean = effectiveMyPhone.replace(/\D/g, '').trim();
    return clean === myClean || clean === '15509601222';
  };

  // Full name of the current logged-in driver (only the current driver sees their full name)
  const currentDriverFullName = 
    mySquadName ||
    realtimeLocations[effectiveMyPhone]?.name ||
    realtimeLocations[effectiveMyPhone]?.driverName ||
    localStorage.getItem(`dd_custom_app_name_${effectiveMyPhone}`) ||
    localStorage.getItem('dd_admin_name') ||
    localStorage.getItem('dd_applicant_name') ||
    (settings as any)?.driverName ||
    (settings as any)?.name ||
    (effectiveMyPhone === '15509601222' ? '吴彦祖' : `司机${effectiveMyPhone.slice(-4)}`);

  // Current driver online status
  const isCurrentDriverOnline = typeof isOnline === 'boolean' 
    ? isOnline 
    : (typeof window !== 'undefined' ? localStorage.getItem('dd_is_online') === 'true' : true);

  // Current driver busy status: 做单、行程中、报单页面
  const isCurrentDriverBusy = Boolean(
    currentTrip || 
    localStorage.getItem('dd_driver_status_is_busy') === 'true' ||
    (settings as any)?.isBusy === true
  );

  // Today's completed orders for current driver (calculated from localStorage + props)
  const myComputedTodayOrders = useMemo(() => {
    let count = 0;
    try {
      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = now.getMonth();
      const curDay = now.getDate();
      const shiftDate = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const shiftYear = shiftDate.getFullYear();
      const shiftMonth = shiftDate.getMonth();
      const shiftDay = shiftDate.getDate();

      const ordersKey = effectiveMyPhone ? `dd_driver_orders_${effectiveMyPhone}` : 'dd_driver_orders';
      const userOrders = effectiveMyPhone ? localStorage.getItem(ordersKey) : null;
      const genericOrders = localStorage.getItem('dd_driver_orders');

      const seenIds = new Set<string>();
      const combined: any[] = [];

      const addItems = (raw: string | null) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            parsed.forEach((item: any) => {
              const id = item?.id ? String(item.id) : (item?.orderId ? String(item.orderId) : null);
              if (id) {
                if (!seenIds.has(id)) {
                  seenIds.add(id);
                  combined.push(item);
                }
              } else {
                combined.push(item);
              }
            });
          }
        } catch (_) {}
      };

      addItems(userOrders);
      addItems(genericOrders);

      combined.forEach((order: any) => {
        if (!order) return;
        let orderDate: Date | null = null;
        if (order.timestamp && typeof order.timestamp === 'number' && !isNaN(order.timestamp)) {
          orderDate = new Date(order.timestamp);
        } else {
          const dateStr = order.fullTimeStr || order.timeStr || order.createdTime || order.createdAt;
          if (dateStr && typeof dateStr === 'string') {
            const match = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
            if (match) {
              orderDate = new Date(
                parseInt(match[1], 10),
                parseInt(match[2], 10) - 1,
                parseInt(match[3], 10),
                match[4] ? parseInt(match[4], 10) : 0,
                match[5] ? parseInt(match[5], 10) : 0
              );
            } else {
              const parsed = new Date(dateStr);
              if (!isNaN(parsed.getTime())) orderDate = parsed;
            }
          } else if (order.id && !isNaN(Number(order.id))) {
            const ts = Number(order.id);
            if (ts > 1500000000000 && ts < 3000000000000) {
              orderDate = new Date(ts);
            }
          }
        }

        if (orderDate) {
          const isCalendarToday = (
            orderDate.getFullYear() === curYear &&
            orderDate.getMonth() === curMonth &&
            orderDate.getDate() === curDay
          );
          const orderShift = new Date(orderDate.getTime() - 6 * 60 * 60 * 1000);
          const isShiftToday = (
            orderShift.getFullYear() === shiftYear &&
            orderShift.getMonth() === shiftMonth &&
            orderShift.getDate() === shiftDay
          );

          if (isCalendarToday || isShiftToday) {
            count++;
          }
        }
      });
    } catch (_) {}

    return Math.max(count, todayOrdersCount);
  }, [effectiveMyPhone, todayOrdersCount]);

  // Subscribe and poll squad members
  useEffect(() => {
    let unsubscribe = () => {};
    if (db) {
      const q = collection(db, 'squad_members');
      unsubscribe = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const phone = String(data?.phone || docSnap.id || '').trim();
          const name = String(data?.name || data?.driverName || '').trim();
          if (isMeMember(phone)) {
            if (name) setMySquadName(name);
          } else if (phone && name) {
            list.push({ id: docSnap.id, phone, name, ...data });
          }
        });
        setSquadList(list);
      }, () => {});
    }

    const fetchBaotaSquad = async () => {
      try {
        const baseUrl = getBaseApiUrl();
        const res = await fetch(`${baseUrl}/api/squad/members`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.list)) {
            const myEntry = data.list.find((m: any) => isMeMember(m?.phone || m?.id));
            if (myEntry && (myEntry.name || myEntry.driverName)) {
              setMySquadName(myEntry.name || myEntry.driverName);
            }
            const filtered = data.list.filter((m: any) => {
              const phone = String(m?.phone || m?.id || '').trim();
              return phone && !isMeMember(phone);
            });
            setSquadList(filtered);
          }
        }
      } catch (_) {}
    };

    fetchBaotaSquad();
    const squadInterval = setInterval(fetchBaotaSquad, 4000);

    return () => {
      unsubscribe();
      clearInterval(squadInterval);
    };
  }, [effectiveMyPhone]);

  // Subscribe and poll realtime locations
  useEffect(() => {
    let unsubscribe = () => {};
    if (db) {
      const q = collection(db, 'driver_locations');
      unsubscribe = onSnapshot(q, (snapshot) => {
        const locMap: Record<string, any> = {};
        snapshot.forEach((docSnap) => {
          locMap[docSnap.id] = docSnap.data();
        });
        setRealtimeLocations((prev) => ({ ...prev, ...locMap }));
      }, () => {});
    }

    const fetchBaotaLocations = async () => {
      try {
        const baseUrl = getBaseApiUrl();
        const res = await fetch(`${baseUrl}/api/driver/locations`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.locations) {
            setRealtimeLocations((prev) => ({ ...prev, ...data.locations }));
          }
        }
      } catch (_) {}
    };

    fetchBaotaLocations();
    const interval = setInterval(fetchBaotaLocations, 4000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  // Stable random seed assigned per session for other drivers
  const sessionRandomSeedMap = useRef<Map<string, number>>(new Map());

  // Merge and calculate driver list according to strict requirements:
  // 1. 只显示小队内所有上线的司机 (Offline drivers strictly hidden)
  // 2. 列表中第一名永远是自己 (例如：吴彦祖，今日成单多少)
  // 3. 然后随机排名其他上线的司机 (第二名，李师傅，今日成单多少)
  // 4. 空闲的司机显示绿色，做单和报单页面的司机显示红色
  // 5. 只有自己显示全名，其他上线司机显示隐藏名字 (李扬 -> 李师傅，王元平 -> 王师傅)
  const sortedOnlineDrivers = useMemo(() => {
    const list: DriverItem[] = [];

    // 1. Self (always first if online)
    if (isCurrentDriverOnline) {
      list.push({
        phone: effectiveMyPhone,
        name: currentDriverFullName,
        isMe: true,
        isOnline: true,
        isBusy: isCurrentDriverBusy,
        todayOrders: myComputedTodayOrders,
        randomSortKey: -1 // Highest priority
      });
    }

    // 2. Aggregate other drivers
    const candidateMap = new Map<string, {
      phone: string;
      name: string;
      isOnline: boolean;
      isBusy: boolean;
      todayOrders: number;
      uploadTime: number;
    }>();

    squadList.forEach((member) => {
      const phone = String(member.phone || member.id || '').replace(/\D/g, '').trim();
      if (!phone || isMeMember(phone)) return;
      const name = member.name || member.driverName || '';
      candidateMap.set(phone, {
        phone,
        name,
        isOnline: Boolean(member.isOnline === true || member.isOnline === 'true'),
        isBusy: Boolean(member.isBusy === true || member.isBusy === 'true'),
        todayOrders: Number(member.todayOrders || 0),
        uploadTime: member.lastUpdatedTime ? new Date(member.lastUpdatedTime).getTime() : 0
      });
    });

    Object.keys(realtimeLocations).forEach((phoneKey) => {
      const phone = String(phoneKey || '').replace(/\D/g, '').trim();
      if (!phone || isMeMember(phone)) return;
      const liveLoc = realtimeLocations[phoneKey];
      if (!liveLoc) return;

      const existing = candidateMap.get(phone) || {
        phone,
        name: '',
        isOnline: false,
        isBusy: false,
        todayOrders: 0,
        uploadTime: 0
      };

      const isOnlineVal = liveLoc.isOnline !== undefined
        ? Boolean(liveLoc.isOnline === true || liveLoc.isOnline === 'true')
        : existing.isOnline;
      const isBusyVal = liveLoc.isBusy !== undefined
        ? Boolean(liveLoc.isBusy === true || liveLoc.isBusy === 'true')
        : existing.isBusy;
      const uploadTimeVal = liveLoc.timestamp
        ? Number(liveLoc.timestamp)
        : (liveLoc.lastUpdatedTime ? new Date(liveLoc.lastUpdatedTime).getTime() : existing.uploadTime);
      const nameVal = liveLoc.driverName || liveLoc.name || existing.name;
      const todayOrdersVal = liveLoc.todayOrders !== undefined ? Number(liveLoc.todayOrders) : existing.todayOrders;

      candidateMap.set(phone, {
        phone,
        name: nameVal,
        isOnline: isOnlineVal,
        isBusy: isBusyVal,
        todayOrders: todayOrdersVal,
        uploadTime: uploadTimeVal
      });
    });

    // 3. Filter other drivers: only ONLINE and active heartbeat within 150s
    const otherOnlineDrivers: DriverItem[] = [];
    candidateMap.forEach((driver) => {
      if (isMeMember(driver.phone)) return;
      if (!driver.isOnline) return;

      // Heartbeat timeout check: If more than 150 seconds silent, consider offline
      if (driver.uploadTime > 0 && (Date.now() - driver.uploadTime > 150000)) {
        return;
      }

      // Assign stable random sort key per driver for consistent UX during session
      if (!sessionRandomSeedMap.current.has(driver.phone)) {
        sessionRandomSeedMap.current.set(driver.phone, Math.random());
      }
      const randomSortKey = sessionRandomSeedMap.current.get(driver.phone) || Math.random();

      // Masked name for all other drivers (e.g. 李扬 -> 李师傅)
      const rawName = driver.name || '代驾司机';
      const maskedName = formatDriverMaskedName(rawName);

      otherOnlineDrivers.push({
        phone: driver.phone,
        name: maskedName,
        isMe: false,
        isOnline: true,
        isBusy: driver.isBusy,
        todayOrders: driver.todayOrders,
        uploadTime: driver.uploadTime,
        randomSortKey
      });
    });

    // Sort other drivers randomly
    otherOnlineDrivers.sort((a, b) => a.randomSortKey - b.randomSortKey);

    return [...list, ...otherOnlineDrivers];
  }, [
    isCurrentDriverOnline, 
    effectiveMyPhone, 
    currentDriverFullName, 
    isCurrentDriverBusy, 
    myComputedTodayOrders, 
    squadList, 
    realtimeLocations
  ]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    // Trigger fresh random sort for other drivers on manual refresh
    sessionRandomSeedMap.current.clear();
    setTimeout(() => {
      setIsRefreshing(false);
    }, 400);
  };

  return (
    <div 
      className="absolute inset-0 z-50 bg-[#F4F6F9] flex flex-col h-full w-full overflow-hidden animate-in slide-in-from-right duration-250 select-none"
    >
      {/* 手机顶部电量/信号/状态栏安全占位区 (保留系统电量、网络信号、时间与打孔屏空间，彻底避免遮挡) */}
      <div 
        className="w-full shrink-0 bg-white select-none pointer-events-none"
        style={{ 
          height: 'max(env(safe-area-inset-top, 0px), var(--status-bar-height, 0px), 36px)' 
        }} 
      />

      {/* Top Mobile App Header with Safe Area spacing */}
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
              <h1 className="text-base font-extrabold text-slate-900 tracking-tight">小队司机列表</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200/60">
                {sortedOnlineDrivers.length}人在线
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">仅展示小队内所有在线司机</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleManualRefresh}
            className={`w-9 h-9 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200/60 flex items-center justify-center text-slate-600 active:scale-95 transition cursor-pointer ${isRefreshing ? 'animate-spin text-emerald-600' : ''}`}
            title="刷新列表"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Driver List Viewport */}
      <main className="flex-1 min-h-0 w-full overflow-y-auto px-3.5 py-3 space-y-2.5 overscroll-contain touch-pan-y">
        {sortedOnlineDrivers.length === 0 ? (
          <div className="w-full h-64 flex flex-col items-center justify-center text-slate-400 space-y-2">
            <Users className="w-12 h-12 text-slate-300 stroke-1" />
            <p className="text-xs font-medium">当前暂无在线小队司机</p>
            <p className="text-[11px] text-slate-400">请点击首页上线或稍后刷新</p>
          </div>
        ) : (
          sortedOnlineDrivers.map((driver, index) => {
            const rank = index + 1;
            const isMe = driver.isMe;
            const isBusy = driver.isBusy; // true: 红色(做单、报单中); false: 绿色(空闲)

            return (
              <div
                key={driver.phone || `driver-${index}`}
                className={`w-full rounded-2xl p-3.5 transition-all duration-150 border ${
                  isBusy
                    ? 'bg-gradient-to-r from-red-50/70 via-white to-white border-red-300 shadow-xs ring-1 ring-red-500/15'
                    : 'bg-gradient-to-r from-emerald-50/70 via-white to-white border-emerald-300 shadow-xs ring-1 ring-emerald-500/15'
                }`}
              >
                <div className="flex items-center justify-between">
                  {/* Left: Rank & Avatar & Name */}
                  <div className="flex items-center space-x-3 min-w-0">
                    {/* Rank Badge */}
                    <div className="flex items-center justify-center shrink-0">
                      {rank === 1 ? (
                        <div className="w-6 h-6 rounded-full bg-amber-400 text-amber-950 font-black text-xs flex items-center justify-center shadow-xs">
                          1
                        </div>
                      ) : rank === 2 ? (
                        <div className="w-6 h-6 rounded-full bg-slate-300 text-slate-800 font-bold text-xs flex items-center justify-center">
                          2
                        </div>
                      ) : rank === 3 ? (
                        <div className="w-6 h-6 rounded-full bg-amber-600/30 text-amber-900 font-bold text-xs flex items-center justify-center">
                          3
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 font-medium text-xs flex items-center justify-center">
                          {rank}
                        </div>
                      )}
                    </div>

                    {/* Driver Avatar with Status Indicator Dot (Green = 空闲, Red = 做单/报单中) */}
                    <div className="relative shrink-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shadow-2xs ${
                        isBusy 
                          ? 'bg-red-500 text-white' 
                          : 'bg-emerald-600 text-white'
                      }`}>
                        {driver.name.slice(0, 1)}
                      </div>
                      {/* Realtime Status Dot: Green (Idle) or Red (Busy/Reporting) */}
                      <span 
                        className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                          isBusy ? 'bg-red-500' : 'bg-emerald-500'
                        }`} 
                        title={isBusy ? '做单/报单中' : '空闲接单'}
                      />
                    </div>

                    {/* Driver Details */}
                    <div className="min-w-0 flex flex-col">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-sm font-black text-slate-900 truncate">
                          {driver.name}
                        </span>
                        {isMe && (
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-black text-white ${
                            isBusy ? 'bg-red-500' : 'bg-emerald-600'
                          }`}>
                            我
                          </span>
                        )}
                      </div>
                      
                      {/* Driver Status Subtitle Line (Matches w10 style) */}
                      <div className="flex items-center space-x-1.5 mt-0.5">
                        {isBusy ? (
                          <span className="inline-flex items-center text-[10px] font-bold text-red-600">
                            <Clock className="w-2.5 h-2.5 mr-0.5" />
                            做单中
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[10px] font-bold text-emerald-600">
                            <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                            空闲
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400">
                          {isMe ? '实时在线' : '小队队员'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Today Orders Count */}
                  <div className="flex flex-col items-end shrink-0 pl-2">
                    <span className="text-[11px] text-slate-400 font-medium">今日成单</span>
                    <div className="flex items-baseline space-x-0.5 mt-0.5">
                      <span className={`text-base font-black tracking-tight ${
                        driver.todayOrders > 0 ? 'text-slate-900' : 'text-slate-400'
                      }`}>
                        {driver.todayOrders}
                      </span>
                      <span className="text-[11px] text-slate-400 font-medium">单</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </main>

      {/* Bottom Safe Area Navigation - 自动适配所有安卓手机底部导航栏与手势条，防止遮挡 */}
      <footer 
        className="w-full bg-white border-t border-slate-200/70 px-4 py-3 shrink-0 flex items-center justify-center"
        style={{
          paddingBottom: 'calc(max(env(safe-area-inset-bottom, 0px), var(--android-nav-bar-height, 0px), 28px) + 10px)'
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 text-sm font-bold transition cursor-pointer flex items-center justify-center space-x-1.5 shadow-xs"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回地图</span>
        </button>
      </footer>
    </div>
  );
}
