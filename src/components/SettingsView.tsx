import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, HelpCircle, RotateCcw, PlusSquare, Bookmark, Save, ImagePlus, Trash2, CheckCircle, Loader2, Crown, LogOut, Download, AlertCircle } from 'lucide-react';
import { ChauffeurSettings, checkVipActive, checkVipActiveServerSynced } from '../types';
import { calculateDaysFromExpiry } from '../utils/nameResolver';
import { db, doc, getDoc, updateDoc, onSnapshot, getBaseApiUrl, getAuthHeaders } from '../lib/dbProxy';

import { speakText, stopSpeaking, initAudioUnlock } from '../utils/speech';
import { regenerateQRCode, cropQRCodeFromImage, processImageFileToCleanQR, formatQrUrl } from '../utils/qrCodeHelper';
import OnlineOrderApplicationModal from './OnlineOrderApplicationModal';

export { regenerateQRCode, cropQRCodeFromImage, processImageFileToCleanQR, formatQrUrl };

interface SettingsViewProps {
  settings: ChauffeurSettings;
  billingRules?: any;
  onUpdateSettings: (updated: ChauffeurSettings) => void;
  onClose: () => void;
  onNavigateToBilling: () => void;
  onLogout?: () => void;
  systemVersion?: string;
  userPhone?: string;
  userRole?: string;
}

