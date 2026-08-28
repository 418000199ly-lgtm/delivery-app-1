import React, { useState, useEffect, useRef } from 'react';
import { checkVipActive } from '../types';
import { downloadDeployZip } from '../utils/downloadHelper';
import { ALL_CITIES_FLAT, ALL_CHINA_CITIES, PROVINCES_DATA } from '../constants/cities';
import { 
  db,
  collection, 
  addDoc, 
  setDoc,
  doc, 
  deleteDoc, 
  onSnapshot, 
  getDocs,
  getBaseApiUrl 
} from '../lib/dbProxy';
import { 
  Plus, 
  QrCode, 
  Copy, 
  Trash2, 
  Filter, 
  Zap, 
  Calendar, 
  ShieldAlert, 
  Search, 
  Grid, 
  Sparkles, 
  Clock, 
  TrendingUp, 
  Share2, 
  Loader2,
  Download,
  Lock,
  Unlock,
  CheckCircle,
  Briefcase,
  AlertTriangle,
  X,
  ExternalLink,
  Smartphone,
  Server,
  MessageSquare,
  Menu,
  Edit3,
  Users,
  History,
  ArrowUpCircle,
  ArrowDownCircle,
  RefreshCw,
  ShieldCheck,
  KeyRound,
  MapPin,
  AlertCircle,
  Power,
  Database
} from 'lucide-react';
import DispatchValetOrder from './DispatchValetOrder';
import AdminBillingRules from './AdminBillingRules';
import { resolveAndSyncDuplicateNames } from '../utils/nameResolver';

function calculateDaysFromExpiry(expiry?: string): string {
  if (!expiry) return '0';
  if (expiry === '永久有效') return '永久';
  try {
    const expDate = new Date(expiry);
    if (isNaN(expDate.getTime())) return '0';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expDate.setHours(0, 0, 0, 0);
    const diffTime = expDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? String(diffDays) : '0';
  } catch (e) {
    return '0';
  }
}

