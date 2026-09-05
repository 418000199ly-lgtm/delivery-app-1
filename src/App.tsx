/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import PhoneFrame from './components/PhoneFrame';
import HomeView from './components/HomeView';
import SettingsView, { regenerateQRCode } from './components/SettingsView';
import MileageModeView from './components/MileageModeView';
import ActiveTripView from './components/ActiveTripView';
import TripCostView from './components/TripCostView';
import PaymentQRView from './components/PaymentQRView';
import MerchantValetPaymentView from './components/MerchantValetPaymentView';
import CreateOrderView from './components/CreateOrderView';
import PassengerOrderView from './components/PassengerOrderView';
import WeChatAuthMobile from './components/WeChatAuthMobile';
import WeChatMiniSimulator from './components/WeChatMiniSimulator';
import AlipayMiniSimulator from './components/AlipayMiniSimulator';
import { isUnsetDestination, autoUpdateOrderDestinationIfUnset } from './utils/locationResolver';

import { 
  ChauffeurSettings, 
  BillingRules, 
  TripState, 
  DriverStats,
  DEFAULT_BILLING_RULES,
  DEFAULT_SETTINGS,
  checkVipActive
} from './types';
import { Sparkles, CheckCircle, Database, Smartphone, Users, ShieldAlert, FileCode, Download, Store, CreditCard } from 'lucide-react';
import AdminPanel from './components/AdminPanel';
import LoginView from './components/LoginView';
import MobileDispatchValetOrder from './components/MobileDispatchValetOrder';
import { db, doc, onSnapshot, setDoc, deleteDoc, collection, getDoc, getBaseApiUrl } from './lib/dbProxy';
import { IncomingOrderOverlay } from './components/IncomingOrderOverlay';
import { speakText, initAudioUnlock } from './utils/speech';
import { 
  initNotificationSystem, 
  triggerBackgroundOrderAlert, 
  registerBackgroundOrderListeners, 
  getPendingOrderCache, 
  clearPendingOrderCache 
} from './utils/backgroundNotification';
import { isOrderAlreadyEnded } from './utils/orderValidation';
import { getDeviceId, clearDeviceSession } from './utils/deviceSession';
import { downloadDeployZip } from './utils/downloadHelper';
import { safeSetItem, safeGetItem, safeRemoveItem } from './utils/safeStorage';

const getCityCenterCoords = (cityName: string): { lat: number; lng: number } => {
  const norm = (cityName || '').trim();
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
    '天津市': { lat: 39.1256, lng: 117.1902 },
    '郑州': { lat: 34.7579, lng: 113.6654 },
    '郑州市': { lat: 34.7579, lng: 113.6654 },
    '济南': { lat: 36.6512, lng: 117.1201 },
    '济南市': { lat: 36.6512, lng: 117.1201 },
    '青岛': { lat: 36.0671, lng: 120.3826 },
    '青岛市': { lat: 36.0671, lng: 120.3826 },
    '苏州': { lat: 31.2990, lng: 120.6186 },
    '苏州市': { lat: 31.2990, lng: 120.6186 },
    '宁波': { lat: 29.8683, lng: 121.5440 },
    '宁波市': { lat: 29.8683, lng: 121.5440 },
    '沈阳': { lat: 41.8057, lng: 123.4315 },
    '沈阳市': { lat: 41.8057, lng: 123.4315 },
    '哈尔滨': { lat: 45.8038, lng: 126.5350 },
    '哈尔滨市': { lat: 45.8038, lng: 126.5350 },
    '石家庄': { lat: 38.0423, lng: 114.5149 },
    '石家庄市': { lat: 38.0423, lng: 114.5149 },
    '太原': { lat: 37.8706, lng: 112.5489 },
    '太原市': { lat: 37.8706, lng: 112.5489 },
    '呼和浩特': { lat: 40.8174, lng: 111.6708 },
    '呼和浩特市': { lat: 40.8174, lng: 111.6708 },
    '乌鲁木齐': { lat: 43.8256, lng: 87.6168 },
    '乌鲁木齐市': { lat: 43.8256, lng: 87.6168 },
    '昆明': { lat: 25.0421, lng: 102.7122 },
    '昆明市': { lat: 25.0421, lng: 102.7122 },
    '贵阳': { lat: 26.5982, lng: 106.7112 },
    '贵阳市': { lat: 26.5982, lng: 106.7112 },
    '福州': { lat: 26.0745, lng: 119.3062 },
    '福州市': { lat: 26.0745, lng: 119.3062 },
    '厦门': { lat: 24.4798, lng: 118.0894 },
    '厦门市': { lat: 24.4798, lng: 118.0894 },
    '南昌': { lat: 28.6820, lng: 115.8579 },
    '南昌市': { lat: 28.6820, lng: 115.8579 },
    '合肥': { lat: 31.8608, lng: 117.2722 },
    '合肥市': { lat: 31.8608, lng: 117.2722 }
  };

  for (const key of Object.keys(mapper)) {
    if (norm.includes(key) || key.includes(norm)) {
      return mapper[key];
    }
  }

  return { lat: 38.4830, lng: 106.2350 };
};

const getPoiLngLat = (poi: any) => {
  if (!poi || !poi.location) return null;
  const loc = poi.location;
  if (typeof loc.getLng === 'function' && typeof loc.getLat === 'function') {
    return { lng: loc.getLng(), lat: loc.getLat() };
  }
  if (typeof loc.lng === 'number' && typeof loc.lat === 'number') {
    return { lng: loc.lng, lat: loc.lat };
  }
  if (typeof loc.lng === 'function' && typeof loc.lat === 'function') {
    return { lng: loc.lng(), lat: loc.lat() };
  }
  if (typeof loc === 'string') {
    const parts = loc.split(',');
    if (parts.length === 2) {
      return { lng: parseFloat(parts[0]), lat: parseFloat(parts[1]) };
    }
  }
  return null;
};

const getDistance = (lng1: number, lat1: number, lng2: number, lat2: number): number => {
  const radLat1 = lat1 * Math.PI / 180.0;
  const radLat2 = lat2 * Math.PI / 180.0;
  const a = radLat1 - radLat2;
  const b = lng1 * Math.PI / 180.0 - lng2 * Math.PI / 180.0;
  const s = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a/2), 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b/2), 2)));
  return s * 6378137; // Earth radius in meters
};

const getPoiDistance = (poi: any, centerLng?: number, centerLat?: number): number => {
  if (centerLng !== undefined && centerLat !== undefined) {
    const loc = getPoiLngLat(poi);
    if (loc) {
      return getDistance(centerLng, centerLat, loc.lng, loc.lat);
    }
  }
  if (poi.distance !== undefined && poi.distance !== null && poi.distance !== '') {
    const dist = Number(poi.distance);
    if (!isNaN(dist)) return dist;
  }
  return 999999;
};

const getHighPrecisionLocationName = (
  regeocode: any, 
  fallbackAddress: string, 
  centerLng?: number, 
  centerLat?: number
): string => {
  if (!regeocode) return fallbackAddress;

  const addressComp = regeocode.addressComponent || {};
  const unacceptableKeywords = ['公厕', '公共厕所', '垃圾站', '垃圾转运', '配电房', '变电站', '充电站', '高压线', '环卫'];
  const minorStoreKeywords = [
    '面馆', '砂锅面', '调和', '牛肉面', '羊肉', '饭店', '餐馆', '小吃', '快餐', '便利店', '超市', 
    '烟酒', '理发', '美发', '药店', '水果', '熟食', '烧烤', '火锅', '菜馆', '鲜花', '修车', 
    '洗车', '麻将', '棋牌', '网吧', '足浴', 'SPA', '客栈', '旅馆', '烤鸭', '奶茶', '大排档'
  ];

  let neighborhoodName = '';
  if (addressComp.neighborhood) {
    neighborhoodName = typeof addressComp.neighborhood === 'string'
      ? addressComp.neighborhood
      : (addressComp.neighborhood.name || '');
  }

  let aoiName = '';
  if (regeocode.aois && regeocode.aois.length > 0 && regeocode.aois[0] && regeocode.aois[0].name) {
    aoiName = regeocode.aois[0].name;
  }

  // Identify the closest road name
  let roadName = '';
  if (regeocode.roads && regeocode.roads.length > 0) {
    if (regeocode.roads[0] && regeocode.roads[0].name) {
      roadName = regeocode.roads[0].name;
    }
  }

  if (!roadName && addressComp.street && typeof addressComp.street === 'string' && addressComp.street.trim()) {
    roadName = addressComp.street.trim();
  }
  if (!roadName && addressComp.streetNumber && addressComp.streetNumber.street && typeof addressComp.streetNumber.street === 'string') {
    roadName = addressComp.streetNumber.street.trim();
  }

  let poiName = '';
  const communityName = neighborhoodName.trim() || aoiName.trim();

  // Sort POIs strictly by physical geometric distance to the GPS/center coordinate
  if (regeocode.pois && regeocode.pois.length > 0) {
    const validPois = regeocode.pois.filter((poi: any) => {
      const name = poi.name || '';
      return !unacceptableKeywords.some(kw => name.includes(kw));
    });
    const targetPois = validPois.length > 0 ? validPois : regeocode.pois;
    const sortedPois = [...targetPois].sort((a, b) => {
      const distA = getPoiDistance(a, centerLng, centerLat);
      const distB = getPoiDistance(b, centerLng, centerLat);

      const isGenericResA = /([0-9]+号楼|[0-9]+栋|[0-9]+单元)/.test(a.name || '');
      const isGenericResB = /([0-9]+号楼|[0-9]+栋|[0-9]+单元)/.test(b.name || '');

      if (!isGenericResA && isGenericResB && distA <= 150) return -1;
      if (isGenericResA && !isGenericResB && distA <= 150) return 1;

      return distA - distB;
    });

    const topPoiName = sortedPois[0] ? sortedPois[0].name || '' : '';
    const isMinorStore = minorStoreKeywords.some(kw => topPoiName.includes(kw));

    if (isMinorStore && communityName) {
      poiName = communityName;
    } else if (topPoiName) {
      poiName = topPoiName;
    } else if (communityName) {
      poiName = communityName;
    }
  } else if (communityName) {
    poiName = communityName;
  } else {
    let buildingName = '';
    if (addressComp.building) {
      buildingName = typeof addressComp.building === 'string'
        ? addressComp.building
        : (addressComp.building.name || '');
    }
    if (buildingName && buildingName.trim()) {
      poiName = buildingName;
    } else {
      const formattedAddress = regeocode.formattedAddress || fallbackAddress;
      let cleanLabel = formattedAddress;
      if (addressComp.province) cleanLabel = cleanLabel.replace(addressComp.province, '');
      if (addressComp.city) cleanLabel = cleanLabel.replace(addressComp.city, '');
      if (addressComp.district) cleanLabel = cleanLabel.replace(addressComp.district, '');
      poiName = cleanLabel.trim() ? cleanLabel : formattedAddress;
    }
  }

  // Display the exact POI name directly when found
  if (poiName && poiName.trim()) {
    return poiName.trim();
  }
  if (communityName) {
    return communityName;
  }
  if (roadName && roadName.trim()) {
    return roadName.trim();
  }
  return fallbackAddress;
};

const getCurrent6AmDay = (): string => {
  const now = new Date();
  const adjusted = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const yyyy = adjusted.getFullYear();
  const mm = String(adjusted.getMonth() + 1).padStart(2, '0');
  const dd = String(adjusted.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("AppErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    const instance = this as any;
    if (instance.state?.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full w-full bg-slate-50 p-6 text-center select-none font-sans">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4 shadow-sm text-amber-600">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">视图渲染遭遇防崩保护</h2>
          <p className="text-xs text-gray-500 mb-6 max-w-xs leading-relaxed">
            {instance.state.error?.message || "视图渲染发生异常，已拦截白屏现象。"}
          </p>
          <button
            onClick={() => {
              instance.setState({ hasError: false, error: null });
              if (instance.props?.onReset) instance.props.onReset();
            }}
            className="px-6 py-2.5 bg-[#26a69a] text-white text-xs font-bold rounded-xl shadow-md active:scale-95 transition-all"
          >
            重置并返回首页
          </button>
        </div>
      );
    }
    return instance.props?.children || null;
  }
}