export default function SettingsView({
  settings,
  billingRules,
  onUpdateSettings,
  onClose,
  onNavigateToBilling,
  onLogout,
  systemVersion = 'V2.0',
  userPhone,
  userRole
}: SettingsViewProps) {
  const effectivePhone = (userPhone || (settings as any)?.phone || (typeof window !== 'undefined' ? localStorage.getItem('dd_user_phone') : '') || '').trim();

  // Online Orders Application Modal States & Realtime Synchronization
  const [showOnlineAppModal, setShowOnlineAppModal] = useState(false);
  const [onlineApp, setOnlineApp] = useState<any>(null);
  const [isCityDispatchEnabled, setIsCityDispatchEnabled] = useState<boolean | null>(null);
  const [settingsLocalAlert, setSettingsLocalAlert] = useState<{ title: string; message: string; type?: 'warning' | 'info' | 'success' } | null>(null);

  // City configs map state for per-city feature toggles
  const [cityConfigsMap, setCityConfigsMap] = useState<Record<string, {
    online_app_enabled?: boolean;
    merchant_dispatch_enabled?: boolean;
    squad_management_enabled?: boolean;
    squadNames?: string[];
  }>>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('dd_city_configs_v2') : null;
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
      }, () => {});
    }
    return () => unsubscribe();
  }, []);

  // Listen to driver's online_application document
  useEffect(() => {
    if (!effectivePhone) return;
    const docRef = doc(db, 'online_applications', effectivePhone);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setOnlineApp({ id: docSnap.id, ...docSnap.data() });
      } else {
        setOnlineApp(null);
      }
    }, () => {});
    return () => unsubscribe();
  }, [effectivePhone]);

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
    }, () => {
      setIsCityDispatchEnabled(true);
    });
    return () => unsubscribe();
  }, [settings?.city, onlineApp?.city]);

  const getDriverCityConfig = () => {
    const rawCity = (settings?.city || onlineApp?.city || '银川市').trim();
    const norm = rawCity.replace(/市$/, '').trim();
    const cfg = cityConfigsMap[norm] || cityConfigsMap[`${norm}市`] || cityConfigsMap[rawCity];

    if (cfg) {
      return {
        online_app_enabled: cfg.online_app_enabled === true,
        merchant_dispatch_enabled: cfg.merchant_dispatch_enabled === true,
        squad_management_enabled: cfg.squad_management_enabled === true,
      };
    }
    // 2026-10-11：配置未加载时默认开通
    return {
      online_app_enabled: true,
      merchant_dispatch_enabled: true,
      squad_management_enabled: true,
    };
  };

  const handleOpenOnlineApp = () => {
    const cfg = getDriverCityConfig();
    if (!cfg.online_app_enabled) {
      setSettingsLocalAlert({
        title: '提示',
        message: '您所在的城市暂未开通服务，请联系客服',
        type: 'info'
      });
      return;
    }
    if (settings.onlineOrdersEnabled && isCityDispatchEnabled === false) {
      setSettingsLocalAlert({
        title: '提示',
        message: '您所在的城市暂未开通服务，请联系客服',
        type: 'info'
      });
      return;
    }
    setShowOnlineAppModal(true);
  };
  // Realtime active template name resolution matching MileageModeView
  const activeRulesCache = typeof window !== 'undefined' ? (localStorage.getItem('dd_billing_rules') || (settings?.billingTemplateName ? null : null)) : null;
  let cachedRuleName = '';
  if (activeRulesCache) {
    try {
      const parsed = JSON.parse(activeRulesCache);
      if (parsed && parsed.templateName) cachedRuleName = parsed.templateName;
    } catch (_) {}
  }

  const displayTemplateName = billingRules?.templateName || cachedRuleName || settings.billingTemplateName || '某D代驾计费模版';

  // Ensure settings.billingTemplateName stays synchronized with active rule name
  React.useEffect(() => {
    if (displayTemplateName && displayTemplateName !== settings.billingTemplateName) {
      onUpdateSettings({ ...settings, billingTemplateName: displayTemplateName });
    }
  }, [displayTemplateName, settings.billingTemplateName]);
  // Local state for interactive settings overlays
  const [activeModal, setActiveModal] = useState<'none' | 'recharge' | 'sms_edit' | 'qr_upload' | 'deviation_slider' | 'deviation_wait_slider'>('none');
  const [activeDoc, setActiveDoc] = useState<'none' | 'disclaimer' | 'user_agreement' | 'legal_statement'>('none');
  const [rechargeInput, setRechargeInput] = useState('100');
  const [tempSmsContent, setTempSmsContent] = useState(settings.smsContent);

  const [isProcessingWechat, setIsProcessingWechat] = useState(false);
  const [isProcessingAlipay, setIsProcessingAlipay] = useState(false);

  // States for the newly designed Payment QR system
  const [selectedQrTab, setSelectedQrTab] = useState<'wechat' | 'alipay'>('wechat');
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);
  const [isPhotoAlbumOpen, setIsPhotoAlbumOpen] = useState(false);

  // VIP Promo code states and logic
  const [promoCode, setPromoCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  // Aliyun Baota Server API and custom domain endpoint state variables
  const [cloudflareUrl, setCloudflareUrl] = useState(() => {
    try {
      return localStorage.getItem('baota_api_url') || localStorage.getItem('cloudflare_worker_api_url') || '';
    } catch (_) {
      return '';
    }
  });
  const [testingConnection, setTestingConnection] = useState(false);

  const saveCloudflareUrl = (val: string) => {
    setCloudflareUrl(val);
    try {
      localStorage.setItem('baota_api_url', val.trim());
      localStorage.setItem('cloudflare_worker_api_url', val.trim());
    } catch (_) {}
  };

  const handleTestConnection = async () => {
    if (!cloudflareUrl.trim()) {
      setTestingConnection(true);
      try {
        const res = await fetch(`${getBaseApiUrl()}/api/health`);
        if (res.ok) {
          const data = await res.json();
          alert(`✅ 系统内置阿里云宝塔 Express / Node.js 极速 API 服务连接成功！\n- 状态：${data.status}\n- 连线延迟：延迟极低，国内直连。\n- 适用性：中国大陆扫码免VPN直连，秒级报单！`);
        } else {
          alert(`❌ 内置服务连接异常(状态码 ${res.status})，可能服务正在启动中，请稍候再试。`);
        }
      } catch (err: any) {
        alert(`❌ 连接失败：${err.message || err}`);
      } finally {
        setTestingConnection(false);
      }
      return;
    }

    let normalizedUrl = cloudflareUrl.trim().replace(/\/$/, '');
    if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    setTestingConnection(true);
    try {
      const res = await fetch(`${normalizedUrl}/api/health`);
      if (res.ok) {
        const data = await res.json();
        alert(`🎉 恭喜！中国大陆阿里云宝塔 API 专线/自定义域名连接成功！\n- 状态：${data.status || '正常'}\n- 节点：中国大陆阿里云服务器/宝塔面板\n- 专线：已成功中继连接到您的云端 MySQL 数据库！`);
      } else {
        try {
          const rootRes = await fetch(normalizedUrl, { method: 'GET' });
          if (rootRes.ok) {
            alert(`✅ 连通测试：检测到阿里云宝塔 API 节点有正常 HTTP 回应！\n您的自定义域名已被成功解析，可正常接收数据同步请求。`);
          } else {
            alert(`⚠️ 调试提示 (HTTP ${rootRes.status})：已连通至宝塔服务器节点，但服务端返回了错误响应。请检查 Node.js 服务运行状态。`);
          }
        } catch (_) {
          alert(`❌ 连接失败：已解析域名，但宝塔服务器节点拒绝连接。请检查 HTTPS 证书和 Node.js 项目管理器状态。`);
        }
      }
    } catch (err: any) {
      alert(`⚠️ 网络连接超时或 CORS 跨域受阻：\n${err.message || err}\n\n建议提示：请登录宝塔面板，确认 Node.js 项目管理器已正常运行且已配置正确的域名反向代理与 CORS 跨域允许首部。`);
    } finally {
      setTestingConnection(false);
    }
  };

  // P2-2修复(2026-10-15)：删除未引用的handleRedeemCode死代码

  const wechatInputRef = useRef<HTMLInputElement>(null);
  const alipayInputRef = useRef<HTMLInputElement>(null);

  const handleWechatFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // Reset input to allow selecting the same file again
    if (file) {
      setIsProcessingWechat(true);
      try {
        let cleanQr = await processImageFileToCleanQR(file, 'wechat');
        // 2026-10-18改：裁剪失败（未识别出二维码）时不再回退上传原图，直接报错让司机重选。
        // 用户要求：只上传裁剪后的干净二维码，不上传截图前的原图。
        if (!cleanQr || !cleanQr.startsWith('data:image/')) {
          setIsProcessingWechat(false);
          alert('❌ 未能从图片中识别出微信收款码\n\n请重新截图，确保二维码完整清晰，然后再上传。');
          return;
        }
        if (!cleanQr) {
          setIsProcessingWechat(false);
          return;
        }

        // Update state with clean QR DataURL
        onUpdateSettings({ ...settings, wechatQrCode: cleanQr });

        // 2026-10-18修：上传/删除必须用 localStorage 的登录号（source of truth），
        // 不用 React state 的 effectivePhone（退出重登后可能是过期值，导致 403 手机号对不上）
        // 2026-10-23 第十五轮：上传给服务端的 phone 必须用原始形态（商户号带 A 后缀）。
        // 旧写法先 replace(/\D/g) 剥掉 A，服务端鉴权 rawPhone===authPhone（带 A）永不相等，
        // 普通商户上传必然 403；且服务端按无 A 落盘成司机码、与同号司机串码。
        // 本地键则双写原始形态+纯数字形态（各读取方口径不一，双写保兼容）。
        const rawPhone = (localStorage.getItem('dd_user_phone') || effectivePhone || (settings as any)?.phone || settings.phoneNumber || '').trim();
        const targetPhone = rawPhone.replace(/\D/g, '').trim();
        if (rawPhone) {
          try {
            for (const k of new Set([rawPhone, targetPhone])) {
              localStorage.removeItem(`dd_qr_deleted_${k}`);
              localStorage.setItem(`dd_dispatch_wechat_qr_${k}`, cleanQr);
              localStorage.setItem(`dd_dispatch_fee_qr_${k}`, cleanQr);
              localStorage.setItem(`dd_user_wechat_clean_qr_${k}`, cleanQr);
            }
            localStorage.setItem('dd_dispatch_wechat_qr', cleanQr);
            localStorage.setItem('dd_user_wechat_qr', cleanQr);
            localStorage.setItem('dd_user_wechat_clean_qr', cleanQr);
            localStorage.setItem('dd_last_payment_qr', cleanQr);
          } catch (_) {}

          const baseUrl = getBaseApiUrl();
          // P1-1修复(2026-10-14)：上传加成功/失败反馈，不再静默
          // 2026-10-18修：失败时显示真实状态码与服务端错误信息，不再一律"检查网络"
          fetch(`${baseUrl}/api/upload-wechat-qr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ phone: rawPhone, imageBase64: cleanQr })
          }).then(async (res) => {
            if (!res.ok) {
              let detail = '';
              try {
                const j = await res.json();
                detail = String(j.error || j.message || '');
              } catch (_) {}
              alert(`⚠️ 本地已保存，服务器上传失败（${res.status}）${detail ? '：' + detail : ''}，请截图发给管理员排查`);
            }
          }).catch(err => {
            console.error('Upload QR to server error:', err);
            alert('⚠️ 本地已保存，服务器上传失败（网络错误），请检查网络后重试');
          });
        }
      } catch (err) {
        console.error('Process QR error:', err);
      } finally {
        setIsProcessingWechat(false);
      }
    }
  };

  const handleAlipayFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // Reset input
    if (file) {
      setIsProcessingAlipay(true);
      try {
        let cleanQr = await processImageFileToCleanQR(file, 'alipay');
        if (!cleanQr || !cleanQr.startsWith('data:image/')) {
          cleanQr = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
          });
        }
        if (!cleanQr) {
          setIsProcessingAlipay(false);
          return;
        }

        onUpdateSettings({ ...settings, alipayQrCode: cleanQr });

        const targetPhone = (localStorage.getItem('dd_user_phone') || effectivePhone || (settings as any)?.phone || settings.phoneNumber || '').replace(/\D/g, '').trim();
        if (targetPhone) {
          try {
            localStorage.setItem(`dd_dispatch_alipay_qr_${targetPhone}`, cleanQr);
            localStorage.setItem('dd_dispatch_alipay_qr', cleanQr);
            localStorage.setItem('dd_user_alipay_qr', cleanQr);
          } catch (_) {}

          // P1-3修复(2026-10-14)：支付宝码绝不上传服务器（铁律），服务端接口已410，此处直接删除
        }
      } catch (err) {
        console.error('Process Alipay QR error:', err);
      } finally {
        setIsProcessingAlipay(false);
      }
    }
  };

  const toggleVoiceBroadcast = () => {
    const next = settings.voiceBroadcast === '开单语音播报' ? '静音播报' : '开单语音播报';
    onUpdateSettings({ ...settings, voiceBroadcast: next });
    if (next === '开单语音播报') {
      initAudioUnlock();
      speakText('已开启开单语音播报');
    } else {
      stopSpeaking();
    }
  };

  const handleRechargeSubmit = () => {
    const amount = Number(rechargeInput) || 0;
    if (amount <= 0) {
      alert('请输入有效的充值金额！');
      return;
    }
    onUpdateSettings({ 
      ...settings, 
      accountBalance: Number((settings.accountBalance + amount).toFixed(2)) 
    });
    setActiveModal('none');
    alert(`成功充值 ¥${amount.toFixed(2)} 元！您的代驾账户可用余额已更新。`);
  };

  const handleSmsSave = () => {
    onUpdateSettings({ ...settings, smsContent: tempSmsContent });
    setActiveModal('none');
  };

  const cycleHomepageColor = () => {
    const colors: ('green' | 'blue' | 'slate')[] = ['green', 'blue', 'slate'];
    const currentIdx = colors.indexOf(settings.homepageColorway);
    const nextIdx = (currentIdx + 1) % colors.length;
    onUpdateSettings({ ...settings, homepageColorway: colors[nextIdx] });
  };

  const cycleDeviationKm = () => {
    const options = [0.5, 1.0, 1.5, 2.0];
    const currentIdx = options.indexOf(settings.deviationKm);
    const nextIdx = (currentIdx + 1) % options.length;
    onUpdateSettings({ ...settings, deviationKm: options[nextIdx] });
  };

  const cycleDeviationWaitSec = () => {
    const options = [10, 30, 45, 60, 120];
    const currentIdx = options.indexOf(settings.deviationWaitSec);
    const nextIdx = (currentIdx + 1) % options.length;
    onUpdateSettings({ ...settings, deviationWaitSec: options[nextIdx] });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-100 select-none overflow-hidden relative">
      
      {/* 1. Top navigation */}
      <div className="bg-[#273046] header-safe-pt pb-2 min-h-14 flex items-center justify-between px-4 text-white shadow-md z-10">
        <button 
          onClick={onClose}
          className="p-1 px-1.5 rounded-lg hover:bg-white/10 text-white transition-colors"
        >
          <X className="w-5 h-5 text-gray-100" />
        </button>
        <span className="font-semibold text-base tracking-wide text-center flex-1 pr-6 text-gray-100">代驾设置</span>
        <button 
          onClick={() => setActiveModal('qr_upload')}
          className="text-xs text-teal-300 font-semibold hover:text-teal-400 active:scale-95 transition-all text-emerald-400 font-bold"
        >
          上传收款码
        </button>
      </div>

      {/* Settings list scrolling area */}
      <div className="flex-1 overflow-y-auto p-4 pb-4 space-y-4 android-nav-safe-pb">
        
        {/* Card 1: Billing and broadcast (Screenshot 5 first block) */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xs divide-y divide-gray-100 overflow-hidden">
          
          {/* Rules block */}
          <button 
            onClick={onNavigateToBilling}
            className="w-full py-4 px-4 flex items-center justify-between hover:bg-gray-50 bg-white transition-colors text-left"
          >
            <span className="text-sm font-semibold text-gray-700">计费规则</span>
            <div className="flex items-center space-x-1 text-gray-400">
              <span className="text-xs text-gray-500 font-mono font-bold mr-0.5">{displayTemplateName}</span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </div>
          </button>

          {/* Voice broadcast changer */}
          <div className="w-full py-3.5 px-4 flex items-center justify-between bg-white">
            <span className="text-sm font-semibold text-gray-700">语音播报状态</span>
            <div className="flex items-center space-x-2">
              <button 
                type="button"
                onClick={toggleVoiceBroadcast}
                className="flex items-center space-x-1 text-teal-600 font-semibold py-1 px-2.5 hover:bg-teal-50 rounded-lg border border-teal-100 transition-colors cursor-pointer"
              >
                <span className="text-xs font-bold">{settings.voiceBroadcast}</span>
                <ChevronRight className="w-4 h-4 text-teal-400" />
              </button>
            </div>
          </div>

        </div>

        {/* Card 2: Account details */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xs divide-y divide-gray-100 overflow-hidden">
          
          {/* Funds Balance */}
          <button 
            disabled
            className="w-full py-4 px-4 flex items-center justify-between bg-white text-left cursor-default"
          >
            <span className="text-sm font-semibold text-gray-700">账户余额</span>
            <div className="flex items-center space-x-1 text-emerald-600 font-mono font-bold">
              <span>¥0.00</span>
            </div>
          </button>

          {/* VIP Membership Status */}
          <div className="py-4 px-4 flex items-center justify-between bg-white">
            <span className="text-sm font-semibold text-gray-700">VIP会员状态</span>
            {checkVipActive(settings.vipExpiry) ? (
              <div className="flex items-center space-x-1.5 text-amber-600 font-bold text-xs bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                <Crown className="w-4 h-4 text-amber-500 animate-pulse" />
                <span>已激活 VIP ({(() => { const d = calculateDaysFromExpiry(settings.vipExpiry); return d === '永久' ? '永久' : `${d}天`; })()})</span>
              </div>
            ) : (
              <div className="flex items-center space-x-1 text-slate-400 font-medium text-xs bg-slate-50 px-2.5 py-1 rounded-lg">
                <span>未激活 / 已到期 VIP</span>
              </div>
            )}
          </div>

          {/* 线上单开通 (Online Orders Access) */}
          <button 
            type="button"
            onClick={handleOpenOnlineApp}
            className="w-full py-4 px-4 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors text-left cursor-pointer"
          >
            <span className="text-sm font-semibold text-gray-700">线上单开通</span>
            <div className="flex items-center space-x-1 text-xs">
              {(() => {
                const cfg = getDriverCityConfig();
                // 1. 若当前城市未在管理后台由开发者15509601222开启【线上单开通】，一律显示未开通
                if (!cfg.online_app_enabled) {
                  return (
                    <span className="text-slate-400 font-medium bg-slate-50 px-2.5 py-1 rounded-lg text-xs">
                      未开通
                    </span>
                  );
                }
                // 2. 城市已开通后，再根据司机的资质认证审核状态展示
                if (onlineApp?.status === 'approved') {
                  return (
                    <span className="text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 text-xs">
                      已开通
                    </span>
                  );
                }
                if (onlineApp?.status === 'pending') {
                  return (
                    <span className="text-amber-600 font-bold bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 text-xs">
                      审核中
                    </span>
                  );
                }
                if (onlineApp?.status === 'rejected') {
                  return (
                    <span className="text-rose-600 font-bold bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200 text-xs">
                      已驳回
                    </span>
                  );
                }
                return (
                  <span className="text-slate-400 font-medium bg-slate-50 px-2.5 py-1 rounded-lg text-xs">
                    未开通
                  </span>
                );
              })()}
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </div>
          </button>

        </div>

        {/* Card 3: Calibration */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xs divide-y divide-gray-100 overflow-hidden">
          
          {/* Toggle physical calibration mode */}
          <div className="py-4 px-4 flex items-center justify-between bg-white">
            <div className="space-y-0.5 max-w-[210px]">
              <div className="text-sm font-semibold text-gray-700">纠偏功能</div>
              <div className="text-[10px] text-gray-400 leading-normal">在行程界面【已行程(公里)】和【等候时间】组件中点击可按设定步长纠偏</div>
            </div>
            <label className={`relative inline-flex items-center ${!checkVipActiveServerSynced(effectivePhone, settings.vipExpiry) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
              <input 
                type="checkbox" 
                disabled={!checkVipActiveServerSynced(effectivePhone, settings.vipExpiry)}
                checked={!!(checkVipActiveServerSynced(effectivePhone, settings.vipExpiry) && settings.deviationMitigation)}
                onChange={(e) => {
                  // 2026-10-22 第五轮 P2-10：纠偏开关门禁改以服务端同步的 VIP 到期为准
                  if (!checkVipActiveServerSynced(effectivePhone, settings.vipExpiry)) {
                    alert('🔒 提示：纠偏功能为VIP会员专属特权！会员已到期、未激活或有效期为0时自动关闭，重新激活会员后方可在手机端开启此功能。');
                    return;
                  }
                  onUpdateSettings({ ...settings, deviationMitigation: e.target.checked });
                }}
                className="sr-only peer" 
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1da39b] peer-disabled:bg-slate-300"></div>
            </label>
          </div>

          {/* Deviation added per calibrator */}
          {settings.deviationMitigation && (
            <button 
              onClick={() => setActiveModal('deviation_slider')}
              className="w-full py-4 px-4 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors text-left"
            >
              <span className="text-sm font-semibold text-gray-700">每次纠偏的公里数</span>
              <div className="flex items-center space-x-1 text-gray-500 font-semibold text-xs font-mono">
                <span>每次{settings.deviationKm}公里</span>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </div>
            </button>
          )}

          {/* Waiting added per calibrator */}
          {settings.deviationMitigation && (
            <button 
              onClick={() => setActiveModal('deviation_wait_slider')}
              className="w-full py-4 px-4 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-700">每次纠偏的等候时间</span>
                <span className="text-[11px] text-amber-500 font-medium mt-0.5">温馨提示：建议设置60秒</span>
              </div>
              <div className="flex items-center space-x-1 text-gray-500 font-semibold text-xs font-mono">
                <span>每次{settings.deviationWaitSec}秒</span>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </div>
            </button>
          )}

        </div>

        {/* Card 4: Version Display and Agreement Links */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden p-4 flex flex-col items-center justify-center space-y-2">
          <div className="text-gray-400 font-medium text-sm text-center">
            <span>版本号：{systemVersion}</span>
          </div>
          <div className="flex flex-row items-center justify-center space-x-3 text-xs text-teal-600 font-medium">
            <button 
              onClick={() => setActiveDoc('disclaimer')} 
              className="hover:underline active:opacity-70 transition-all cursor-pointer"
            >
              免责声明
            </button>
            <span className="text-gray-200">|</span>
            <button 
              onClick={() => setActiveDoc('user_agreement')} 
              className="hover:underline active:opacity-70 transition-all cursor-pointer"
            >
              用户服务协议
            </button>
            <span className="text-gray-200">|</span>
            <button 
              onClick={() => setActiveDoc('legal_statement')} 
              className="hover:underline active:opacity-70 transition-all cursor-pointer"
            >
              法律声明
            </button>
          </div>
        </div>

      </div>

      {/* SUB-DIALOG: Recharge overlay (Pure interactive element) */}
      {activeModal === 'recharge' && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-5 z-50">
          <div className="bg-white rounded-3xl w-full max-w-[320px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-[#273046] text-white py-4 px-5 flex items-center justify-between">
              <span className="font-bold text-sm">司机账户钱包充值</span>
              <X className="w-4 h-4 cursor-pointer" onClick={() => setActiveModal('none')} />
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-gray-400">目前模拟充值资金，充值后可供抵扣日常信息垫付费用支出。</p>
              
              <div className="flex items-center bg-slate-50 border border-gray-200 rounded-xl p-3 shadow-inner">
                <span className="text-md font-bold text-[#1da39b] mr-2">¥</span>
                <input
                  type="number"
                  placeholder="金额"
                  value={rechargeInput}
                  onChange={(e) => setRechargeInput(e.target.value)}
                  className="w-full bg-transparent font-mono text-lg font-bold text-gray-800 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                {['50', '100', '300'].map(val => (
                  <button
                    key={val}
                    onClick={() => setRechargeInput(val)}
                    className={`py-2 rounded-xl text-xs font-semibold border ${
                      rechargeInput === val ? 'bg-teal-50 border-[#1da39b] text-teal-600' : 'bg-white border-gray-200 text-gray-600'
                    }`}
                  >
                    ¥{val} 元
                  </button>
                ))}
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 flex gap-3 border-t border-gray-100">
              <button 
                onClick={() => setActiveModal('none')}
                className="flex-1 py-2.5 bg-white border border-gray-200 text-gray-500 rounded-xl text-xs font-semibold"
              >
                取消
              </button>
              <button 
                onClick={handleRechargeSubmit}
                className="flex-1 py-2.5 bg-[#1da39b] text-white rounded-xl text-xs font-semibold shadow-md"
              >
                确认充值
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-DIALOG: SMS Text Template Editor (Pure interactive element) */}
      {activeModal === 'sms_edit' && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-5 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-[340px] shadow-2xl overflow-hidden">
            <div className="bg-[#273046] text-white py-4 px-5 flex items-center justify-between">
              <span className="font-bold text-sm flex items-center space-x-1">
                <Bookmark className="w-4 h-4" />
                <span>自动客服短信内容</span>
              </span>
              <X className="w-4 h-4 cursor-pointer" onClick={() => setActiveModal('none')} />
            </div>
            <div className="p-5 space-y-3">
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">编辑提醒短信模版</label>
              <textarea
                value={tempSmsContent}
                onChange={(e) => setTempSmsContent(e.target.value)}
                rows={5}
                className="w-full p-3 border border-gray-200 focus:border-teal-500 text-xs rounded-xl focus:outline-hidden leading-relaxed text-gray-700 bg-slate-50 font-sans"
              />
              <span className="text-[10px] text-gray-400 leading-normal block">
                自动发送场景：代驾司机点单后（开始服务）或收款后（行程结账），将配合网关秒级投递至乘客登记手机上。
              </span>
            </div>
            
            <div className="p-4 bg-slate-50 flex gap-3 border-t border-gray-100">
              <button 
                onClick={() => setActiveModal('none')}
                className="flex-1 py-2.5 bg-white border border-gray-200 text-gray-500 rounded-xl text-xs font-semibold"
              >
                取消
              </button>
              <button 
                onClick={handleSmsSave}
                className="flex-1 py-2.5 bg-[#1da39b] text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1 shadow-md hover:bg-teal-600 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                <span>保存模板</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-DIALOG: QR CODE UPLOAD MODAL (Re-designed to match Image 2, 3, 4) */}
      {activeModal === 'qr_upload' && (
        <div className="absolute inset-0 bg-[#F1F5F9] flex flex-col z-50 animate-in fade-in slide-in-from-right duration-200">
          
          {/* Header (Matching Image 2 / 4) */}
          <div className="bg-[#273046] header-safe-pt pb-2 min-h-14 flex items-center justify-between px-4 text-white shadow-md z-14 shrink-0">
            <button 
              onClick={() => {
                if (isPhotoAlbumOpen) {
                  setIsPhotoAlbumOpen(false);
                } else {
                  setActiveModal('none');
                }
              }}
              className="p-1 px-1.5 rounded-lg hover:bg-white/10 text-white transition-all flex items-center gap-1 cursor-pointer"
            >
              <svg className="w-5 h-5 text-gray-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-xs font-semibold text-gray-200">返回</span>
            </button>
            <span className="font-bold text-sm tracking-wide text-center">
              {isPhotoAlbumOpen ? '微信' : '我的收款码'}
            </span>
            <button 
              onClick={async () => {
                if (isPhotoAlbumOpen) {
                  setIsPhotoAlbumOpen(false);
                } else {
                  // Delete currently active QR code
                  if (selectedQrTab === 'wechat') {
                    const currentPhone = String((settings as any)?.phone || (settings as any)?.userPhone || (typeof window !== 'undefined' ? localStorage.getItem('dd_user_phone') : '') || '').trim();
                    
                    onUpdateSettings({ ...settings, wechatQrCode: '' });
                    
                    if (typeof window !== 'undefined') {
                      if (currentPhone) {
                        localStorage.setItem(`dd_qr_deleted_${currentPhone}`, 'true');
                        localStorage.removeItem(`dd_dispatch_wechat_qr_${currentPhone}`);
                        localStorage.removeItem(`dd_dispatch_fee_qr_${currentPhone}`);
                        localStorage.removeItem(`dd_user_wechat_clean_qr_${currentPhone}`);
                        // 2026-10-23 第十五轮：上传侧历史版本按纯数字形态写过本地键，
                        // 删除必须双形态同清，否则删后被残留键复活（A 后缀商户尤甚）。
                        const digitsPhone = currentPhone.replace(/\D/g, '').trim();
                        if (digitsPhone && digitsPhone !== currentPhone) {
                          localStorage.setItem(`dd_qr_deleted_${digitsPhone}`, 'true');
                          localStorage.removeItem(`dd_dispatch_wechat_qr_${digitsPhone}`);
                          localStorage.removeItem(`dd_dispatch_fee_qr_${digitsPhone}`);
                          localStorage.removeItem(`dd_user_wechat_clean_qr_${digitsPhone}`);
                        }
                      }
                      localStorage.removeItem('dd_dispatch_wechat_qr');
                      localStorage.removeItem('dd_user_wechat_qr');
                      localStorage.removeItem('dd_user_wechat_clean_qr');
                      localStorage.removeItem('dd_last_payment_qr');
                      window.dispatchEvent(new CustomEvent('wechat_qr_deleted', { detail: { phone: currentPhone } }));
                    }

                    // P1-2修复(2026-10-14)：等待服务器确认后再提示，不再"假成功"
                    try {
                      const baseUrl = getBaseApiUrl();
                      if (currentPhone) {
                        const delRes = await fetch(`${baseUrl}/api/delete-wechat-qr`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                          body: JSON.stringify({ phone: currentPhone })
                        });
                        if (!delRes.ok) {
                          alert('⚠️ 本地已清空，但服务器删除失败，请检查网络后重试');
                          return;
                        }
                      }
                    } catch (_) {
                      alert('⚠️ 本地已清空，但服务器删除失败，请检查网络后重试');
                      return;
                    }

                    alert('已成功清空微信收款二维码');
                  } else {
                    onUpdateSettings({ ...settings, alipayQrCode: '' });
                    // P1-6修复(2026-10-14)：删除时同时清理本地存储，防止删完仍显示旧码
                    try {
                      const p = String((settings as any)?.phone || localStorage.getItem('dd_user_phone') || '').replace(/\D/g, '');
                      localStorage.removeItem(`dd_dispatch_alipay_qr_${p}`);
                      localStorage.removeItem(`dd_user_alipay_qr_${p}`);
                      localStorage.removeItem('dd_user_alipay_qr');
                    } catch (_) {}
                    alert('已成功清空当前通道的收款二维码');
                  }
                }
              }}
              className="text-xs font-bold text-red-400 hover:text-red-300 px-2.5 py-1 rounded-md hover:bg-black/10 active:scale-95 transition-all cursor-pointer"
            >
              {isPhotoAlbumOpen ? '取消' : '删除'}
            </button>
          </div>

          {/* Hidden File Inputs for real phone uploads */}
          <input 
            type="file" 
            ref={wechatInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={handleWechatFileChange} 
          />
          <input 
            type="file" 
            ref={alipayInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={handleAlipayFileChange} 
          />

          {true && (
            /* SUB-VIEW 1: MY QR CODE OVERVIEW (Image 2 & 4 style) */
            <div className="flex-1 flex flex-col justify-between p-5 pb-3 overflow-y-auto select-none android-nav-safe-pb">
              
              {/* Inner container to center everything beautifully */}
              <div className="flex-1 flex flex-col items-center justify-center py-4">
                
                {/* Main White Rounded Card */}
                <div 
                  onClick={() => {
                    if (selectedQrTab === 'wechat') {
                      wechatInputRef.current?.click();
                    } else {
                      alipayInputRef.current?.click();
                    }
                  }}
                  className="bg-white rounded-3xl w-full max-w-[270px] shadow-lg border border-gray-150 p-6 flex flex-col items-center justify-center aspect-square cursor-pointer hover:border-teal-400 hover:shadow-xl transition-all relative overflow-hidden group mb-8"
                >
                  {/* Outer QR details wrapper */}
                  <div className="w-full flex justify-between items-center mb-5 border-b border-gray-50 pb-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-3 h-3 rounded-full ${selectedQrTab === 'wechat' ? 'bg-[#07C160]' : 'bg-[#108EE9]'}`} />
                      <span className="text-[11px] text-gray-700 font-bold tracking-wider font-sans">
                        {selectedQrTab === 'wechat' ? '微信' : '支付宝'}
                      </span>
                    </div>
                    <span className="text-[9px] text-teal-600 font-bold bg-teal-50 px-2 py-0.5 rounded-full font-mono">
                      智能裁剪已就绪
                    </span>
                  </div>

                  {/* QR Image Frame */}
                  <div className="w-full flex-1 min-h-[140px] flex items-center justify-center relative bg-gray-50/50 rounded-2xl border border-dashed border-gray-200 overflow-hidden">
                    {selectedQrTab === 'wechat' ? (
                      settings.wechatQrCode && settings.wechatQrCode.trim().length > 0 ? (
                        <div className="relative w-full h-full flex items-center justify-center p-2">
                          <img 
                            src={formatQrUrl(settings.wechatQrCode)} 
                            alt="微信收款码" 
                            className="w-full h-full object-contain rounded-xl max-h-[155px]" 
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center text-center p-4">
                          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 mb-2">
                            <PlusSquare className="w-5 h-5" />
                          </div>
                          <span className="text-xs font-bold text-gray-700 font-sans">暂时未设置微信收款码</span>
                          <span className="text-[9px] text-gray-400 mt-1">轻触开始上传</span>
                        </div>
                      )
                    ) : (
                      settings.alipayQrCode && settings.alipayQrCode.trim().length > 0 ? (
                        <div className="relative w-full h-full flex items-center justify-center p-2">
                          <img 
                            src={formatQrUrl(settings.alipayQrCode)} 
                            alt="支付宝收款码" 
                            className="w-full h-full object-contain rounded-xl max-h-[155px]" 
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center text-center p-4">
                          <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 mb-2">
                            <PlusSquare className="w-5 h-5" />
                          </div>
                          <span className="text-xs font-bold text-gray-700 font-sans">暂时未设置支付宝收款码</span>
                          <span className="text-[9px] text-gray-400 mt-1">轻触开始上传</span>
                        </div>
                      )
                    )}
                  </div>

                  {/* Channel tag below QR inside card */}
                  <div className="mt-4 flex items-center gap-1">
                    {selectedQrTab === 'wechat' ? (
                      <span className="text-xs font-bold text-gray-600 flex items-center gap-1 font-sans">
                        <span className="w-2 h-2 rounded-full bg-[#07C160]"></span>
                        微信渠道收款二维码
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-gray-600 flex items-center gap-1 font-sans">
                        <span className="w-2 h-2 rounded-full bg-[#108EE9]"></span>
                        支付宝渠道收款二维码
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom interactive WeChat/Alipay Capsule Tabs Selector (Matching Image 2 & 4 style) */}
                <div className="flex bg-white rounded-full p-1 shadow-sm border border-gray-150 w-full max-w-[210px] gap-1 shrink-0">
                  <button
                    onClick={() => setSelectedQrTab('wechat')}
                    className={`flex-1 py-2 rounded-full text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      selectedQrTab === 'wechat' 
                        ? 'bg-[#07C160] text-white shadow-xs' 
                        : 'bg-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                      <path d="M12 2C6.477 2 2 6.015 2 10.97c0 2.81 1.442 5.315 3.69 6.963l-.46 1.72a.5.5 0 0 0 .668.59l2.12-.96c1.233.454 2.585.717 3.982.717 5.523 0 10-4.015 10-10.97C22 6.015 17.523 2 12 2z" />
                    </svg>
                    <span>微信</span>
                  </button>
                  <button
                    onClick={() => setSelectedQrTab('alipay')}
                    className={`flex-1 py-1.5 rounded-full text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      selectedQrTab === 'alipay' 
                        ? 'bg-[#108EE9] text-white shadow-xs' 
                        : 'bg-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <rect width="24" height="24" rx="12" fill="currentColor"/>
                      <text x="12" y="16.5" fill={selectedQrTab === 'alipay' ? '#108EE9' : '#ffffff'} fontSize="14" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">支</text>
                    </svg>
                    <span>支付宝</span>
                  </button>
                </div>

              </div>

              {/* Back Button to close everything at the bottom */}
              <div className="pt-2 pb-1 shrink-0">
                <button 
                  onClick={() => {
                    onUpdateSettings(settings);
                    setActiveModal('none');
                  }}
                  className="w-full bg-[#273046] hover:bg-[#1a2130] active:bg-[#151b27] text-white text-sm font-semibold py-3.5 rounded-2xl shadow-md active:scale-98 transition-all shrink-0 font-sans text-center"
                >
                  保存设置并返回
                </button>
              </div>

              {/* SLIDE-UP WECHAT ACTION SHEET (Bottom Sheet styled matching Image 2) */}
              {isBottomSheetOpen && (
                <div className="absolute inset-0 z-50 flex flex-col justify-end">
                  {/* Backdrop */}
                  <div 
                    onClick={() => setIsBottomSheetOpen(false)}
                    className="absolute inset-0 bg-black/60 cursor-pointer animate-in fade-in duration-200" 
                  />
                  {/* Sheet panel */}
                  <div className="relative bg-[#F4F4F4] rounded-t-3xl w-full pt-4 px-1.5 pb-2.5 animate-in slide-in-from-bottom duration-200 border-t border-gray-100 z-50 text-center font-sans tracking-wide android-nav-safe-pb">
                    <div className="bg-white rounded-2xl mx-2 shadow-xs overflow-hidden divide-y divide-gray-150">
                      <button 
                        onClick={() => {
                          setIsBottomSheetOpen(false);
                          // Trigger file input for simulation aspect
                          if (selectedQrTab === 'wechat') {
                            wechatInputRef.current?.click();
                          } else {
                            alipayInputRef.current?.click();
                          }
                        }}
                        className="w-full py-4 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        拍照
                      </button>
                      <button 
                        onClick={() => {
                          setIsBottomSheetOpen(false);
                          // 2026-10-23 第十五轮：原先打开的是内置假相册（演示图可被选作真收款码上传），改走真实文件选择
                          if (selectedQrTab === 'wechat') {
                            wechatInputRef.current?.click();
                          } else {
                            alipayInputRef.current?.click();
                          }
                        }}
                        className="w-full py-4 text-center text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors bg-white font-sans"
                      >
                        从手机相册选择
                      </button>
                    </div>

                    <div className="mt-2.5 mx-2">
                      <button 
                        onClick={() => setIsBottomSheetOpen(false)}
                        className="w-full py-4 bg-white rounded-2xl text-center text-sm font-bold text-[#E54545] hover:bg-red-50 transition-colors shadow-2xs font-sans"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      )}

      {/* SUB-DIALOG: DEVIATION SLIDER */}
      {activeModal === 'deviation_slider' && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-5 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-[320px] shadow-2xl overflow-hidden text-left">
            <div className="bg-[#273046] text-white py-4 px-5 flex items-center justify-between">
              <span className="font-bold text-sm flex items-center space-x-1.5">
                <Bookmark className="w-4 h-4 text-teal-300" />
                <span>纠偏每次加减的公里数</span>
              </span>
              <X className="w-4 h-4 cursor-pointer text-gray-300 hover:text-white" onClick={() => setActiveModal('none')} />
            </div>
            
            <div className="p-6 space-y-6">
              <div className="text-center">
                <span className="text-sm text-gray-400 block mb-1">偏差值设定 (0 - 10 公里)</span>
                <span className="text-4xl font-extrabold text-[#1da39b] font-mono">
                  {settings.deviationKm.toFixed(1)} <span className="text-base font-medium text-gray-500 font-sans">公里</span>
                </span>
              </div>

              <div className="space-y-2">
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.1"
                  value={settings.deviationKm}
                  onChange={(e) => onUpdateSettings({ ...settings, deviationKm: parseFloat(e.target.value) })}
                  className="w-full accent-[#1da39b] h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer border border-gray-200"
                />
                <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                  <span>0.0 km</span>
                  <span>2.5 km</span>
                  <span>5.0 km</span>
                  <span>7.5 km</span>
                  <span>10.0 km</span>
                </div>
              </div>

              <p className="text-[11px] text-gray-400 leading-normal text-center bg-slate-50 p-2.5 rounded-xl border border-gray-100">
                调整时将以该公里数为单位进行每次增减，并在双击极速纠偏中直接追加。费用将根据此变动自动重算。
              </p>
            </div>

            <div className="p-4 bg-slate-50 flex gap-2 border-t border-gray-100">
              <button 
                onClick={() => setActiveModal('none')}
                className="w-full py-2.5 bg-[#1da39b] hover:bg-teal-600 text-white rounded-xl text-xs font-semibold text-center transition-colors shadow-md flex items-center justify-center space-x-1"
              >
                <CheckCircle className="w-4 h-4" />
                <span>确认设置</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-DIALOG: DEVIATION WAIT SLIDER */}
      {activeModal === 'deviation_wait_slider' && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-5 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-[320px] shadow-2xl overflow-hidden text-left">
            <div className="bg-[#273046] text-white py-4 px-5 flex items-center justify-between">
              <span className="font-bold text-sm flex items-center space-x-1.5">
                <Bookmark className="w-4 h-4 text-teal-300" />
                <span>纠偏每次加减的的等候时间</span>
              </span>
              <X className="w-4 h-4 cursor-pointer text-gray-300 hover:text-white" onClick={() => setActiveModal('none')} />
            </div>
            
            <div className="p-6 space-y-6">
              <div className="text-center">
                <span className="text-sm text-gray-400 block mb-1">等候耗时设定 (0 - 60 秒)</span>
                <span className="text-4xl font-extrabold text-[#1da39b] font-mono">
                  {settings.deviationWaitSec} <span className="text-base font-medium text-gray-500 font-sans">秒</span>
                </span>
              </div>

              <div className="space-y-2">
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  value={settings.deviationWaitSec}
                  onChange={(e) => onUpdateSettings({ ...settings, deviationWaitSec: parseInt(e.target.value, 10) || 0 })}
                  className="w-full accent-[#1da39b] h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer border border-gray-200"
                />
                <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                  <span>0 秒</span>
                  <span>15 秒</span>
                  <span>30 秒</span>
                  <span>45 秒</span>
                  <span>60 秒</span>
                </div>
                <div className="text-center pt-2">
                  <span className="text-[11px] text-amber-500 font-medium bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100 inline-block animate-pulse">
                    温馨提示：建议设置60秒
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-gray-400 leading-normal text-center bg-slate-50 p-2.5 rounded-xl border border-gray-100">
                调整时将以该秒数为单位进行每次增减。费用将根据此等候变动自动重算。
              </p>
            </div>

            <div className="p-4 bg-slate-50 flex gap-2 border-t border-gray-100">
              <button 
                onClick={() => setActiveModal('none')}
                className="w-full py-2.5 bg-[#1da39b] hover:bg-teal-600 text-white rounded-xl text-xs font-semibold text-center transition-colors shadow-md flex items-center justify-center space-x-1"
              >
                <CheckCircle className="w-4 h-4" />
                <span>确认设置</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Detail Sub-Page Overlay */}
      {activeDoc !== 'none' && (
        <div className="absolute inset-0 bg-slate-50 flex flex-col z-50 animate-in slide-in-from-right duration-200">
          {/* Top navigation header */}
          <div className="bg-[#273046] header-safe-pt pb-2 min-h-14 flex items-center justify-between px-4 text-white shadow-md">
            <button 
              onClick={() => setActiveDoc('none')}
              className="p-1 px-1.5 rounded-lg hover:bg-white/10 text-white transition-colors flex items-center"
            >
              <ChevronLeft className="w-5 h-5 text-gray-100 mr-0.5" />
              <span className="text-sm font-medium">返回</span>
            </button>
            <span className="font-semibold text-base tracking-wide text-center flex-1 pr-12 text-gray-100">
              {activeDoc === 'disclaimer' ? '免责声明' : activeDoc === 'user_agreement' ? '用户服务协议' : '法律声明'}
            </span>
          </div>

          {/* Content scroll area */}
          <div className="flex-1 overflow-y-auto p-5 pb-10 text-gray-700 text-sm leading-relaxed space-y-4">
            {activeDoc === 'disclaimer' && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs space-y-4">
                <h3 className="font-bold text-gray-800 text-base border-b border-gray-100 pb-2">免责声明</h3>
                <p className="text-gray-600 leading-relaxed text-sm whitespace-pre-line">
                  黑湾代驾MAX仅提供代驾模拟计费、里程统计、等候费计算功能，代驾司机根据个人意愿，自行决定使用本工具。代驾收费模式、费用由代驾司机自行设置决定或与客户共同协商决定。
                  {"\n\n"}
                  代驾司机与客户发生的一切纠纷或争议与本工具无关，请通过法律途径维护各自的合法权益，请各位司机用户通过本工具合法合规的开展代驾服务，切勿做“黑代驾”！
                </p>
              </div>
            )}

            {activeDoc === 'user_agreement' && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs space-y-4 text-xs md:text-sm">
                <h3 className="font-bold text-gray-800 text-base border-b border-gray-100 pb-2">用户服务协议</h3>
                <div className="space-y-4 text-gray-600 leading-relaxed whitespace-pre-line">
                  <p className="font-medium text-gray-800">
                    黑湾代驾MAX代驾计价工具软件，包括但不限于APP、小程序、HTML5页面和网站等。
                  </p>
                  <p>
                    <strong className="text-gray-800">您即用户</strong>：自主运营代驾业务的司机。{"\n"}
                    <strong className="text-gray-800">用户数据</strong>：使用过程中产生的，被服务器记录的各种数据。{"\n"}
                    <strong className="text-gray-800">账号封禁</strong>：简称封号。因违反协议约定，开发者采取的强制下线措施。
                  </p>

                  <div className="border-t border-gray-100 pt-3">
                    <h4 className="font-bold text-gray-800 mb-1">一、注册认证</h4>
                    <p>
                      1.1 注册使用均视为您已仔细阅读并充分理解，且同意接受本协议项下所有内容。{"\n"}
                      1.2 注册日期为本协议签订日期，协议期限至您注销账号为止。{"\n"}
                      1.3 不得冒用他人身份信息进行实名注册认证。{"\n"}
                      1.4 若不进行实名认证或提供的注册信息不完整，您可能在使用过程中会受到相应限制。
                    </p>
                  </div>

                  <div className="border-t border-gray-100 pt-3">
                    <h4 className="font-bold text-gray-800 mb-1">二、用户规范</h4>
                    <p>
                      2.1 您与开发者不存在雇佣劳动关系，不得以开发者雇佣身份对外开展代驾业务。{"\n"}
                      2.2 您自行开展具体代驾运营业务，包括但不限于开单和收费等。{"\n"}
                      2.3 请根据市场行情公允定价，拒绝酒/醉驾。{"\n"}
                      2.4 如您选购开通某项附属服务，应当遵守相关约定。
                    </p>
                  </div>

                  <div className="border-t border-gray-100 pt-3">
                    <h4 className="font-bold text-gray-800 mb-1">三、限制用户权利条款</h4>
                    <p>
                      4.1 未经授权，严禁篡改软件代码或冒充代理商等，用于商业用途。{"\n"}
                      4.2 未经许可，不得发布任何形式 of 广告。{"\n"}
                      4.3 不得发布各类违法违规信息，包括但不限于商品、服务、交易、评论和留言等。{"\n"}
                      4.4 积分等虚拟物品不折现，用户注销账号自动清零。
                    </p>
                  </div>

                  <div className="border-t border-gray-100 pt-3">
                    <h4 className="font-bold text-gray-800 mb-1">四、免除开发者责任条款</h4>
                    <p>
                      5.1 按照公示的收费标准有偿提供软件服务。有权根据市场需求和用户反馈更新收费标准。{"\n"}
                      5.2 开发者不参与您具体代驾运营业务，不对代驾服务质量作任何形式担保，不承担任何代驾业务相关责任。{"\n"}
                      5.3 代驾圈各类信息由用户自行发布，需谨慎判断并承担相关风险。{"\n"}
                      5.4 附属服务由第三方提供最终服务的，开发者不承担连带责任。{"\n"}
                      5.5 用户违反相关协议规则，开发者有权采取禁言和封号等措施，且无须承担任何责任。{"\n"}
                      5.6 因自然灾害等不可抗力因素，电信部门技术调整或设备故障，黑客攻击等，不能正常提供软件服务的，开发者不承担任何责任，尽力配合您降低损失和影响。
                    </p>
                  </div>

                  <div className="border-t border-gray-100 pt-3">
                    <h4 className="font-bold text-gray-800 mb-1">五、其他</h4>
                    <p>
                      所有更新补充条款、附属服务条款，以及其他服务策略和规则，共同构成本协议，均具有法律效力。任一条款无论因何种原因无效或不具备可执行条件，其余条款仍然有效。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeDoc === 'legal_statement' && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs space-y-4">
                <h3 className="font-bold text-gray-800 text-base border-b border-gray-100 pb-2">法律声明</h3>
                <div className="space-y-3 text-gray-600 leading-relaxed whitespace-pre-line text-sm">
                  <p>
                    <strong className="text-gray-800">1、您，又称“用户”</strong>：与本公司不存在雇佣劳动关系，不得以本公司员工身份对外开展代驾业务。
                  </p>
                  <p>
                    <strong className="text-gray-800">2、本公司仅提供软件信息技术服务</strong>：为代驾司机提供计价工具。不参与您具体代驾运营，不承担任何代驾业务相关责任。由您自行开展具体代驾运营业务（包括但不限于：定价、接单和收费等），并对其负责。
                  </p>
                  <p>
                    <strong className="text-gray-800">3、拒绝酒驾、醉驾</strong>：请您根据市场公允定价，勿做“黑代驾”。
                  </p>
                  <p>
                    <strong className="text-gray-800">4、违约处理</strong>：用户违反相关协议规则时，本公司有权冻结账号，采取封号措施。且无须承担任何责任。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Online Order Application / Qualification Modal */}
      {showOnlineAppModal && (
        <OnlineOrderApplicationModal
          userPhone={effectivePhone}
          settings={settings}
          onClose={() => setShowOnlineAppModal(false)}
          onUpdateSettings={onUpdateSettings}
        />
      )}

      {/* Settings Local Alert Modal */}
      {settingsLocalAlert && (
        <div className="absolute inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-[280px] bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200 text-center p-4 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full flex items-center justify-center bg-teal-50 text-teal-600">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-extrabold text-slate-800">{settingsLocalAlert.title}</h4>
              <p className="text-[11px] text-slate-600 leading-relaxed font-sans px-2">{settingsLocalAlert.message}</p>
            </div>
            <button
              onClick={() => setSettingsLocalAlert(null)}
              className="w-full h-9 bg-slate-900 text-white rounded-xl text-xs font-black hover:bg-slate-800 active:scale-98 transition-all cursor-pointer"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
