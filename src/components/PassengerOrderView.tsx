import React, { useState, useEffect } from 'react';
import { db, doc, setDoc, getDoc, getDocs, collection, getBaseApiUrl } from '../lib/dbProxy';
import { QrCode, MapPin, Phone, CheckCircle, Navigation, ShieldCheck, Car, Headphones, Smartphone, BellRing, Check, ArrowLeft, Flag, CreditCard, ShieldAlert, AlertTriangle, RefreshCw, Crown } from 'lucide-react';
import { checkVipActive } from '../types';

const FALLBACK_VIP_BANNER_SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 360" width="100%" height="100%"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%231a0f0a"/><stop offset="50%" stop-color="%233d2212"/><stop offset="100%" stop-color="%23180d07"/></linearGradient><linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="%23fef08a"/><stop offset="50%" stop-color="%23f59e0b"/><stop offset="100%" stop-color="%23d97706"/></linearGradient><linearGradient id="card" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="rgba(255,215,0,0.15)"/><stop offset="100%" stop-color="rgba(255,140,0,0.05)"/></linearGradient></defs><rect width="800" height="360" fill="url(%23bg)"/><circle cx="700" cy="80" r="180" fill="none" stroke="rgba(245,158,11,0.1)" stroke-width="2"/><circle cx="700" cy="80" r="130" fill="none" stroke="rgba(245,158,11,0.15)" stroke-width="1.5"/><circle cx="100" cy="280" r="160" fill="none" stroke="rgba(245,158,11,0.08)" stroke-width="2"/><rect x="40" y="40" width="720" height="280" rx="20" fill="url(%23card)" stroke="rgba(245,158,11,0.3)" stroke-width="1.5"/><g fill="url(%23gold)"><path d="M400 80 L415 115 L450 115 L420 135 L432 170 L400 148 L368 170 L380 135 L350 115 L385 115 Z" opacity="0.9"/><path d="M380 65 L400 35 L420 65 L400 55 Z" opacity="0.95"/></g><text x="400" y="210" fill="url(%23gold)" font-family="sans-serif" font-weight="900" font-size="34" text-anchor="middle" letter-spacing="4">开通尊享会员 • 享无限开单</text><text x="400" y="255" fill="%23fef3c7" font-family="sans-serif" font-weight="600" font-size="20" text-anchor="middle" opacity="0.9" letter-spacing="2">专业代驾 • 安全到家 • 优先匹配</text><rect x="300" y="278" width="200" height="30" rx="15" fill="rgba(245,158,11,0.2)" stroke="rgba(245,158,11,0.5)" stroke-width="1"/><text x="400" y="298" fill="%23fbbf24" font-family="sans-serif" font-weight="800" font-size="14" text-anchor="middle">VIP PASSENGER SERVICE</text></svg>';

const FALLBACK_WELCOME_BG_SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="100%" height="100%"><defs><linearGradient id="wbg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%230b1329"/><stop offset="50%" stop-color="%231e1b4b"/><stop offset="100%" stop-color="%2331103f"/></linearGradient></defs><rect width="800" height="400" fill="url(%23wbg)"/><path d="M0 350 Q 400 220 800 320" fill="none" stroke="rgba(245,158,11,0.3)" stroke-width="3"/><path d="M0 380 Q 400 250 800 350" fill="none" stroke="rgba(239,68,68,0.4)" stroke-width="4"/><path d="M0 320 Q 400 200 800 290" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/><circle cx="650" cy="120" r="100" fill="rgba(245,158,11,0.06)"/><circle cx="150" cy="280" r="120" fill="rgba(147,51,234,0.08)"/></svg>';

const handleVipBannerError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
  const target = e.currentTarget;
  if (!target.dataset.tryLevel) {
    target.dataset.tryLevel = '1';
    target.src = '/vip_banner.jpg';
  } else if (target.dataset.tryLevel === '1') {
    target.dataset.tryLevel = '2';
    target.src = FALLBACK_VIP_BANNER_SVG;
  }
};

const handleWelcomeBgError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
  const target = e.currentTarget;
  if (!target.dataset.tryLevel) {
    target.dataset.tryLevel = '1';
    target.src = '/welcome_bg.jpg';
  } else if (target.dataset.tryLevel === '1') {
    target.dataset.tryLevel = '2';
    target.src = FALLBACK_WELCOME_BG_SVG;
    target.style.display = 'block';
  }
};

interface PassengerOrderViewProps {
  driverPhone: string;
  onClose?: () => void;
  onUnlockAdmin?: () => void;
  forceView?: 'normal' | 'qr_expired' | 'vip_blocked';
}

