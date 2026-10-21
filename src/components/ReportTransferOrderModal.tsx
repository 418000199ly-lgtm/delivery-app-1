import React, { useState } from 'react';
import { ArrowLeft, MapPin, Phone, Info, CheckCircle2 } from 'lucide-react';
import { getBaseApiUrl, getAuthHeaders } from '../lib/dbProxy';
import { geocodeAddress, calculateHaversineDistanceKm, formatDistance, DEFAULT_YINCHUAN_COORDS, isValidCoords } from '../utils/geocoding';
import { speakText } from '../utils/speech';
import { hasValidLicense } from '../utils/nameResolver';

import readyDriverImg from '../assets/images/ready_driver.jpg';
import valetCarBannerImg from '../assets/images/valet_car_banner.jpg';
import { READY_DRIVER_BASE64, VALET_CAR_BANNER_BASE64 } from '../assets/images/driverImageConstants';

interface ReportTransferOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  userPhone?: string | null;
  defaultPickup?: string;
  defaultPickupDetail?: string;
  driverCoords?: { lat: number; lng: number } | null;
}

export default function ReportTransferOrderModal({
  isOpen,
  onClose,
  userPhone,
  defaultPickup = '运祥小区',
  defaultPickupDetail,
  driverCoords
}: ReportTransferOrderModalProps) {
  const currentPickup = defaultPickup || '运祥小区';
  // 2026-10-11晚：位置下方小字详细地址，优先用 prop，其次读缓存
  const pickupDetail = (() => {
    if (defaultPickupDetail && defaultPickupDetail.trim()) return defaultPickupDetail.trim();
    try {
      return localStorage.getItem('dd_bg_driver_coords_detail') || '';
    } catch (_) { return ''; }
  })();
  const [passengerPhone, setPassengerPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [dispatchResultMsg, setDispatchResultMsg] = useState<{ title: string; desc: string; isHall: boolean } | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPickup.trim()) {
      alert('乘客起点不能为空！');
      return;
    }
    const cleanPhone = passengerPhone.replace(/\D/g, '').trim();
    if (!cleanPhone || cleanPhone.length !== 11 || !cleanPhone.startsWith('1')) {
      alert('请输入有效的中国大陆11位手机号码！');
      return;
    }

    // 2026-10-15 P1-4：报单转单发起人接单授权检查（与服务端一致）
    let reporterLicense = '';
    try {
      const s = localStorage.getItem(`dd_settings_${userPhone}`) || localStorage.getItem('dd_settings');
      if (s) reporterLicense = JSON.parse(s)?.licenseExpiry || '';
    } catch (_) {}
    if (!hasValidLicense(reporterLicense)) {
      alert('⚠️ 您的接单授权已到期或未开通，无法发起报单转单！请联系开发者充值接单授权。');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Resolve reporter (issuing driver's) location coordinates as distance origin
      let reporterLat: number = DEFAULT_YINCHUAN_COORDS.lat;
      let reporterLng: number = DEFAULT_YINCHUAN_COORDS.lng;

      const sLat = driverCoords?.lat || (typeof window !== 'undefined' ? Number(localStorage.getItem('dd_bg_driver_coords_lat')) : null);
      const sLng = driverCoords?.lng || (typeof window !== 'undefined' ? Number(localStorage.getItem('dd_bg_driver_coords_lng')) : null);
      const hasDriverCoords = sLat && sLng && isValidCoords(Number(sLat), Number(sLng));

      if (hasDriverCoords) {
        reporterLat = Number(sLat);
        reporterLng = Number(sLng);
      } else if (currentPickup && currentPickup.trim()) {
        const pickupCoords = geocodeAddress(currentPickup);
        // H9修复：geocodeAddress可能返回null
        if (pickupCoords && isValidCoords(pickupCoords.lat, pickupCoords.lng)) {
          reporterLat = pickupCoords.lat;
          reporterLng = pickupCoords.lng;
        }
      }

      // Passenger start coords for order display
      let pLat = reporterLat;
      let pLng = reporterLng;
      if (currentPickup && currentPickup.trim()) {
        const pickupCoords = geocodeAddress(currentPickup, hasDriverCoords ? { lat: reporterLat, lng: reporterLng } : undefined);
        // H9修复：geocodeAddress可能返回null
        if (pickupCoords && isValidCoords(pickupCoords.lat, pickupCoords.lng)) {
          pLat = pickupCoords.lat;
          pLng = pickupCoords.lng;
        }
      }

      // 2026-10-20 重构：删除整套本地候选司机计算（拉成员表/位置表、在本地按授权/心跳/空闲/3 公里选人）。
      // 派单早已 100% 由服务端 /api/report-transfer/dispatch 决定，本地名单从不参与决策，
      // 留着只会与服务端规则漂移。此处只保留请求需要的本人手机号与起点坐标。
      // 起点坐标兜底不再用银川中心点占位（曾致误派单）：无有效坐标传 0，由服务端解析或标记位置未知。
      const cleanUserPhone = String(userPhone || '').replace(/\D/g, '').trim();
      const originLat = isValidCoords(reporterLat, reporterLng)
        ? reporterLat
        : (isValidCoords(pLat, pLng) ? pLat : 0);
      const originLng = isValidCoords(reporterLat, reporterLng)
        ? reporterLng
        : (isValidCoords(pLat, pLng) ? pLng : 0);

      const orderId = 'RT' + Date.now();
      const baseUrl = getBaseApiUrl();

      let chosenDriver: any = null;

      // 2026-10-12改用报单转单专用派单通道（2026-10-15起走鉴权，需getAuthHeaders）：以报单人位置为圆心3公里找最近上线空闲小队司机，无人则进大厅
      let serverResult: any = null;
      let serverAuthFailed = false;
      try {
        const dispatchResp = await fetch(`${baseUrl}/api/report-transfer/dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            // 2026-10-20 重构：订单号、发起人身份、收款码全部由服务端生成/绑定 token/按上传文件推导，客户端不再自带
            passengerPhone: cleanPhone,
            pickupName: currentPickup,
            pickupDetail: pickupDetail,
            pickupLat: originLat,
            pickupLng: originLng
          })
        });

        if (dispatchResp.ok) {
          serverResult = await dispatchResp.json();
        } else if (dispatchResp.status === 401 || dispatchResp.status === 403) {
          serverAuthFailed = true;
        }
      } catch (e) {
        console.warn('[ReportTransfer] Server dispatch fallback to local:', e);
      }

      // 2026-10-15: 服务端鉴权失败(401/403)时不走本地fallback，直接报错（防假成功）
      if (serverAuthFailed) {
        setDispatchResultMsg({
          title: '报单转单失败',
          desc: '登录已过期或无权限，请重新登录后再试。',
          isHall: false
        });
        return;
      }

      // P1(2026-10-16)：去掉服务端失败后的本地降级"假成功"。
      // 之前服务端异常（非401/403）时走本地 candidates 派单并显示"派单成功"，
      // 但绕过了服务端的接单授权/VIP限额/3公里等校验，且倒计时/转大厅定时器不在服务端，
      // 造成"有弹窗、无倒计时、永不转大厅"的僵尸单。现在服务端失败直接报错，不再假成功。
      const isServerHandled = serverResult && serverResult.success;
      if (!isServerHandled) {
        setDispatchResultMsg({
          title: '报单转单失败',
          desc: '服务器派单失败，请检查网络后重试。如持续失败请联系开发者。',
          isHall: false
        });
        return;
      }
      const isHallFromServer = serverResult.isHall;

      if (!serverResult.isHall && serverResult.dispatchedDriverPhone) {
        // Server assigned to nearest driver
        const srvPhone = String(serverResult.dispatchedDriverPhone).replace(/\D/g, '').trim();
        const srvName = serverResult.dispatchedDriverName || `司机${srvPhone.slice(-4)}`;
        chosenDriver = { phone: srvPhone, name: srvName, distKm: serverResult.distKm || 0.5 };

        setDispatchResultMsg({
          title: '报单转单派单成功',
          desc: `已派单给报单司机附近3公里内最近的小队司机【${srvName} (${srvPhone})】，直线距离 ${serverResult.distanceText || formatDistance(serverResult.distKm || 0.5)}，对方司机APP已实时弹出新来单界面（60秒倒计时）！`,
          isHall: false
        });
      } else {
        // No driver within 3km -> Enter Order Lobby (选单大厅)
        // 2026-10-20 重构：大厅单已由服务端在返回 isHall 时按服务端订单号落库，
        // 客户端不再自造订单号双写（旧逻辑写出一张幽灵大厅单，与服务端真单并存、抢单口径混乱）

        window.dispatchEvent(new CustomEvent('merchant_orders_updated'));

        setDispatchResultMsg({
          title: '订单已转入选单大厅',
          desc: '附近直线距离3公里内暂无在线空闲司机，报单转单已自动转入【选单大厅】供其他司机抢单！此订单不会显示在您的选单大厅中。',
          isHall: true
        });
      }

      // Record this 报单转单 in driver's order history so it counts toward 当月接单, 全部单数, 总成单量, 今日成单
      try {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        const driverOrderRecord = {
          id: orderId,
          orderId: orderId,
          timeStr: `${year}-${month}-${day} ${hours}:${minutes}`,
          fullTimeStr: `${year}-${month}-${day} ${hours}:${minutes}`,
          timestamp: Date.now(),
          amount: 0,
          startLocation: currentPickup,
          endLocation: chosenDriver ? `报单转单 (派给${chosenDriver.name})` : '报单转单 (选单大厅)',
          destination: chosenDriver ? `报单转单 (派给${chosenDriver.name})` : '报单转单 (选单大厅)',
          passengerPhone: cleanPhone,
          distance: 0,
          type: '报单转单',
          orderType: '报单转单',
          orderRemark: '报单转单',
          status: '已转单',
          isTransferIssuer: true,
          isReporter: true,
          dispatchedDriverName: chosenDriver ? chosenDriver.name : '',
          dispatchedDriverPhone: chosenDriver ? chosenDriver.phone : '',
          reporterPhone: userPhone || ''
        };

        const ordersKey = userPhone ? `dd_driver_orders_${userPhone}` : 'dd_driver_orders';
        const existingStr = localStorage.getItem(ordersKey);
        let orders = existingStr ? JSON.parse(existingStr) : [];
        if (!Array.isArray(orders)) orders = [];
        orders.unshift(driverOrderRecord);
        // 当全部单数到达9999时，自动归0，同时软件app自动删除订单中心容器里的所有订单信息
        if (orders.length >= 9999) {
          orders = [];
        }
        localStorage.setItem(ordersKey, JSON.stringify(orders));
        localStorage.setItem('dd_driver_orders', JSON.stringify(orders));
        window.dispatchEvent(new CustomEvent('driver_orders_updated'));
      } catch (_) {}

      setIsSubmitting(false);
      setShowSuccessToast(true);

      setTimeout(() => {
        setShowSuccessToast(false);
        setPassengerPhone('');
        onClose();
      }, 2500);

    } catch (err) {
      console.error("Error in ReportTransferOrder submit:", err);
      setIsSubmitting(false);
      alert('呼叫代叫司机失败，请重试！');
    }
  };

  return (
    <div className="absolute inset-0 z-[100] bg-[#f9f9f9] text-[#1a1c1c] flex flex-col font-sans select-none overflow-hidden animate-in fade-in duration-200">
      
      {/* 手机顶部电量/信号/状态栏安全占位区 (保留系统电量、网络信号、时间与打孔屏空间，彻底适配所有安卓与苹果手机) */}
      <div 
        className="w-full shrink-0 bg-white select-none pointer-events-none"
        style={{ 
          height: 'max(env(safe-area-inset-top, 0px), 54px)',
          minHeight: '54px'
        }} 
      />

      {/* TopAppBar - Fixed Height Header positioned safely below status bar */}
      <header 
        className="w-full bg-white flex items-center justify-between px-4 py-3 border-b border-[#e2e2e2] shrink-0 shadow-2xs"
      >
        <button 
          type="button"
          onClick={onClose}
          className="text-[#584235] hover:bg-[#e2e2e2] p-2 rounded-full flex items-center justify-center transition-colors cursor-pointer active:scale-95 -ml-1.5"
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft className="w-5 h-5 text-gray-800" />
        </button>
        <h1 className="text-base sm:text-lg font-bold text-[#984800] tracking-wide">报单转单</h1>
        <div className="w-8" /> {/* Spacer */}
      </header>

      {/* Main Content Container */}
      <main className="flex-1 min-h-0 flex flex-col px-4 pt-3 pb-8 overflow-y-auto space-y-3">
        
        {/* Top Content Group: Full Driver Illustration */}
        <div className="flex flex-col items-center text-center shrink-0">
          <div className="w-full h-[180px] sm:h-[200px] rounded-2xl overflow-hidden mb-3 flex items-center justify-center bg-gradient-to-b from-[#f3f3f3] to-[#f9f9f9] border border-[#e2e2e2] shadow-sm relative">
            <img 
              className="w-full h-full object-cover object-top" 
              src={VALET_CAR_BANNER_BASE64 || valetCarBannerImg || READY_DRIVER_BASE64 || readyDriverImg || '/valet_car_banner.jpg'} 
              alt="报单转单代叫司机"
              loading="eager"
              onError={(e) => {
                const target = e.currentTarget;
                if (valetCarBannerImg && target.src !== valetCarBannerImg) {
                  target.src = valetCarBannerImg;
                } else if (!target.src.endsWith('valet_car_banner.jpg')) {
                  target.src = '/valet_car_banner.jpg';
                }
              }}
            />
          </div>

          {/* Slogan */}
          <div className="pt-1 pb-1">
            <h2 className="text-base sm:text-lg font-extrabold text-[#1a1c1c] leading-tight">
              报单转单越多，
            </h2>
            <h2 className="text-base sm:text-lg font-extrabold text-[#ff7d00] leading-tight mt-0.5">
              赚取代叫费用越多！
            </h2>
          </div>
        </div>

        {/* Middle Group: Form Inputs & Submit Button */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 shrink-0">
          <div className="bg-white rounded-xl border border-[#e2e2e2] p-2.5 shadow-2xs flex flex-col gap-2">
            {/* Pickup Input - Readonly */}
            <div className="relative flex items-center bg-[#f4f4f4] rounded-lg border border-[#e2e2e2] px-2.5 py-0.5 select-none">
              <div className="text-[#ff7d00] shrink-0 mr-2 flex items-center">
                <MapPin className="w-4 h-4 fill-[#ff7d00]/20 text-[#ff7d00]" />
              </div>
              <input 
                type="text"
                value={currentPickup}
                readOnly
                disabled
                placeholder="乘客起点"
                className="w-full bg-transparent border-none outline-none text-xs sm:text-sm font-bold text-gray-700 py-2 cursor-default"
                style={{ outline: 'none', boxShadow: 'none' }}
              />
              <span className="text-[10px] text-gray-400 shrink-0 ml-1 bg-gray-200/80 px-1.5 py-0.5 rounded font-medium">不可更改</span>
            </div>
            {/* 2026-10-11晚：位置下方小字详细地址 */}
            {pickupDetail ? (
              <p className="text-[10px] text-[#8b7263] truncate px-1 -mt-1">
                {pickupDetail}
              </p>
            ) : null}

            {/* Phone Input */}
            <div className="relative flex items-center bg-[#f9f9f9] rounded-lg border border-[#e2e2e2] focus-within:border-[#ff7d00] focus-within:ring-1 focus-within:ring-[#ff7d00] transition-all px-2.5 py-0.5">
              <div className="text-[#ff7d00] shrink-0 mr-2 flex items-center">
                <Phone className="w-4 h-4 text-[#ff7d00]" />
              </div>
              <input 
                type="tel"
                inputMode="numeric"
                maxLength={11}
                value={passengerPhone}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, '').slice(0, 11);
                  setPassengerPhone(cleaned);
                }}
                placeholder="请输入乘客手机号码"
                className="w-full bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-xs sm:text-sm font-bold text-gray-800 placeholder:text-gray-400 py-2"
                style={{ outline: 'none', boxShadow: 'none' }}
              />
            </div>
          </div>

          {/* Action Button */}
          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[#ff7d00] hover:bg-[#e06d00] active:bg-[#c96200] disabled:bg-gray-300 text-white font-bold text-sm py-3 rounded-xl shadow-md shadow-orange-500/20 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                正在智能派单中...
              </span>
            ) : (
              '立即呼叫司机'
            )}
          </button>
        </form>

        {/* Bottom Group: Warm Tips Card */}
        <section className="bg-[#eee] p-2.5 rounded-xl border border-[#e2e2e2] shrink-0 mb-4">
          <div className="flex items-start gap-1.5">
            <Info className="w-4 h-4 text-[#984800] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#5f5e5e] leading-snug font-medium">
              温馨提示：恶意报单转单，视情节严重小队管理会封禁当前账号，账号封禁期间不补会员有效期时长。
            </p>
          </div>
        </section>

      </main>

      {/* Success Toast Overlay */}
      {showSuccessToast && dispatchResultMsg && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-30 p-6 animate-in zoom-in-95 duration-150">
          <div className="bg-white rounded-2xl p-5 shadow-2xl flex flex-col items-center text-center max-w-xs border border-gray-100">
            <div className={`w-11 h-11 rounded-full ${dispatchResultMsg.isHall ? 'bg-amber-100' : 'bg-green-100'} flex items-center justify-center mb-2.5`}>
              <CheckCircle2 className={`w-7 h-7 ${dispatchResultMsg.isHall ? 'text-amber-600' : 'text-[#07c160]'}`} />
            </div>
            <h3 className="text-sm font-extrabold text-gray-900 mb-1.5">{dispatchResultMsg.title}</h3>
            <p className="text-xs text-gray-600 leading-relaxed font-medium">{dispatchResultMsg.desc}</p>
          </div>
        </div>
      )}

    </div>
  );
}
