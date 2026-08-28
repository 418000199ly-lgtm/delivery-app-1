import React, { useState, useEffect } from 'react';
import { Clock, Bike } from 'lucide-react';
import { TripState, BillingRules } from '../types';
import { speakText, stopSpeaking } from '../utils/speech';
import { geocodeAddress, isValidCoords, calculateHaversineDistanceKm, formatDistance, calculateOrderDriverDistance, DEFAULT_YINCHUAN_COORDS } from '../utils/geocoding';

interface IncomingOrderOverlayProps {
  order: {
    passengerPhone?: string;
    startLocation?: string;
    destination?: string;
    timestamp?: number;
    isValetOrder?: boolean;
    approxPrice?: any;
    distanceText?: string;
    passengerLat?: number | null;
    passengerLng?: number | null;
    isPlatformDispatch?: boolean;
    scheduledTime?: string;
    bookingTime?: string;
    needScooter?: boolean;
  };
  driverCoords?: { lat: number; lng: number } | null;
  onlineBillingRules?: BillingRules;
  onAccept: (trip: TripState) => void;
  onDecline: () => void;
}

// Haversine straight line distance formula (真实计算起始点和司机当前位置的直线距离)
function calculateHaversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; 
}

/**
 * ==========================================
 *            语音播报文本配置模块
 * ==========================================
 * 您可以随时在这里修改语音播报的文字内容：
 * - approxPrice: 约定金额 (元)
 * - startLocation: 乘客出发起点
 * - destination: 目的地终点
 * - distanceText: 乘客直线距离（例如 "280米" 或 "1.2公里"）
 */
export function getTTSBroadcastText(
  order: any,
  approxPrice: any,
  startLocation: string,
  destination: string,
  distanceText: string
): string {
  if (order?.orderType === '报单转单' || order?.orderRemark === '报单转单' || order?.type === '报单转单') {
    return `您有新的报单转单系统派单，直线距离 ${distanceText}，请及时处理！`;
  }
  if (order?.isPlatformDispatch) {
    return `您有新的系统派单，直线距离 ${distanceText}，请及时处理！`;
  }
  const priceStr = (approxPrice === '未知' || !approxPrice) ? '48' : `${approxPrice}`;
  return `收到新订单！从 ${startLocation} 到 ${destination}，距离 ${distanceText}，预估金额 ${priceStr}元，请及时接单！`;
}

