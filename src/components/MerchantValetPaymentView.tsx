import React, { useState, useEffect } from 'react';
import { ArrowLeft, ShieldCheck, Info, QrCode, Car } from 'lucide-react';
import { TripState, ChauffeurSettings } from '../types';
import { db, doc, onSnapshot, getBaseApiUrl } from '../lib/dbProxy';
import { autoUpdateOrderDestinationIfUnset, isUnsetDestination } from '../utils/locationResolver';

interface MerchantValetPaymentViewProps {
  trip: TripState;
  settings?: ChauffeurSettings;
  wechatClean?: string;
  onNavigateBack: () => void;
  onFinishTrip: (amount: number) => void;
}

// Helper to normalize image URLs with base API prefix when needed
const getFullQrUrl = (url: string): string => {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    const baseUrl = getBaseApiUrl();
    if (baseUrl && (baseUrl.startsWith('http://') || baseUrl.startsWith('https://'))) {
      return `${baseUrl.replace(/\/$/, '')}${trimmed}`;
    }
  }
  return trimmed;
};

export default function MerchantValetPaymentView({
  trip,
  settings,
  wechatClean,
  onNavigateBack,
  onFinishTrip
}: MerchantValetPaymentViewProps) {
  const [dispatcherQr, setDispatcherQr] = useState<string>('');

  const rawDispatchedBy = (
    (trip as any)?.reporterPhone ||
    (trip as any)?.dispatchedByPhone ||
    (trip as any)?.dispatchedBy ||
    (trip as any)?.dispatcherPhone ||
    (trip as any)?.adminPhone ||
    (trip as any)?.merchantPhone ||
    (trip as any)?.creatorPhone ||
    ''
  ).toString().trim();

  useEffect(() => {
    const activeDest = trip.endLocation || (trip as any).destination || (trip as any).dropoffName;
    if (isUnsetDestination(activeDest)) {
      autoUpdateOrderDestinationIfUnset(trip, settings?.phoneNumber);
    }
  }, [trip?.id]);

  const isWebChannel = Boolean(
    (trip as any)?.orderChannel === 'web' ||
    (trip as any)?.dispatchChannel === 'web' ||
    (trip as any)?.sourceChannel === 'web' ||
    (trip as any)?.isStandaloneMerchantWeb ||
    (trip as any)?.orderType === '商户代叫' ||
    (trip as any)?.type === '商户代叫' ||
    (trip as any)?.orderRemark === '商户代叫'
  );

  useEffect(() => {
    let isMounted = true;

    // Prioritize direct QR attached to the order if present
    const initialDirectQr = (trip as any)?.paymentQrCode || (trip as any)?.merchantPaymentQrCode || (trip as any)?.qrCode || (trip as any)?.wechatQrCode || '';
    if (initialDirectQr && initialDirectQr.trim()) {
      setDispatcherQr(initialDirectQr);
    }

    const candidatePhones = Array.from(new Set([
      rawDispatchedBy,
      (trip as any)?.merchantPhone,
      (trip as any)?.dispatchedByPhone,
      (trip as any)?.dispatchedBy,
      (trip as any)?.dispatcherPhone,
      (trip as any)?.reporterPhone,
      (trip as any)?.adminPhone,
      (trip as any)?.creatorPhone,
      (typeof window !== 'undefined' ? localStorage.getItem('dd_merchant_login_phone') : ''),
      (typeof window !== 'undefined' ? localStorage.getItem('dd_merchant_phone') : ''),
      (typeof window !== 'undefined' ? localStorage.getItem('dd_admin_phone') : ''),
      '15509601222'
    ].map(p => (p || '').toString().trim()).filter(Boolean)));

    // Check initial QR code matching the channel from localStorage immediately if not direct on trip
    if (!initialDirectQr) {
      for (const phone of candidatePhones) {
        if (!phone) continue;
        if (isWebChannel) {
          const webCached = localStorage.getItem(`dd_web_valet_wechat_qr_${phone}`) ||
                            localStorage.getItem(`dd_dispatch_wechat_qr_${phone}`) ||
                            localStorage.getItem(`dd_dispatch_fee_qr_${phone}`) ||
                            localStorage.getItem(`dd_merchant_user_qr_${phone}`);
          if (webCached) {
            setDispatcherQr(webCached);
            break;
          }
        } else {
          const appCached = localStorage.getItem(`dd_app_valet_wechat_qr_${phone}`) ||
                            localStorage.getItem(`dd_dispatch_wechat_qr_${phone}`) ||
                            (() => {
                              try {
                                const s = localStorage.getItem(`dd_settings_${phone}`);
                                if (s) return JSON.parse(s)?.wechatQrCode || '';
                              } catch (_) {}
                              return '';
                            })();
          if (appCached) {
            setDispatcherQr(appCached);
            break;
          }
        }
      }

      if (!dispatcherQr) {
        const fallbackGlobal = localStorage.getItem('dd_web_valet_wechat_qr') ||
                               localStorage.getItem('dd_dispatch_fee_qr_global') ||
                               localStorage.getItem('dd_merchant_web_qr') ||
                               localStorage.getItem('dd_dispatch_wechat_qr_15509601222') ||
                               localStorage.getItem('dd_dispatch_wechat_qr');
        if (fallbackGlobal) {
          setDispatcherQr(fallbackGlobal);
        }
      }
    }

    // High-availability Baota Node DB API polling for Mainland China direct server storage (No Firebase)
    const queryBaotaQr = async () => {
      if (!isMounted) return;
      const baseUrl = getBaseApiUrl();
      const timeToken = Date.now();
      const orderId = (trip as any)?.orderId || (trip as any)?.orderNumber || trip?.id;

      // 1. First attempt: Query merchant_orders on Baota server using orderId / orderNumber
      const orderCandidates = Array.from(new Set([orderId, (trip as any)?.orderNumber, trip?.id].filter(Boolean)));
      for (const candidateId of orderCandidates) {
        if (!isMounted) return;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2500);
          const resOrder = await fetch(`${baseUrl}/api/db/get?col=merchant_orders&id=${encodeURIComponent(candidateId)}&_t=${timeToken}`, { cache: 'no-store', signal: controller.signal });
          clearTimeout(timeoutId);
          if (resOrder.ok) {
            const jsonOrder = await resOrder.json();
            if (isMounted && jsonOrder?.data) {
              const orderData = jsonOrder.data;
              const foundOrderQr = orderData.paymentQrCode || orderData.merchantPaymentQrCode || orderData.qrCode || orderData.wechatQrCode;
              if (foundOrderQr && foundOrderQr.trim()) {
                setDispatcherQr(foundOrderQr);
                return;
              }
              if (orderData.dispatchedByPhone || orderData.adminPhone || orderData.dispatchedBy) {
                const fetchedPhone = (orderData.dispatchedByPhone || orderData.adminPhone || orderData.dispatchedBy).toString().trim();
                if (fetchedPhone && !candidatePhones.includes(fetchedPhone)) {
                  candidatePhones.unshift(fetchedPhone);
                }
              }
            }
          }
        } catch (_) {}
      }

      // 2. Query dedicated /api/get-wechat-qr endpoint which checks server disk files and all DB collections
      for (const targetPhone of candidatePhones) {
        if (!targetPhone || !isMounted) continue;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const res = await fetch(`${baseUrl}/api/get-wechat-qr?phone=${encodeURIComponent(targetPhone)}&channel=${isWebChannel ? 'web' : 'app'}&_t=${timeToken}`, { cache: 'no-store', signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.ok) {
            const json = await res.json();
            if (isMounted && json?.success && json?.url && typeof json.url === 'string' && json.url.trim()) {
              setDispatcherQr(json.url);
              if (isWebChannel) {
                localStorage.setItem(`dd_web_valet_wechat_qr_${targetPhone}`, json.url);
              } else {
                localStorage.setItem(`dd_app_valet_wechat_qr_${targetPhone}`, json.url);
                localStorage.setItem(`dd_dispatch_wechat_qr_${targetPhone}`, json.url);
              }
              return;
            }
          }
        } catch (_) {}
      }

      // 3. Loop through candidate phones to query channel-specific QR codes from Baota collections
      const targetCols = isWebChannel 
        ? ['web_valet_qrs', 'dispatch_qrs_web', 'merchant_users', 'dispatch_qrs', 'dispatch_qrcodes']
        : ['app_valet_qrs', 'driver_users', 'dispatch_qrs', 'dispatch_qrcodes', 'web_valet_qrs'];

      for (const targetPhone of candidatePhones) {
        if (!targetPhone || !isMounted) continue;

        // Try query collections on Baota server
        for (const colName of targetCols) {
          if (!isMounted) return;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(`${baseUrl}/api/db/get?col=${colName}&id=${encodeURIComponent(targetPhone)}&_t=${timeToken}`, { cache: 'no-store', signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
              const json = await res.json();
              const foundQr = json?.data?.qrCode || json?.data?.wechatQrCode || json?.data?.wechatClean;
              if (isMounted && foundQr && typeof foundQr === 'string' && foundQr.trim()) {
                setDispatcherQr(foundQr);
                if (isWebChannel) {
                  localStorage.setItem(`dd_web_valet_wechat_qr_${targetPhone}`, foundQr);
                } else {
                  localStorage.setItem(`dd_app_valet_wechat_qr_${targetPhone}`, foundQr);
                  localStorage.setItem(`dd_dispatch_wechat_qr_${targetPhone}`, foundQr);
                }
                return;
              }
            }
          } catch (_) {}
        }
      }
    };

    queryBaotaQr();

    // Poll Mainland China Baota server every 2 seconds for silent updates
    const intervalId = setInterval(queryBaotaQr, 2000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [trip, rawDispatchedBy, isWebChannel]);

  const handleConfirmSent = () => {
    onFinishTrip(trip.calculatedTotalFee);
  };

  const isReportTransfer = Boolean(
    (trip as any)?.orderType === '报单转单' ||
    (trip as any)?.orderRemark === '报单转单' ||
    (trip as any)?.type === '报单转单' ||
    ((trip as any)?.destination && String((trip as any).destination).includes('报单转单')) ||
    (trip?.startLocation && String(trip.startLocation).includes('报单转单')) ||
    (trip as any)?.isReportTransfer
  );

  const userPhone = settings?.phoneNumber || (typeof window !== 'undefined' ? localStorage.getItem('dd_user_phone') : '') || '';
  const isCreatorSelf = Boolean(
    userPhone && rawDispatchedBy && (rawDispatchedBy === userPhone || rawDispatchedBy.trim() === userPhone.trim())
  );

  const driverOwnQr = (isCreatorSelf || !rawDispatchedBy) ? (
    wechatClean || settings?.wechatQrCode || (() => {
      try {
        if (typeof window === 'undefined') return '';
        const userP = settings?.phoneNumber || localStorage.getItem('dd_user_phone') || '';
        const cachedSet = userP ? localStorage.getItem(`dd_settings_${userP}`) : null;
        if (cachedSet) {
          const parsed = JSON.parse(cachedSet);
          if (parsed?.wechatQrCode) return parsed.wechatQrCode;
        }
        return userP ? (localStorage.getItem(`dd_dispatch_wechat_qr_${userP}`) || '') : '';
      } catch (_) {}
      return '';
    })()
  ) : '';

  const tripDirectQr = (
    (trip as any)?.paymentQrCode ||
    (trip as any)?.merchantPaymentQrCode ||
    (trip as any)?.qrCode ||
    (trip as any)?.wechatQrCode ||
    (trip as any)?.wechatClean ||
    (trip as any)?.dispatcherQr ||
    ''
  ).toString().trim();

  const localDispatchedByQr = (() => {
    const phones = Array.from(new Set([
      rawDispatchedBy,
      (trip as any)?.merchantPhone,
      (trip as any)?.dispatchedByPhone,
      (trip as any)?.dispatchedBy,
      (trip as any)?.dispatcherPhone,
      (trip as any)?.reporterPhone,
      (trip as any)?.adminPhone,
      (trip as any)?.creatorPhone,
      (typeof window !== 'undefined' ? localStorage.getItem('dd_merchant_login_phone') : ''),
      (typeof window !== 'undefined' ? localStorage.getItem('dd_merchant_phone') : ''),
      (typeof window !== 'undefined' ? localStorage.getItem('dd_admin_phone') : ''),
      '15509601222'
    ].map(p => (p || '').toString().trim()).filter(Boolean)));

    for (const p of phones) {
      if (isWebChannel) {
        const q = localStorage.getItem(`dd_web_valet_wechat_qr_${p}`) ||
                  localStorage.getItem(`dd_dispatch_wechat_qr_${p}`) ||
                  localStorage.getItem(`dd_dispatch_fee_qr_${p}`) ||
                  localStorage.getItem(`dd_merchant_user_qr_${p}`);
        if (q) return q;
      } else {
        const q = localStorage.getItem(`dd_app_valet_wechat_qr_${p}`) ||
                  localStorage.getItem(`dd_dispatch_wechat_qr_${p}`) ||
                  (() => {
                    try {
                      const s = localStorage.getItem(`dd_settings_${p}`);
                      if (s) return JSON.parse(s)?.wechatQrCode || '';
                    } catch (_) {}
                    return '';
                  })();
        if (q) return q;
      }
    }

    // Fallback to global web / dispatch QR cache if available
    return localStorage.getItem('dd_web_valet_wechat_qr') ||
           localStorage.getItem('dd_dispatch_fee_qr_global') ||
           localStorage.getItem('dd_merchant_web_qr') ||
           localStorage.getItem('dd_dispatch_wechat_qr_15509601222') ||
           localStorage.getItem('dd_dispatch_wechat_qr') ||
           localStorage.getItem('dd_dispatch_fee_qr') ||
           '';
  })();

  // Multi-tier fallback chain strictly isolated per order and sender phone number
  const rawQr = (
    tripDirectQr ||
    dispatcherQr ||
    localDispatchedByQr ||
    (isCreatorSelf ? driverOwnQr : '') ||
    ''
  ).trim();

  const qrImage = getFullQrUrl(rawQr);

  return (
    <div className="w-full h-full bg-[#f9f9f9] text-[#1a1c1c] select-none font-sans flex flex-col justify-between overflow-hidden relative z-50">
      {/* TopAppBar */}
      <header className="sticky top-0 left-0 w-full z-50 flex items-center px-4 pt-[calc(max(env(safe-area-inset-top,0px),22px)+10px)] pb-3.5 bg-white border-b border-[#dfc0af]/40 backdrop-blur-md shrink-0 shadow-xs">
        <button 
          type="button"
          onClick={onNavigateBack}
          className="transition-colors duration-200 active:opacity-70 p-2 -ml-2 text-[#984800] hover:bg-[#984800]/10 rounded-full cursor-pointer"
          aria-label="返回"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="flex-grow text-center font-bold text-lg text-[#984800] tracking-wide">
          {isReportTransfer ? '报单转单代叫费收款' : '商户代叫代驾费收款'}
        </h1>
        <div className="w-10"></div> {/* Spacer for centering */}
      </header>

      {/* Main Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 relative space-y-4">
        {/* Background Texture Overlay */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-20" 
          style={{
            backgroundImage: 'linear-gradient(#e0e0e0 1px, transparent 1px), linear-gradient(90deg, #e0e0e0 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }}
        />

        <div className="relative z-10 space-y-4">
          {/* Payment Core Card */}
          <div className="bg-white rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] border border-[#dfc0af]/60 overflow-hidden">
            {/* Payment Methods Tabs */}
            <div className="flex border-b border-[#dfc0af]/50 bg-[#f3f3f3]/50">
              <button 
                type="button"
                className="flex-1 py-3 text-center font-bold text-sm relative transition-colors text-[#984800]"
              >
                微信支付
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-[#ff7d00] rounded-full" />
              </button>
            </div>

            {/* QR Content */}
            <div className="p-4 sm:p-5 flex flex-col items-center">
              <div className="mb-2 text-[#1a1c1c] font-bold text-sm text-center px-2 leading-snug">
                {isReportTransfer 
                  ? `报单转单：${trip?.startLocation || '运祥小区'} 的代叫费` 
                  : `代叫订单：${trip?.startLocation || '运祥小区'} 的商户代叫费`
                }
              </div>
              
              <div className="mb-1 text-xs font-semibold text-gray-500">
                代叫订单收款金额
              </div>

              <div className="mb-3 flex items-baseline justify-center">
                <span className="text-xl font-bold text-[#1a1c1c] mr-1">¥</span>
                <span className="text-3xl sm:text-4xl font-black text-[#1a1c1c] tracking-tight font-mono">
                  {((trip as any)?.dispatchFee || (trip as any)?.valetFee || 12).toFixed(2)}
                </span>
              </div>

              {/* QR Code Container */}
              <div className="relative w-52 h-52 sm:w-60 sm:h-60 p-2.5 bg-white rounded-2xl border border-gray-200 shadow-inner flex items-center justify-center">
                {qrImage && qrImage.trim() !== '' ? (
                  <img 
                    src={qrImage} 
                    alt="微信代叫费收款码" 
                    className="w-full h-full object-contain rounded-xl"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="relative z-10 w-full h-full flex flex-col items-center justify-center border-2 border-dashed border-[#dfc0af] rounded-xl bg-gray-50/80 p-3">
                    <QrCode className="w-14 h-14 text-[#ff7d00]/40 mb-1" />
                    <div className="bg-[#ff7d00] p-2 rounded-xl shadow-xs">
                      <Car className="w-5 h-5 text-white" />
                    </div>
                    <p className="mt-2 text-[11px] text-gray-600 font-bold text-center leading-snug">
                      请派单人员/司机先在【代驾设置 ➔ 上传收款码】中上传微信收款码
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center gap-1.5 px-3 py-1 bg-[#f3f3f3] rounded-full">
                <ShieldCheck className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                <span className="text-[11px] text-gray-600 font-semibold">实名收款 · 支付保障</span>
              </div>
            </div>
          </div>

          {/* Hint Section */}
          <div className="space-y-1.5 px-1 bg-white/70 p-3 rounded-xl border border-gray-200/50">
            <div className="flex gap-2">
              <Info className="w-4 h-4 text-[#984800] shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs text-gray-600 leading-relaxed">
                <p>
                  ① 请截图此页面<span className="text-[#1a1c1c] font-bold">微信识别</span>发送代叫费用。
                </p>
                <p>
                  ② 或用另一个手机微信<span className="text-[#1a1c1c] font-bold">扫描此页面</span>给代叫人员发送代叫费用。
                </p>
                <p className="text-[11px] text-amber-700 font-medium pt-0.5">
                  温馨提示：请先在此页面将代叫费用发送成功后，再点击确认按钮。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Fixed Action Area (Considers Android Nav Bar) */}
      <footer className="shrink-0 px-4 pt-3 pb-[calc(1.25rem+max(env(safe-area-inset-bottom,0px),var(--android-nav-bar-height,0px),34px))] bg-white border-t border-gray-200/80 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur-md z-20 android-nav-safe-pb">
        <button 
          type="button"
          onClick={handleConfirmSent}
          className="w-full bg-[#ff7d00] hover:bg-[#e06d00] active:scale-[0.98] text-white py-3.5 rounded-xl font-bold text-base shadow-[0_4px_12px_rgba(255,125,0,0.25)] transition-all cursor-pointer"
        >
          {isReportTransfer ? '报单转单代叫费用确认已发送' : '代叫费用确认已发送'}
        </button>
      </footer>
    </div>
  );
}