export default function App() {
  // Support WeChat mobile authorization route directly
  if (window.location.pathname === '/wechat-login-mobile') {
    return <WeChatAuthMobile />;
  }

  const isStandaloneDispatchValet = () => {
    if (typeof window === 'undefined') return false;
    const hostname = window.location.hostname;
    const params = new URLSearchParams(window.location.search);
    if (params.get('passenger') === 'true' || params.has('driver') || params.get('admin') === 'true') {
      return false;
    }
    if (currentView === 'create_order' || currentView === 'navigation' || currentView === 'cost' || currentView === 'payment_qr') {
      return false;
    }
    return hostname === 'api.lyheiwandaijiamax.com' || params.get('dispatch') === 'true';
  };

  const isStandaloneAdmin = () => {
    if (typeof window === 'undefined') return false;
    const hostname = window.location.hostname;
    const params = new URLSearchParams(window.location.search);
    if (params.get('passenger') === 'true' || params.has('driver') || params.get('dispatch') === 'true') {
      return false;
    }
    if (currentView === 'create_order' || currentView === 'navigation' || currentView === 'cost' || currentView === 'payment_qr') {
      return false;
    }
    return hostname === 'admin.lyheiwandaijiamax.com' || params.get('admin') === 'true';
  };

  // --- 1. Persistent State Management ---
  const lastCalibratedPhoneRef = useRef<string | null>(null);
  const lastCalibratedPhoneSettingsRef = useRef<string | null>(null);

  const [billingRules, setBillingRules] = useState<BillingRules>(() => {
    const phone = typeof window !== 'undefined' ? localStorage.getItem('dd_user_phone') : null;
    const key = phone ? `dd_billing_rules_${phone}` : 'dd_billing_rules';
    const cached = typeof window !== 'undefined' ? (localStorage.getItem(key) || localStorage.getItem('dd_billing_rules')) : null;
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.slots) && parsed.slots.length > 0) {
          return { ...DEFAULT_BILLING_RULES, ...parsed };
        }
      } catch (e) {}
    }
    return DEFAULT_BILLING_RULES;
  });

  const [onlineBillingRules, setOnlineBillingRules] = useState<BillingRules>(DEFAULT_BILLING_RULES);

  const [settings, setSettings] = useState<ChauffeurSettings>(() => {
    try {
      const phone = typeof window !== 'undefined' ? localStorage.getItem('dd_user_phone') : null;
      const key = phone ? `dd_settings_${phone}` : 'dd_settings';
      const cached = typeof window !== 'undefined' ? (localStorage.getItem(key) || localStorage.getItem('dd_settings')) : null;
      if (cached) {
        const loaded = JSON.parse(cached);
        return { ...DEFAULT_SETTINGS, ...loaded };
      }
    } catch (_) {}
    return { ...DEFAULT_SETTINGS };
  });

  const [stats, setStats] = useState<DriverStats>(() => {
    const phone = typeof window !== 'undefined' ? localStorage.getItem('dd_user_phone') : null;
    const key = phone ? `dd_stats_${phone}` : 'dd_stats';
    const cached = typeof window !== 'undefined' ? (localStorage.getItem(key) || localStorage.getItem('dd_stats')) : null;
    const hasResetMyPoints = typeof window !== 'undefined' ? localStorage.getItem('dd_stats_reset_my_points_v1') : null;
    const defaultStats: DriverStats = { todayOrders: 0, todayIncome: 0.00, myPoints: 0, lastResetDate: getCurrent6AmDay() };

    if (!hasResetMyPoints && typeof window !== 'undefined') {
      localStorage.setItem('dd_stats_reset_my_points_v1', 'true');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          parsed.myPoints = 0;
          localStorage.setItem(key, JSON.stringify(parsed));
          const currentDay = getCurrent6AmDay();
          if (parsed.lastResetDate !== currentDay) {
            parsed.todayOrders = 0;
            parsed.todayIncome = 0.00;
            parsed.lastResetDate = currentDay;
          }
          return { ...defaultStats, ...parsed };
        } catch {
          return defaultStats;
        }
      }
    }

    if (!cached) return defaultStats;
    try {
      const parsed = JSON.parse(cached);
      if (parsed.myPoints === undefined || parsed.myPoints === 360) {
        parsed.myPoints = 0;
      }
      const currentDay = getCurrent6AmDay();
      if (parsed.lastResetDate !== currentDay) {
        parsed.todayOrders = 0;
        parsed.todayIncome = 0.00;
        parsed.lastResetDate = currentDay;
      }
      return { ...defaultStats, ...parsed };
    } catch {
      return defaultStats;
    }
  });

  const [currentTrip, setCurrentTrip] = useState<TripState | null>(() => {
    try {
      const cached = typeof window !== 'undefined' ? localStorage.getItem('dd_current_trip') : null;
      return cached ? JSON.parse(cached) : null;
    } catch (_) {
      return null;
    }
  });

  const [isOnline, setIsOnline] = useState<boolean>(() => {
    const cached = localStorage.getItem('dd_is_online');
    return cached === 'true';
  });

  const [currentView, setCurrentView] = useState<string>('home');
  const [mobileActiveTab, setMobileActiveTab] = useState<'app' | 'admin' | 'passenger' | 'wechat_mini' | 'alipay_mini' | 'qr_expired' | 'vip_blocked' | 'dispatch_valet'>(() => {
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      const params = new URLSearchParams(window.location.search);
      // Prioritize passenger view for QR code scans
      if (params.get('passenger') === 'true' || params.has('driver')) {
        return 'passenger';
      }
      if (hostname === 'api.lyheiwandaijiamax.com' || params.get('dispatch') === 'true') {
        document.title = '商户代叫系统';
        return 'dispatch_valet';
      }
      if (hostname === 'admin.lyheiwandaijiamax.com' || params.get('admin') === 'true') {
        return 'admin';
      }
      if (params.get('wechat_mini') === 'true') {
        return 'wechat_mini';
      }
      if (params.get('alipay_mini') === 'true') {
        return 'alipay_mini';
      }
    }
    return 'app';
  });
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [passengerDriverPhone, setPassengerDriverPhone] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('driver');
  });
  const [userPhone, setUserPhone] = useState<string | null>(() => {
    return localStorage.getItem('dd_user_phone') || '15509601222';
  });
  const [isUserDataLoaded, setIsUserDataLoaded] = useState<boolean>(false);

  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('isAdminAuthenticated') === 'true';
    }
    return false;
  });

  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  // Version management states at the root level of the app
  const [sysVersion, setSysVersion] = useState<string>(() => {
    try {
      return localStorage.getItem('app_version') || 'V2.0';
    } catch (_) {
      return 'V2.0';
    }
  });
  const [sysForceUpgrade, setSysForceUpgrade] = useState<boolean>(false);
  const [sysUpgradeUrl, setSysUpgradeUrl] = useState<string>('https://download.heiwan.com/max');
  const [sysXianyuUrl, setSysXianyuUrl] = useState<string>('https://www.goofish.com');
  const [showUpgradeModal, setShowUpgradeModal] = useState<boolean>(false);

  // Initialize Audio Context & Speech Synthesis unlock listener
  useEffect(() => {
    initAudioUnlock();
  }, []);

  // Real-time listen for system version information
  useEffect(() => {
    const versionDocRef = doc(db, 'config', 'system_version');
    const unsubscribe = onSnapshot(versionDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const v = data.version || 'V2.0';
        setSysVersion(v);
        try { localStorage.setItem('app_version', v); } catch (_) {}
        setSysForceUpgrade(!!data.forceUpgrade);
        setSysUpgradeUrl(data.upgradeUrl || 'https://download.heiwan.com/max');
        setSysXianyuUrl(data.xianyuUrl || 'https://www.goofish.com');
      }
    }, (error) => {
      console.error("Error subscribing to system version:", error);
    });
    return () => unsubscribe();
  }, []);

  // Sync upgrade modal & online status when cloud version settings change in real-time
  useEffect(() => {
    if (sysForceUpgrade) {
      if (isOnline) {
        setIsOnline(false);
        setShowUpgradeModal(true);
      }
    } else {
      // If force upgrade is canceled/downgraded, dismiss the upgrade modal in real-time.
      setShowUpgradeModal(false);
    }
  }, [sysForceUpgrade, isOnline]);

  useEffect(() => {
    const q = collection(db, 'team_members');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setTeamMembers(list);
    }, (error) => {
      console.error("Error subscribing to team members in App:", error);
    });
    return () => unsubscribe();
  }, []);

  const [isInSquad, setIsInSquad] = useState(false);

  useEffect(() => {
    if (!userPhone) {
      setIsInSquad(false);
      return;
    }
    const docRef = doc(db, 'squad_members', userPhone);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      setIsInSquad(docSnap.exists());
    }, (error) => {
      console.error("Error subscribing to squad member state:", error);
    });
    return () => unsubscribe();
  }, [userPhone]);

  const [squadRole, setSquadRole] = useState<string>('');

  useEffect(() => {
    if (!userPhone) {
      setSquadRole('');
      return;
    }

    // Try reading local storage first
    try {
      const saved = localStorage.getItem('dd_squad_members_v2');
      if (saved) {
        const members = JSON.parse(saved);
        const m = members.find((mem: any) => String(mem.phone || mem.id).trim() === userPhone.trim());
        if (m && (m.role || m.userRole)) {
          setSquadRole(m.role || m.userRole);
        }
      }
    } catch (_) {}

    // Realtime listeners for squad_members & driver_users
    const unsub1 = onSnapshot(doc(db, 'squad_members', userPhone), (snap) => {
      if (snap.exists()) {
        const sm = snap.data();
        const r = sm?.role || sm?.userRole;
        if (r) setSquadRole(r);
      }
    }, () => {});

    const unsub2 = onSnapshot(doc(db, 'driver_users', userPhone), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        const r = d?.role || d?.userRole;
        if (r) setSquadRole(r);
      }
    }, () => {});

    return () => {
      unsub1();
      unsub2();
    };
  }, [userPhone]);

  const loggedInMember = teamMembers.find(m => m.phone === userPhone);
  const userRole = (userPhone === '15509601222')
    ? '开发者司机'
    : (squadRole || (loggedInMember ? loggedInMember.role : '普通司机'));
  const userTeamCity = loggedInMember ? loggedInMember.city : '';
  const [incomingOrder, setIncomingOrder] = useState<any>(null);
  const [activeOnlineOrder, setActiveOnlineOrder] = useState<any>(null);
  const [merchantValetPaymentTrip, setMerchantValetPaymentTrip] = useState<TripState | null>(null);
  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number }>(() => {
    try {
      const cachedLat = localStorage.getItem('dd_bg_driver_coords_lat');
      const cachedLng = localStorage.getItem('dd_bg_driver_coords_lng');
      if (cachedLat && cachedLng) {
        return { lat: Number(cachedLat), lng: Number(cachedLng) };
      }
    } catch (_) {}
    return {
      lat: 38.4830,
      lng: 106.2350
    };
  });

  // Load Gaode Map API script once in App.tsx to ensure background geolocation works flawlessly
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Globally register AMap security code before loading maps script
    (window as any)._AMapSecurityConfig = {
      securityJsCode: '0aa3912e6a88fe59f9e5f0275524feba'
    };

    const scriptId = 'amap-js-api-v2-main';
    let script = document.getElementById(scriptId) as HTMLScriptElement || document.querySelector('script[src*="webapi.amap.com"]');
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://webapi.amap.com/maps?v=2.0&key=4143e567d55bbc1855231f9637efd6b0';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, []);

  // State to check if driver is approved squad member or management team member
  const [isSquadApprovedOrManagement, setIsSquadApprovedOrManagement] = useState<boolean>(false);

  useEffect(() => {
    if (!userPhone) {
      setIsSquadApprovedOrManagement(false);
      return;
    }

    const managementRoles = ['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机', '总指挥官', '开发者'];
    if (userPhone === '15509601222') {
      setIsSquadApprovedOrManagement(true);
      return;
    }

    const unsub1 = onSnapshot(doc(db, 'driver_users', userPhone), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        if (d && managementRoles.includes(d.role || d.userRole)) {
          setIsSquadApprovedOrManagement(true);
          return;
        }
      }
    });

    const unsub2 = onSnapshot(doc(db, 'squad_members', userPhone), (snap) => {
      if (snap.exists()) {
        const sm = snap.data();
        const st = sm?.status || sm?.approvalStatus || '';
        if (['已通过', 'approved', '通过'].includes(st)) {
          setIsSquadApprovedOrManagement(true);
        } else {
          setIsSquadApprovedOrManagement(false);
        }
      } else {
        try {
          const saved = localStorage.getItem('dd_squad_members_v2');
          if (saved) {
            const members = JSON.parse(saved);
            const m = members.find((mem: any) => mem.phone === userPhone);
            if (m && ['已通过', 'approved', '通过'].includes(m.status || m.approvalStatus)) {
              setIsSquadApprovedOrManagement(true);
              return;
            }
          }
        } catch (_) {}
        setIsSquadApprovedOrManagement(false);
      }
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [userPhone]);

  // 20-Second Automatic Location Upload to Baota Server & Firestore
  // Strict Rules:
  // 1. Only run if driver is ONLINE (isOnline === true).
  // 2. Only run if driver is an approved squad member OR a management team member.
  // 3. OFFLINE state -> DO NOT fetch location, DO NOT upload location.
  // 4. NOT approved / NOT in squad -> DO NOT fetch location, DO NOT upload location.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!userPhone || !isOnline || !isSquadApprovedOrManagement) {
      return;
    }

    const report20sLocation = () => {
      const city = settings?.city || '银川市';
      const fallbackGrid = getCityCenterCoords(city);
      const AMap = (window as any).AMap;

      const performUpload = (latitude: number, longitude: number, methodUsed: string) => {
        setDriverCoords({ lat: latitude, lng: longitude });
        localStorage.setItem('dd_bg_driver_coords_lat', latitude.toString());
        localStorage.setItem('dd_bg_driver_coords_lng', longitude.toString());

        const isDriverBusy = !!currentTrip || !!activeOnlineOrder || currentView === 'create_order';
        const timestampIso = new Date().toISOString();
        const currentAppVersion = sysVersion || 'V2.0';
        const payload = {
          phone: userPhone,
          driverName: (settings.driverName && settings.driverName !== '代驾司机' && settings.driverName !== '在线代驾司机') ? settings.driverName : '吴彦祖',
          lat: latitude,
          lng: longitude,
          isOnline: true,
          onlineOrdersEnabled: true,
          isBusy: isDriverBusy,
          city: city,
          version: currentAppVersion,
          appVersion: currentAppVersion,
          lastUpdatedBy: methodUsed,
          lastUpdatedTime: timestampIso
        };

        // 1. Update driver_users collection
        setDoc(doc(db, 'driver_users', userPhone), payload, { merge: true }).catch(() => {});

        // 2. Update squad_members collection
        setDoc(doc(db, 'squad_members', userPhone), payload, { merge: true }).catch(() => {});

        // 3. Update driver_locations collection
        setDoc(doc(db, 'driver_locations', userPhone), payload, { merge: true }).catch(() => {});

        // 4. Directly upload to Alibaba Cloud Baota Server Panel API endpoint
        try {
          const baseUrl = getBaseApiUrl();
          fetch(`${baseUrl}/api/driver/location`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: userPhone,
              lat: latitude,
              lng: longitude,
              isOnline: true,
              isBusy: isDriverBusy,
              timestamp: Date.now()
            })
          }).catch(() => {});
        } catch (_) {}
      };

      if (AMap) {
        AMap.plugin('AMap.Geolocation', () => {
          try {
            const geolocation = new AMap.Geolocation({
              enableHighAccuracy: true,
              timeout: 8000,
              noIpLocate: 0,
              noGeoLocation: 0,
            });

            geolocation.getCurrentPosition((status: string, result: any) => {
              if (status === 'complete' && result.position) {
                performUpload(result.position.lat, result.position.lng, "Gaode AMap 20s Auto Reporter");
              } else if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  (pos) => performUpload(pos.coords.latitude, pos.coords.longitude, "HTML5 Geolocation 20s Reporter"),
                  () => performUpload(fallbackGrid.lat, fallbackGrid.lng, "City Center Fallback 20s Reporter"),
                  { enableHighAccuracy: true, timeout: 8000 }
                );
              } else {
                performUpload(fallbackGrid.lat, fallbackGrid.lng, "City Center Fallback 20s Reporter");
              }
            });
          } catch (_) {
            performUpload(fallbackGrid.lat, fallbackGrid.lng, "City Center Fallback 20s Reporter");
          }
        });
      } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => performUpload(pos.coords.latitude, pos.coords.longitude, "HTML5 Geolocation 20s Reporter"),
          () => performUpload(fallbackGrid.lat, fallbackGrid.lng, "City Center Fallback 20s Reporter"),
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }
    };

    // Trigger initial report
    report20sLocation();

    // Setup 20s recurring interval timer
    const timer20s = setInterval(report20sLocation, 20000);
    return () => clearInterval(timer20s);
  }, [userPhone, isOnline, isSquadApprovedOrManagement, settings?.city, currentTrip]);

  // Daily 5:59 AM automatic force offline mechanism for any online driver
  useEffect(() => {
    const checkDaily559AM = () => {
      if (!isOnline || !userPhone) return;
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const todayStr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      const lastResetDate = localStorage.getItem('dd_last_559am_offline_date');

      // Trigger if time is past 05:59 AM (hours === 5 && minutes >= 59 or hours >= 6)
      const isPast559 = (hours === 5 && minutes >= 59) || hours >= 6;

      if (isPast559 && lastResetDate !== todayStr) {
        localStorage.setItem('dd_last_559am_offline_date', todayStr);
        setIsOnline(false);
        const offlinePayload = {
          isOnline: false,
          onlineOrdersEnabled: false,
          lastUpdatedTime: new Date().toISOString()
        };

        try {
          setDoc(doc(db, 'driver_users', userPhone), offlinePayload, { merge: true }).catch(() => {});
          setDoc(doc(db, 'squad_members', userPhone), offlinePayload, { merge: true }).catch(() => {});

          // Realtime sync to Mainland China Aliyun / Baota server (/api/db/set)
          const baseUrl = getBaseApiUrl();
          fetch(`${baseUrl}/api/db/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: 'driver_users', docId: userPhone, data: offlinePayload })
          }).catch(() => {});

          fetch(`${baseUrl}/api/db/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: 'squad_members', docId: userPhone, data: offlinePayload })
          }).catch(() => {});

          fetch(`${baseUrl}/api/driver/location`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: userPhone,
              isOnline: false,
              timestamp: Date.now()
            })
          }).catch(() => {});
        } catch (_) {}

        triggerToast('⏰ 已到达每日凌晨5:59，系统已自动将您的状态切换为下线状态');
      }
    };

    checkDaily559AM();
    const interval = setInterval(checkDaily559AM, 15000);
    return () => clearInterval(interval);
  }, [isOnline, userPhone]);

  const handleLogout = () => {
    if (userPhone) {
      clearDeviceSession(userPhone);
    }
    // Clear all settings keys from localStorage
    try {
      localStorage.removeItem('dd_user_phone');
      localStorage.removeItem('isAdminAuthenticated');
      localStorage.removeItem('dd_settings');
      if (userPhone) {
        localStorage.removeItem(`dd_settings_${userPhone}`);
        localStorage.removeItem(`dd_billing_rules_${userPhone}`);
      }
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('dd_settings') || key.startsWith('dd_stats') || key.startsWith('dd_billing_rules'))) {
          localStorage.removeItem(key);
        }
      }
    } catch (_) {}

    setIsAdminAuthenticated(false);
    setUserPhone(null);
    setSettings({
      ...DEFAULT_SETTINGS,
      wechatQrCode: '',
      alipayQrCode: ''
    });
    setStats({ todayOrders: 0, todayIncome: 0.00, myPoints: 0, lastResetDate: getCurrent6AmDay() });
    setCurrentView('home');
    triggerToast('您的司机端安全会话已安全退出断开！');
  };

  // Periodically check if another device logged in with SMS code on the same phone number
  useEffect(() => {
    if (!userPhone) return;

    const checkDeviceSession = async () => {
      const { verifyActiveDeviceSession } = await import('./utils/deviceSession');
      const res = await verifyActiveDeviceSession(userPhone);
      if (!res.valid) {
        triggerToast(res.reason || '⚠️ 您的账号已在其他设备上登录，当前设备已自动安全退出。');
        handleLogout();
      }
    };

    checkDeviceSession();
    const interval = setInterval(checkDeviceSession, 20000);
    return () => clearInterval(interval);
  }, [userPhone]);

  // Real-time synchronization for global online billing rules configured in Admin Panel
  useEffect(() => {
    const configDocRef = doc(db, 'config', 'online_billing_rules');
    const unsubscribe = onSnapshot(configDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const activeName = data.activeTemplateName || '线上二维码开单';
        const templatesList = data.templates || [];
        const found = templatesList.find((t: any) => t.templateName === activeName);
        if (found) {
          setOnlineBillingRules(found);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Save billing rules strictly to local device storage (no cloud upload)
  useEffect(() => {
    try {
      safeSetItem('dd_billing_rules', JSON.stringify(billingRules));
      if (userPhone) {
        safeSetItem(`dd_billing_rules_${userPhone}`, JSON.stringify(billingRules));
      }
    } catch (_) {}
  }, [billingRules, userPhone]);

  useEffect(() => {
    try {
      safeSetItem('dd_settings', JSON.stringify(settings));
      if (userPhone) {
        safeSetItem(`dd_settings_${userPhone}`, JSON.stringify(settings));
      }
    } catch (_) {}
  }, [settings, userPhone]);

  // One-time automatic clean-up of legacy QR codes from user session/database to eliminate old center logos/text
  useEffect(() => {
    const isCleaned = localStorage.getItem('dd_qr_clean_v3') === 'true';
    if (!isCleaned) {
      localStorage.setItem('dd_qr_clean_v3', 'true');
      const cleanLegacyQrs = async () => {
        let updated = false;
        const newSettings = { ...settings };
        
        if (settings.wechatQrCode) {
          try {
            const cleaned = await regenerateQRCode(settings.wechatQrCode, 'wechat');
            if (cleaned && cleaned !== settings.wechatQrCode) {
              newSettings.wechatQrCode = cleaned;
              updated = true;
            }
          } catch (e) {
            console.error("Auto-heal WeChat QR failed: ", e);
          }
        }
        
        if (settings.alipayQrCode) {
          try {
            const cleaned = await regenerateQRCode(settings.alipayQrCode, 'alipay');
            if (cleaned && cleaned !== settings.alipayQrCode) {
              newSettings.alipayQrCode = cleaned;
              updated = true;
            }
          } catch (e) {
            console.error("Auto-heal Alipay QR failed: ", e);
          }
        }
        
        if (updated) {
          setSettings(newSettings);
        }
      };
      
      cleanLegacyQrs();
    }
  }, []);

  // Load settings and stats instantly on userPhone changes, and clear calibrations
  useEffect(() => {
    // Clear calibration indicators immediately upon switching userPhone
    lastCalibratedPhoneRef.current = null;
    lastCalibratedPhoneSettingsRef.current = null;
    setIsUserDataLoaded(false);

    if (userPhone) {
      const statsKey = `dd_stats_${userPhone}`;
      const cachedStats = localStorage.getItem(statsKey);
      if (cachedStats) {
        try {
          setStats(JSON.parse(cachedStats));
        } catch (_) {}
      } else {
        setStats({ todayOrders: 0, todayIncome: 0.00, myPoints: 0, lastResetDate: getCurrent6AmDay() });
      }

      const settingsKey = `dd_settings_${userPhone}`;
      const cachedSettings = localStorage.getItem(settingsKey) || localStorage.getItem('dd_settings');
      if (cachedSettings) {
        try {
          const parsed = JSON.parse(cachedSettings);
          setSettings(prev => ({ ...DEFAULT_SETTINGS, ...prev, ...parsed }));
        } catch (_) {
          setSettings({
            ...DEFAULT_SETTINGS,
            customAppName: 'XX代驾'
          });
        }
      } else {
        setSettings(prev => ({
          ...DEFAULT_SETTINGS,
          ...prev,
          customAppName: prev.customAppName || 'XX代驾'
        }));
      }
    }
  }, [userPhone]);

  // Synchronize driver user account membership expiry & online orders status with Firestore in real-time
  useEffect(() => {
    if (!userPhone) return;
    
    const userDocRef = doc(db, 'driver_users', userPhone);
    const unsubscribe = onSnapshot(userDocRef, async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data) {
          setStats(prev => {
            let nextStats = { ...prev };
            let changed = false;
            if (data.todayOrders !== undefined && prev.todayOrders !== data.todayOrders) {
              nextStats.todayOrders = Number(data.todayOrders);
              changed = true;
            }
            if (data.todayIncome !== undefined && prev.todayIncome !== data.todayIncome) {
              nextStats.todayIncome = Number(data.todayIncome);
              changed = true;
            }
            if (data.myPoints !== undefined && prev.myPoints !== data.myPoints) {
              nextStats.myPoints = Number(data.myPoints);
              changed = true;
            }
            if (data.lastResetDate !== undefined && prev.lastResetDate !== data.lastResetDate) {
              nextStats.lastResetDate = data.lastResetDate;
              changed = true;
            }
            return changed ? nextStats : prev;
          });

          setSettings(prev => {
            let nextSettings = { ...prev };
            let changed = false;

            if (data.vipExpiry !== undefined && prev.vipExpiry !== data.vipExpiry) {
              nextSettings.vipExpiry = data.vipExpiry;
              changed = true;
            }
            if (data.onlineOrdersEnabled !== undefined && prev.onlineOrdersEnabled !== data.onlineOrdersEnabled) {
              nextSettings.onlineOrdersEnabled = data.onlineOrdersEnabled;
              changed = true;
            }
            if (data.city !== undefined && prev.city !== data.city) {
              nextSettings.city = data.city;
              changed = true;
            }
            if (data.isBanned !== undefined && prev.isBanned !== data.isBanned) {
              nextSettings.isBanned = data.isBanned;
              changed = true;
            }
            if (data.customAppName !== undefined && prev.customAppName !== data.customAppName) {
              nextSettings.customAppName = data.customAppName;
              changed = true;
            }
            if (data.billingTemplateName !== undefined && prev.billingTemplateName !== data.billingTemplateName) {
              nextSettings.billingTemplateName = data.billingTemplateName;
              changed = true;
            }
            if (data.voiceBroadcast !== undefined && prev.voiceBroadcast !== data.voiceBroadcast) {
              nextSettings.voiceBroadcast = data.voiceBroadcast;
              changed = true;
            }
            if (data.accountBalance !== undefined && prev.accountBalance !== data.accountBalance) {
              nextSettings.accountBalance = data.accountBalance;
              changed = true;
            }
            if (data.startServiceSMS !== undefined && prev.startServiceSMS !== data.startServiceSMS) {
              nextSettings.startServiceSMS = data.startServiceSMS;
              changed = true;
            }
            if (data.endServiceSMS !== undefined && prev.endServiceSMS !== data.endServiceSMS) {
              nextSettings.endServiceSMS = data.endServiceSMS;
              changed = true;
            }
            if (data.smsContent !== undefined && prev.smsContent !== data.smsContent) {
              nextSettings.smsContent = data.smsContent;
              changed = true;
            }
            if (data.homepageColorway !== undefined && prev.homepageColorway !== data.homepageColorway) {
              nextSettings.homepageColorway = data.homepageColorway;
              changed = true;
            }
            if (data.deviationMitigation !== undefined && prev.deviationMitigation !== data.deviationMitigation) {
              nextSettings.deviationMitigation = data.deviationMitigation;
              changed = true;
            }
            if (data.deviationKm !== undefined && prev.deviationKm !== data.deviationKm) {
              nextSettings.deviationKm = data.deviationKm;
              changed = true;
            }
            if (data.deviationWaitSec !== undefined && prev.deviationWaitSec !== data.deviationWaitSec) {
              nextSettings.deviationWaitSec = data.deviationWaitSec;
              changed = true;
            }
            if (changed) {
              localStorage.setItem(`dd_settings_${userPhone}`, JSON.stringify(nextSettings));
            }
            return changed ? nextSettings : prev;
          });

          // Set both calibration references to this user on successful snapshot delivery
          lastCalibratedPhoneRef.current = userPhone;
          lastCalibratedPhoneSettingsRef.current = userPhone;
          setIsUserDataLoaded(true);
        }
      } else {
        // Create user doc if it doesn't exist yet, checking online_applications for any pre-assigned vipExpiry
        let initialExpiry = '待激活';
        try {
          const appSnap = await getDoc(doc(db, 'online_applications', userPhone));
          if (appSnap.exists() && appSnap.data()?.vipExpiry) {
            initialExpiry = appSnap.data().vipExpiry;
          }
        } catch (_) {}

        const initialOnlineEnabled = settings.onlineOrdersEnabled || false;
        const initialCity = settings.city || '';
        const initialIsBanned = settings.isBanned || false;
        
        await setDoc(userDocRef, {
          phoneNumber: userPhone,
          vipExpiry: initialExpiry,
          onlineOrdersEnabled: initialOnlineEnabled,
          city: initialCity,
          isBanned: initialIsBanned,
          customAppName: settings.customAppName || '',
          billingTemplateName: settings.billingTemplateName || '',
          voiceBroadcast: settings.voiceBroadcast || '',
          accountBalance: settings.accountBalance || 0,
          startServiceSMS: !!settings.startServiceSMS,
          endServiceSMS: !!settings.endServiceSMS,
          smsContent: settings.smsContent || '',
          homepageColorway: settings.homepageColorway || 'green',
          deviationMitigation: !!settings.deviationMitigation,
          deviationKm: settings.deviationKm ?? 1.0,
          deviationWaitSec: settings.deviationWaitSec ?? 30,
          todayOrders: 0,
          todayIncome: 0.00,
          myPoints: 0,
          lastResetDate: getCurrent6AmDay(),
          updatedAt: new Date().toISOString()
        }, { merge: true }).catch(err => {
          console.error("Error registering driver user in Baota DB:", err);
        });

        if (initialExpiry !== '待激活') {
          setSettings(prev => {
            const updated = { ...prev, vipExpiry: initialExpiry };
            localStorage.setItem(`dd_settings_${userPhone}`, JSON.stringify(updated));
            return updated;
          });
        }

        lastCalibratedPhoneRef.current = userPhone;
        lastCalibratedPhoneSettingsRef.current = userPhone;
        setIsUserDataLoaded(true);
      }
    }, (err) => {
      console.error("Error listening to driver user changes:", err);
      setIsUserDataLoaded(true);
    });
    
    return () => unsubscribe();
  }, [userPhone]);

  useEffect(() => {
    try {
      safeSetItem('dd_stats', JSON.stringify(stats));
      if (userPhone && lastCalibratedPhoneRef.current === userPhone) {
        safeSetItem(`dd_stats_${userPhone}`, JSON.stringify(stats));
        
        const userDocRef = doc(db, 'driver_users', userPhone);
        setDoc(userDocRef, {
          todayOrders: stats.todayOrders ?? 0,
          todayIncome: stats.todayIncome ?? 0.00,
          myPoints: stats.myPoints ?? 0,
          lastResetDate: stats.lastResetDate || getCurrent6AmDay()
        }, { merge: true }).catch(err => {
          console.error("Error syncing stats to Firestore:", err);
        });
      }
    } catch (_) {}
  }, [stats, userPhone]);

  // Automatic daily reset at 6:00 AM
  useEffect(() => {
    const checkAndResetStats = () => {
      const currentDay = getCurrent6AmDay();
      if (stats.lastResetDate !== currentDay) {
        setStats(prev => ({
          ...prev,
          todayOrders: 0,
          todayIncome: 0.00,
          lastResetDate: currentDay
        }));
      }
    };

    // Run custom reset check immediately on mount/update
    checkAndResetStats();

    // Check every 10 seconds for precise, live 6:00 AM transition
    const interval = setInterval(checkAndResetStats, 10000);
    return () => clearInterval(interval);
  }, [stats.lastResetDate]);

  useEffect(() => {
    try {
      if (currentTrip) {
        safeSetItem('dd_current_trip', JSON.stringify(currentTrip));
      } else {
        safeRemoveItem('dd_current_trip');
      }
    } catch (_) {}
  }, [currentTrip]);

  useEffect(() => {
    try {
      safeSetItem('dd_is_online', isOnline ? 'true' : 'false');
    } catch (_) {}
    if (userPhone) {
      const payload = {
        isOnline: isOnline,
        onlineOrdersEnabled: isOnline,
        lastUpdatedTime: new Date().toISOString()
      };

      setDoc(doc(db, 'driver_users', userPhone), payload, { merge: true }).catch(() => {});
      setDoc(doc(db, 'squad_members', userPhone), payload, { merge: true }).catch(() => {});

      // Realtime report online/offline status to Aliyun/Baota server API
      const baseUrl = getBaseApiUrl();
      fetch(`${baseUrl}/api/db/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'driver_users', docId: userPhone, data: payload })
      }).catch(() => {});

      fetch(`${baseUrl}/api/db/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'squad_members', docId: userPhone, data: payload })
      }).catch(() => {});
    }
  }, [isOnline, userPhone]);

  // Active Account Ban Listener: automatically force-offline banned driver
  useEffect(() => {
    if (settings.isBanned && isOnline) {
      setIsOnline(false);
      alert('⚠️ 系统警告：您的账号已被管理员封停。已强制为您切换至下线状态，封停期间您将无法接单或开启线上听单服务！如有异议请联系客服。');
    }
  }, [settings.isBanned, isOnline]);

  // Active VIP Limit & State Reset Listener moved after handleUpdateSettings to avoid TDZ issues.

  const dismissedIncomingOrderKeysRef = useRef<Set<string>>(new Set());

  // Initialize native background notification system and register app resume listeners
  useEffect(() => {
    initNotificationSystem();

    const cleanup = registerBackgroundOrderListeners(async (order) => {
      if (order) {
        // Validate if order is already completed / cancelled / ended
        const ended = await isOrderAlreadyEnded(order, userPhone);
        if (ended) {
          clearPendingOrderCache();
          setIncomingOrder(null);
          triggerToast('⚠️ 该订单已完结或已被接单，无需重复查看');
          return;
        }
        setIncomingOrder(order);
      }
    });

    // Custom event listener to force trigger incoming order overlay popup
    const handleCustomTrigger = async (e: any) => {
      if (e.detail) {
        const data = e.detail;
        const rawTime = Number(data.timestamp || data.updatedAt || Date.now());
        const orderKey = data.orderId || data.id || `${data.passengerPhone || 'p'}_${rawTime}`;

        // Validate if order is already completed / cancelled / ended
        const ended = await isOrderAlreadyEnded(data, userPhone);
        if (ended) {
          clearPendingOrderCache();
          setIncomingOrder(null);
          triggerToast('⚠️ 该订单已完结，无需重复接单');
          return;
        }

        dismissedIncomingOrderKeysRef.current.delete(orderKey);
        triggerBackgroundOrderAlert(data);
        setIncomingOrder(data);
      }
    };
    window.addEventListener('trigger_incoming_order', handleCustomTrigger);

    return () => {
      cleanup();
      window.removeEventListener('trigger_incoming_order', handleCustomTrigger);
    };
  }, [userPhone]);

  // Listen for real-time incoming passenger orders from passenger self-service scans or admin dispatching
  useEffect(() => {
    const cleanPhone = (userPhone || '').replace(/\s+/g, '').trim();
    if (!cleanPhone) return;

    // RULE: If driver is OFFLINE, DO NOT listen or trigger incoming order overlay!
    if (!isOnline) {
      setIncomingOrder(null);
      clearPendingOrderCache();
      return;
    }

    const processIncomingData = async (data: any) => {
      if (data && (data.status === 'submitted' || data.passengerPhone)) {
        const rawTime = Number(data.timestamp || data.updatedAt || 0);
        const orderKey = data.orderId || data.id || data.orderNo || `${data.passengerPhone || 'p'}_${rawTime || 0}`;

        // Validate if order is already completed / cancelled / ended
        const ended = await isOrderAlreadyEnded(data, userPhone);
        if (ended) {
          clearPendingOrderCache();
          setIncomingOrder(null);
          return;
        }

        // Guarantee popup only shows once per order if dismissed
        if (dismissedIncomingOrderKeysRef.current.has(orderKey)) {
          setIncomingOrder(null);
          return;
        }

        // Do not interrupt driver if driver is already serving an active trip or creating order
        if (currentTrip || currentView === 'navigation' || currentView === 'cost' || currentView === 'payment_qr' || currentView === 'create_order') {
          setIncomingOrder(null);
          return;
        }

        // Only pop up if the order was created within recent 5 minutes (300,000 ms) while driver is online
        if (!rawTime || isNaN(rawTime) || rawTime > Date.now() - 300000) {
          const isValet = Boolean(
            data.isValetOrder ||
            data.isPlatformDispatch ||
            data.orderRemark === '商户代叫' ||
            data.orderType === '商户代叫' ||
            data.orderType === '后台指派订单' ||
            data.type === '商户代叫' ||
            data.type === '后台指派订单'
          );
          if (isValet) {
            // Trigger high-priority system alert for background / lockscreen
            triggerBackgroundOrderAlert(data);
            setIncomingOrder(data);
          } else {
            dismissedIncomingOrderKeysRef.current.add(orderKey);
            setIncomingOrder(null);
            setActiveOnlineOrder({ ...data, isQrOrder: true });
            setCurrentView('create_order');
            triggerToast('✓ 扫码成功并安全连线！已跳转至【创建订单】计费界面');
          }
        } else {
          setIncomingOrder(null);
        }
      } else {
        setIncomingOrder(null);
      }
    };

    // 1. Primary Baota DB Proxy realtime listener
    const docRef = doc(db, 'passenger_links', cleanPhone);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        processIncomingData(docSnap.data());
      } else {
        setIncomingOrder(null);
      }
    }, (err) => {
      console.warn('[Baota DB] passenger_links snapshot error:', err);
    });

    // 2. High-availability HTTP polling directly to Baota/MySQL deployment (/api/db/get)
    const pollInterval = setInterval(async () => {
      try {
        const baseUrl = getBaseApiUrl();
        const res = await fetch(`${baseUrl}/api/db/get?collection=passenger_links&docId=${cleanPhone}`);
        if (res.ok) {
          const json = await res.json();
          if (json && json.data) {
            processIncomingData(json.data);
          }
        }
      } catch (e) {
        // Silent catch for network jitter
      }
    }, 2000);

    return () => {
      unsubscribe();
      clearInterval(pollInterval);
    };
  }, [userPhone, currentView, isOnline]);

  // Listen for real-time cancellation of driver's active online order
  useEffect(() => {
    if (!activeOnlineOrder) return;
    const activeOrderId = activeOnlineOrder.id || activeOnlineOrder.orderId || activeOnlineOrder.orderNo;
    if (!activeOrderId) return;

    let isTriggered = false;
    const handleOrderCancelled = () => {
      if (isTriggered) return;
      isTriggered = true;
      setActiveOnlineOrder(null);
      setCurrentView('home');
      triggerToast('⚠️ 该订单已取消');
    };

    // 1. Realtime Firestore listener on merchant_orders
    const unsubscribe = onSnapshot(doc(db, 'merchant_orders', activeOrderId), (docSnap) => {
      if (docSnap.exists() && (docSnap.data()?.status === 'cancelled' || docSnap.data()?.statusCategory === '已取消')) {
        handleOrderCancelled();
      }
    }, (err) => {
      console.warn("Error listening to active order status:", err);
    });

    // 2. Fallback check for local storage / HTTP API sync
    const checkCancellationLocal = async () => {
      try {
        const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
        const match = saved.find((o: any) => 
          o.id === activeOrderId || 
          o.orderId === activeOrderId || 
          (o.orderNo && activeOnlineOrder?.orderNo && o.orderNo === activeOnlineOrder?.orderNo) ||
          (o.passengerPhone && activeOnlineOrder?.passengerPhone && o.passengerPhone === activeOnlineOrder?.passengerPhone)
        );
        if (match && (match.status === 'cancelled' || match.statusCategory === '已取消' || match.statusCategory === '订单已取消')) {
          handleOrderCancelled();
          return;
        }

        const baseUrl = getBaseApiUrl();
        const res = await fetch(`${baseUrl}/api/db/get?collection=merchant_orders&docId=${activeOrderId}`);
        if (res.ok) {
          const json = await res.json();
          if (json && json.data) {
            if (json.data.status === 'cancelled' || json.data.statusCategory === '已取消') {
              handleOrderCancelled();
            }
          }
        }
      } catch (e) {}
    };

    const pollInterval = setInterval(checkCancellationLocal, 1500);
    window.addEventListener('merchant_orders_updated', checkCancellationLocal);

    return () => {
      unsubscribe();
      clearInterval(pollInterval);
      window.removeEventListener('merchant_orders_updated', checkCancellationLocal);
    };
  }, [activeOnlineOrder]);

  const handleAcceptIncomingOrder = async (trip: TripState) => {
    if (!userPhone) return;
    clearPendingOrderCache();
    if (incomingOrder) {
      const orderKey = incomingOrder.orderId || incomingOrder.id || `${incomingOrder.passengerPhone || 'p'}_${incomingOrder.timestamp || ''}`;
      dismissedIncomingOrderKeysRef.current.add(orderKey);

      try {
        const ended = await Promise.race([
          isOrderAlreadyEnded(incomingOrder, userPhone),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1200))
        ]).catch(() => false);

        if (ended) {
          setIncomingOrder(null);
          triggerToast('⚠️ 该订单已结单，无法重复接单！');
          return;
        }
      } catch (_) {}
    }
    setActiveOnlineOrder(incomingOrder || { ...trip, id: trip.id || trip.orderNumber });
    setMobileActiveTab('app');
    setCurrentView('create_order');
    setIncomingOrder(null);
    triggerToast('✓ 成功确认接单！已自动为您规划骑行前往接客起点的路线。');
    // Clear/delete the passenger link doc to finish the session
    deleteDoc(doc(db, 'passenger_links', userPhone)).catch(err => {
      console.error("Error clearing accepted passenger order link document:", err);
    });
  };

  const handleDeclineIncomingOrder = () => {
    if (!userPhone) return;
    clearPendingOrderCache();
    if (incomingOrder) {
      const orderId = incomingOrder.orderId || incomingOrder.id || incomingOrder.orderNo;
      const orderKey = orderId || `${incomingOrder.passengerPhone || 'p'}_${incomingOrder.timestamp || ''}`;
      dismissedIncomingOrderKeysRef.current.add(orderKey);

      const updateData = {
        status: 'hall',
        in_hall: true,
        statusCategory: '呼叫中',
        dispatchedDriverPhone: ''
      };

      if (orderId) {
        if (db) {
          setDoc(doc(db, 'merchant_orders', orderId), updateData, { merge: true }).catch(err => {
            console.error("Error updating merchant_orders status to hall:", err);
          });
        }
        const baseUrl = getBaseApiUrl();
        fetch(`${baseUrl}/api/db/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection: 'merchant_orders', docId: orderId, data: updateData })
        }).catch(() => {});
      }

      try {
        const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
        const updated = saved.map((o: any) => {
          if (
            (orderId && (o.id === orderId || o.orderId === orderId || o.orderNo === orderId)) ||
            (incomingOrder.passengerPhone && o.passengerPhone === incomingOrder.passengerPhone)
          ) {
            return {
              ...o,
              ...updateData
            };
          }
          return o;
        });
        localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(updated));
      } catch (_) {}

      window.dispatchEvent(new CustomEvent('merchant_orders_updated'));
    }
    setIncomingOrder(null);
    triggerToast('已放弃接单，订单已重置回【选单大厅】。');
    // Clear/delete the passenger link doc to finish the session
    if (db && userPhone) {
      deleteDoc(doc(db, 'passenger_links', userPhone)).catch(err => {
        console.error("Error clearing declined passenger order link document:", err);
      });
    }
    const baseUrl = getBaseApiUrl();
    fetch(`${baseUrl}/api/db/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: 'passenger_links', docId: userPhone })
    }).catch(() => {});
  };

  // Handle route locking: if an active ride is underway, keep display constrained to active navigation
  useEffect(() => {
    if (currentTrip) {
      if (currentTrip.currentStatus === 'serving') {
        setCurrentView('navigation');
      } else if (currentTrip.currentStatus === 'ended') {
        setCurrentView('cost');
      } else if (currentTrip.currentStatus === 'payment_pending') {
        setCurrentView('payment_qr');
      }
    }
  }, [currentTrip]);

  // --- 2. Action Flow Responders ---
  const handleStartTrip = (trip: TripState) => {
    setCurrentTrip(trip);
    try {
      localStorage.setItem('dd_current_trip', JSON.stringify(trip));
    } catch (_) {}
    if (incomingOrder) {
      const orderKey = incomingOrder.orderId || incomingOrder.id || incomingOrder.orderNo || `${incomingOrder.passengerPhone || 'p'}_${incomingOrder.timestamp || 0}`;
      dismissedIncomingOrderKeysRef.current.add(orderKey);
    }
    if (activeOnlineOrder) {
      const activeKey = activeOnlineOrder.orderId || activeOnlineOrder.id || activeOnlineOrder.orderNo || `${activeOnlineOrder.passengerPhone || 'p'}_${activeOnlineOrder.timestamp || 0}`;
      dismissedIncomingOrderKeysRef.current.add(activeKey);
    }
    setIncomingOrder(null);
    setActiveOnlineOrder(null);
    setMobileActiveTab('app');
    setCurrentView('navigation');
    speakText('已开始代驾计费，祝您行程愉快！');
  };

  const handleUpdateTrip = (updated: TripState) => {
    setCurrentTrip(updated);
  };

  const handleEndTrip = (finalBaseFee: number) => {
    if (!currentTrip) return;
    speakText('已到达目的地，行程结束');

    let finalEndLocation = currentTrip.endLocation;
    if ((currentTrip.currentDistance <= 0.3 || isUnsetDestination(finalEndLocation) || (finalEndLocation && finalEndLocation.includes('宁夏博物馆'))) && currentTrip.startLocation && !isUnsetDestination(currentTrip.startLocation)) {
      finalEndLocation = currentTrip.startLocation.includes('宁夏博物馆') ? '运祥小区' : currentTrip.startLocation;
    }
    if (!finalEndLocation || finalEndLocation.includes('宁夏博物馆')) {
      finalEndLocation = '运祥小区';
    }

    const endedTrip = {
      ...currentTrip,
      endLocation: finalEndLocation,
      destination: finalEndLocation,
      dropoffName: finalEndLocation,
      calculatedBaseFee: finalBaseFee,
      currentStatus: 'ended' as const
    };
    setCurrentTrip(endedTrip);
    setCurrentView('cost');
  };

  const handleGoToCollection = (finalizedTrip: TripState) => {
    setCurrentTrip(finalizedTrip);
    setCurrentView('payment_qr');
    if (isUnsetDestination(finalizedTrip.endLocation)) {
      autoUpdateOrderDestinationIfUnset(finalizedTrip, userPhone, (updated) => {
        setCurrentTrip(updated);
      });
    }
  };

  const handleFinishTrip = (amount: number) => {
    // Record to driver order history
    if (currentTrip) {
      const isMerchantValetOrder = Boolean(
        (currentTrip as any)?.isValetOrder ||
        (currentTrip as any)?.isPlatformDispatch ||
        currentTrip?.orderType === '后台指派订单' ||
        currentTrip?.orderType === '商户代叫' ||
        (currentTrip as any)?.orderRemark === '商户代叫' ||
        (currentTrip as any)?.isMerchantValetOrder ||
        (currentTrip as any)?.isMerchantValet
      );

      if (isMerchantValetOrder) {
        setMerchantValetPaymentTrip({
          ...currentTrip,
          calculatedTotalFee: amount
        });
      } else {
        setMerchantValetPaymentTrip(null);
      }

      try {
        const ordersKey = userPhone ? `dd_driver_orders_${userPhone}` : 'dd_driver_orders';
        const existingStr = localStorage.getItem(ordersKey);
        let orders = existingStr ? JSON.parse(existingStr) : [];
        if (!Array.isArray(orders)) orders = [];
        const now = new Date();
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(now.getMonth() - 6);

        // Filter out orders older than half a year (6 months)
        orders = orders.filter((order: any) => {
          if (!order) return false;
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

        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        
        let finalEndLoc = ((!currentTrip.endLocation || isUnsetDestination(currentTrip.endLocation) || currentTrip.currentDistance <= 0.3 || currentTrip.endLocation.includes('宁夏博物馆')) && currentTrip.startLocation && !isUnsetDestination(currentTrip.startLocation))
          ? (currentTrip.startLocation.includes('宁夏博物馆') ? '运祥小区' : currentTrip.startLocation)
          : (currentTrip.endLocation?.replace('宁夏博物馆(南门)', '运祥小区').replace('宁夏博物馆', '运祥小区') || '未定位终点');

        if (finalEndLoc.includes('宁夏博物馆')) {
          finalEndLoc = '运祥小区';
        }

        let finalStartLoc = currentTrip.startLocation || '未定位起点';
        if (finalStartLoc.includes('宁夏博物馆')) {
          finalStartLoc = '运祥小区';
        }

        const newOrder = {
          id: currentTrip.id || Date.now().toString(),
          timeStr: `${year}-${month}-${day} ${hours}:${minutes}`,
          fullTimeStr: `${year}-${month}-${day} ${hours}:${minutes}`,
          timestamp: Date.now(),
          amount: amount,
          startLocation: finalStartLoc,
          endLocation: finalEndLoc,
          passengerPhone: currentTrip.passengerPhone ? currentTrip.passengerPhone.trim() : '',
          distance: currentTrip.currentDistance ?? 0,
          currentDistance: currentTrip.currentDistance ?? 0,
          currentWaitingTime: currentTrip.currentWaitingTime ?? 0,
          waitTime: currentTrip.currentWaitingTime ?? 0,
          extraBridgeFee: (currentTrip as any).extraBridgeFee ?? 0,
          extraParkingFee: (currentTrip as any).extraParkingFee ?? 0,
          extraOtherFee: (currentTrip as any).extraOtherFee ?? 0,
          type: (() => {
            const ot = currentTrip.orderType;
            const remark = (currentTrip as any).orderRemark;
            const isReportTransfer = (
              ot === '报单转单' ||
              remark === '报单转单' ||
              (currentTrip as any).isReportTransferOrder ||
              (currentTrip as any).isReportTransfer ||
              (currentTrip as any).type === '报单转单' ||
              finalEndLoc.includes('报单转单')
            );
            if (isReportTransfer) return '报单转单';
            if (ot === '商户代叫' || ot === '后台指派订单' || remark === '商户代叫') return '商户代叫';
            if (ot === '二维码开单' || ot === '二维码报单' || ot === '乘客下单' || currentTrip.isOnlineOrder) return '二维码开单';
            return ot || '报单';
          })(),
          orderType: currentTrip.orderType || ((currentTrip as any).orderRemark === '报单转单' ? '报单转单' : undefined),
          orderRemark: (currentTrip as any).orderRemark,
          status: '已支付'
        };
        orders.unshift(newOrder);
        localStorage.setItem(ordersKey, JSON.stringify(orders));

        // Sync merchant order status to 'completed' / '已完成'
        const merchantOrderId = currentTrip.orderNumber || currentTrip.id;
        if (merchantOrderId) {
          try {
            if (db) {
              setDoc(doc(db, 'merchant_orders', merchantOrderId), {
                status: 'completed',
                statusCategory: '已完成',
                completedAt: Date.now()
              }, { merge: true }).catch(() => {});
            }
          } catch (_) {}

          try {
            const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
            const updated = saved.map((o: any) => {
              if (o.id === merchantOrderId || o.orderId === merchantOrderId || o.orderNo === merchantOrderId) {
                return {
                  ...o,
                  status: 'completed',
                  statusCategory: '已完成',
                  completedAt: Date.now()
                };
              }
              return o;
            });
            localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(updated));
            window.dispatchEvent(new CustomEvent('merchant_orders_updated'));
          } catch (_) {}
        }
      } catch (e) {
        console.error('Failed to save order to history:', e);
      }
    }

    // Add up stats securely
    const nextPoints = (stats.myPoints || 0) + 1;
    const updatedStats = {
      todayOrders: stats.todayOrders + 1,
      todayIncome: Number((stats.todayIncome + amount).toFixed(2)),
      myPoints: nextPoints,
      lastResetDate: stats.lastResetDate || getCurrent6AmDay()
    };
    clearPendingOrderCache();
    setStats(updatedStats);
    setCurrentTrip(null);
    setCurrentView('home');

    const isVip = checkVipActive(settings.vipExpiry);
    if (!isVip && updatedStats.todayOrders >= 2) {
      setIsOnline(false);
      triggerToast(`账款 ¥${amount.toFixed(2)} 元收取成功！提示：因您不是VIP，达每日2次上限已自动下线。`);
    } else {
      triggerToast(`账款 ¥${amount.toFixed(2)} 元收取成功，并入今日收入统计！`);
    }

    // Voice announcement overlay completion
    if (settings.voiceBroadcast === '开单语音播报') {
      const textStr = `收款成功。本次收款金额：${amount}元。`;
      speakText(textStr);
    }
  };

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3500);
  };

  const handleToggleOnline = (online: boolean) => {
    if (online) {
      if (sysForceUpgrade) {
        setShowUpgradeModal(true);
        return;
      }
      const isVip = checkVipActive(settings.vipExpiry);
      if (!isVip && stats.todayOrders >= 2) {
        alert('🔒 提示：非VIP会员每日限制报单次数已用完（每天限额2次，明早6:00自动恢复，激活VIP解除限制）。');
        return;
      }
    }
    setIsOnline(online);
    localStorage.setItem('dd_is_online', online ? 'true' : 'false');

    // Voice announcement for online / offline toggle on gesture
    initAudioUnlock();
    if (settings.voiceBroadcast !== '静音播报') {
      if (online) {
        speakText('您已上线');
      } else {
        speakText('您已下线');
      }
    }
    if (userPhone) {
      const timestampIso = new Date().toISOString();
      const onlinePayload = {
        phone: userPhone,
        driverName: (settings.driverName && settings.driverName !== '代驾司机' && settings.driverName !== '在线代驾司机') ? settings.driverName : '吴彦祖',
        isOnline: online,
        onlineOrdersEnabled: online,
        lastOnlineTime: online ? timestampIso : null,
        lastUpdatedTime: timestampIso,
        version: sysVersion || 'V2.0',
        appVersion: sysVersion || 'V2.0'
      };

      setDoc(doc(db, 'driver_users', userPhone), onlinePayload, { merge: true }).catch((e) => {
        console.error("Failed to sync isOnline toggle to Firestore driver_users:", e);
      });
      setDoc(doc(db, 'squad_members', userPhone), onlinePayload, { merge: true }).catch(() => {});
      setDoc(doc(db, 'driver_locations', userPhone), onlinePayload, { merge: true }).catch(() => {});

      const baseUrl = getBaseApiUrl();
      fetch(`${baseUrl}/api/db/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'driver_users', docId: userPhone, data: onlinePayload })
      }).catch(() => {});
      fetch(`${baseUrl}/api/db/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'squad_members', docId: userPhone, data: onlinePayload })
      }).catch(() => {});
      fetch(`${baseUrl}/api/db/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'driver_locations', docId: userPhone, data: onlinePayload })
      }).catch(() => {});
    }
  };

  const handleUpdateSettings = (newSettings: ChauffeurSettings) => {
    setSettings(newSettings);
    if (userPhone) {
      localStorage.setItem(`dd_settings_${userPhone}`, JSON.stringify(newSettings));
      if (newSettings.wechatQrCode) {
        localStorage.setItem(`dd_dispatch_wechat_qr_${userPhone}`, newSettings.wechatQrCode);
      }
      if (isUserDataLoaded) {
        const userDocRef = doc(db, 'driver_users', userPhone);
        setDoc(userDocRef, {
          phoneNumber: userPhone,
          vipExpiry: newSettings.vipExpiry || '',
          customAppName: newSettings.customAppName || '',
          billingTemplateName: newSettings.billingTemplateName || '',
          voiceBroadcast: newSettings.voiceBroadcast || '',
          accountBalance: newSettings.accountBalance ?? 0,
          startServiceSMS: !!newSettings.startServiceSMS,
          endServiceSMS: !!newSettings.endServiceSMS,
          smsContent: newSettings.smsContent || '',
          homepageColorway: newSettings.homepageColorway || 'green',
          deviationMitigation: !!newSettings.deviationMitigation,
          deviationKm: newSettings.deviationKm ?? 1.0,
          deviationWaitSec: newSettings.deviationWaitSec ?? 30,
          onlineOrdersEnabled: !!newSettings.onlineOrdersEnabled,
          city: newSettings.city || '',
          isBanned: !!newSettings.isBanned,
          wechatQrCode: newSettings.wechatQrCode || '',
          qrCode: newSettings.wechatQrCode || '',
          updatedAt: new Date().toISOString()
        }, { merge: true }).catch(err => {
          console.error("Error syncing user settings update to Firestore:", err);
        });

        // Sync to dispatch_qrs collection for cross-driver 报单转单 payment QR code resolution
        if (newSettings.wechatQrCode) {
          const qrPayload = {
            id: userPhone,
            qrCode: newSettings.wechatQrCode,
            wechatQrCode: newSettings.wechatQrCode,
            phone: userPhone,
            updatedAt: Date.now()
          };
          setDoc(doc(db, 'dispatch_qrs', userPhone), qrPayload, { merge: true }).catch(() => {});
          const baseUrl = getBaseApiUrl();
          fetch(`${baseUrl}/api/db/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: 'dispatch_qrs', docId: userPhone, data: qrPayload })
          }).catch(() => {});
          fetch(`${baseUrl}/api/db/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: 'driver_users', docId: userPhone, data: { wechatQrCode: newSettings.wechatQrCode, qrCode: newSettings.wechatQrCode } })
          }).catch(() => {});
        }
      }
    }
  };

  // Active VIP Limit & State Reset Listener: automatically force-offline drivers when daily limits are exhausted,
  // and force-revert settings (customAppName, deviationMitigation) when VIP has expired or is unactivated.
  useEffect(() => {
    if (!isUserDataLoaded) return;

    const isVip = checkVipActive(settings.vipExpiry);
    
    // Force offline if daily limits are exhausted
    if (!isVip && stats.todayOrders >= 2 && isOnline) {
      setIsOnline(false);
      alert('🔒 提示：您当前的会员已到期或未激活。今日报单次数已用完（每天限额2次，每天凌晨6点自动刷新），系统已自动强制您下线并无法继续上线。如需无限报单，请开通/激活VIP服务。');
    }

    // Force revert custom branding name & deviation features when VIP is not active
    if (!isVip) {
      let needsUpdate = false;
      const updatedSettings = { ...settings };
      if (settings.customAppName && settings.customAppName !== 'XX代驾') {
        updatedSettings.customAppName = 'XX代驾';
        needsUpdate = true;
      }
      if (settings.deviationMitigation) {
        updatedSettings.deviationMitigation = false;
        needsUpdate = true;
      }
      if (needsUpdate) {
        handleUpdateSettings(updatedSettings);
      }
    }
  }, [isUserDataLoaded, settings.vipExpiry, settings.customAppName, settings.deviationMitigation, stats.todayOrders, isOnline]);

  // --- 3. Page Router dispatcher ---
  const renderView = () => {
    // Check for forced upgrade lock triggered during slide online
    if (showUpgradeModal && mobileActiveTab === 'app') {
      return (
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B0C15] via-[#07080F] to-[#030407] z-50 flex flex-col justify-between p-6 text-slate-300 font-sans animate-in fade-in duration-500 overflow-y-auto">
          {/* Cybernetic Grid/Background Glow Overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(#14b8a6_1px,transparent_1px)] [background-size:16px_16px]"></div>
          
          {/* Header & Visual Content */}
          <div className="relative flex-1 flex flex-col items-center justify-center text-center space-y-7 pt-8 z-10">
            {/* Glowing Hologram-like Pulse Visual */}
            <div className="relative">
              {/* Outer pulsing neon ring */}
              <div className="absolute inset-0 rounded-full bg-teal-500/10 blur-xl animate-pulse"></div>
              {/* Spinning status perimeter lines */}
              <div className="absolute -inset-2 rounded-full border border-teal-500/20 border-dashed animate-spin" style={{ animationDuration: '20s' }}></div>
              <div className="absolute -inset-4 rounded-full border border-emerald-500/10 border-dashed animate-spin" style={{ animationDuration: '35s', animationDirection: 'reverse' }}></div>
              
              <div className="relative p-6 rounded-full bg-[#111322] border-2 border-teal-500/30 text-teal-400 shadow-2xl shadow-teal-950/50">
                <ShieldAlert className="w-10 h-10 animate-pulse text-teal-400" />
              </div>
            </div>

            {/* Title Section */}
            <div className="space-y-3.5 px-2">
              <h3 className="text-lg font-black tracking-tight text-white font-sans flex items-center justify-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-teal-500 animate-ping"></span>
                云端安全升级提示
              </h3>
              
              {/* Version pill */}
              <div className="inline-flex items-center gap-2 bg-[#121E24]/60 border border-teal-500/30 px-3.5 py-1.5 rounded-full shadow-lg shadow-teal-950/30">
                <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                <span className="text-[10px] font-mono font-black uppercase tracking-widest text-teal-300">
                  发现全新合规版本：{sysVersion}
                </span>
              </div>
            </div>

            {/* Futuristic Details Card */}
            <div className="bg-[#121422]/90 border border-slate-800/80 rounded-2xl p-5 max-w-sm space-y-4 shadow-2xl relative overflow-hidden backdrop-blur-md">
              {/* Cyber top glow line */}
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-teal-500/50 to-emerald-500/50"></div>
              
              <div className="space-y-3">
                <p className="text-xs text-slate-300 leading-relaxed text-left font-sans">
                  您当前正处于安全离线状态。黑湾代驾安全防伪系统已全面更新。旧版本已停止向云端数据库通信授权，请即刻完成安全合规包的同步下载。
                </p>
                
                {/* Visual upgrade points */}
                <div className="space-y-2 pt-2 border-t border-slate-800/60 text-left text-[11px] text-slate-400 font-sans">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                    <span>高精里程计算模块自适应锁止</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                    <span>定位多点漂移冗余补偿修正</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                    <span>最新全系统VIP阻断安全协议下发</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Zone - Clean buttons with cyber themes (No white background at all) */}
          <div className="relative space-y-3.5 pb-4 shrink-0 max-w-sm mx-auto w-full z-10">
            {/* Action 1: High-glowing copy link */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(sysUpgradeUrl);
                triggerToast('📋 升级网址复制成功！请在手机浏览器中粘贴下载');
              }}
              className="w-full py-3.5 bg-gradient-to-r from-teal-600/90 to-emerald-600/90 hover:from-teal-500 hover:to-emerald-500 text-slate-900 font-black text-xs rounded-xl active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-teal-500/20"
            >
              <span>📋 复制全新版本升级网址</span>
            </button>

            {/* Action 2: Silent remain offline button */}
            <button
              onClick={() => setShowUpgradeModal(false)}
              className="w-full py-3 bg-[#111322]/80 border border-slate-800 hover:bg-[#151829] text-slate-500 hover:text-slate-400 font-bold text-xs rounded-xl active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>✕ 暂不升级 (保持离线状态)</span>
            </button>
          </div>
        </div>
      );
    }

    if (incomingOrder) {
      return (
        <IncomingOrderOverlay
          order={incomingOrder}
          driverCoords={driverCoords}
          onlineBillingRules={billingRules || onlineBillingRules}
          onAccept={handleAcceptIncomingOrder}
          onDecline={handleDeclineIncomingOrder}
        />
      );
    }

    if (mobileActiveTab === 'dispatch_valet' && currentView !== 'create_order' && currentView !== 'navigation' && currentView !== 'cost' && currentView !== 'payment_qr') {
      return (
        <MobileDispatchValetOrder
          onShowToast={triggerToast}
          userPhone={userPhone}
          userRole={userRole}
          userTeamCity={userTeamCity}
          onClose={() => setMobileActiveTab('app')}
        />
      );
    }

    if ((currentView !== 'create_order' && currentView !== 'navigation' && currentView !== 'cost' && currentView !== 'payment_qr') && ((mobileActiveTab === 'passenger' || mobileActiveTab === 'qr_expired' || mobileActiveTab === 'vip_blocked') || (mobileActiveTab !== 'app' && mobileActiveTab !== 'dispatch_valet' && passengerDriverPhone))) {
      return (
        <PassengerOrderView 
          driverPhone={passengerDriverPhone || userPhone || '18609518888'}
          forceView={
            mobileActiveTab === 'qr_expired' 
              ? 'qr_expired' 
              : mobileActiveTab === 'vip_blocked' 
              ? 'vip_blocked' 
              : 'normal'
          }
          onUnlockAdmin={() => {
            setMobileActiveTab('admin');
            triggerToast('🔒 请正确核对并输入运营安全系统账号与安全密钥');
          }}
          onClose={() => {
            if (mobileActiveTab === 'passenger' || mobileActiveTab === 'qr_expired' || mobileActiveTab === 'vip_blocked') {
              setMobileActiveTab('app');
            } else {
              // Remove ?driver=xxxxx query param and reset passenger state to access demo
              const newUrl = window.location.origin + window.location.pathname;
              window.history.replaceState({}, '', newUrl);
              setPassengerDriverPhone(null);
            }
          }}
        />
      );
    }

    if (!userPhone) {
      return (
        <LoginView
          onLoginSuccess={(phone) => {
            localStorage.setItem('dd_user_phone', phone);
            setIsUserDataLoaded(false);
            setUserPhone(phone);
            const settingsKey = `dd_settings_${phone}`;
            const cachedSettings = localStorage.getItem(settingsKey) || localStorage.getItem('dd_settings');
            if (cachedSettings) {
              try {
                const parsed = JSON.parse(cachedSettings);
                setSettings(parsed);
              } catch (_) {}
            }
            triggerToast('🎉 设备签署校验通过，欢迎重新登录回一键代驾系统！');
          }}
        />
      );
    }

    switch (currentView) {
      case 'settings':
        return (
          <SettingsView
            settings={settings}
            billingRules={billingRules}
            onUpdateSettings={handleUpdateSettings}
            onClose={() => setCurrentView('home')}
            onNavigateToBilling={() => setCurrentView('mileage')}
            onLogout={handleLogout}
            systemVersion={sysVersion}
          />
        );

      case 'create_order':
        return (
          <CreateOrderView
            billingRules={billingRules}
            settings={settings}
            stats={stats}
            userPhone={userPhone}
            activeOnlineOrder={activeOnlineOrder}
            onClearOnlineOrder={() => setActiveOnlineOrder(null)}
            onStartTrip={handleStartTrip}
            onNavigateBack={async () => {
              if (activeOnlineOrder) {
                const orderId = activeOnlineOrder.id || activeOnlineOrder.orderId;
                if (orderId) {
                  let isCancelled = false;
                  try {
                    const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
                    const match = saved.find((o: any) => o.id === orderId || o.orderId === orderId || (o.orderNo && activeOnlineOrder?.orderNo && o.orderNo === activeOnlineOrder?.orderNo));
                    if (match && (match.status === 'cancelled' || match.statusCategory === '已取消' || match.statusCategory === '订单已取消')) {
                      isCancelled = true;
                    }
                  } catch (_) {}

                  if (!isCancelled) {
                    try {
                      if (db) {
                        await setDoc(doc(db, 'merchant_orders', orderId), {
                          in_hall: false,
                          status: 'dispatched',
                          statusCategory: '已接单',
                          dispatchedDriverPhone: userPhone || activeOnlineOrder.dispatchedDriverPhone || ''
                        }, { merge: true });
                      }
                    } catch (e) {
                      console.error("Error updating merchant order status on navigate back:", e);
                    }

                    try {
                      const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
                      const updated = saved.map((o: any) => {
                        if (o.id === orderId || o.orderId === orderId) {
                          return {
                            ...o,
                            in_hall: false,
                            status: 'dispatched',
                            statusCategory: '已接单',
                            dispatchedDriverPhone: userPhone || o.dispatchedDriverPhone || ''
                          };
                        }
                        return o;
                      });
                      localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(updated));
                      window.dispatchEvent(new CustomEvent('merchant_orders_updated'));
                    } catch (_) {}
                  }
                }
              }
              setActiveOnlineOrder(null);
              setCurrentView('home');
            }}
            driverCoords={driverCoords}
          />
        );

      case 'mileage':
        return (
          <MileageModeView
            billingRules={billingRules}
            onSave={(rules) => {
              setBillingRules(rules);
              // Sync template name directly on settings too for display match
              setSettings({ ...settings, billingTemplateName: rules.templateName });
            }}
            onNavigateBack={() => setCurrentView('settings')}
          />
        );

      case 'navigation': {
        const activeTripObj = currentTrip || (() => {
          try {
            const cachedTrip = typeof window !== 'undefined' ? localStorage.getItem('dd_current_trip') : null;
            return cachedTrip ? JSON.parse(cachedTrip) : null;
          } catch (_) {
            return null;
          }
        })() || {
          id: 'OL_FALLBACK_' + Date.now().toString().slice(-6),
          orderNumber: 'DD' + Date.now().toString().slice(-8),
          passengerName: '代驾客户',
          passengerPhone: '',
          startLocation: '银川市',
          endLocation: '请填写目的地（选填）',
          startTimestamp: Date.now(),
          currentDistance: 0.0,
          currentWaitingTime: 0,
          currentStatus: 'serving',
          extraBridgeFee: 0,
          extraParkingFee: 0,
          extraOtherFee: 0,
          calculatedBaseFee: 59,
          calculatedTotalFee: 59,
          weatherMultiplier: 1.0,
          isOnlineOrder: true
        };

        return (
          <ActiveTripView
            trip={activeTripObj}
            settings={settings || DEFAULT_SETTINGS}
            billingRules={billingRules || DEFAULT_BILLING_RULES}
            driverCoords={driverCoords}
            onUpdateTrip={handleUpdateTrip}
            onEndTrip={handleEndTrip}
          />
        );
      }

      case 'cost': {
        const costTripObj = currentTrip || (() => {
          try {
            const cachedTrip = typeof window !== 'undefined' ? localStorage.getItem('dd_current_trip') : null;
            return cachedTrip ? JSON.parse(cachedTrip) : null;
          } catch (_) {
            return null;
          }
        })();

        if (!costTripObj) {
          setTimeout(() => setCurrentView('home'), 0);
          return null;
        }

        return (
          <TripCostView
            trip={costTripObj}
            settings={settings || DEFAULT_SETTINGS}
            billingRules={billingRules || DEFAULT_BILLING_RULES}
            onNavigateBack={() => {
              // Safe fallback back to navigation
              if (costTripObj) {
                setCurrentTrip({ ...costTripObj, currentStatus: 'serving' });
                setCurrentView('navigation');
              }
            }}
            onGoToCollection={handleGoToCollection}
          />
        );
      }

      case 'payment_qr': {
        const qrTripObj = currentTrip || (() => {
          try {
            const cachedTrip = typeof window !== 'undefined' ? localStorage.getItem('dd_current_trip') : null;
            return cachedTrip ? JSON.parse(cachedTrip) : null;
          } catch (_) {
            return null;
          }
        })();

        if (!qrTripObj) {
          setTimeout(() => setCurrentView('home'), 0);
          return null;
        }

        return (
          <PaymentQRView
            trip={qrTripObj}
            settings={settings || DEFAULT_SETTINGS}
            onNavigateBack={() => {
              // Roll back to fee adjustment page
              if (qrTripObj) {
                setCurrentTrip({ ...qrTripObj, currentStatus: 'ended' });
                setCurrentView('cost');
              }
            }}
            onFinishTrip={handleFinishTrip}
            onUpdateTrip={(updated) => setCurrentTrip(updated)}
          />
        );
      }

      case 'home':
      default:
        return (
          <>
            <HomeView
              settings={settings}
              stats={stats}
              currentTrip={currentTrip}
              billingRules={billingRules}
              onNavigate={setCurrentView}
              onStartTrip={handleStartTrip}
              onUpdateStats={setStats}
              onToggleOnline={handleToggleOnline}
              isOnline={isOnline}
              onUpdateSettings={handleUpdateSettings}
              userPhone={userPhone}
              userRole={userRole}
              userTeamCity={userTeamCity}
              onLogout={handleLogout}
              driverCoords={driverCoords}
              xianyuUrl={sysXianyuUrl}
              onOpenMerchantValetPayment={(trip) => {
                const effectiveQr = trip?.paymentQrCode || trip?.merchantPaymentQrCode || trip?.qrCode || trip?.wechatQrCode || settings?.wechatQrCode || '';
                const mergedTrip = {
                  ...trip,
                  paymentQrCode: effectiveQr,
                  merchantPaymentQrCode: effectiveQr
                };
                setMerchantValetPaymentTrip(mergedTrip);
              }}
            />
            {merchantValetPaymentTrip && (
              <div className="absolute inset-0 z-[99999] bg-[#f9f9f9] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <MerchantValetPaymentView
                  trip={merchantValetPaymentTrip}
                  settings={settings}
                  wechatClean={settings?.wechatQrCode}
                  onNavigateBack={() => setMerchantValetPaymentTrip(null)}
                  onFinishTrip={() => setMerchantValetPaymentTrip(null)}
                />
              </div>
            )}
          </>
        );
    }
  };

  // Determine if we should render the clean single-screen view for installed native APK / iOS standalone shells
  const isMobileOrStandalone = () => {
    if (typeof window === 'undefined') return false;
    
    const params = new URLSearchParams(window.location.search);
    
    // 1. Native Capacitor packaged app running on Android or iOS native shell (NOT browser)
    if (Capacitor.isNativePlatform() || window.location.protocol === 'capacitor:' || window.location.protocol === 'file:') {
      return true;
    }
    
    // 2. Query parameters explicitly requesting pure standalone/native mode
    if (params.get('native') === 'true' || params.get('standalone') === 'true') {
      return true;
    }
    
    return false;
  };

  if (isStandaloneDispatchValet()) {
    return (
      <div className="h-screen w-screen bg-[#f8fafc] flex flex-col overflow-hidden text-[#333333]">
        <div className="flex-1 flex flex-col relative overflow-hidden">
          <MobileDispatchValetOrder
            onShowToast={triggerToast}
            userPhone={userPhone}
            userRole={userRole}
            userTeamCity={userTeamCity}
            onClose={() => {}}
          />
          {showToast && (
            <div className="absolute top-16 left-4 right-4 bg-teal-600/95 border border-teal-400/20 text-white p-3 rounded-2xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-4 duration-300 flex items-start space-x-2.5">
              <div className="w-5 h-5 rounded-full bg-emerald-400/20 text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle className="w-3.5 h-3.5 fill-current" />
              </div>
              <span className="text-xs font-semibold leading-relaxed tracking-wide font-sans">
                {toastMessage}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isStandaloneAdmin()) {
    return (
      <div className="h-screen w-screen bg-[#07080b] flex flex-col overflow-hidden text-slate-200 antialiased font-sans">
        <div className="flex-1 overflow-y-auto">
          <AdminPanel 
            userPhone={userPhone}
            userRole={userRole}
            userTeamCity={userTeamCity}
            isAdminAuthenticated={isAdminAuthenticated}
            setIsAdminAuthenticated={setIsAdminAuthenticated}
          />
        </div>
      </div>
    );
  }

  if (isMobileOrStandalone()) {
    return (
      <div className="h-screen w-screen bg-[#f8fafc] flex flex-col overflow-hidden text-[#333333]">
        <div className="flex-1 flex flex-col relative overflow-hidden">
          <AppErrorBoundary onReset={() => setCurrentView('home')}>
            {renderView()}
          </AppErrorBoundary>
          
          {/* Floating toasts for nice user experience */}
          {showToast && (
            <div className="absolute top-16 left-4 right-4 bg-teal-600/95 border border-teal-400/20 text-white p-3 rounded-2xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-4 duration-300 flex items-start space-x-2.5">
              <div className="w-5 h-5 rounded-full bg-emerald-400/20 text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle className="w-3.5 h-3.5 fill-current" />
              </div>
              <span className="text-xs font-semibold leading-relaxed tracking-wide font-sans">
                {toastMessage}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#07080b] flex flex-col items-center justify-start overflow-hidden text-slate-200 antialiased font-sans">
      
      {/* Top Professional Control Center Header Bar for real-time developers */}
      <div className="w-full bg-[#111625] border-b border-[#212b44] px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-teal-500/10">
            <Database className="w-4 h-4 text-slate-900 font-bold" />
          </div>
        </div>

        {/* View togglers for flexible debugging (Horizontally scrollable for all screen sizes) */}
        <div className="w-full sm:w-auto overflow-x-auto whitespace-nowrap flex items-center bg-[#1b233a] rounded-2xl sm:rounded-full p-1.5 border border-gray-700/50 text-xs font-semibold shrink-0 gap-1.5 scrollbar-none">
          <button
            onClick={() => setMobileActiveTab('app')}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
              mobileActiveTab === 'app'
                ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>手机端(司机)</span>
          </button>

          <button
            onClick={() => setMobileActiveTab('dispatch_valet')}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
              mobileActiveTab === 'dispatch_valet'
                ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 font-bold shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Store className="w-3.5 h-3.5 text-amber-300" />
            <span>商户代叫(手机网页版)</span>
          </button>

          <button
            onClick={() => setMobileActiveTab('passenger')}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
              mobileActiveTab === 'passenger'
                ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>乘客自助端(代开单)</span>
          </button>

          <button
            onClick={() => setMobileActiveTab('qr_expired')}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
              mobileActiveTab === 'qr_expired'
                ? 'bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-md font-bold'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>3分钟超时(二维码失效)</span>
          </button>

          <button
            onClick={() => setMobileActiveTab('vip_blocked')}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
              mobileActiveTab === 'vip_blocked'
                ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 font-bold shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            <span>非微信支付宝/未开会员拦截</span>
          </button>

          <button
            onClick={() => setMobileActiveTab('wechat_mini')}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
              mobileActiveTab === 'wechat_mini'
                ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <FileCode className="w-3.5 h-3.5 text-emerald-400" />
            <span>微信小程序下单</span>
          </button>

          <button
            onClick={() => setMobileActiveTab('alipay_mini')}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
              mobileActiveTab === 'alipay_mini'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md font-bold'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5 text-sky-400" />
            <span>支付宝小程序(VIP收银台)</span>
          </button>
          
          <button
            onClick={() => setMobileActiveTab('admin')}
            className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
              mobileActiveTab === 'admin'
                ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>管理后台</span>
          </button>

          <button
            onClick={() => downloadDeployZip('daijia_deploy.zip')}
            className="px-3 py-1.5 rounded-full flex items-center gap-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black shadow-lg shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer border border-emerald-300 ml-1 shrink-0"
            title="一键下载部署至中国大陆服务器宝塔面板的完整部署压缩包 (daijia_deploy.zip - 0解压错误)"
          >
            <Download className="w-3.5 h-3.5 text-slate-950 animate-bounce" />
            <span>📦 一键下载宝塔部署包 (daijia_deploy.zip)</span>
          </button>
        </div>
      </div>

      {/* Main split-screen or single workspace zone */}
      <div className="flex-1 w-full max-w-[1550px] mx-auto p-3 sm:p-5 flex flex-row items-stretch justify-center gap-6 overflow-hidden">
        
        {mobileActiveTab === 'wechat_mini' ? (
          <div className="flex-1 bg-[#111625]/90 border border-[#212b44] rounded-3xl overflow-hidden flex flex-col shadow-2xl">
            <WeChatMiniSimulator 
              currentDriverPhone={userPhone}
              onTriggerToast={triggerToast}
            />
          </div>
        ) : mobileActiveTab === 'alipay_mini' ? (
          <div className="flex-1 bg-[#111625]/90 border border-[#212b44] rounded-3xl overflow-hidden flex flex-col shadow-2xl">
            <AlipayMiniSimulator 
              currentDriverPhone={userPhone}
              onTriggerToast={triggerToast}
            />
          </div>
        ) : (
          <>
            {/* Left pane: Smartphone simulator containing driver client app or passenger self booking view */}
            <div className={`flex flex-col items-center justify-center transition-all duration-300 shrink-0 ${
              mobileActiveTab === 'app' || mobileActiveTab === 'dispatch_valet' || mobileActiveTab === 'passenger' || mobileActiveTab === 'qr_expired' || mobileActiveTab === 'vip_blocked' ? 'flex-1 max-w-[420px] w-full' : 'hidden lg:flex lg:w-[400px]'
            }`}>
              <div className="relative w-full h-full sm:h-[82vh] sm:max-h-[820px] sm:rounded-[40px] sm:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95)] sm:border-8 sm:border-[#1e293b] bg-[#f8fafc] flex flex-col overflow-hidden">
                <div className="flex-1 flex flex-col relative overflow-hidden text-[#333333]">
                  <AppErrorBoundary onReset={() => setCurrentView('home')}>
                    {renderView()}
                  </AppErrorBoundary>

                  {/* Top floating toasts */}
                  {showToast && (
                    <div className="absolute top-16 left-4 right-4 bg-teal-600/95 border border-teal-400/20 text-white p-3 rounded-2xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-4 duration-300 flex items-start space-x-2.5">
                      <div className="w-5 h-5 rounded-full bg-emerald-400/20 text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
                        <CheckCircle className="w-3.5 h-3.5 fill-current" />
                      </div>
                      <span className="text-xs font-semibold leading-relaxed tracking-wide font-sans">
                        {toastMessage}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right pane / Center AdminPanel (Hidden if mobileActiveTab is app on mobile, but visible/scrollable as a secondary panel on lg: screens!) */}
            <div className={`transition-all duration-300 bg-[#111625]/90 border border-[#212b44] rounded-3xl overflow-hidden flex flex-col ${
              mobileActiveTab === 'admin' ? 'flex-1 w-full' : 'hidden lg:flex lg:flex-1'
            }`}>
              <div className="flex-1 overflow-y-auto">
                <AdminPanel 
                  userPhone={userPhone}
                  userRole={userRole}
                  userTeamCity={userTeamCity}
                  isAdminAuthenticated={isAdminAuthenticated}
                  setIsAdminAuthenticated={setIsAdminAuthenticated}
                />
              </div>
            </div>
          </>
        )}

      </div>

      {/* Persistent helper watermark for comfortable navigation */}
      <div className="w-full bg-[#0a0d17] py-2 px-4 text-center border-t border-[#121927] shrink-0 text-[10px] text-gray-500 flex justify-between items-center z-40">
        <span>黑湾代驾MAX © 2026 阿里云/宝塔服务器原生独立部署版</span>
        <button 
          onClick={() => {
            setMobileActiveTab(
              mobileActiveTab === 'app' 
                ? 'passenger' 
                : mobileActiveTab === 'passenger' 
                ? 'wechat_mini' 
                : mobileActiveTab === 'wechat_mini' 
                ? 'admin' 
                : 'app'
            );
          }}
          className="text-teal-400 hover:text-teal-300 cursor-pointer lg:hidden font-medium"
        >
          {mobileActiveTab === 'app' ? '切换至乘客端 ➔' : mobileActiveTab === 'passenger' ? '切换至小程序 ➔' : mobileActiveTab === 'wechat_mini' ? '切换至后台 ➔' : '返回手机端 ➔'}
        </button>
        <span className="hidden lg:inline text-gray-400 font-mono text-[9px]">
          建议宽屏设备下并排操作：左侧模拟接单，右侧调试审核 ⚡
        </span>
      </div>

    </div>
  );
}