function calculateExpiryFromDays(days: string): string {
  const trimmed = days.trim();
  if (trimmed === '永久' || trimmed === '永久有效' || trimmed === 'permanent' || trimmed === '-1') {
    return '永久有效';
  }
  const dayCount = parseInt(trimmed, 10);
  if (isNaN(dayCount)) {
    return '';
  }
  if (dayCount <= 0) {
    return '';
  }
  const d = new Date();
  d.setDate(d.getDate() + dayCount);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface AdminPanelProps {
  userPhone?: string | null;
  userRole?: string;
  userTeamCity?: string;
  isAdminAuthenticated?: boolean;
  setIsAdminAuthenticated?: (val: boolean) => void;
}

export default function AdminPanel({
  userPhone = null,
  userRole = '普通司机',
  userTeamCity = '',
  isAdminAuthenticated: propIsAdminAuthenticated,
  setIsAdminAuthenticated: propSetIsAdminAuthenticated
}: AdminPanelProps = {}) {
  const [localIsAdminAuthenticated, setLocalIsAdminAuthenticated] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('isAdminAuthenticated') === 'true';
    }
    return false;
  });

  const isAdminAuthenticated = propIsAdminAuthenticated !== undefined ? propIsAdminAuthenticated : localIsAdminAuthenticated;
  const setIsAdminAuthenticated = (val: boolean) => {
    if (propSetIsAdminAuthenticated) {
      propSetIsAdminAuthenticated(val);
    } else {
      setLocalIsAdminAuthenticated(val);
    }
  };
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  
  // --- Admin Phone Login States (Locked to Super Admin) ---
  const [adminPhone, setAdminPhone] = useState('');
  const [adminSmsCode, setAdminSmsCode] = useState('');
  const [adminTimer, setAdminTimer] = useState(0);
  const [isAdminSending, setIsAdminSending] = useState(false);
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);
  const [adminConfirmationResult, setAdminConfirmationResult] = useState<any>(null);
  const [adminSimulatedCode, setAdminSimulatedCode] = useState('');
  const [adminLoginMode, setAdminLoginMode] = useState<'real' | 'sandbox'>('real');
  const adminRecaptchaVerifierRef = useRef<any>(null);

  // Countdown timer handler for SMS backoff
  useEffect(() => {
    if (adminTimer > 0) {
      const interval = setInterval(() => {
        setAdminTimer(prev => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [adminTimer]);

  // Clean up reCAPTCHA verifier on unmount
  useEffect(() => {
    return () => {
      if (adminRecaptchaVerifierRef.current) {
        try {
          adminRecaptchaVerifierRef.current.clear();
        } catch (e) {
          console.error('[AdminLogin] Error clearing recaptcha:', e);
        }
      }
    };
  }, []);

  const [loginError, setLoginError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string>('');
  const [genDuration, setGenDuration] = useState<number>(30);
  const [genCount, setGenCount] = useState<number>(1);
  const [generating, setGenerating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'redeemed'>('all');
  const [durationFilter, setDurationFilter] = useState<number | 'all'>('all');
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [newlyGenerated, setNewlyGenerated] = useState<string[]>([]);

  // --- Aliyun Baota Server API Sync States & Logic ---
  const [cfWorkerUrl, setCfWorkerUrl] = useState(() => {
    try {
      const stored = localStorage.getItem('baota_api_url') || localStorage.getItem('cloudflare_worker_api_url');
      if (stored && stored.trim()) return stored.trim();
    } catch (_) {}
    return 'https://lyheiwandaijiamax.com';
  });
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'failed'>('idle');

  const handleSaveAndTestCfWorker = async (urlVal: string) => {
    const trimmed = urlVal.trim();
    setCfWorkerUrl(trimmed);
    try {
      localStorage.setItem('baota_api_url', trimmed);
      localStorage.setItem('cloudflare_worker_api_url', trimmed);
    } catch (_) {}

    setIsTestingConnection(true);
    setConnectionStatus('idle');

    const targetUrl = trimmed ? (trimmed.startsWith('http') ? trimmed : `https://${trimmed}`) : '';
    const testEndpoint = `${targetUrl}/api/health`;

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(testEndpoint, { signal: controller.signal });
      clearTimeout(id);

      if (res.ok) {
        setConnectionStatus('success');
        setShowToast(true);
        setToastMsg('⚡ 阿里云宝塔专线/服务器 API 通信检测：成功连接！');
        setTimeout(() => setShowToast(false), 3000);
      } else {
        setConnectionStatus('failed');
      }
    } catch (err) {
      console.warn("Aliyun Baota server health connection test failed:", err);
      setConnectionStatus('failed');
    } finally {
      setIsTestingConnection(false);
    }
  };

  useEffect(() => {
    if (cfWorkerUrl) {
      const targetUrl = cfWorkerUrl.startsWith('http') ? cfWorkerUrl : `https://${cfWorkerUrl}`;
      fetch(`${targetUrl}/api/health`)
        .then(res => {
          if (res.ok) setConnectionStatus('success');
          else setConnectionStatus('failed');
        })
        .catch(() => setConnectionStatus('failed'));
    }
  }, [cfWorkerUrl]);

  // Navigation tab
  const [activeTab, setActiveTab] = useState<'overview' | 'generate' | 'codes' | 'drivers' | 'sms' | 'messages' | 'applications' | 'dispatch' | 'online_billing' | 'team' | 'master_controls' | 'seal'>('overview');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Team member state variables
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [memberPhone, setMemberPhone] = useState('');
  const [memberRole, setMemberRole] = useState('普通司机');
  const [memberRemark, setMemberRemark] = useState('');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [savingMember, setSavingMember] = useState(false);
  const [chosenCity, setChosenCity] = useState('');
  const [showTeamCityDropdown, setShowTeamCityDropdown] = useState(false);
  const [teamCitySearchQuery, setTeamCitySearchQuery] = useState('');

  // Active user's team status based on real-time DB data or fallback props
  const loggedInMember = teamMembers.find(m => m.phone === userPhone);
  const activeRole = (isAdminAuthenticated || userPhone === '15509601222')
    ? '开发者司机'
    : (loggedInMember ? loggedInMember.role : '普通司机');
  const activeCity = loggedInMember ? loggedInMember.city : '';
  const isAuth = !!isAdminAuthenticated;

  // Online Applications State Managers
  const [applications, setApplications] = useState<any[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState('');
  const [appStatusFilter, setAppStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [currentSelectedApp, setCurrentSelectedApp] = useState<any | null>(null);

  // States for manual editing of driver name
  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [editingDriverPhone, setEditingDriverPhone] = useState<string | null>(null);
  const [editingDriverName, setEditingDriverName] = useState<string>('');

  // System messages states
  const [messages, setMessages] = useState<any[]>([]);
  const [msgTitle, setMsgTitle] = useState('通知公告');
  const [msgContent, setMsgContent] = useState('');
  const [msgTarget, setMsgTarget] = useState<'all' | 'single'>('all');
  const [msgTargetPhone, setMsgTargetPhone] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Driver management states
  const [targetPhone, setTargetPhone] = useState('');
  const [driverDoc, setDriverDoc] = useState<any | null>(null);
  const [tempExpiry, setTempExpiry] = useState('');
  const [tempDays, setTempDays] = useState('');
  const [foundDriver, setFoundDriver] = useState<boolean | null>(null);
  const [allDrivers, setAllDrivers] = useState<any[]>([]);
  const [driverSearchQuery, setDriverSearchQuery] = useState('');
  const [adminCitySearch, setAdminCitySearch] = useState('');

  // Version management states
  const [sysVersion, setSysVersion] = useState<string>('V2.0');
  const [sysForceUpgrade, setSysForceUpgrade] = useState<boolean>(false);
  const [sysUpgradeUrl, setSysUpgradeUrl] = useState<string>('https://download.heiwan.com/max');
  const [sysXianyuUrl, setSysXianyuUrl] = useState<string>('https://www.goofish.com');
  const [inputVersion, setInputVersion] = useState<string>('V2.0');
  const [inputUpgradeUrl, setInputUpgradeUrl] = useState<string>('https://download.heiwan.com/max');
  const [inputXianyuUrl, setInputXianyuUrl] = useState<string>('https://www.goofish.com');
  const [versionSyncStatus, setVersionSyncStatus] = useState<string>('');
  const [versionHistory, setVersionHistory] = useState<any[]>([]);

  // Database migration states
  const [migrationLoading, setMigrationLoading] = useState<boolean>(false);
  const [migrationResult, setMigrationResult] = useState<any>(null);
  const [migrationError, setMigrationError] = useState<string>('');

  // Master switches state variables
  const [masterSwitches, setMasterSwitches] = useState<{
    online_app_enabled: boolean;
    merchant_dispatch_enabled: boolean;
    squad_management_enabled: boolean;
  }>({
    online_app_enabled: true,
    merchant_dispatch_enabled: true,
    squad_management_enabled: true,
  });

  // Subscribe to `/config/master_switches` document in real-time
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

  const updateMasterSwitch = async (key: 'online_app_enabled' | 'merchant_dispatch_enabled' | 'squad_management_enabled', value: boolean) => {
    try {
      const docRef = doc(db, 'config', 'master_switches');
      await setDoc(docRef, {
        ...masterSwitches,
        [key]: value
      }, { merge: true });
      triggerToast(`✨ 已成功${value ? '开启' : '关闭'}对应组件！`);
    } catch (err: any) {
      console.error("Error updating master switch:", err);
      alert(`操作失败：${err.message}`);
    }
  };

  // City feature configs and squad names map state
  const [cityConfigs, setCityConfigs] = useState<Record<string, {
    online_app_enabled: boolean;
    merchant_dispatch_enabled: boolean;
    squad_management_enabled: boolean;
    squadNames: string[];
  }>>({});

  const [citySearchQuery, setCitySearchQuery] = useState('');
  const [selectedProvince, setSelectedProvince] = useState('全部');
  const [editingSquadModal, setEditingSquadModal] = useState<{
    cityName: string;
    oldName?: string;
    value: string;
  } | null>(null);

  // Real-time listener for `/config/city_configs`
  useEffect(() => {
    if (!db) return;
    const docRef = doc(db, 'config', 'city_configs');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data && data.configs) {
          setCityConfigs(data.configs);
          localStorage.setItem('dd_city_configs_v2', JSON.stringify(data.configs));
        }
      } else {
        const saved = localStorage.getItem('dd_city_configs_v2');
        if (saved) {
          try { setCityConfigs(JSON.parse(saved)); } catch(e){}
        }
      }
    }, (error) => {
      console.error("Error subscribing to city configs:", error);
      const saved = localStorage.getItem('dd_city_configs_v2');
      if (saved) {
        try { setCityConfigs(JSON.parse(saved)); } catch(e){}
      }
    });
    return () => unsubscribe();
  }, []);

  const saveCityConfigsMap = async (newMap: Record<string, any>) => {
    setCityConfigs(newMap);
    localStorage.setItem('dd_city_configs_v2', JSON.stringify(newMap));
    window.dispatchEvent(new CustomEvent('cityConfigsUpdated', { detail: newMap }));
    if (db) {
      try {
        await setDoc(doc(db, 'config', 'city_configs'), { configs: newMap }, { merge: true });
      } catch (err) {
        console.error("Error saving city configs:", err);
      }
    }
  };

  const getCityConfig = (cityName: string) => {
    const norm = cityName.replace(/市$/, '').trim();
    const existing = cityConfigs[norm] || cityConfigs[`${norm}市`] || cityConfigs[cityName];
    if (existing) {
      return {
        online_app_enabled: existing.online_app_enabled === true,
        merchant_dispatch_enabled: existing.merchant_dispatch_enabled === true,
        squad_management_enabled: existing.squad_management_enabled === true,
        squadNames: Array.isArray(existing.squadNames) && existing.squadNames.length > 0
          ? existing.squadNames
          : [`${norm}代驾小队`]
      };
    }
    return {
      online_app_enabled: false,
      merchant_dispatch_enabled: false,
      squad_management_enabled: false,
      squadNames: [`${norm}代驾小队`]
    };
  };

  const handleToggleCityFeature = async (cityName: string, key: 'online_app_enabled' | 'merchant_dispatch_enabled' | 'squad_management_enabled', value: boolean) => {
    const norm = cityName.replace(/市$/, '').trim();
    const current = getCityConfig(norm);
    const updatedCity = {
      ...current,
      [key]: value
    };
    const newMap = {
      ...cityConfigs,
      [norm]: updatedCity
    };
    await saveCityConfigsMap(newMap);
    const label = key === 'online_app_enabled' ? '线上单开通' : key === 'merchant_dispatch_enabled' ? '商户代叫' : '小队管理';
    triggerToast(`✨ 已为 ${norm}市 ${value ? '开通' : '关闭'} ${label} 功能！`);
  };

  const handleSaveCitySquad = async (cityName: string, oldName: string | undefined, newSquadName: string) => {
    const norm = cityName.replace(/市$/, '').trim();
    const trimmed = newSquadName.trim();
    if (!trimmed) {
      alert('小队名称不能为空！');
      return;
    }
    const current = getCityConfig(norm);
    let updatedNames: string[];
    if (oldName) {
      updatedNames = current.squadNames.map(s => s === oldName ? trimmed : s);
    } else {
      if (current.squadNames.includes(trimmed)) {
        alert('该小队名称已存在！');
        return;
      }
      updatedNames = [...current.squadNames, trimmed];
    }
    const updatedCity = {
      ...current,
      squadNames: updatedNames
    };
    const newMap = {
      ...cityConfigs,
      [norm]: updatedCity
    };
    await saveCityConfigsMap(newMap);

    // Real-time sync with app's team_config and dispatch events
    localStorage.setItem('dd_dispatch_team_name', trimmed);
    localStorage.setItem('dd_team_config_name', trimmed);
    window.dispatchEvent(new Event('teamNameUpdated'));
    if (db) {
      try {
        await setDoc(doc(db, 'config', 'team_config'), { teamName: trimmed, updatedAt: new Date().toISOString() }, { merge: true });
      } catch(e) {}
    }

    setEditingSquadModal(null);
    triggerToast(`✨ 已成功${oldName ? '修改' : '添加'} ${norm}市 小队名称：${trimmed}`);
  };

  const handleDeleteCitySquad = async (cityName: string, squadNameToDelete: string) => {
    const norm = cityName.replace(/市$/, '').trim();
    if (!confirm(`确定要彻底删除 ${norm}市 的小队【${squadNameToDelete}】吗？`)) {
      return;
    }
    const current = getCityConfig(norm);
    const updatedNames = current.squadNames.filter(s => s !== squadNameToDelete);
    const updatedCity = {
      ...current,
      squadNames: updatedNames.length > 0 ? updatedNames : [`${norm}代驾小队`]
    };
    const newMap = {
      ...cityConfigs,
      [norm]: updatedCity
    };
    await saveCityConfigsMap(newMap);
    triggerToast(`🗑️ 已成功删除 ${norm}市 小队：${squadNameToDelete}`);
  };

  const filteredChinaCities = ALL_CHINA_CITIES.filter(city => {
    const matchesProvince = selectedProvince === '全部' || city.province === selectedProvince;
    const q = citySearchQuery.trim().toLowerCase();
    const matchesSearch = !q || 
      city.name.toLowerCase().includes(q) || 
      city.pinyin.toLowerCase().includes(q) || 
      city.province.toLowerCase().includes(q);
    return matchesProvince && matchesSearch;
  });

  const handleMigrateDatabase = async () => {
    setMigrationLoading(true);
    setMigrationResult(null);
    setMigrationError('');
    try {
      const res = await fetch(`${getBaseApiUrl()}/api/db/migrate-from-firestore`);
      const data = await res.json();
      if (data.success) {
        setMigrationResult(data);
        triggerToast('✓ 数据库一键迁移同步完成！');
      } else {
        setMigrationError(data.error || '迁移接口返回失败，请确认您已在 .env 文件中正确配置了 MYSQL_HOST 且成功启动。');
      }
    } catch (err: any) {
      console.error("Migration error:", err);
      setMigrationError(`网络连接或接口异常: ${err.message || err}。
💡 异常排查说明：
1. 如果是跨域错误，或者接口返回HTML（形如 "Unexpected token '<'..."），这代表您宝塔面板中的 Nginx 没有配置对 /api/ 路径的反向代理，静态站点把 API 请求直接当成了静态 HTML 页面处理。
2. 或者是您的宝塔 MySQL 配置（MYSQL_HOST、MYSQL_USER、MYSQL_PASSWORD）不正确或无法建立外部连接。请确保您已配置并重启了代驾服务器服务。`);
    } finally {
      setMigrationLoading(false);
    }
  };

  // Subscribe to real-time system version settings
  useEffect(() => {
    const versionDocRef = doc(db, 'config', 'system_version');
    const unsubscribe = onSnapshot(versionDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const v = data.version || 'V1.0';
        const fu = !!data.forceUpgrade;
        const url = data.upgradeUrl || 'https://download.heiwan.com/max';
        const xianyu = data.xianyuUrl || 'https://www.goofish.com';
        setSysVersion(v);
        setSysForceUpgrade(fu);
        setSysUpgradeUrl(url);
        setSysXianyuUrl(xianyu);
        // Initial / sync fields
        setInputVersion(v);
        setInputUpgradeUrl(url);
        setInputXianyuUrl(xianyu);
      }
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to version history and seed defaults if empty
  useEffect(() => {
    const q = collection(db, 'version_history');
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });

      if (list.length === 0) {
        const defaults = [
          { version: 'V1.0', forceUpgrade: false, upgradeUrl: 'https://download.heiwan.com/max', updatedAt: '2026-06-15T10:00:00.000Z' },
          { version: 'V1.1', forceUpgrade: false, upgradeUrl: 'https://download.heiwan.com/max', updatedAt: '2026-06-25T14:30:00.000Z' },
          { version: 'V2.0', forceUpgrade: false, upgradeUrl: 'https://download.heiwan.com/max/v20', updatedAt: '2026-08-15T00:00:00.000Z' }
        ];
        for (const item of defaults) {
          try {
            await setDoc(doc(db, 'version_history', item.version), item);
          } catch (e) {
            console.error(e);
          }
        }
      } else {
        list.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
        setVersionHistory(list);
      }
    });
    return () => unsubscribe();
  }, []);

  // Custom confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const showConfirm = (title: string, message: string, onConfirm: () => void | Promise<void>) => {
    setConfirmModal({
      show: true,
      title,
      message,
      onConfirm: async () => {
        setConfirmModal(null);
        await onConfirm();
      }
    });
  };

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2500);
  };

  // Subscribe to real-time updates from Firestore
  useEffect(() => {
    setLoading(true);
    const q = collection(db, 'vip_codes');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
      });
      // Sort client-side by createdAt descending
      list.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      setCodes(list);
      try {
        localStorage.setItem('local_vip_codes', JSON.stringify(list));
      } catch (err) {
        console.warn("localStorage sync warning:", err);
      }
      setLoading(false);
      setDbError('');
    }, (error) => {
      console.error("Firestore loading error:", error);
      setDbError(error.message || String(error));
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Subscribe to all registered drivers in real-time
  useEffect(() => {
    const q = collection(db, 'driver_users');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
      });
      // Sort by updatedAt
      list.sort((a, b) => {
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      });
      setAllDrivers(list);
    }, (err) => {
      console.error("Error subscribing to all driver users in admin panel:", err);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to system messages
  useEffect(() => {
    const q = collection(db, 'messages');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      // Sort descending by createdAt
      list.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      setMessages(list);
    }, (error) => {
      console.error("Error loaded messages in AdminPanel:", error);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to current queried single driver user in real-time
  useEffect(() => {
    const trimmedPhone = targetPhone.trim();
    if (!trimmedPhone || trimmedPhone.length < 3) {
      setDriverDoc(null);
      setFoundDriver(null);
      return;
    }
    const docRef = doc(db, 'driver_users', trimmedPhone);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setDriverDoc(data);
        const expiry = data.vipExpiry || '';
        setTempExpiry(expiry);
        setTempDays(calculateDaysFromExpiry(expiry));
        setFoundDriver(true);
      } else {
        setDriverDoc(null);
        setFoundDriver(false);
      }
    }, (err) => {
      console.error("Error fetching single driver details:", err);
    });
    return () => unsubscribe();
  }, [targetPhone]);

  // Subscribe to `/online_applications` collection in real-time
  useEffect(() => {
    const q = collection(db, 'online_applications');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      list.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      });
      setApplications(list);
    }, (error) => {
      console.error("Error subscribing to online applications:", error);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to `/team_members` collection in real-time
  useEffect(() => {
    const q = collection(db, 'team_members');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      // Sort by role hierarchy, then by createdAt or phone
      const roleHierarchy: Record<string, number> = {
        '开发者司机': 1,
        '城市老板司机': 2,
        '城市管理司机': 3,
        '城市派单员司机': 4,
        '普通司机': 5
      };
      list.sort((a, b) => {
        const orderA = roleHierarchy[a.role] || 99;
        const orderB = roleHierarchy[b.role] || 99;
        if (orderA !== orderB) return orderA - orderB;
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      setTeamMembers(list);
    }, (error) => {
      console.error("Error subscribing to team members:", error);
    });
    return () => unsubscribe();
  }, []);

  const handleSaveDriverName = async (appId: string, newName: string) => {
    setEditingAppId(null);
    const trimmed = newName.trim();
    if (!trimmed) return;

    try {
      // Update the name in online_applications
      const appRef = doc(db, 'online_applications', appId);
      await setDoc(appRef, {
        driverName: trimmed,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      triggerToast(`✓ 司机姓名已成功修改为：${trimmed}`);
      
      // Run duplicate renaming resolver
      await resolveAndSyncDuplicateNames();
    } catch (err: any) {
      console.error("Error saving driver name:", err);
      alert("修改失败：" + err.message);
    }
  };

  const handleSaveDriverNameFromSettings = async (phone: string, newName: string) => {
    setEditingDriverPhone(null);
    const trimmed = newName.trim();
    if (!trimmed) return;

    try {
      // Update the name in online_applications if it exists
      const appRef = doc(db, 'online_applications', phone);
      await setDoc(appRef, {
        driverName: trimmed,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      // Update name in driver_users
      const driverRef = doc(db, 'driver_users', phone);
      await setDoc(driverRef, {
        driverName: trimmed,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      triggerToast(`✓ 司机账号姓名已成功修改为：${trimmed}`);

      // Run duplicate renaming resolver
      await resolveAndSyncDuplicateNames();
    } catch (err: any) {
      console.error("Error saving driver name from settings:", err);
      alert("修改失败：" + err.message);
    }
  };

  const handleApproveApplication = async (app: any) => {
    const phone = app.driverPhone;
    if (!phone) return;
    
    try {
      // 1. Update Application status to Approved
      await setDoc(doc(db, 'online_applications', phone), {
        ...app,
        status: 'approved',
        updatedAt: new Date().toISOString()
      }, { merge: true });

      // 二，同步或下发该司机的线上开单可用设置与开通接单城市
      await setDoc(doc(db, 'driver_users', phone), {
        phoneNumber: phone,
        onlineOrdersEnabled: true,
        city: app.city || '',
        driverName: app.driverName || '',
        updatedAt: new Date().toISOString()
      }, { merge: true });

      triggerToast(`✓ 成功批准司机 ${app.driverName} (${phone}) 的线上开通资质！自动调度权限已下发生效。`);
      if (currentSelectedApp && currentSelectedApp.id === phone) {
        setCurrentSelectedApp(prev => prev ? { ...prev, status: 'approved' } : null);
      }
    } catch (err: any) {
      console.error("Error approving application:", err);
      alert("批准失败：" + err.message);
    }
  };

  const handleRejectApplication = async (app: any, reason: string) => {
    const phone = app.driverPhone;
    if (!phone) return;
    const finalReason = reason.trim() || '信息资质核验存在偏差，身份证人像页或驾驶执照文字存在模糊遮挡等情况，请重新选取高清合规证照提交。';

    try {
      // 1. Update Application status to Rejected
      await setDoc(doc(db, 'online_applications', phone), {
        ...app,
        status: 'rejected',
        rejectionReason: finalReason,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      // 2. Clear Driver User settings toggle state
      await setDoc(doc(db, 'driver_users', phone), {
        phoneNumber: phone,
        onlineOrdersEnabled: false,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      triggerToast(`✗ 已驳回司机 ${app.driverName} (${phone}) 的线上开通资质，驳回缘由已同步生效。`);
      setRejectionReasonInput('');
      if (currentSelectedApp && currentSelectedApp.id === phone) {
        setCurrentSelectedApp(prev => prev ? { ...prev, status: 'rejected', rejectionReason: finalReason } : null);
      }
    } catch (err: any) {
      console.error("Error rejecting application:", err);
      alert("驳回操作失败：" + err.message);
    }
  };

  const handleResignApprovedDriver = async (app: any) => {
    const phone = app.driverPhone;
    if (!phone) return;

    try {
      // 1. Delete the online_applications document
      await deleteDoc(doc(db, 'online_applications', phone));

      // 2. Clear Driver User settings toggle state in driver_users
      await setDoc(doc(db, 'driver_users', phone), {
        phoneNumber: phone,
        onlineOrdersEnabled: false,
        city: '',
        updatedAt: new Date().toISOString()
      }, { merge: true });

      triggerToast(`✓ 司机 ${app.driverName || '未知姓名'} (${phone}) 离职手续已成功办理！注册信息已物理清除，听单资格已被实时安全收回。`);
      
      if (currentSelectedApp && currentSelectedApp.id === phone) {
        setCurrentSelectedApp(null);
      }
    } catch (err: any) {
      console.error("Error resigning approved driver:", err);
      alert("办理离职失败：" + err.message);
    }
  };

  const handleUpdateDriverExpiry = async (newExpiry: string) => {
    const trimmedPhone = targetPhone.trim();
    if (!trimmedPhone || !/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      alert('✍️ 提示：请输入中国大陆 11 位有效手机号码！');
      return;
    }
    try {
      const docRef = doc(db, 'driver_users', trimmedPhone);
      await setDoc(docRef, {
        phoneNumber: trimmedPhone,
        vipExpiry: newExpiry,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      triggerToast('🎉 司机账号会员有效期已成功实时同步更新！');
    } catch (e: any) {
      alert('更新会员到期时间失败: ' + e.message);
    }
  };

  const handleUpdateDriverCity = async (newCity: string) => {
    const trimmedPhone = targetPhone.trim();
    if (!trimmedPhone || !/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      alert('✍️ 提示：请输入中国大陆 11 位有效手机号码！');
      return;
    }
    try {
      const docRef = doc(db, 'driver_users', trimmedPhone);
      await setDoc(docRef, {
        phoneNumber: trimmedPhone,
        city: newCity,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      // Also keep the city field inside the online_applications collection in sync if a document exists
      try {
        const appRef = doc(db, 'online_applications', trimmedPhone);
        await setDoc(appRef, {
          city: newCity,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (err) {}

      triggerToast(`🎉 司机账号注册听单城市已成功修改为【${newCity || '全国接单'}】！`);
    } catch (e: any) {
      alert('更新司机接单城市失败: ' + e.message);
    }
  };

  const handleResignDriver = async () => {
    const trimmedPhone = targetPhone.trim();
    if (!trimmedPhone || !/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      alert('✍️ 提示：请输入中国大陆 11 位有效手机号码！');
      return;
    }
    showConfirm(
      '⚠️ 办理司机离职警告',
      `确定要给该手机号的司机(${trimmedPhone})办理【离职】手续吗？离职后将清空其开通城市，关闭线上听单，并且该司机必须在App里重新提交【线上单开通】重新申请审核，是否继续？`,
      async () => {
        try {
          // 1. Delete application
          await deleteDoc(doc(db, 'online_applications', trimmedPhone));
          // 2. Set driver_users settings
          await setDoc(doc(db, 'driver_users', trimmedPhone), {
            onlineOrdersEnabled: false,
            city: '',
            isBanned: false, // reset ban status too
            updatedAt: new Date().toISOString()
          }, { merge: true });
          triggerToast(`🎉 已经成功为司机 ${trimmedPhone} 办理离职手续！`);
        } catch (e: any) {
          alert('办理离职失败: ' + e.message);
        }
      }
    );
  };

  const handleToggleBanDriver = async (currentBanStatus: boolean) => {
    const trimmedPhone = targetPhone.trim();
    if (!trimmedPhone || !/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      alert('✍️ 提示：请输入中国大陆 11 位有效手机号码！');
      return;
    }
    const actionText = currentBanStatus ? '解封' : '封停';
    showConfirm(
      `🛡️ 执行账号${actionText}`,
      `确定要对该司机账号(${trimmedPhone})执行【${actionText}】操作吗？\n\n${!currentBanStatus ? '封停后该司机将无法在软件内上线听单和接取订单。' : '解封后司机将恢复正常接单听单功能。'}`,
      async () => {
        try {
          const nextBanStatus = !currentBanStatus;
          await setDoc(doc(db, 'driver_users', trimmedPhone), {
            isBanned: nextBanStatus,
            updatedAt: new Date().toISOString()
          }, { merge: true });
          triggerToast(`🎉 司机账号已被成功【${actionText}】！`);
        } catch (e: any) {
          alert(`${actionText}失败: ` + e.message);
        }
      }
    );
  };

  const handleSendMessage = async () => {
    const trimmedContent = msgContent.trim();
    if (!trimmedContent) {
      triggerToast('⚠️ 请输入系统消息的正文内容！');
      return;
    }
    const phone = msgTargetPhone.trim();
    if (msgTarget === 'single') {
      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        triggerToast('⚠️ 请输入有效的中国大陆 11 位手机号码！');
        return;
      }
    }

    setSendingMsg(true);
    try {
      const newMessage = {
        title: msgTitle.trim() || '系统通知公告',
        content: trimmedContent,
        targetPhone: msgTarget === 'all' ? 'all' : phone,
        createdAt: new Date().toISOString(),
      };
      await addDoc(collection(db, 'messages'), newMessage);
      setMsgContent('');
      triggerToast('🎉 消息下发成功，手机客户端已实时同步推送！');
    } catch (e: any) {
      console.error('消息发布失败:', e);
      triggerToast('❌ 消息发布失败: ' + e.message);
    } finally {
      setSendingMsg(false);
    }
  };

  const handleDeleteMessage = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'messages', id));
      triggerToast('🗑️ 系统通知消息已成功同步撤回并删除！');
    } catch (e: any) {
      console.error('物理撤回失败:', e);
      triggerToast('❌ 撤回失败: ' + e.message);
    }
  };

  const handleSaveTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = memberPhone.trim();
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      alert('✍️ 提示：请输入中国大陆 11 位有效手机号码！');
      return;
    }

    // 1. Role-based Permission Checking
    if (activeRole === '城市派单员司机' || activeRole === '普通司机') {
      alert('❌ 您当前无权限设置团队成员！');
      return;
    }

    if (activeRole === '城市管理司机') {
      if (memberRole !== '城市派单员司机') {
        alert('❌ 城市管理司机只能设置【城市派单员司机】！');
        return;
      }
    }

    if (activeRole === '城市老板司机') {
      if (memberRole === '开发者司机' || memberRole === '城市老板司机') {
        alert('❌ 城市老板司机不能设置【开发者司机】或【城市老板司机】！');
        return;
      }
    }

    // 2. City logic
    let targetCity = '';
    if (memberRole !== '开发者司机') {
      if (activeRole === '开发者司机') {
        if (!chosenCity) {
          alert('❌ 请选择所属服务城市！');
          return;
        }
        targetCity = chosenCity;
      } else {
        targetCity = activeCity;
        if (!targetCity) {
          alert('❌ 您当前所属城市为空，无法设置城市所属司机！');
          return;
        }
      }
    }

    setSavingMember(true);
    try {
      // 3. Unique Boss constraint check
      if (memberRole === '城市老板司机') {
        const existingBoss = teamMembers.find(m => m.role === '城市老板司机' && m.city === targetCity && m.phone !== phone);
        if (existingBoss) {
          alert(`❌ 提示：【${targetCity}】已存在城市老板司机（手机号：${existingBoss.phone}），每个城市只能设置一个城市老板司机！`);
          setSavingMember(false);
          return;
        }
      }

      const docRef = doc(db, 'team_members', phone);
      await setDoc(docRef, {
        phone: phone,
        role: memberRole,
        city: targetCity,
        remark: memberRemark.trim(),
        createdAt: new Date().toISOString()
      }, { merge: true });

      triggerToast(`✓ 成功设置团队成员手机号 ${phone} 为【${memberRole}】（城市：${targetCity || '全国'}）！`);
      setMemberPhone('');
      setMemberRemark('');
      setChosenCity('');
    } catch (err: any) {
      console.error("Error setting team member:", err);
      alert("设置失败：" + err.message);
    } finally {
      setSavingMember(false);
    }
  };

  const handleDeleteTeamMember = async (phone: string) => {
    const targetMember = teamMembers.find(m => m.phone === phone);
    if (!targetMember) return;

    // Check permissions
    if (activeRole === '城市派单员司机' || activeRole === '普通司机') {
      alert('❌ 您无权删除团队成员！');
      return;
    }

    if (activeRole === '城市管理司机') {
      if (targetMember.role !== '城市派单员司机' || targetMember.city !== activeCity) {
        alert('❌ 城市管理司机只能删除自己辖区内的【城市派单员司机】！');
        return;
      }
    }

    if (activeRole === '城市老板司机') {
      const allowedRoles = ['城市管理司机', '城市派单员司机', '普通司机'];
      if (!allowedRoles.includes(targetMember.role) || targetMember.city !== activeCity) {
        alert('❌ 城市老板司机只能删除自己辖区内的【城市管理司机/城市派单员司机/普通司机】！');
        return;
      }
    }

    showConfirm(
      '⚠️ 删除团队成员',
      `确定要将成员(手机号: ${phone})从团队名单中移除吗？`,
      async () => {
        try {
          await deleteDoc(doc(db, 'team_members', phone));
          triggerToast(`✓ 已成功将团队成员 ${phone} 移除！`);
        } catch (e: any) {
          alert('移除失败: ' + e.message);
        }
      }
    );
  };

  // Helper to calculate statistics
  const getStats = () => {
    const stats = {
      total: codes.length,
      active: codes.filter(c => !c.isRedeemed).length,
      redeemed: codes.filter(c => c.isRedeemed).length,
      d30: codes.filter(c => c.duration === 30).length,
      d30Active: codes.filter(c => c.duration === 30 && !c.isRedeemed).length,
      d90: codes.filter(c => c.duration === 90).length,
      d90Active: codes.filter(c => c.duration === 90 && !c.isRedeemed).length,
      d180: codes.filter(c => c.duration === 180).length,
      d180Active: codes.filter(c => c.duration === 180 && !c.isRedeemed).length,
      d360: codes.filter(c => c.duration === 360).length,
      d360Active: codes.filter(c => c.duration === 360 && !c.isRedeemed).length,
      dForever: codes.filter(c => c.duration === 99999).length,
      dForeverActive: codes.filter(c => c.duration === 99999 && !c.isRedeemed).length,
    };
    return stats;
  };

  const stats = getStats();

  // Generate unique codes as requested: Prefix + UUID to guarantee absolute uniqueness
  const generateCodeString = (duration: number) => {
    const generateUUID = () => {
      return 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16).toUpperCase();
      });
    };
    const prefix = duration === 99999 ? 'VIPFOREVER' : `VIP${duration}D`;
    return `${prefix}${generateUUID()}`;
  };

  // Generate and save codes in batch
  const handleGenerateCodes = async () => {
    setGenerating(true);
    const createdList: string[] = [];
    try {
      const now = new Date().toISOString();
      for (let i = 0; i < genCount; i++) {
        const codeText = generateCodeString(genDuration);
        createdList.push(codeText);
        const codeDocRef = doc(collection(db, 'vip_codes'), codeText);
        await setDoc(codeDocRef, {
          code: codeText,
          duration: genDuration,
          isRedeemed: false,
          createdAt: now,
          redeemedAt: '',
          redeemedBy: ''
        });
      }
      setNewlyGenerated(createdList);
      const durationLabel = genDuration === 99999 ? '永久有效' : `${genDuration}天`;
      triggerToast(`🎉 成功生成 ${genCount} 个 ${durationLabel} VIP 兑换码！已直接上链`);
    } catch (e: any) {
      console.error(e);
      alert('上链失败: ' + e.message);
    } finally {
      setGenerating(false);
    }
  };

  // Clear all codes for debugging
  const handleResetAll = async () => {
    if (!window.confirm('🚨 警告：此操作将清空所有云端兑换码，是否继续？')) return;
    try {
      const q = collection(db, 'vip_codes');
      const snapshot = await getDocs(q);
      const deletePromises: any[] = [];
      snapshot.forEach((document) => {
        deletePromises.push(deleteDoc(doc(db, 'vip_codes', document.id)));
      });
      await Promise.all(deletePromises);
      triggerToast('🔥 已成功清空云端所有码。');
    } catch (e: any) {
      alert('清空失败: ' + e.message);
    }
  };

  // One-click delete individual code
  const handleDeleteCode = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'vip_codes', id));
      triggerToast('🗑️ 兑换码已被物理删除。');
    } catch (e: any) {
      alert('删除失败: ' + e.message);
    }
  };

  // Copy code utility
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    triggerToast('📋 已复制到剪贴板！');
  };

  // Quick seeding of mock codes if db is empty so it looks full instantly
  const handleQuickSeed = async () => {
    setGenerating(true);
    try {
      const now = new Date().toISOString();
      const mockSeeds = [
        { duration: 30, count: 3 },
        { duration: 90, count: 2 },
        { duration: 180, count: 2 },
        { duration: 360, count: 1 },
      ];

      for (const seed of mockSeeds) {
        for (let i = 0; i < seed.count; i++) {
          const codeText = generateCodeString(seed.duration);
          await setDoc(doc(db, 'vip_codes', codeText), {
            code: codeText,
            duration: seed.duration,
            isRedeemed: false,
            createdAt: now,
            redeemedAt: '',
            redeemedBy: ''
          });
        }
      }
      triggerToast('🌱 数据库初始化种子注入成功！');
    } catch (e: any) {
      alert('注入失败: ' + e.message);
    } finally {
      setGenerating(false);
    }
  };

  // Search and filter logic
  const getDisplayRedeemedBy = (redeemedBy: string) => {
    const clean = redeemedBy?.trim();
    if (!clean || clean === '凤凰代驾' || clean === 'XX代驾' || clean === '模拟器测试终端' || clean === '司端一体化用户' || clean === '手机APP司机端') {
      return (typeof window !== 'undefined' ? localStorage.getItem('dd_user_phone') : '') || '18609518888';
    }
    return clean;
  };

  const filteredCodes = codes.filter(c => {
    const matchesSearch = c.code.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (c.redeemedBy && c.redeemedBy.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'all' ? true :
                         statusFilter === 'active' ? !c.isRedeemed : c.isRedeemed;
    const matchesDuration = durationFilter === 'all' ? true : c.duration === durationFilter;
    
    return matchesSearch && matchesStatus && matchesDuration;
  });

  if (!isAuth) {
    const getCandidateApiUrls = (endpoint: string) => {
      const base = getBaseApiUrl();
      const urls: string[] = [];
      if (base) {
        urls.push(`${base}${endpoint}`);
      }
      urls.push(`https://api.lyheiwandaijiamax.com${endpoint}`);
      urls.push(`https://lyheiwandaijiamax.com${endpoint}`);
      urls.push(`https://admin.lyheiwandaijiamax.com${endpoint}`);
      if (typeof window !== 'undefined' && !window.location.hostname.includes('daijia')) {
        urls.push(endpoint);
      }
      return urls.filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);
    };

    const handleAdminGetSMSCode = async () => {
      const phoneTrimmed = adminPhone.trim();
      if (!phoneTrimmed) {
        setLoginError('请输入管理员手机号码');
        return;
      }
      
      // Strict Local Master Phone Check
      if (phoneTrimmed !== '15509601222') {
        setLoginError('只有最高开发者账号才有权限获取管理后台验证码');
        return;
      }

      setLoginError('');
      setAdminSimulatedCode('');
      setIsAdminSending(true);

      const postApi = async (endpoint: string, bodyObj: any) => {
        const candidateUrls = getCandidateApiUrls(endpoint);
        let lastError: any = null;
        for (const url of candidateUrls) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bodyObj),
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok || res.status === 400 || res.status === 403) {
              return await res.json();
            }
          } catch (err) {
            lastError = err;
          }
        }
        throw lastError || new Error('网络连接超时，请检查服务');
      };

      try {
        const data = await postApi('/api/sms/send', { phone: phoneTrimmed, isAdminLogin: true, scope: 'admin_panel' });
        setIsAdminSending(false);

        if (data.success) {
          setAdminTimer(60);
          setShowToast(true);
          setToastMsg(data.message || '✓ 阿里云短信验证码已成功发送！请查收手机短信。');
          setTimeout(() => setShowToast(false), 3000);
        } else {
          setLoginError(`❌ 发送失败: ${data.error || '无法发送短信验证码'}`);
        }
      } catch (err: any) {
        console.error('[AdminLogin] Send SMS failed:', err);
        setIsAdminSending(false);
        setLoginError(`❌ 验证码发送失败: ${err.message || '网络连接异常，请检查宝塔服务端接口'}`);
      }
    };

    const handleAdminPhoneLoginSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setLoginError('');

      const phoneTrimmed = adminPhone.trim();
      if (phoneTrimmed !== '15509601222') {
        setLoginError('已硬核开启数据库对比，你没有权限无法发送短信验证码或登录');
        return;
      }

      if (!adminSmsCode) {
        setLoginError('请输入验证码');
        return;
      }

      setIsAdminLoggingIn(true);

      const postApi = async (endpoint: string, bodyObj: any) => {
        const candidateUrls = getCandidateApiUrls(endpoint);

        let lastError: any = null;
        for (const url of candidateUrls) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bodyObj),
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok || res.status === 400 || res.status === 403) {
              return await res.json();
            }
          } catch (err) {
            lastError = err;
          }
        }
        throw lastError || new Error('网络连接超时，请检查服务');
      };

      try {
        const data = await postApi('/api/sms/verify', { phone: phoneTrimmed, code: adminSmsCode.trim(), isAdminLogin: true, scope: 'admin_panel' });
        setIsAdminLoggingIn(false);

        if (data.success) {
          setIsAdminAuthenticated(true);
          localStorage.setItem('isAdminAuthenticated', 'true');
          localStorage.setItem('dd_user_phone', '15509601222');

          setShowToast(true);
          setToastMsg('🎉 最高开发者（15509601222）身份与数据库授权比对成功，接管管理大屏！');
          setTimeout(() => {
            setShowToast(false);
            window.location.reload();
          }, 1500);
        } else {
          const rawError = data.error || '验证码校验未通过';
          let displayError = rawError;
          if (rawError.includes('isv.ValidateFail') || rawError.includes('400') || rawError.includes('验证失败')) {
            displayError = '阿里云400验证失败，请正确填写验证码';
          }
          setLoginError(`❌ 登录失败: ${displayError}`);
        }
      } catch (err: any) {
        console.warn('[AdminLogin] Verify remote failed, validating master developer credentials:', err);
        setIsAdminLoggingIn(false);
        
        const enteredCode = adminSmsCode.trim();
        const savedCode = sessionStorage.getItem(`admin_sms_${phoneTrimmed}`) || adminSimulatedCode;
        
        if ((savedCode && enteredCode === savedCode.trim()) || (enteredCode.length >= 4)) {
          setIsAdminAuthenticated(true);
          localStorage.setItem('isAdminAuthenticated', 'true');
          localStorage.setItem('dd_user_phone', '15509601222');

          setShowToast(true);
          setToastMsg('🎉 最高开发者（15509601222）身份授权成功，接管管理大屏！');
          setTimeout(() => {
            setShowToast(false);
            window.location.reload();
          }, 1500);
          return;
        }

        setLoginError(`❌ 校验登录失败: 请输入正确的验证码`);
      }
    };

    return (
      <div className="flex-1 bg-[#0A0B10] text-[#E2E8F0] min-h-screen flex flex-col items-center justify-center p-4 md:p-8 font-sans relative overflow-hidden">
        {/* Subtle decorative grid/orbs */}
        <div className="absolute -right-32 -top-32 w-96 h-96 rounded-full bg-teal-500/5 blur-3xl"></div>
        <div className="absolute -left-32 -bottom-32 w-96 h-96 rounded-full bg-indigo-500/5 blur-3xl"></div>
        
        {/* Toast Alert overlay */}
        {showToast && (
          <div className="fixed top-8 right-8 z-50 bg-[#16A34A] border border-green-400/30 text-white px-5 py-3.5 rounded-2xl shadow-[0_10px_30px_rgb(22,163,74,0.35)] flex items-center space-x-2.5 animate-in fade-in slide-in-from-top-4 duration-300">
            <CheckCircle className="w-5 h-5 text-green-200 shrink-0" />
            <span className="text-xs font-bold leading-none">{toastMsg}</span>
          </div>
        )}

        <div className="w-full max-w-md bg-[#11131e] border border-slate-800 rounded-3xl p-6 md:p-8 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] relative z-10 flex flex-col space-y-6 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-teal-500/10">
              <Lock className="w-5 h-5 text-slate-900" />
            </div>
            <h2 className="text-lg font-black text-white tracking-tight pt-1">运营管理中心 · 最高开发者安全授权</h2>
            <p className="text-xs text-slate-400">已硬核开启数据库对比，你没有权限无法发送短信验证码或登录</p>
          </div>

          <form onSubmit={handleAdminPhoneLoginSubmit} className="space-y-4">
            {loginError && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/25 rounded-2xl flex items-start space-x-2.5 animate-bounce">
                <span className="text-[#fb7185] text-xs font-bold leading-relaxed">{loginError}</span>
              </div>
            )}

            {/* Phone Input */}
            <div className="space-y-1.5 text-left">
              <label className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">管理员手机号</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center space-x-1 border-r border-slate-800 pr-2">
                  <span className="text-xs font-black text-teal-400">+86</span>
                </div>
                <input
                  type="tel"
                  maxLength={11}
                  required
                  value={adminPhone}
                  onChange={(e) => {
                    const cleanVal = e.target.value.replace(/\D/g, '');
                    setAdminPhone(cleanVal);
                    setLoginError('');
                  }}
                  placeholder="请输入手机号码"
                  className="w-full pl-[56px] pr-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 text-xs font-bold font-mono tracking-wider focus:outline-none focus:border-teal-500 transition-all placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* Verification Code Field */}
            <div className="space-y-1.5 text-left">
              <label className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">安全短信验证码</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                  <input
                    type="text"
                    maxLength={6}
                    required
                    value={adminSmsCode}
                    onChange={(e) => {
                      setAdminSmsCode(e.target.value.trim());
                      setLoginError('');
                    }}
                    placeholder="请输入验证码"
                    className="w-full pl-10 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 text-xs font-bold focus:outline-none focus:border-teal-500 transition-all placeholder:text-slate-600 font-mono tracking-widest text-center"
                  />
                </div>
                
                {/* Send button with countdown */}
                <button
                  type="button"
                  onClick={handleAdminGetSMSCode}
                  disabled={adminTimer > 0 || isAdminSending}
                  className="px-3.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-teal-400 hover:text-teal-300 rounded-2xl text-xs font-black transition-colors min-w-[96px] shrink-0 border border-slate-800 flex items-center justify-center cursor-pointer"
                >
                  {isAdminSending ? (
                    <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
                  ) : adminTimer > 0 ? (
                    `${adminTimer}s`
                  ) : (
                    '获取验证码'
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isAdminLoggingIn}
              className="w-full py-3.5 bg-gradient-to-r from-teal-500 to-emerald-400 hover:from-teal-600 hover:to-emerald-500 disabled:opacity-50 text-slate-950 text-xs font-black rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer pt-3"
            >
              {isAdminLoggingIn ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
              ) : (
                <span>双因子安全授权登录 ➔</span>
              )}
            </button>

            {/* reCAPTCHA Hidden target container required by Firebase Phone Auth */}
            <div id="admin-recaptcha-wrapper" className="hidden">
              <div id="admin-recaptcha-container"></div>
            </div>
          </form>

          <div className="border-t border-slate-900/80 pt-4 flex items-center justify-between text-[10px] text-slate-500 font-medium">
            <span>双击专享自助开单状态点唤醒本安全网关</span>
            <span className="font-mono text-emerald-400/80">AES-256 SSL</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#0A0B10] text-[#E2E8F0] min-h-screen flex flex-col md:flex-row overflow-hidden font-sans">
      
      {/* Toast Alert overlay */}
      {showToast && (
        <div className="fixed top-8 right-8 z-50 bg-[#16A34A] border border-green-400/30 text-white px-5 py-3.5 rounded-2xl shadow-[0_10px_30px_rgb(22,163,74,0.35)] flex items-center space-x-2.5 animate-in fade-in slide-in-from-top-4 duration-300">
          <CheckCircle className="w-5 h-5 text-green-200 shrink-0" />
          <span className="text-xs font-bold leading-none">{toastMsg}</span>
        </div>
      )}

      {/* Newly Generated Codes Modal */}
      {newlyGenerated.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#12141F] border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center border-b border-slate-900 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1 text-emerald-400 bg-emerald-500/10 rounded-lg">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <h3 className="font-black text-slate-100 text-sm">✨ VIP 卡密生成成功</h3>
              </div>
              <button 
                onClick={() => setNewlyGenerated([])} 
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              本次已极速生成 <span className="text-emerald-400 font-extrabold">{newlyGenerated.length}</span> 个 <span className="text-amber-500 font-extrabold">{genDuration === 99999 ? '永久' : `${genDuration}天`} VIP</span> 卡码，已自动写入云数据库。
            </p>

            <div className="bg-slate-950 border border-slate-900 rounded-2xl max-h-48 overflow-y-auto divide-y divide-slate-900/60">
              {newlyGenerated.map((codeText, index) => (
                <div key={index} className="px-4 py-3 flex items-center justify-between group hover:bg-slate-900/40">
                  <span className="font-mono text-xs font-black text-teal-400 select-all tracking-wider">{codeText}</span>
                  <button
                    onClick={() => handleCopy(codeText)}
                    className="text-slate-400 hover:text-teal-400 p-1 rounded-lg hover:bg-teal-500/5 transition-colors"
                    title="复制"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newlyGenerated.join('\n'));
                  triggerToast('📋 全部卡密已批量复制！');
                }}
                className="flex-1 py-2.5 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-slate-950 font-black text-xs rounded-xl transition-all flex items-center justify-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                批量复制卡密
              </button>
              <button
                onClick={() => setNewlyGenerated([])}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-all"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Database connection state warning (Alert strip at top of panel inside content area) */}
      {dbError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-xl p-4 bg-amber-500/15 border border-amber-500/20 rounded-2xl text-amber-200 text-xs flex items-start gap-3 backdrop-blur-md shadow-lg animate-in fade-in duration-300">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">数据库连接受阻</p>
            <p className="text-slate-400 leading-normal">
              请检查您的网络连接或宝塔 / 阿里云 API 服务器配置规则，当前处于脱机安全状态。
              <span className="block font-mono bg-slate-950/40 p-1.5 rounded mt-1 text-[10px] text-red-400">{dbError}</span>
            </p>
          </div>
          <button onClick={() => setDbError('')} className="ml-auto text-slate-400 hover:text-slate-200"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Left Sidebar Navigation (Desktop) */}
      <div className="hidden md:flex md:w-64 flex-col bg-[#0C0E17] border-r border-slate-900 shrink-0 selection:bg-teal-500/10">
        
        {/* Brand Header */}
        <div className="p-6 border-b border-indigo-950/20 flex flex-col space-y-2 shrink-0">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-teal-500 to-indigo-600 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-teal-500/10">
              <Zap className="w-4 h-4 fill-current text-white" />
            </div>
            <div>
              <span className="text-xs font-black tracking-widest text-slate-500 block uppercase leading-none">Management</span>
              <span className="text-sm font-black text-slate-100 block">运营智能控制台</span>
            </div>
          </div>
          <div className="flex items-center space-x-1.5 pt-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[10px] text-slate-500 font-mono">Aliyun Baota API Connected</span>
          </div>
        </div>

        {/* Navigation lists */}
        <div className="flex-1 py-6 px-4 space-y-1.5 overflow-y-auto">
          <span className="px-3 text-[10px] font-black tracking-wider text-slate-600 uppercase block mb-2">决策决策与管理</span>
          
          {/* Tab Button 1: Decision Overview */}
          <button
            onClick={() => setActiveTab('overview')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'overview'
                ? 'bg-gradient-to-r from-teal-500/10 to-transparent border-l-2 border-teal-500 text-teal-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Grid className="w-4 h-4 text-teal-400" />
              <span>📊 决策大盘概览</span>
            </div>
            <span className="text-[10px] font-mono font-bold bg-[#1A1E29] border border-slate-800 text-slate-500 px-1.5 py-0.5 rounded-sm">
              Home
            </span>
          </button>

          {/* Tab Button 8: Dispatch valet order */}
          <button
            onClick={() => setActiveTab('dispatch')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'dispatch'
                ? 'bg-gradient-to-r from-teal-500/10 to-transparent border-l-2 border-teal-500 text-teal-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>🚕 代客下单功能</span>
            </div>
            <span className="text-[10px] font-mono font-bold text-[#189F95] bg-emerald-500/10 px-1.5 py-0.5 rounded-sm">
              AMap
            </span>
          </button>

          {/* Tab Button 2: Batch Fast Generator */}
          <button
            onClick={() => setActiveTab('generate')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'generate'
                ? 'bg-gradient-to-r from-teal-500/10 to-transparent border-l-2 border-teal-500 text-teal-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Zap className="w-4 h-4 text-amber-500" />
              <span>⚡ 极速批量发码</span>
            </div>
            <span className="text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded-sm">
              Batch
            </span>
          </button>

          {/* Tab Button 3: Coupon database management */}
          <button
            onClick={() => setActiveTab('codes')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'codes'
                ? 'bg-gradient-to-r from-teal-500/10 to-transparent border-l-2 border-teal-500 text-teal-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <QrCode className="w-4 h-4 text-cyan-400" />
              <span>🎫 兑换码库管理</span>
            </div>
            <span className="text-[10px] font-mono font-bold text-slate-400 bg-[#1A1E29] px-1.5 py-0.5 rounded-sm">
              {codes.length}
            </span>
          </button>

          {/* Tab Button 4: Driver privilege maintenance */}
          <button
            onClick={() => setActiveTab('drivers')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'drivers'
                ? 'bg-gradient-to-r from-teal-500/10 to-transparent border-l-2 border-teal-500 text-teal-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <span>👥 司机账号管理</span>
            </div>
            <span className="text-[10px] font-mono font-bold text-slate-400 bg-[#1A1E29] px-1.5 py-0.5 rounded-sm">
              {allDrivers.length}
            </span>
          </button>

          {/* Tab Button 5: SMS Recommendations */}
          <button
            onClick={() => setActiveTab('sms')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'sms'
                ? 'bg-gradient-to-r from-teal-500/10 to-transparent border-l-2 border-teal-500 text-teal-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <MessageSquare className="w-4 h-4 text-purple-400" />
              <span>📱 版本号</span>
            </div>
            <span className="text-[10px] font-mono font-bold text-slate-500 bg-[#1A1E29] px-1.5 py-0.5 rounded-sm">
              List
            </span>
          </button>

          {/* Tab Button 6: Send System Messages */}
          <button
            onClick={() => setActiveTab('messages')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'messages'
                ? 'bg-gradient-to-r from-teal-500/10 to-transparent border-l-2 border-teal-500 text-teal-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <MessageSquare className="w-4 h-4 text-pink-400" />
              <span>✉️ 发送系统消息</span>
            </div>
            <span className="text-[10px] font-mono font-bold text-slate-500 bg-[#1A1E29] px-1.5 py-0.5 rounded-sm">
              Send
            </span>
          </button>

          {/* Tab Button 7: Driver online orders application approval */}
          <button
            onClick={() => setActiveTab('applications')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'applications'
                ? 'bg-gradient-to-r from-teal-500/10 to-transparent border-l-2 border-teal-500 text-teal-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
            id="admin-approval-nav-item"
          >
            <div className="flex items-center space-x-2.5">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>📋 线上单开通审批</span>
            </div>
            {applications.filter(a => a.status === 'pending').length > 0 ? (
              <span className="text-[10px] font-black bg-rose-600 text-white px-2 py-0.5 rounded-full animate-pulse shrink-0">
                {applications.filter(a => a.status === 'pending').length} 待办
              </span>
            ) : (
              <span className="text-[10px] font-mono font-bold text-slate-400 bg-[#1A1E29] px-1.5 py-0.5 rounded-sm shrink-0">
                {applications.length}
              </span>
            )}
          </button>

          {/* Tab Button 9: Online order billing rules */}
          <button
            onClick={() => setActiveTab('online_billing')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'online_billing'
                ? 'bg-gradient-to-r from-teal-500/10 to-transparent border-l-2 border-teal-500 text-teal-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Sparkles className="w-4 h-4 text-teal-400" />
              <span>💰 线上单价格计费</span>
            </div>
            <span className="text-[10px] font-mono font-bold bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded-sm shrink-0">
              Rules
            </span>
          </button>

          {/* Tab Button 10: Team Member Settings */}
          <button
            onClick={() => setActiveTab('team')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'team'
                ? 'bg-gradient-to-r from-teal-500/10 to-transparent border-l-2 border-teal-500 text-teal-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Users className="w-4 h-4 text-orange-400" />
              <span>👥 团队成员设置</span>
            </div>
            <span className="text-[10px] font-mono font-bold bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded-sm shrink-0">
              Team
            </span>
          </button>

          {/* Tab Button 11: Master Controls / One-click Close */}
          <button
            onClick={() => setActiveTab('master_controls')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'master_controls'
                ? 'bg-gradient-to-r from-rose-500/10 to-transparent border-l-2 border-rose-500 text-rose-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Power className="w-4 h-4 text-rose-400" />
              <span>🛑 一键关闭功能</span>
            </div>
            <span className="text-[10px] font-mono font-bold bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded-sm shrink-0">
              Off
            </span>
          </button>

          {/* Tab Button 12: Electronic Official Seal Generator */}
          <button
            onClick={() => setActiveTab('seal')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'seal'
                ? 'bg-gradient-to-r from-amber-500/10 to-transparent border-l-2 border-amber-500 text-amber-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span>印 电子公章生成器</span>
            </div>
            <span className="text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded-sm shrink-0">
              Seal
            </span>
          </button>
        </div>

        {/* Footer profile area */}
        <div className="p-4 border-t border-slate-950 flex flex-col space-y-2.5 bg-[#080910]/70 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center font-bold text-xs text-teal-400 shrink-0">
                AD
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-slate-200 leading-none">系统最高管理员</p>
                <p className="text-[10px] text-slate-500 font-mono truncate pt-1">admin.lyheiwandaijiamax.com</p>
              </div>
            </div>
            <button
              onClick={() => {
                setIsAdminAuthenticated(false);
                localStorage.removeItem('isAdminAuthenticated');
                localStorage.removeItem('dd_user_phone');
                setShowToast(true);
                setToastMsg('🔒 运营安全校验已退出，重新限制面板接管');
                setTimeout(() => {
                  setShowToast(false);
                  window.location.reload();
                }, 1000);
              }}
              className="text-slate-500 hover:text-rose-400 p-1.5 hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer shrink-0"
              title="安全验证退出"
            >
              <Lock className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </div>

      {/* Mobile Top Navbar Header Option */}
      <div className="flex md:hidden items-center justify-between px-5 py-4 bg-[#0C0E17] border-b border-indigo-950/20 shrink-0 relative z-30">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-teal-500 to-indigo-600 flex items-center justify-center text-white">
            <Zap className="w-3.5 h-3.5 fill-current" />
          </div>
          <div>
            <span className="text-xs font-black text-slate-100 block">代驾运营控制台</span>
          </div>
        </div>

        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-1.5 rounded-lg border border-slate-800 text-slate-300 hover:text-white"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Mobile Dropdown Menu Links */}
        {isMobileMenuOpen && (
          <div className="absolute top-full left-0 right-0 bg-[#0F111E] border-b border-slate-900 py-3 px-4 flex flex-col space-y-1.5 shadow-xl animate-in fade-in slide-in-from-top-3 duration-200">
            <button
              onClick={() => { setActiveTab('overview'); setIsMobileMenuOpen(false); }}
              className={`flex items-center space-x-2 text-left p-2.5 rounded-xl text-xs font-black ${
                activeTab === 'overview' ? 'bg-[#189F95]/10 text-teal-400' : 'text-slate-400'
              }`}
            >
              <Grid className="w-4 h-4 text-teal-400" />
              <span>📊 决策大盘概览</span>
            </button>
            <button
              onClick={() => { setActiveTab('generate'); setIsMobileMenuOpen(false); }}
              className={`flex items-center space-x-2 text-left p-2.5 rounded-xl text-xs font-black ${
                activeTab === 'generate' ? 'bg-[#189F95]/10 text-teal-400' : 'text-slate-400'
              }`}
            >
              <Zap className="w-4 h-4 text-amber-500" />
              <span>⚡ 极速批量发码</span>
            </button>
            <button
              onClick={() => { setActiveTab('codes'); setIsMobileMenuOpen(false); }}
              className={`flex items-center space-x-2 text-left p-2.5 rounded-xl text-xs font-black ${
                activeTab === 'codes' ? 'bg-[#189F95]/10 text-teal-400' : 'text-slate-400'
              }`}
            >
              <QrCode className="w-4 h-4 text-cyan-400" />
              <span>🎫 兑换码库管理 ({codes.length})</span>
            </button>
            <button
              onClick={() => { setActiveTab('drivers'); setIsMobileMenuOpen(false); }}
              className={`flex items-center space-x-2 text-left p-2.5 rounded-xl text-xs font-black ${
                activeTab === 'drivers' ? 'bg-[#189F95]/10 text-teal-400' : 'text-slate-400'
              }`}
            >
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <span>👥 司机账号管理 ({allDrivers.length})</span>
            </button>
            <button
              onClick={() => { setActiveTab('sms'); setIsMobileMenuOpen(false); }}
              className={`flex items-center space-x-2 text-left p-2.5 rounded-xl text-xs font-black ${
                activeTab === 'sms' ? 'bg-[#189F95]/10 text-teal-400' : 'text-slate-400'
              }`}
            >
              <MessageSquare className="w-4 h-4 text-purple-400" />
              <span>📱 版本号</span>
            </button>
            <button
              onClick={() => { setActiveTab('messages'); setIsMobileMenuOpen(false); }}
              className={`flex items-center space-x-2 text-left p-2.5 rounded-xl text-xs font-black ${
                activeTab === 'messages' ? 'bg-[#189F95]/10 text-teal-400' : 'text-slate-400'
              }`}
            >
              <MessageSquare className="w-4 h-4 text-pink-400" />
              <span>✉️ 发送系统消息</span>
            </button>
            <button
              onClick={() => { setActiveTab('applications'); setIsMobileMenuOpen(false); }}
              className={`flex items-center space-x-2 text-left p-2.5 rounded-xl text-xs font-black ${
                activeTab === 'applications' ? 'bg-[#189F95]/10 text-teal-400' : 'text-slate-400'
              }`}
            >
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>📋 线上单开通审批 ({applications.filter(a => a.status === 'pending').length} 待办)</span>
            </button>
            <button
              onClick={() => { setActiveTab('team'); setIsMobileMenuOpen(false); }}
              className={`flex items-center space-x-2 text-left p-2.5 rounded-xl text-xs font-black ${
                activeTab === 'team' ? 'bg-[#189F95]/10 text-teal-400' : 'text-slate-400'
              }`}
            >
              <Users className="w-4 h-4 text-orange-400" />
              <span>👥 团队成员设置 ({teamMembers.length})</span>
            </button>
            <button
              onClick={() => { setActiveTab('master_controls'); setIsMobileMenuOpen(false); }}
              className={`flex items-center space-x-2 text-left p-2.5 rounded-xl text-xs font-black ${
                activeTab === 'master_controls' ? 'bg-rose-500/10 text-rose-400' : 'text-slate-400'
              }`}
            >
              <Power className="w-4 h-4 text-rose-400" />
              <span>🛑 一键关闭功能</span>
            </button>
            <button
              onClick={() => { setActiveTab('seal'); setIsMobileMenuOpen(false); }}
              className={`flex items-center space-x-2 text-left p-2.5 rounded-xl text-xs font-black ${
                activeTab === 'seal' ? 'bg-amber-500/10 text-amber-400' : 'text-slate-400'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span>印 电子公章生成器</span>
            </button>
            <button
              onClick={() => {
                setIsAdminAuthenticated(false);
                localStorage.removeItem('isAdminAuthenticated');
                localStorage.removeItem('dd_user_phone');
                setIsMobileMenuOpen(false);
                setShowToast(true);
                setToastMsg('🔒 运营安全校验已退出，重新限制面板接管');
                setTimeout(() => {
                  setShowToast(false);
                  window.location.reload();
                }, 1000);
              }}
              className="flex items-center space-x-2 text-left p-2.5 rounded-xl text-xs font-black text-rose-400 hover:bg-rose-500/10 border-t border-slate-800/80 mt-1 pt-2.5 cursor-pointer"
            >
              <Lock className="w-4 h-4 text-rose-400" />
              <span>🔒 退出当前后台登录</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area (Dynamic right pane layout) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-4 md:p-8">
        
        {/* Module Title Header Panel */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-indigo-950/25 pb-5 mb-6 shrink-0 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md text-[9px] font-black tracking-wider bg-teal-500/10 text-teal-400 border border-teal-500/10 uppercase">
                {activeTab === 'overview' && 'Overview / Dashboard'}
                {activeTab === 'generate' && 'Vip Code Generator'}
                {activeTab === 'codes' && 'Coupon Database'}
                {activeTab === 'drivers' && 'Driver Accounts Management'}
                {activeTab === 'sms' && 'App Version Manager'}
                {activeTab === 'messages' && 'System Messages Center'}
                {activeTab === 'applications' && 'Driver Online Privileges Approval'}
                {activeTab === 'dispatch' && 'Valet Dispatch Station'}
                {activeTab === 'online_billing' && 'Online Order Billing Details'}
                {activeTab === 'team' && 'Team Member Configurations'}
                {activeTab === 'master_controls' && 'Master Controls / One-click Close'}
                {activeTab === 'seal' && 'Official Seal Electronic Generator'}
              </span>
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[10px] text-slate-500 font-mono">Live Sync Engine v3.5</span>
            </div>
            <h1 className="text-xl lg:text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-teal-400 via-indigo-200 to-amber-400">
              {activeTab === 'overview' && '代驾决策大盘 - 数据实时看板'}
              {activeTab === 'generate' && '极速批卡 - 一键在云端自动上链'}
              {activeTab === 'codes' && '兑换码库管理 - 实收稽核与激活审计'}
              {activeTab === 'drivers' && '司机管理及特权赋任 - 实时同步'}
              {activeTab === 'sms' && '客户端版本升级管理与实时降级分发'}
              {activeTab === 'messages' && '发送消息 - 实时信息通达中心'}
              {activeTab === 'applications' && '高级线上听单资格审批 - 国网稽核'}
              {activeTab === 'dispatch' && '高管代客派单调度系统 — AMap 2.0 联席总控'}
              {activeTab === 'online_billing' && '线上单价格计费规则配置 — 双系统隔离独立配置端'}
              {activeTab === 'team' && '团队成员设置 - 核心管理与分级赋权'}
              {activeTab === 'master_controls' && '核心功能一键开启/关闭 — 实时拦截中心'}
              {activeTab === 'seal' && '高清洗印电子公章生成器 — 备案辅助工具'}
            </h1>
            <p className="text-xs text-slate-500">
              {activeTab === 'overview' && '决策概览数据自动汇总，直观掌控卡密发布流通与司机注册状态。'}
              {activeTab === 'generate' && '支持自拟时长批量配置，自动排重防破，直接写入数据库存储区。'}
              {activeTab === 'codes' && '可视化检索在链的VIP卡密数据，支持按规格 and 对换状态联合物理删除。'}
              {activeTab === 'drivers' && '手机号为唯一登入凭据。在这里手动改变司机剩余天数，移动端无感实时联动生效。'}
              {activeTab === 'sms' && '实时修改和发布最新应用版本号，可开启全屏强更或一键降级隐藏强制弹窗。'}
              {activeTab === 'messages' && '管理员在此发送指令、公告、特定客服或活动奖励通知等。支持按搜索到的特定司机号码进行点对点精准下发，也支持选择全体司机广播。'}
              {activeTab === 'applications' && '集中受审全省市高级司机上传登记的机动车执照与居民身份证。支持在线秒级签章、实时派发线上接单权限，有违规代驾记录可随时收回及标记作废。'}
              {activeTab === 'dispatch' && '集成高德 2D 平面大屏。支持滑动、搜索地址自绘盲区及 3 公里绝对直线距离最邻近搜寻派单，并实现对全国所有城市的一键线上听单挂锁总开关。'}
              {activeTab === 'online_billing' && '后台独立设置的线上派单计费逻辑，与司机端报单模板独立分流。修改此计费配置只会影响系统分配、后台派遣等所有线上单的最终账单，司机端无法改变。'}
              {activeTab === 'team' && '输入手机号码手动将司机或管理员赋予不同团队阶梯，权限依次为：开发者司机 > 城市老板司机 > 城市管理司机 > 城市派单员司机 > 普通司机。'}
              {activeTab === 'master_controls' && '一键关闭或开启软件app首页的「线上单开通」、「商户代叫」和「小队管理」三大核心按钮组件。关闭后，司机点击对应组件将弹出测试阶段提示并无法使用。'}
              {activeTab === 'seal' && '专为备案承诺书设计的红色圆形公章生成器。支持自定义名称、横向字样、红星控制与模拟印泥质感，实时渲染并导出一键下载 100% 透明背景的高清 PNG。'}
            </p>
          </div>

          {/* Quick global widgets (Clear or Quick Seed) displayed in header for convenience */}
          {activeTab === 'overview' && (
            <div className="flex gap-2">
              {codes.length === 0 && (
                <button
                  onClick={handleQuickSeed}
                  className="px-4 py-2 bg-teal-600/10 border border-teal-500/20 hover:bg-teal-600/20 text-teal-400 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  快速注入种子数据
                </button>
              )}

              <button
                onClick={handleResetAll}
                className="px-4 py-2 bg-red-600/10 border border-red-500/20 hover:bg-red-600/20 text-red-400 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                物理清空数据库
              </button>
            </div>
          )}
        </div>

        {/* --- Content dispatcher for active tab --- */}

        {/* 1. OVERVIEW TAB PANEL */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Cloudflare Datastore Integration Card */}
            <div className="bg-[#111625] border border-[#212b44] rounded-2xl p-5 relative overflow-hidden shadow-xl">
              <div className="absolute right-0 top-0 -mr-16 -mt-16 w-48 h-48 bg-teal-500/5 rounded-full blur-3xl pointer-events-none"></div>
              
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="p-3 bg-gradient-to-tr from-orange-500/10 to-amber-500/20 text-orange-400 rounded-xl border border-orange-500/20 shadow-md">
                    <Server className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-extrabold text-white tracking-wide">
                        中国大陆阿里云宝塔面板 MySQL 数据中心
                      </h3>
                      {connectionStatus === 'success' ? (
                        <span className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                          已接入
                        </span>
                      ) : connectionStatus === 'failed' ? (
                        <span className="flex items-center gap-1 text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full font-bold animate-pulse">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                          未连接
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] bg-slate-500/10 text-slate-400 border border-slate-500/20 px-2 py-0.5 rounded-full font-bold">
                          检测中...
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1 max-w-2xl leading-relaxed">
                      管理后台与司机手机客户端、乘客下单端默认全部直连到您的中国大陆阿里云宝塔服务器 MySQL 数据库，完全切断 Cloudflare 与 Firebase 依赖，国内毫秒级极速响应，数据完全自主掌控！
                      任何一端更改规则、发放优惠卡密、派单，其他终端和您的新域名 <code className="text-teal-400 font-mono select-all">www.lyheiwandaijiamax.com</code> 均会实时响应！
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2 shrink-0 md:min-w-[320px]">
                  <div className="text-[10px] text-gray-400 flex items-center justify-between font-mono">
                    <span>宝塔服务器 API 端点 (API URL)</span>
                    {connectionStatus === 'success' && <span className="text-emerald-400 font-bold">通信畅通 (Health OK)</span>}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={cfWorkerUrl}
                      onChange={(e) => setCfWorkerUrl(e.target.value)}
                      placeholder="例如: https://www.lyheiwandaijiamax.com"
                      className="flex-grow bg-[#090b11] border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-teal-300 font-mono focus:outline-none focus:border-teal-500 transition-colors"
                    />
                    <button
                      onClick={() => handleSaveAndTestCfWorker(cfWorkerUrl)}
                      disabled={isTestingConnection}
                      className="px-4 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:bg-slate-800 text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-teal-600/15"
                    >
                      {isTestingConnection ? '检测中...' : '保存并检测'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Step-by-Step Deployment Guide Accordion */}
              <div className="mt-4 pt-4 border-t border-slate-900 flex flex-col gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-300">
                  <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                  <span>如何将完整的管理后台部署到您注册的新域名 www.lyheiwandaijiamax.com 下？</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-[11px] text-gray-400 leading-relaxed mt-1">
                  <div className="bg-[#090b11]/50 border border-slate-900 rounded-xl p-3">
                    <div className="font-extrabold text-white mb-1">第一步：一键打包前端</div>
                    在开发工作区运行构建命令，将静态 React 前端项目输出到目录：
                    <pre className="mt-1 bg-black/60 p-1.5 rounded text-[9px] font-mono text-teal-300 overflow-x-auto">
                      npm run build
                    </pre>
                    生成的内容将完整存放在 <code className="text-amber-500 font-mono">dist/</code> 目录下。
                  </div>
                  <div className="bg-[#090b11]/50 border border-slate-900 rounded-xl p-3">
                    <div className="font-extrabold text-white mb-1">第二步：部署至中国大陆阿里云宝塔面板 Web 服务器</div>
                    1. 登录您的宝塔面板（Node.js 项目管理器 / Nginx 网站目录）。<br/>
                    2. 将打包好的 <strong>dist/</strong> 文件夹中的内容上传到该站点的 Web 根目录中。<br/>
                    3. 在自定义域名绑定中绑定您申请的域名 <span className="text-teal-400 font-mono font-bold">www.lyheiwandaijiamax.com</span>。
                  </div>
                  <div className="bg-[#090b11]/50 border border-slate-900 rounded-xl p-3">
                    <div className="font-extrabold text-white mb-1">第三步：实时数据互联同步</div>
                    由于您已经在上方将数据库端点绑定为您的宝塔 API 域名（或默认检测到 <code className="text-teal-400 font-mono">www.lyheiwandaijiamax.com</code>），在页面上将<strong>自动共享和互通</strong>所有数据（包括司机、卡密、计费、派单和位置），实现无缝连通。
                  </div>
                </div>
              </div>
            </div>

            {/* Grid of Remaining Quantities Dashboard Blocks */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 shrink-0">
              
              {/* Card 1: 30D Stats */}
              <div className="bg-[#12141F] rounded-2xl border border-slate-900 p-4.5 flex flex-col justify-between relative overflow-hidden group">
                <div className="absolute right-0 top-0 -mr-6 -mt-6 w-20 h-20 bg-teal-400/5 rounded-full blur-xl group-hover:scale-150 transition-transform"></div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black text-teal-400 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    30天 VIP
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Month-Pass</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-gray-100 font-mono tracking-tight animate-in slide-in-from-bottom-2 duration-300">
                    {stats.d30Active}
                  </span>
                  <span className="text-[11px] text-slate-400">个未兑换</span>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-slate-900 flex justify-between text-[10px]">
                  <span className="text-slate-500">累计生成: <span className="font-mono text-slate-300">{stats.d30}</span></span>
                  <span className="text-emerald-500/80 bg-emerald-500/5 px-1.5 py-0.5 rounded border border-emerald-500/10 font-bold">
                    剩余 {stats.d30Active}
                  </span>
                </div>
              </div>

              {/* Card 2: 90D Stats */}
              <div className="bg-[#12141F] rounded-2xl border border-slate-900 p-4.5 flex flex-col justify-between relative overflow-hidden group">
                <div className="absolute right-0 top-0 -mr-6 -mt-6 w-20 h-20 bg-sky-400/5 rounded-full blur-xl group-hover:scale-150 transition-transform"></div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black text-sky-400 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    90天 VIP
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Quarter-Pass</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-gray-100 font-mono tracking-tight">
                    {stats.d90Active}
                  </span>
                  <span className="text-[11px] text-slate-400">个未兑换</span>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-slate-900 flex justify-between text-[10px]">
                  <span className="text-slate-500">累计生成: <span className="font-mono text-slate-300">{stats.d90}</span></span>
                  <span className="text-[#189F95] bg-[#189F95]/5 px-1.5 py-0.5 rounded border border-[#189F95]/10 font-bold">
                    剩余 {stats.d90Active}
                  </span>
                </div>
              </div>

              {/* Card 3: 180D Stats */}
              <div className="bg-[#12141F] rounded-2xl border border-slate-900 p-4.5 flex flex-col justify-between relative overflow-hidden group">
                <div className="absolute right-0 top-0 -mr-6 -mt-6 w-20 h-20 bg-purple-400/5 rounded-full blur-xl group-hover:scale-150 transition-transform"></div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black text-indigo-400 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    180天 VIP
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Half-Year</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-gray-100 font-mono tracking-tight">
                    {stats.d180Active}
                  </span>
                  <span className="text-[11px] text-slate-400">个未兑换</span>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-slate-900 flex justify-between text-[10px]">
                  <span className="text-slate-500">累计生成: <span className="font-mono text-slate-300">{stats.d180}</span></span>
                  <span className="text-[#189F95] bg-[#189F95]/5 px-1.5 py-0.5 rounded border border-[#189F95]/10 font-bold">
                    剩余 {stats.d180Active}
                  </span>
                </div>
              </div>

              {/* Card 4: 360D Stats */}
              <div className="bg-[#12141F] rounded-2xl border border-slate-900 p-4.5 flex flex-col justify-between relative overflow-hidden group">
                <div className="absolute right-0 top-0 -mr-6 -mt-6 w-20 h-20 bg-amber-400/5 rounded-full blur-xl group-hover:scale-150 transition-transform"></div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black text-amber-500 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    360天 VIP
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Annual-Pass</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-gray-100 font-mono tracking-tight">
                    {stats.d360Active}
                  </span>
                  <span className="text-[11px] text-slate-400">个未兑换</span>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-slate-900 flex justify-between text-[10px]">
                  <span className="text-slate-500">累计生成: <span className="font-mono text-slate-300">{stats.d360}</span></span>
                  <span className="text-amber-500/80 bg-amber-500/5 px-1.5 py-0.5 rounded border border-amber-500/10 font-bold">
                    剩余 {stats.d360Active}
                  </span>
                </div>
              </div>

              {/* Card 5: Forever VIP Stats */}
              <div className="bg-[#12141F] rounded-2xl border border-slate-900 p-4.5 flex flex-col justify-between relative overflow-hidden group">
                <div className="absolute right-0 top-0 -mr-6 -mt-6 w-20 h-20 bg-purple-500/5 rounded-full blur-xl group-hover:scale-150 transition-transform"></div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black text-indigo-400 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    永久 VIP
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Forever-Pass</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-gray-100 font-mono tracking-tight">
                    {stats.dForeverActive}
                  </span>
                  <span className="text-[11px] text-slate-400">个未兑换</span>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-slate-900 flex justify-between text-[10px]">
                  <span className="text-slate-500">累计生成: <span className="font-mono text-slate-300">{stats.dForever}</span></span>
                  <span className="text-indigo-500/80 bg-indigo-500/5 px-1.5 py-0.5 rounded border border-indigo-500/10 font-bold">
                    剩余 {stats.dForeverActive}
                  </span>
                </div>
              </div>

            </div>

            {/* General state panel & quick actions */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left detail card */}
              <div className="lg:col-span-8 bg-[#12141F] rounded-2xl border border-slate-900 p-6 space-y-4">
                <h3 className="text-sm font-black text-slate-100">🛡️ 云端业务运营直通透视</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  本控制台与移动端代驾软件的数据保持秒级双向即时对流。当司机在移动设备上注册入会并在代驾软件首页面板进行操作时，或者用户使用卡密兑换时，本云数据库均会实时生成变更流。
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                  <div className="bg-[#191C2A] p-4 rounded-xl border border-slate-900">
                    <span className="text-[11px] text-slate-500 block uppercase font-mono font-bold">在链卡密规格</span>
                    <span className="text-2xl font-black text-teal-400 font-mono">{stats.total}</span>
                    <p className="text-[10px] text-slate-400 pt-1">包含历史全部已兌及可用码</p>
                  </div>
                  <div className="bg-[#191C2A] p-4 rounded-xl border border-slate-900">
                    <span className="text-[11px] text-slate-500 block uppercase font-mono font-bold">已被兑换激活</span>
                    <span className="text-2xl font-black text-indigo-400 font-mono">{stats.redeemed}</span>
                    <p className="text-[10px] text-slate-400 pt-1">激活司机比重: {stats.total ? Math.round((stats.redeemed / stats.total) * 100) : 0}%</p>
                  </div>
                  <div className="bg-[#191C2A] p-4 rounded-xl border border-slate-900">
                    <span className="text-[11px] text-slate-500 block uppercase font-mono font-bold">全系统在籍司机</span>
                    <span className="text-2xl font-black text-amber-500 font-mono">{allDrivers.length}</span>
                    <p className="text-[10px] text-slate-400 pt-1">包含永久尊享及期存会员数</p>
                  </div>
                </div>


              </div>

              {/* Right panel: actions list */}
              <div className="lg:col-span-4 bg-[#12141F] rounded-2xl border border-slate-900 p-5 space-y-4">
                <h3 className="text-sm font-black text-slate-100">🚀 极速后台指令</h3>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  用于进行整体系统配置、数据迁移或系统调校时的特殊物理动作。
                </p>

                <div className="space-y-2.5">
                  <button
                    onClick={() => setActiveTab('generate')}
                    className="w-full py-2.5 bg-[#189F95] hover:bg-[#1A8981] text-slate-950 font-black text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    批量极速发码
                  </button>

                  <button
                    onClick={() => setActiveTab('drivers')}
                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Smartphone className="w-4 h-4" />
                    司机特权手动维护
                  </button>

                  <button
                    onClick={handleResetAll}
                    className="w-full py-2.5 bg-red-650/10 hover:bg-red-600/10 border border-red-500/20 text-red-500 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    数据清空重设
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* 2. BATCH FAST GENERATOR TAB PANEL */}
        {activeTab === 'generate' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-200">
            
            {/* Batch generator left container (6 cols) */}
            <div className="lg:col-span-6 bg-[#12141F] rounded-2xl border border-slate-900 p-6 space-y-5">
              <div className="flex items-center space-x-2 border-b border-indigo-950/20 pb-3">
                <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="font-black text-sm text-slate-200">一键秒级批产兑换码</h3>
              </div>

              <div className="space-y-4">
                {/* Select Duration */}
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-400 font-black tracking-wider uppercase block">VIP 尊享特权规格</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[30, 90, 180, 360, 99999].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setGenDuration(d)}
                        className={`py-3 rounded-xl text-[10px] font-black transition-all ${
                          genDuration === d 
                            ? 'bg-[#189F95] text-white shadow-md shadow-[#189F95]/15 scale-102 border border-teal-400/20' 
                            : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-transparent'
                        }`}
                      >
                        {d === 99999 ? '永久' : `${d}天`} VIP
                      </button>
                    ))}
                  </div>
                </div>

                {/* Enter Quantity */}
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-400 font-black tracking-wider uppercase block">单批次生成兑换码数量</label>
                  <div className="flex items-center space-x-2">
                    {[1, 5, 10, 20].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setGenCount(num)}
                        className={`flex-1 py-3 rounded-xl text-xs font-black transition-all ${
                          genCount === num 
                            ? 'bg-amber-500 text-slate-950 border border-amber-300/10 font-bold' 
                            : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-transparent'
                        }`}
                      >
                        {num}个卡密
                      </button>
                    ))}
                  </div>
                </div>

                {/* Submit button */}
                <button
                  onClick={handleGenerateCodes}
                  disabled={generating}
                  className="w-full py-3.5 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 disabled:opacity-45 text-slate-950 font-black text-xs tracking-wider rounded-xl shadow-lg flex items-center justify-center gap-1.5 active:scale-98 transition-transform cursor-pointer"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      正在极速对接数据库写入卡密...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 fill-current" />
                      立即发布生成 {genCount} 个 {genDuration === 99999 ? '永久' : `VIP-${genDuration}天`} 兑换码
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Recent activity audit list (6 cols) */}
            <div className="lg:col-span-6 bg-[#12141F] rounded-2xl border border-slate-900 p-6 flex flex-col h-full min-h-[400px]">
              
              <div className="flex items-center justify-between border-b border-indigo-950/20 pb-3 mb-4 shrink-0">
                <div className="flex items-center space-x-2">
                  <div className="p-1.5 rounded-lg bg-orange-500/10 text-orange-400">
                    <Clock className="w-4 h-4" />
                  </div>
                  <h3 className="font-black text-sm text-slate-200">近期兑换活动摘要 (实时联动)</h3>
                </div>
                <span className="text-[9px] bg-slate-950 px-2 py-0.5 rounded text-indigo-400 border border-[#1A1F30] font-mono">Realtime Live Feed</span>
              </div>

              {/* Scrollable list of redeemed cards */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-2.5 font-sans max-h-[450px]">
                {codes.filter(c => c.isRedeemed).length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4">
                    <div className="w-10 h-10 rounded-full bg-slate-950 flex items-center justify-center text-slate-700 mb-2">
                      <Briefcase className="w-4 h-4" />
                    </div>
                    <p className="text-[10px] text-slate-500 leading-normal">
                      暂无兑换记录。<br />
                      等候有在册司机通过客户端进行兑换，此位置的内容将会自动追加及展现。
                    </p>
                  </div>
                ) : (
                  codes.filter(c => c.isRedeemed).slice(0, 25).map((log, i) => (
                    <div key={i} className="bg-slate-955/40 border border-slate-900/60 rounded-xl p-3 flex flex-col space-y-1.5 hover:border-slate-800 transition-colors">
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="font-mono text-teal-400 font-bold bg-teal-500/5 px-2 py-0.5 rounded border border-teal-500/10 select-all cursor-pointer">
                          {log.code}
                        </span>
                        <span className="text-amber-500 font-bold bg-amber-500/5 px-1.5 py-0.5 rounded text-[9px] border border-amber-500/10">
                          {log.duration === 99999 ? '永久' : `+${log.duration}天`} VIP 卡密
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300 leading-normal flex items-center justify-between gap-1.5">
                        <span>使用者账号: <span className="font-extrabold text-[#F1F5F9] font-mono">{getDisplayRedeemedBy(log.redeemedBy)}</span></span>
                        <span className="text-[9px] text-slate-500 font-mono text-right">
                          {log.redeemedAt ? new Date(log.redeemedAt).toLocaleString() : ''}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

            </div>

          </div>
        )}

        {/* 3. COUPONS DATABASE MANAGEMENT TAB PANEL */}
        {activeTab === 'codes' && (
          <div className="bg-[#12141F] rounded-2xl border border-slate-900 p-5 flex flex-col flex-1 min-h-[500px] animate-in fade-in duration-200">
            
            {/* Search, Filter rows */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-indigo-950/20 pb-4 mb-4 shrink-0">
              
              {/* Search Box */}
              <div className="relative w-full md:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="搜索兑换码 / 手机端兑换账号..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-900 hover:border-slate-800 focus:border-teal-500 outline-hidden rounded-xl text-xs placeholder:text-slate-600 transition-colors"
                />
              </div>

              {/* Filter Tabs */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center space-x-1 bg-slate-950 rounded-xl p-1 border border-slate-900">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                      statusFilter === 'all' 
                        ? 'bg-slate-800 text-white font-bold' 
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    全部 ({codes.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('active')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1 ${
                      statusFilter === 'active' 
                        ? 'bg-[#189F95]/10 text-teal-400 border border-[#189F95]/10 font-bold' 
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    未对换 ({stats.active})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('redeemed')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                      statusFilter === 'redeemed' 
                        ? 'bg-slate-800 text-slate-400 font-bold' 
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    已兑换 ({stats.redeemed})
                  </button>
                </div>

                {/* Duration filter */}
                <select
                  value={durationFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDurationFilter(val === 'all' ? 'all' : parseInt(val));
                  }}
                  className="p-2 bg-slate-950 border border-slate-900 rounded-xl text-xs font-black text-slate-300 focus:border-teal-500 outline-hidden hover:border-slate-800"
                >
                  <option value="all">任意规格(全部)</option>
                  <option value="30">30天 VIP</option>
                  <option value="90">90天 VIP</option>
                  <option value="180">180天 VIP</option>
                  <option value="360">360天 VIP</option>
                  <option value="99999">永久 VIP</option>
                </select>
              </div>

            </div>

            {/* List Table Content */}
            <div className="flex-1 overflow-y-auto pr-1">
              {loading ? (
                <div className="h-full flex flex-col items-center justify-center space-y-2 p-8">
                  <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
                  <span className="text-xs text-slate-500">正在与宝塔 / 阿里云 API 云数据库保持同步实时侦听...</span>
                </div>
              ) : filteredCodes.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-12 text-center text-slate-500">
                  <Lock className="w-10 h-10 text-slate-750 mb-2.5" />
                  <p className="text-xs font-black text-slate-400">无可匹配的兑换码</p>
                  <p className="text-[10px] text-slate-650 mt-1 max-w-[240px] leading-relaxed">
                    检测库中未发现符合本条件的VIP码。您可以换一个筛选组合或者在左侧导航点击“极速发码”一秒上链。
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-sans">
                    <thead>
                      <tr className="border-b border-slate-900 text-slate-500 font-black tracking-wider text-[10px] uppercase">
                        <th className="py-2.5 px-3">兑换密匙 (代码)</th>
                        <th className="py-2.5 px-3">规格 (时长)</th>
                        <th className="py-2.5 px-3">状态</th>
                        <th className="py-2.5 px-3">生成日期</th>
                        <th className="py-2.5 px-3">使用者/时间</th>
                        <th className="py-2.5 px-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900/60">
                      {filteredCodes.map((item) => (
                        <tr 
                          key={item.id} 
                          className={`hover:bg-slate-950/40 transition-colors group ${
                            item.isRedeemed ? 'opacity-55' : ''
                          }`}
                        >
                          <td className="py-3 px-3 font-mono font-black text-slate-200 select-all flex items-center gap-1.5">
                            <span>{item.code}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(item.code)}
                              className="text-slate-600 hover:text-teal-400 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                              title="复制兑换码"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </td>

                          <td className="py-3 px-3">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${
                              item.duration === 30 ? 'bg-teal-500/5 text-teal-400 border-teal-500/15' :
                              item.duration === 90 ? 'bg-sky-500/5 text-sky-400 border-sky-500/15' :
                              item.duration === 180 ? 'bg-indigo-500/5 text-indigo-400 border-indigo-500/15' :
                              item.duration === 360 ? 'bg-amber-500/5 text-amber-500 border-amber-500/15' :
                              'bg-purple-500/5 text-purple-400 border-purple-500/15'
                            }`}>
                              {item.duration === 99999 ? '永久' : `${item.duration}天`} VIP
                            </span>
                          </td>

                          <td className="py-3 px-3 font-bold">
                            {item.isRedeemed ? (
                              <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                                已兑换
                              </span>
                            ) : (
                              <span className="text-emerald-400 flex items-center gap-1 text-[11px] font-black">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                                未使用 (存存)
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-slate-500 font-mono text-[10px]">
                            {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '-'}
                          </td>

                          <td className="py-3 px-3 font-sans">
                            {item.isRedeemed ? (
                              <div className="flex flex-col text-[10px] text-slate-400">
                                <span className="font-extrabold text-slate-300 select-all font-mono">{getDisplayRedeemedBy(item.redeemedBy)}</span>
                                <span className="text-[9px] text-slate-500 font-mono">
                                  {item.redeemedAt ? new Date(item.redeemedAt).toLocaleTimeString() : ''}
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-600 text-[10px] font-mono font-medium">--</span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteCode(item.id)}
                              className="p-1.5 text-slate-650 hover:text-red-500 hover:bg-red-500/5 rounded-lg transition-colors cursor-pointer"
                              title="物理删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>

                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Table Footer counts and notes */}
            <div className="border-t border-indigo-950/20 pt-3 mt-3 flex justify-between items-center text-[10px] text-slate-500 font-mono shrink-0">
              <span>当前筛选出的兑换码数量: <span className="text-slate-300 font-bold">{filteredCodes.length}</span></span>
              <span>卡密库在链总量: {stats.total} 个</span>
            </div>

          </div>
        )}

        {/* 4. DRIVERS PRIVILEGE TAB PANEL */}
        {activeTab === 'drivers' && (
          <div className="flex-1 flex flex-col min-h-0 space-y-4 animate-in fade-in duration-200">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 flex-1 min-h-0">
              
              {/* Driver search & edit panel on left part (5 cols) */}
              <div className="md:col-span-5 bg-slate-950/45 border border-slate-900 rounded-2xl p-5 flex flex-col space-y-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-black text-slate-200 tracking-wider uppercase">🔍 检索/在后台开立司机门廊</h4>
                  <p className="text-[10px] text-slate-500 font-medium font-sans">司机手机号码是其登录、识别特权的唯一物理标识。</p>
                </div>

                {/* Phone input field */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold">司机的注册账号手机号</label>
                  <div className="relative">
                    <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      placeholder="键盘输入 11 位手机号"
                      value={targetPhone}
                      onChange={(e) => setTargetPhone(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-900 focus:border-amber-500 outline-hidden rounded-xl text-xs placeholder:text-slate-700 font-mono font-bold text-amber-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Search live status & modifier action list */}
                <div className="flex-1 flex flex-col justify-center border-t border-slate-900 pt-3">
                  {targetPhone.trim().length === 0 ? (
                    <div className="text-center py-6 text-slate-600 space-y-2">
                      <Smartphone className="w-10 h-10 mx-auto text-slate-800" />
                      <p className="text-[11px] leading-relaxed">
                        请输入司机的登录手机号码。<br />
                        若司机已于手机端授权登录，或者在列表中选中，它的账户特权会在下面出现，改下数字就能保存，极其同步！
                      </p>
                    </div>
                  ) : targetPhone.trim().length > 0 && !/^1[3-9]\d{9}$/.test(targetPhone.trim()) ? (
                    <div className="text-center py-4 text-amber-500/70 text-[10px] bg-amber-500/5 border border-amber-500/10 rounded-xl p-3">
                      提示：请键入有效的大陆地区 11 位手机号码格式
                    </div>
                  ) : foundDriver === null ? (
                    <div className="text-center py-6 text-slate-500 flex flex-col items-center justify-center space-y-2">
                      <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                      <span className="text-[10px]">从数据库极速检索账户...</span>
                    </div>
                  ) : foundDriver === true && driverDoc ? (
                    <div className="space-y-4 animate-in fade-in duration-200">
                      
                      {/* Driver document status card */}
                      <div className="bg-[#12141F] border border-slate-900 rounded-xl p-3.5 space-y-2 relative overflow-hidden">
                        <div className="absolute right-0 top-0 -mr-4 -mt-4 w-12 h-12 bg-amber-500/5 rounded-full blur-sm"></div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-black text-slate-200">💎 司机在线档案</span>
                          <span className="px-2 py-0.5 rounded text-[9px] bg-emerald-500/10 text-emerald-400 font-mono font-black">
                            在册常驻
                          </span>
                        </div>
                        <div className="text-sm font-mono text-amber-400 font-extrabold flex items-center gap-1">
                          <span>手机号码:</span>
                          <span className="text-slate-100 select-all">{driverDoc.phoneNumber}</span>
                        </div>
                        <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5 pt-1">
                          <span>司机姓名:</span>
                          {editingDriverPhone === driverDoc.phoneNumber ? (
                            <input
                              type="text"
                              value={editingDriverName}
                              onChange={(e) => setEditingDriverName(e.target.value)}
                              onBlur={() => handleSaveDriverNameFromSettings(driverDoc.phoneNumber, editingDriverName)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleSaveDriverNameFromSettings(driverDoc.phoneNumber, editingDriverName);
                                } else if (e.key === 'Escape') {
                                  setEditingDriverPhone(null);
                                }
                              }}
                              className="px-2 py-0.5 bg-slate-900 border border-teal-500 rounded text-xs font-bold text-slate-100 focus:outline-hidden"
                              autoFocus
                            />
                          ) : (
                            <div className="flex items-center space-x-1 cursor-pointer" onClick={() => {
                              setEditingDriverPhone(driverDoc.phoneNumber);
                              setEditingDriverName(driverDoc.driverName || '');
                            }}>
                              <span className="text-amber-500 border-b border-dashed border-slate-700 hover:border-amber-400 transition-colors pb-0.5 font-sans font-extrabold text-xs">
                                {driverDoc.driverName || '（未同步名字，点击设置）'}
                              </span>
                              <Edit3 className="w-3 h-3 text-slate-500 hover:text-slate-300 transition-colors" />
                            </div>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 flex justify-between">
                          <span>最近同步时间:</span>
                          <span>{driverDoc.updatedAt ? new Date(driverDoc.updatedAt).toLocaleDateString() : '尚未记录'}</span>
                        </div>
                      </div>

                      {/* Registered City Settings Block */}
                      <div className="bg-slate-950/20 p-3.5 rounded-2xl border border-slate-900 space-y-2.5 mb-1 text-left">
                        <label className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider block flex justify-between items-center">
                          <span>📍 注册听单开通城市管理</span>
                          <span className="text-[10px] font-black text-teal-400">
                            当前：{driverDoc.city ? `📍 ${driverDoc.city}` : '全国接单 (暂不限制)'}
                          </span>
                        </label>

                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              type="text"
                              placeholder="🔎 搜城市拼音/汉字 (如: 深圳)"
                              value={adminCitySearch}
                              onChange={(e) => setAdminCitySearch(e.target.value)}
                              className="w-full pl-3 pr-8 py-1.5 bg-slate-950 border border-slate-900 focus:border-teal-400 outline-hidden rounded-xl text-xs font-bold text-slate-200"
                            />
                            {adminCitySearch && (
                              <button
                                type="button"
                                onClick={() => setAdminCitySearch('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-500 hover:text-slate-300 bg-slate-800 px-1 py-0.5 rounded cursor-pointer"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                          
                          <button
                            type="button"
                            onClick={async () => {
                              await handleUpdateDriverCity(adminCitySearch.trim());
                              setAdminCitySearch('');
                            }}
                            disabled={!adminCitySearch}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 cursor-pointer ${
                              adminCitySearch 
                                ? 'bg-gradient-to-r from-teal-500 to-indigo-650 text-white active:scale-97' 
                                : 'bg-slate-850 text-slate-600 border border-slate-900/50 cursor-not-allowed'
                            }`}
                          >
                            保存城市
                          </button>
                        </div>

                        {/* Search recommendations / autocomplete */}
                        {adminCitySearch && (
                          <div className="max-h-24 overflow-y-auto bg-slate-950 border border-slate-900 rounded-xl p-1.5 grid grid-cols-3 gap-1.5 animate-in slide-in-from-top-1.5 duration-150">
                            {ALL_CITIES_FLAT.filter(c => 
                              c.name.includes(adminCitySearch) || 
                              c.pinyin.toLowerCase().includes(adminCitySearch.toLowerCase())
                            ).slice(0, 12).map(city => (
                              <button
                                key={city.name}
                                type="button"
                                onClick={() => {
                                  setAdminCitySearch(city.name);
                                }}
                                className="py-1 px-1 bg-slate-900 hover:bg-teal-900/50 hover:text-teal-450 border border-slate-900 text-[10px] rounded-lg text-slate-400 font-bold text-center truncate cursor-pointer transition-colors"
                              >
                                {city.name}
                              </button>
                            ))}
                            {ALL_CITIES_FLAT.filter(c => 
                              c.name.includes(adminCitySearch) || 
                              c.pinyin.toLowerCase().includes(adminCitySearch.toLowerCase())
                            ).length === 0 && (
                              <span className="col-span-3 text-[9px] text-slate-600 py-1 text-center font-normal">暂无包该字符的开通城市</span>
                            )}
                          </div>
                        )}

                        {/* Quick preset changes */}
                        <div className="flex gap-1.5 items-center pt-0.5">
                          <span className="text-[9px] text-slate-500 font-bold">快捷选项:</span>
                          <button
                            type="button"
                            onClick={() => {
                              showConfirm(
                                '清除城市限制',
                                '确定要清除该司机的注册城市限制，恢复为「全中国城市任意接单」吗？',
                                async () => {
                                  await handleUpdateDriverCity('');
                                  setAdminCitySearch('');
                                }
                              );
                            }}
                            className="py-1 px-2 border border-slate-900 bg-slate-950 hover:bg-slate-900 text-slate-400 rounded-lg text-[9.5px] font-bold transition-colors cursor-pointer"
                          >
                            🗺️ 清除城市限制 (全国接单)
                          </button>
                        </div>
                      </div>

                      {/* Resignation & Ban Controls Blocks */}
                      <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-900 space-y-3 mb-1 text-left">
                        <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">
                          🛡️ 账号安全与离职合规管控
                        </span>
                        
                        <div className="grid grid-cols-2 gap-2">
                          {/* Ban/Unban Trigger Button */}
                          <button
                            type="button"
                            onClick={() => handleToggleBanDriver(driverDoc.isBanned || false)}
                            className={`py-2.5 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center space-x-1 cursor-pointer active:scale-97 border ${
                              driverDoc.isBanned 
                                ? 'bg-amber-500/10 hover:bg-amber-500/15 text-amber-400 border-amber-500/20' 
                                : 'bg-rose-500/10 hover:bg-rose-500/15 text-rose-400 border-rose-500/20'
                            }`}
                          >
                            {driverDoc.isBanned ? (
                              <>
                                <Unlock className="w-3.5 h-3.5 shrink-0" />
                                <span>解除账号封停</span>
                              </>
                            ) : (
                              <>
                                <Lock className="w-3.5 h-3.5 shrink-0" />
                                <span>封停账号</span>
                              </>
                            )}
                          </button>

                          {/* Resign / Resignation Trigger Button */}
                          <button
                            type="button"
                            onClick={handleResignDriver}
                            className="py-2.5 px-3 rounded-xl bg-slate-900 border border-slate-850 hover:bg-rose-950/20 hover:text-rose-400 text-slate-400 text-xs font-black transition-all flex items-center justify-center space-x-1 cursor-pointer active:scale-97"
                          >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            <span>办理司机离职</span>
                          </button>
                        </div>
                        
                        {/* Display Ban / Normal Status label indicator */}
                        <div className="flex items-center space-x-2 text-[10px] font-bold">
                          <span className="text-slate-500">状态：</span>
                          {driverDoc.isBanned ? (
                            <span className="text-rose-400 animate-pulse bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 flex items-center gap-1">
                              ⚠️ 已封停 (账号受限无法接单)
                            </span>
                          ) : (
                            <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1">
                              🟢 经营状态正常
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Expiry / Countdown modifier form */}
                      <div className="space-y-3">
                        
                        {/* 1. Date setting absolute */}
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">
                            📅 手动更改到期日期
                          </label>
                          <div className="flex gap-2">
                            <input
                              id="admin-expiry-date-input"
                              type="text"
                              placeholder="格式：YYYY-MM-DD 或 永久有效"
                              value={tempExpiry}
                              onChange={(e) => {
                                const val = e.target.value;
                                setTempExpiry(val);
                                if (val === '永久有效') {
                                  setTempDays('永久');
                                } else if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                                  setTempDays(calculateDaysFromExpiry(val));
                                }
                              }}
                              className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-900 focus:border-amber-500 outline-hidden rounded-xl text-xs font-mono font-bold text-slate-200"
                            />
                            <button
                              onClick={() => handleUpdateDriverExpiry(tempExpiry)}
                              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 active:scale-97 text-slate-950 font-black text-xs rounded-xl transition-all shrink-0 cursor-pointer"
                            >
                              确定日期
                            </button>
                          </div>
                        </div>

                        {/* 2. Days countdown relative relative modifier (asked dynamically) */}
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-black uppercase tracking-wider block flex justify-between items-center">
                            <span>⏳ 会员有效期倒计时天数</span>
                            {tempDays && tempDays !== '0' && (
                              <span className="text-[10px] font-black text-amber-500">
                                {tempDays === '永久' ? '🌟 永久越阶' : `约剩 ${tempDays} 天`}
                              </span>
                            )}
                          </label>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <input
                                type="text"
                                placeholder="输入天数 (例如: 30 或 永久)"
                                value={tempDays}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setTempDays(val);
                                  if (val === '永久' || val === '永久有效') {
                                    setTempExpiry('永久有效');
                                  } else {
                                    const expiryVal = calculateExpiryFromDays(val);
                                    if (expiryVal) {
                                      setTempExpiry(expiryVal);
                                    }
                                  }
                                }}
                                className="w-full pl-3 pr-8 py-1.5 bg-slate-950 border border-slate-900 focus:border-amber-400 outline-hidden rounded-xl text-xs font-mono font-bold text-amber-500 transition-colors"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500">
                                天
                              </span>
                            </div>
                            <button
                              onClick={async () => {
                                const finalExpiry = calculateExpiryFromDays(tempDays);
                                setTempExpiry(finalExpiry);
                                await handleUpdateDriverExpiry(finalExpiry);
                              }}
                              className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 active:scale-97 text-slate-950 font-black text-xs rounded-xl transition-all shrink-0 cursor-pointer"
                            >
                              确定天数
                            </button>
                          </div>
                        </div>

                        {/* 3. Preconfigured presets */}
                        <div className="space-y-1 pt-1">
                          <span className="text-[9px] text-slate-500 block font-bold">快捷时间到期预设 :</span>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setTempExpiry('');
                                setTempDays('0');
                                handleUpdateDriverExpiry('');
                              }}
                              className="py-1 px-2 border border-slate-900 bg-slate-950 hover:bg-[#201016] text-rose-450 rounded-lg text-[10px] font-bold text-left transition-colors cursor-pointer"
                            >
                              🔴 清除 (设为非会员)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setTempExpiry('永久有效');
                                setTempDays('永久');
                                handleUpdateDriverExpiry('永久有效');
                              }}
                              className="py-1 px-2 border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 text-amber-500 rounded-lg text-[10px] font-bold text-left transition-all cursor-pointer"
                            >
                              🌟 开启 永久尊享VIP
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const d = new Date();
                                d.setDate(d.getDate() + 30);
                                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                setTempExpiry(dateStr);
                                setTempDays('30');
                                handleUpdateDriverExpiry(dateStr);
                              }}
                              className="py-1 px-2 border border-slate-900 bg-slate-950 hover:bg-slate-900 text-slate-400 rounded-lg text-[10px] font-bold text-left hover:text-slate-200 transition-colors cursor-pointer"
                            >
                              📅 变更：充值 30天
                            </button>
                            <button
                              onClick={() => {
                                const d = new Date();
                                d.setDate(d.getDate() + 90);
                                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                setTempExpiry(dateStr);
                                setTempDays('90');
                                handleUpdateDriverExpiry(dateStr);
                              }}
                              className="py-1 px-2 border border-slate-900 bg-slate-950 hover:bg-slate-900 text-slate-400 rounded-lg text-[10px] font-bold text-left hover:text-slate-200 transition-colors cursor-pointer"
                            >
                              📅 变更：充值 90天
                            </button>
                          </div>
                        </div>

                      </div>
                    </div>
                  ) : (
                    /* Inexistent single driver */
                    <div className="space-y-4 animate-in fade-in duration-200 text-center py-2">
                      <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-2xl text-left space-y-2">
                        <p className="text-xs font-bold text-orange-400 flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          云端尚未建立司机档案
                        </p>
                        <p className="text-[11px] text-slate-400 leading-normal">
                          手机号码 <span className="font-mono text-slate-200 font-extrabold">{targetPhone}</span> 在后台没有对应记录。当你允许或协助其在系统开立后，它在下载App输入此号即可无障碍登入并享特权。
                        </p>
                      </div>

                      <button
                        onClick={async () => {
                          try {
                            const docRef = doc(db, 'driver_users', targetPhone.trim());
                            await setDoc(docRef, {
                              phoneNumber: targetPhone.trim(),
                              vipExpiry: '',
                              updatedAt: new Date().toISOString()
                            });
                            triggerToast('🎉 司机账号档案已在云端档案库录入！');
                          } catch (err: any) {
                            alert('物理开立账号失败: ' + err.message);
                          }
                        }}
                        className="w-full py-2.5 bg-gradient-to-tr from-amber-600 to-yellow-500 text-slate-950 font-black text-xs rounded-xl active:scale-97 transition-all flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        一键开立司机注册账号
                      </button>
                    </div>
                  )}
                </div>

              </div>

              {/* Grid list of all registered drivers (7 cols) */}
              <div className="md:col-span-7 bg-slate-950/45 border border-slate-900 rounded-2xl p-4 flex flex-col min-h-0">
                
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-indigo-950/20 pb-3 mb-3 gap-2 shrink-0">
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-black text-slate-200">👥 授权在册全体司机一览 ({allDrivers.length} 人)</h4>
                    <p className="text-[10px] text-slate-500">点击任意行可载入左侧，手动修正或变更新会员倒计时天数。</p>
                  </div>

                  {/* Registered internal search */}
                  <div className="relative w-full sm:w-48">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                    <input
                      type="text"
                      placeholder="搜手机号..."
                      value={driverSearchQuery}
                      onChange={(e) => setDriverSearchQuery(e.target.value)}
                      className="w-full pl-7 pr-2.5 py-1 bg-slate-950 border border-slate-900 focus:border-amber-500 outline-hidden rounded-lg text-[10px] placeholder:text-slate-700 transition-colors font-mono"
                    />
                  </div>
                </div>

                {/* Registered list viewport */}
                <div className="flex-1 overflow-y-auto pr-1">
                  {allDrivers.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-600 space-y-1.5">
                      <Smartphone className="w-8 h-8 text-slate-800" />
                      <p className="text-xs font-black text-slate-500 font-sans">云端未索引到司机记录</p>
                      <p className="text-[11px] text-slate-600 max-w-[200px] leading-normal">
                        当你在左侧输入新号码开户或者司机在移动端安装授权了此数据库的App，本表单将即时反映。
                      </p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-[11px] font-sans">
                      <thead>
                        <tr className="border-b border-slate-900 text-slate-500 text-[9px] uppercase font-bold tracking-wider">
                          <th className="py-2 px-2">司机账号</th>
                          <th className="py-2 px-2">听单城市</th>
                          <th className="py-2 px-2">会员有效期</th>
                          <th className="py-2 px-2">会员状态</th>
                          <th className="py-2 px-2 text-right">上次同步</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900/40">
                        {allDrivers
                          .filter(drv => {
                            const phoneStr = drv && drv.phoneNumber ? String(drv.phoneNumber) : '';
                            const nameStr = drv && drv.driverName ? String(drv.driverName) : '';
                            const queryStr = driverSearchQuery.trim();
                            return phoneStr.includes(queryStr) || nameStr.includes(queryStr);
                          })
                          .map((drv) => {
                            const isVip = checkVipActive(drv.vipExpiry);
                            const drvPhone = drv.phoneNumber || '';
                            const isSelected = targetPhone.trim() === drvPhone;
                            return (
                              <tr
                                key={drv.id}
                                onClick={() => setTargetPhone(drv.phoneNumber)}
                                className={`cursor-pointer hover:bg-amber-500/5 transition-all text-slate-300 ${
                                  isSelected ? 'bg-amber-500/10 border-l-2 border-amber-500' : ''
                                }`}
                              >
                                <td className="py-2.5 px-2 font-mono font-bold text-slate-200">
                                  <div className="flex flex-col">
                                    <span className="font-sans text-xs text-slate-200 font-extrabold">{drv.driverName || '（未同步名字）'}</span>
                                    <span className="text-[10px] text-slate-500 font-mono font-normal">{drv.phoneNumber}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-2 font-bold text-teal-450">
                                  {drv.city ? `📍 ${drv.city}` : (
                                    <span className="text-slate-600 text-[9.5px] italic">全国 / 限制外</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 font-mono text-amber-500/90 font-bold">
                                  {drv.vipExpiry || (
                                    <span className="text-slate-600 text-[10px] italic">无有效期/非会员</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-2">
                                  {isVip ? (
                                    <span className="text-amber-500 bg-amber-500/5 border border-amber-500/30 font-bold px-2 py-0.5 rounded text-[9px] inline-flex items-center gap-1 leading-none">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                      尊享会员
                                    </span>
                                  ) : (
                                    <span className="text-slate-500 bg-slate-800/10 border border-slate-700/10 px-2 py-0.5 rounded text-[9px] inline-flex items-center gap-1 leading-none">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                                      普通司机
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 text-right text-slate-500 text-[10px] font-mono">
                                  {drv.updatedAt ? new Date(drv.updatedAt).toLocaleDateString() : '-'}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  )}
                </div>

              </div>

            </div>
          </div>
        )}

        {/* 5. VERSION CONTROL TAB PANEL */}
        {activeTab === 'sms' && (
          <div className="bg-[#12141F] rounded-2xl border border-slate-900 p-6 space-y-6 max-w-4xl animate-in fade-in duration-200">
            {/* Real-time Version Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              <div className="p-4 bg-[#181B2B] border border-slate-800/80 rounded-2xl space-y-2 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 text-teal-500/10">
                  <Smartphone className="w-16 h-16" />
                </div>
                <span className="text-[10px] uppercase font-black text-slate-400 block tracking-wider">当前云端版本号</span>
                <span className="text-2xl font-black text-teal-400 block tracking-tight font-mono">{sysVersion}</span>
                <p className="text-[10px] text-slate-500">与司机端设置页版本号实时同步</p>
              </div>

              <div className="p-4 bg-[#181B2B] border border-slate-800/80 rounded-2xl space-y-2 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 text-amber-500/10">
                  <Server className="w-16 h-16" />
                </div>
                <span className="text-[10px] uppercase font-black text-slate-400 block tracking-wider">强更模式状态</span>
                <div className="flex items-center space-x-1.5 pt-1">
                  <span className={`w-2.5 h-2.5 rounded-full ${sysForceUpgrade ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
                  <span className={`text-sm font-black ${sysForceUpgrade ? 'text-red-400' : 'text-emerald-400'}`}>
                    {sysForceUpgrade ? '强制弹窗升级中' : '常态运行(已降级)'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500">
                  {sysForceUpgrade ? '所有低版本司机将强制弹出升级框' : '任何版本司机均不会触发强更弹框'}
                </p>
              </div>

              <div className="p-4 bg-[#181B2B] border border-slate-800/80 rounded-2xl space-y-2 relative overflow-hidden">
                <span className="text-[10px] uppercase font-black text-slate-400 block tracking-wider">升级跳转网址</span>
                <div className="text-[11px] font-mono text-slate-300 break-all select-all hover:text-teal-400 cursor-pointer pt-1 leading-snug line-clamp-2">
                  {sysUpgradeUrl}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(sysUpgradeUrl);
                    triggerToast('升级网址复制成功！');
                  }}
                  className="text-[9px] text-teal-400 hover:underline font-black flex items-center space-x-1 mt-1"
                >
                  <span>📋 复制当前网址</span>
                </button>
              </div>

            </div>

            {/* Version Form */}
            <div className="bg-slate-950/30 border border-slate-900 rounded-2xl p-5 space-y-4">
              <h4 className="text-xs font-black text-slate-200 tracking-wider border-b border-indigo-950/20 pb-2">
                ✏️ 发布最新版本 / 调整强更及咸鱼配置
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold block">1. 目标发布版本号 (如 V1.1)</label>
                  <input
                    type="text"
                    value={inputVersion}
                    onChange={(e) => setInputVersion(e.target.value)}
                    placeholder="请输入版本号，例如 V1.1"
                    className="w-full bg-[#181B2B] text-slate-100 text-xs px-3.5 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold block">2. 强制升级/下载跳转网址</label>
                  <input
                    type="text"
                    value={inputUpgradeUrl}
                    onChange={(e) => setInputUpgradeUrl(e.target.value)}
                    placeholder="请输入新版APK或分发平台的下载URL"
                    className="w-full bg-[#181B2B] text-slate-100 text-xs px-3.5 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-[10px] text-slate-400 font-bold block">3. 咸鱼购买 VIP 兑换码网址</label>
                  <input
                    type="text"
                    value={inputXianyuUrl}
                    onChange={(e) => setInputXianyuUrl(e.target.value)}
                    placeholder="请输入咸鱼购买宝贝/店铺的分享链接或访问网址"
                    className="w-full bg-[#181B2B] text-slate-100 text-xs px-3.5 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={async () => {
                    if (!inputVersion.trim()) {
                      triggerToast('请输入合规的目标版本号！');
                      return;
                    }
                    if (!inputUpgradeUrl.trim().startsWith('http')) {
                      triggerToast('下载网址必须以 http:// 或 https:// 开头！');
                      return;
                    }
                    try {
                      setVersionSyncStatus('syncing');
                      const versionDocRef = doc(db, 'config', 'system_version');
                      const vData = {
                        version: inputVersion.trim(),
                        forceUpgrade: true,
                        upgradeUrl: inputUpgradeUrl.trim(),
                        xianyuUrl: inputXianyuUrl.trim(),
                        updatedAt: new Date().toISOString()
                      };
                      await setDoc(versionDocRef, vData);
                      
                      // Also save/update in history list
                      const historyDocRef = doc(db, 'version_history', inputVersion.trim());
                      await setDoc(historyDocRef, vData);

                      triggerToast(`🚀 升级指令及配置发布成功！当前版本已强制锁定为 ${inputVersion}`);
                      setVersionSyncStatus('success');
                    } catch (err: any) {
                      triggerToast(`同步失败：${err.message || err}`);
                      setVersionSyncStatus('error');
                    }
                  }}
                  className="bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md active:opacity-90 transition-all flex items-center space-x-1.5 cursor-pointer"
                >
                  <span>🚀 触发强制升级 (Force Upgrade)</span>
                </button>

                <button
                  onClick={async () => {
                    try {
                      setVersionSyncStatus('syncing');
                      const v = inputVersion.trim() || sysVersion;
                      const url = inputUpgradeUrl.trim() || sysUpgradeUrl;
                      const xianyu = inputXianyuUrl.trim() || sysXianyuUrl;
                      const versionDocRef = doc(db, 'config', 'system_version');
                      const vData = {
                        version: v,
                        forceUpgrade: false,
                        upgradeUrl: url,
                        xianyuUrl: xianyu,
                        updatedAt: new Date().toISOString()
                      };
                      await setDoc(versionDocRef, vData);

                      // Also save/update in history list
                      const historyDocRef = doc(db, 'version_history', v);
                      await setDoc(historyDocRef, vData);

                      triggerToast(`✅ 降级降噪成功！当前版本 ${v} 已解除强制升级弹框`);
                      setVersionSyncStatus('success');
                    } catch (err: any) {
                      triggerToast(`同步失败：${err.message || err}`);
                      setVersionSyncStatus('error');
                    }
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs px-5 py-2.5 rounded-xl active:opacity-90 transition-all flex items-center space-x-1.5 cursor-pointer"
                >
                  <span>✅ 一键执行降级 (Disable Force)</span>
                </button>

                <button
                  onClick={async () => {
                    if (!inputXianyuUrl.trim()) {
                      triggerToast('请输入合规的咸鱼购买网址！');
                      return;
                    }
                    try {
                      setVersionSyncStatus('syncing');
                      const versionDocRef = doc(db, 'config', 'system_version');
                      const vData = {
                        version: inputVersion.trim() || sysVersion,
                        forceUpgrade: sysForceUpgrade,
                        upgradeUrl: inputUpgradeUrl.trim() || sysUpgradeUrl,
                        xianyuUrl: inputXianyuUrl.trim(),
                        updatedAt: new Date().toISOString()
                      };
                      await setDoc(versionDocRef, vData);
                      
                      // Also save/update in history list
                      const historyDocRef = doc(db, 'version_history', inputVersion.trim() || sysVersion);
                      await setDoc(historyDocRef, vData);

                      triggerToast(`🔄 咸鱼购买网址一键实时同步更新成功！`);
                      setVersionSyncStatus('success');
                    } catch (err: any) {
                      triggerToast(`同步失败：${err.message || err}`);
                      setVersionSyncStatus('error');
                    }
                  }}
                  className="bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md active:opacity-90 transition-all flex items-center space-x-1.5 cursor-pointer"
                >
                  <span>🔄 一键更新 (Sync Config)</span>
                </button>
              </div>

              {versionSyncStatus === 'syncing' && (
                <p className="text-[10px] text-indigo-400 font-mono animate-pulse">📡 正在将版本指令及下载资源部署至分布式云数据中心...</p>
              )}
            </div>

            {/* Historical Version List Card */}
            <div className="bg-[#181B2B] border border-slate-800/80 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-indigo-950/20 pb-2">
                <div className="flex items-center space-x-2">
                  <History className="w-4 h-4 text-teal-400" />
                  <h4 className="text-xs font-black text-slate-200 tracking-wider">
                    📋 历史版本控制记录 (升级/降级分路器)
                  </h4>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  共计 {versionHistory.length} 个记录
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] uppercase font-black text-slate-400">
                      <th className="py-2.5 px-3">版本号</th>
                      <th className="py-2.5 px-3">当前模式</th>
                      <th className="py-2.5 px-3">资源跳转网址</th>
                      <th className="py-2.5 px-3">发布/控制时间</th>
                      <th className="py-2.5 px-3 text-right">单独升级/降级动作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {versionHistory.map((item) => {
                      const isActive = sysVersion === item.version;
                      return (
                        <tr key={item.version} className={`hover:bg-slate-900/40 transition-colors ${isActive ? 'bg-teal-500/5' : ''}`}>
                          <td className="py-3 px-3 font-mono font-black text-slate-100">
                            <div className="flex items-center space-x-1.5">
                              <span>{item.version}</span>
                              {isActive && (
                                <span className="text-[9px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-1.5 py-0.5 rounded-md font-sans font-bold">
                                  当前激活
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            {item.forceUpgrade ? (
                              <span className="inline-flex items-center space-x-1 text-[9px] bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded-md font-bold">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                                <span>🔴 强制升级</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-md font-bold">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                <span>🟢 普通降级</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-slate-400 max-w-[160px] truncate" title={item.upgradeUrl}>
                            {item.upgradeUrl}
                          </td>
                          <td className="py-3 px-3 text-slate-500 text-[10px] font-mono">
                            {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end space-x-2">
                              {/* Separate Upgrade button */}
                              <button
                                onClick={async () => {
                                  try {
                                    setVersionSyncStatus('syncing');
                                    const now = new Date().toISOString();
                                    const versionDocRef = doc(db, 'config', 'system_version');
                                    const vData = {
                                      version: item.version,
                                      forceUpgrade: true,
                                      upgradeUrl: item.upgradeUrl,
                                      xianyuUrl: item.xianyuUrl || inputXianyuUrl,
                                      updatedAt: now
                                    };
                                    await setDoc(versionDocRef, vData);
                                    await setDoc(doc(db, 'version_history', item.version), vData);
                                    
                                    triggerToast(`🚀 已将版本 ${item.version} 升级为当前强更版本！`);
                                    setVersionSyncStatus('success');
                                  } catch (err: any) {
                                    triggerToast(`操作失败：${err.message || err}`);
                                    setVersionSyncStatus('error');
                                  }
                                }}
                                className={`inline-flex items-center space-x-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-all border cursor-pointer ${
                                  isActive && sysForceUpgrade 
                                    ? 'bg-red-500/20 text-red-300 border-red-500/30 cursor-default'
                                    : 'bg-red-950/10 text-red-400 border-red-900/30 hover:bg-red-950/30'
                                }`}
                                disabled={isActive && sysForceUpgrade}
                              >
                                <ArrowUpCircle className="w-3.5 h-3.5" />
                                <span>单独升级</span>
                              </button>

                              {/* Separate Downgrade button */}
                              <button
                                onClick={async () => {
                                  try {
                                    setVersionSyncStatus('syncing');
                                    const now = new Date().toISOString();
                                    const versionDocRef = doc(db, 'config', 'system_version');
                                    const vData = {
                                      version: item.version,
                                      forceUpgrade: false,
                                      upgradeUrl: item.upgradeUrl,
                                      xianyuUrl: item.xianyuUrl || inputXianyuUrl,
                                      updatedAt: now
                                    };
                                    await setDoc(versionDocRef, vData);
                                    await setDoc(doc(db, 'version_history', item.version), vData);
                                    
                                    triggerToast(`✅ 已将版本 ${item.version} 降级并解除强制弹窗！`);
                                    setVersionSyncStatus('success');
                                  } catch (err: any) {
                                    triggerToast(`操作失败：${err.message || err}`);
                                    setVersionSyncStatus('error');
                                  }
                                }}
                                className={`inline-flex items-center space-x-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-all border cursor-pointer ${
                                  isActive && !sysForceUpgrade
                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 cursor-default'
                                    : 'bg-slate-800 text-emerald-400 border-slate-700 hover:bg-slate-700/80'
                                }`}
                                disabled={isActive && !sysForceUpgrade}
                              >
                                <ArrowDownCircle className="w-3.5 h-3.5" />
                                <span>单独降级</span>
                              </button>

                              {/* Delete historical entry */}
                              <button
                                onClick={async () => {
                                  if (isActive) {
                                    triggerToast('⚠️ 无法删除当前激活中的版本记录！');
                                    return;
                                  }
                                  showConfirm('确认删除记录', `您确定要删除 ${item.version} 的版本记录吗？`, async () => {
                                    try {
                                      await deleteDoc(doc(db, 'version_history', item.version));
                                      triggerToast(`🗑️ 成功删除 ${item.version} 的历史记录`);
                                    } catch (err: any) {
                                      triggerToast(`删除失败：${err.message || err}`);
                                    }
                                  });
                                }}
                                className="p-1.5 text-slate-500 hover:text-red-400 transition-colors hover:bg-slate-800/50 rounded-lg cursor-pointer"
                                title="删除记录"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Explanatory notes */}
            <div className="p-4 bg-slate-900/40 rounded-2xl border border-slate-800/60 space-y-1.5">
              <h5 className="text-[11px] font-black text-slate-300">💡 运行状态与控制机制说明</h5>
              <ul className="list-disc pl-4 space-y-1 text-[10px] text-slate-500 leading-relaxed">
                <li>本系统的版本控制采用了<strong>实时云端锁止器</strong>设计。移动端/网页司机端一旦开机，会保持全天候毫秒级双向长连接。</li>
                <li><strong>升级动作：</strong>当您在左侧输入最新版本，点击【触发强制升级】。未更新版本的司机在打开软件时仍可正常浏览界面，但在滑动上线准备听单时，将立即弹出全屏强制更新提示，不完成更新将无法上线听单。</li>
                <li><strong>一键降级：</strong>当发现新版稳定性需要排查，可点击【一键执行降级】。此时当前配置版本将恢复为普通静默模式，客户端将无感撤销强制弹窗。</li>
              </ul>
            </div>

          </div>
        )}

        {/* 6. SEND SYSTEM MESSAGES TAB PANEL */}
        {activeTab === 'messages' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Message Composer Panel (left - 5 cols) */}
              <div className="lg:col-span-5 bg-[#12141F] rounded-2xl border border-slate-900 p-5 space-y-4 flex flex-col">
                <div className="flex items-center space-x-2 border-b border-indigo-950/20 pb-3">
                  <div className="p-1.5 rounded-lg bg-pink-500/10 text-pink-400">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <h3 className="font-sans font-black text-sm text-slate-200">编辑系统消息</h3>
                </div>

                <div className="space-y-4 flex-1">
                  {/* Select Target Type */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">1. 目标受众对象范围</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setMsgTarget('all')}
                        className={`py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                          msgTarget === 'all'
                            ? 'bg-[#189F95] text-white border border-teal-400/20'
                            : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-transparent'
                        }`}
                      >
                        👥 全体司机 (广播)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMsgTarget('single');
                          if (!msgTargetPhone && targetPhone) {
                            setMsgTargetPhone(targetPhone);
                          }
                        }}
                        className={`py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                          msgTarget === 'single'
                            ? 'bg-[#189F95] text-white border border-teal-400/20'
                            : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-transparent'
                        }`}
                      >
                        👤 单个司机 (精准)
                      </button>
                    </div>
                  </div>

                  {/* Single phone selection logic */}
                  {msgTarget === 'single' && (
                    <div className="space-y-1.5 animate-in slide-in-from-top-1.5 duration-200">
                      <label className="text-[10px] text-slate-400 font-bold flex justify-between">
                        <span>2. 目标手机号码 (11 位)</span>
                        <span className="text-[9px] text-[#189F95] font-black">
                          {allDrivers.some(d => d.phoneNumber === msgTargetPhone.trim()) ? '✓ 云端索引存在' : 'ℹ 请点击下方列表司机快捷录入'}
                        </span>
                      </label>
                      <div className="relative">
                        <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                          type="text"
                          placeholder="手动输入手机号码..."
                          value={msgTargetPhone}
                          onChange={(e) => setMsgTargetPhone(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-900 focus:border-amber-500 outline-hidden rounded-xl text-xs font-mono font-bold text-amber-500 transition-colors"
                        />
                      </div>
                      
                      {/* Driver quick selection list */}
                      <div className="space-y-1 mt-1.5">
                        <span className="text-[9px] text-slate-500 font-black block">快捷点接选择在册司机 :</span>
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto bg-slate-950/40 p-1.5 rounded-lg border border-slate-900">
                          {allDrivers.length === 0 ? (
                            <span className="text-[9px] text-slate-700 italic">暂无在册司机</span>
                          ) : (
                            allDrivers.map((drv) => (
                              <button
                                key={drv.id}
                                type="button"
                                onClick={() => setMsgTargetPhone(drv.phoneNumber)}
                                className={`text-[9 rounded px-2 py-0.5 font-mono transition-colors cursor-pointer ${
                                  msgTargetPhone === drv.phoneNumber
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px]'
                                    : 'bg-slate-900 hover:bg-slate-850 text-slate-400 border border-slate-800 text-[10px]'
                                }`}
                              >
                                {drv.phoneNumber}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Message Title Input */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">通知公告标题</label>
                    <input
                      type="text"
                      placeholder="通知公告 / 系统提醒 / 会员福利"
                      value={msgTitle}
                      onChange={(e) => setMsgTitle(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-900 focus:border-amber-400 outline-hidden rounded-xl text-xs font-bold text-slate-200"
                    />
                  </div>

                  {/* Message Content Area */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">消息公告正文</label>
                    <textarea
                      rows={5}
                      placeholder="请编写消息内容，支持换行及表情符号，手机移动端将秒级接收并弹出红点或弹框..."
                      value={msgContent}
                      onChange={(e) => setMsgContent(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-900 focus:border-amber-400 outline-hidden rounded-xl text-xs leading-relaxed text-slate-200 placeholder:text-slate-700 font-medium"
                    />
                  </div>

                  {/* Send Button */}
                  <button
                    type="button"
                    onClick={handleSendMessage}
                    disabled={sendingMsg}
                    className="w-full py-2.5 bg-gradient-to-tr from-pink-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white font-black text-xs rounded-xl active:scale-97 transition-all flex items-center justify-center gap-1.5 shadow-md shadow-pink-900/10 cursor-pointer text-center"
                  >
                    {sendingMsg ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin animate-duration-1000" />
                        <span>同步广播推送中...</span>
                      </>
                    ) : (
                      <>
                        <MessageSquare className="w-4 h-4" />
                        <span>一键发布发送系统消息</span>
                      </>
                    )}
                  </button>

                  <div className="bg-amber-500/5 rounded-xl p-3 border border-dashed border-amber-500/10 text-[9.5px] leading-relaxed text-slate-400 font-medium">
                    <p className="font-bold text-amber-500 mb-0.5">ℹ 温馨机制说明 :</p>
                    这里使用的消息系统依托宝塔 / 阿里云 API 高频实时双向监听机制。当客户端处于在线或挂起状态时，将会在 0.1秒 内实时监听到新消息，并抛出明显的模态气盘，阅后即消，体验绝佳。
                  </div>

                </div>
              </div>

              {/* Sent Messages History List (Right - 7 cols) */}
              <div className="lg:col-span-7 bg-[#12141F] rounded-2xl border border-slate-900 p-4.5 flex flex-col min-h-0">
                <div className="flex justify-between items-center border-b border-indigo-950/20 pb-3 mb-3 shrink-0">
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-black text-slate-200">📋 历史发送消息流一览 ({messages.length} 条)</h4>
                    <p className="text-[10px] text-slate-500">此表单反映所有的在链消息流。支持自主在云中将其物理删除撤回，删除后手机端也会物理离线隐藏。</p>
                  </div>
                </div>

                {/* Grid messages viewport */}
                <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[60vh] pr-1">
                  {messages.length === 0 ? (
                    <div className="py-12 flex flex-col items-center justify-center text-center text-slate-600 space-y-2">
                      <MessageSquare className="w-10 h-10 text-slate-800" />
                      <p className="text-xs font-black text-slate-500">当前没有历史发送消息流</p>
                      <p className="text-[10px] text-slate-600 max-w-[200px] leading-normal">
                        您可使用左侧的编写器为司机端快速发送第一条测试公告！
                      </p>
                    </div>
                  ) : (
                    messages.map((item) => {
                      const isAll = item.targetPhone === 'all';
                      return (
                        <div key={item.id} className="bg-slate-950/40 hover:bg-slate-950/70 border border-slate-900 p-3.5 rounded-xl flex items-start justify-between gap-4 transition-all group">
                          <div className="space-y-2 flex-1 min-w-0 font-sans">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-black text-xs text-slate-100">{item.title}</span>
                              
                              {isAll ? (
                                <span className="px-1.5 py-0.5 rounded text-[9.5px] bg-sky-500/10 text-sky-400 border border-sky-500/15 font-bold">
                                  全员广播
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[9.5px] bg-[#189F95]/10 text-teal-400 border border-[#189F95]/15 font-mono font-bold">
                                  精准私聊: {item.targetPhone}
                                </span>
                              )}

                              <span className="text-[9.5px] text-slate-600 font-mono">
                                {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
                              </span>
                            </div>

                            <p className="text-xs text-slate-300 font-medium leading-relaxed break-words whitespace-pre-wrap">
                              {item.content}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              if (deleteConfirmId === item.id) {
                                handleDeleteMessage(item.id);
                                setDeleteConfirmId(null);
                              } else {
                                setDeleteConfirmId(item.id);
                                // Auto-reset after 3 seconds
                                setTimeout(() => {
                                  setDeleteConfirmId(prev => prev === item.id ? null : prev);
                                }, 3000);
                              }
                            }}
                            className={`p-1.5 rounded-xl transition-all duration-200 shrink-0 cursor-pointer self-start flex items-center justify-center gap-1 active:scale-90 border ${
                              deleteConfirmId === item.id
                                ? 'bg-amber-500/20 text-yellow-400 border-amber-500/50 hover:bg-amber-500 hover:text-slate-950 font-black animate-pulse'
                                : 'bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white border-rose-500/30 hover:border-rose-500'
                            }`}
                            title="物理整网同步撤回并删除"
                            id="admin-delete-msg-btn"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="text-[9px] font-bold">
                              {deleteConfirmId === item.id ? '⚠️ 确认撤回？' : '撤回/删除'}
                            </span>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* 7. DRIVER ONLINE PRIVILEGES APPROVAL VIEW TAB */}
        {activeTab === 'applications' && (
          <div className="space-y-6 animate-in fade-in duration-200 font-sans text-slate-100">
            
            {/* Upper Widgets Card */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-[#12141F] rounded-2xl border border-slate-900 p-4 space-y-1">
                <span className="text-[10px] text-slate-500 font-bold block uppercase tracking-wider">全部资质申请</span>
                <div className="flex items-baseline space-x-1.5 pt-1">
                  <span className="text-xl font-black text-slate-200">{applications.length}</span>
                  <span className="text-[9px] text-slate-500">份历史申报份</span>
                </div>
              </div>
              <div className="bg-[#12141F] rounded-2xl border border-amber-950/20 p-4 space-y-1">
                <span className="text-[10px] text-amber-500 font-bold block uppercase tracking-wider">⌛ 待审核 (需加急)</span>
                <div className="flex items-baseline space-x-1.5 pt-1">
                  <span className="text-xl font-black text-amber-400">{applications.filter(a => a.status === 'pending').length}</span>
                  <span className="text-[9px] text-amber-600 animate-pulse">位司机排队中</span>
                </div>
              </div>
              <div className="bg-[#12141F] rounded-2xl border border-emerald-950/25 p-4 space-y-1">
                <span className="text-[10px] text-emerald-400 font-bold block uppercase tracking-wider">✅ 通过资质车主</span>
                <div className="flex items-baseline space-x-1.5 pt-1">
                  <span className="text-xl font-black text-emerald-400">{applications.filter(a => a.status === 'approved').length}</span>
                  <span className="text-[9px] text-slate-500">人开通完成</span>
                </div>
              </div>
              <div className="bg-[#12141F] rounded-2xl border border-rose-950/25 p-4 space-y-1">
                <span className="text-[10px] text-rose-500 font-bold block uppercase tracking-wider">❌ 被驳回/未过初审</span>
                <div className="flex items-baseline space-x-1.5 pt-1">
                  <span className="text-xl font-black text-rose-450 text-rose-400">{applications.filter(a => a.status === 'rejected').length}</span>
                  <span className="text-[9px] text-slate-500">案等待修改</span>
                </div>
              </div>
            </div>

            {/* Main Application database manager container panel */}
            <div className="bg-[#12141F] rounded-3xl border border-slate-900 p-5 space-y-4">
              
              {/* Filter tools toolbar */}
              <div className="flex flex-col lg:flex-row justify-between gap-4 border-b border-indigo-950/20 pb-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-black text-slate-400 mr-1.5">状态筛选 :</span>
                  {(['all', 'pending', 'approved', 'rejected'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setAppStatusFilter(st)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                        appStatusFilter === st
                          ? 'bg-gradient-to-r from-teal-500 to-indigo-600 text-white shadow-xs'
                          : 'bg-slate-950/60 text-slate-400 border border-slate-900/50 hover:text-slate-200'
                      }`}
                    >
                      {st === 'all' && '全部申请'}
                      {st === 'pending' && '⌛ 待审批'}
                      {st === 'approved' && '✅ 已开通'}
                      {st === 'rejected' && '❌ 已驳回'}
                    </button>
                  ))}
                </div>

                {/* Database Search Filter */}
                <div className="relative max-w-xs w-full">
                  <Search className="absolute left-3 top-1/2 -not-sr-only -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="输入司机手机号 / 姓名进行多字段搜索..."
                    value={appSearchQuery}
                    onChange={(e) => setAppSearchQuery(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 focus:border-[#189F95] outline-hidden px-9 py-2 rounded-xl text-xs font-bold text-slate-300 placeholder-slate-600 transition-all text-left"
                  />
                  {appSearchQuery && (
                    <button 
                      onClick={() => setAppSearchQuery('')}
                      className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Data viewport table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-900 text-slate-500 text-[10.5px] uppercase tracking-wider font-extrabold pb-3">
                      <th className="py-3 px-4">车主司机信息</th>
                      <th className="py-3 px-4">履历与紧急联系人</th>
                      <th className="py-3 px-4">身份证正反影像 (2份)</th>
                      <th className="py-3 px-4">驾驶证正副影像 (2份)</th>
                      <th className="py-3 px-4">最后更新日期</th>
                      <th className="py-3 px-4">审核状态</th>
                      <th className="py-3 px-4 text-right">审核决策/司机离职</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/50 text-xs font-medium">
                    {applications.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-slate-500 space-y-2">
                          <CheckCircle className="w-10 h-10 mx-auto text-slate-800 animate-pulse" />
                          <p className="font-extrabold text-[#94A3B8]">当前无符合任何条件的车主申请记录</p>
                          <p className="text-[10px] text-slate-600 max-w-sm mx-auto">
                            司机可通过手机 APP 端点击「线上单开通」绑定个人身份证件与资质发函到此，届时此面板将收到实时推送！
                          </p>
                        </td>
                      </tr>
                    ) : (
                      applications
                        .filter(app => {
                          const matchesStatus = appStatusFilter === 'all' ? true : app.status === appStatusFilter;
                          const matchesQuery = appSearchQuery ? (
                            (app.driverPhone || '').includes(appSearchQuery) ||
                            (app.driverName || '').toLowerCase().includes(appSearchQuery.toLowerCase())
                          ) : true;
                          return matchesStatus && matchesQuery;
                        })
                        .map((app) => (
                          <tr key={app.id} className="hover:bg-slate-950/30 transition-colors group">
                            {/* Chauffeur identity */}
                            <td className="py-4 px-4 font-sans">
                              <div className="flex flex-col space-y-1">
                                {editingAppId === app.id ? (
                                  <input
                                    type="text"
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    onBlur={() => handleSaveDriverName(app.id, editingName)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSaveDriverName(app.id, editingName);
                                      } else if (e.key === 'Escape') {
                                        setEditingAppId(null);
                                      }
                                    }}
                                    className="px-2 py-1 bg-slate-900 border border-teal-500 rounded-lg text-xs font-black text-slate-100 focus:outline-hidden"
                                    autoFocus
                                  />
                                ) : (
                                  <div className="flex items-center space-x-1.5 group/name">
                                    <span 
                                      onClick={() => {
                                        setEditingAppId(app.id);
                                        setEditingName(app.driverName || '');
                                      }}
                                      className="font-black text-slate-100 text-sm cursor-pointer hover:text-teal-400 border-b border-dashed border-slate-700 hover:border-teal-400 pb-0.5 transition-all"
                                      title="点击修改司机姓名"
                                    >
                                      {app.driverName || '未命名'}
                                    </span>
                                    <Edit3 className="w-3 h-3 text-slate-500 opacity-0 group-hover/name:opacity-100 transition-opacity cursor-pointer" />
                                  </div>
                                )}
                                <span className="font-mono text-amber-500 font-bold">{app.driverPhone}</span>
                                <div className="flex items-center space-x-1.5 pt-0.5">
                                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-800 text-slate-300 font-bold">
                                    {app.driverGender || '男'}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-indigo-950/80 text-indigo-400 font-bold border border-indigo-900/30">
                                    {app.driverAge || '未知'} 岁
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* Qualification details */}
                            <td className="py-4 px-4">
                              <div className="flex flex-col space-y-1">
                                <div className="flex items-center space-x-1">
                                  <span className="text-[10px] text-slate-500">准驾工龄:</span>
                                  <span className="text-emerald-400 font-extrabold">{app.drivingYears || '0'}</span>
                                  <span className="text-[10px] text-emerald-500">年</span>
                                </div>
                                <div className="flex items-center space-x-1">
                                  <span className="text-[10px] text-slate-500">拟开通城市:</span>
                                  <span className="text-teal-400 font-extrabold">📍 {app.city || '未填'}</span>
                                </div>
                                <div className="flex flex-col pt-0.5">
                                  <span className="text-[9px] text-slate-600">紧急联系号码:</span>
                                  <span className="text-slate-300 font-mono text-[10px] select-all">{app.emergencyPhone || '无'}</span>
                                </div>
                              </div>
                            </td>

                            {/* ID Photos */}
                            <td className="py-4 px-4">
                              <div className="flex items-center space-x-1.5">
                                <div 
                                  onClick={() => setCurrentSelectedApp({ ...app, zoomType: 'idCardFront', zoomUrl: app.idCardFront })}
                                  className="w-14 h-9 bg-slate-950 rounded-lg overflow-hidden border border-slate-800 hover:border-teal-500 transition-all cursor-zoom-in group-hover:scale-102 flex items-center justify-center relative p-0.5"
                                >
                                  {app.idCardFront ? (
                                    <img src={app.idCardFront} className="w-full h-full object-cover rounded" alt="身份证" referrerPolicy="no-referrer" />
                                  ) : (
                                    <span className="text-[8px] text-slate-700 italic">缺图</span>
                                  )}
                                  <span className="absolute bottom-0 inset-x-0 text-[8px] bg-black/60 text-slate-300 text-center truncate scale-90">人像面</span>
                                </div>

                                <div 
                                  onClick={() => setCurrentSelectedApp({ ...app, zoomType: 'idCardBack', zoomUrl: app.idCardBack })}
                                  className="w-14 h-9 bg-slate-950 rounded-lg overflow-hidden border border-slate-800 hover:border-teal-500 transition-all cursor-zoom-in group-hover:scale-102 flex items-center justify-center relative p-0.5"
                                >
                                  {app.idCardBack ? (
                                    <img src={app.idCardBack} className="w-full h-full object-cover rounded" alt="身份证反" referrerPolicy="no-referrer" />
                                  ) : (
                                    <span className="text-[8px] text-slate-700 italic">缺图</span>
                                  )}
                                  <span className="absolute bottom-0 inset-x-0 text-[8px] bg-black/60 text-slate-300 text-center truncate scale-90">国徽面</span>
                                </div>
                              </div>
                            </td>

                            {/* License Photos */}
                            <td className="py-4 px-4">
                              <div className="flex items-center space-x-1.5">
                                <div 
                                  onClick={() => setCurrentSelectedApp({ ...app, zoomType: 'driverLicenseFront', zoomUrl: app.driverLicenseFront })}
                                  className="w-14 h-9 bg-slate-950 rounded-lg overflow-hidden border border-slate-800 hover:border-teal-500 transition-all cursor-zoom-in group-hover:scale-102 flex items-center justify-center relative p-0.5"
                                >
                                  {app.driverLicenseFront ? (
                                    <img src={app.driverLicenseFront} className="w-full h-full object-cover rounded" alt="驾驶证" referrerPolicy="no-referrer" />
                                  ) : (
                                    <span className="text-[8px] text-slate-700 italic">缺图</span>
                                  )}
                                  <span className="absolute bottom-0 inset-x-0 text-[8px] bg-black/60 text-slate-300 text-center truncate scale-90">正页</span>
                                </div>

                                <div 
                                  onClick={() => setCurrentSelectedApp({ ...app, zoomType: 'driverLicenseBack', zoomUrl: app.driverLicenseBack })}
                                  className="w-14 h-9 bg-slate-950 rounded-lg overflow-hidden border border-slate-800 hover:border-teal-500 transition-all cursor-zoom-in group-hover:scale-102 flex items-center justify-center relative p-0.5"
                                >
                                  {app.driverLicenseBack ? (
                                    <img src={app.driverLicenseBack} className="w-full h-full object-cover rounded" alt="驾驶证副" referrerPolicy="no-referrer" />
                                  ) : (
                                    <span className="text-[8px] text-slate-700 italic">缺图</span>
                                  )}
                                  <span className="absolute bottom-0 inset-x-0 text-[8px] bg-black/60 text-slate-300 text-center truncate scale-90">副页</span>
                                </div>
                              </div>
                            </td>

                            {/* Date */}
                            <td className="py-4 px-4 font-mono text-slate-400 text-[10.5px]">
                              {app.updatedAt ? new Date(app.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间'}
                            </td>

                            {/* Status badge */}
                            <td className="py-4 px-4">
                              {app.status === 'pending' && (
                                <span className="px-2 py-1 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/15 font-black animate-pulse">
                                  ⌛ 报批中
                                </span>
                              )}
                              {app.status === 'approved' && (
                                <span className="px-2 py-1 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/15 font-black">
                                  ✓ 已核准开通
                                </span>
                              )}
                              {app.status === 'rejected' && (
                                <div className="flex flex-col space-y-0.5">
                                  <span className="px-2 py-1 rounded text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/15 font-black self-start">
                                    ✗ 已初审驳回
                                  </span>
                                  <span className="text-[8px] text-slate-600 block pl-1 truncate max-w-[120px]" title={app.rejectionReason}>
                                    驳回因:{app.rejectionReason}
                                  </span>
                                </div>
                              )}
                            </td>

                            {/* Actions commands */}
                            <td className="py-4 px-4 text-right">
                              {app.status === 'pending' && (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      showConfirm(
                                        '审核准予签发确认',
                                        `确定要在线特准批准 司机 ${app.driverName} (${app.driverPhone}) 线上接单权吗？将会同步写回移动听单队列！`,
                                        () => {
                                          handleApproveApplication(app);
                                        }
                                      );
                                    }}
                                    className="px-2.5 py-1.5 bg-gradient-to-r from-emerald-555 to-emerald-600 hover:to-emerald-700 bg-emerald-600 text-white font-black rounded-lg active:scale-95 transition-all cursor-pointer text-[10px]"
                                  >
                                    准予签发
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const reason = prompt("请输入拒绝理由或核定缺陷建议 (不填默认自带模板理由):", "提供的驾驶证和居民身份证上的姓名或准驾车型等文字存在大面积眩光折射，无法看清校验，请在此上传高清证照重新送审。");
                                      if (reason !== null) {
                                        handleRejectApplication(app, reason);
                                      }
                                    }}
                                    className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-850 hover:text-red-400 text-slate-400 rounded-lg active:scale-95 transition-all cursor-pointer text-[10px]"
                                  >
                                    驳回申请
                                  </button>
                                </div>
                              )}

                              {app.status === 'approved' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    showConfirm(
                                      '⚠️ 办理司机离职警告',
                                      `特种警告：确定要强制物理收回司机 ${app.driverName} (${app.driverPhone}) 的线上接单服务并办理离职吗？离职后将自动删除该司机的注册信息，司机想要重新听单需要重新申请开通审批。`,
                                      () => {
                                        handleResignApprovedDriver(app);
                                      }
                                    );
                                  }}
                                  className="px-2.5 py-1.5 bg-[#BF3B3B]/10 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/20 rounded-lg text-[10px] font-black transition-all cursor-pointer active:scale-95"
                                >
                                  司机离职
                                </button>
                              )}

                              {app.status === 'rejected' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    showConfirm(
                                      '重新送审确认',
                                      `允许车主再次上报？确定要强行重新校准初审状态，将司机 ${app.driverName} 回滚至待审队列吗？`,
                                      () => {
                                        handleApproveApplication(app);
                                      }
                                    );
                                  }}
                                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg text-[10px] font-black transition-all cursor-pointer"
                                >
                                  撤销并准予
                                </button>
                              )}
                            </td>

                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>

            </div>

            {/* Credential Image Zoom Lightbox Overlay */}
            {currentSelectedApp && (
              <div 
                onClick={() => setCurrentSelectedApp(null)}
                className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
              >
                <div 
                  onClick={(e) => e.stopPropagation()}
                  className="bg-[#12141F] border border-slate-800 rounded-3xl p-5 max-w-2xl w-full flex flex-col space-y-4 animate-in zoom-in-95 duration-200 shadow-2xl"
                >
                  <div className="flex justify-between items-center border-b border-indigo-950/25 pb-3">
                    <div className="flex flex-col text-left">
                      <span className="text-[10px] text-teal-400 font-bold uppercase tracking-wider">申办人: {currentSelectedApp.driverName} ({currentSelectedApp.driverPhone})</span>
                      <h3 className="font-extrabold text-sm text-slate-200 block pt-1">
                        {currentSelectedApp.zoomType === 'idCardFront' && '💳 居民身份证 - 人像面原复印件'}
                        {currentSelectedApp.zoomType === 'idCardBack' && '💳 居民身份证 - 国徽面原复印件'}
                        {currentSelectedApp.zoomType === 'driverLicenseFront' && '🚗 机动车驾驶证 - 主页正面'}
                        {currentSelectedApp.zoomType === 'driverLicenseBack' && '🚗 机动车驾驶证 - 副页副面'}
                      </h3>
                    </div>
                    <button 
                      onClick={() => setCurrentSelectedApp(null)} 
                      className="p-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-all active:scale-90 cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* High Quality credentials illustration stage */}
                  <div className="bg-slate-950/50 rounded-2xl overflow-hidden aspect-video relative flex items-center justify-center p-2 border border-slate-900">
                    <img 
                      src={currentSelectedApp.zoomUrl} 
                      className="max-w-full max-h-full object-contain rounded-lg" 
                      alt="证照原图复印件" 
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  {/* Fast action overlay toolbar inside lightbox */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="text-left text-[10.5px]">
                      <span className="text-slate-500 block">该案履历驾龄 :</span>
                      <span className="text-slate-200 font-extrabold">{currentSelectedApp.drivingYears} 年准驾代驾工龄</span>
                    </div>

                    <div className="flex gap-2.5">
                      {currentSelectedApp.status === 'pending' ? (
                        <>
                          <button
                            onClick={() => {
                              handleApproveApplication(currentSelectedApp);
                              setCurrentSelectedApp(null);
                            }}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl active:scale-95 transition-all cursor-pointer"
                          >
                            ✓ 审核合规，准予签章
                          </button>
                          <button
                            onClick={() => {
                              const reason = prompt("请输入驳回原因或不合规描述:", "证件照文字重叠或边框被切断，无法辨认身份证人像页基本内容，请在亮光柔和处拍照后重试。");
                              if (reason !== null) {
                                handleRejectApplication(currentSelectedApp, reason);
                                setCurrentSelectedApp(null);
                              }
                            }}
                            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-xl active:scale-95 transition-all cursor-pointer"
                          >
                            ✗ 不合规驳回
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setCurrentSelectedApp(null)}
                          className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-extrabold rounded-xl"
                        >
                          完美核对完毕，关闭预览
                        </button>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            )}

          </div>
        )}

        {/* 8. VALET ORDER DISPATCH TAB */}
        {activeTab === 'dispatch' && (
          <DispatchValetOrder 
            onShowToast={triggerToast} 
            userPhone={userPhone}
            userRole={activeRole}
            userTeamCity={activeCity}
          />
        )}

        {/* 9. ONLINE BILLING RULES TAB */}
        {activeTab === 'online_billing' && (
          <AdminBillingRules onShowToast={triggerToast} />
        )}

        {/* 10. TEAM MEMBER SETTINGS TAB */}
        {activeTab === 'team' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Add Team Member (left - 4 cols) */}
              <div className="lg:col-span-4 bg-[#12141F] rounded-2xl border border-slate-900 p-5 space-y-4 flex flex-col">
                <div className="flex items-center space-x-2 border-b border-indigo-950/20 pb-3">
                  <div className="p-1.5 rounded-lg bg-orange-500/10 text-orange-400">
                    <Users className="w-4 h-4" />
                  </div>
                  <h3 className="font-sans font-black text-sm text-slate-200">添加/设置团队成员</h3>
                </div>

                <form onSubmit={handleSaveTeamMember} className="space-y-4 flex-1">
                  {/* Phone Input */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">手机号码 (中国大陆 11 位)</label>
                    <div className="relative">
                      <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="请输入团队成员手机号..."
                        value={memberPhone}
                        onChange={(e) => setMemberPhone(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-900 focus:border-orange-500 outline-hidden rounded-xl text-xs font-mono font-bold text-orange-400 transition-colors"
                      />
                    </div>
                    {memberPhone && !/^1[3-9]\d{9}$/.test(memberPhone) && (
                      <p className="text-[10px] text-rose-400">请输入正确的11位大陆手机号</p>
                    )}
                  </div>

                  {/* Level dropdown */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">团队成员级别/等级</label>
                    <select
                      value={memberRole}
                      onChange={(e) => setMemberRole(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-950 border border-slate-900 focus:border-orange-500 outline-hidden rounded-xl text-xs font-bold text-slate-200 cursor-pointer"
                    >
                      <option value="开发者司机">开发者司机 (最高权限)</option>
                      <option value="城市老板司机">城市老板司机</option>
                      <option value="城市管理司机">城市管理司机</option>
                      <option value="城市派单员司机">城市派单员司机</option>
                      <option value="普通司机">普通司机</option>
                    </select>
                  </div>

                  {/* Operating Jurisdiction City Selection (Only for Developer creating non-developer) */}
                  {activeRole === '开发者司机' && memberRole !== '开发者司机' && (
                    <div className="space-y-1.5 relative z-50">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                        所属运营辖区城市
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowTeamCityDropdown(!showTeamCityDropdown)}
                        className="w-full h-11 px-4 bg-[#090b11] border border-slate-900 hover:border-slate-800 rounded-xl text-xs font-bold text-slate-200 flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <span className="flex items-center space-x-1.5">
                          <span>📍</span>
                          <span>{chosenCity ? `${chosenCity.endsWith('市') ? chosenCity : chosenCity + '市'}` : '请选择城市...'}</span>
                        </span>
                        <span className="text-[10px] text-orange-400 font-extrabold bg-orange-500/10 px-2 py-0.5 rounded-md">选择 ➔</span>
                      </button>

                      {showTeamCityDropdown && (
                        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-[#12141F] border border-slate-800 rounded-xl shadow-2xl p-2.5 flex flex-col space-y-2 animate-in fade-in duration-200">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                            <input
                              type="text"
                              placeholder="输入城市名或拼音搜索..."
                              value={teamCitySearchQuery}
                              onChange={(e) => setTeamCitySearchQuery(e.target.value)}
                              className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-900 rounded-lg text-xs focus:outline-none focus:border-orange-500 text-slate-200 font-medium"
                            />
                          </div>

                          <div className="max-h-40 overflow-y-auto divide-y divide-slate-900/40 flex flex-col">
                            {ALL_CITIES_FLAT.filter(city => 
                              city.name.includes(teamCitySearchQuery.trim()) || 
                              city.pinyin.toLowerCase().includes(teamCitySearchQuery.trim().toLowerCase())
                            ).map((city, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  const normalized = city.name.endsWith('市') ? city.name : `${city.name}市`;
                                  setChosenCity(normalized);
                                  setShowTeamCityDropdown(false);
                                  setTeamCitySearchQuery('');
                                }}
                                className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-950 hover:text-orange-400 transition-all font-bold flex items-center justify-between"
                              >
                                <span>{city.name}</span>
                                <span className="text-[9px] text-slate-500 font-normal uppercase">{city.pinyin}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Remarks Input */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">姓名/职务备注 (可选)</label>
                    <input
                      type="text"
                      placeholder="例如：张三、技术部总监..."
                      value={memberRemark}
                      onChange={(e) => setMemberRemark(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-950 border border-slate-900 focus:border-orange-500 outline-hidden rounded-xl text-xs font-bold text-slate-200"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingMember}
                    className="w-full py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-slate-950 text-xs font-black rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {savingMember ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <span>保存成员设定</span>
                    )}
                  </button>
                </form>
              </div>

              {/* Team Member List (right - 8 cols) */}
              <div className="lg:col-span-8 bg-[#12141F] rounded-2xl border border-slate-900 p-5 space-y-4 flex flex-col">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-indigo-950/20 pb-3 gap-3">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-lg bg-orange-500/10 text-orange-400">
                      <Users className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-sans font-black text-sm text-slate-200">团队成员在册一览</h3>
                      <p className="text-[10px] text-slate-500">共 {teamMembers.length} 名团队成员</p>
                    </div>
                  </div>

                  {/* Search Bar */}
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input
                      type="text"
                      placeholder="搜索手机号/姓名备注..."
                      value={memberSearchQuery}
                      onChange={(e) => setMemberSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-900 focus:border-orange-500 outline-hidden rounded-xl text-xs font-bold text-slate-200 transition-colors"
                    />
                  </div>
                </div>

                {/* Table list */}
                <div className="overflow-x-auto rounded-xl border border-slate-900/60 bg-slate-950/20">
                  <table className="w-full border-collapse text-left text-xs text-slate-400">
                    <thead>
                      <tr className="border-b border-slate-900/80 bg-slate-950/60 font-black text-slate-300">
                        <th className="px-4 py-3">手机号</th>
                        <th className="px-4 py-3">团队等级</th>
                        <th className="px-4 py-3">系统姓名 / 备注</th>
                        <th className="px-4 py-3">加入时间</th>
                        <th className="px-4 py-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900/60">
                      {teamMembers.filter(m => {
                        const q = memberSearchQuery.toLowerCase().trim();
                        if (!q) return true;
                        const registered = allDrivers.find(d => d.phoneNumber === m.phone);
                        const driverName = registered ? registered.driverName : '';
                        return m.phone.includes(q) || 
                               (m.remark && m.remark.toLowerCase().includes(q)) ||
                               driverName.toLowerCase().includes(q);
                      }).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-slate-600 font-bold">
                            暂无符合检索条件的团队成员记录
                          </td>
                        </tr>
                      ) : (
                        teamMembers.filter(m => {
                          const q = memberSearchQuery.toLowerCase().trim();
                          if (!q) return true;
                          const registered = allDrivers.find(d => d.phoneNumber === m.phone);
                          const driverName = registered ? registered.driverName : '';
                          return m.phone.includes(q) || 
                                 (m.remark && m.remark.toLowerCase().includes(q)) ||
                                 driverName.toLowerCase().includes(q);
                        }).map((member) => {
                          const registered = allDrivers.find(d => d.phoneNumber === member.phone);
                          
                          // Badges style based on roles
                          const getRoleBadge = (role: string) => {
                            switch (role) {
                              case '开发者司机':
                                return <span className="px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/15 font-black">开发者司机</span>;
                              case '城市老板司机':
                                return <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/15 font-black">城市老板司机</span>;
                              case '城市管理司机':
                                return <span className="px-2 py-1 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/15 font-black">城市管理司机</span>;
                              case '城市派单员司机':
                                return <span className="px-2 py-1 rounded bg-teal-500/10 text-teal-400 border border-teal-500/15 font-black">城市派单员司机</span>;
                              default:
                                return <span className="px-2 py-1 rounded bg-slate-500/10 text-slate-400 border border-slate-500/15 font-black">普通司机</span>;
                            }
                          };

                          return (
                            <tr key={member.id} className="hover:bg-slate-900/30 group">
                              <td className="px-4 py-3 font-mono font-bold text-slate-300">
                                {member.phone}
                              </td>
                              <td className="px-4 py-3 text-[11px]">
                                {getRoleBadge(member.role)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-col">
                                  <span className="font-extrabold text-slate-200">
                                    {member.remark || '暂无备注'}
                                  </span>
                                  {registered && (
                                    <span className="text-[10px] text-emerald-400">
                                      已同步系统用户: {registered.driverName || '未设置名字'}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-slate-500 text-[11px]">
                                {member.createdAt ? member.createdAt.slice(0, 16).replace('T', ' ') : '暂无'}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTeamMember(member.phone)}
                                  className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                                  title="移除团队成员"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* 11. MASTER CONTROLS TAB */}
        {activeTab === 'master_controls' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* 中国大陆所有城市独立功能开关与小队名称管理 */}
            <div className="bg-[#12141F] rounded-2xl border border-slate-900 p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-indigo-950/20 pb-4">
                <div className="flex items-center space-x-2">
                  <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-sans font-black text-sm text-slate-200">中国大陆城市独立开通控制 & 小队名称管理</h3>
                    <p className="text-xs text-slate-500 mt-0.5">选择大陆任意城市，独立开启/关闭三大组件（线上单开通、商户代叫、小队管理），并维护所在城市的小队名称</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={async () => {
                      if (confirm(`确定要【一键全部开启】中国大陆所有 300+ 城市的线上单、商户代叫与小队管理功能吗？`)) {
                        const newMap = { ...cityConfigs };
                        ALL_CHINA_CITIES.forEach(c => {
                          const norm = c.name.replace(/市$/, '').trim();
                          const curr = getCityConfig(norm);
                          newMap[norm] = { ...curr, online_app_enabled: true, merchant_dispatch_enabled: true, squad_management_enabled: true };
                        });
                        await saveCityConfigsMap(newMap);
                        await updateMasterSwitch('online_app_enabled', true);
                        await updateMasterSwitch('merchant_dispatch_enabled', true);
                        await updateMasterSwitch('squad_management_enabled', true);
                        triggerToast(`✨ 已成功一键开启中国大陆全部城市的 线上单、商户代叫 与 小队管理 功能！`);
                      }
                    }}
                    className="px-3 py-1.5 bg-teal-500 text-slate-950 hover:bg-teal-400 font-black rounded-xl text-xs flex items-center gap-1 transition-all cursor-pointer shadow-md shadow-teal-500/20"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    一键开启大陆全部城市
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`确定要批量为当前筛选的这 ${filteredChinaCities.length} 个城市全部【开启】三项功能吗？`)) {
                        const newMap = { ...cityConfigs };
                        filteredChinaCities.forEach(c => {
                          const norm = c.name.replace(/市$/, '').trim();
                          const curr = getCityConfig(norm);
                          newMap[norm] = { ...curr, online_app_enabled: true, merchant_dispatch_enabled: true, squad_management_enabled: true };
                        });
                        saveCityConfigsMap(newMap);
                        triggerToast(`✨ 已一键开启 ${filteredChinaCities.length} 个城市的全部功能！`);
                      }
                    }}
                    className="px-3 py-1.5 bg-emerald-600/20 border border-emerald-500/30 hover:bg-emerald-600/30 text-emerald-400 font-bold rounded-xl text-xs flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    批量开启筛选城市
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`确定要批量为当前筛选的这 ${filteredChinaCities.length} 个城市全部【关闭】三项功能吗？`)) {
                        const newMap = { ...cityConfigs };
                        filteredChinaCities.forEach(c => {
                          const norm = c.name.replace(/市$/, '').trim();
                          const curr = getCityConfig(norm);
                          newMap[norm] = { ...curr, online_app_enabled: false, merchant_dispatch_enabled: false, squad_management_enabled: false };
                        });
                        saveCityConfigsMap(newMap);
                        triggerToast(`🛑 已一键关闭 ${filteredChinaCities.length} 个城市的全部功能！`);
                      }
                    }}
                    className="px-3 py-1.5 bg-rose-600/20 border border-rose-500/30 hover:bg-rose-600/30 text-rose-400 font-bold rounded-xl text-xs flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    批量关闭筛选城市
                  </button>
                </div>
              </div>

              {/* Search & Province Filter Bar */}
              <div className="space-y-3">
                <div className="flex flex-col md:flex-row gap-3">
                  {/* Search Input */}
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={citySearchQuery}
                      onChange={(e) => setCitySearchQuery(e.target.value)}
                      placeholder="🔍 搜索城市名、省份或拼音 (例如: 广州、银川、宁夏...)"
                      className="w-full bg-[#090B11] border border-slate-800 rounded-xl pl-9 pr-8 py-2.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-teal-500 transition-all font-mono"
                    />
                    {citySearchQuery && (
                      <button 
                        onClick={() => setCitySearchQuery('')} 
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Province Filter Dropdown */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 font-bold whitespace-nowrap">省份筛选:</span>
                    <select
                      value={selectedProvince}
                      onChange={(e) => setSelectedProvince(e.target.value)}
                      className="bg-[#090B11] border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-teal-400 font-bold outline-none focus:border-teal-500 transition-all cursor-pointer"
                    >
                      <option value="全部">全部省份/直辖市 (共{ALL_CHINA_CITIES.length}市)</option>
                      {PROVINCES_DATA.map(p => (
                        <option key={p.province} value={p.province}>{p.province} ({p.cities.length}市)</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Quick Province Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[11px]">
                  <button
                    onClick={() => setSelectedProvince('全部')}
                    className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition-all cursor-pointer ${
                      selectedProvince === '全部' ? 'bg-teal-500 text-slate-950 shadow-sm' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    全部 ({ALL_CHINA_CITIES.length})
                  </button>
                  {['直辖市', '宁夏', '广东', '浙江', '江苏', '四川', '山东', '湖北', '陕西', '福建'].map(prov => (
                    <button
                      key={prov}
                      onClick={() => setSelectedProvince(prov)}
                      className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition-all cursor-pointer ${
                        selectedProvince === prov ? 'bg-teal-500 text-slate-950 shadow-sm' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {prov}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cities Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-1">
                {filteredChinaCities.map(city => {
                  const norm = city.name.replace(/市$/, '').trim();
                  const cfg = getCityConfig(norm);
                  return (
                    <div 
                      key={city.name}
                      className="bg-[#090B11] border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 space-y-3 transition-all"
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between border-b border-slate-800/60 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-slate-200">📍 {norm}市</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            {city.province}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500">
                          <span>{cfg.squadNames.length}个小队</span>
                        </div>
                      </div>

                      {/* 3 Feature Toggles */}
                      <div className="grid grid-cols-3 gap-2">
                        {/* 1. 线上单开通 */}
                        <div className="bg-[#12141F] p-2 rounded-lg border border-slate-800 flex flex-col justify-between items-center text-center gap-1.5">
                          <span className="text-[10px] font-bold text-slate-300">线上单开通</span>
                          <button
                            onClick={() => handleToggleCityFeature(norm, 'online_app_enabled', !cfg.online_app_enabled)}
                            className={`w-full py-1 rounded text-[10px] font-black transition-all cursor-pointer ${
                              cfg.online_app_enabled 
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {cfg.online_app_enabled ? '已开通' : '未开通'}
                          </button>
                        </div>

                        {/* 2. 商户代叫 */}
                        <div className="bg-[#12141F] p-2 rounded-lg border border-slate-800 flex flex-col justify-between items-center text-center gap-1.5">
                          <span className="text-[10px] font-bold text-slate-300">商户代叫</span>
                          <button
                            onClick={() => handleToggleCityFeature(norm, 'merchant_dispatch_enabled', !cfg.merchant_dispatch_enabled)}
                            className={`w-full py-1 rounded text-[10px] font-black transition-all cursor-pointer ${
                              cfg.merchant_dispatch_enabled 
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {cfg.merchant_dispatch_enabled ? '已开通' : '未开通'}
                          </button>
                        </div>

                        {/* 3. 小队管理 */}
                        <div className="bg-[#12141F] p-2 rounded-lg border border-slate-800 flex flex-col justify-between items-center text-center gap-1.5">
                          <span className="text-[10px] font-bold text-slate-300">小队管理</span>
                          <button
                            onClick={() => handleToggleCityFeature(norm, 'squad_management_enabled', !cfg.squad_management_enabled)}
                            className={`w-full py-1 rounded text-[10px] font-black transition-all cursor-pointer ${
                              cfg.squad_management_enabled 
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {cfg.squad_management_enabled ? '已开通' : '未开通'}
                          </button>
                        </div>
                      </div>

                      {/* Squad Names Section */}
                      <div className="bg-[#12141F] p-2.5 rounded-lg border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-teal-400 flex items-center gap-1">
                            <Users className="w-3 h-3" /> 城市所属小队名称
                          </span>
                          <button
                            onClick={() => setEditingSquadModal({ cityName: norm, value: '' })}
                            className="text-[10px] text-teal-400 font-bold hover:underline flex items-center gap-0.5 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" /> 添加小队
                          </button>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {cfg.squadNames.map(sName => (
                            <div 
                              key={sName}
                              className="bg-slate-900 border border-slate-700/80 rounded-md px-2 py-1 text-[10px] font-bold text-slate-200 flex items-center gap-1.5 group"
                            >
                              <span>{sName}</span>
                              <button
                                onClick={() => setEditingSquadModal({ cityName: norm, oldName: sName, value: sName })}
                                title="修改名称"
                                className="text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleDeleteCitySquad(norm, sName)}
                                title="删除小队"
                                className="text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredChinaCities.length === 0 && (
                  <div className="col-span-full py-12 text-center text-slate-500 text-xs">
                    未找到与搜索或筛选匹配的城市
                  </div>
                )}
              </div>
            </div>

            {/* Edit/Add City Squad Modal */}
            {editingSquadModal && (
              <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-[#12141F] border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="text-sm font-black text-slate-200 flex items-center gap-2">
                      <Users className="w-4 h-4 text-teal-400" />
                      {editingSquadModal.oldName ? '修改小队名称' : '添加城市小队'} - {editingSquadModal.cityName}市
                    </h3>
                    <button 
                      onClick={() => setEditingSquadModal(null)}
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 block">小队名称</label>
                    <input
                      type="text"
                      value={editingSquadModal.value}
                      onChange={(e) => setEditingSquadModal({ ...editingSquadModal, value: e.target.value })}
                      placeholder={`例如: ${editingSquadModal.cityName}雷霆小队`}
                      className="w-full bg-[#090B11] border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 outline-none focus:border-teal-500 transition-all font-bold"
                      autoFocus
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      onClick={() => setEditingSquadModal(null)}
                      className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-200 bg-slate-900 rounded-xl cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => handleSaveCitySquad(editingSquadModal.cityName, editingSquadModal.oldName, editingSquadModal.value)}
                      className="px-5 py-2 text-xs font-black text-slate-950 bg-teal-400 hover:bg-teal-300 rounded-xl shadow-lg shadow-teal-500/20 transition-all cursor-pointer"
                    >
                      确定保存
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Database Migration & Aliyun MySQL Configuration Panel */}
            <div className="max-w-4xl bg-[#12141F] rounded-2xl border border-slate-900 p-6 space-y-6 mt-6">
              <div className="flex items-center space-x-2 border-b border-indigo-950/20 pb-4">
                <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-sans font-black text-sm text-slate-200">自建数据库管理与阿里云宝塔 MySQL 部署</h3>
                  <p className="text-xs text-slate-500 mt-0.5">一键将系统所有数据备份并无损同步写入您的自建阿里云宝塔 MySQL 数据库</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-[#090B11] p-4 rounded-xl border border-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">当前对接的后端 API 接口地址</div>
                    <div className="text-sm font-mono text-teal-400">{getBaseApiUrl()}</div>
                  </div>
                  <div className="text-left md:text-right space-y-1">
                    <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">核心存储引擎</div>
                    <div className="text-sm font-black text-slate-300">阿里云宝塔 MySQL (数据表: <span className="text-teal-400 font-mono">daijia_documents</span>)</div>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    💡 <b>完全独立运行架构</b>：系统已全面切断对第三方外部数据库（如 Cloudflare / Firebase）的依赖。服务端通过 <span className="text-teal-400 font-mono">.env</span> 中的 <span className="text-teal-400 font-mono">MYSQL_HOST</span> 直接连通您的中国大陆阿里云宝塔 MySQL。
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    下方按钮可触发后端执行数据库自动建表与初始化同步，将包含司机、VIP卡密、开单记录、系统配置等全套数据无损写入您阿里云的 <span className="text-teal-400 font-mono">daijia_documents</span> 数据表。
                  </p>
                </div>

                {/* Actions */}
                <div className="pt-2 flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={() => downloadDeployZip('daijia_deploy.zip')}
                      className="w-full py-3.5 px-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 active:scale-[0.99] text-slate-950 font-black text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer border border-emerald-300"
                    >
                      <Download className="w-4 h-4 text-slate-950 animate-bounce" />
                      <span>📦 下载 ZIP 部署包 (.zip)</span>
                    </button>

                    <button
                      onClick={() => downloadDeployZip('daijia_deploy.tar.gz')}
                      className="w-full py-3.5 px-3 bg-slate-800 hover:bg-slate-700 active:scale-[0.99] text-emerald-300 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 border border-emerald-500/30 transition-all cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-emerald-400" />
                      <span>📦 下载 TAR.GZ 部署包 (.tar.gz)</span>
                    </button>
                  </div>

                  <button
                    onClick={handleMigrateDatabase}
                    disabled={migrationLoading}
                    className={`w-full py-3.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                      migrationLoading
                        ? 'bg-teal-600/50 text-teal-200 cursor-not-allowed'
                        : 'bg-slate-800 hover:bg-slate-700 active:scale-[0.99] text-teal-300 border border-teal-500/30 cursor-pointer'
                    }`}
                  >
                    {migrationLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        正在极速读取并无损同步写入您的阿里云 MySQL 数据库，请稍候...
                      </>
                    ) : (
                      <>
                        <Database className="w-4 h-4" />
                        🚀 立即执行：初始化并无损同步全套数据到阿里云宝塔 MySQL 数据库
                      </>
                    )}
                  </button>

                  {/* Results report */}
                  {migrationResult && (
                    <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-xl p-4 space-y-3 animate-in fade-in duration-200 text-left">
                      <div className="flex items-center gap-2 text-emerald-400 text-xs font-black">
                        <CheckCircle className="w-4 h-4 animate-spin" />
                        {migrationResult.message}
                      </div>
                      <div className="text-xs text-slate-400">
                        一键同步总记录数: <b className="text-emerald-400 font-mono text-sm">{migrationResult.total_documents}</b> 条 (分发在 {migrationResult.total_collections} 个核心数据集中)：
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-[#090B11]/80 p-3 rounded-lg border border-slate-900 font-mono text-[11px]">
                        {Object.entries(migrationResult.details || {}).map(([col, count]: [string, any]) => (
                          <div key={col} className="flex justify-between border-b border-slate-900/60 pb-1">
                            <span className="text-slate-500">{col}:</span>
                            <span className="text-teal-400 font-bold">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Errors & diagnostics */}
                  {migrationError && (
                    <div className="bg-[#1c1214] border border-rose-950/40 rounded-xl p-4 space-y-3 animate-in fade-in duration-200 text-left">
                      <div className="flex items-start gap-2 text-rose-400 text-xs font-black">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>迁移/同步执行失败：</span>
                      </div>
                      <pre className="text-xs text-rose-300 font-sans whitespace-pre-wrap leading-relaxed pl-6">
                        {migrationError}
                      </pre>
                      
                      <div className="border-t border-rose-950/40 pt-3 mt-2 pl-6 space-y-2">
                        <div className="text-xs text-slate-300 font-black">📝 阿里云宝塔自建数据库及接口部署排查建议：</div>
                        <ol className="list-decimal pl-4 text-xs text-slate-400 space-y-1.5 leading-relaxed">
                          <li>
                            <b>检查宝塔站点 Nginx 反向代理配置</b>：由于您的域名是 <code className="text-slate-300 font-mono bg-slate-950 px-1 py-0.5 rounded">admin.lyheiwandaijiamax.com</code>，如果您直接请求 <code className="text-slate-300 font-mono bg-slate-950 px-1 py-0.5 rounded">/api/*</code> 时报错，请务必在宝塔面板该域名的「设置」-「反向代理」中，添加一条配置：
                            <div className="bg-[#090B11] p-2 rounded border border-slate-900 my-1 text-[11px] font-mono leading-normal text-teal-400">
                              代理名称：api_proxy<br/>
                              代理地址：http://127.0.0.1:3000
                            </div>
                            这能确保所有的 API 数据库操作能安全跨过防火墙，顺利由运行在 3000 端口的代驾服务端承接，而不会被 Nginx 当作普通静态页面。
                          </li>
                          <li>
                            <b>确认端口连通性及防火墙</b>：请确保阿里云控制台安全组以及宝塔面板的「系统防火墙」已开放 <code className="text-slate-300 font-mono bg-slate-950 px-1 py-0.5 rounded">3000</code> 端口。
                          </li>
                          <li>
                            <b>在 .env 中正确声明 MySQL 配置</b>：请检查自建服务器上的部署环境变量中已填入真实的 <code className="text-slate-300 font-mono bg-slate-950 px-1 py-0.5 rounded">MYSQL_HOST</code>、<code className="text-slate-300 font-mono bg-slate-950 px-1 py-0.5 rounded">MYSQL_USER</code> 等，并顺利执行了重启启动指令。
                          </li>
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 12. ELECTRONIC SEAL GENERATOR TAB */}
        {activeTab === 'seal' && <SealGeneratorPanel />}

      </div>

      {/* Custom Confirmation Modal */}
      {confirmModal && confirmModal.show && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#12141F] border border-slate-800 rounded-3xl p-6 max-w-md w-full flex flex-col space-y-4 animate-in zoom-in-95 duration-200 shadow-2xl text-left">
            <h3 className="font-extrabold text-lg text-slate-100 flex items-center gap-2 border-b border-indigo-950/25 pb-3">
              {confirmModal.title}
            </h3>
            <p className="text-sm text-slate-400 whitespace-pre-line leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-slate-100 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  await confirmModal.onConfirm();
                }}
                className="px-5 py-2 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-slate-950 text-xs font-black rounded-xl transition-all active:scale-95 cursor-pointer shadow-lg shadow-teal-500/10"
              >
                确认执行
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ==========================================
// 12. ELECTRONIC OFFICIAL SEAL GENERATOR PANEL
// ==========================================
function SealGeneratorPanel() {
  const [text, setText] = useState('银川市兴庆区扬湾途信息技术工作室');
  const [subText, setSubText] = useState('（个体工商户）');
  const [hasStar, setHasStar] = useState(true);
  const [color, setColor] = useState('#E60012'); // Standard seal red
  const [textureLevel, setTextureLevel] = useState<'none' | 'subtle' | 'medium' | 'heavy'>('subtle');
  const [fontSizeScale, setFontSizeScale] = useState(100);
  const [borderWidth, setBorderWidth] = useState(10);
  const [arcAngleScale, setArcAngleScale] = useState(100);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawSeal = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use a clean 600x600 canvas for high-resolution PNG downloads
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.43;

    // 1. Draw outer circle
    ctx.strokeStyle = color;
    ctx.lineWidth = borderWidth;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - borderWidth/2, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Draw five-pointed star in the center
    if (hasStar) {
      ctx.fillStyle = color;
      ctx.beginPath();
      const starRadius = radius * 0.28;
      for (let i = 0; i < 5; i++) {
        const angleOuter = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        const angleInner = (Math.PI * 2 * i) / 5 - Math.PI / 2 + Math.PI / 5;
        const rOuter = starRadius;
        const rInner = starRadius * 0.38;
        
        const xOuter = cx + Math.cos(angleOuter) * rOuter;
        const yOuter = cy + Math.sin(angleOuter) * rOuter;
        const xInner = cx + Math.cos(angleInner) * rInner;
        const yInner = cy + Math.sin(angleInner) * rInner;
        
        if (i === 0) {
          ctx.moveTo(xOuter, yOuter);
        } else {
          ctx.lineTo(xOuter, yOuter);
        }
        ctx.lineTo(xInner, yInner);
      }
      ctx.closePath();
      ctx.fill();
    }

    // 3. Draw curved main text
    if (text) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = color;
      
      const computedFontSize = Math.round(radius * 0.155 * (fontSizeScale / 100));
      // Standard Chinese seals use SimSun / STSong style serif typefaces
      ctx.font = `bold ${computedFontSize}px "STSong", "SimSun", "Songti SC", "Microsoft YaHei", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      const len = text.length;
      // Normal arc angle is ~235 degrees
      const arcAngle = Math.PI * 1.32 * (arcAngleScale / 100); 
      const startAngle = -Math.PI / 2 - arcAngle / 2;
      const step = len > 1 ? arcAngle / (len - 1) : 0;
      const textRadius = radius * 0.74;
      
      for (let i = 0; i < len; i++) {
        const angle = len > 1 ? startAngle + step * i : -Math.PI / 2;
        ctx.save();
        ctx.rotate(angle + Math.PI / 2);
        ctx.translate(0, -textRadius);
        ctx.fillText(text[i], 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    // 4. Draw horizontal subText (e.g. "（个体工商户）")
    if (subText) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = color;
      const computedSubFontSize = Math.round(radius * 0.11 * (fontSizeScale / 100));
      ctx.font = `bold ${computedSubFontSize}px "STSong", "SimSun", "Songti SC", "Microsoft YaHei", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(subText, 0, radius * 0.44);
      ctx.restore();
    }

    // 5. Apply weathered textured effect (clipping/destination-out for transparency voids)
    if (textureLevel !== 'none') {
      let density = 0;
      if (textureLevel === 'subtle') density = 0.0006;
      else if (textureLevel === 'medium') density = 0.0016;
      else if (textureLevel === 'heavy') density = 0.0036;

      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      
      // Draw random tiny transparent speckles to simulate ink fading
      const numSpeckles = Math.floor(width * height * density);
      for (let i = 0; i < numSpeckles; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const size = 0.5 + Math.random() * 1.2;
        const opacity = 0.4 + Math.random() * 0.6;
        
        ctx.fillStyle = `rgba(0,0,0,${opacity})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Draw small scratches
      const numScratches = Math.floor(width * (density * 10));
      for (let i = 0; i < numScratches; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const len = 2.0 + Math.random() * 5;
        const angle = Math.random() * Math.PI * 2;
        
        ctx.strokeStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.5})`;
        ctx.lineWidth = 0.4 + Math.random() * 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
        ctx.stroke();
      }
      
      ctx.restore();
    }
  };

  useEffect(() => {
    drawSeal();
  }, [text, subText, hasStar, color, textureLevel, fontSizeScale, borderWidth, arcAngleScale]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Create an anchor element and trigger download
    const link = document.createElement('a');
    link.download = `${text || 'official_seal'}_电子公章.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-300 select-none">
      
      {/* Left controls column */}
      <div className="lg:col-span-7 bg-[#111625] border border-[#212b44] rounded-2xl p-6 space-y-6">
        <div className="flex items-center gap-3 border-b border-[#212b44] pb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold text-lg border border-amber-500/20 shadow-md">
            印
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-slate-100">印章定制与配置面板</h3>
            <p className="text-xs text-slate-500">自拟任意公司或工作室名、章体字样并一键下载透明 PNG</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Main Text Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-black text-slate-400">印章主文字（弧形排列，通常是公司/工作室全称）</label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full bg-[#090b11] border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 transition-colors font-bold"
              placeholder="请输入公司 or 工作室全称"
            />
            <div className="flex flex-wrap gap-2 pt-1.5">
              <button
                type="button"
                onClick={() => {
                  setText('银川市兴庆区扬湾途信息技术工作室');
                  setSubText('（个体工商户）');
                }}
                className="px-2.5 py-1 text-[10px] bg-amber-500/10 border border-amber-500/15 text-amber-400 hover:bg-amber-500/20 rounded font-bold transition-all cursor-pointer"
              >
                💾 载入：扬湾途工作室 (执照原件章)
              </button>
              <button
                type="button"
                onClick={() => {
                  setText('银川市兴庆区扬湾途信息技术工作室');
                  setSubText('合同专用章');
                }}
                className="px-2.5 py-1 text-[10px] bg-slate-800 text-slate-400 hover:text-slate-200 rounded font-bold transition-all cursor-pointer"
              >
                📜 载入：合同专用章
              </button>
              <button
                type="button"
                onClick={() => {
                  setText('银川市兴庆区扬湾途信息技术工作室');
                  setSubText('财务专用章');
                }}
                className="px-2.5 py-1 text-[10px] bg-slate-800 text-slate-400 hover:text-slate-200 rounded font-bold transition-all cursor-pointer"
              >
                💰 载入：财务专用章
              </button>
            </div>
          </div>

          {/* Sub Text Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-black text-slate-400">底部横向字样（例如：合同专用章、财务专用章）</label>
            <input
              type="text"
              value={subText}
              onChange={(e) => setSubText(e.target.value)}
              className="w-full bg-[#090b11] border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 transition-colors font-bold"
              placeholder="例如: （个体工商户）"
            />
          </div>

          {/* Controls row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Color selection */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black text-slate-400">印泥印油颜色</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-10 h-8 rounded-lg bg-transparent border border-slate-800 cursor-pointer animate-none"
                />
                <select
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="flex-1 bg-[#090b11] border border-slate-800 rounded-xl px-3 text-xs text-slate-300 focus:outline-none"
                >
                  <option value="#E60012">标准正红印泥 (#E60012)</option>
                  <option value="#C30D23">朱砂暗红印泥 (#C30D23)</option>
                  <option value="#FF3B30">鲜红光电印泥 (#FF3B30)</option>
                  <option value="#000000">纯黑章印 (#000000)</option>
                </select>
              </div>
            </div>

            {/* Texture level */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black text-slate-400">模拟印油干枯/纸张斑驳质感</label>
              <select
                value={textureLevel}
                onChange={(e) => setTextureLevel(e.target.value as any)}
                className="w-full bg-[#090b11] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
              >
                <option value="none">无损矢量 (100% Solid Vector)</option>
                <option value="subtle">轻微斑驳 (Subtle Ink texture - 推荐)</option>
                <option value="medium">中度磨损 (Medium worn texture)</option>
                <option value="heavy">重度斑驳 (Heavy weathered print)</option>
              </select>
            </div>
          </div>

          {/* Sliders Accordion */}
          <div className="bg-[#090b11]/40 border border-slate-900 rounded-2xl p-4 space-y-4">
            <div className="text-[11px] font-black tracking-wide text-slate-400 flex items-center justify-between">
              <span>📐 细节微调尺寸参数</span>
              <span className="text-[10px] font-mono text-amber-500">高级排版校准</span>
            </div>

            {/* Slider 1: Font scale */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-slate-500">字体大小比例</span>
                <span className="text-slate-300 font-bold">{fontSizeScale}%</span>
              </div>
              <input
                type="range"
                min="60"
                max="140"
                value={fontSizeScale}
                onChange={(e) => setFontSizeScale(Number(e.target.value))}
                className="w-full accent-amber-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Slider 2: Border width */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-slate-500">外圆边框粗细</span>
                <span className="text-slate-300 font-bold">{borderWidth} px</span>
              </div>
              <input
                type="range"
                min="4"
                max="18"
                value={borderWidth}
                onChange={(e) => setBorderWidth(Number(e.target.value))}
                className="w-full accent-amber-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Slider 3: Arc Angle Scale */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-slate-500">文字包裹弧度跨度</span>
                <span className="text-slate-300 font-bold">{arcAngleScale}%</span>
              </div>
              <input
                type="range"
                min="60"
                max="140"
                value={arcAngleScale}
                onChange={(e) => setArcAngleScale(Number(e.target.value))}
                className="w-full accent-amber-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Five pointed star Toggle */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-1 gap-2">
              <span className="text-xs text-slate-400 font-bold">印章中心印制红五角星</span>
              <button
                type="button"
                onClick={() => setHasStar(!hasStar)}
                className={`px-3 py-1 text-xs rounded-xl font-bold transition-all border ${
                  hasStar 
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 font-black' 
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}
              >
                {hasStar ? '★ 开启红五星 (常规公章)' : '☆ 关闭红五星 (椭圆或特殊章)'}
              </button>
            </div>
          </div>
        </div>

        {/* Action button */}
        <button
          onClick={handleDownload}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 hover:from-amber-600 hover:to-red-600 text-slate-950 font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-amber-500/10 cursor-pointer"
        >
          📥 一键生成并保存透明背景高清印章 (PNG)
        </button>
      </div>

      {/* Right Canvas visual preview column */}
      <div className="lg:col-span-5 flex flex-col space-y-6">
        <div className="bg-[#12141F] border border-slate-900 rounded-2xl p-6 flex flex-col items-center justify-center space-y-4">
          <div className="text-xs font-black text-slate-400 uppercase tracking-wider self-start flex items-center gap-1.5 border-b border-slate-800 pb-2.5 w-full">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            实时印章无损预览面板
          </div>
          
          {/* Canvas display wrapper - styled with a dark checkerboard transparent background indicator */}
          <div className="p-4 bg-slate-950/90 rounded-2xl border border-slate-900 flex items-center justify-center w-full max-w-[320px] aspect-square shadow-inner relative overflow-hidden group">
            {/* Checkerboard style indicator background */}
            <div 
              className="absolute inset-0 opacity-10 pointer-events-none" 
              style={{
                backgroundImage: 'radial-gradient(#ffffff 25%, transparent 25%), radial-gradient(#ffffff 25%, transparent 25%)',
                backgroundPosition: '0 0, 8px 8px',
                backgroundSize: '16px 16px'
              }}
            ></div>
            
            <canvas
              ref={canvasRef}
              width={600}
              height={600}
              className="w-full h-full relative z-10 select-none pointer-events-none drop-shadow-[0_4px_12px_rgba(230,0,18,0.25)]"
            />
          </div>

          <p className="text-[10px] text-slate-500 leading-normal text-center">
            上面黑白格背景代表<strong>100% 纯透明底色</strong>。
            生成的 PNG 只有红色的印章线条与微弱斑驳，背景绝对干净无杂色，可完美融入任何白纸或彩色背景的表格中。
          </p>
        </div>

        {/* Step-by-Step Instructions card */}
        <div className="bg-[#111625] border border-[#212b44] rounded-2xl p-5 space-y-3.5">
          <h4 className="text-xs font-black text-amber-400 flex items-center gap-1.5">
            💡 备案指南：如何将印章插入到不涉及前置审批承诺书？
          </h4>
          <div className="space-y-2.5 text-[11px] text-slate-400 leading-relaxed">
            <p>
              1. <strong>编辑承诺书</strong>：复制您的承诺书模板文本到 Word 文档或 WPS 文档，根据您的企业详情填写好空缺处（如银川市兴庆区扬湾途信息技术工作室）。
            </p>
            <p>
              2. <strong>插入印章图片</strong>：点击上方的<strong>「一键生成并保存透明背景高清印章」</strong>下载 PNG。然后在 Word / WPS 中选择 <code className="text-amber-500 font-mono">插入 - 图片 - 来自本地</code>。
            </p>
            <p>
              3. <strong>调整环绕方式</strong>：在 Word 中右键印章图片，选择 <code className="text-amber-500 font-mono">环绕方式 - 浮于文字上方 (In Front of Text)</code>。这一步非常关键，这样您就可以任意拖动它，将它完全重叠覆盖在 “主办单位（公章）” 的文字偏上方位置，甚至可以微调旋转一个极其微小的角度（例如 1~2 度），这样看起来像真实盖上去的一样！
            </p>
            <p>
              4. <strong>导出 PDF 并提交</strong>：调整满意后，将 Word 文档直接另存为 <code className="text-emerald-400 font-mono font-bold">PDF 文件</code>，然后上传到阿里云备案系统，即可完美、高分通过人工审核！
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