export const IncomingOrderOverlay: React.FC<IncomingOrderOverlayProps> = ({
  order,
  driverCoords,
  onlineBillingRules,
  onAccept,
  onDecline,
}) => {
  const [timeLeft, setTimeLeft] = useState(30);

  // Parse details with fallbacks
  const startLocation = order.startLocation || '运祥小区(北寺巷)';
  const isDestinationEmpty = !order.destination || order.destination.trim() === '';
  const destination = isDestinationEmpty ? '未知' : order.destination;
  const passengerPhone = order.passengerPhone || '系统分配乘客';
  
  // Dynamic random price if not specified
  const [approxPrice] = useState<any>(() => {
    if (isDestinationEmpty) return '未知';
    if (order.approxPrice !== undefined) return order.approxPrice;
    
    if (onlineBillingRules && onlineBillingRules.slots && onlineBillingRules.slots.length > 0) {
      try {
        const tripDist = 6 + Math.random() * 8; // Random estimated distance 6-14km
        const activeHour = new Date().getHours();
        let activeSlot = onlineBillingRules.slots[0];
        
        for (const slot of onlineBillingRules.slots) {
          const [startH] = slot.startTime.split(':').map(Number);
          const [endH] = slot.endTime.split(':').map(Number);
          
          if (startH > endH) {
            if (activeHour >= startH || activeHour <= endH) {
              activeSlot = slot;
              break;
            }
          } else if (activeHour >= startH && activeHour <= endH) {
            activeSlot = slot;
            break;
          }
        }
        
        const base = activeSlot.startingPrice;
        const freeKm = activeSlot.includedDistance;
        const interval = activeSlot.distanceInterval || 1;
        const increase = activeSlot.priceIncrease ?? activeSlot.unitPricePerKm ?? 5;
        
        let distanceCost = 0;
        if (tripDist > freeKm) {
          distanceCost = Math.ceil((tripDist - freeKm) / interval) * increase;
        }
        
        return base + distanceCost;
      } catch (e) {
        console.warn('Error calculating approxPrice with onlineBillingRules, falling back:', e);
      }
    }
    
    const prices = [34, 38, 45, 52, 68, 75, 88];
    const randomIndex = Math.floor(Math.random() * prices.length);
    return prices[randomIndex];
  });

  // Find current active slot starting price from onlineBillingRules
  const startPrice = React.useMemo(() => {
    if (onlineBillingRules && onlineBillingRules.slots && onlineBillingRules.slots.length > 0) {
      try {
        const activeHour = new Date().getHours();
        let activeSlot = onlineBillingRules.slots[0];
        for (const slot of onlineBillingRules.slots) {
          const [startH] = slot.startTime.split(':').map(Number);
          const [endH] = slot.endTime.split(':').map(Number);
          if (startH > endH) {
            if (activeHour >= startH || activeHour <= endH) {
              activeSlot = slot;
              break;
            }
          } else if (activeHour >= startH && activeHour <= endH) {
            activeSlot = slot;
            break;
          }
        }
        return activeSlot.startingPrice;
      } catch (e) {
        console.warn('Error calculating starting price:', e);
      }
    }
    return 35; // default fallback starting price
  }, [onlineBillingRules]);

  const distanceText = React.useMemo(() => {
    const isReportTransfer = order?.orderType === '报单转单' || order?.orderRemark === '报单转单' || order?.type === '报单转单';
    
    // Retrieve logged-in driver phone from all possible localStorage keys
    const savedPhone = typeof window !== 'undefined' ? (
      localStorage.getItem('dd_user_phone') ||
      localStorage.getItem('dd_driver_phone') ||
      localStorage.getItem('driver_register_phone') ||
      localStorage.getItem('dd_dispatch_user_phone') ||
      ''
    ) : '';

    const cleanUserPhone = savedPhone.replace(/\D/g, '').trim();

    const merchantP = ((order as any)?.merchantPhone || '').toString().replace(/\D/g, '').trim();
    const reporterP = ((order as any)?.reporterPhone || '').toString().replace(/\D/g, '').trim();
    const userP = ((order as any)?.userPhone || '').toString().replace(/\D/g, '').trim();
    const createdP = ((order as any)?.createdUserPhone || '').toString().replace(/\D/g, '').trim();
    const dispatchedP = ((order as any)?.dispatchedDriverPhone || (order as any)?.driverPhone || '').toString().replace(/\D/g, '').trim();

    const isIssuerOrAssignedDriver = Boolean(
      cleanUserPhone && (
        (merchantP && merchantP === cleanUserPhone) ||
        (reporterP && reporterP === cleanUserPhone) ||
        (userP && userP === cleanUserPhone) ||
        (createdP && createdP === cleanUserPhone) ||
        (dispatchedP && dispatchedP === cleanUserPhone)
      )
    );

    if (isReportTransfer && isIssuerOrAssignedDriver) {
      return '0公里';
    }

    if (order.distanceText) {
      return order.distanceText;
    }

    const savedLat = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lat') : null;
    const savedLng = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lng') : null;
    const currentCoords = (driverCoords && isValidCoords(driverCoords.lat, driverCoords.lng))
      ? driverCoords
      : (savedLat && savedLng ? { lat: Number(savedLat), lng: Number(savedLng) } : DEFAULT_YINCHUAN_COORDS);

    const { displayDistText } = calculateOrderDriverDistance(
      order.startLocation,
      order.passengerLat,
      order.passengerLng,
      currentCoords
    );
    return displayDistText;
  }, [
    order.passengerLat,
    order.passengerLng,
    order.startLocation,
    order.distanceText,
    order?.orderType,
    order?.orderRemark,
    order?.type,
    (order as any)?.merchantPhone,
    (order as any)?.reporterPhone,
    (order as any)?.userPhone,
    (order as any)?.createdUserPhone,
    (order as any)?.dispatchedDriverPhone,
    (order as any)?.driverPhone,
    driverCoords
  ]);

  // Display fields for scheduled time and scooter
  const displayScheduledTime = React.useMemo(() => {
    const time = order.scheduledTime || order.bookingTime;
    if (!time || time.trim() === '' || time === '现在出发' || time === '现在') {
      return '现在（立即出发）';
    }
    return time;
  }, [order.scheduledTime, order.bookingTime]);

  const displayNeedScooter = React.useMemo(() => {
    if (order.needScooter === false) {
      return '不需要';
    }
    return '需要';
  }, [order.needScooter]);

  // Countdown timer effect
  useEffect(() => {
    if (timeLeft <= 0) {
      onDecline();
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, onDecline]);

  // Handle TTS and Vibrate with continuous loop until accepted, declined or expired
  useEffect(() => {
    let isActive = true;
    let timerId: any = null;

    const playSpeech = () => {
      if (!isActive) return;
      try {
        const effectivePrice = (order.isValetOrder || order.isPlatformDispatch) ? '未知' : approxPrice;
        const speechText = getTTSBroadcastText(order, effectivePrice, startLocation, destination, distanceText);
        
        speakText(speechText, () => {
          if (isActive) {
            // Pause 1 second between repeat loops
            timerId = setTimeout(() => {
              playSpeech();
            }, 1000);
          }
        });
      } catch (e) {
        console.error('Speech synthesis loop failed:', e);
      }
    };

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([200, 100, 200, 100, 300]);
      } catch (e) {}
    }

    playSpeech();

    return () => {
      isActive = false;
      if (timerId) clearTimeout(timerId);
      stopSpeaking();
    };
  }, [approxPrice, startLocation, destination, distanceText]);

  const handleConfirmOrder = () => {
    stopSpeaking();
    speakText('接单成功，请前往接驾地点');
    const orderNumber = 'DD' + Date.now();
    const trip: TripState = {
      id: orderNumber,
      orderNumber: orderNumber,
      passengerName: order.isValetOrder ? '后台派遣乘客' : '线上自助预约乘客',
      passengerPhone: passengerPhone,
      startLocation: startLocation,
      endLocation: destination,
      startTimestamp: Date.now(),
      currentDistance: 0.0,
      currentWaitingTime: 0,
      currentStatus: 'serving',
      extraBridgeFee: 0,
      extraParkingFee: 0,
      extraOtherFee: 0,
      calculatedBaseFee: startPrice,
      calculatedTotalFee: startPrice,
      isOnlineOrder: true,
      orderType: order.isValetOrder ? '商户代叫' : '二维码开单',
    };
    onAccept(trip);
  };

  return (
    <div className="absolute inset-0 z-[100] bg-gray-50 flex flex-col justify-between overflow-y-auto select-none pb-40">
      
      {/* HEADER SECTION */}
      <header className="bg-[#e61a1a] text-white px-4 flex flex-col items-center relative py-6 pb-20 shrink-0">
        <div className="w-full flex justify-between items-center mb-3">
          <span className="text-white/80 font-semibold text-xs tracking-wider">
            {order?.orderType === '报单转单' || order?.orderRemark === '报单转单' || order?.type === '报单转单'
              ? '⚠️ 报单转单'
              : (order.isValetOrder || order.isPlatformDispatch ? '⚠️ 商户代叫' : '⚡ 二维码开单')}
          </span>
          <button 
            onClick={onDecline}
            className="font-bold text-white text-sm hover:opacity-85 active:scale-95 bg-black/10 px-2.5 py-1 rounded-full transition-all"
          >
            取消订单
          </button>
        </div>

        {/* Income Display */}
        <div className="flex flex-col items-center my-2">
          {order.isPlatformDispatch || order.isValetOrder || approxPrice === '未知' || approxPrice === '自行协商' ? (
            <div className="flex items-baseline justify-center">
              <span className="text-4xl font-black tracking-tight animate-pulse" style={{ fontFamily: 'sans-serif' }}>
                自行协商
              </span>
            </div>
          ) : (
            <div className="flex items-baseline justify-center">
              <span className="text-xl font-bold mr-1 opacity-90">约</span>
              <span className="text-6xl font-black tracking-tight" style={{ fontFamily: 'sans-serif' }}>
                {approxPrice}
              </span>
              <span className="text-xl font-bold ml-1 opacity-90">元</span>
            </div>
          )}
        </div>

        {/* Service Badge */}
        <div className="border border-white/40 rounded-full py-1.5 px-6 font-medium text-sm mt-3 bg-white/5 backdrop-blur-xs tracking-wide">
          {order?.orderType === '报单转单' || order?.orderRemark === '报单转单' || order?.type === '报单转单'
            ? "报单转单订单"
            : ((order.isPlatformDispatch || order.isValetOrder) ? "商户代叫订单" : (onlineBillingRules?.templateName?.trim() ? onlineBillingRules.templateName : "滴滴代驾"))}
        </div>
      </header>

      {/* TRIP DETAILS SECTION */}
      <main className="flex-1 flex flex-col -mt-12 mx-4 z-40 bg-white rounded-3xl shadow-xl overflow-hidden mb-6 border border-gray-150/50">
        
        {/* Distance summary */}
        <section className="bg-[#fcfdfe] px-5 border-b border-gray-100 flex justify-between items-center py-4 shrink-0">
          <div className="flex items-center gap-1.5">
            <svg className="w-5 h-5 text-[#64748b]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
            <span className="text-sm font-bold text-slate-500">客人直线距离</span>
          </div>
          <div>
            <span className="text-lg font-black text-[#dc2626] font-mono tracking-tight">{distanceText}</span>
          </div>
        </section>

        {/* Scheduled Time & Scooter Requirement Info */}
        <section className="bg-orange-50/90 px-5 py-3 border-b border-orange-100 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs">
            <Clock className="w-4 h-4 text-[#ff7d00] shrink-0" />
            <span className="text-gray-600 font-medium">预约时间：</span>
            <span className="font-extrabold text-[#311300] bg-orange-100/90 px-2 py-0.5 rounded-md">
              {displayScheduledTime}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <Bike className="w-4 h-4 text-[#ff7d00] shrink-0" />
            <span className="text-gray-600 font-medium">代步车：</span>
            <span className={`font-extrabold px-2 py-0.5 rounded-md ${
              displayNeedScooter === '需要'
                ? 'bg-teal-100 text-teal-800'
                : 'bg-gray-100 text-gray-700'
            }`}>
              {displayNeedScooter}
            </span>
          </div>
        </section>

        {/* Address Timeline */}
        <section className="px-6 py-6 flex-1 flex flex-col justify-center relative min-h-[160px]">
          <div className="relative pl-8 flex flex-col justify-between h-full py-1">
            
            {/* Timeline dotted line style */}
            <div 
              className="absolute left-[13px] top-[18px] bottom-[18px]" 
              style={{
                borderLeft: '2px dashed #cbd5e1',
              }}
            />

            {/* Pickup Node */}
            <div className="relative mb-6 flex items-start">
              {/* Point Indicator */}
              <div className="absolute -left-[31px] w-6 h-6 rounded-full bg-cyan-500 text-white flex items-center justify-center text-[10px] font-bold">
                起
              </div>
              <div className="flex flex-col pl-2">
                <span className="text-xs text-gray-400 font-bold mb-1.5">乘客出发地</span>
                <div className="bg-white px-3.5 py-1.5 rounded-lg shadow-md border border-gray-150 flex items-center gap-1.5 text-xs font-black text-gray-800 self-start">
                  <span className="w-2 h-2 rounded-full bg-[#189F95]" style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '9999px' }}></span>
                  <span>{startLocation}</span>
                </div>
              </div>
            </div>

            {/* Dropoff Node */}
            <div className="relative flex items-start">
              {/* Point Indicator */}
              <div className="absolute -left-[31px] w-6 h-6 rounded-full bg-orange-600 text-white flex items-center justify-center text-[10px] font-bold">
                终
              </div>
              <div className="flex flex-col pl-2">
                <span className="text-xs text-gray-400 font-bold mb-1.5">目的地</span>
                <div className="bg-white px-3.5 py-1.5 rounded-lg shadow-md border border-gray-150 flex items-center gap-1.5 text-xs font-black text-gray-800 self-start">
                  <span className="w-2 h-2 rounded-full bg-rose-500" style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '9999px' }}></span>
                  <span>{destination}</span>
                </div>
              </div>
            </div>

          </div>
        </section>
      </main>

      {/* STICKY FOOTER ACTIONS */}
      <footer className="absolute bottom-0 left-0 right-0 pt-3 px-4 pb-[calc(1.25rem+max(env(safe-area-inset-bottom,0px),28px))] bg-white border-t border-gray-100 flex flex-col items-center z-50 android-nav-safe-pb">
        {/* Countdown message */}
        <div className="w-full flex justify-center items-center py-2.5 text-center">
          <span className="text-sm font-bold text-[#e61a1a] animate-pulse">
            (请在 <span className="text-base font-black px-1 font-mono">{timeLeft}</span> 秒内确认接单)
          </span>
        </div>
        
        {/* Accept Main Action Button */}
        <button 
          onClick={handleConfirmOrder}
          className="w-full bg-[#e61a1a] text-white py-3.5 rounded-2xl text-lg font-black active:opacity-95 text-center transition-all shadow-lg hover:shadow-[#e61a1a]/20 shadow-[#e61a1a]/10 hover:translate-y-[-1px] active:translate-y-[1px]"
          data-purpose="confirm-order-btn"
        >
          确认接单
        </button>
      </footer>

    </div>
  );
};
