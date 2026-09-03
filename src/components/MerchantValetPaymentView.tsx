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

  useEffect(() => {
    let isMounted = true;

    // Check initial QR code from trip or localStorage immediately
    const initialQr = (trip as any)?.paymentQrCode || (trip as any)?.merchantPaymentQrCode || '';
    if (initialQr) {
      setDispatcherQr(initialQr);
    } else if (rawDispatchedBy) {
      const savedLocal = localStorage.getItem(`dd_dispatch_wechat_qr_${rawDispatchedBy}`) || localStorage.getItem(`dd_dispatch_fee_qr_${rawDispatchedBy}`);
      if (savedLocal) {
        setDispatcherQr(savedLocal);
      }
    }

    // High-availability Baota Node DB API polling for Mainland China direct server storage (No Firebase)
    const queryBaotaQr = async () => {
      const baseUrl = getBaseApiUrl();
      const timeToken = Date.now();
      const orderId = (trip as any)?.orderId || (trip as any)?.orderNumber || trip?.id;

      let targetPhone = rawDispatchedBy;

      // 1. First attempt: Query merchant_orders on Baota server using orderId / orderNumber to retrieve real-time order record
      const orderCandidates = Array.from(new Set([orderId, (trip as any)?.orderNumber, trip?.id].filter(Boolean)));
      for (const candidateId of orderCandidates) {
        try {
          const resOrder = await fetch(`${baseUrl}/api/db/get?col=merchant_orders&id=${encodeURIComponent(candidateId)}&_t=${timeToken}`, { cache: 'no-store' });
          if (resOrder.ok) {
            const jsonOrder = await resOrder.json();
            if (isMounted && jsonOrder?.data) {
              const orderData = jsonOrder.data;
              if (orderData.paymentQrCode && orderData.paymentQrCode.trim()) {
                setDispatcherQr(orderData.paymentQrCode);
                return;
              }
              if (orderData.dispatchedByPhone || orderData.adminPhone || orderData.dispatchedBy) {
                targetPhone = (orderData.dispatchedByPhone || orderData.adminPhone || orderData.dispatchedBy).toString().trim();
              }
            }
          }
        } catch (_) {}
      }

      // 1.5 Fallback check in local storage dd_merchant_orders_v2 for matching order record
      try {
        const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
        const match = saved.find((o: any) =>
          orderCandidates.some(cid => o.id === cid || o.orderId === cid || o.orderNo === cid)
        );
        if (match) {
          if (match.paymentQrCode && match.paymentQrCode.trim()) {
            setDispatcherQr(match.paymentQrCode);
            return;
          }
          if (match.dispatchedByPhone || match.adminPhone || match.dispatchedBy) {
            targetPhone = (match.dispatchedByPhone || match.adminPhone || match.dispatchedBy).toString().trim();
          }
        }
      } catch (_) {}

      if (!targetPhone) return;

      const localPhoneQr = localStorage.getItem(`dd_dispatch_wechat_qr_${targetPhone}`) || localStorage.getItem(`dd_dispatch_fee_qr_${targetPhone}`);
      if (localPhoneQr) {
        setDispatcherQr(localPhoneQr);
      }

      // 2. Try dispatch_qrs collection on Baota server
      try {
        const res1 = await fetch(`${baseUrl}/api/db/get?col=dispatch_qrs&id=${encodeURIComponent(targetPhone)}&_t=${timeToken}`, { cache: 'no-store' });
        if (res1.ok) {
          const json1 = await res1.json();
          if (isMounted && json1?.data?.qrCode) {
            setDispatcherQr(json1.data.qrCode);
            localStorage.setItem(`dd_dispatch_wechat_qr_${targetPhone}`, json1.data.qrCode);
            return;
          }
        }
      } catch (_) {}

      // 3. Try dispatch_qrcodes collection on Baota server
      try {
        const res2 = await fetch(`${baseUrl}/api/db/get?col=dispatch_qrcodes&id=${encodeURIComponent(targetPhone)}&_t=${timeToken}`, { cache: 'no-store' });
        if (res2.ok) {
          const json2 = await res2.json();
          if (isMounted && json2?.data?.qrCode) {
            setDispatcherQr(json2.data.qrCode);
            localStorage.setItem(`dd_dispatch_wechat_qr_${targetPhone}`, json2.data.qrCode);
            return;
          }
        }
      } catch (_) {}

      // 4. Try merchant_users collection on Baota server
      try {
        const res3 = await fetch(`${baseUrl}/api/db/get?col=merchant_users&id=${encodeURIComponent(targetPhone)}&_t=${timeToken}`, { cache: 'no-store' });
        if (res3.ok) {
          const json3 = await res3.json();
          const foundQr = json3?.data?.wechatQrCode || json3?.data?.qrCode;
          if (isMounted && foundQr) {
            setDispatcherQr(foundQr);
            localStorage.setItem(`dd_dispatch_wechat_qr_${targetPhone}`, foundQr);
            return;
          }
        }
      } catch (_) {}

      // 5. Try driver_users collection on Baota server for order creator QR
      try {
        const res4 = await fetch(`${baseUrl}/api/db/get?col=driver_users&id=${encodeURIComponent(targetPhone)}&_t=${timeToken}`, { cache: 'no-store' });
        if (res4.ok) {
          const json4 = await res4.json();
          const foundQr = json4?.data?.wechatQrCode || json4?.data?.qrCode || json4?.data?.wechatClean;
          if (isMounted && foundQr) {
            setDispatcherQr(foundQr);
            localStorage.setItem(`dd_dispatch_wechat_qr_${targetPhone}`, foundQr);
            return;
          }
        }
      } catch (_) {}
    };

    queryBaotaQr();

    // Poll Mainland China Baota server every 2 seconds for silent updates
    const intervalId = setInterval(queryBaotaQr, 2000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [trip, rawDispatchedBy]);

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

  const driverOwnQr = wechatClean || settings?.wechatQrCode || (() => {
    try {
      if (typeof window === 'undefined') return '';
      const userP = settings?.phoneNumber || localStorage.getItem('dd_user_phone') || '';
      const cachedSet = (userP ? localStorage.getItem(`dd_settings_${userP}`) : null) || localStorage.getItem('dd_settings');
      if (cachedSet) {
        const parsed = JSON.parse(cachedSet);
        if (parsed?.wechatQrCode) return parsed.wechatQrCode;
      }
    } catch (_) {}
    return '';
  })();

  const qrImage = isReportTransfer
    ? (dispatcherQr || (trip as any)?.paymentQrCode || (trip as any)?.merchantPaymentQrCode || (isCreatorSelf ? driverOwnQr : ''))
    : (dispatcherQr || (trip as any)?.paymentQrCode || (trip as any)?.merchantPaymentQrCode || '');

  return (
    <div className="w-full h-full bg-[#f9f9f9] text-[#1a1c1c] select-none font-sans flex flex-col justify-between overflow-hidden relative z-50">
      {/* TopAppBar */}
      <header className="sticky top-0 left-0 w-full z-50 flex items-center px-4 h-14 bg-white border-b border-[#dfc0af]/40 backdrop-blur-md shrink-0 shadow-xs header-safe-pt-sm">
        <button 
          type="button"
          onClick={onNavigateBack}
          className="transition-colors duration-200 active:opacity-70 p-2 -ml-2 text-[#984800] hover:bg-[#984800]/10 rounded-full cursor-pointer"
          aria-label="返回"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="flex-grow text-center font-bold text-lg text-[#984800] tracking-wide">
          {isReportTransfer ? '报单转单代叫费收款' : '商户代叫费收款'}
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
                  {((trip as any)?.dispatchFee || (trip as any)?.valetFee || 10).toFixed(2)}
                </span>
              </div>

              {/* QR Code Container */}
              <div className="relative w-52 h-52 sm:w-60 sm:h-60 p-2.5 bg-white rounded-2xl border border-gray-200 shadow-inner flex items-center justify-center">
                {qrImage && qrImage.trim() !== '' ? (
                  <img 
                    src={qrImage} 
                    alt="微信代叫费收款码" 
                    className="w-full h-full object-contain rounded-xl"
                  />
                ) : (
                  <div className="relative z-10 w-full h-full flex flex-col items-center justify-center border-2 border-dashed border-[#dfc0af] rounded-xl bg-gray-50/80 p-3">
                    <QrCode className="w-14 h-14 text-[#ff7d00]/40 mb-1" />
                    <div className="bg-[#ff7d00] p-2 rounded-xl shadow-xs">
                      <Car className="w-5 h-5 text-white" />
                    </div>
                    <p className="mt-2 text-[11px] text-gray-600 font-bold text-center leading-snug">
                      {isReportTransfer 
                        ? '请下单人员/接单司机先在【代驾设置 ➔ 上传收款码】中上传微信收款码' 
                        : '请派单人员先在【商户代叫系统】上传微信代叫费收款码'
                      }
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
