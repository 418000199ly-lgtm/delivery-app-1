import React, { useState, useEffect, useRef } from 'react';
import { geocodeAddress, isValidCoords, calculateHaversineDistanceKm, formatDistance, calculateOrderDriverDistance, DEFAULT_YINCHUAN_COORDS } from '../utils/geocoding';
import { 
  ShoppingBag, 
  Users, 
  ClipboardCheck, 
  ClipboardList, 
  Settings, 
  QrCode, 
  MessageSquare, 
  MapPin, 
  Bell, 
  AlertCircle,
  Play,
  X,
  ChevronRight,
  ChevronLeft,
  Calendar,
  Gift,
  Crown,
  Edit2,
  LogOut,
  User,
  Globe,
  UploadCloud,
  FileCheck2,
  Lock,
  Stamp,
  UserCheck2,
  CheckCircle2,
  Flame,
  Camera,
  Clock,
  Trash2,
  Search,
  Shield,
  ShieldAlert,
  UserCheck,
  UserX,
  Check,
  Loader2,
  Briefcase,
  Phone,
  ArrowLeft,
  Send,
  ShieldCheck,
  Smartphone,
  Info,
  Headset,
  FileX
} from 'lucide-react';
import { ChauffeurSettings, DriverStats, TripState, BillingRules, checkVipActive } from '../types';
import DriverIllustration from './DriverIllustration';
import DispatchValetOrder from './DispatchValetOrder';
import { db, doc, getDoc, updateDoc, collection, onSnapshot, setDoc, getDocs, deleteDoc } from '../lib/dbProxy';
import { CITY_GROUPS, ALL_CITIES_FLAT } from '../constants/cities';
import { resolveAndSyncDuplicateNames } from '../utils/nameResolver';
import { speakText, initAudioUnlock } from '../utils/speech';
import vipPaymentMockupImg from '../assets/images/vip_payment_mockup_1782906470780.jpg';
import wechatPayQrImg from '../assets/images/wechat_pay_qr_1782906451645.jpg';
import { READY_DRIVER_BASE64, READY_DRIVER_PATH, VALET_CAR_BANNER_BASE64, VALET_CAR_BANNER_PATH } from '../assets/images/driverImageConstants';

interface HomeViewProps {
  settings: ChauffeurSettings;
  stats: DriverStats;
  currentTrip: TripState | null;
  billingRules: BillingRules;
  onNavigate: (view: string) => void;
  onStartTrip: (trip: TripState) => void;
  onUpdateStats: (update: Partial<DriverStats>) => void;
  onToggleOnline: (isOnline: boolean) => void;
  isOnline: boolean;
  onUpdateSettings: (updated: ChauffeurSettings) => void;
  userPhone?: string | null;
  onLogout?: () => void;
  driverCoords?: { lat: number; lng: number } | null;
  userRole?: string;
  userTeamCity?: string;
  xianyuUrl?: string;
}

const filterOrdersWithinSixMonths = (orders: any[]): any[] => {
  if (!Array.isArray(orders)) return [];
  const now = new Date();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(now.getMonth() - 6);

  return orders.filter(order => {
    if (!order) return false;

    // Filter out old mock orders requested to be removed
    if (order.id && typeof order.id === 'string' && order.id.startsWith('mock')) return false;
    const startLoc = (order.startLocation || '').toString();
    if (
      startLoc.includes('融媒体中心') ||
      startLoc.includes('湖滨东街支行') ||
      startLoc.includes('公园华府')
    ) {
      return false;
    }

    if (order.timestamp) {
      return new Date(order.timestamp) >= sixMonthsAgo;
    }
    if (order.id && !isNaN(Number(order.id))) {
      const ts = Number(order.id);
      if (ts > 1500000000000) {
        return new Date(ts) >= sixMonthsAgo;
      }
    }
    if (order.timeStr && typeof order.timeStr === 'string') {
      const parts = order.timeStr.match(/(\d+)-(\d+)\s+(\d+):(\d+)/);
      if (parts) {
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const hour = parseInt(parts[3], 10);
        const min = parseInt(parts[4], 10);
        
        const orderDate = new Date(now.getFullYear(), month, day, hour, min);
        if (orderDate > now) {
          orderDate.setFullYear(now.getFullYear() - 1);
        }
        return orderDate >= sixMonthsAgo;
      }
    }
    return true;
  });
};

const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; 
};