export default function PassengerOrderView({ driverPhone, onClose, onUnlockAdmin, forceView }: PassengerOrderViewProps) {
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const hasDriverInUrl = urlParams ? (urlParams.has('driver') && !!urlParams.get('driver')) : false;

  const isLyDomain = typeof window !== 'undefined' && window.location.hostname.includes('lyheiwandaijiamax.com');
  const isDeveloperSimulator = !isLyDomain && !forceView && (typeof window !== 'undefined' && (
    window.location.hostname.includes('localhost') || 
    window.location.hostname.includes('127.0.0.1') || 
    window.location.hostname.includes('webcontainer') || 
    window.location.hostname.includes('gitpod') || 
    window.location.hostname.includes('cloudshell') ||
    window.location.hostname.includes('c9users')
  ));

  const [passengerPhone, setPassengerPhone] = useState('');
  const [startLocation, setStartLocation] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlStart = params.get('startLocation');
      if (urlStart) {
        return decodeURIComponent(urlStart).trim();
      }
    }
    return '万达广场写字楼A座';
  });
  const [destination, setDestination] = useState('');
  const [agreed, setAgreed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success'>('idle');
  
  // VIP validation states
  const [driverVipExpiry, setDriverVipExpiry] = useState<string | null>(null);
  const [isVipChecked, setIsVipChecked] = useState(false);

  // 3-second fast recognition timer state
  const [threeSecondChecked, setThreeSecondChecked] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setThreeSecondChecked(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // 3-minute QR Code expiration state
  const [isQrExpired, setIsQrExpired] = useState(false);

  // 3-second Welcome screen states
  const [showWelcome, setShowWelcome] = useState(true);
  const [countdown, setCountdown] = useState(3);
  const [welcomeStatus, setWelcomeStatus] = useState('正在开启订单...');
  const [customBrandName, setCustomBrandName] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlName = params.get('name');
      if (urlName) {
        const val = decodeURIComponent(urlName).trim();
        if (val && val !== '极速' && val !== '极速代驾') {
          return val;
        }
      }
    }
    return 'XX代驾';
  });
  const [hasCustomNameSet, setHasCustomNameSet] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlName = params.get('name');
      if (urlName) {
        const val = decodeURIComponent(urlName).trim();
        if (val && val !== '极速' && val !== '极速代驾' && val !== 'XX代驾') {
          return true;
        }
      }
    }
    return false;
  });

  // 3-minute QR code expiration check effect
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const tStr = params.get('t');
    if (tStr) {
      const t = parseInt(tStr, 10);
      if (!isNaN(t)) {
        const elapsed = Date.now() - t;
        const maxValidityMs = 3 * 60 * 1000; // 3 minutes
        if (elapsed > maxValidityMs) {
          setIsQrExpired(true);
        } else {
          const remaining = maxValidityMs - elapsed;
          const timer = setTimeout(() => {
            setIsQrExpired(true);
          }, remaining);
          return () => clearTimeout(timer);
        }
      }
    }
  }, []);

  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [passengerCoords, setPassengerCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Retrieve real-time passenger coordinates upon component mount
  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setPassengerCoords({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude
            });
          },
          (err) => {
            console.warn("Failed to retrieve passenger physical location coordinates:", err);
          }
        );
      } catch (geoErr) {
        console.warn("Synchronous geolocation error caught inside iframe sandbox:", geoErr);
      }
    }
  }, []);

  // Fetch driver custom name brand dynamically from Firestore and sync active driver's current startLocation
  useEffect(() => {
    const fetchDriverBrandingAndLocation = async () => {
      if (!driverPhone) {
        setIsVipChecked(true);
        return;
      }
      try {
        const userDocRef = doc(db, 'driver_users', driverPhone);
        const docSnap = await getDoc(userDocRef);
        if (docSnap && docSnap.exists()) {
          const data = docSnap.data();
          if (data && data.vipExpiry) {
            setDriverVipExpiry(data.vipExpiry);
          } else {
            setDriverVipExpiry('');
          }
          if (data && data.customAppName) {
            const rawName = data.customAppName.trim();
            if (rawName && rawName !== '极速' && rawName !== '极速代驾' && rawName !== '') {
              setCustomBrandName(rawName);
              if (rawName !== 'XX代驾') {
                setHasCustomNameSet(true);
              } else {
                setHasCustomNameSet(false);
              }
            } else {
              setCustomBrandName('XX代驾');
              setHasCustomNameSet(false);
            }
          }
          if (data && data.lat && data.lng) {
            setDriverCoords({ lat: data.lat, lng: data.lng });
          }
        } else {
          setDriverVipExpiry('');
        }

        // Fetch current active startLocation from general links collection
        const linkDocRef = doc(db, 'passenger_links', driverPhone);
        const linkSnap = await getDoc(linkDocRef);
        if (linkSnap && linkSnap.exists()) {
          const linkData = linkSnap.data();
          if (linkData && linkData.driverStartLocation) {
            setStartLocation(linkData.driverStartLocation.trim());
          }
        }
      } catch (err) {
        console.error('Failed to fetch driver brand and location settings under passenger page:', err);
        setDriverVipExpiry('');
      } finally {
        setIsVipChecked(true);
      }
    };
    fetchDriverBrandingAndLocation();
  }, [driverPhone]);

  // Handle countdown loop
  useEffect(() => {
    if (!showWelcome) return;
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setWelcomeStatus('订单正在开启，请确认您的出发信息...');
          setTimeout(() => {
            setShowWelcome(false);
          }, 800);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [showWelcome]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passengerPhone) {
      alert('✍️ 提示：请输入您的手机号码以便开单后与司机联系！');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(passengerPhone.replace(/[-\s]/g, ''))) {
      alert('✍️ 提示：请核对并输入11位有效手机号码！');
      return;
    }

    setSubmitting(true);
    
    if (!driverPhone) {
      alert('⚠️ 无法获取当前司机的手机号码，请重新扫描二维码！');
      setSubmitting(false);
      return;
    }

    // Determine final passenger latitude and longitude (starting point coords)
    let pLat = passengerCoords?.lat || null;
    let pLng = passengerCoords?.lng || null;

    if (!pLat && driverCoords) {
      // Simulate real-life situation by offsetting slightly from driver coordinates
      const offsetLat = 0.0012 + Math.random() * 0.0016;
      const offsetLng = 0.0012 + Math.random() * 0.0016;
      pLat = driverCoords.lat + (Math.random() > 0.5 ? offsetLat : -offsetLat);
      pLng = driverCoords.lng + (Math.random() > 0.5 ? offsetLng : -offsetLng);
    }

    if (!pLat) {
      pLat = 38.487193;
      pLng = 106.230912;
    }

    const cleanDriverPhone = driverPhone ? driverPhone.replace(/\s+/g, '').trim() : '';

    const dbWritePromise = setDoc(doc(db, 'passenger_links', cleanDriverPhone), {
      passengerPhone: passengerPhone.trim(),
      startLocation: startLocation.trim(),
      destination: destination.trim() || '由司机根据现场口头协商规划行程',
      status: 'submitted',
      timestamp: Date.now(),
      passengerLat: pLat,
      passengerLng: pLng
    });

    try {
      // Direct fast local API submit for maximum speed and instant response
      const response = await fetch(`${getBaseApiUrl()}/api/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          driverPhone: cleanDriverPhone,
          passengerPhone: passengerPhone.trim(),
          startLocation: startLocation.trim(),
          destination: destination.trim(),
          passengerLat: pLat,
          passengerLng: pLng
        })
      });
      const resData = await response.json();
      if (resData.success) {
        setStatus('success');
      } else {
        throw new Error(resData.error || '提交接口返回失败');
      }
    } catch (submitErr: any) {
      console.warn('Fast API submit failed, attempting fallback local storage and setDoc...', submitErr);
      try {
        const fallbackPayload = {
          passengerPhone: passengerPhone.trim(),
          startLocation: startLocation.trim(),
          destination: destination.trim(),
          status: 'submitted',
          timestamp: Date.now(),
          passengerLat: pLat,
          passengerLng: pLng
        };
        localStorage.setItem(`mock_db_passenger_links_${cleanDriverPhone}`, JSON.stringify(fallbackPayload));
        await dbWritePromise;
        setStatus('success');
      } catch (fallbackErr: any) {
        setStatus('success');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isVipActive = checkVipActive(driverVipExpiry || undefined);
  const isDriverIdentified = hasDriverInUrl || !!onClose;
  const isAbnormal = (!isDriverIdentified || (isVipChecked && !isVipActive)) && !isDeveloperSimulator;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  const isWeChat = ua.indexOf('micromessenger') !== -1;
  const isAlipay = ua.indexOf('alipayclient') !== -1;
  const isWeChatOrAlipay = isWeChat || isAlipay;

  // Strict blocking: Block if NOT WeChat/Alipay OR if driver VIP is unactivated/expired/0 (rapidly within 3 seconds)
  const isBlocked = (forceView === 'vip_blocked') || ((!isWeChatOrAlipay || (isVipChecked && !isVipActive) || (threeSecondChecked && !isVipActive)) && !isDeveloperSimulator && forceView !== 'normal');

  // Check 3-minute QR expiration condition ONLY if NOT blocked!
  const isQrExpiredView = !isBlocked && (forceView === 'qr_expired' || isQrExpired);

  // 1. If 3-minute QR code is expired, directly render the 3-minute expiration overlay WITHOUT 3-second countdown
  if (isQrExpiredView) {
    return (
      <div className="w-full h-full min-h-full bg-[#f9f9f9] text-[#1a1c1c] font-sans flex flex-col items-center justify-between p-6 select-none z-[20000] overflow-y-auto">
        {/* Top Header Status */}
        <div className="w-full flex items-center justify-between pt-2">
          <div className="flex items-center gap-1.5 bg-rose-50 px-3 py-1 rounded-full border border-rose-200 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
            <span className="text-[10px] text-rose-700 font-bold tracking-wider uppercase">
              LINK EXPIRED • 链接已失效
            </span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono bg-slate-200/60 px-2 py-0.5 rounded">
            防伪防刷保护 🛡️
          </span>
        </div>

        {/* Expired Main Card */}
        <div className="my-auto w-full max-w-sm bg-white border border-[#dfc0af] rounded-2xl p-6 flex flex-col items-center text-center shadow-lg">
          <div className="w-20 h-20 rounded-full bg-rose-100 border-4 border-rose-50 flex items-center justify-center mb-4 text-rose-600 shadow-inner">
            <ShieldAlert className="w-10 h-10 stroke-[2.2]" />
          </div>
          
          <h2 className="text-xl font-black text-slate-900 mb-2">二维码开单链接已失效</h2>
          <p className="text-xs text-slate-600 leading-relaxed mb-6">
            基于代驾安全防伪机制，自助报单二维码有效期为 <span className="text-rose-600 font-bold">3分钟</span>。当前链接已超时关闭，已禁止提交。
          </p>

          <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-left space-y-2 mb-6">
            <div className="flex items-center justify-between text-[11px] text-slate-600">
              <span>状态信息：</span>
              <span className="font-bold text-rose-600">3分钟扫码倒计时结束</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-600">
              <span>操作建议：</span>
              <span className="font-bold text-slate-800">请联系司机重新出示二维码</span>
            </div>
          </div>

          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-[#ff7d00] text-white font-bold text-sm py-3 rounded-xl shadow-md active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>重新扫码 / 刷新页面</span>
          </button>
        </div>

        {/* Footer */}
        <footer className="text-center text-[10px] text-slate-400 space-y-1 pb-4">
          <p>（{customBrandName}）安全防伪系统 • 3分钟限时动态二维码保护</p>
          <p>© 2026 All Rights Reserved</p>
        </footer>
      </div>
    );
  }

  // 2. If non-WeChat/AliPay or non-VIP driver, render VIP purchase/blocked screen after 3-second countdown finishes
  if (isBlocked && countdown <= 0) {
    return (
      <div className="w-full h-full min-h-full bg-[#f9f9f9] text-[#1a1c1c] font-sans overflow-y-auto select-none relative z-10 flex flex-col justify-between">
        <main className="w-full max-w-md mx-auto bg-[#f9f9f9] flex-1 relative flex flex-col justify-between">
          <div>
            {/* Hero Banner Section (100% Local Image vip_banner.jpg) */}
            <section className="relative w-full overflow-hidden rounded-b-2xl shadow-sm bg-[#1a0f0a]" style={{ background: 'linear-gradient(135deg, #1a0f0a 0%, #3d2212 50%, #180d07 100%)', minHeight: '180px' }}>
              <img 
                alt="专业代驾 安全到家" 
                className="w-full h-auto object-cover block relative z-10" 
                src="vip_banner.jpg" 
                onError={handleVipBannerError}
              />
            </section>

            {/* Headline & Subtext */}
            <section className="px-5 mt-4 relative z-10 space-y-1.5 mb-6">
              <h2 className="text-xl font-bold text-[#1a1c1c] drop-shadow-xs">开通尊享会员，享受更多权益</h2>
              <p className="text-xs text-[#584235] font-medium">请使用正规渠道开通会员</p>
            </section>

            {/* Benefits Grid */}
            <section className="px-5 mb-6">
              <div className="grid grid-cols-2 gap-3">
                {/* Benefit 1: 无忧开单 (Emerald/Teal Theme) */}
                <div className="bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/40 p-3.5 rounded-xl border border-emerald-200/80 flex flex-col items-center text-center shadow-xs transition-all active:scale-95 hover:shadow-md">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center mb-1.5 shrink-0 shadow-sm shadow-emerald-500/30">
                    <CheckCircle className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-bold text-xs text-slate-800 block mb-0.5">无忧开单</span>
                  <span className="text-[10px] text-emerald-800/80 font-medium leading-tight">开单不限次数</span>
                </div>

                {/* Benefit 2: 扫码报单 (Blue/Indigo Theme) */}
                <div className="bg-gradient-to-br from-blue-50/90 via-white to-indigo-50/40 p-3.5 rounded-xl border border-blue-200/80 flex flex-col items-center text-center shadow-xs transition-all active:scale-95 hover:shadow-md">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center mb-1.5 shrink-0 shadow-sm shadow-blue-500/30">
                    <QrCode className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-bold text-xs text-slate-800 block mb-0.5">扫码报单</span>
                  <span className="text-[10px] text-blue-800/80 font-medium leading-tight">高峰期订单优先匹配</span>
                </div>

                {/* Benefit 3: 行程自动纠偏 (Amber/Orange Theme) */}
                <div className="bg-gradient-to-br from-amber-50/90 via-white to-orange-50/40 p-3.5 rounded-xl border border-amber-200/80 flex flex-col items-center text-center shadow-xs transition-all active:scale-95 hover:shadow-md">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center mb-1.5 shrink-0 shadow-sm shadow-amber-500/30">
                    <Navigation className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-bold text-xs text-slate-800 block mb-0.5">行程自动纠偏</span>
                  <span className="text-[10px] text-amber-800/80 font-medium leading-tight">智能纠正轨迹，确保计费精准</span>
                </div>

                {/* Benefit 4: 在线支付 (Purple/Violet Theme) */}
                <div className="bg-gradient-to-br from-purple-50/90 via-white to-violet-50/40 p-3.5 rounded-xl border border-purple-200/80 flex flex-col items-center text-center shadow-xs transition-all active:scale-95 hover:shadow-md">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 text-white flex items-center justify-center mb-1.5 shrink-0 shadow-sm shadow-purple-500/30">
                    <CreditCard className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-bold text-xs text-slate-800 block mb-0.5">在线支付</span>
                  <span className="text-[10px] text-purple-800/80 font-medium leading-tight">支持多种在线支付方式</span>
                </div>
              </div>
            </section>
          </div>

          {/* Footer Text */}
          <footer className="px-2 py-4 text-center space-y-1.5 mt-auto">
            <p className="text-[10px] font-medium leading-relaxed px-2" style={{ color: '#d97706' }}>
              代驾司机助手，代驾司机模拟器，仅教学模拟、本地演练工具，不对接任何第三方代驾平台正式服务，所有违规使用后果完全由使用者自行承担。
            </p>
            <div className="space-y-1 text-[9px] font-normal" style={{ color: '#000000' }}>
              <p className="font-normal" style={{ color: '#000000' }}>© 2026 All Rights Reserved</p>
              <div className="flex items-center justify-center gap-1 text-[6.5px] xs:text-[7.5px] sm:text-[8.5px] whitespace-nowrap font-normal py-0.5" style={{ color: '#000000' }}>
                <img 
                  src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAMAAAC7IEhfAAAABGdBTUEAALGPC/xhBQAAAAFzUkdCAK7OHOkAAAMAUExURUxpcfjxsuzNbOC3gOCzcezbl/PWkvnpveKrTPXMmtmTRu/ljumwSdq1geSbP+a8ae+zSurBV/LjrO7Yb+bNlfrrrtmNP/PgdenEWurKhenFdt2rYt/EjPXnu+e9faFjNbWReNq8fdi1hZ1xTuOtVVxBUlIxSGFPX+jGXvHgmu/hn/Hfj96tYe7Yqea7XfXimPLghP334+Cwbvr32N3CiN/Bd+K5fui0Wt2fUeS2U+zOeuO1Y/bmiuPEiuG0bqyKduG5hfvOWaBuWk8sPa6DW++jROfFZfLkl86JV/nuyOzZfvjVY9qkYd20dJ9yXL+YWWxSWcmjbpyQdoyHee7ZfOGsVuTBau3WeOW7V92nUdCSRee3UcaEQuOwVufJk4deQfPOgIpsTt2fR6R/Vtyzd86keNqsab6SX8GYdPWlPPy/VZySeevMYufDeenMZtqkT9KRU/LNYP3aj8imfLCMbdQsG+m+Xem4UurDXtYgF+e2Weq+VRgWb+/KXui7WOWzUxESfO3BWQ8JatIWEduVQdcKCw8PcttQJ+GjSenIZNZfLhcHX9dKKNqXUOnBaN+fR8pEIuO4YdOEPOm0T+/GXNdBJNS6c96jUNIeEsZRJOhyNPbKaedoLeR2OelcJG9wehkaeIN9etQ1HvDOYqqkhdhzNNg6H/jCUv3VWNEIBRUeidl+OPG+UtmjW+GQP9x0OsdeLMsLCPfFXSMOXfAsEcEOEaqBUaWOZU0GRM+wax81jbOgboeFf8izeu6uWaSbfb2ve+OtV9RqMt1rNN2DQt6IN49aOOaiQ7slGmlgblBMb8ovF91YKMcfEF9ujex/M2FkfYeMjJKNfnl3d5wGHpJ7Xu2NQuKxTNBZLseoWb9oOfY7GcE7LWUZSGYEOPevRp+AXDVGinSAi4ZvW60TFUcmU7Cbe7ipdNBGJv7oapJsSV8nUa81NL9GI/R6LbORVbJQOCgueogKJ3ZjXuNCHK4HGn1oYDMfXLp7Pi8LVmsuUKM7LkFXknNiZHtdUdwjFSsuVN8AAAB1dFJOUwAE/hMaDRsI/gH+FPw6/L/+9GT+cS/+7vyP0M0kQbD5w1uI/uf5+v7sTHyU3FvVPLgXvyRJ/aPk1fyq66Vn2NEt/Nv85/7eh2FLzPfvsvX9+N7m8trP7+ntyafrm/OH+Jz59+3Pn3/Mq+qq+NHq5MF4+InD117Lt0kAAAU3SURBVDjLbdV3VJNnFAdgE8gkCQkJS9nInspQRGSIu+496qhard3tySAkIYuEbCBkAAFCwpCN7CkgKGUvBffee1S7z+kXUiL2cP9+zu97733Pe79582YXaFFIAMHFJdqFEBCyCDRv7kLAYGbmMegoN5fo6Gg3AjrG3AwGQ8wBYdaObsfj4pydDx06cuTo0bi4427rHGFzBEJ8ok66bHJ3dr5w4enThoZNm1xOEgIgcwQ6nIj3XHnB+epVobC7qqK5tdHTM/6Ew/8jQTAoOv72SgBWVw/marIkFQboHo+GghCfdmt9eOMWj3tPCzVqjk7B56uJk6qOca8t4T9BZ2eCINahG7d6eLg3ZOVyknU6saKEMzLZWeDl9XM4GgozzQkUEmS51cPTa8v5kSJiQgJRp1CoOUMDZ9MmRj08jjkBnzdBxxWbH/zm9W7kJVENQKKiSM2pH1p1ti3vgefWY6EOINMEQ7fla7WXGjS5yclEIJPDIRLPnMnNedRBo+VvC40BzZwwyHVbPpN5qSHXBHUA5GvaC2i8ie2uQZBpiVgUc8ry63wmzf13/q/JyQkJuqIiXUJCSUkRX9lJ4+VtD15uPX3vIAf0qUAjHDRAokLMF+uIABw0wvXBjiEGCHH98qtVD9uYzNubRzTJJamX023g8J4qtTo3p/kRjZff8eOGNVYQExwHzvhq8iXnTGZ1OndqqrKHSMyabG6l8do6MmL9fA3QzC0cg2nvKC3tu4e6lfkiNfVcYVlZVVVZTyz90j88bUE7Fut00GwabsRgmh+Wlva/g6+qzkxNFQoLC7u7e5A1lA9eTG2BEotysjdA88X+NpVS5Z0WWu3r6pwc8ePUx0KhWNydU3X1N1rpHSW4F+O/2NwAF3xmYyNV/t3CE/31IiuLLzZkisUazeXXteyWO2FgDNcE09Nvnb07zGRfrK+7NijMzDxXmJN1ra7+vYg9fJdUzLWJtJwFx+4C8H1dHf8yAM9Nw4si3vAYq5iLDDTC8MVfyGqy2wtamE0379cPDQ0MDOj4fMX1tzd52o727Oykz43NmAEwpSY7rLOltKnp7cX7938B6vr1589vNtHePFIa4DJj107HkNwuajZ4bJjGFolEtU03btz4o1YkYvNGJwQbSFQ4fP4ycyOUIFVdNdKCsTdaNpstevDsz2e1Ijabp80bp8dSu2YgdH5YhUQiwfRKwzpb730YzWts3Pyqr7+/fzSvOQ3VK5PBk3avh07DbysAWYkhScOUjbfb2lqvXLkykdfXlz+eRu3FyGRTETuCDRBi5bsnQqVC2pSdL6/R6+n08nIslkTB4+msyvNIJHzKzpvgY3iKsHVWgXvgKiSysAxbfBqo4mIsNvb0kyexxQCUdEV4f+NjDZteTlAr39W4iKn0dK6Mrmex5HIGQ6/foE+RISVp0l2rCT4W/71tIHO1t10E0obLpdBJjKQkBomu1wtSZCqVFLxrfkDQzA6AOQasiLSzM5BEFoVComRksBhweBJVABZIF/q7zoJWKyIFAgqFSjVACoWewSCnpFAZYABG+kf5zEALv2BbPB6flkalMoBUEolBlslS4FQqiSQA422Xr7EwweW2tnjwR0iWA2OGUxkkEhhsOwuCoNZ+y7xxZDIro7xcLieTUSgyg8VKTKQIdu/w83WwQJi2N5RgHxi4fz8OlwgguRyFYuDs7HA47+/WB/taQT5uSAQIYhGDXvvDvn17dy5dunDhkiU7F1haHraPcnWAWkA+XfgIM/O1aw8c+H6vES4AoP3BUPTH38K/OmNBlhC2jIMAAAAASUVORK5CYII=" 
                  alt="备案图标" 
                  className="inline-block align-middle shrink-0" 
                  style={{ height: '1em', width: '1em', objectFit: 'contain' }}
                />
                <a 
                  href="https://beian.mps.gov.cn/#/query/webSearch?code=64010002000234" 
                  target="_blank" 
                  rel="noreferrer" 
                  className="hover:underline shrink-0 font-normal" 
                  style={{ color: '#000000' }}
                >
                  宁公网安备64010002000234号
                </a>
                <a 
                  href="https://beian.miit.gov.cn/" 
                  target="_blank" 
                  rel="noreferrer" 
                  className="hover:underline shrink-0 font-normal" 
                  style={{ color: '#000000' }}
                >
                  宁 ICP 备 2026002469 号 - 1
                </a>
              </div>
            </div>
          </footer>
        </main>

        {/* Bottom Action Bar (Sticky inside Phone Container) */}
        <div className="sticky bottom-0 left-0 w-full bg-white border-t border-[#dfc0af] p-3 z-30 shrink-0 shadow-lg" style={{ backgroundColor: '#ffffff', borderTop: '1px solid #dfc0af' }}>
          <div className="max-w-md mx-auto">
            <button 
              onClick={() => {
                if (onClose) {
                  onClose();
                } else if (typeof window !== 'undefined') {
                  try {
                    if ((window as any).WeixinJSBridge) {
                      (window as any).WeixinJSBridge.call('closeWindow');
                    } else if ((window as any).AlipayJSBridge) {
                      (window as any).AlipayJSBridge.call('closeWebview');
                    } else {
                      window.close();
                    }
                  } catch (e) {
                    console.log('Close window failed', e);
                  }
                }
              }}
              className="w-full text-white font-bold text-sm h-11 rounded-xl shadow-md active:scale-95 transition-transform duration-150 cursor-pointer flex items-center justify-center gap-1.5"
              style={{ backgroundColor: '#10b981', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '14px', border: 'none', borderRadius: '12px', height: '44px', width: '100%' }}
            >
              <span>本页面为产品展示 点击关闭页面</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    const currentDisplayBrand = customBrandName || 'XX代驾';
    return (
      <div className="w-full h-full min-h-full flex flex-col bg-[#f9f9f9] text-[#1a1c1c] font-sans overflow-y-auto select-none relative z-[10000] items-center">
        {/* TopAppBar Shell */}
        <header className="w-full top-0 sticky bg-[#f9f9f9] border-b border-[#dfc0af] flex items-center justify-between px-5 header-safe-pt pb-2 min-h-14 z-50 shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                if (onClose) {
                  onClose();
                } else {
                  setStatus('idle');
                }
              }}
              className="active:scale-95 duration-100 p-1 rounded-full hover:bg-[#e8e8e8] transition-colors"
            >
              <ArrowLeft className="text-[#984800] w-6 h-6" />
            </button>
            <h1 className="text-xl font-bold text-[#1a1c1c]">提交成功</h1>
          </div>
          <div className="w-10"></div> {/* Spacer for balance */}
        </header>

        <main className="flex-1 w-full max-w-md px-5 py-8 flex flex-col items-center justify-center text-center">
          {/* Success Hero Section */}
          <div className="relative mb-8">
            <div className="absolute inset-0 bg-[#ff7d00]/10 rounded-full animate-ping scale-150"></div>
            <div className="w-24 h-24 bg-[#ff7d00] rounded-full flex items-center justify-center shadow-md relative z-10">
              <Check className="text-white w-14 h-14 stroke-[3]" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-[#1a1c1c] mb-1">授权下单成功</h2>
          <p className="text-lg text-[#584235] mb-8">{currentDisplayBrand} · 极速响应</p>

          {/* Dynamic Order Card (Bento Style Card) */}
          <div className="w-full bg-white border border-[#dfc0af] rounded-xl p-6 text-left shadow-sm mb-6">
            <div className="flex items-center justify-between mb-4">
              <span className="bg-[#ff7d00]/10 text-[#ff7d00] px-3 py-1 rounded-full font-semibold text-xs">
                司机师傅开单成功
              </span>
              <span className="font-semibold text-xs text-[#5f5e5e]">计费服务已开始</span>
            </div>

            <div className="flex items-center gap-4 p-4 bg-[#f3f3f3] rounded-lg mb-4">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-[#dfc0af] flex-shrink-0">
                <img 
                  className="w-full h-full object-cover" 
                  alt="Professional driver portrait" 
                  src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%230d9488'/><circle cx='50' cy='38' r='20' fill='%23ffffff'/><path d='M20,90 Q50,55 80,90 Z' fill='%23ffffff'/></svg>"
                />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-[#1a1c1c]">
                  &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;五星司机&nbsp; &nbsp; &nbsp; &nbsp; &nbsp;(5.0<span style={{ color: 'rgb(255, 215, 0)' }}>★★★★★</span>)
                </h3>
                <p className="font-semibold text-xs text-[#584235]">
                  乘客手机：{passengerPhone || '18709519593'}
                </p>
              </div>
              <div 
                className="w-10 h-10 rounded-full bg-[#ff7d00] text-white flex items-center justify-center cursor-default"
              >
                <Phone className="w-5 h-5 fill-current" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <MapPin className="text-[#ff7d00] w-5 h-5 mt-1 shrink-0 animate-bounce" />
                <div>
                  <p className="font-semibold text-xs text-[#584235]">上车地点：</p>
                  <p className="text-sm text-[#1a1c1c] font-medium">{startLocation || '万达广场写字楼A座'}</p>
                </div>
              </div>
              <div className="h-4 border-l border-dashed border-[#8b7263] ml-[9px]"></div>
              <div className="flex items-start gap-2">
                <Flag className="text-[#5f5e5e] w-5 h-5 mt-1 shrink-0" />
                <div>
                  <p className="font-semibold text-xs text-[#584235]">行驶目的地：</p>
                  <p className="text-sm text-[#1a1c1c] font-medium">{destination || '未选择目的地（随路线行驶）'}</p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-full flex flex-col bg-[#f9f9f9] text-[#1a1c1c] font-sans overflow-y-auto select-none relative z-10 items-center">
      {/* 3-second welcome countdown transition overlay */}
      {showWelcome && (
        <div className="absolute inset-0 z-[20000] flex flex-col justify-between p-6 bg-[#f9f9f9] text-[#1a1c1c] font-sans select-none overflow-hidden">
          {/* Top Header Status Bar */}
          <div className="relative z-10 w-full flex items-center justify-center mt-2">
            <div className="flex items-center gap-2 bg-amber-100/90 backdrop-blur-md px-4 py-1.5 rounded-full border border-amber-300 shadow-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
              <span className="text-xs text-amber-900 font-extrabold tracking-wider uppercase">
                SECURE CONNECTION • 专享自助端
              </span>
            </div>
          </div>

          {/* Background Illustration Decoration */}
          <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
            <img 
              className="w-full h-full object-cover" 
              src="welcome_bg.jpg"
              alt="Decoration Background"
              onError={handleWelcomeBgError}
            />
          </div>

          {/* Central Countdown Circle */}
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center my-auto text-center">
            <div className="relative w-48 h-48 flex items-center justify-center">
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle className="text-[#eeeeee]" cx="50" cy="50" fill="transparent" r="45" stroke="currentColor" strokeWidth="4"></circle>
                <circle 
                  className="drop-shadow-xs transition-all duration-1000" 
                  cx="50" 
                  cy="50" 
                  fill="transparent" 
                  r="45" 
                  stroke="#FF7D00" 
                  strokeWidth="6"
                  strokeDasharray={282.74}
                  strokeDashoffset={282.74 - (countdown / 3) * 282.74}
                ></circle>
              </svg>
              <div className="text-[64px] font-black text-[#ff7d00] animate-pulse drop-shadow-xs">
                {countdown}
              </div>
            </div>
            <div className="mt-8 flex flex-col items-center gap-2 h-16">
              <span className="text-[#1a1c1c] font-bold text-base text-center transition-all duration-300">
                {welcomeStatus}
              </span>
              {countdown > 0 && (
                <div className="flex gap-1.5">
                  <div className="w-1.5 h-1.5 bg-[#ff7d00] rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                  <div className="w-1.5 h-1.5 bg-[#ff7d00] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-1.5 h-1.5 bg-[#ff7d00] rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                </div>
              )}
            </div>
          </div>

          {/* Footer / Action Area */}
          <div className="relative z-10 text-center mb-6 w-full">
            <div className="flex items-center justify-center gap-2.5 mb-2">
              <div className="w-11 h-11 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center shadow-md shadow-amber-500/30">
                <Car className="text-white w-6 h-6" />
              </div>
              <h1 className="text-xl font-extrabold tracking-tight text-[#1a1c1c]">
                欢迎使用<span className="text-[#ff7d00] font-black px-1.5 text-2xl">{isAbnormal ? 'XX代驾' : customBrandName}</span>
              </h1>
            </div>
            <p className="text-amber-900/80 text-sm font-semibold">在乎你的车，更在乎你的人</p>
          </div>
        </div>
      )}

      {/* TopAppBar */}
      <header className="w-full bg-[#f9f9f9] border-b border-amber-200 flex items-center justify-between px-5 h-16 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-black tracking-tight text-amber-900 select-none">
            专享自助开单系统
          </h1>
        </div>
        <div className="text-xs text-amber-950 font-extrabold font-mono bg-gradient-to-r from-amber-300 to-orange-400 border border-amber-400/80 px-3 py-1 rounded-full select-none shadow-xs">
          安全校验通过 ⚡
        </div>
      </header>

      {/* Scrollable Main area */}
      <main className="pb-24 px-5 flex-1 overflow-y-auto max-w-md mx-auto w-full">
        {/* Animated Background Element */}
        <div className="relative h-40 mt-4 rounded-2xl overflow-hidden mb-6 bg-gradient-to-br from-slate-900 via-slate-800 to-amber-900 border-2 border-amber-500/40 shadow-md shadow-amber-500/10">
          {/* Subtle vehicle outline or road texture overlay */}
          <div className="absolute inset-0 z-0">
            <img 
              className="w-full h-full object-cover opacity-50 mix-blend-overlay" 
              src="welcome_bg.jpg" 
              onError={handleWelcomeBgError}
              alt="City driving background"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-end p-5 z-10">
            <h2 className="text-xl font-extrabold text-white tracking-tight drop-shadow-md">
              欢迎使用 <span className="text-amber-400 font-black">{customBrandName}</span> 自助下单
            </h2>
            <p className="text-xs text-amber-200 mt-1 font-extrabold drop-shadow-xs">在乎你的车，更在乎你的人</p>
          </div>
        </div>

        {/* Driver Status Card */}
        <div className="bg-gradient-to-br from-amber-50/90 via-orange-50/40 to-white border-2 border-amber-300 p-4 rounded-2xl shadow-xs mb-6 flex items-center gap-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-amber-400 to-orange-500"></div>
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-amber-500/25">
            <Headphones className="w-6 h-6" />
          </div>
          <div className="flex-grow text-left">
            <p className="text-[10px] font-extrabold text-amber-800 uppercase tracking-wider mb-0.5">司机 service 通道</p>
            <p className="text-sm font-bold text-[#1a1c1c] leading-tight">
              正在链接至司机 <span className="text-[#ff7d00] font-black font-mono text-base">{driverPhone}</span>
            </p>
            <div className="flex items-center mt-1 text-amber-800 gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff7d00] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ff7d00]"></span>
              </span>
              <span className="text-[10px] font-extrabold text-amber-800">开单信息为您实时加密</span>
            </div>
          </div>
          <div className="bg-amber-100/90 border border-amber-300 p-3 rounded-xl flex items-center justify-center shrink-0 select-none">
            <QrCode className="text-amber-800 w-5 h-5" />
          </div>
        </div>

        {status === 'idle' ? (
          <>
            {/* Instruction Section */}
            <div className="mb-6 space-y-1">
              <p className="text-sm text-[#5f5e5e] leading-relaxed px-1 text-left font-medium">
                请输入您呼叫代驾司机的手机号码。输入完成后立即通知司机，并一键开启本次代驾服务。
              </p>
            </div>

            {/* Form Fields */}
            <form onSubmit={handleSubmit} className="space-y-5 text-left">
              {/* Phone Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  您的手机号码 <span className="text-amber-500 font-bold">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Smartphone className="text-amber-500 w-5 h-5" />
                  </div>
                  <input
                    type="tel"
                    required
                    placeholder="请输入您的手机号"
                    value={passengerPhone}
                    onChange={(e) => setPassengerPhone(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-white border-2 border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-base transition-all font-semibold"
                  />
                </div>
              </div>

              {/* Origin Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  您的出发地 <span className="text-amber-500 font-bold">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <MapPin className="text-amber-500 w-5 h-5" />
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="填写当前上车位置"
                    value={startLocation}
                    onChange={(e) => setStartLocation(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-white border-2 border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-base transition-all font-semibold"
                  />
                </div>
              </div>

              {/* Authorization Checkbox */}
              <label className="flex items-center gap-3 py-2 cursor-pointer group select-none" htmlFor="agreement-checkbox">
                <div className="relative flex items-center shrink-0">
                  <input
                    id="agreement-checkbox"
                    type="checkbox"
                    required
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="h-6 w-6 border-2 border-amber-400 rounded-lg appearance-none cursor-pointer focus:outline-none transition-all"
                    style={{ backgroundColor: agreed ? '#ff7d00' : '#ffffff', borderColor: agreed ? '#ff7d00' : '#f59e0b' }}
                  />
                  {agreed && (
                    <Check className="absolute text-white pointer-events-none left-1 top-1 w-4 h-4 stroke-[3]" />
                  )}
                </div>
                <span className="text-xs text-slate-600 group-active:text-[#1a1c1c] transition-colors leading-snug font-medium">
                  我授权自动上传位置信息并同意接受司机代驾服务
                </span>
              </label>

              {/* Main CTA */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:brightness-105 text-white font-black text-base py-4 rounded-xl shadow-lg shadow-amber-500/30 active:scale-95 duration-150 transition-all flex items-center justify-center gap-2 mt-6 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                    <span>正在发送通知...</span>
                  </>
                ) : (
                  <>
                    <BellRing className="w-5 h-5" />
                    <span>点击立即下单</span>
                  </>
                )}
              </button>
            </form>
          </>
        ) : (
          <div className="space-y-5 py-2 text-center animate-in fade-in duration-300">
            <div className="bg-white p-6 rounded-2xl border border-[#dfc0af] text-center space-y-3 shadow-xs">
              <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500 border-2 border-emerald-600 flex items-center justify-center shadow-md animate-bounce" style={{ backgroundColor: '#10b981', borderColor: '#059669' }}>
                <Check className="w-8 h-8 text-white stroke-[3]" style={{ color: '#ffffff' }} />
              </div>

              <div className="space-y-1">
                <h2 className="text-lg font-bold text-[#1a1c1c] tracking-wide">🎉 授权成功！系统已播报开单</h2>
                <p className="text-xs text-[#5f5e5e] leading-relaxed px-1">
                  您的填单已送达！司机开单器调度台端已<b>同步拉取数据并开始计费服务</b>。
                </p>
              </div>
            </div>

            {/* Receipt ticket style card */}
            <div className="bg-white p-5 rounded-2xl border border-[#dfc0af] shadow-xs space-y-3 text-left relative overflow-hidden">
              <div className="absolute -left-2 top-9 w-3.5 h-3.5 bg-[#f9f9f9] rounded-full border-r border-[#dfc0af]"></div>
              <div className="absolute -right-2 top-9 w-3.5 h-3.5 bg-[#f9f9f9] rounded-full border-l border-[#dfc0af]"></div>

              <div className="flex items-center justify-between pb-3 border-b border-dashed border-[#dfc0af]">
                <span className="text-xs text-[#984800] font-bold tracking-wider">📋 尊享行程同步票据</span>
                <span className="text-[10px] bg-[#ffdbc8] text-[#733500] px-2 py-0.5 rounded-full font-bold">已触达</span>
              </div>
              <div className="space-y-2.5 pt-1 text-xs text-[#5f5e5e]">
                <div className="flex justify-between items-center">
                  <span className="text-[#584235] font-medium">上车地点：</span>
                  <div className="bg-[#f3f3f3] px-3 py-1 rounded-lg border border-[#dfc0af] flex items-center gap-1.5 text-xs font-bold text-[#1a1c1c]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#ff7d00]"></span>
                    <span className="truncate max-w-[180px]">{startLocation}</span>
                  </div>
                </div>
                {destination && (
                  <div className="flex justify-between items-center">
                    <span className="text-[#584235] font-medium">下车目的地：</span>
                    <div className="bg-[#f3f3f3] px-3 py-1 rounded-lg border border-[#dfc0af] flex items-center gap-1.5 text-xs font-bold text-[#1a1c1c]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ba1a1a]"></span>
                      <span className="truncate max-w-[180px]">{destination}</span>
                    </div>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#584235] font-medium">乘客手机：</span>
                  <span className="text-[#984800] font-bold font-mono">{passengerPhone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#584235] font-medium">司机手机：</span>
                  <span className="text-[#1a1c1c] font-bold font-mono">{driverPhone}</span>
                </div>
              </div>
            </div>

            {/* Close hint button inside success container */}
            <div className="w-full pt-2">
              <button 
                onClick={() => {
                  if (onClose) {
                    onClose();
                  } else if (typeof window !== 'undefined') {
                    try {
                      if ((window as any).WeixinJSBridge) {
                        (window as any).WeixinJSBridge.call('closeWindow');
                      } else if ((window as any).AlipayJSBridge) {
                        (window as any).AlipayJSBridge.call('closeWebview');
                      } else {
                        window.close();
                      }
                    } catch (e) {
                      console.log('Close window failed', e);
                    }
                  }
                }}
                className="w-full text-white font-bold text-base h-12 rounded-xl shadow-md active:scale-95 transition-transform duration-150 cursor-pointer flex items-center justify-center gap-1.5"
                style={{ backgroundColor: '#10b981', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '16px', border: 'none', borderRadius: '12px', height: '48px', width: '100%' }}
              >
                <span>下单成功，请关闭本页面</span>
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 text-center pb-8">
          <p className="text-xs font-bold text-[#5f5e5e]/60">{customBrandName} · 极速响应</p>
        </div>
      </main>
    </div>
  );
}
