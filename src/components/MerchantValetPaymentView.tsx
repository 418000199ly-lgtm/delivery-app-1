import React, { useState, useEffect } from 'react';
import { ArrowLeft, ShieldCheck, Info, QrCode, Car } from 'lucide-react';
import { TripState, ChauffeurSettings } from '../types';
import { db, doc, onSnapshot, getBaseApiUrl, getAuthHeaders } from '../lib/dbProxy';
import { autoUpdateOrderDestinationIfUnset, isUnsetDestination } from '../utils/locationResolver';
import { useAuthenticatedQrUrl } from '../utils/qrCodeHelper';

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
  // 第四轮修复（P1-24）：服务端轮询结果单独存放，不再与订单自带码/本地缓存混装，
  // 保证"服务端码优先、服务端明确无码时不用本地旧码兜底"可以落实
  const [serverQr, setServerQr] = useState<string>('');
  const [serverChecked, setServerChecked] = useState<boolean>(false);

  const orderMerchantPhone = (
    (trip as any)?.merchantPhone ||
    (trip as any)?.creatorPhone ||
    (trip as any)?.dispatchedByPhone ||
    (trip as any)?.reporterPhone ||
    (trip as any)?.adminPhone ||
    (trip as any)?.dispatcherPhone ||
    (trip as any)?.dispatchedBy ||
    ''
  ).toString().trim();

  const rawDispatchedBy = orderMerchantPhone;

  useEffect(() => {
    const activeDest = trip.endLocation || (trip as any).destination || (trip as any).dropoffName;
    if (isUnsetDestination(activeDest)) {
      autoUpdateOrderDestinationIfUnset(trip, settings?.phoneNumber);
    }
  }, [trip?.id]);

  const isWebChannel = Boolean(
    orderMerchantPhone.endsWith('A') ||
    orderMerchantPhone.endsWith('a') ||
    (trip as any)?.orderChannel === 'web' ||
    (trip as any)?.dispatchChannel === 'web' ||
    (trip as any)?.sourceChannel === 'web' ||
    (trip as any)?.isStandaloneMerchantWeb
  );

  // Exact target phone for resolving the QR code
  const targetMerchantPhone = (() => {
    if (orderMerchantPhone) {
      if (isWebChannel && !orderMerchantPhone.endsWith('A') && !orderMerchantPhone.endsWith('a')) {
        return orderMerchantPhone + 'A';
      }
      return orderMerchantPhone;
    }
    return '';
  })();

  useEffect(() => {
    let isMounted = true;

    // 第四轮修复（P1-24）：不再用订单自带码/本地缓存给服务端结果状态播种，
    // 首轮轮询完成前的展示由下方 rawQr 的兜底链负责，服务端结果一到立即接管

    // High-availability Baota Node DB API polling for Mainland China direct server storage (No Firebase)
    const queryBaotaQr = async () => {
      if (!isMounted || !targetMerchantPhone) return;
      let gotServerResponse = false; // 本轮是否至少收到一次服务端 HTTP 回话（区分"服务端明确无码"与"纯网络失败")
      const baseUrl = getBaseApiUrl();
      const timeToken = Date.now();
      const orderId = (trip as any)?.orderId || (trip as any)?.orderNumber || trip?.id;

      // 1. Query dedicated /api/get-wechat-qr endpoint with channel constraint
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        // P0修复(2026-10-14)：传 orderId 以便服务端验证订单关联授权（司机查下单人的码）
        const orderIdParam = orderId ? `&orderId=${encodeURIComponent(String(orderId))}` : '';
        const res = await fetch(`${baseUrl}/api/get-wechat-qr?phone=${encodeURIComponent(targetMerchantPhone)}&channel=${isWebChannel ? 'web' : 'app'}${orderIdParam}&_t=${timeToken}`, { cache: 'no-store', signal: controller.signal, headers: { ...getAuthHeaders() } });
        clearTimeout(timeoutId);
        gotServerResponse = true;
        if (res.ok) {
          const json = await res.json();
          if (isMounted && json?.success && json?.url && typeof json.url === 'string' && json.url.trim()) {
            setServerQr(json.url);
            setServerChecked(true);
            if (isWebChannel) {
              localStorage.setItem(`dd_web_valet_wechat_qr_${targetMerchantPhone}`, json.url);
            } else {
              localStorage.setItem(`dd_app_valet_wechat_qr_${targetMerchantPhone}`, json.url);
            }
            return;
          }
        }
      } catch (_) {}

      // 2. Query collections on Baota server matching channel
      const targetCols = isWebChannel 
        ? ['web_valet_qrs', 'dispatch_qrs_web', 'merchant_users']
        : ['app_valet_qrs', 'driver_users', 'dispatch_qrs', 'dispatch_qrcodes'];

      for (const colName of targetCols) {
        if (!isMounted) return;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const res = await fetch(`${baseUrl}/api/db/get?col=${colName}&id=${encodeURIComponent(targetMerchantPhone)}&_t=${timeToken}`, { cache: 'no-store', signal: controller.signal, headers: { ...getAuthHeaders() } });
          clearTimeout(timeoutId);
          gotServerResponse = true;
          if (res.ok) {
            const json = await res.json();
            const foundQr = json?.data?.qrCode || json?.data?.wechatQrCode || json?.data?.wechatClean;
            if (isMounted && foundQr && typeof foundQr === 'string' && foundQr.trim()) {
              setServerQr(foundQr);
              setServerChecked(true);
              if (isWebChannel) {
                localStorage.setItem(`dd_web_valet_wechat_qr_${targetMerchantPhone}`, foundQr);
              } else {
                localStorage.setItem(`dd_app_valet_wechat_qr_${targetMerchantPhone}`, foundQr);
              }
              return;
            }
          }
        } catch (_) {}
      }

      // 第四轮修复（P1-24）：本轮所有来源都查完仍无码、且服务端确有回话 => 服务端明确无码，
      // 清掉此前轮询到的旧码，后续展示不再用本地缓存旧码兜底（防止付到已更换/已删除的码）
      if (isMounted && gotServerResponse) {
        setServerChecked(true);
        setServerQr('');
      }
    };

    queryBaotaQr();

    // Poll Mainland China Baota server every 2 seconds for silent updates
    const intervalId = setInterval(queryBaotaQr, 2000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [trip, targetMerchantPhone, isWebChannel]);

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

  // 2026-10-22 第八轮：代叫费页兜底只认 merchantPaymentQrCode（下单人的码，全链稳定）。
  // paymentQrCode/qrCode/wechatQrCode 在派单成功时被服务端改写成接单司机的车费码，
  // 旧兜底把它们排在前面：服务端查码返回前会闪现司机自己的码，缺下单人字段的单还会
  // 一直错显。用户铁律：谁下单显示谁的微信收款二维码。
  const tripDirectQr = (
    (trip as any)?.merchantPaymentQrCode ||
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
      (typeof window !== 'undefined' ? localStorage.getItem('dd_admin_phone') : '')
    ].map(p => (p || '').toString().trim()).filter(Boolean)));

    for (const p of phones) {
      const q = localStorage.getItem(`dd_web_valet_wechat_qr_${p}`) ||
                localStorage.getItem(`dd_dispatch_wechat_qr_${p}`) ||
                localStorage.getItem(`dd_dispatch_fee_qr_${p}`) ||
                localStorage.getItem(`dd_merchant_user_qr_${p}`) ||
                localStorage.getItem(`dd_app_valet_wechat_qr_${p}`) ||
                (() => {
                  try {
                    const s = localStorage.getItem(`dd_settings_${p}`);
                    if (s) return JSON.parse(s)?.wechatQrCode || '';
                  } catch (_) {}
                  return '';
                })();
      if (q) return q;
    }

    // P1-3修复(2026-10-14)：去掉全局共享key fallback（不带手机号后缀，会串码导致钱付给错的人）
    // 找不到下单人的码就返回空，页面显示"未设置"
    return '';
  })();

  // 第四轮修复（P1-24）：优先级改为服务端轮询码 > 订单自带码/本地缓存（仅在服务端尚未回话时兜底展示）；
  // 服务端明确无码（serverChecked）后，订单旧码与本地缓存旧码一律不再展示，防止付错人
  const rawQr = (
    serverQr ||
    (serverChecked ? '' : (tripDirectQr || localDispatchedByQr)) ||
    (isCreatorSelf ? driverOwnQr : '') ||
    ''
  ).trim();

  // 第四轮修复（P1-25）：订单没带代叫费字段时不许编造默认金额（如12元），无金额就明确不展示数字
  const displayFee = (() => {
    const v = (trip as any)?.dispatchFee ?? (trip as any)?.valetFee;
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  })();

  // P0(2026-10-16)：/uploads/qrcodes 需 X-Auth-Token 鉴权，普通 <img> 发不出 header 会 401 空白，
  // 改用带鉴权的 blob URL 加载
  const qrImage = useAuthenticatedQrUrl(rawQr);

  return (
    <div className="w-full h-full bg-[#f9f9f9] text-[#1a1c1c] select-none font-sans flex flex-col justify-between overflow-hidden relative z-50">
      {/* TopAppBar */}
      <header className="sticky top-0 left-0 w-full z-50 flex items-center px-4 header-safe-pt pb-2.5 bg-white border-b border-[#dfc0af]/40 backdrop-blur-md shrink-0 shadow-xs">
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

              <div className="mb-3 flex items-baseline justify-center" data-purpose="price-display">
                {displayFee !== null ? (
                  <>
                    <span className="text-xl font-bold text-[#1a1c1c] mr-1">¥</span>
                    <span className="text-3xl sm:text-4xl font-black text-[#1a1c1c] tracking-tight font-sans [font-variant-numeric:normal] [font-feature-settings:'zero'_0]">
                      {displayFee.toFixed(2)}
                    </span>
                  </>
                ) : (
                  <span className="text-base font-bold text-gray-500">金额以派单台设置为准</span>
                )}
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
      <footer className="shrink-0 px-4 pt-3 pb-2.5 bg-white border-t border-gray-200/80 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur-md z-20 android-nav-safe-pb">
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