export default function HomeView({
  settings,
  stats,
  currentTrip,
  billingRules,
  onNavigate,
  onStartTrip,
  onUpdateStats,
  onToggleOnline,
  isOnline,
  onUpdateSettings,
  userPhone,
  onLogout,
  driverCoords,
  userRole = '普通司机',
  userTeamCity = '',
  xianyuUrl = 'https://www.goofish.com'
}: HomeViewProps) {
  const effectiveCity = (userRole && userRole !== '开发者司机' && userTeamCity) ? userTeamCity : (settings?.city || '银川市');

  const [sliderPos, setSliderPos] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const [onlineTime, setOnlineTime] = useState(0);
  const touchStartRef = useRef<number>(0);
  const sliderWidthRef = useRef<HTMLDivElement>(null);

  // User Profile dialog state
  const [showUserModal, setShowUserModal] = useState(false);

  // Redemption code states
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [isMatching, setIsMatching] = useState(false);
  const [modalMessage, setModalMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [toastMsg, setToastMsg] = useState<string>('');

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg('');
    }, 2500);
  };

  // Custom App Name states
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState('');

  // System messages and unread management
  const [dbMessages, setDbMessages] = useState<any[]>([]);
  const [viewedMessageIds, setViewedMessageIds] = useState<string[]>(() => {
    try {
      const cached = localStorage.getItem('dd_viewed_message_ids');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [showMessagesModal, setShowMessagesModal] = useState(false);

  // --- Online Application States & Real-time Subscription ---
  const [showOnlineAppModal, setShowOnlineAppModal] = useState(false);
  
  // --- Quick App Dispatch Modal States ---
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [showMerchantDispatchModal, setShowMerchantDispatchModal] = useState(false);
  const [dispatchStartPlace, setDispatchStartPlace] = useState('');
  const [dispatchPhone, setDispatchPhone] = useState('');
  const [dispatchSuggestions, setDispatchSuggestions] = useState<any[]>([]);
  const [dispatchSelectedCoords, setDispatchSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dispatchingOrder, setDispatchingOrder] = useState(false);
  const [dispatchCity, setDispatchCity] = useState(effectiveCity);
  const [dispatchCityQuery, setDispatchCityQuery] = useState('');
  const [showDispatchCityDropdown, setShowDispatchCityDropdown] = useState(false);

  // --- Squad Management States ---
  const [squadMembers, setSquadMembers] = useState<any[]>([]);
  const [removedMemberPhones, setRemovedMemberPhones] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('dd_removed_squad_phones_v2');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const syncRemoved = () => {
      try {
        const saved = localStorage.getItem('dd_removed_squad_phones_v2');
        if (saved) setRemovedMemberPhones(JSON.parse(saved));
      } catch (_) {}
    };
    window.addEventListener('storage', syncRemoved);
    window.addEventListener('focus', syncRemoved);
    const timer = setInterval(syncRemoved, 1500);
    return () => {
      window.removeEventListener('storage', syncRemoved);
      window.removeEventListener('focus', syncRemoved);
      clearInterval(timer);
    };
  }, []);

  const getActiveSquadDriverCount = () => {
    const removedSet = new Set(removedMemberPhones.map(p => String(p).trim()));
    const activeDriverPhones = new Set<string>();

    squadMembers.forEach((m: any) => {
      const phone = String(m.phone || m.id || '').trim();
      const name = String(m.name || '').trim();
      if (!phone) return;
      if (removedSet.has(phone) || removedSet.has(name) || removedSet.has(String(m.id))) return;

      const isMerchant = m.role?.includes('商户') || m.role?.includes('商家') || m.userRole?.includes('商户') || m.userRole?.includes('商家') || phone === '15121904440';
      if (isMerchant) return;

      const st = m.status || m.approvalStatus || '已通过';
      if (['已拒绝', 'rejected', '拒绝'].includes(st)) return;

      activeDriverPhones.add(phone);
    });

    // Ensure default admin/developer driver 15509601222 is included if not removed
    if (!removedSet.has('15509601222')) {
      activeDriverPhones.add('15509601222');
    }

    return activeDriverPhones.size;
  };
  const [teamConfig, setTeamConfig] = useState<{ teamName: string } | null>(null);
  const [searchSquadPhone, setSearchSquadPhone] = useState('');
  const [searchSquadResult, setSearchSquadResult] = useState<{
    exists: boolean;
    squadMember: any | null;
    driverUser: any | null;
    checked: boolean;
  } | null>(null);
  const [squadDriverName, setSquadDriverName] = useState('');
  const [isSearchingSquad, setIsSearchingSquad] = useState(false);
  const [isEditingSquadName, setIsEditingSquadName] = useState(false);
  const [tempSquadName, setTempSquadName] = useState('');
  const [searchSquadError, setSearchSquadError] = useState('');
  const [squadKickConfirm, setSquadKickConfirm] = useState<{ phone: string; name?: string } | null>(null);
  const [squadNotification, setSquadNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // --- Order Selection Hall States & Real-time Subscription ---
  const [hallOrders, setHallOrders] = useState<any[]>([]);
  const prevHallOrderIdsRef = useRef<Set<string> | null>(null);

  // Auto-acquire real browser GPS on HomeView mount to ensure driver distance accuracy in hall
  useEffect(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        localStorage.setItem('dd_bg_driver_coords_lat', lat.toString());
        localStorage.setItem('dd_bg_driver_coords_lng', lng.toString());
      },
      () => {},
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  }, []);

  // Voice broadcast announcement whenever a new order arrives in selection hall
  useEffect(() => {
    const currentIds = new Set(hallOrders.map((o: any) => o.id || o.orderId));
    if (prevHallOrderIdsRef.current !== null) {
      let hasNew = false;
      for (const id of currentIds) {
        if (id && !prevHallOrderIdsRef.current.has(id)) {
          hasNew = true;
          break;
        }
      }
      if (hasNew) {
        speakText('选单大厅有新订单了');
      }
    }
    prevHallOrderIdsRef.current = currentIds;
  }, [hallOrders]);

  useEffect(() => {
    const handleOrdersUpdated = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
        if (saved.length === 0) {
          setHallOrders([]);
        } else {
          const validIds = new Set(
            saved
              .filter((o: any) => 
                o && 
                o.in_hall !== false && 
                (o.status === 'hall' || (!o.status && o.in_hall === true)) && 
                !o.dispatchedDriverPhone &&
                o.status !== 'cancelled' && 
                o.status !== 'dispatched' && 
                o.status !== 'claimed' && 
                o.status !== 'accepted' && 
                o.status !== 'taken' && 
                o.status !== 'arrived' && 
                o.status !== 'serving' && 
                o.status !== 'completed'
              )
              .map((o: any) => o.id || o.orderId)
          );
          setHallOrders((prev) => prev.filter((ord: any) => validIds.has(ord.id) || validIds.has(ord.orderId)));
        }
      } catch (_) {
        setHallOrders([]);
      }
    };

    window.addEventListener('merchant_orders_updated', handleOrdersUpdated);

    if (!db) return () => window.removeEventListener('merchant_orders_updated', handleOrdersUpdated);
    try {
      const q = collection(db, 'merchant_orders');
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        const now = Date.now();
        const TIMEOUT_20_MIN = 20 * 60 * 1000;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const isHallOrder = Boolean(
            data && 
            data.in_hall !== false && 
            (data.status === 'hall' || (!data.status && data.in_hall === true)) && 
            !data.dispatchedDriverPhone &&
            data.status !== 'cancelled' && 
            data.status !== 'dispatched' && 
            data.status !== 'claimed' && 
            data.status !== 'accepted' && 
            data.status !== 'taken' && 
            data.status !== 'arrived' && 
            data.status !== 'serving' && 
            data.status !== 'completed'
          );

          if (isHallOrder) {
            const age = data.timestamp ? (now - data.timestamp) : 0;
            if (age >= TIMEOUT_20_MIN) {
              // Auto cancel expired hall orders after 20 minutes
              setDoc(doc(db, 'merchant_orders', docSnap.id), {
                status: 'cancelled',
                statusCategory: '已取消',
                cancelReason: '选单大厅20分钟无人接单，系统自动取消',
                cancelledAt: now
              }, { merge: true }).catch(() => {});
            } else {
              list.push({ id: docSnap.id, ...data });
            }
          }
        });
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setHallOrders(list);
      }, (err) => {
        console.warn("Error listening to merchant_orders in HomeView:", err);
      });
      return () => {
        window.removeEventListener('merchant_orders_updated', handleOrdersUpdated);
        unsubscribe();
      };
    } catch (e) {
      console.warn("Failed to subscribe to merchant_orders:", e);
      return () => window.removeEventListener('merchant_orders_updated', handleOrdersUpdated);
    }
  }, []);

  // --- Order Selection Hall Simulation Removed for Real Dispatches ---
  useEffect(() => {
    // Only real orders are dispatched now
  }, []);

  const handleClaimHallOrder = async (ord: any) => {
    // 检查小队内的商户、商家不可接单（只能下单代叫，管理人员除外）
    const userRoleStr = userRole || settings?.role || '';
    const isPureMerchant = (
      userRoleStr.includes('商户') || 
      userRoleStr.includes('商家') || 
      userRoleStr.includes('店铺') || 
      userRoleStr.includes('门店')
    );
    const isManagement = ['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机', '总指挥官', '开发者'].some(r => userRoleStr.includes(r));
    if (isPureMerchant && !isManagement) {
      alert('⚠️ 提示：商户与商家仅支持下单代叫，无接单权限！');
      return;
    }

    if (!checkApprovalStatus() || ord?.isSimulated) {
      alert('您没有加入小队，无商户代叫订单权限！');
      return;
    }

    if (!isOnline) {
      alert('⚠️ 提示：您当前处于【下线】状态，无法点击抢单！\n\n加入小队的所有司机只有在【上线】状态下才能在选单大厅点击抢单。请先在首页底部右滑上线后再试。');
      return;
    }

    const savedLat = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lat') : null;
    const savedLng = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lng') : null;
    const currentDriverCoords = (driverCoords && isValidCoords(driverCoords.lat, driverCoords.lng))
      ? driverCoords
      : (savedLat && savedLng ? { lat: Number(savedLat), lng: Number(savedLng) } : DEFAULT_YINCHUAN_COORDS);

    const { displayDistText: finalDistText, resolvedLat: finalLat, resolvedLng: finalLng } = calculateOrderDriverDistance(
      ord.startLocation,
      ord.resolvedLat || ord.passengerLat,
      ord.resolvedLng || ord.passengerLng,
      currentDriverCoords
    );

    try {
      if (db) {
        await setDoc(doc(db, 'merchant_orders', ord.id), {
          status: 'claimed',
          dispatchedDriverPhone: userPhone || ''
        }, { merge: true });
      }

      try {
        const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
        const updated = saved.filter((o: any) => o.id !== ord.id);
        localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(updated));
      } catch (_) {}

      if (db && userPhone) {
        await setDoc(doc(db, 'passenger_links', userPhone), {
          passengerPhone: ord.passengerPhone,
          startLocation: ord.startLocation,
          destination: '由司机根据现场口头协商规划行程',
          status: 'submitted',
          timestamp: Date.now(),
          isValetOrder: true,
          isPlatformDispatch: true,
          approxPrice: '未知',
          calculatedTotalFee: 40.00,
          estimatedPrice: '40.00',
          orderRemark: ord.orderRemark || '商户代叫',
          needScooter: ord.needScooter,
          scheduledTime: ord.scheduledTime,
          passengerLat: finalLat,
          passengerLng: finalLng,
          distanceText: finalDistText,
          orderId: ord.id
        });
      }

      triggerToast('✓ 已成功接单！正为您弹出的新来单页面...');
    } catch (err: any) {
      alert('接单失败：' + err.message);
    }
  };

  // --- Apply to Join Squad Modal States ---
  const [showApplySquadModal, setShowApplySquadModal] = useState(false);
  const [showAdminDispatchView, setShowAdminDispatchView] = useState(false);
  const initialDriverName = (settings as any)?.driverName || (settings as any)?.name || '';
  const [applyName, setApplyName] = useState(initialDriverName === '张三' ? '' : initialDriverName);
  const [applyPhone, setApplyPhone] = useState(userPhone || '13812345678');
  const [applyRemarks, setApplyRemarks] = useState('');
  const [isSubmittingApply, setIsSubmittingApply] = useState(false);
  const [isReapplying, setIsReapplying] = useState(false);

  useEffect(() => {
    if (userPhone) {
      setApplyPhone(userPhone);
    }
  }, [userPhone]);

  // 秒级提交申请加入小队处理函数
  const processApplicationSubmission = (closeModalCallback: () => void) => {
    if (!applyName.trim()) {
      setLocalAlert({ title: '提示', message: '请输入申请人真实姓名', type: 'error' });
      return;
    }
    const currentPhone = (userPhone || applyPhone || '').trim();
    if (!currentPhone || !/^1[3-9]\d{9}$/.test(currentPhone)) {
      setLocalAlert({ title: '提示', message: '请输入正确的11位手机号码', type: 'error' });
      return;
    }

    setIsSubmittingApply(true);

    // 100ms 秒级提交响应
    setTimeout(() => {
      try {
        const noteText = applyRemarks.trim() || '身份信息确认填写正确，申请加入小队！';
        
        // 1. 本地存储更新 dd_applicants_v2
        const savedApps = localStorage.getItem('dd_applicants_v2');
        const existingApps = savedApps ? JSON.parse(savedApps) : [];
        const newApp = {
          id: `app-${Date.now()}`,
          name: applyName.trim(),
          phone: currentPhone,
          status: '待审核',
          note: noteText,
          showReasons: false,
          selectedReasons: [],
          createdAt: new Date().toLocaleString()
        };
        const updatedApps = [newApp, ...existingApps.filter((a: any) => a.phone !== currentPhone)];
        localStorage.setItem('dd_applicants_v2', JSON.stringify(updatedApps));

        // 2. 本地存储更新 dd_squad_members_v2 (支持国内宝塔面板单机部署)
        const savedMembers = localStorage.getItem('dd_squad_members_v2');
        const existingMembers = savedMembers ? JSON.parse(savedMembers) : [];
        const updatedMembers = [
          {
            id: currentPhone,
            phone: currentPhone,
            name: applyName.trim(),
            role: '普通司机',
            status: '待审核',
            note: noteText,
            city: effectiveCity || '银川市',
            createdAt: Date.now()
          },
          ...existingMembers.filter((m: any) => m.phone !== currentPhone)
        ];
        localStorage.setItem('dd_squad_members_v2', JSON.stringify(updatedMembers));

        // 3. 兼容写入 Firestore (在非国内环境或配置了DB时同步，报错静默容错)
        if (db) {
          setDoc(doc(db, 'squad_members', currentPhone), {
            name: applyName.trim(),
            phone: currentPhone,
            status: '待审核',
            note: noteText,
            lastUpdatedTime: new Date().toLocaleString()
          }, { merge: true }).catch(() => {});
        }
      } catch (_) {}

      setIsSubmittingApply(false);
      setIsReapplying(false);
      closeModalCallback();
      setLocalAlert({
        title: '申请提交成功',
        message: '🎉 您的入队申请已成功提交！后台（开发者司机/老板司机/管理司机/派单员司机）将会在 1 个工作日内完成审核批复。',
        type: 'info'
      });
    }, 100);
  };

  const checkApprovalStatus = () => {
    // 开发者司机、城市老板司机、城市管理司机、城市派单员司机不用申请加入小队就可以接收到真实订单
    if (['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机'].includes(userRole)) {
      return true;
    }

    if (isReapplying) return false;
    const currentPhone = (userPhone || applyPhone || '').trim();
    if (!currentPhone) return false;

    // 1. Check in localStorage dd_squad_members_v2
    try {
      const savedM = localStorage.getItem('dd_squad_members_v2');
      if (savedM) {
        const members = JSON.parse(savedM);
        const myMember = members.find((m: any) => m.phone === currentPhone);
        if (myMember && ['已通过', 'approved', '通过'].includes(myMember.status)) {
          return true;
        }
      }
    } catch (_) {}

    // 2. Check in state squadMembers
    const memberInState = squadMembers.find((m: any) => m.phone === currentPhone);
    if (memberInState && ['已通过', 'approved', '通过'].includes(memberInState.status)) {
      return true;
    }

    // 3. Check in localStorage dd_applicants_v2
    try {
      const savedApps = localStorage.getItem('dd_applicants_v2');
      if (savedApps) {
        const apps = JSON.parse(savedApps);
        const myApp = apps.find((a: any) => a.phone === currentPhone);
        if (myApp && ['已通过', 'approved', '通过'].includes(myApp.status)) {
          return true;
        }
      }
    } catch (_) {}

    return false;
  };

  const renderApprovedResultView = (onCloseModal: () => void) => (
    <div className="flex flex-col h-full bg-[#f9f9f9] text-[#1a1c1c] font-sans overflow-y-auto">
      {/* Top AppBar */}
      <header className="sticky top-0 w-full z-50 h-14 bg-[#f9f9f9] border-b border-[#dfc0af]/60 flex items-center justify-between px-5 shrink-0">
        <button 
          type="button"
          onClick={onCloseModal}
          className="p-1 rounded-full hover:bg-slate-200/60 transition-colors active:scale-95 cursor-pointer text-[#1a1c1c]"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-lg font-bold text-[#984800]">审核通过</h1>
        <div className="w-8"></div>
      </header>

      {/* Main Content Canvas */}
      <main className="flex-grow flex flex-col items-center justify-center px-5 py-8 max-w-md mx-auto w-full text-center">
        {/* Success Icon Badge */}
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full bg-[#ff7d00]/10 flex items-center justify-center border-4 border-[#ff7d00]/20 shadow-md">
            <CheckCircle2 className="w-16 h-16 text-[#ff7d00]" />
          </div>
        </div>

        {/* Titles */}
        <h2 className="text-2xl font-bold text-[#1a1c1c] mb-1">恭喜您已成功加入小队</h2>
        <p className="text-base text-[#5f5e5e] mb-2">您已成功通过审核</p>
        <div className="text-sm font-semibold text-[#984800] mb-6">祝您订单多多，收入多多！</div>

        {/* Info Card (Styled) */}
        <div className="w-full bg-white border border-[#dfc0af]/70 rounded-2xl p-4 mb-6 text-left shadow-xs space-y-2">
          <div className="flex items-center gap-2 text-[#984800]">
            <Info className="w-5 h-5 text-[#984800]" />
            <h3 className="text-xs font-bold uppercase tracking-wider">接单范围</h3>
          </div>
          <p className="text-sm text-[#1a1c1c] leading-relaxed font-medium">
            商户代叫订单、司机代叫转单
          </p>
        </div>

        {/* Driver Identity Glimpse */}
        <div className="w-full relative rounded-2xl overflow-hidden h-40 mb-6 shadow-sm border border-[#dfc0af]/70">
          <img 
            alt="Driver Ready"
            className="absolute inset-0 w-full h-full object-cover" 
            src={READY_DRIVER_PATH}
            onError={(e) => {
              const target = e.currentTarget;
              if (target.src !== READY_DRIVER_BASE64) {
                target.src = READY_DRIVER_BASE64;
              }
            }}
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent flex items-end p-4">
            <div className="text-white text-left">
              <p className="text-xs opacity-80 font-medium">当前状态</p>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-lg font-bold">准备就绪</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Sticky Bottom Actions */}
      <footer className="sticky bottom-0 bg-[#f9f9f9]/90 backdrop-blur-md px-5 py-4 border-t border-[#dfc0af]/60 flex flex-col gap-2 w-full max-w-md mx-auto">
        <button 
          type="button"
          onClick={onCloseModal}
          className="w-full h-12 bg-[#ff7d00] hover:bg-[#e67000] text-white font-semibold text-base rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
        >
          <span>返回首页</span>
        </button>
      </footer>
    </div>
  );

  const checkRejectionStatus = () => {
    if (isReapplying) return false;
    const currentPhone = userPhone || applyPhone || '';
    if (!currentPhone) return false;

    try {
      const saved = localStorage.getItem('dd_applicants_v2');
      if (saved) {
        const apps = JSON.parse(saved);
        const myApp = apps.find((a: any) => a.phone === currentPhone);
        if (myApp && ['已拒绝', '审核未通过', '未通过', '已驳回', 'rejected'].includes(myApp.status)) {
          return true;
        }
      }
    } catch (_) {}

    const member = squadMembers.find((m: any) => m.phone === currentPhone);
    if (member && ['已拒绝', '审核未通过', '未通过', '已驳回', 'rejected'].includes(member.status)) {
      return true;
    }

    return false;
  };

  const renderRejectedResultView = (onCloseModal: () => void) => (
    <div className="flex flex-col h-full bg-[#f9f9f9] text-[#1a1c1c] font-sans overflow-y-auto">
      {/* Header */}
      <header className="sticky top-0 w-full z-50 h-14 bg-[#f9f9f9] border-b border-[#dfc0af]/60 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-3">
          <button 
            type="button"
            onClick={onCloseModal}
            className="p-1 rounded-full hover:bg-slate-200/60 transition-colors active:scale-95 cursor-pointer text-[#1a1c1c]"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold text-[#1a1c1c]">审核结果</h1>
        </div>
        <div className="w-8"></div>
      </header>

      {/* Main Container */}
      <main className="flex-grow flex flex-col items-center justify-center px-5 py-8 max-w-md mx-auto w-full text-center">
        {/* Icon & Pulse */}
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full bg-red-100/60 flex items-center justify-center relative animate-pulse">
            <div className="w-16 h-16 rounded-full bg-[#ba1a1a] flex items-center justify-center shadow-lg">
              <X className="w-10 h-10 text-white stroke-[2.5]" />
            </div>
          </div>
        </div>

        {/* Title & Desc */}
        <h2 className="text-2xl font-bold text-[#1a1c1c] mb-3">审核未通过</h2>
        <p className="text-base text-[#5f5e5e] leading-relaxed px-2 mb-6">
          您提交的申请已受理，经综合评估，您暂时不符合我司的加入准则。
        </p>

        {/* Detail Card */}
        <div className="w-full bg-white border border-[#dfc0af]/70 rounded-2xl p-4 mb-8 text-left shadow-xs flex items-start gap-3">
          <div className="bg-slate-100 p-2.5 rounded-xl text-[#5f5e5e] shrink-0 mt-0.5">
            <FileX className="w-6 h-6 text-[#5f5e5e]" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-bold text-[#5f5e5e] tracking-wider uppercase">详情说明</p>
            <p className="text-sm text-[#1a1c1c] leading-normal font-medium">
              请联系管理人员了解具体不符合项及整改建议。
            </p>
          </div>
        </div>

        {/* Illustration Mock */}
        <div className="mt-auto w-full max-w-xs opacity-40 select-none pointer-events-none py-2">
          <svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto mx-auto">
            <rect x="20" y="20" width="160" height="80" rx="8" fill="#eeeeee"></rect>
            <rect x="40" y="45" width="80" height="8" rx="4" fill="#dddddd"></rect>
            <rect x="40" y="65" width="120" height="8" rx="4" fill="#dddddd"></rect>
            <circle cx="160" cy="50" r="15" fill="#f3f3f3"></circle>
            <path d="M155 45 L165 55 M165 45 L155 55" stroke="#ba1a1a" strokeWidth="3" strokeLinecap="round"></path>
          </svg>
        </div>
      </main>

      {/* Sticky Footer */}
      <footer className="sticky bottom-0 bg-[#f9f9f9]/90 backdrop-blur-md px-5 py-4 border-t border-[#dfc0af]/60 flex flex-col gap-3 w-full max-w-md mx-auto">
        <button 
          type="button"
          onClick={() => setLocalAlert({
            title: '联系小队管理团队',
            message: '如需了解具体审核评估标准或补充个人资质，请微信联系本地小队管理人员、老板或开发者人员。',
            type: 'info'
          })}
          className="w-full h-12 bg-[#ff7d00] hover:bg-[#e67000] text-white font-semibold text-base rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
        >
          <Headset className="w-5 h-5" />
          <span>请联系管理团队人员</span>
        </button>

        <button 
          type="button"
          onClick={() => setIsReapplying(true)}
          className="w-full h-12 bg-transparent border border-[#ff7d00] text-[#ff7d00] font-semibold text-base rounded-xl active:scale-[0.98] transition-all hover:bg-[#ff7d00]/5 cursor-pointer"
        >
          重新申请
        </button>

        <button 
          type="button"
          onClick={onCloseModal}
          className="w-full py-2 text-[#5f5e5e] font-semibold text-xs text-center active:opacity-60 transition-opacity hover:text-[#1a1c1c] cursor-pointer"
        >
          返回首页
        </button>
      </footer>
    </div>
  );

  // Master switches configuration (one-click close)
  const [masterSwitches, setMasterSwitches] = useState<{
    online_app_enabled?: boolean;
    merchant_dispatch_enabled?: boolean;
    squad_management_enabled?: boolean;
  }>({
    online_app_enabled: true,
    merchant_dispatch_enabled: true,
    squad_management_enabled: true,
  });

  useEffect(() => {
    const docRef = doc(db, 'config', 'master_switches');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setMasterSwitches({
          online_app_enabled: data.online_app_enabled !== false,
          merchant_dispatch_enabled: data.merchant_dispatch_enabled !== false,
          squad_management_enabled: data.squad_management_enabled !== false,
        });
      } else {
        setMasterSwitches({
          online_app_enabled: true,
          merchant_dispatch_enabled: true,
          squad_management_enabled: true,
        });
      }
    }, (error) => {
      console.error("Error subscribing to master switches:", error);
    });
    return () => unsubscribe();
  }, []);

  // City configs map state for per-city feature toggles and squad names
  const [cityConfigsMap, setCityConfigsMap] = useState<Record<string, {
    online_app_enabled?: boolean;
    merchant_dispatch_enabled?: boolean;
    squad_management_enabled?: boolean;
    squadNames?: string[];
  }>>(() => {
    const saved = localStorage.getItem('dd_city_configs_v2');
    if (saved) {
      try { return JSON.parse(saved); } catch(e){}
    }
    return {};
  });

  useEffect(() => {
    let unsubscribe = () => {};
    if (db) {
      const docRef = doc(db, 'config', 'city_configs');
      unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists() && docSnap.data().configs) {
          const newConfigs = docSnap.data().configs;
          setCityConfigsMap(newConfigs);
          localStorage.setItem('dd_city_configs_v2', JSON.stringify(newConfigs));
        }
      }, (err) => {
        const saved = localStorage.getItem('dd_city_configs_v2');
        if (saved) {
          try { setCityConfigsMap(JSON.parse(saved)); } catch(e){}
        }
      });
    }

    // Cross-tab / storage event listener for offline & local servers (e.g., Baota panel)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'dd_city_configs_v2' && e.newValue) {
        try { setCityConfigsMap(JSON.parse(e.newValue)); } catch(err){}
      }
    };

    // Custom event listener for same-window state updates
    const handleCustomEvent = (e: any) => {
      if (e.detail) {
        setCityConfigsMap(e.detail);
      } else {
        const saved = localStorage.getItem('dd_city_configs_v2');
        if (saved) {
          try { setCityConfigsMap(JSON.parse(saved)); } catch(err){}
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('cityConfigsUpdated', handleCustomEvent);

    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('cityConfigsUpdated', handleCustomEvent);
    };
  }, []);

  const getDriverCityConfig = () => {
    const rawCity = (effectiveCity || applicantCity || settings?.city || '银川市').trim();
    const norm = rawCity.replace(/市$/, '').trim();
    const cfg = cityConfigsMap[norm] || cityConfigsMap[`${norm}市`] || cityConfigsMap[rawCity];

    if (cfg) {
      return {
        online_app_enabled: cfg.online_app_enabled === true,
        merchant_dispatch_enabled: cfg.merchant_dispatch_enabled === true,
        squad_management_enabled: cfg.squad_management_enabled === true,
        squadNames: Array.isArray(cfg.squadNames) && cfg.squadNames.length > 0 ? cfg.squadNames : [`${norm}代驾小队`]
      };
    }
    return {
      online_app_enabled: false,
      merchant_dispatch_enabled: false,
      squad_management_enabled: false,
      squadNames: [`${norm}代驾小队`]
    };
  };

  // Real-time synchronization for squad members
  useEffect(() => {
    const q = collection(db, 'squad_members');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setSquadMembers(list);
    });
    return () => unsubscribe();
  }, []);

  // Real-time synchronization for team config (squad name)
  useEffect(() => {
    const localName = localStorage.getItem('dd_dispatch_team_name') || localStorage.getItem('dd_team_config_name');
    if (localName) {
      setTeamConfig({ teamName: localName });
      setTempSquadName(localName);
    } else {
      const defaultName = `${effectiveCity || '银川'}代驾小队`;
      setTeamConfig({ teamName: defaultName });
      setTempSquadName(defaultName);
    }

    let unsubscribe = () => {};
    if (db) {
      const docRef = doc(db, 'config', 'team_config');
      unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data && data.teamName) {
            setTeamConfig(data as any);
            setTempSquadName(data.teamName);
            localStorage.setItem('dd_dispatch_team_name', data.teamName);
            localStorage.setItem('dd_team_config_name', data.teamName);
          }
        }
      }, () => {});
    }

    const handleStorage = () => {
      const updated = localStorage.getItem('dd_dispatch_team_name') || localStorage.getItem('dd_team_config_name');
      if (updated) {
        setTeamConfig({ teamName: updated });
        setTempSquadName(updated);
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('teamNameUpdated', handleStorage);

    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('teamNameUpdated', handleStorage);
    };
  }, [effectiveCity]);

  // Ensure Gaode Map is fully initialized with security credentials
  const [aMapReady, setAMapReady] = useState<boolean>(() => {
    return typeof window !== 'undefined' && !!(window as any).AMap;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Set security config before any AMap load/usage
    (window as any)._AMapSecurityConfig = {
      securityJsCode: '0aa3912e6a88fe59f9e5f0275524feba'
    };

    if ((window as any).AMap) {
      setAMapReady(true);
      return;
    }

    const scriptId = 'amap-js-api-v2';
    let script = document.getElementById(scriptId) as HTMLScriptElement || document.querySelector('script[src*="webapi.amap.com"]');
    
    const handleScriptLoad = () => {
      setAMapReady(true);
    };

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://webapi.amap.com/maps?v=2.0&key=4143e567d55bbc1855231f9637efd6b0';
      script.async = true;
      script.defer = true;
      script.onload = handleScriptLoad;
      document.head.appendChild(script);
    } else {
      script.addEventListener('load', handleScriptLoad);
    }

    // fallback interval just in case load event was already fired but AMap is on window now
    const interval = setInterval(() => {
      if ((window as any).AMap) {
        setAMapReady(true);
        clearInterval(interval);
      }
    }, 500);

    return () => {
      if (script) {
        script.removeEventListener('load', handleScriptLoad);
      }
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (showDispatchModal) {
      setDispatchCity(effectiveCity);
      setDispatchCityQuery('');
      setShowDispatchCityDropdown(false);
    }
  }, [showDispatchModal, effectiveCity]);

  // --- VIP Purchase Modal States ---
  const [showVipPurchaseModal, setShowVipPurchaseModal] = useState(false);
  const [showBuyPage, setShowBuyPage] = useState(false);
  const [selectedVipPkgIndex, setSelectedVipPkgIndex] = useState(0); // default to index 0 (lifetime)
  const [vipPayMethod, setVipPayMethod] = useState<'wechat' | 'alipay'>('wechat');
  const [isVipPurchasing, setIsVipPurchasing] = useState(false);
  const [vipPurchaseSuccess, setVipPurchaseSuccess] = useState(false);

  const [isCityDispatchEnabled, setIsCityDispatchEnabled] = useState<boolean | null>(null);
  const [onlineApp, setOnlineApp] = useState<any>(null);
  const [loadingApp, setLoadingApp] = useState(false);
  const [localAlert, setLocalAlert] = useState<{ title: string; message: string; type?: 'warning' | 'info' | 'success' } | null>(null);

  // Form Fields
  const [applicantName, setApplicantName] = useState('');
  const [applicantGender, setApplicantGender] = useState('男');
  const [applicantAge, setApplicantAge] = useState('');
  const [applicantEmergencyPhone, setApplicantEmergencyPhone] = useState('');
  const [applicantDrivingYears, setApplicantDrivingYears] = useState('');
  const [applicantCity, setApplicantCity] = useState('');
  const [idCardFront, setIdCardFront] = useState('');
  const [idCardBack, setIdCardBack] = useState('');
  const [driverLicenseFront, setDriverLicenseFront] = useState('');
  const [driverLicenseBack, setDriverLicenseBack] = useState('');
  const [submittingApp, setSubmittingApp] = useState(false);

  // --- Quick App Dispatch - Dispatcher and Administrator Management States ---
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [allDrivers, setAllDrivers] = useState<any[]>([]);
  const [adminSearchPhone, setAdminSearchPhone] = useState('');
  const [settingRoleLoading, setSettingRoleLoading] = useState(false);
  const [searchedOnlineApp, setSearchedOnlineApp] = useState<any | null>(null);
  const [loadingSearchedApp, setLoadingSearchedApp] = useState(false);

  useEffect(() => {
    if (adminSearchPhone.trim().length === 11) {
      setLoadingSearchedApp(true);
      const docRef = doc(db, 'online_applications', adminSearchPhone.trim());
      getDoc(docRef).then((docSnap) => {
        if (docSnap.exists()) {
          setSearchedOnlineApp({ id: docSnap.id, ...docSnap.data() });
        } else {
          setSearchedOnlineApp(null);
        }
        setLoadingSearchedApp(false);
      }).catch((err) => {
        console.error("Error fetching searched driver online application:", err);
        setSearchedOnlineApp(null);
        setLoadingSearchedApp(false);
      });
    } else {
      setSearchedOnlineApp(null);
    }
  }, [adminSearchPhone]);

  // Role hierarchy and helper logic
  const ROLE_HIERARCHY: Record<string, number> = {
    '开发者司机': 1,
    '城市老板司机': 2,
    '城市管理司机': 3,
    '城市派单员司机': 4,
    '普通司机': 5
  };

  const canSetRoles = ['开发者司机', '城市老板司机', '城市管理司机'].includes(userRole);

  const canManageTarget = (targetRole: string) => {
    const curLevel = ROLE_HIERARCHY[userRole] || 5;
    const tgtLevel = ROLE_HIERARCHY[targetRole] || 5;
    return curLevel < tgtLevel;
  };

  const searchedPhoneTrim = adminSearchPhone.trim();
  const foundTeamMember = teamMembers.find(m => m.phone === searchedPhoneTrim);
  const foundDriverUser = allDrivers.find(d => d.id === searchedPhoneTrim || d.phoneNumber === searchedPhoneTrim || d.phone === searchedPhoneTrim);

  const isOnlineApproved = !!(searchedOnlineApp && searchedOnlineApp.status === 'approved');

  const searchedUserRole = foundTeamMember ? foundTeamMember.role : '普通司机';
  const searchedDriverName = loadingSearchedApp
    ? '检测中...'
    : isOnlineApproved 
      ? (searchedOnlineApp?.driverName || foundDriverUser?.driverName || '已开通线上单') 
      : '未开通线上单';

  const handleSetRole = async (targetRole: '城市派单员司机' | '普通司机') => {
    if (!/^1[3-9]\d{9}$/.test(searchedPhoneTrim)) {
      alert('✍️ 提示：请输入中国大陆 11 位有效手机号码！');
      return;
    }
    if (!canSetRoles) {
      alert('❌ 权限不足：只有 开发者司机、城市老板司机、城市管理司机 有权限设置指定派单员！');
      return;
    }
    if (!canManageTarget(searchedUserRole)) {
      alert(`❌ 权限不足：您当前的身份为【${userRole}】，无权管理角色为【${searchedUserRole}】的用户！`);
      return;
    }

    // Safety constraint: Cannot set management team members
    if (['开发者司机', '城市老板司机', '城市管理司机'].includes(searchedUserRole)) {
      alert('❌ 操作失败：管理团队人员角色不允许在此进行变更！');
      return;
    }

    // Safety constraint: Cannot set ordinary drivers who have not been approved for online orders
    if (searchedUserRole === '普通司机' && !isOnlineApproved) {
      alert('❌ 操作失败：该司机没有注册/开通线上单审批，无法设置为派单员！');
      return;
    }

    setSettingRoleLoading(true);
    try {
      const docRef = doc(db, 'team_members', searchedPhoneTrim);
      if (targetRole === '普通司机') {
        await deleteDoc(docRef);
        alert(`✓ 成功将 ${searchedPhoneTrim} 降级/移出运营团队（当前角色已重置为普通司机）`);
      } else {
        await setDoc(docRef, {
          phone: searchedPhoneTrim,
          role: targetRole,
          city: userTeamCity || '银川市',
          remark: searchedDriverName !== '线上单未注册司机' ? searchedDriverName : '快捷设置派单员',
          updatedAt: new Date().toISOString()
        }, { merge: true });
        alert(`✓ 成功将 ${searchedPhoneTrim} (${searchedDriverName}) 设为 【${targetRole}】`);
      }
    } catch (e: any) {
      console.error(e);
      alert('❌ 操作失败: ' + e.message);
    } finally {
      setSettingRoleLoading(false);
    }
  };

  // City Selector Dialog search query
  const [searchCityQuery, setSearchCityQuery] = useState('');
  const [showCitySelector, setShowCitySelector] = useState(false);

  // Driver Order History Center states
  const [showOrderHistory, setShowOrderHistory] = useState(false);
  const [driverOrders, setDriverOrders] = useState<any[]>(() => {
    try {
      const ordersKey = userPhone ? `dd_driver_orders_${userPhone}` : 'dd_driver_orders';
      const existing = localStorage.getItem(ordersKey);
      if (existing) {
        const parsed = JSON.parse(existing);
        const filtered = filterOrdersWithinSixMonths(parsed);
        if (filtered.length !== parsed.length) {
          localStorage.setItem(ordersKey, JSON.stringify(filtered));
        }
        return filtered;
      }
    } catch (e) {}
    return [];
  });

  // Sync order history whenever it is shown
  useEffect(() => {
    if (showOrderHistory) {
      try {
        const ordersKey = userPhone ? `dd_driver_orders_${userPhone}` : 'dd_driver_orders';
        const existing = localStorage.getItem(ordersKey);
        if (existing) {
          const parsed = JSON.parse(existing);
          const filtered = filterOrdersWithinSixMonths(parsed);
          setDriverOrders(filtered);
          if (filtered.length !== parsed.length) {
            localStorage.setItem(ordersKey, JSON.stringify(filtered));
          }
        }
      } catch (e) {}
    }
  }, [showOrderHistory, userPhone]);

  const [swipedOrderId, setSwipedOrderId] = useState<string | null>(null);

  // Click on blank space should close any swiped order
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent | TouchEvent) => {
      if (swipedOrderId === null) return;
      const target = e.target as HTMLElement;
      if (target && !target.closest('.delete-btn-container')) {
        setSwipedOrderId(null);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('touchstart', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('touchstart', handleDocumentClick);
    };
  }, [swipedOrderId]);

  const handleDeleteOrder = (orderId: string) => {
    try {
      const updated = driverOrders.filter(o => o.id !== orderId);
      setDriverOrders(updated);
      const ordersKey = userPhone ? `dd_driver_orders_${userPhone}` : 'dd_driver_orders';
      localStorage.setItem(ordersKey, JSON.stringify(updated));
      if (swipedOrderId === orderId) {
        setSwipedOrderId(null);
      }
      // Decrease both monthly orders and total orders (represented by stats.myPoints) by 1
      const nextPoints = Math.max(0, (stats.myPoints || 0) - 1);
      onUpdateStats({
        myPoints: nextPoints
      });
    } catch (e) {
      console.error('Failed to delete order:', e);
    }
  };

  // Subscribe to `/online_applications/{userPhone}`
  useEffect(() => {
    if (!userPhone) return;
    setLoadingApp(true);
    const docRef = doc(db, 'online_applications', userPhone);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const appData = docSnap.data();
        setOnlineApp({ id: docSnap.id, ...appData });
        if (appData) {
          setApplicantName(appData.driverName || '');
          setApplicantGender(appData.driverGender || '男');
          setApplicantAge(String(appData.driverAge || ''));
          setApplicantEmergencyPhone(appData.emergencyPhone || '');
          setApplicantDrivingYears(String(appData.drivingYears || ''));
          setApplicantCity(appData.city || '');
          setIdCardFront(appData.idCardFront || '');
          setIdCardBack(appData.idCardBack || '');
          setDriverLicenseFront(appData.driverLicenseFront || '');
          setDriverLicenseBack(appData.driverLicenseBack || '');
        }
      } else {
        setOnlineApp(null);
        setApplicantName('');
        setApplicantGender('男');
        setApplicantAge('');
        setApplicantEmergencyPhone('');
        setApplicantDrivingYears('');
        setApplicantCity('');
        setIdCardFront('');
        setIdCardBack('');
        setDriverLicenseFront('');
        setDriverLicenseBack('');
      }
      setLoadingApp(false);
    }, (err) => {
      console.error("Error listening to online applications:", err);
      setLoadingApp(false);
    });
    return () => unsubscribe();
  }, [userPhone]);

  // Subscribe to city dispatch config gate
  useEffect(() => {
    let city = settings?.city || onlineApp?.city || '银川市';
    if (city && !city.endsWith('市')) {
      city = city + '市';
    }
    const docRef = doc(db, 'city_dispatch_config', city);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setIsCityDispatchEnabled(data.enabled !== false);
      } else {
        setIsCityDispatchEnabled(true);
      }
    }, (error) => {
      console.warn("Failed to subscribe city dispatch config:", error);
      setIsCityDispatchEnabled(true);
    });
    return () => unsubscribe();
  }, [settings?.city, onlineApp?.city]);

  // Subscribe to messages in Firestore
  useEffect(() => {
    const q = collection(db, 'messages');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      // Sort descending by createdAt
      list.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      setDbMessages(list);
    }, (err) => {
      console.error("Error listening to messages in HomeView:", err);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to team members in Firestore for Administrator tracking and dispatcher management
  useEffect(() => {
    const q = collection(db, 'team_members');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setTeamMembers(list);
    }, (error) => {
      console.error("Error subscribing to team members in HomeView:", error);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to driver users in Firestore for online registration name verification
  useEffect(() => {
    const q = collection(db, 'driver_users');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setAllDrivers(list);
    }, (error) => {
      console.error("Error subscribing to driver users in HomeView:", error);
    });
    return () => unsubscribe();
  }, []);

  // Filter messages relevant to this user (either 'all' or specifically matched targetPhone)
  const userMessages = dbMessages.filter(msg => {
    const target = msg.targetPhone || 'all';
    return target === 'all' || (userPhone && target === userPhone);
  });

  const unreadMessages = userMessages.filter(msg => !viewedMessageIds.includes(msg.id));

  // Real-time audio broadcast and visual alert for newly received system messages
  const lastMessageCountRef = useRef(userMessages.length);
  useEffect(() => {
    if (userMessages.length > lastMessageCountRef.current) {
      // Find the newly added message on top of the list
      const latestMessage = userMessages[0];
      if (latestMessage && !viewedMessageIds.includes(latestMessage.id)) {
        // Trigger speech voice announcement if enabled
        if (settings.voiceBroadcast === '开单语音播报') {
          speakText('您有新的消息，注意查收！');
        }
      }
    }
    lastMessageCountRef.current = userMessages.length;
  }, [userMessages, viewedMessageIds, settings.voiceBroadcast]);

  const handleMarkAllRead = () => {
    const allIds = userMessages.map(m => m.id);
    setViewedMessageIds(allIds);
    localStorage.setItem('dd_viewed_message_ids', JSON.stringify(allIds));
  };

  const handleMarkSingleRead = (id: string) => {
    if (!viewedMessageIds.includes(id)) {
      const next = [...viewedMessageIds, id];
      setViewedMessageIds(next);
      localStorage.setItem('dd_viewed_message_ids', JSON.stringify(next));
    }
  };

  // --- Quick App Dispatch Logic ---
  useEffect(() => {
    const AMap = (window as any).AMap;
    if (!AMap || !dispatchStartPlace.trim()) {
      setDispatchSuggestions([]);
      return;
    }
    const delayDebounce = setTimeout(() => {
      AMap.plugin('AMap.AutoComplete', () => {
        try {
          const auto = new AMap.AutoComplete({
            city: dispatchCity,
            citylimit: true
          });
          auto.search(dispatchStartPlace, (status: string, result: any) => {
            if (status === 'complete' && result.tips) {
              setDispatchSuggestions(result.tips.filter((t: any) => t.name));
            } else {
              setDispatchSuggestions([]);
            }
          });
        } catch (e) {
          console.warn('AutoComplete plugin failed:', e);
        }
      });
    }, 250);

    return () => clearTimeout(delayDebounce);
  }, [dispatchStartPlace, dispatchCity, aMapReady]);

  const handleSelectSuggestion = (tip: any) => {
    setDispatchStartPlace(tip.name);
    setDispatchSuggestions([]);
    if (tip.location) {
      setDispatchSelectedCoords({
        lat: tip.location.lat,
        lng: tip.location.lng
      });
    } else {
      setDispatchSelectedCoords(null);
    }
  };

  const handleOneKeyDispatch = async () => {
    // 只有 开发者司机、城市老板司机、城市管理司机、城市派单员司机 有权限派单
    const allowedRoles = ['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机'];
    if (!allowedRoles.includes(userRole)) {
      alert(`❌ 权限不足：您当前的身份为【${userRole}】，无法使用一键派单功能！只有派单及管理级别司机拥有派单权限。`);
      return;
    }

    if (!dispatchStartPlace.trim()) {
      alert("请输入乘客出发地！");
      return;
    }

    setDispatchingOrder(true);
    
    try {
      let finalCoords = dispatchSelectedCoords;

      if (!finalCoords) {
        // Extra local search terms mapping for quick, robust simulation
        const address = dispatchStartPlace.trim();
        let matchedCoords: { lat: number; lng: number } | null = null;
        if (address.includes('文化街') || address.includes('和平苑')) {
          matchedCoords = { lat: 38.468205, lng: 106.284752 };
        } else if (address.includes('银川站') || address.includes('火车站')) {
          matchedCoords = { lat: 38.487193, lng: 106.200912 };
        } else if (address.includes('大阅城')) {
          matchedCoords = { lat: 38.520123, lng: 106.255123 };
        } else if (address.includes('悦海')) {
          matchedCoords = { lat: 38.511234, lng: 106.244345 };
        }

        if (matchedCoords) {
          finalCoords = matchedCoords;
        } else if (dispatchSuggestions.length > 0 && dispatchSuggestions[0].location) {
          const first = dispatchSuggestions[0];
          finalCoords = { lat: first.location.lat, lng: first.location.lng };
        } else {
          try {
            const geocodeResult = await new Promise<{ lat: number; lng: number }>((resolve, reject) => {
              const AMap = (window as any).AMap;
              if (AMap && AMap.Geocoder) {
                const geocoder = new AMap.Geocoder({
                  city: dispatchCity
                });
                geocoder.getLocation(dispatchStartPlace, (status: string, result: any) => {
                  if (status === 'complete' && result.geocodes && result.geocodes.length > 0) {
                    const loc = result.geocodes[0].location;
                    resolve({ lat: loc.lat, lng: loc.lng });
                  } else {
                    reject(new Error('未找到该地址的坐标'));
                  }
                });
              } else {
                reject(new Error('AMap Geocoder not available'));
              }
            });
            finalCoords = geocodeResult;
          } catch (geocodingError) {
            console.warn("Geocoding failed, using city center fallback:", geocodingError);
            const norm = dispatchCity.trim();
            const mapper: { [key: string]: { lat: number; lng: number } } = {
              '银川': { lat: 38.4830, lng: 106.2350 },
              '银川市': { lat: 38.4830, lng: 106.2350 },
              '北京': { lat: 39.9042, lng: 116.4074 },
              '北京市': { lat: 39.9042, lng: 116.4074 },
              '上海': { lat: 31.2304, lng: 121.4737 },
              '上海市': { lat: 31.2304, lng: 121.4737 },
              '广州': { lat: 23.1291, lng: 113.2644 },
              '广州市': { lat: 23.1291, lng: 113.2644 },
              '深圳': { lat: 22.5431, lng: 114.0579 },
              '深圳市': { lat: 22.5431, lng: 114.0579 },
              '成都': { lat: 30.5728, lng: 104.0668 },
              '成都市': { lat: 30.5728, lng: 104.0668 },
              '杭州': { lat: 30.2741, lng: 120.1551 },
              '杭州市': { lat: 30.2741, lng: 120.1551 },
              '重庆': { lat: 29.5630, lng: 106.5516 },
              '重庆市': { lat: 29.5630, lng: 106.5516 },
              '长沙': { lat: 28.1963, lng: 112.9821 },
              '长沙市': { lat: 28.1963, lng: 112.9821 },
              '武汉': { lat: 30.5928, lng: 114.3055 },
              '武汉市': { lat: 30.5928, lng: 114.3055 },
              '西安': { lat: 34.3416, lng: 108.9402 },
              '西安市': { lat: 34.3416, lng: 108.9402 },
              '南京': { lat: 32.0603, lng: 118.7969 },
              '南京市': { lat: 32.0603, lng: 118.7969 },
              '天津': { lat: 39.1256, lng: 117.1902 },
              '天津市': { lat: 39.1256, lng: 117.1902 }
            };
            const mapped = mapper[norm] || mapper[norm + '市'] || { lat: 38.4830, lng: 106.2350 };
            finalCoords = mapped;
          }
        }
      }

      const driverSnapshot = await getDocs(collection(db, 'driver_users'));
      const squadSnapshot = await getDocs(collection(db, 'squad_members'));
      const teamSnapshot = await getDocs(collection(db, 'team_members'));

      const squadPhones = squadSnapshot.docs.map(d => d.id);
      const managementPhones = teamSnapshot.docs
        .filter(d => ['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机'].includes(d.data().role))
        .map(d => d.data().phone);

      const activeDrivers: any[] = [];
      
      driverSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data && !data.isBanned) {
          const phone = doc.id;
          const isManagement = managementPhones.includes(phone) || phone === '15509601222' || phone === userPhone;
          const isApprovedAndInSquad = (data.onlineOrdersEnabled || data.isOnline) && squadPhones.includes(phone);

          if (isManagement || isApprovedAndInSquad) {
            activeDrivers.push({
              phone: doc.id,
              name: (data.driverName && data.driverName !== '代驾司机' && data.driverName !== '在线代驾司机') ? data.driverName : '吴彦祖',
              lat: Number(data.lat) || finalCoords!.lat,
              lng: Number(data.lng) || finalCoords!.lng,
              onlineOrdersEnabled: !!data.onlineOrdersEnabled || !!data.isOnline
            });
          }
        }
      });

      // Ensure the current driver themselves is always included as an active candidate to guarantee successful dispatch simulation
      const fallbackPhone = userPhone || '18609518888';
      const fallbackName = (settings as any).driverName || (settings as any).name || '司机';
      if (!activeDrivers.some(d => d.phone === fallbackPhone)) {
        activeDrivers.push({
          phone: fallbackPhone,
          name: fallbackName,
          lat: (driverCoords as any)?.lat || finalCoords.lat,
          lng: (driverCoords as any)?.lng || finalCoords.lng,
          onlineOrdersEnabled: true
        });
      }

      // Filter for those online and not on obsolete V1.0 version
      let candidates = activeDrivers.filter(d => {
        const isEn = d.onlineOrdersEnabled;
        const rawVer = (d.version || d.appVersion || d.driverVersion || d.sysVersion || '').trim().toUpperCase();
        const isObsolete = rawVer === 'V1.0' || rawVer.startsWith('V1.0');
        return isEn && !isObsolete;
      });

      // Permanently target the currently logged-in real driver (userPhone) to ensure they receive the order popup if online
      const targetPhone = userPhone || '18609518888';
      let closestDriver = candidates.find(d => d.phone === targetPhone);
      
      // If target driver is offline or not in online candidates
      if (!closestDriver && !isOnline) {
        alert("⚠️ 派单失败：您当前处于【下线/离线状态】，无法接收任何后台或自主派单！\n\n请先在首页底部【右滑上线】，开启上线听单状态后再试。");
        return;
      }

      if (!closestDriver) {
        closestDriver = {
          phone: targetPhone,
          name: (settings as any).driverName || (settings as any).name || '司机',
          lat: (driverCoords as any)?.lat || finalCoords.lat,
          lng: (driverCoords as any)?.lng || finalCoords.lng,
          onlineOrdersEnabled: true
        };
      }

      const minDistance = calculateDistance(finalCoords.lat, finalCoords.lng, closestDriver.lat, closestDriver.lng);
      
      await setDoc(doc(db, 'passenger_links', closestDriver.phone), {
        passengerPhone: dispatchPhone.trim() || '系统自主派单',
        startLocation: dispatchStartPlace,
        destination: '一键派单：由司机根据现场口头协商规划行程',
        status: 'submitted',
        timestamp: Date.now(),
        isValetOrder: true,
        isPlatformDispatch: true,
        passengerLat: finalCoords.lat,
        passengerLng: finalCoords.lng,
        approxPrice: '未知'
      });

      alert(`🎉 派单成功！\n\n系统已自动为您寻找直线距离最近的司机：\n- 司机姓名: ${closestDriver.name}\n- 司机手机: ${closestDriver.phone}\n- 直线距离: ${minDistance.toFixed(2)} 公里\n\n不管距离多远，司机APP将立刻弹出语音播报及新来单界面！`);
      
      setDispatchStartPlace('');
      setDispatchPhone('');
      setDispatchSuggestions([]);
      setDispatchSelectedCoords(null);
      setShowDispatchModal(false);
    } catch (err: any) {
      console.error("Dispatch error:", err);
      alert("❌ 派单通道执行失败: " + err.message);
    } finally {
      setDispatchingOrder(false);
    }
  };

  const handleSearchSquadMember = async () => {
    const phone = searchSquadPhone.trim();
    if (!phone) {
      alert('请输入要搜索的11位手机号码！');
      return;
    }
    if (!/^1\d{10}$/.test(phone)) {
      alert('请输入正确的11位手机号码格式！');
      return;
    }
    setIsSearchingSquad(true);
    setSearchSquadError('');
    try {
      // 1. Check in squad_members
      const squadMemberSnap = await getDoc(doc(db, 'squad_members', phone));
      
      // 2. Check in driver_users
      const driverUserSnap = await getDoc(doc(db, 'driver_users', phone));
      
      const existsInSquad = squadMemberSnap.exists();
      const squadData = existsInSquad ? squadMemberSnap.data() : null;
      const driverData = driverUserSnap.exists() ? driverUserSnap.data() : null;
      
      setSearchSquadResult({
        exists: existsInSquad || driverUserSnap.exists(),
        squadMember: squadData ? { id: phone, ...squadData } : null,
        driverUser: driverData ? { id: phone, ...driverData } : null,
        checked: true
      });
      
      if (squadData) {
        setSquadDriverName(squadData.name || '');
      } else if (driverData) {
        setSquadDriverName(driverData.driverName || '');
      } else {
        setSquadDriverName('');
      }
    } catch (err: any) {
      setSearchSquadError(err.message || '搜索失败');
    } finally {
      setIsSearchingSquad(false);
    }
  };

  const handleAddToSquad = async () => {
    const phone = searchSquadPhone.trim();
    const name = squadDriverName.trim();
    if (!phone) {
      alert('请输入要添加的手机号码！');
      return;
    }
    if (!name) {
      alert('请输入要添加的司机姓名！');
      return;
    }
    try {
      await setDoc(doc(db, 'squad_members', phone), {
        phone,
        name,
        addedByPhone: userPhone || '未知管理员',
        addedByName: (settings as any).driverName || (settings as any).name || '管理员',
        addedAt: new Date().toISOString().replace('T', ' ').substring(0, 19)
      });
      
      // Refresh search result state
      setSearchSquadResult(prev => prev ? {
        ...prev,
        squadMember: {
          phone,
          name,
          addedByPhone: userPhone || '未知管理员',
          addedByName: (settings as any).driverName || (settings as any).name || '管理员',
          addedAt: new Date().toISOString().replace('T', ' ').substring(0, 19)
        }
      } : null);
      
      alert(`✓ 已成功将 ${name} (${phone}) 添加进入小队！`);
    } catch (err: any) {
      alert(`添加失败：${err.message}`);
    }
  };

  const handleKickFromSquad = async (phoneToKick?: string) => {
    const phone = phoneToKick || searchSquadPhone.trim();
    if (!phone) return;
    
    try {
      await deleteDoc(doc(db, 'squad_members', phone));

      // Clean local storage
      try {
        const savedM = localStorage.getItem('dd_squad_members_v2');
        if (savedM) {
          const listM = JSON.parse(savedM);
          const filteredM = listM.filter((m: any) => m.phone !== phone && m.id !== phone);
          localStorage.setItem('dd_squad_members_v2', JSON.stringify(filteredM));
        }
        const savedA = localStorage.getItem('dd_applicants_v2');
        if (savedA) {
          const listA = JSON.parse(savedA);
          const filteredA = listA.filter((a: any) => a.phone !== phone && a.id !== phone);
          localStorage.setItem('dd_applicants_v2', JSON.stringify(filteredA));
        }
      } catch (_) {}
      
      if (!phoneToKick || phoneToKick === searchSquadPhone.trim()) {
        setSearchSquadResult(prev => prev ? {
          ...prev,
          squadMember: null
        } : null);
        setSquadDriverName('');
      }
      
      setSquadNotification({
        type: 'success',
        text: `✓ 已成功将手机号为 ${phone} 的司机从本小队中踢出。该司机已失去接收商户代叫新派单资格。`
      });
      setTimeout(() => setSquadNotification(null), 5000);
    } catch (err: any) {
      setSquadNotification({
        type: 'error',
        text: `踢出失败：${err.message}`
      });
      setTimeout(() => setSquadNotification(null), 5000);
    }
  };

  const handleSaveSquadName = async () => {
    const newName = tempSquadName.trim();
    if (!newName) {
      alert('小队名称不能为空！');
      return;
    }
    try {
      localStorage.setItem('dd_dispatch_team_name', newName);
      localStorage.setItem('dd_team_config_name', newName);
      setTeamConfig({ teamName: newName });
      window.dispatchEvent(new Event('teamNameUpdated'));

      if (db) {
        await setDoc(doc(db, 'config', 'team_config'), {
          teamName: newName,
          updatedAt: new Date().toISOString(),
          setBy: userPhone || '开发者'
        }, { merge: true }).catch(() => {});
      }
      setIsEditingSquadName(false);
      alert('✓ 小队名称已成功保存，并在所有端实时生效！');
    } catch (err: any) {
      alert(`保存小队名称失败：${err.message}`);
    }
  };

  const handleVipPurchase = async () => {
    setIsVipPurchasing(true);
    // Simulate payment process delay
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const selectedPkg = [
      { id: 'lifetime', days: 99999, price: 158.0, label: '永久会员' },
      { id: '365days', days: 365, price: 78.0, label: '365天' },
      { id: '180days', days: 180, price: 45.0, label: '180天' },
      { id: '90days', days: 90, price: 25.0, label: '90天' },
      { id: '30days', days: 30, price: 9.9, label: '30天' }
    ][selectedVipPkgIndex || 0];

    const durationDays = selectedPkg.days;
    const isForever = durationDays === 99999;

    let finalExpiryStr = '永久有效';
    if (!isForever) {
      let currentExpiryDate = new Date();
      if (settings.vipExpiry && settings.vipExpiry !== '永久有效') {
        const parsed = Date.parse(settings.vipExpiry);
        if (!isNaN(parsed)) {
          const prevDate = new Date(parsed);
          if (prevDate.getTime() > currentExpiryDate.getTime()) {
            currentExpiryDate = prevDate;
          }
        }
      }
      currentExpiryDate.setDate(currentExpiryDate.getDate() + durationDays);
      const yyyy = currentExpiryDate.getFullYear();
      const mm = String(currentExpiryDate.getMonth() + 1).padStart(2, '0');
      const dd = String(currentExpiryDate.getDate()).padStart(2, '0');
      finalExpiryStr = `${yyyy}-${mm}-${dd}`;
    }

    try {
      // Update settings locally and persist to Firestore
      onUpdateSettings({
        ...settings,
        vipExpiry: finalExpiryStr
      });

      setVipPurchaseSuccess(true);
    } catch (err: any) {
      console.error(err);
      alert('购买同步到数据库失败: ' + err.message);
    } finally {
      setIsVipPurchasing(false);
    }
  };

  // Online active clock simulator
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isOnline) {
      interval = setInterval(() => {
        setOnlineTime(prev => prev + 1);
      }, 1000);
    } else {
      setOnlineTime(0);
    }
    return () => clearInterval(interval);
  }, [isOnline]);

  // Slider controls (simulated drag)
  const handleTouchStart = (e: React.TouchEvent) => {
    initAudioUnlock();
    if (currentTrip) return; // Cannot toggle while in trip
    touchStartRef.current = e.touches[0].clientX;
    setIsSliding(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSliding) return;
    const deltaX = e.touches[0].clientX - touchStartRef.current;
    if (sliderWidthRef.current) {
      const maxSlide = sliderWidthRef.current.clientWidth - 56; // handle width is 56px
      let newPos = Math.max(0, Math.min(deltaX, maxSlide));
      setSliderPos(newPos);
    }
  };

  const handleTouchEnd = () => {
    setIsSliding(false);
    if (sliderWidthRef.current) {
      const maxSlide = sliderWidthRef.current.clientWidth - 56;
      if (sliderPos > maxSlide * 0.7) {
        if (!isOnline) {
          if (settings.isBanned) {
            alert("⚠️ 无法上线！因账户违规，您的账号已被管理员封停。封停期间无法上线听单或接单！");
            setSliderPos(0);
            return;
          }

          const isVip = checkVipActive(settings.vipExpiry);
          if (!isVip && stats.todayOrders >= 2) {
            alert('🔒 提示：非VIP会员每日限制报单次数已用完（每天限额2次，明早6:00自动恢复，激活VIP解除限制）。');
            setSliderPos(0);
            return;
          }
        }
        // Trigger Toggle Online (App.tsx onToggleOnline handles voice announcement)
        onToggleOnline(!isOnline);
      }
    }
    setSliderPos(0);
  };

  // Support desktop drag (mouse event)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (currentTrip) return; // Cannot toggle while in trip
    touchStartRef.current = e.clientX;
    setIsSliding(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - touchStartRef.current;
      if (sliderWidthRef.current) {
        const maxSlide = sliderWidthRef.current.clientWidth - 56;
        let newPos = Math.max(0, Math.min(deltaX, maxSlide));
        setSliderPos(newPos);
      }
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      setIsSliding(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      if (sliderWidthRef.current) {
        const maxSlide = sliderWidthRef.current.clientWidth - 56;
        const currentPos = upEvent.clientX - touchStartRef.current;
        if (currentPos > maxSlide * 0.7) {
          if (!isOnline) {
            if (settings.isBanned) {
              alert("⚠️ 无法上线！因账户违规，您的账号已被管理员封停。封停期间无法上线听单或接单！");
              setSliderPos(0);
              return;
            }

            const isVip = checkVipActive(settings.vipExpiry);
            if (!isVip && stats.todayOrders >= 2) {
              alert('🔒 提示：非VIP会员每日限制报单次数已用完（每天限额2次，明早6:00自动恢复，激活VIP解除限制）。');
              setSliderPos(0);
              return;
            }
          }
          // Trigger Toggle Online (App.tsx onToggleOnline handles voice announcement)
          onToggleOnline(!isOnline);
        }
      }
      setSliderPos(0);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Support responsive slide simulation guidance on click for desktop previews
  const handleSlideToggleClick = () => {
    // No-op to avoid unintended tap action and prevent showing any alert popups
  };

  // --- Online dispatch orders application helper methods ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setter(reader.result as string);
    };
    reader.onerror = (err) => {
      console.error("FileReader error:", err);
      alert("⚠️ 读取图片失败，请重试！");
    };
    reader.readAsDataURL(file);
  };

  const handleSimulatePhoto = (type: string, setter: (val: string) => void) => {
    const name = applicantName.trim() || '司马小光';
    const phone = userPhone || '';
    let svgString = '';
    
    if (type === 'id_front') {
      svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="190" viewBox="0 0 300 190">
        <rect width="300" height="190" rx="12" fill="#eef3f9" stroke="#cbd5e1" stroke-width="2"/>
        <rect x="15" y="15" width="270" height="160" rx="6" fill="#f8fafc"/>
        <text x="30" y="45" font-family="sans-serif" font-size="12" font-weight="900" fill="#1e293b">姓名：${name}</text>
        <text x="30" y="70" font-family="sans-serif" font-size="11" fill="#475569">性别：${applicantGender}    民族：汉</text>
        <text x="30" y="95" font-family="sans-serif" font-size="11" fill="#475569">出生：1994年08月12日</text>
        <text x="30" y="120" font-family="sans-serif" font-size="11" fill="#475569">住址：北京市海淀区中关村南大街1号</text>
        <text x="30" y="155" font-family="sans-serif" font-size="12" font-weight="900" fill="#2563eb" font-mono="true">公民身份号码：110108199408128888</text>
        <rect x="200" y="40" width="70" height="85" rx="4" fill="#cbd5e1" opacity="0.6"/>
        <circle cx="235" cy="70" r="18" fill="#94a3b8"/>
        <path d="M210 120 C210 100, 260 100, 260 120 Z" fill="#94a3b8"/>
      </svg>`;
    } else if (type === 'id_back') {
      svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="190" viewBox="0 0 300 190">
        <rect width="300" height="190" rx="12" fill="#eef3f9" stroke="#cbd5e1" stroke-width="2"/>
        <rect x="15" y="15" width="270" height="160" rx="6" fill="#f8fafc"/>
        <circle cx="65" cy="95" r="30" fill="none" stroke="#ef4444" stroke-width="2"/>
        <text x="120" y="85" font-family="sans-serif" font-size="13" font-weight="bold" fill="#1e293b">中华人民共和国</text>
        <text x="120" y="110" font-family="sans-serif" font-size="15" font-weight="900" fill="#1e293b" letter-spacing="2">居民身份证</text>
        <text x="45" y="155" font-family="sans-serif" font-size="9" fill="#64748b">签发机关：北京市公安局海淀分局</text>
        <text x="45" y="170" font-family="sans-serif" font-size="9" fill="#64748b">有效期限：2020.08.12 - 2040.08.12</text>
      </svg>`;
    } else if (type === 'license_front') {
      svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="190" viewBox="0 0 300 190">
        <rect width="300" height="190" rx="12" fill="#f1f5f9" stroke="#64748b" stroke-width="3"/>
        <rect x="15" y="15" width="270" height="160" rx="6" fill="#0f172a"/>
        <rect x="20" y="20" width="260" height="150" rx="4" fill="#f8fafc" stroke="#e2e8f0"/>
        <text x="35" y="42" font-family="sans-serif" font-size="12" font-weight="900" fill="#ef4444">中华人民共和国机动车驾驶证</text>
        <text x="35" y="65" font-family="sans-serif" font-size="10" fill="#475569">证号：110108199408128888</text>
        <text x="35" y="85" font-family="sans-serif" font-size="10" fill="#475569">姓名：${name}</text>
        <text x="35" y="105" font-family="sans-serif" font-size="10" fill="#475569">国籍：中国    性别：${applicantGender}</text>
        <text x="35" y="125" font-family="sans-serif" font-size="10" fill="#475569">准驾车型：C1</text>
        <text x="35" y="145" font-family="sans-serif" font-size="9" fill="#475569">初次领证日期：2016-05-18</text>
        <rect x="205" y="60" width="60" height="75" rx="3" fill="#e2e8f0" stroke="#cbd5e1"/>
        <circle cx="235" cy="85" r="14" fill="#94a3b8"/>
        <path d="M215 125 C215 110, 255 110, 255 125 Z" fill="#94a3b8"/>
      </svg>`;
    } else {
      svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="190" viewBox="0 0 300 190">
        <rect width="300" height="190" rx="12" fill="#f1f5f9" stroke="#64748b" stroke-width="3"/>
        <rect x="15" y="15" width="270" height="160" rx="6" fill="#f8fafc"/>
        <text x="35" y="45" font-family="sans-serif" font-size="12" font-weight="900" fill="#1e293b">中华人民共和国机动车驾驶证副页</text>
        <text x="35" y="75" font-family="sans-serif" font-size="10" fill="#475569">证号：110108199408128888</text>
        <text x="35" y="100" font-family="sans-serif" font-size="10" fill="#475569">姓名：${name}</text>
        <text x="35" y="125" font-family="sans-serif" font-size="10" fill="#475569">档案编号：110000888888</text>
        <text x="35" y="150" font-family="sans-serif" font-size="9" fill="#ef4444">记录：实习期满，请于2036年换发10年有效驾驶证</text>
      </svg>`;
    }
    
    const base64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
    setter(base64);
  };

  const handleAutoFillAndSimulate = () => {
    setApplicantName('张大帅');
    setApplicantGender('男');
    setApplicantAge('32');
    setApplicantEmergencyPhone('13812345678');
    setApplicantDrivingYears('10');
    setApplicantCity('上海');
    
    handleSimulatePhoto('id_front', setIdCardFront);
    handleSimulatePhoto('id_back', setIdCardBack);
    handleSimulatePhoto('license_front', setDriverLicenseFront);
    handleSimulatePhoto('license_back', setDriverLicenseBack);
  };

  const handleOnlineAppSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userPhone) return;
    
    const name = applicantName.trim();
    const gender = applicantGender;
    const age = parseInt(applicantAge, 10);
    const emgPhone = applicantEmergencyPhone.trim();
    const dYears = parseInt(applicantDrivingYears, 10);
    const city = applicantCity.trim();
    
    if (!name || !gender || isNaN(age) || !emgPhone || isNaN(dYears) || !city || !idCardFront || !idCardBack || !driverLicenseFront || !driverLicenseBack) {
      alert("⚠️ 提交失败：请完整填写履历表单、选择开通城市并准备好全部实名证照影像！");
      return;
    }
    
    if (!/^1[3-9]\d{9}$/.test(emgPhone)) {
      alert("⚠️ 请输入有效的11位紧急联系人手机号！");
      return;
    }
    
    setSubmittingApp(true);
    try {
      await setDoc(doc(db, 'online_applications', userPhone), {
        driverPhone: userPhone,
        driverName: name,
        driverGender: gender,
        driverAge: age,
        emergencyPhone: emgPhone,
        drivingYears: dYears,
        city,
        idCardFront,
        idCardBack,
        driverLicenseFront,
        driverLicenseBack,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Run real-time naming conflict suffix resolution
      await resolveAndSyncDuplicateNames();

      alert("🎉 申请提交成功！各项资料已实时安全同步至决策大盘运营管理后台，等待管理员审批核对，可在后台「审批功能」页查看其处理状态。");
    } catch (err: any) {
      console.error("Error submitting driver application:", err);
      alert("提交失败：" + err.message);
    } finally {
      setSubmittingApp(false);
    }
  };

  const formatOnlineTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleRedeemSubmit = async () => {
    const codeValue = redeemCode.trim().toUpperCase();
    if (!codeValue) {
      setModalMessage({ type: 'error', text: '请输入有效的兑换码/验证卡密！' });
      return;
    }
    
    setIsMatching(true);
    setModalMessage(null);
    
    try {
      const docRef = doc(db, 'vip_codes', codeValue);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        setModalMessage({ 
          type: 'error', 
          text: '❌ 匹配失败：该兑换码/充值卡密不存在或已被撤销。请从右侧决策管理后台「一键极速批产」生成真实卡密粘贴至此处！' 
        });
        setIsMatching(false);
        return;
      }

      const codeData = docSnap.data();
      if (codeData.isRedeemed) {
        setModalMessage({ 
          type: 'error', 
          text: '❌ 激活失败：该兑换码已被使用过，无法重复兑换！' 
        });
        setIsMatching(false);
        return;
      }

      const durationDays = codeData.duration || 30;
      const isForever = durationDays === 99999 || String(codeData.code || '').includes('FOREVER');

      let finalExpiryStr = '永久有效';
      if (!isForever) {
        // Calculate next expiry
        let currentExpiryDate = new Date();
        if (settings.vipExpiry && settings.vipExpiry !== '永久有效') {
          const parsed = Date.parse(settings.vipExpiry);
          if (!isNaN(parsed)) {
            const prevDate = new Date(parsed);
            if (prevDate.getTime() > currentExpiryDate.getTime()) {
              currentExpiryDate = prevDate;
            }
          }
        }

        currentExpiryDate.setDate(currentExpiryDate.getDate() + durationDays);
        const yyyy = currentExpiryDate.getFullYear();
        const mm = String(currentExpiryDate.getMonth() + 1).padStart(2, '0');
        const dd = String(currentExpiryDate.getDate()).padStart(2, '0');
        finalExpiryStr = `${yyyy}-${mm}-${dd}`;
      }

      // Update Firestore document to mark as redeemed
      await updateDoc(docRef, {
        isRedeemed: true,
        redeemedAt: new Date().toISOString(),
        redeemedBy: localStorage.getItem('dd_user_phone') || settings.customAppName?.trim() || '手机APP司机端'
      });

      // Update settings locally
      onUpdateSettings({
        ...settings,
        vipExpiry: finalExpiryStr
      });

      setModalMessage({
        type: 'success',
        text: isForever
          ? `🎉 云端兑换成功！您的软件尊享会员已成功激活 永久有效 特权！`
          : `🎉 云端兑换成功！您的软件尊享会员已成功续期 +${durationDays} 天！新有效期至：${finalExpiryStr}`
      });
      setRedeemCode('');
    } catch (e: any) {
      console.error(e);
      setModalMessage({ 
        type: 'error', 
        text: '❌ 连接云数据库出现异常: ' + e.message 
      });
    } finally {
      setIsMatching(false);
    }
  };

  const getVipCountdown = () => {
    const normalized = (settings.vipExpiry || '').trim();
    if (!settings.vipExpiry || normalized === '未激活' || normalized === '待激活' || normalized === '未激活待激活' || normalized === '') {
      return { 
        text: '待激活', 
        daysText: '待激活', 
        colorClass: 'text-slate-400 bg-slate-100 border border-slate-200 font-extrabold text-[9px]', 
        subColor: 'text-slate-400', 
        badgeText: '待激活' 
      };
    }
    if (normalized === '0' || normalized === '0天') {
      return { 
        text: '已到期', 
        daysText: '0天', 
        colorClass: 'text-red-500 bg-red-50 border border-red-200 font-bold text-[11px]', 
        subColor: 'text-slate-400', 
        badgeText: '已到期' 
      };
    }
    if (normalized === '永久有效') {
      return { 
        text: '永久', 
        daysText: '永久', 
        colorClass: 'text-amber-600 bg-gradient-to-tr from-amber-100 to-yellow-100 border border-amber-300 font-extrabold text-[11px] shadow-xs animate-subtle-glow', 
        subColor: 'text-amber-600 font-bold', 
        badgeText: '终身' 
      };
    }
    try {
      const expDate = new Date(settings.vipExpiry);
      const now = new Date();
      expDate.setHours(0, 0, 0, 0);
      now.setHours(0, 0, 0, 0);
      
      const diffTime = expDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays <= 0) {
        return { 
          text: '已过期', 
          daysText: '0天', 
          colorClass: 'text-red-500 bg-red-50 border border-red-200 font-bold text-[11px]', 
          subColor: 'text-slate-400', 
          badgeText: '已过期' 
        };
      }
      return { 
        text: `${diffDays}天`, 
        daysText: `${diffDays}天`, 
        colorClass: 'text-amber-600 bg-amber-50 border border-amber-200 font-bold font-mono text-[11px] shadow-xs', 
        subColor: 'text-amber-600 font-bold',
        badgeText: '已授权'
      };
    } catch {
      return { 
        text: '错误', 
        daysText: '未知', 
        colorClass: 'text-slate-400 bg-slate-50 border border-slate-200 font-semibold text-[10px]', 
        subColor: 'text-slate-400', 
        badgeText: '未知' 
      };
    }
  };

  const vipInfo = getVipCountdown();

  return (
    <div className="flex-1 flex flex-col justify-between h-full select-none bg-slate-100 relative overflow-hidden">
      
      {/* Toast Alert */}
      {toastMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[250] bg-slate-900/95 text-white px-5 py-2.5 rounded-2xl text-xs font-bold shadow-2xl border border-slate-700 animate-in fade-in zoom-in pointer-events-none">
          {toastMsg}
        </div>
      )}
      
      {/* 1. Header (Dark Navy Section - Custom colorways supported) */}
      <div className={`header-safe-pt pb-12 px-6 rounded-b-[32px] shadow-lg relative transition-all duration-300 ${
        settings.homepageColorway === 'blue' ? 'bg-[#1e3a8a]' :
        settings.homepageColorway === 'slate' ? 'bg-[#334155]' : 'bg-[#273046]'
      }`}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              {(() => {
                const isVipActive = checkVipActive(settings.vipExpiry);
                const currentDisplayName = isVipActive ? (settings.customAppName?.trim() || 'XX代驾') : 'XX代驾';
                
                const handleSaveName = () => {
                  setIsEditingName(false);
                  onUpdateSettings({
                    ...settings,
                    customAppName: tempName.trim()
                  });
                };
                
                if (isVipActive) {
                  if (isEditingName) {
                    return (
                      <input
                        type="text"
                        value={tempName}
                        onChange={(e) => setTempName(e.target.value)}
                        onBlur={handleSaveName}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveName();
                          if (e.key === 'Escape') setIsEditingName(false);
                        }}
                        maxLength={10}
                        className="bg-white/15 text-white border border-white/30 rounded-lg px-2 py-0.5 text-sm font-bold focus:outline-hidden focus:ring-1 focus:ring-amber-400 w-28 text-center"
                        autoFocus
                      />
                    );
                  } else {
                    return (
                      <span 
                        onClick={() => {
                          setTempName(currentDisplayName);
                          setIsEditingName(true);
                        }}
                        className="text-white text-xl font-bold tracking-tight cursor-pointer hover:text-amber-200 inline-flex items-center group transition-colors select-none"
                        title="点击修改代驾品牌名称"
                      >
                        {currentDisplayName}
                      </span>
                    );
                  }
                } else {
                  return (
                    <span 
                      onClick={() => {
                        setModalMessage({
                          type: 'error',
                          text: '🔒 提示：自定义品牌名称为VIP会员专属特权！激活VIP后即可一键修改。'
                        });
                        setShowRedeemModal(true);
                        setRedeemCode('');
                      }}
                      className="text-white text-xl font-bold tracking-tight cursor-pointer hover:text-white/80 transition-opacity select-none"
                      title="激活VIP解锁自定义名称"
                    >
                      {currentDisplayName}
                    </span>
                  );
                }
              })()}
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                isOnline ? 'bg-emerald-500 text-white' : 'bg-slate-500/40 text-slate-300'
              }`}>
                {isOnline ? '正在听单' : '离线状态'}
              </span>

            </div>
            {/* VIP/membership status banner is hidden per user request */}
          </div>
          
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setShowMessagesModal(true)}
              className="relative p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all active:scale-90"
              title="系统消息"
            >
              <MessageSquare className="w-5 h-5 text-gray-100" />
              {unreadMessages.length > 0 && (
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse border border-[#273046]"></span>
              )}
            </button>
            <button 
              id="user-avatar-btn"
              onClick={() => setShowUserModal(true)}
              className="w-9 h-9 rounded-full border border-slate-300 bg-slate-200 hover:bg-slate-300 flex items-center justify-center cursor-pointer transition-all active:scale-95 shadow-sm"
              title="用户中心"
            >
              <User className="w-5 h-5 text-slate-600" />
            </button>
          </div>
        </div>

        {/* Work stats display slots (exactly matching Screenshot 4 layout) */}
        <div className="grid grid-cols-3 gap-2 text-center text-white mt-2">
          <div>
            <div className="text-3xl font-bold font-display tracking-tight text-white mb-1">
              {stats.todayOrders}
            </div>
            <div className="text-[11px] text-gray-300 font-medium">今日成单</div>
          </div>
          <div>
            <div className="text-3xl font-bold font-display tracking-tight text-amber-400 mb-1">
              {(stats.todayIncome || 0).toFixed(2)}
            </div>
            <div className="text-[11px] text-gray-300 font-medium">今日收入</div>
          </div>
          <button
            onClick={() => setShowOrderHistory(true)}
            className="flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 active:scale-95 transition-all p-1 rounded-xl w-full"
            id="menu-btn-order-history"
          >
            <div className="text-3xl font-bold font-display tracking-tight text-teal-300 mb-1">
              {stats.myPoints}
            </div>
            <div className="text-[11px] text-gray-300 font-medium flex items-center justify-center space-x-0.5">
              <span>总成单量</span>
              <span className="text-[9px] text-teal-400">▶</span>
            </div>
          </button>
        </div>
      </div>

      {/* 2. Top menu cards (overlapping dark section) */}
      <div className="px-4 -translate-y-6 z-10" id="top-menu-grid-container">
        <div className="bg-white rounded-2xl shadow-md border border-[#ededed] p-3 grid grid-cols-6 gap-1 text-center">
          <button 
            onClick={() => setShowBuyPage(true)} 
            className="flex flex-col items-center justify-center group"
            id="menu-btn-buy"
          >
            <div className="w-10 h-10 rounded-full bg-sky-50 flex items-center justify-center text-sky-600 mb-1.5 transition-transform group-active:scale-95">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <span className="text-[10px] text-gray-700 font-bold font-sans">购买</span>
          </button>

          <button 
            onClick={() => {
              setShowRedeemModal(true);
              setRedeemCode('');
              setModalMessage(null);
            }} 
            className="flex flex-col items-center justify-center group"
            id="menu-btn-redeem"
          >
            <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 mb-1.5 transition-transform group-active:scale-95">
              <Gift className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-[10px] text-gray-700 font-bold font-sans">兑换码</span>
          </button>

          <div 
            onClick={() => setShowVipPurchaseModal(true)}
            className={`flex flex-col items-center justify-center cursor-pointer relative transition-all hover:scale-105 active:scale-95 duration-150 ${
              settings.vipExpiry ? '' : 'opacity-75'
            }`}
            id="menu-btn-vip"
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-1.5 transition-all ${vipInfo.colorClass}`}>
              <span className="text-[9px] leading-tight text-center truncate font-extrabold font-sans">
                {vipInfo.daysText}
              </span>
            </div>
            <span className="text-[10px] text-gray-700 font-bold font-sans">有效期</span>
            <span className={`absolute -top-1 right-0 text-[8px] px-1 rounded-full scale-80 font-bold text-white ${
              checkVipActive(settings.vipExpiry) ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'
            }`}>
              {vipInfo.badgeText}
            </span>
          </div>

          <button 
            onClick={() => {
              const cfg = getDriverCityConfig();
              if (!cfg.online_app_enabled) {
                setLocalAlert({
                  title: '提示',
                  message: '您所在的城市暂未开通服务，请联系客服',
                  type: 'info'
                });
                return;
              }
              if (settings.onlineOrdersEnabled && isCityDispatchEnabled === false) {
                setLocalAlert({
                  title: '提示',
                  message: '您所在的城市暂未开通服务，请联系客服',
                  type: 'info'
                });
                return;
              }
              setShowOnlineAppModal(true);
            }} 
            className="flex flex-col items-center justify-center group select-none relative"
            id="menu-btn-online-orders"
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-1.5 transition-all duration-200 group-active:scale-95 ${
              (settings.onlineOrdersEnabled && isCityDispatchEnabled === false)
                ? 'bg-slate-100 text-slate-400 border border-slate-200 opacity-60'
                : settings.onlineOrdersEnabled 
                  ? 'bg-emerald-550 text-white shadow-xs border border-emerald-600' 
                  : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
            }`}>
              {(settings.onlineOrdersEnabled && isCityDispatchEnabled === false) ? <Lock className="w-4 h-4 text-slate-400" /> : <Globe className="w-5 h-5" />}
            </div>
            <span className="text-[10px] text-gray-700 font-bold font-sans whitespace-nowrap">线上单开通</span>
            {(settings.onlineOrdersEnabled && isCityDispatchEnabled === false) ? (
              <span className="absolute -top-1 -right-1 text-[8px] bg-rose-500 text-white px-1 rounded-full font-black scale-85">已锁</span>
            ) : settings.onlineOrdersEnabled && (
              <span className="absolute top-0 right-0 w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span>
            )}
          </button>

          <button 
            onClick={() => {
              const cfg = getDriverCityConfig();
              if (!cfg.merchant_dispatch_enabled) {
                setLocalAlert({
                  title: '提示',
                  message: '您所在的城市暂未开通服务，请联系客服',
                  type: 'info'
                });
                return;
              }
              setShowMerchantDispatchModal(true);
            }}
            className="flex flex-col items-center justify-center relative transition-all duration-200 group"
            id="menu-btn-merchant-dispatch"
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center mb-1.5 transition-all duration-200 bg-indigo-50 text-indigo-600 group-active:scale-95 border border-indigo-100">
              <Briefcase className="w-5 h-5 text-indigo-600" />
            </div>
            <span className="text-[10px] text-gray-700 font-bold font-sans whitespace-nowrap">商户代叫</span>
          </button>

          <button 
            onClick={() => {
              const cfg = getDriverCityConfig();
              if (!cfg.squad_management_enabled) {
                setLocalAlert({
                  title: '提示',
                  message: '您所在的城市暂未有可加入的小队',
                  type: 'info'
                });
                return;
              }
              setShowDispatchModal(true);
            }}
            className="flex flex-col items-center justify-center relative transition-all duration-200 group cursor-pointer"
            id="menu-btn-dispatch"
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center mb-1.5 transition-all duration-200 bg-teal-50 text-teal-600 group-active:scale-95 border border-teal-100">
              <Users className="w-5 h-5" />
            </div>
            <span className="text-[10px] text-gray-500 font-bold font-sans">小队管理</span>
            <span className="absolute -top-1 -right-1 bg-teal-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold scale-90 whitespace-nowrap">
              {getActiveSquadDriverCount()}人
            </span>
          </button>
        </div>
      </div>

      {/* 2.5 New Message Tip Banner */}
      {unreadMessages.length > 0 && (
        <div 
          onClick={() => setShowMessagesModal(true)}
          className="mx-4 mb-4 bg-gradient-to-r from-pink-500/10 to-indigo-500/10 border border-indigo-250/60 hover:bg-indigo-500/15 py-2.5 px-4 rounded-xl flex items-center justify-between cursor-pointer animate-pulse shrink-0 transition-all active:scale-99"
          id="realtime-unread-messages-tip-banner"
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500"></span>
            </span>
            <p className="text-[11px] font-bold text-slate-800 truncate">
               📢 收到 {unreadMessages.length} 条管理后台发送的消息，点击立即查看！
            </p>
          </div>
          <span className="text-[9.5px] font-bold text-indigo-600 bg-white border border-indigo-150 rounded-lg px-2 py-0.5 whitespace-nowrap active:scale-95 shrink-0 shadow-xs">
            查阅 ➔
          </span>
        </div>
      )}

      {/* 3. Order Selection Hall (选单大厅) Component */}
      <div className="flex-1 px-4 pb-4 overflow-hidden flex flex-col justify-center">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3.5 flex flex-col flex-1 min-h-[220px] max-h-[300px] relative overflow-hidden transition-all text-left">
          
          {/* Header at Top-Left */}
          <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff7d00] animate-pulse"></span>
              <span className="text-[11px] font-extrabold text-slate-600 tracking-tight">选单大厅</span>
            </div>
            <span className="text-[9.5px] text-slate-400 font-medium">实时派单大厅</span>
          </div>

          {/* Hall Orders List - Filter out simulated orders */}
          {(() => {
            const isApproved = checkApprovalStatus();
            const visibleHallOrders = hallOrders.filter((ord: any) => !ord.isSimulated);

            if (visibleHallOrders.length === 0) {
              return (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-3 text-slate-400">
                  <Bell className="w-7 h-7 text-slate-300 mb-1.5 animate-pulse" />
                  <p className="text-xs font-bold text-slate-500">选单大厅暂无等待接单的订单</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">商户代叫系统触发后，未派出的订单将在此出现</p>
                </div>
              );
            }

            return (
              <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
                {visibleHallOrders.map((ord: any) => {
                  const savedLat = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lat') : null;
                  const savedLng = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lng') : null;
                  const currentDriverCoords = (driverCoords && isValidCoords(driverCoords.lat, driverCoords.lng))
                    ? driverCoords
                    : (savedLat && savedLng ? { lat: Number(savedLat), lng: Number(savedLng) } : DEFAULT_YINCHUAN_COORDS);

                  const { displayDistText, resolvedLat, resolvedLng } = calculateOrderDriverDistance(
                    ord.startLocation,
                    ord.passengerLat || ord.lat || ord.startLat,
                    ord.passengerLng || ord.lng || ord.startLng,
                    currentDriverCoords
                  );

                  // Attach resolved coords and distance text to order object
                  ord.resolvedLat = resolvedLat;
                  ord.resolvedLng = resolvedLng;
                  ord.distanceText = displayDistText;

                  return (
                    <div 
                      key={ord.id}
                      className="bg-slate-50/90 border border-slate-200/90 hover:border-amber-400 rounded-xl p-2.5 flex items-center justify-between gap-2 shadow-2xs transition-all"
                    >
                      {/* Horizontal details */}
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded-md bg-orange-100 text-[#ff7d00] text-[10px] font-black border border-orange-200 shrink-0">
                            【商户代叫】
                          </span>
                          <span className="text-xs font-black text-slate-800 tracking-wider">
                            起点：****
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-[10.5px] text-slate-600 font-medium flex-wrap">
                          <span>代步车: <strong className={ord.needScooter ? 'text-teal-600' : 'text-slate-500'}>{ord.needScooter ? '需要' : '不需要'}</strong></span>
                          <span>出发时间: <strong className="text-slate-800">{ord.scheduledTime || '即刻出发'}</strong></span>
                          <span>距离: <strong className="text-[#ff7d00] font-mono font-bold">{displayDistText}</strong></span>
                        </div>
                      </div>

                      {/* Confirm Claim Button */}
                      <button
                        onClick={() => handleClaimHallOrder(ord)}
                        className={`px-3 py-1.5 font-extrabold text-[11px] rounded-xl shadow-xs active:scale-95 transition-all shrink-0 cursor-pointer whitespace-nowrap ${
                          isOnline
                            ? 'bg-gradient-to-r from-[#ff7d00] to-amber-500 hover:from-[#e06e00] hover:to-amber-600 text-white'
                            : 'bg-slate-200 text-slate-500 border border-slate-300'
                        }`}
                        title={isOnline ? '点击抢单' : '您当前处于下线状态，需上线后才能抢单'}
                      >
                        {isOnline ? '确认抢单' : '下线(需上线抢单)'}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>



      {/* 5. Bottom System Controls (Matching Screen 4) */}
      <div className="bg-white border-t border-gray-200/80 px-4 pt-3 pb-[calc(1.25rem+max(env(safe-area-inset-bottom,0px),16px))] flex items-center justify-between gap-3 shadow-inner shrink-0 relative z-30 android-nav-safe-pb">
        
        {/* Settings button on left side */}
        <button
          onClick={() => onNavigate('settings')}
          className="flex flex-col items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 w-14 h-13 rounded-xl border border-gray-200/60 transition-transform active:scale-95"
        >
          <Settings className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] font-semibold text-slate-500">设置</span>
        </button>

        {/* Central Physical-styled slide-to-online switch */}
        <div 
          ref={sliderWidthRef}
          onClick={handleSlideToggleClick}
          className={`flex-1 relative h-13 rounded-2xl flex items-center justify-center overflow-hidden border shadow-inner transition-colors duration-300 cursor-pointer touch-none ${
            isOnline ? 'bg-emerald-500 border-emerald-600/30' : 'bg-[#94a3b8] border-slate-400'
          }`}
        >
          {/* Swipe guide text */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
            <span className="text-[12px] font-bold tracking-wider text-white drop-shadow-xs">
              {isOnline ? '右滑下线停止报单' : '右滑上线开始报单'}
            </span>
          </div>

          {/* Interactive floating slide handler */}
          <div
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onMouseDown={handleMouseDown}
            onClick={(e) => {
              e.stopPropagation(); // Avoid double click trigger
              handleSlideToggleClick();
            }}
            style={{ 
              transform: `translateX(${sliderPos}px)`,
              transition: isSliding ? 'none' : 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
            className={`absolute left-1.5 w-12 h-10 select-none rounded-xl flex items-center justify-center shadow-md cursor-pointer transform transition-all active:scale-95 bg-white touch-none ${
              isOnline ? 'text-emerald-600' : 'text-slate-600'
            }`}
          >
            <ChevronRight className="w-5 h-5 font-bold animate-pulse" />
          </div>
        </div>

        {/* Direct Register Code Order button on right side */}
        <button
          onClick={() => {
            const isVip = checkVipActive(settings.vipExpiry);
            if (!isVip && stats.todayOrders >= 2) {
              alert('🔒 提示：非VIP会员每日限制报单次数已用完（每天限额2次，明早6:00自动恢复，激活VIP解除限制）。');
              return;
            }
            if (!isOnline) {
              alert('温馨提示：请先在底部右滑上线，即可上线并进行一键报单接客！');
              return;
            }
            onNavigate('create_order');
          }}
          className="flex flex-col items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 w-14 h-13 rounded-xl border border-gray-200/60 transition-transform active:scale-95"
        >
          <QrCode className="w-5 h-5 mb-0.5 text-teal-600" />
          <span className="text-[10px] font-semibold text-slate-500">报单</span>
        </button>
      </div>

      {/* 6. VIP Redemption Dialog Modal */}
      {showRedeemModal && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-5 z-50">
          <div className="bg-white rounded-[28px] w-full max-w-[320px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-amber-600 to-amber-500 text-white py-4 px-5 flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Crown className="w-5 h-5 text-amber-100 animate-bounce" />
                <span className="font-bold text-sm tracking-wide">VIP 会员激活</span>
              </div>
              <button 
                onClick={() => setShowRedeemModal(false)}
                className="p-1 rounded-full hover:bg-white/10 text-white leading-none transition-transform active:scale-90"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
            
            {/* Modal Body */}
            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed font-medium">
                输入您的兑换码激活或延长软件 VIP 超值特权服务。
              </p>
              
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  兑换码 / 充值卡号
                </label>
                <input 
                  type="text" 
                  value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value)}
                  placeholder="请输入兑换码（不区分大小写）" 
                  className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-3.5 text-xs font-semibold focus:outline-hidden focus:border-amber-500 focus:bg-white text-slate-800 transition-all font-mono"
                  disabled={isMatching}
                />
              </div>

              {/* Status Message */}
              {modalMessage && (
                <div className={`p-3.5 rounded-xl border text-[11px] leading-relaxed font-semibold ${
                  modalMessage.type === 'success' 
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-100' 
                    : 'bg-red-50 text-red-800 border-red-100'
                }`}>
                  {modalMessage.text}
                </div>
              )}

              {/* Spinner indicator during interactive matching */}
              {isMatching && (
                <div className="py-2 flex flex-col items-center justify-center space-y-2">
                  <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-[10px] font-bold text-amber-600 animate-pulse">正在与云端服务器匹配验证中...</span>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex space-x-3 pt-1">
                <button 
                  onClick={() => setShowRedeemModal(false)}
                  className="flex-1 h-11 rounded-xl text-slate-500 hover:bg-slate-50 text-xs font-bold border border-slate-200 transition-all active:scale-97"
                  disabled={isMatching}
                >
                  取消
                </button>
                <button 
                  onClick={handleRedeemSubmit}
                  className="flex-1 h-11 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-700 hover:to-amber-600 text-white text-xs font-bold shadow-md shadow-amber-500/10 active:scale-97 transition-all flex items-center justify-center"
                  disabled={isMatching}
                >
                  {isMatching ? '极速校验中' : '匹配激活'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. User Profile Option Modal (Triggered by Avatar) */}
      {showUserModal && (
        <div id="user-profile-modal" className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 w-full max-w-[280px] shadow-2xl border border-slate-100 flex flex-col space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <span className="font-bold text-xs text-slate-800">👤 当前登录账户</span>
              <button 
                onClick={() => setShowUserModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                title="关闭"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            
            <div className="space-y-1.5 text-center py-2">
              <div className="w-12 h-12 rounded-full bg-slate-100 mx-auto flex items-center justify-center text-slate-600 mb-2">
                <Users className="w-6 h-6" />
              </div>
              <p className="text-[10px] text-slate-400 font-bold">代驾系统授权手机号</p>
              <p className="font-mono text-sm font-black text-slate-800 tracking-wider">
                {userPhone ? `${userPhone.substring(0, 3)} ${userPhone.substring(3, 7)} ${userPhone.substring(7)}` : '未登录'}
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => {
                  setShowUserModal(false);
                  if (onLogout) {
                     onLogout();
                  }
                }}
                className="w-full py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm shadow-rose-500/10 active:scale-97 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                退出当前登录
              </button>
              <button
                onClick={() => setShowUserModal(false)}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl transition-all cursor-pointer text-center"
              >
                关闭对话框
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. System Messages & Notifications Overlay Screen Page */}
      {showMessagesModal && (
        <div id="system-messages-modal" className="absolute inset-0 bg-slate-50 z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
          {/* Page Toolbar Header */}
          <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white header-safe-pt pb-4 px-4 flex items-center justify-between shrink-0 shadow-md">
            <div className="flex items-center space-x-3">
              <button 
                onClick={() => {
                  setShowMessagesModal(false);
                  handleMarkAllRead();
                }}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-all active:scale-90"
                title="返回首页"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="text-left">
                <h3 className="font-extrabold text-sm text-white">系统消息与通知中心</h3>
                <span className="text-[10px] text-slate-300 font-normal">实时接收管理后台下发的重要公告</span>
              </div>
            </div>
            
            {unreadMessages.length > 0 && (
              <button 
                onClick={handleMarkAllRead}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 active:scale-95 text-xs text-white rounded-xl font-bold transition-all"
              >
                全部标为已读
              </button>
            )}
          </div>

          {/* Page Body Content */}
          <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 bg-slate-50">
            {unreadMessages.length > 0 && (
              <div className="flex items-center justify-between bg-indigo-50 border border-indigo-150 px-4 py-3 rounded-2xl text-[11px] shadow-xs">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
                  <span className="text-slate-800 font-extrabold">
                    📥 有 {unreadMessages.length} 条未读公告 / 消息已下发
                  </span>
                </div>
              </div>
            )}

            {userMessages.length === 0 ? (
              <div className="py-20 text-center text-slate-400 space-y-3 bg-white border border-slate-150 rounded-2xl p-6 shadow-xs max-w-md mx-auto font-sans">
                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <p className="text-sm font-extrabold text-slate-900">暂无可查看的系统消息</p>
                <p className="text-xs leading-relaxed text-slate-500 max-w-[240px] mx-auto font-medium">
                  请留意管理后台。管理员可能会下发安全通知、福利卡券、升级指南或系统维护调试消息。
                </p>
              </div>
            ) : (
              <div className="space-y-3.5 max-w-md mx-auto">
                {userMessages.map((msg) => {
                  const isNew = !viewedMessageIds.includes(msg.id);
                  return (
                    <div 
                      key={msg.id} 
                      onClick={() => handleMarkSingleRead(msg.id)}
                      className={`p-4 rounded-2xl border transition-all text-left relative cursor-pointer shadow-xs ${
                        isNew 
                          ? 'bg-white border-slate-300 ring-1 ring-black/5 hover:border-indigo-300' 
                          : 'bg-white/95 border-slate-200 opacity-95 hover:border-slate-300'
                      }`}
                    >
                      {isNew && (
                        <span className="absolute top-4 right-4 px-2 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-black leading-none uppercase tracking-wider animate-pulse flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                          未读
                        </span>
                      )}

                      <div className="pr-12 space-y-1">
                        <h4 className="text-sm font-extrabold text-slate-900 leading-snug">{msg.title}</h4>
                        <span className="text-[10px] text-slate-500 font-mono font-medium block">
                          {msg.createdAt ? new Date(msg.createdAt).toLocaleString('zh-CN', { hour12: false }) : ''}
                        </span>
                      </div>

                      <p className="text-xs text-slate-700 mt-3 leading-relaxed font-medium whitespace-pre-wrap break-words border-t border-slate-100 pt-2.5">
                        {msg.content}
                      </p>
                      
                      {!isNew && (
                        <div className="text-right mt-2 pt-1.5 border-t border-slate-100">
                          <span className="text-[10px] text-slate-400 font-bold">✓ 已阅读</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Page Footer Action Bar */}
          <div className="p-4 bg-white border-t border-slate-100 shrink-0 flex flex-col space-y-2">
            <button
              onClick={() => {
                setShowMessagesModal(false);
                handleMarkAllRead();
              }}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl active:scale-98 cursor-pointer transition-all text-center flex items-center justify-center space-x-2 shadow-md shadow-slate-900/10"
            >
              <Check className="w-4 h-4 text-white" />
              <span>全部标记已读并返回首页</span>
            </button>
          </div>
        </div>
      )}

      {/* 8.5 Squad Management / Apply Overlay Screen Page */}
      {showDispatchModal && (
        ['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机'].includes(userRole) && showAdminDispatchView ? (
          <div className="absolute inset-0 bg-[#0a0c16] z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
            {/* Page Toolbar Header */}
            <div className="bg-slate-900 text-white header-safe-pt pb-3.5 px-4 flex items-center justify-between shrink-0 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-teal-500/10 flex items-center justify-center border border-teal-500/20 text-teal-400">
                  <Users className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <h3 className="font-extrabold text-xs text-white">小队管理与商户代叫派单中心</h3>
                  <span className="text-[9px] text-slate-400 font-normal">管理小队成员、审批准入与商户派单</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowAdminDispatchView(false)}
                  className="px-2.5 py-1 text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30 rounded-lg hover:bg-teal-500/30 transition-all cursor-pointer"
                >
                  返回申请页
                </button>
                <button 
                  onClick={() => setShowDispatchModal(false)}
                  className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all active:scale-90"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>
            </div>

            {/* Page Body Content */}
            <div className="flex-1 overflow-y-auto relative">
              <DispatchValetOrder 
                onShowToast={(msg) => {
                  setLocalAlert({
                    title: '提示',
                    message: msg,
                    type: 'info'
                  });
                }}
                userPhone={userPhone}
                userRole={userRole}
                userTeamCity={effectiveCity}
                onClose={() => setShowDispatchModal(false)}
              />
            </div>
          </div>
        ) : checkApprovalStatus() ? (
          <div className="absolute inset-0 bg-[#f9f9f9] z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 font-sans">
            {renderApprovedResultView(() => setShowDispatchModal(false))}
          </div>
        ) : checkRejectionStatus() ? (
          <div className="absolute inset-0 bg-[#f9f9f9] z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 font-sans">
            {renderRejectedResultView(() => setShowDispatchModal(false))}
          </div>
        ) : (
          <div className="absolute inset-0 bg-[#f9f9f9] z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 font-sans">
            {/* TopAppBar Header */}
            <header className="sticky top-0 w-full z-50 h-16 flex items-center justify-between px-5 bg-[#f9f9f9] border-b border-[#dfc0af] shrink-0">
              <div className="flex items-center gap-4">
                <button 
                  type="button"
                  onClick={() => setShowDispatchModal(false)}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[#eeeeee] transition-colors active:scale-95 cursor-pointer text-[#984800]"
                >
                  <ArrowLeft className="w-6 h-6" />
                </button>
                <h1 className="text-xl font-bold text-[#984800]">申请加入小队</h1>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  type="button"
                  onClick={() => setShowDispatchModal(false)}
                  className="p-2 rounded-full hover:bg-[#eeeeee] text-[#584235] transition-colors active:scale-95 cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </header>

            {/* Main Content Canvas */}
            <main className="mt-4 px-5 flex-grow max-w-lg mx-auto w-full overflow-y-auto pb-24">
              {/* Team Identity Hero Card */}
              <div className="bg-white/95 backdrop-blur-md rounded-xl p-6 mb-6 shadow-xs overflow-hidden relative group border border-[#E0E0E0]">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
                  <Users className="w-24 h-24 text-[#1a1c1c]" />
                </div>
                <div className="relative z-10">
                  <label className="text-xs font-semibold text-[#8b7263] uppercase tracking-wider block mb-1">当前申请小队</label>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-[#ffdbc8] flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-7 h-7 text-[#733500]" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-[#1a1c1c]">{teamConfig?.teamName || `${effectiveCity || '银川'}代驾小队`}</h2>
                      <p className="text-sm text-[#5f5e5e]">点击查看当前城市可加入的小队名称</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Application Form */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  processApplicationSubmission(() => setShowDispatchModal(false));
                }}
                className="flex flex-col gap-3"
              >
                {/* Applicant Name */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-[#584235] px-1" htmlFor="apply-name-modal">
                    申请人真实姓名 <span className="text-[#ba1a1a]">*</span>
                  </label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-[#584235] w-5 h-5" />
                    <input 
                      id="apply-name-modal"
                      type="text"
                      maxLength={8}
                      required
                      value={applyName}
                      onChange={(e) => setApplyName(e.target.value.slice(0, 8))}
                      placeholder="请输入真实姓名申请"
                      className="w-full h-14 pl-12 pr-4 bg-white border border-[#dfc0af] rounded-xl text-base text-[#1a1c1c] placeholder:text-[#c8c6c5] focus:outline-none focus:border-[#ff7d00] focus:ring-2 focus:ring-[#ff7d00]/10 transition-all"
                    />
                  </div>
                  <p className="text-[10px] text-[#5f5e5e] px-1 flex justify-between">
                    <span>支持最多8个汉字</span>
                    <span className={applyName.length >= 8 ? 'text-[#ba1a1a] font-bold' : ''}>
                      {applyName.length}/8
                    </span>
                  </p>
                </div>

                {/* Phone Number */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1">
                    <label className="text-xs font-semibold text-[#584235]" htmlFor="apply-phone-modal">
                      申请人手机号码 <span className="text-[#ba1a1a]">*</span>
                    </label>
                    <span className="text-[10px] text-[#733500] font-bold bg-[#ffdbc8]/60 px-2 py-0.5 rounded flex items-center gap-1">
                      <Lock className="w-3 h-3 text-[#733500]" /> 绑定APP账号 (不可修改)
                    </span>
                  </div>
                  <div className="relative">
                    <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-[#584235] w-5 h-5" />
                    <input 
                      id="apply-phone-modal"
                      type="tel"
                      required
                      readOnly
                      pattern="^1[3-9]\d{9}$"
                      value={userPhone || applyPhone}
                      placeholder="当前登录账号手机号"
                      className="w-full h-14 pl-12 pr-4 bg-slate-100/90 border border-[#dfc0af] rounded-xl text-base text-[#1a1c1c] font-mono cursor-not-allowed select-none transition-all"
                    />
                  </div>
                </div>

                {/* Notes/Remarks */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-[#584235] px-1" htmlFor="apply-remarks-modal">
                    申请备注
                  </label>
                  <div className="relative">
                    <textarea 
                      id="apply-remarks-modal"
                      rows={4}
                      value={applyRemarks}
                      onChange={(e) => setApplyRemarks(e.target.value)}
                      placeholder="例如：尊敬的审核人员你好：我是XXX，手机后四尾尾号（0000），本人身份信息确认填写正确，审核如遇问题！可微信或群消息联系确认本人真实身份"
                      className="w-full p-4 bg-white border border-[#dfc0af] rounded-xl text-base text-[#1a1c1c] placeholder:text-[#c8c6c5] focus:outline-none focus:border-[#ff7d00] focus:ring-2 focus:ring-[#ff7d00]/10 transition-all resize-none"
                    />
                  </div>
                  <div className="flex gap-2 items-start bg-[#ffdbc8]/30 p-3 rounded-lg border border-[#ffdbc8]">
                    <Info className="w-5 h-5 text-[#984800] shrink-0 mt-0.5" />
                    <p className="text-xs text-[#733500] leading-relaxed">
                      填写越详细，越增加审核成功几率，最好当面审核！
                    </p>
                  </div>
                </div>

                {/* Submit Button Area */}
                <div className="mt-6">
                  <button 
                    type="submit"
                    disabled={isSubmittingApply}
                    className="w-full h-14 bg-[#ff7d00] hover:bg-[#E67000] active:scale-95 text-white font-semibold text-base rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isSubmittingApply ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>正在提交审核...</span>
                      </>
                    ) : (
                      <>
                        <span>确认填写信息正确发起审核</span>
                        <Send className="w-5 h-5" />
                      </>
                    )}
                  </button>
                  <p className="text-center mt-4 text-[#5f5e5e] text-sm">
                    申请后预计在 1个工作日内完成审核
                  </p>
                </div>
              </form>

              {/* Illustration / Mood Decor */}
              <div className="mt-8 opacity-50 flex justify-center pb-8">
                <div className="w-full max-w-[200px] aspect-video rounded-2xl overflow-hidden grayscale border border-slate-200">
                  <img 
                    className="w-full h-full object-cover" 
                    alt="Driver Onboarding"
                    src={VALET_CAR_BANNER_PATH}
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (target.src !== VALET_CAR_BANNER_BASE64) {
                        target.src = VALET_CAR_BANNER_BASE64;
                      }
                    }}
                    referrerPolicy="no-referrer"
                  />
                </div>
              </div>
            </main>
          </div>
        )
      )}

      {/* 8.6 Apply to Join Squad Overlay Screen Page */}
      {showApplySquadModal && (
        <div className="absolute inset-0 bg-[#f9f9f9] z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 font-sans">
          {checkApprovalStatus() ? (
            renderApprovedResultView(() => setShowApplySquadModal(false))
          ) : checkRejectionStatus() ? (
            renderRejectedResultView(() => setShowApplySquadModal(false))
          ) : (
            <>
              {/* TopAppBar Header */}
              <header className="sticky top-0 w-full z-50 h-16 flex items-center justify-between px-5 bg-[#f9f9f9] border-b border-[#dfc0af] shrink-0">
                <div className="flex items-center gap-4">
                  <button 
                    type="button"
                    onClick={() => setShowApplySquadModal(false)}
                    className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[#eeeeee] transition-colors active:scale-95 cursor-pointer text-[#984800]"
                  >
                    <ArrowLeft className="w-6 h-6" />
                  </button>
                  <h1 className="text-xl font-bold text-[#984800]">申请加入小队</h1>
                </div>
                <button 
                  type="button"
                  onClick={() => setShowApplySquadModal(false)}
                  className="p-2 rounded-full hover:bg-[#eeeeee] text-[#584235] transition-colors active:scale-95 cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
              </header>

              {/* Main Content Canvas */}
              <main className="mt-4 px-5 flex-grow max-w-lg mx-auto w-full overflow-y-auto pb-24">
                {/* Team Identity Hero Card */}
                <div className="bg-white/95 backdrop-blur-md rounded-xl p-6 mb-6 shadow-xs overflow-hidden relative group border border-[#E0E0E0]">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
                    <Users className="w-24 h-24 text-[#1a1c1c]" />
                  </div>
                  <div className="relative z-10">
                    <label className="text-xs font-semibold text-[#8b7263] uppercase tracking-wider block mb-1">当前申请小队</label>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-[#ffdbc8] flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-7 h-7 text-[#733500]" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-[#1a1c1c]">{teamConfig?.teamName || `${effectiveCity || '银川'}代驾小队`}</h2>
                        <p className="text-sm text-[#5f5e5e]">点击查看当前城市可加入的小队名称</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Application Form */}
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    processApplicationSubmission(() => setShowApplySquadModal(false));
                  }}
                  className="flex flex-col gap-3"
                >
                  {/* Applicant Name */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-[#584235] px-1" htmlFor="apply-name">
                      申请人真实姓名 <span className="text-[#ba1a1a]">*</span>
                    </label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-[#584235] w-5 h-5" />
                      <input 
                        id="apply-name"
                        type="text"
                        maxLength={8}
                        required
                        value={applyName}
                        onChange={(e) => setApplyName(e.target.value.slice(0, 8))}
                        placeholder="请输入真实姓名申请"
                        className="w-full h-14 pl-12 pr-4 bg-white border border-[#dfc0af] rounded-xl text-base text-[#1a1c1c] placeholder:text-[#c8c6c5] focus:outline-none focus:border-[#ff7d00] focus:ring-2 focus:ring-[#ff7d00]/10 transition-all"
                      />
                    </div>
                    <p className="text-[10px] text-[#5f5e5e] px-1 flex justify-between">
                      <span>支持最多8个汉字</span>
                      <span className={applyName.length >= 8 ? 'text-[#ba1a1a] font-bold' : ''}>
                        {applyName.length}/8
                      </span>
                    </p>
                  </div>

                  {/* Phone Number */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between px-1">
                      <label className="text-xs font-semibold text-[#584235]" htmlFor="apply-phone">
                        申请人手机号码 <span className="text-[#ba1a1a]">*</span>
                      </label>
                      <span className="text-[10px] text-[#733500] font-bold bg-[#ffdbc8]/60 px-2 py-0.5 rounded flex items-center gap-1">
                        <Lock className="w-3 h-3 text-[#733500]" /> 绑定APP账号 (不可修改)
                      </span>
                    </div>
                    <div className="relative">
                      <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-[#584235] w-5 h-5" />
                      <input 
                        id="apply-phone"
                        type="tel"
                        required
                        readOnly
                        pattern="^1[3-9]\d{9}$"
                        value={userPhone || applyPhone}
                        placeholder="当前登录账号手机号"
                        className="w-full h-14 pl-12 pr-4 bg-slate-100/90 border border-[#dfc0af] rounded-xl text-base text-[#1a1c1c] font-mono cursor-not-allowed select-none transition-all"
                      />
                    </div>
                  </div>

                  {/* Notes/Remarks */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-[#584235] px-1" htmlFor="apply-remarks">
                      申请备注
                    </label>
                    <div className="relative">
                      <textarea 
                        id="apply-remarks"
                        rows={4}
                        value={applyRemarks}
                        onChange={(e) => setApplyRemarks(e.target.value)}
                        placeholder="例如：尊敬的审核人员你好：我是XXX，手机后四尾尾号（0000），本人身份信息确认填写正确，审核如遇问题！可微信或群消息联系确认本人真实身份"
                        className="w-full p-4 bg-white border border-[#dfc0af] rounded-xl text-base text-[#1a1c1c] placeholder:text-[#c8c6c5] focus:outline-none focus:border-[#ff7d00] focus:ring-2 focus:ring-[#ff7d00]/10 transition-all resize-none"
                      />
                    </div>
                    <div className="flex gap-2 items-start bg-[#ffdbc8]/30 p-3 rounded-lg border border-[#ffdbc8]">
                      <Info className="w-5 h-5 text-[#984800] shrink-0 mt-0.5" />
                      <p className="text-xs text-[#733500] leading-relaxed">
                        填写越详细，越增加审核成功几率，最好当面审核！
                      </p>
                    </div>
                  </div>

                  {/* Submit Button Area */}
                  <div className="mt-6">
                    <button 
                      type="submit"
                      disabled={isSubmittingApply}
                      className="w-full h-14 bg-[#ff7d00] hover:bg-[#E67000] active:scale-95 text-white font-semibold text-base rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isSubmittingApply ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>正在提交审核...</span>
                        </>
                      ) : (
                        <>
                          <span>确认填写信息正确发起审核</span>
                          <Send className="w-5 h-5" />
                        </>
                      )}
                    </button>
                    <p className="text-center mt-4 text-[#5f5e5e] text-sm">
                      申请后预计在 1个工作日内完成审核
                    </p>
                  </div>
                </form>

                {/* Illustration / Mood Decor */}
                <div className="mt-8 opacity-50 flex justify-center pb-8">
                  <div className="w-full max-w-[200px] aspect-video rounded-2xl overflow-hidden grayscale border border-slate-200">
                    <img 
                      className="w-full h-full object-cover" 
                      alt="Driver Onboarding"
                      src={VALET_CAR_BANNER_PATH}
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (target.src !== VALET_CAR_BANNER_BASE64) {
                          target.src = VALET_CAR_BANNER_BASE64;
                        }
                      }}
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
              </main>
            </>
          )}
        </div>
      )}

      {/* 8.3 Merchant Dispatch Overlay Screen Page */}
      {showMerchantDispatchModal && (
        <div className="absolute inset-0 bg-[#0a0c16] z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
          {/* Page Toolbar Header */}
          <div className="bg-slate-950 text-white header-safe-pt pb-3.5 px-4 flex items-center justify-between shrink-0 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/25 text-indigo-400">
                <Briefcase className="w-4 h-4" />
              </div>
              <div className="text-left">
                <h3 className="font-extrabold text-xs text-white">商户代叫派单系统</h3>
                <span className="text-[9px] text-slate-400 font-normal">调度管理特定司机与订单派发</span>
              </div>
            </div>
            <button 
              onClick={() => setShowMerchantDispatchModal(false)}
              className="text-slate-400 hover:text-white transition-colors p-1"
              title="返回首页"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Page Body Content */}
          <div className="flex-1 overflow-y-auto relative">
            <DispatchValetOrder 
              onShowToast={(msg) => {
                setLocalAlert({
                  title: '提示',
                  message: msg,
                  type: 'info'
                });
              }}
              userPhone={userPhone}
              userRole={userRole}
              userTeamCity={effectiveCity}
            />
          </div>
        </div>
      )}

      {/* 8.2 VIP Member Subscription Purchase Overlay Screen Page */}
      {showVipPurchaseModal && (
        <div className="absolute inset-0 bg-slate-50 z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
          {/* Page Toolbar Header */}
          <div className="bg-slate-900 text-white header-safe-pt pb-3.5 px-4 flex items-center justify-between shrink-0 border-b border-slate-800 animate-fade-in">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-400">
                <Crown className="w-4 h-4" />
              </div>
              <div className="text-left">
                <h3 className="font-extrabold text-xs text-white">VIP 尊享特权中心</h3>
                <span className="text-[9px] text-slate-400 font-normal">永久会员，收入倍增，解锁无限可能</span>
              </div>
            </div>
            <button 
              onClick={() => {
                setShowVipPurchaseModal(false);
                setVipPurchaseSuccess(false);
              }}
              className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all active:scale-90"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          {!vipPurchaseSuccess ? (
            <>
              {/* Page Content */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                
                {/* Current VIP Status Card */}
                <div className="bg-gradient-to-r from-slate-900 to-slate-850 rounded-2xl p-4 text-left border border-slate-800 relative overflow-hidden shadow-lg">
                  <div className="absolute right-[-20px] top-[-20px] opacity-10">
                    <Crown className="w-24 h-24 text-amber-500 rotate-12" />
                  </div>
                  <span className="inline-block px-2 py-0.5 rounded-full bg-amber-500 text-[8px] font-black text-slate-900 tracking-wide uppercase mb-2">
                    {checkVipActive(settings.vipExpiry) ? 'VIP 尊享会员' : '普通特约用户'}
                  </span>
                  <p className="text-xs font-bold text-white">
                    {checkVipActive(settings.vipExpiry) 
                      ? `您当前尊享 VIP 有效权益` 
                      : `您当前为普通免费额度账号`
                    }
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {checkVipActive(settings.vipExpiry) 
                      ? `服务到期时间: ${settings.vipExpiry}` 
                      : 'VIP未激活或已到期，使用兑换码激活享无限特权'
                    }
                  </p>
                </div>

                {/* Subtitle */}
                <div className="text-left">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    请选择您的尊享会员套餐
                  </span>
                </div>

                {/* Pricing Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'lifetime', days: 99999, price: 158, label: '永久会员', dailyPrice: '终身特惠', badge: '强力推荐', isFull: true, discountText: '日常 188元，限时特惠 158 元' },
                    { id: '365days', days: 365, price: 78, label: '365 天（1 年）', dailyPrice: '0.214 元 / 天', badge: '年卡特惠', isFull: false, discountText: '0.214 元 / 天' },
                    { id: '180days', days: 180, price: 45, label: '180 天（半年）', dailyPrice: '0.25 元 / 天', badge: '半年精选', isFull: false, discountText: '0.25 元 / 天' },
                    { id: '90days', days: 90, price: 25, label: '90 天', dailyPrice: '0.278 元 / 天', badge: '季卡超值', isFull: false, discountText: '0.278 元 / 天' },
                    { id: '30days', days: 30, price: 9.9, label: '30 天', dailyPrice: '0.33 元 / 天', badge: '月卡体验', isFull: false, discountText: '0.33 元 / 天' }
                  ].map((pkg, idx) => {
                    const isSelected = selectedVipPkgIndex === idx;
                    if (pkg.isFull) {
                      return (
                        <button
                          key={pkg.id}
                          onClick={() => setSelectedVipPkgIndex(idx)}
                          className={`text-left p-3.5 rounded-2xl border-2 transition-all relative overflow-hidden flex items-center justify-between col-span-2 cursor-pointer ${
                            isSelected 
                              ? 'border-amber-500 bg-amber-500/10 shadow-md shadow-amber-500/10' 
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className={`absolute top-0 right-0 text-[8px] font-bold px-2.5 py-0.5 rounded-bl-xl ${
                            isSelected ? 'bg-amber-500 text-slate-900' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {pkg.badge}
                          </div>
                          <div>
                            <div className="flex items-center space-x-1.5">
                              <Crown className="w-4 h-4 text-amber-500 shrink-0" />
                              <p className="text-sm font-black text-slate-900">{pkg.label}</p>
                            </div>
                            <p className="text-[10px] text-amber-700 font-bold mt-1">永久会员｜日常 188元，限时特惠 158 元</p>
                          </div>
                          <div className="text-right">
                            <div className="flex items-baseline justify-end space-x-0.5">
                              <span className="text-xs font-bold text-slate-500">¥</span>
                              <span className="text-2xl font-black text-slate-900 leading-none">158</span>
                            </div>
                            <span className="text-[9px] font-extrabold text-amber-600 block mt-1">🎉 终身尊享权益</span>
                          </div>
                        </button>
                      );
                    }
                    return (
                      <button
                        key={pkg.id}
                        onClick={() => setSelectedVipPkgIndex(idx)}
                        className={`text-left p-3 rounded-2xl border-2 transition-all relative overflow-hidden flex flex-col justify-between h-28 cursor-pointer ${
                          isSelected 
                            ? 'border-amber-500 bg-amber-500/5 shadow-md shadow-amber-500/5' 
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        {/* Selected Indicator Badge */}
                        <div className={`absolute top-0 right-0 text-[8px] font-bold px-2 py-0.5 rounded-bl-xl ${
                          isSelected ? 'bg-amber-500 text-slate-900' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {pkg.badge}
                        </div>

                        <div>
                          <p className="text-xs font-black text-slate-800">{pkg.label}</p>
                          <p className="text-[9px] text-slate-400 mt-0.5">{pkg.discountText}</p>
                        </div>

                        <div className="mt-2">
                          <div className="flex items-baseline space-x-0.5">
                            <span className="text-[10px] font-bold text-slate-500">¥</span>
                            <span className="text-lg font-black text-slate-900 leading-none">{pkg.price}</span>
                          </div>
                          <span className="text-[8.5px] font-medium text-amber-600 block mt-0.5">
                            {pkg.dailyPrice}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* VIP Special Rights */}
                <div className="space-y-2.5">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block text-left">
                    尊享 5 大专属会员权益
                  </span>
                  
                  <div className="space-y-2 text-left">
                    <div className="flex items-start space-x-3 p-3 rounded-xl bg-white border border-slate-150">
                      <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0 mt-0.5">
                        <Crown className="w-3 h-3 text-amber-500" />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-bold text-slate-800">1. 可以随意修改首页名字</h4>
                        <p className="text-[9.5px] text-slate-500 mt-0.5">支持自主定义并无缝修改主屏幕展示的专属品牌名称，不再受限于默认显示。</p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 p-3 rounded-xl bg-white border border-slate-150">
                      <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0 mt-0.5">
                        <Crown className="w-3 h-3 text-amber-500" />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-bold text-slate-800">2. 无限使用纠偏功能</h4>
                        <p className="text-[9.5px] text-slate-500 mt-0.5">可一键自动校正历史行驶轨迹点及里程，避免系统因偏移而引发计费误差。</p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 p-3 rounded-xl bg-white border border-slate-150">
                      <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0 mt-0.5">
                        <Crown className="w-3 h-3 text-amber-500" />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-bold text-slate-800">3. 无限使用报单二维码创单</h4>
                        <p className="text-[9.5px] text-slate-500 mt-0.5">自由生成创单报单二维码，提供乘客扫码、呼叫代驾的全链路极速闭环体验。</p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 p-3 rounded-xl bg-white border border-slate-150">
                      <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0 mt-0.5">
                        <Crown className="w-3 h-3 text-amber-500" />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-bold text-slate-800">4. 实时计费中无限使用导航</h4>
                        <p className="text-[9.5px] text-slate-500 mt-0.5">实时计费途中支持无限次自由拉起高精度的地图路线方案及智能语音导航功能。</p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 p-3 rounded-xl bg-white border border-slate-150">
                      <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0 mt-0.5">
                        <Crown className="w-3 h-3 text-amber-500" />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-bold text-slate-800">5. 不限制添加垫付额外费用</h4>
                        <p className="text-[9.5px] text-slate-500 mt-0.5">结算费用单中支持无限制添加各项代付高速过桥费等各类精细化款项。</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Redemption Prompt Info */}
                <div className="bg-amber-50 border border-amber-200/65 rounded-2xl p-4 text-left space-y-3 shadow-2xs">
                  <div className="flex items-center space-x-2 text-amber-800">
                    <Gift className="w-4.5 h-4.5 text-amber-600 shrink-0" />
                    <span className="text-xs font-black">请购买兑换码激活会员</span>
                  </div>
                  <p className="text-[10px] text-amber-700 leading-relaxed font-bold">
                    请点击下方按钮或前往首页，点击 <span className="text-amber-600 font-black">「卡密兑换」</span> 按钮，通过官方客服或渠道代理商获取【VIP 尊享激活兑换码】。
                  </p>
                  <p className="text-[9.5px] text-amber-600 leading-relaxed">
                    选择上方所需的会员天数套餐并获取相应兑换卡密后，输入并激活即可瞬间开启全部 VIP 专属品牌修改、纠偏校准与无限功能等尊享专项权限。
                  </p>
                </div>

              </div>

              {/* Footer Action Area */}
              <div className="p-4 bg-white border-t border-slate-100 shrink-0 flex flex-col space-y-2">
                <button
                  onClick={() => {
                    setShowVipPurchaseModal(false);
                    setShowRedeemModal(true);
                  }}
                  className="w-full py-3 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-md shadow-amber-500/10 flex items-center justify-center space-x-2 cursor-pointer active:scale-98"
                >
                  <Gift className="w-4 h-4" />
                  <span>立即去卡密兑换激活</span>
                </button>
                <button
                  onClick={() => setShowVipPurchaseModal(false)}
                  className="w-full py-2.5 rounded-xl font-bold text-[10px] text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all flex items-center justify-center cursor-pointer active:scale-98"
                >
                  暂不购买，返回首页
                </button>
              </div>
            </>
          ) : (
            /* VIP Success Celebratory Screen */
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-6 text-center space-y-5 bg-gradient-to-b from-amber-500/5 to-white overflow-y-auto">
              <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20 text-white animate-bounce shrink-0">
                <Crown className="w-8 h-8" />
              </div>

              <div className="space-y-2">
                <h3 className="text-base font-black text-slate-900">🎉 VIP 尊享会员订购成功！</h3>
                <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                  恭喜您！系统已安全验证入账账单，并向您的账户实时同步注入了尊享会员资格特权！
                </p>
              </div>

              <div className="w-full bg-white border border-slate-150 rounded-2xl p-4 text-left divide-y divide-slate-100 shadow-sm max-w-sm">
                <div className="pb-2.5 flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400">已激活套餐:</span>
                  <span className="text-xs font-black text-slate-800">
                    {['终身使用永久尊享会员', '365天尊享年度会员', '180天尊享半年会员', '90天尊享超级会员', '30天尊享体验会员'][selectedVipPkgIndex]}
                  </span>
                </div>
                <div className="py-2.5 flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400">支付总额:</span>
                  <span className="text-xs font-black text-emerald-600">
                    ¥{[158.0, 78.0, 45.0, 25.0, 9.9][selectedVipPkgIndex].toFixed(2)} 元
                  </span>
                </div>
                <div className="pt-2.5 flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400">当前有效期至:</span>
                  <span className="text-xs font-black text-amber-600">
                    {settings.vipExpiry || '即刻生效'}
                  </span>
                </div>
              </div>

              <div className="w-full max-w-sm space-y-2">
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-100 text-[10px] text-amber-700 font-bold flex items-start space-x-2 text-left">
                  <Gift className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>温馨提示：您现在可以立即享有 任意修改软件标题名称、不限次纠偏校准、无线报单和全程不限量配置各项费用等5大专属加成啦！</span>
                </div>

                <button
                  onClick={() => {
                    setShowVipPurchaseModal(false);
                    setVipPurchaseSuccess(false);
                  }}
                  className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl transition-all shadow-md active:scale-97 cursor-pointer"
                >
                  我知道了，立即体验VIP特权
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 8.3 Xianyu VIP Purchase Overlay Screen Page */}
      {showBuyPage && (
        <div className="absolute inset-0 bg-slate-50 z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
          {/* Header */}
          <div className="bg-slate-900 text-white header-safe-pt pb-3.5 px-4 flex items-center justify-between shrink-0 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-400">
                <Crown className="w-4 h-4 animate-pulse" />
              </div>
              <div className="text-left">
                <h3 className="font-extrabold text-xs text-white">上咸鱼购买 VIP 兑换码</h3>
                <span className="text-[9px] text-slate-400 font-normal">担保交易 · 秒级卡密自动兑换</span>
              </div>
            </div>
            <button 
              onClick={() => setShowBuyPage(false)}
              className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all active:scale-90"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 text-center bg-slate-50">
            {/* Guide Card */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-left space-y-2.5 shadow-xs">
              <div className="flex items-center space-x-2 text-amber-800 font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs">官方闲鱼担保交易流程</span>
              </div>
              <p className="text-[11px] text-amber-700 leading-relaxed font-bold">
                为确保交易资金安全，本应用已全面接入「闲鱼」官方平台担保交易。复制网址后在浏览器或闲鱼App中访问，下单后可立即获得【VIP尊享激活兑换码】。
              </p>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                下单后卡密将自动或由客服发送给您。收到卡密后，在首页点击 <span className="text-amber-600 font-bold">「兑换码」</span> 输入即可一秒自助激活，全功能无限特权立即生效。
              </p>
            </div>

            {/* URL Display and Action Section */}
            <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-sm text-left space-y-3.5">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                🛒 闲鱼购买官方直达网址
              </span>

              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 break-all select-all text-[11px] font-mono text-slate-600 leading-relaxed">
                {xianyuUrl}
              </div>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(xianyuUrl);
                  setLocalAlert({
                    title: '一键复制成功！',
                    message: '咸鱼购买网址已复制到剪贴板，请在浏览器或闲鱼App中打开，下单购买兑换码。',
                    type: 'success'
                  });
                }}
                className="w-full py-2.5 rounded-xl font-bold text-xs text-white bg-amber-500 hover:bg-amber-600 active:scale-98 transition-all flex items-center justify-center space-x-2 shadow-md shadow-amber-500/10 cursor-pointer"
              >
                <ClipboardCheck className="w-4 h-4" />
                <span>一键复制咸鱼购买网址</span>
              </button>
            </div>

            {/* VIP Rights Checklist */}
            <div className="space-y-2.5 text-left">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                💎 VIP 尊享五大专属特权
              </span>
              
              <div className="space-y-2">
                {[
                  { title: '1. 自主修改首页标题名称', desc: '随心定义展示，支持自定义您的专属代驾品牌，不再受软件名称限制。' },
                  { title: '2. 轨迹无限制高精校准纠偏', desc: '一键自动纠偏校正轨迹，避免地图偏移导致的计费产生严重差错。' },
                  { title: '3. 无限使用呼客二维码创单', desc: '轻松生成报单呼叫二维码，提供乘客呼叫下单的完美流畅闭环。' },
                  { title: '4. 实时计费中无限调用导航', desc: '支持在代驾计费过程中拉起高德地图高精路线规划与智能语音。' },
                  { title: '5. 支持添加多笔额外垫付费用', desc: '不设上限，计费结算单支持灵活添加过桥费、高速费等垫资。' }
                ].map((item, index) => (
                  <div key={index} className="flex items-start space-x-3 p-3 bg-white border border-slate-150 rounded-xl">
                    <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0 mt-0.5">
                      <Crown className="w-3 h-3 text-amber-500" />
                    </div>
                    <div>
                      <h4 className="text-[11px] font-bold text-slate-800">{item.title}</h4>
                      <p className="text-[9.5px] text-slate-500 mt-0.5 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer Action */}
          <div className="p-4 bg-white border-t border-slate-100 shrink-0 flex flex-col space-y-2">
            <button
              onClick={() => {
                setShowBuyPage(false);
                setShowRedeemModal(true);
                setRedeemCode('');
                setModalMessage(null);
              }}
              className="w-full py-3 rounded-xl font-bold text-xs text-white bg-slate-900 hover:bg-slate-800 transition-all flex items-center justify-center space-x-2 cursor-pointer active:scale-98"
            >
              <Gift className="w-4 h-4 text-white" />
              <span>已购买？立即去兑换卡密</span>
            </button>
            <button
              onClick={() => setShowBuyPage(false)}
              className="w-full py-2 rounded-xl font-bold text-[10px] text-slate-400 hover:bg-slate-100 transition-all cursor-pointer"
            >
              暂不购买，返回首页
            </button>
          </div>
        </div>
      )}

      {/* 8. Online Orders Activation application overlay screen page */}
      {showOnlineAppModal && (
        <div className="absolute inset-0 bg-slate-50 z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
          {/* Page Toolbar Header */}
          <div className="bg-slate-900 text-white header-safe-pt pb-3 px-4 flex items-center justify-between shrink-0 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-teal-500/10 flex items-center justify-center border border-teal-500/20 text-teal-400">
                <Globe className="w-4 h-4" />
              </div>
              <div className="text-left">
                <h3 className="font-extrabold text-xs text-white">线上听单资质认证</h3>
                <span className="text-[9px] text-slate-400 font-normal">当前城市线上订单开通申请</span>
              </div>
            </div>
            <button 
              onClick={() => setShowOnlineAppModal(false)}
              className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all active:scale-90"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Page Main Content area with relative scrolling */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            
            {loadingApp ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-3">
                <div className="w-8 h-8 border-3 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-[11px] font-black text-slate-500 animate-pulse">正在获取账号实时的同步审批状态...</p>
              </div>
            ) : onlineApp ? (
              /* IF AN APPLICATION RECORD ALREADY EXISTS */
              <div className="space-y-4">
                {/* 1. Status block */}
                {onlineApp.status === 'pending' && (
                  <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex flex-col items-center text-center space-y-2">
                    <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 animate-bounce">
                      <Clock className="w-6 h-6" />
                    </div>
                    <h4 className="text-sm font-black text-amber-800">审核中 (等待管理员审批)</h4>
                    <p className="text-[11px] text-amber-700 leading-relaxed font-bold font-sans max-w-[280px]">
                      您的线上高级听单资质资料已同步至云端审计中心，系统当前正在进行资质比对或管理员审核。预计2小时内完成，请耐心等待！
                    </p>
                  </div>
                )}

                {onlineApp.status === 'approved' && (
                  <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-150 flex flex-col items-center text-center space-y-2">
                    <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 animate-pulse">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <h4 className="text-sm font-black text-emerald-800">✅ 审核已通过 (享有线上派单资格)</h4>
                    <p className="text-[11px] text-emerald-700 leading-relaxed font-semibold font-sans max-w-[280px]">
                      恭喜您！您的线上代驾单业务已成功激活开通！您已加入平台的智能派单调度策略序列中。
                    </p>

                    {/* Integrated status message indicating automatic activation by admin */}
                    <div className="w-full bg-white rounded-xl p-3 border border-emerald-100 mt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <div className="text-left">
                        <span className="text-[11px] font-black text-slate-800 block">自动线上听单</span>
                        <span className="text-[9.5px] text-emerald-600 block leading-normal mt-0.5">管理后台审批通过后，系统已为您自动激活开启线上听单功能。您当前已加入平台智能调度派单队列。</span>
                      </div>
                      <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md shrink-0">
                        已自动开启
                      </span>
                    </div>
                  </div>
                )}

                {onlineApp.status === 'rejected' && (
                  <div className="bg-red-50 rounded-2xl p-4 border border-red-150 flex flex-col items-center text-center space-y-2">
                    <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <h4 className="text-sm font-black text-red-800">❌ 审核未通过 (申请已被驳回)</h4>
                    
                    <div className="w-full bg-white/90 border border-red-200/50 rounded-xl p-3 text-left">
                      <span className="text-[10px] font-black text-red-600 block mb-1">駁回原因 / 改进建议：</span>
                      <p className="text-[11px] text-red-800 leading-relaxed font-bold">
                        {onlineApp.rejectionReason || '原因：您提交的某一证件正面反射光太强、人像面部模糊或驾龄信息有误，无法认定资质。'}
                      </p>
                    </div>

                    <p className="text-[10px] text-slate-500 leading-relaxed max-w-[280px]">
                      您可以对填写的表单内容再次修正，并点击下方按钮重新发起认证审核，我们会加急为您流转。
                    </p>

                    <button
                      type="button"
                      onClick={async () => {
                        if (confirm("确定要重新填写申请吗？这会清除您上一次提交的信息状态。")) {
                          try {
                            setLoadingApp(true);
                            // Clear application
                            const appDocRef = doc(db, 'online_applications', userPhone || '');
                            await setDoc(appDocRef, {
                              ...onlineApp,
                              status: 're-filling',
                              updatedAt: new Date().toISOString()
                            });
                            // Reset state and allow re-filling
                            setOnlineApp(null);
                          } catch(err: any) {
                            alert("重置申请出错：" + err.message);
                          } finally {
                            setLoadingApp(false);
                          }
                        }
                      }}
                      className="w-full h-10 mt-2 rounded-xl bg-slate-900 border border-slate-950 font-extrabold text-xs text-white hover:bg-slate-800 transition-all flex items-center justify-center space-x-1 active:scale-97 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>更新资料并重新申请</span>
                    </button>
                  </div>
                )}

                {/* 2. Filed Info Details Summary Card */}
                <div className="bg-white rounded-2xl p-3.5 border border-slate-200 space-y-3">
                  <div className="flex items-center space-x-1.5 border-b border-slate-100 pb-2">
                    <FileCheck2 className="w-4 h-4 text-slate-800" />
                    <span className="text-xs font-black text-slate-900">已提交审核的申报案详情</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-left">
                    <div className="bg-slate-50 p-2 rounded-lg">
                      <span className="text-slate-500 block text-[9px]">司机手机号</span>
                      <span className="font-extrabold text-slate-800 font-mono">{onlineApp.driverPhone}</span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-lg">
                      <span className="text-slate-500 block text-[9px]">司机姓名</span>
                      <span className="font-extrabold text-slate-800">{onlineApp.driverName}</span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-lg">
                      <span className="text-slate-500 block text-[9px]">司机年龄 / 性别</span>
                      <span className="font-extrabold text-slate-800">{onlineApp.driverAge}岁 / {onlineApp.driverGender}</span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-lg">
                      <span className="text-slate-500 block text-[9px]">驾龄 (年)</span>
                      <span className="font-extrabold text-slate-800">{onlineApp.drivingYears} 年</span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-lg col-span-2">
                      <span className="text-slate-500 block text-[9px]">紧急联系人手机号</span>
                      <span className="font-extrabold text-slate-800 font-mono">{onlineApp.emergencyPhone}</span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-lg col-span-2 flex justify-between items-center">
                      <div>
                        <span className="text-slate-500 block text-[9px]">线上单开通城市</span>
                        <span className="font-extrabold text-teal-600">📍 {onlineApp.city || '暂无城市信息'}</span>
                      </div>
                      <span className="text-[8.5px] bg-slate-200 text-slate-500 font-bold px-1.5 py-0.5 rounded">不可自主修改</span>
                    </div>
                  </div>

                  {/* 4 Photo slots thumbnail preview */}
                  <div className="space-y-1.5 pt-1 text-left">
                    <span className="text-[10px] font-black text-slate-500 block">证件影像档案 (4份已提交)</span>
                    <div className="grid grid-cols-4 gap-1.5">
                      <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-0.5">
                        <img src={onlineApp.idCardFront} className="w-full h-11 object-cover rounded-md" alt="身份证正" referrerPolicy="no-referrer" />
                        <span className="text-[8px] text-slate-500 text-center block mt-0.5 truncate">身份证正</span>
                      </div>
                      <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-0.5">
                        <img src={onlineApp.idCardBack} className="w-full h-11 object-cover rounded-md" alt="身份证反" referrerPolicy="no-referrer" />
                        <span className="text-[8px] text-slate-500 text-center block mt-0.5 truncate">身份证反</span>
                      </div>
                      <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-0.5">
                        <img src={onlineApp.driverLicenseFront} className="w-full h-11 object-cover rounded-md" alt="驾驶证" referrerPolicy="no-referrer" />
                        <span className="text-[8px] text-slate-500 text-center block mt-0.5 truncate">驾驶证正</span>
                      </div>
                      <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-0.5">
                        <img src={onlineApp.driverLicenseBack} className="w-full h-11 object-cover rounded-md" alt="驾驶证副" referrerPolicy="no-referrer" />
                        <span className="text-[8px] text-slate-500 text-center block mt-0.5 truncate">驾驶证副</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-amber-50/50 border border-amber-200/40 rounded-xl text-left">
                  <p className="text-[10px] text-amber-800 leading-relaxed font-bold">
                    ⚠️ 提示：您当前处于线上单审批资料锁定期。任何信息的更新都需要通过后台管理人员审核，请勿擅自提交虚假照片，稽核中心将实时跟进审计。
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleOnlineAppSubmit} className="space-y-4">
                
                {/* FORM INPUTS */}
                <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3 shadow-2xs text-left">
                  <div className="flex items-center space-x-1.5 border-b border-slate-50 pb-2">
                    <User className="w-4 h-4 text-slate-800" />
                    <span className="text-xs font-black text-slate-900">1. 代驾基本履历登记</span>
                  </div>

                  {/* Registered Driver Mobile (Read-only) */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 block uppercase tracking-wider">
                      当前登录司机注册手机号 (默认不可更改)
                    </label>
                    <div className="relative">
                      <input 
                        type="text" 
                        value={userPhone || '未登录'}
                        disabled
                        className="w-full h-11 bg-slate-100 border border-slate-200 rounded-xl px-3 text-xs font-black text-slate-500 font-mono cursor-not-allowed"
                      />
                      <span className="absolute right-3 top-3 text-[9px] font-bold text-slate-400 bg-slate-200/50 px-1.5 py-0.5 rounded">不可篡改</span>
                    </div>
                  </div>

                  {/* 线上单开通城市 */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 block uppercase tracking-wider">
                      线上单开通城市 <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (onlineApp && (onlineApp.status === 'approved' || onlineApp.status === 'pending')) {
                            setLocalAlert({
                              title: "🔒 锁定提示",
                              message: "线上开通城市由省市运管中心登记认证。申请流程中及通过核准后无法自行修改变更，如需变更，请联系后台运营管理人员调整修改。",
                              type: "warning"
                            });
                            return;
                          }
                          setShowCitySelector(true);
                        }}
                        className={`w-full h-11 border rounded-xl px-3 flex items-center justify-between text-left text-xs font-extrabold font-sans transition-all active:scale-99 ${
                          applicantCity ? 'text-teal-600 bg-teal-50/10 border-teal-200' : 'text-slate-400 bg-slate-50 border-slate-200'
                        }`}
                      >
                        <span className="truncate">{applicantCity ? `📍 ${applicantCity}` : '🔍 点击选择开通听单城市 (首字母快速查找)'}</span>
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      </button>
                    </div>
                  </div>

                  {/* Driver Name & Gender Input Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 block">
                        司机姓名 <span className="text-red-500">*</span>
                      </label>
                      <input 
                        type="text" 
                        required
                        value={applicantName}
                        onChange={(e) => setApplicantName(e.target.value)}
                        placeholder="请输入姓名"
                        className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl px-3 text-xs font-extrabold text-slate-800"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 block">
                        司机性别 <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={applicantGender}
                        onChange={(e) => setApplicantGender(e.target.value)}
                        className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl px-3 text-xs font-extrabold text-slate-800"
                      >
                        <option value="男">男 (Male)</option>
                        <option value="女">女 (Female)</option>
                      </select>
                    </div>
                  </div>

                  {/* Driver Age & Driving Experience Years Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 block">
                        司机年龄 <span className="text-red-500">*</span>
                      </label>
                      <input 
                        type="number" 
                        required
                        min="18"
                        max="70"
                        value={applicantAge}
                        onChange={(e) => setApplicantAge(e.target.value)}
                        placeholder="例：35"
                        className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl px-3 text-xs font-extrabold text-slate-800 hover:shadow-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 block">
                        驾龄多少年 <span className="text-red-500">*</span>
                      </label>
                      <input 
                        type="number" 
                        required
                        min="1"
                        max="50"
                        value={applicantDrivingYears}
                        onChange={(e) => setApplicantDrivingYears(e.target.value)}
                        placeholder="年数"
                        className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl px-3 text-xs font-extrabold text-slate-800 hover:shadow-xs"
                      />
                    </div>
                  </div>

                  {/* Emergency Contact Mobile */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 block">
                      紧急联系人手机号码 <span className="text-red-500">*</span>
                    </label>
                    <input 
                      type="tel" 
                      required
                      pattern="1[3-9]\d{9}"
                      maxLength={11}
                      value={applicantEmergencyPhone}
                      onChange={(e) => setApplicantEmergencyPhone(e.target.value)}
                      placeholder="请输入紧急联系人的11位手机号"
                      className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl px-3 text-xs font-extrabold text-slate-800 font-mono"
                    />
                  </div>
                </div>

                {/* GRAPHIC CREDENTIAL PHOTO UPLOADS */}
                <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-4 shadow-2xs text-left">
                  <div className="flex items-center space-x-1.5 border-b border-slate-50 pb-2">
                    <Camera className="w-4 h-4 text-slate-800" />
                    <span className="text-xs font-black text-slate-900">2. 实名与执照影像档案上传</span>
                  </div>

                  {/* ID Card front and back upload elements */}
                  <div className="space-y-2">
                    <span className="text-[10.5px] font-black text-slate-700 block">居民身份证原始影像档案复印件</span>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Front Card */}
                      <div className="relative">
                        <input 
                          type="file" 
                          id="upload-id-front" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={(e) => handleFileChange(e, setIdCardFront)} 
                        />
                        <div 
                          onClick={() => document.getElementById('upload-id-front')?.click()}
                          className={`aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center p-2 text-center cursor-pointer transition-all ${
                            idCardFront ? 'border-teal-450 bg-teal-50/20' : 'border-slate-300 bg-slate-50 hover:bg-slate-100/50'
                          }`}
                        >
                          {idCardFront ? (
                            <img src={idCardFront} className="w-full h-full object-cover rounded-lg" alt="身份证人像" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="space-y-1">
                              <UploadCloud className="w-5 h-5 text-slate-400 mx-auto animate-pulse" />
                              <span className="text-[9.5px] font-extrabold text-slate-500 block">身份证【人像面】</span>
                              <span className="text-[8px] text-slate-400 block font-normal">点击上传照片</span>
                            </div>
                          )}
                        </div>
                        {idCardFront && (
                          <button 
                            type="button" 
                            onClick={(e) => { e.stopPropagation(); setIdCardFront(''); }}
                            className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-1 leading-none shadow-xs z-10"
                          >
                            <X className="w-3 h-3 text-white" />
                          </button>
                        )}
                      </div>

                      {/* Back Card */}
                      <div className="relative">
                        <input 
                          type="file" 
                          id="upload-id-back" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={(e) => handleFileChange(e, setIdCardBack)} 
                        />
                        <div 
                          onClick={() => document.getElementById('upload-id-back')?.click()}
                          className={`aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center p-2 text-center cursor-pointer transition-all ${
                            idCardBack ? 'border-teal-450 bg-teal-50/20' : 'border-slate-300 bg-slate-50 hover:bg-slate-100/50'
                          }`}
                        >
                          {idCardBack ? (
                            <img src={idCardBack} className="w-full h-full object-cover rounded-lg" alt="国徽面" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="space-y-1">
                              <UploadCloud className="w-5 h-5 text-slate-400 mx-auto animate-pulse" />
                              <span className="text-[9.5px] font-extrabold text-slate-500 block">身份证【国徽面】</span>
                              <span className="text-[8px] text-slate-400 block font-normal">点击上传照片</span>
                            </div>
                          )}
                        </div>
                        {idCardBack && (
                          <button 
                            type="button" 
                            onClick={(e) => { e.stopPropagation(); setIdCardBack(''); }}
                            className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-1 leading-none shadow-xs z-10"
                          >
                            <X className="w-3 h-3 text-white" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Driver License front and back upload elements */}
                  <div className="space-y-2">
                    <span className="text-[10.5px] font-black text-slate-700 block">机动车驾驶证原始影像档案复印件</span>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Front License */}
                      <div className="relative">
                        <input 
                          type="file" 
                          id="upload-license-front" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={(e) => handleFileChange(e, setDriverLicenseFront)} 
                        />
                        <div 
                          onClick={() => document.getElementById('upload-license-front')?.click()}
                          className={`aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center p-2 text-center cursor-pointer transition-all ${
                            driverLicenseFront ? 'border-teal-455 bg-teal-50/20' : 'border-slate-300 bg-slate-50 hover:bg-slate-100/50'
                          }`}
                        >
                          {driverLicenseFront ? (
                            <img src={driverLicenseFront} className="w-full h-full object-cover rounded-lg" alt="驾驶证正" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="space-y-1">
                              <UploadCloud className="w-5 h-5 text-slate-400 mx-auto animate-pulse" />
                              <span className="text-[9.5px] font-extrabold text-slate-500 block">驾驶证【正页】</span>
                              <span className="text-[8px] text-slate-400 block font-normal">点击上传照片</span>
                            </div>
                          )}
                        </div>
                        {driverLicenseFront && (
                          <button 
                            type="button" 
                            onClick={(e) => { e.stopPropagation(); setDriverLicenseFront(''); }}
                            className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-1 leading-none shadow-xs z-10"
                          >
                            <X className="w-3 h-3 text-white" />
                          </button>
                        )}
                      </div>

                      {/* Back License */}
                      <div className="relative">
                        <input 
                          type="file" 
                          id="upload-license-back" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={(e) => handleFileChange(e, setDriverLicenseBack)} 
                        />
                        <div 
                          onClick={() => document.getElementById('upload-license-back')?.click()}
                          className={`aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center p-2 text-center cursor-pointer transition-all ${
                            driverLicenseBack ? 'border-teal-455 bg-teal-50/20' : 'border-slate-300 bg-slate-50 hover:bg-slate-100/50'
                          }`}
                        >
                          {driverLicenseBack ? (
                            <img src={driverLicenseBack} className="w-full h-full object-cover rounded-lg" alt="驾驶证副" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="space-y-1">
                              <UploadCloud className="w-5 h-5 text-slate-400 mx-auto animate-pulse" />
                              <span className="text-[9.5px] font-extrabold text-slate-500 block">驾驶证【副页】</span>
                              <span className="text-[8px] text-slate-400 block font-normal">点击上传照片</span>
                            </div>
                          )}
                        </div>
                        {driverLicenseBack && (
                          <button 
                            type="button" 
                            onClick={(e) => { e.stopPropagation(); setDriverLicenseBack(''); }}
                            className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-1 leading-none shadow-xs z-10"
                          >
                            <X className="w-3 h-3 text-white" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Submitting controller & Actions */}
                <div className="pt-2 text-center">
                  <button
                    type="submit"
                    disabled={submittingApp || !applicantName.trim() || !applicantAge.trim() || !applicantEmergencyPhone.trim() || !applicantDrivingYears.trim() || !idCardFront || !idCardBack || !driverLicenseFront || !driverLicenseBack}
                    className={`w-full h-11 rounded-xl font-bold text-xs flex items-center justify-center transition-all cursor-pointer ${
                      (applicantName.trim() && applicantAge.trim() && applicantEmergencyPhone.trim() && applicantDrivingYears.trim() && idCardFront && idCardBack && driverLicenseFront && driverLicenseBack)
                        ? 'bg-gradient-to-r from-teal-600 to-indigo-650 text-white hover:opacity-95 shadow-md shadow-indigo-600/10 active:scale-97'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {submittingApp ? (
                      <span className="flex items-center space-x-1">
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        <span>正在同步双轨资质数据至后台...</span>
                      </span>
                    ) : (
                      <span>提交开通申请 (实名联合认证)</span>
                    )}
                  </button>
                  <p className="text-[9px] text-center text-slate-400 font-normal mt-2 leading-relaxed">
                    信息将采用全信加密存储，保证隐私安全。每个手机账户在绑定状态下仅支持一宗注册申请审计，严禁上传非本人的虚假伪造凭据。
                  </p>
                </div>

              </form>
            )}

          </div>
        </div>
      )}

      {/* 9. City Selection Modal */}
      {showCitySelector && (
        <div className="absolute inset-0 bg-slate-50 z-[100] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
          {/* Header */}
          <div className="bg-slate-900 text-white header-safe-pt pb-3 px-4 flex items-center justify-between shrink-0 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <MapPin className="w-4.5 h-4.5 text-teal-400" />
              <div className="text-left">
                <h3 className="font-extrabold text-xs text-white">选择听单城市</h3>
                <span className="text-[9px] text-slate-400 font-normal">支持首字母拼音快速跳转检索</span>
              </div>
            </div>
            <button 
              type="button"
              onClick={() => {
                setShowCitySelector(false);
                setSearchCityQuery('');
              }}
              className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all active:scale-90"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Search Bar */}
          <div className="bg-white p-3 border-b border-slate-100 shrink-0">
            <div className="relative">
              <input
                type="text"
                value={searchCityQuery}
                onChange={(e) => setSearchCityQuery(e.target.value)}
                placeholder="输入城市中文名或拼音检索（如：北京 / Beijing）"
                className="w-full h-10 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white focus:outline-hidden rounded-xl pl-9 pr-8 text-xs font-semibold text-slate-800 transition-all"
              />
              <span className="absolute left-3 top-3 text-slate-400">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.637 10.637z" />
                </svg>
              </span>
              {searchCityQuery && (
                <button
                  type="button"
                  onClick={() => setSearchCityQuery('')}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Main Area */}
          <div className="flex-1 overflow-y-auto relative min-h-0">
            {searchCityQuery.trim() ? (
              // Search Results List
              <div className="p-4 space-y-2">
                <span className="text-[10px] font-black text-slate-400 block tracking-wider uppercase">搜索结果</span>
                {(() => {
                  const filtered = ALL_CITIES_FLAT.filter(city => 
                    city.name.includes(searchCityQuery.trim()) || 
                    city.pinyin.toLowerCase().includes(searchCityQuery.trim().toLowerCase())
                  );

                  if (filtered.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
                        <MapPin className="w-8 h-8 text-slate-300 stroke-1" />
                        <span className="text-xs">未找到名称含 “{searchCityQuery}” 的城市</span>
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-3 gap-2">
                      {filtered.map(city => (
                        <button
                          key={city.name}
                          type="button"
                          onClick={() => {
                            setApplicantCity(city.name);
                            setShowCitySelector(false);
                            setSearchCityQuery('');
                          }}
                          className={`py-2 px-1 text-center text-xs font-black rounded-xl border transition-all cursor-pointer ${
                            applicantCity === city.name 
                              ? 'bg-teal-50 border-teal-500 text-teal-700 shadow-xs' 
                              : 'bg-white hover:bg-slate-50 border-slate-200/60 text-slate-700 shadow-3xs'
                          }`}
                        >
                          {city.name}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            ) : (
              // Full Directory
              <div className="pr-8 pl-4 py-4 space-y-4">
                {/* Current Selection */}
                <div className="space-y-1.5 text-left">
                  <span className="text-[10px] font-black text-slate-400 block tracking-wider uppercase">当前选择</span>
                  <div className="flex">
                    <div className={`py-2 px-4 text-xs font-black rounded-xl border flex items-center space-x-1 ${
                      applicantCity ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-slate-100 border-slate-200 text-slate-400'
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></span>
                      <span>{applicantCity ? `已选择：${applicantCity}` : '暂无选择'}</span>
                    </div>
                  </div>
                </div>

                {/* Popular Cities */}
                <div className="space-y-2 text-left">
                  <span className="text-[10px] font-black text-slate-400 block tracking-wider uppercase">热门城市</span>
                  <div className="grid grid-cols-3 gap-2">
                    {['北京', '上海', '广州', '深圳', '成都', '杭州', '武汉', '西安', '重庆'].map(name => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          setApplicantCity(name);
                          setShowCitySelector(false);
                          setSearchCityQuery('');
                        }}
                        className={`py-2 px-1 text-center text-xs font-black rounded-xl border transition-all cursor-pointer ${
                          applicantCity === name 
                            ? 'bg-teal-50 border-teal-500 text-teal-700 shadow-xs' 
                            : 'bg-white hover:bg-slate-50 border-slate-200/60 text-slate-700 shadow-3xs'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Directory by Alphabet letters */}
                <div className="space-y-4 text-left">
                  {CITY_GROUPS.map(group => (
                    <div key={group.letter} id={`city-letter-${group.letter}`} className="scroll-mt-4 space-y-2">
                      <div className="bg-slate-100/80 backdrop-blur-xs rounded-lg px-2.5 py-0.5 inline-block text-[10px] font-extrabold text-slate-600 font-mono tracking-wide">
                        {group.letter}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {group.cities.map(city => (
                          <button
                            key={city.name}
                            type="button"
                            onClick={() => {
                              setApplicantCity(city.name);
                              setShowCitySelector(false);
                              setSearchCityQuery('');
                            }}
                            className={`py-2 px-1 text-center text-xs font-black rounded-xl border transition-all cursor-pointer ${
                              applicantCity === city.name 
                                ? 'bg-teal-50 border-teal-500 text-teal-700 shadow-xs' 
                                : 'bg-white hover:bg-slate-50 border-slate-200/60 text-slate-700 shadow-3xs'
                            }`}
                          >
                            {city.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Floating Right Sidebar Alphabet Index (only visible when not searching) */}
            {!searchCityQuery && (
              <div className="absolute right-1 top-4 bottom-4 w-6 flex flex-col justify-between items-center py-2 bg-white/60 backdrop-blur-xs border border-slate-100 rounded-2xl z-25 shadow-2xs">
                {CITY_GROUPS.map(group => (
                  <button
                    key={group.letter}
                    type="button"
                    onClick={() => {
                      const element = document.getElementById(`city-letter-${group.letter}`);
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                    className="w-5 h-5 flex items-center justify-center text-[9px] font-black text-slate-500 hover:text-teal-600 hover:bg-teal-50 rounded-full transition-all"
                  >
                    {group.letter}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Beautiful custom pop-up dialog to replace window.alert inside iframes */}
      {localAlert && (
        <div className="absolute inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-3xl p-6 max-w-xs w-full shadow-2xl border border-slate-100 flex flex-col items-center text-center space-y-4 animate-in scale-in duration-200">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
              localAlert.type === 'success' ? 'bg-emerald-50 text-emerald-500' :
              localAlert.type === 'warning' ? 'bg-amber-50 text-amber-500' : 'bg-blue-50 text-blue-500'
            }`}>
              {localAlert.type === 'success' ? (
                <CheckCircle2 className="w-6 h-6" />
              ) : localAlert.type === 'warning' ? (
                <AlertCircle className="w-6 h-6" />
              ) : (
                <Bell className="w-6 h-6" />
              )}
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-black text-slate-800">{localAlert.title}</h4>
              <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
                {localAlert.message}
              </p>
            </div>
            <button
              onClick={() => setLocalAlert(null)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-97 text-white font-extrabold text-xs rounded-xl transition-all cursor-pointer shadow-lg"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      {/* 10. Beautiful Full-screen Order Center Modal (订单中心) */}
      {showOrderHistory && (
        <div className="absolute inset-0 bg-slate-50 dark:bg-zinc-950 z-[110] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 select-none">
          {/* Header */}
          <header className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 px-4 header-safe-pt pb-3 flex items-center justify-between shrink-0">
            <button 
              onClick={() => setShowOrderHistory(false)}
              className="w-10 h-10 flex items-center justify-start text-slate-600 dark:text-slate-300 active:scale-95 transition-all"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <h1 className="text-base font-black text-slate-800 dark:text-slate-100">订单中心</h1>
            <div className="w-10"></div> 
          </header>

          {/* Monthly / All counts Section */}
          <section className="bg-white dark:bg-zinc-900 py-6 flex items-center border-b border-slate-100 dark:border-zinc-800 shrink-0">
            <div className="flex-1 text-center border-r border-slate-100 dark:border-zinc-800">
              <div className="font-extrabold text-slate-800 dark:text-white text-3xl font-display">
                {stats.myPoints}
              </div>
              <div className="text-slate-400 dark:text-slate-500 mt-1 text-xs font-semibold">
                当月接单
              </div>
            </div>
            <div className="flex-1 text-center">
              <div className="font-extrabold text-slate-800 dark:text-white text-3xl font-display">
                {stats.myPoints}
              </div>
              <div className="text-slate-400 dark:text-slate-500 mt-1 text-xs font-semibold">
                全部单数
              </div>
            </div>
          </section>

          {/* Main Orders List (Scrollable) */}
          <main className="flex-1 overflow-y-auto pb-6 space-y-3 p-4">
            {driverOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-zinc-900 flex items-center justify-center text-slate-400">
                  <ClipboardList className="w-6 h-6" />
                </div>
                <p className="text-xs text-slate-400 font-bold">暂无历史接单记录</p>
              </div>
            ) : (
              driverOrders.map((order, idx) => {
                const rawPhone = (order.passengerPhone || order.phone || '').trim();
                const hasPhone = Boolean(rawPhone && rawPhone !== '无' && rawPhone !== '未填写');

                return (
                  <div 
                    key={order.id || idx} 
                    className="relative overflow-hidden rounded-2xl bg-red-600 dark:bg-red-700/80"
                  >
                    {/* Absolute Delete Button behind */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteOrder(order.id);
                      }}
                      className="absolute right-0 top-0 bottom-0 w-20 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white flex flex-col items-center justify-center space-y-1 transition-all z-0 delete-btn-container"
                    >
                      <Trash2 className="w-4.5 h-4.5 text-white animate-bounce duration-1000" />
                      <span className="text-[10px] font-black tracking-wider text-white">删除</span>
                    </button>

                     {/* Clickable content wrapper */}
                    <div 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (swipedOrderId === order.id) {
                          setSwipedOrderId(null);
                        } else {
                          setSwipedOrderId(order.id);
                        }
                      }}
                      style={{ 
                        transform: swipedOrderId === order.id ? 'translateX(-80px)' : 'translateX(0px)'
                      }}
                      className="bg-white dark:bg-zinc-900 relative rounded-2xl border border-slate-100 dark:border-zinc-800 p-5 shadow-xs hover:border-teal-500/30 z-10 select-none cursor-pointer transition-transform duration-300 ease-out"
                    >
                      {/* Timeline path line (green to orange vertical line) */}
                      <div className="absolute left-[25px] top-[74px] bottom-[115px] w-[1px] bg-slate-100 dark:bg-zinc-800 z-0 pointer-events-none"></div>

                      {/* Header info */}
                      <div className="flex justify-between items-center mb-3.5 pb-2.5 border-b border-slate-50 dark:border-zinc-800/50 pointer-events-none">
                        <div className="flex items-center text-slate-400 dark:text-slate-500 text-xs font-semibold">
                          <Clock className="w-3.5 h-3.5 mr-1.5" />
                          <span>{order.timeStr}</span>
                        </div>
                        <div className="flex items-center text-xs font-extrabold text-slate-500 dark:text-slate-400">
                          <span>¥{Number(order.amount).toFixed(2)} 已支付</span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-300 ml-0.5" />
                        </div>
                      </div>

                      {/* Locations */}
                      <div className="space-y-4 mb-3 relative z-10 pointer-events-none">
                        <div className="flex items-start">
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 mt-1 mr-3.5 flex-shrink-0 shadow-sm shadow-emerald-400/50"></div>
                          <span className="font-bold text-slate-700 dark:text-slate-200 text-xs leading-normal">
                            {order.startLocation}
                          </span>
                        </div>
                        <div className="flex items-start">
                          <div className="w-2.5 h-2.5 rounded-full bg-orange-400 mt-1 mr-3.5 flex-shrink-0 shadow-sm shadow-orange-400/50"></div>
                          <span className="font-bold text-slate-700 dark:text-slate-200 text-xs leading-normal">
                            {order.endLocation}
                          </span>
                        </div>
                      </div>

                      {/* Customer Phone & Dial Button Component */}
                      <div className="my-3 py-2 px-3 bg-slate-50 dark:bg-zinc-800/50 rounded-xl border border-slate-100 dark:border-zinc-800 flex items-center justify-between z-20">
                        <div className="flex items-center text-xs font-bold text-slate-700 dark:text-slate-200 truncate mr-2">
                          <Phone className="w-3.5 h-3.5 mr-1.5 text-teal-600 dark:text-teal-400 shrink-0" />
                          <span className="truncate">
                            电话：{hasPhone ? rawPhone : '客户的手机号码（无）'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasPhone) {
                              window.location.href = `tel:${rawPhone}`;
                            } else {
                              triggerToast('无手机号码');
                            }
                          }}
                          className="flex items-center space-x-1 px-2.5 py-1 bg-teal-600 hover:bg-teal-700 active:scale-95 text-white rounded-lg text-xs font-bold shadow-xs transition-all shrink-0 cursor-pointer pointer-events-auto"
                        >
                          <Phone className="w-3 h-3 text-white" />
                          <span>拨打电话</span>
                        </button>
                      </div>

                      {/* Tags */}
                      <div className="flex items-center justify-between pointer-events-none">
                        <span className="inline-block px-2.5 py-0.5 border border-slate-200 dark:border-zinc-700/80 rounded-md text-[10px] font-extrabold text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-zinc-900/50">
                          {order.type === '企业单' ? '报单' : (order.type === '特惠代驾' ? '乘客下单' : (order.type === '后台指派订单' ? '商户代叫订单' : (order.type || '报单')))}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </main>
        </div>
      )}

    </div>
  );
}
