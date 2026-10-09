import React, { useState, useEffect } from 'react';
import { Clock, Bike } from 'lucide-react';
import { TripState, BillingRules } from '../types';
import { getTimeSlotForTime } from '../utils/billingUtils';
import { speakText, stopSpeaking, initAudioUnlock } from '../utils/speech';
import { geocodeAddress, isValidCoords, calculateHaversineDistanceKm, formatDistance, calculateOrderDriverDistance, DEFAULT_YINCHUAN_COORDS } from '../utils/geocoding';
import { isOrderAlreadyEnded } from '../utils/orderValidation';
import { reportDriverBusyStatus } from '../utils/powerAndLocationManager';
import { getBaseApiUrl } from '../lib/dbProxy';

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
  userPhone?: string;
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
    return `您有新的报单转单系统派单，请及时处理！`;
  }
  if (order?.isValetOrder || order?.isPlatformDispatch || order?.orderRemark === '商户代叫' || order?.orderType === '商户代叫') {
    return `您有新的系统派单，请及时处理！`;
  }
  return `注意！收到新的代驾派单，请及时查看并确认接单！`;
}

export const IncomingOrderOverlay: React.FC<IncomingOrderOverlayProps> = ({
  order,
  userPhone,
  driverCoords,
  onlineBillingRules,
  onAccept,
  onDecline,
}) => {
  // 60秒倒计时：严格由中国大陆阿里云服务器权威倒计时决定 (服务器显示60就显示60，服务器显示31就显示31)
  const targetOrderId = String((order as any)?.orderId || (order as any)?.id || (order as any)?.orderNo || '').trim();
  const cleanDriverPhone = String(userPhone || (order as any)?.dispatchedDriverPhone || '').replace(/\D/g, '').trim();

  const isMerchantValet = Boolean(
    order.isValetOrder ||
    order.orderRemark === '商户代叫' ||
    order.orderType === '商户代叫' ||
    order.isPlatformDispatch
  );

  const [timeLeft, setTimeLeft] = useState<number>(() => {
    if (typeof (order as any)?.serverCountdown === 'number') {
      return Math.max(0, Math.min(60, (order as any).serverCountdown));
    }
    if (typeof (order as any)?.dispatchCountdown === 'number') {
      return Math.max(0, Math.min(60, (order as any).dispatchCountdown));
    }
    const now = Date.now();
    const exp = Number((order as any)?.dispatchExpiresAt || ((order as any)?.dispatchedAt ? Number((order as any).dispatchedAt) + 60000 : now + 60000));
    const remainingSecs = Math.max(0, Math.ceil((exp - now) / 1000));
    return Math.max(0, Math.min(60, remainingSecs > 0 ? remainingSecs : 60));
  });

  // 监听 props 中实时下发的服务器秒数
  useEffect(() => {
    if (typeof (order as any)?.serverCountdown === 'number') {
      const sSec = (order as any).serverCountdown;
      setTimeLeft(Math.max(0, Math.min(60, sSec)));
      if (sSec <= 0) {
        const orderAgeMs = Date.now() - (Number((order as any)?.timestamp || (order as any)?.dispatchedAt || Date.now()));
        if (orderAgeMs > 25000) {
          onDecline();
        }
      }
    }
  }, [(order as any)?.serverCountdown, onDecline, order]);

  // 倒计时核心引擎：每秒主动对齐中国大陆阿里云服务器 /api/dispatch/countdown 权威秒数
  useEffect(() => {
    let isMounted = true;
    const baseUrl = getBaseApiUrl();

    const syncWithServerCountdown = async () => {
      try {
        const queryParams = new URLSearchParams();
        if (targetOrderId) queryParams.set('orderId', targetOrderId);
        if (cleanDriverPhone) queryParams.set('driverPhone', cleanDriverPhone);
        queryParams.set('_t', String(Date.now()));

        const resp = await fetch(`${baseUrl}/api/dispatch/countdown?${queryParams.toString()}`, {
          cache: 'no-store'
        });

        if (resp.ok && isMounted) {
          const data = await resp.json();
          if (data && data.success) {
            // 服务器判定超时、倒计时<=0 或已转入选单大厅 (且非本司机直接抢单的订单)
            if (
              !order?.isDirectClaim &&
              (data.isExpired || data.inHall || (typeof data.serverCountdown === 'number' && data.serverCountdown <= 0))
            ) {
              const orderAgeMs = Date.now() - (Number((order as any)?.timestamp || (order as any)?.dispatchedAt || Date.now()));
              // 严密防抖防闪保护：刚刚创建下单25秒内的派单，绝不误触超时拒单
              if (orderAgeMs > 25000) {
                setTimeLeft(0);
                onDecline();
                return;
              }
            }

            if (typeof data.serverCountdown === 'number') {
              // 严格锁定显示服务器的秒数 (例如60秒、31秒等)
              setTimeLeft(Math.max(0, Math.min(60, data.serverCountdown)));
            }
          }
        }
      } catch (_) {
        // 网络微弱时客户端本地平滑递减兜底
      }
    };

    // 立即执行首次服务器对齐
    syncWithServerCountdown();

    // 每秒与阿里云服务器心跳同步，确保秒数100%由服务器掌控
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        const next = Math.max(0, prev - 1);
        if (next <= 0) {
          const orderAgeMs = Date.now() - (Number((order as any)?.timestamp || (order as any)?.dispatchedAt || Date.now()));
          if (orderAgeMs > 25000) {
            onDecline();
          }
        }
        return next;
      });
      syncWithServerCountdown();
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [targetOrderId, cleanDriverPhone, onDecline, order]);

  // 无论3公里内还是3公里外派单，只要司机端屏幕弹出 w31 新来单页面，立即标记为忙碌状态并上报服务器
  useEffect(() => {
    const phone = userPhone || localStorage.getItem('dd_user_phone') || '';
    if (phone) {
      reportDriverBusyStatus(phone, true, { currentView: 'incoming_overlay', isBusy: true });
    }
  }, [userPhone]);

  // Parse details with fallbacks
  const startLocation = order.startLocation || '运祥小区(北寺巷)';
  // 所有商户代叫订单，新来单页面里的目的地，由司机根据现场口头协商规划行程，取消显示，目的地为空
  const isDestinationEmpty = isMerchantValet || !order.destination || order.destination.trim() === '';
  const destination = isMerchantValet ? '' : (isDestinationEmpty ? '未知' : order.destination);
  const passengerPhone = order.passengerPhone || '系统分配乘客';
  
  // Dynamic random price if not specified
  const [approxPrice] = useState<any>(() => {
    if (isDestinationEmpty) return '40';
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

  // Find current active slot starting price from onlineBillingRules locked to the order timestamp
  const orderTimeMs = order.timestamp ? Number(order.timestamp) : Date.now();
  const startPrice = React.useMemo(() => {
    const slot = getTimeSlotForTime(onlineBillingRules, orderTimeMs);
    return slot?.startingPrice ?? 35;
  }, [onlineBillingRules, orderTimeMs]);

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

    const savedLat = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lat') : null;
    const savedLng = typeof window !== 'undefined' ? localStorage.getItem('dd_bg_driver_coords_lng') : null;
    const currentCoords = (driverCoords && isValidCoords(driverCoords.lat, driverCoords.lng))
      ? driverCoords
      : (savedLat && savedLng ? { lat: Number(savedLat), lng: Number(savedLng) } : DEFAULT_YINCHUAN_COORDS);

    const { displayDistText } = calculateOrderDriverDistance(
      order.startLocation,
      order.passengerLat || (order as any).resolvedLat || (order as any).lat,
      order.passengerLng || (order as any).resolvedLng || (order as any).lng,
      currentCoords
    );

    if (displayDistText) {
      return displayDistText;
    }

    if (order.distanceText) {
      return order.distanceText;
    }
    return '300米';
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

  // Active cancellation listener while incoming order modal is open
  useEffect(() => {
    const rawId = String((order as any)?.id || (order as any)?.orderId || '').trim();
    const rawOrderNo = String((order as any)?.orderNo || '').trim();
    const validCandidateIds = [rawId, rawOrderNo].filter(id => id && id.length > 3 && !id.match(/^1[3-9]\d{9}$/));
    
    if (validCandidateIds.length === 0) return;

    const checkCancelled = () => {
      try {
        const latestRaw = localStorage.getItem('dd_latest_cancelled_order');
        if (latestRaw) {
          const parsed = JSON.parse(latestRaw);
          const pId = String(parsed.orderId || '').trim();
          const pNo = String(parsed.orderNo || '').trim();
          if ((pId && validCandidateIds.includes(pId)) || (pNo && validCandidateIds.includes(pNo))) {
            stopSpeaking();
            onDecline();
            return;
          }
        }
        const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
        const match = saved.find((o: any) => {
          const oId = String(o.id || o.orderId || '').trim();
          const oNo = String(o.orderNo || '').trim();
          return (oId && validCandidateIds.includes(oId)) || (oNo && validCandidateIds.includes(oNo));
        });
        if (match && (match.status === 'cancelled' || match.statusCategory === '已取消' || match.statusCategory === '订单已取消')) {
          stopSpeaking();
          onDecline();
        }
      } catch (_) {}
    };

    const handleCustomCancelled = (e: any) => {
      if (e?.detail) {
        const d = e.detail;
        const dId = String(d.orderId || '').trim();
        const dNo = String(d.orderNo || '').trim();
        if ((dId && validCandidateIds.includes(dId)) || (dNo && validCandidateIds.includes(dNo))) {
          stopSpeaking();
          onDecline();
        }
      }
    };

    window.addEventListener('merchant_order_cancelled', handleCustomCancelled);
    window.addEventListener('merchant_orders_updated', checkCancelled);
    const interval = setInterval(checkCancelled, 1500);

    return () => {
      window.removeEventListener('merchant_order_cancelled', handleCustomCancelled);
      window.removeEventListener('merchant_orders_updated', checkCancelled);
      clearInterval(interval);
    };
  }, [order, onDecline]);

  // Keep latest order and broadcast speech text in ref so async prop updates never restart/interrupt speech
  const orderRef = React.useRef<any>(order);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const speechTextRef = React.useRef<string>('');
  useEffect(() => {
    const effectivePrice = (order.isValetOrder || order.isPlatformDispatch) ? '未知' : approxPrice;
    speechTextRef.current = getTTSBroadcastText(order, effectivePrice, startLocation, destination, distanceText);
  }, [order, approxPrice, startLocation, destination, distanceText]);

  // Handle TTS and Vibrate with continuous stable loop until accepted, declined or expired
  // Keyed strictly on targetOrderId to guarantee zero stutter/cutoffs/intermittent playback
  useEffect(() => {
    let isActive = true;
    let timerId: any = null;

    initAudioUnlock();

    const playSpeech = () => {
      if (!isActive) return;
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate([400, 200, 400, 200, 600]);
          } catch (e) {}
        }

        const currentOrderObj = orderRef.current || order;
        const textToSpeak = speechTextRef.current || getTTSBroadcastText(currentOrderObj, '未知', startLocation, destination, distanceText);
        
        speakText(textToSpeak, () => {
          if (isActive) {
            // Pause 1.5 second between repeat loops for smooth, coherent audio
            timerId = setTimeout(() => {
              playSpeech();
            }, 1500);
          }
        });
      } catch (e) {
        console.error('Speech synthesis loop failed:', e);
      }
    };

    // Initial audio trigger with slight delay to ensure mobile AudioContext readiness
    const initialTimer = setTimeout(() => {
      playSpeech();
    }, 120);

    return () => {
      isActive = false;
      clearTimeout(initialTimer);
      if (timerId) clearTimeout(timerId);
      stopSpeaking();
    };
  }, [targetOrderId]);

  const [isAccepting, setIsAccepting] = useState(false);

  const handleConfirmOrder = async (e?: React.SyntheticEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isAccepting) return;
    setIsAccepting(true);

    try {
      stopSpeaking();

      // Prevent duplicate accepting of already ended/completed orders with 1.2s timeout race
      const ended = await Promise.race([
        isOrderAlreadyEnded(order, userPhone),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1200))
      ]).catch(() => false);

      if (ended) {
        speakText('该订单已结单，无法重复接单');
        onDecline();
        return;
      }

      speakText('接单成功，请前往接驾地点');
      const orderNumber = (order as any)?.orderNo || (order as any)?.orderId || (order as any)?.id || ('YC' + Date.now());
      const rawOrderId = String((order as any)?.id || (order as any)?.orderId || orderNumber).trim();
      const cleanUserPhone = String(userPhone || localStorage.getItem('dd_user_phone') || '').replace(/\D/g, '').trim();

      const trip: TripState = {
        id: rawOrderId,
        orderNumber: orderNumber,
        passengerName: order.isValetOrder ? '商户代叫乘客' : '线上自助预约乘客',
        passengerPhone: passengerPhone,
        startLocation: startLocation,
        endLocation: isMerchantValet ? '' : destination,
        startTimestamp: orderTimeMs,
        currentDistance: 0.0,
        currentWaitingTime: 0,
        currentStatus: 'serving',
        extraBridgeFee: 0,
        extraParkingFee: 0,
        extraOtherFee: 0,
        calculatedBaseFee: startPrice,
        calculatedTotalFee: startPrice,
        isOnlineOrder: true,
        orderType: (order.orderType === '报单转单' || order.orderRemark === '报单转单' || order.type === '报单转单')
          ? '报单转单'
          : (order.isValetOrder ? '商户代叫' : '二维码开单'),
        orderRemark: order.orderRemark || ((order.orderType === '报单转单' || order.type === '报单转单') ? '报单转单' : (order.isValetOrder ? '商户代叫' : '')),
      };

      // Atomic claim call to server to lock in 'claimed' / 'serving' status and avoid 30s timeout reset
      try {
        const baseUrl = getBaseApiUrl();
        fetch(`${baseUrl}/api/order/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: rawOrderId,
            orderNo: orderNumber,
            driverPhone: cleanUserPhone,
            orderPayload: { ...order, ...trip }
          })
        }).catch(() => {});
      } catch (_) {}

      onAccept(trip);
    } catch (err) {
      console.error('Confirm order execution error:', err);
      // Fallback direct accept on error
      onAccept({
        id: 'DD' + Date.now(),
        orderNumber: 'DD' + Date.now(),
        passengerName: order.isValetOrder ? '商户代叫乘客' : '线上自助预约乘客',
        passengerPhone: passengerPhone,
        startLocation: startLocation,
        endLocation: isMerchantValet ? '' : destination,
        startTimestamp: orderTimeMs,
        currentDistance: 0.0,
        currentWaitingTime: 0,
        currentStatus: 'serving',
        extraBridgeFee: 0,
        extraParkingFee: 0,
        extraOtherFee: 0,
        calculatedBaseFee: startPrice,
        calculatedTotalFee: startPrice,
        isOnlineOrder: true,
        orderType: (order.orderType === '报单转单' || order.orderRemark === '报单转单' || order.type === '报单转单')
          ? '报单转单'
          : (order.isValetOrder ? '商户代叫' : '二维码开单'),
        orderRemark: order.orderRemark || ((order.orderType === '报单转单' || order.type === '报单转单') ? '报单转单' : (order.isValetOrder ? '商户代叫' : '')),
      });
    } finally {
      setIsAccepting(false);
    }
  };

  const displayEstimatedPrice = (() => {
    let raw: any = null;
    if (order.calculatedTotalFee !== undefined && order.calculatedTotalFee !== null) {
      raw = order.calculatedTotalFee;
    } else if (order.estimatedPrice !== undefined && order.estimatedPrice !== null) {
      raw = order.estimatedPrice;
    } else if (order.price !== undefined && order.price !== null) {
      raw = order.price;
    } else if (typeof approxPrice === 'number' && approxPrice > 0) {
      raw = approxPrice;
    }
    if (raw !== null) {
      const num = Number(String(raw).replace(/[^\d.]/g, ''));
      if (!isNaN(num) && num > 0) {
        return Math.round(num) === num ? String(num) : String(num.toFixed(1));
      }
    }
    return '40';
  })();

  const modeBadgeText = (() => {
    if (order?.orderType === '报单转单' || order?.orderRemark === '报单转单' || order?.type === '报单转单') {
      return '报单转单订单';
    }
    if (isMerchantValet) {
      return '商户代叫订单';
    }
    return '二维码开单';
  })();

  const topCategoryText = (() => {
    if (order?.orderType === '报单转单' || order?.orderRemark === '报单转单' || order?.type === '报单转单') {
      return '报单转单';
    }
    if (isMerchantValet) {
      return '商户代叫';
    }
    return '二维码开单';
  })();

  const destinationDisplay = (() => {
    if (order.destination && order.destination.trim() && order.destination !== '未知' && order.destination !== '自行协商') {
      return order.destination;
    }
    return '由司机根据现场口头协商规划行程';
  })();

  return (
    <div className="absolute inset-0 z-[999] bg-gray-50 flex flex-col justify-between overflow-hidden select-none w-full h-full">
      
      {/* HEADER SECTION (Matching Image q3) */}
      <header className="bg-[#e61a1a] text-white px-4 flex flex-col items-center relative pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-12 sm:pb-14 shrink-0 shadow-sm">
        <div className="w-full flex justify-between items-center mb-2 sm:mb-3">
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4 text-amber-300 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
            </svg>
            <span className="text-white font-black text-sm tracking-wide">
              {topCategoryText}
            </span>
          </div>
          <button 
            onClick={onDecline}
            className="font-bold text-white text-xs sm:text-sm hover:opacity-85 active:scale-95 bg-black/20 hover:bg-black/30 border border-white/20 px-3.5 py-1 rounded-full transition-all cursor-pointer"
          >
            取消订单
          </button>
        </div>

        {/* Income Display (Image q3: 自行协商) */}
        <div className="flex flex-col items-center my-1.5 sm:my-2.5">
          <div className="flex items-baseline justify-center">
            {order.isPlatformDispatch || order.isValetOrder || isMerchantValet || approxPrice === '未知' || approxPrice === '自行协商' ? (
              <span className="text-4xl sm:text-5xl font-black tracking-tight" style={{ fontFamily: 'sans-serif' }}>
                自行协商
              </span>
            ) : (
              <div className="flex items-baseline justify-center">
                <span className="text-lg sm:text-xl font-bold mr-1 opacity-90">约</span>
                <span className="text-4xl sm:text-5xl font-black tracking-tight" style={{ fontFamily: 'sans-serif' }}>
                  {displayEstimatedPrice}
                </span>
                <span className="text-lg sm:text-xl font-bold ml-1 opacity-90">元</span>
              </div>
            )}
          </div>
        </div>

        {/* Order Type Badge (Image q3: 商户代叫订单) */}
        <div className="border border-white/40 rounded-full py-1 px-4 sm:py-1.5 sm:px-6 font-medium text-xs sm:text-sm mt-1 sm:mt-1.5 bg-white/10 backdrop-blur-xs tracking-wide flex items-center justify-center">
          <span className="font-bold text-white">{modeBadgeText}</span>
        </div>
      </header>

      {/* TRIP DETAILS SECTION (Matching Image q3) */}
      <main className="flex-1 flex flex-col -mt-8 sm:-mt-9 mx-3 sm:mx-4 z-40 bg-white rounded-2xl sm:rounded-3xl shadow-xl overflow-hidden mb-3 sm:mb-4 border border-gray-150/50">
        
        {/* Distance summary: 客人直线距离 (Image q3) */}
        <section className="bg-[#fcfdfe] px-4 sm:px-5 border-b border-gray-100 flex justify-between items-center py-3 sm:py-3.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-[#64748b]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
            <span className="text-xs sm:text-sm font-bold text-slate-500">客人直线距离</span>
          </div>
          <div>
            <span className="text-base sm:text-lg font-black text-[#dc2626] font-mono tracking-tight">{distanceText}</span>
          </div>
        </section>

        {/* Scheduled Time & Scooter Requirement Info (Matching Image q3) */}
        <section className="bg-orange-50/80 px-4 sm:px-5 py-2.5 border-b border-orange-100/70 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs">
            <Clock className="w-3.5 h-3.5 text-[#ff7d00] shrink-0" />
            <span className="text-gray-600 font-medium">预约时间：</span>
            <span className="font-extrabold text-[#311300] bg-orange-100/90 px-1.5 py-0.5 rounded-md text-[11px] sm:text-xs">
              {displayScheduledTime}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <Bike className="w-3.5 h-3.5 text-[#ff7d00] shrink-0" />
            <span className="text-gray-600 font-medium">代步车：</span>
            <span className={`font-extrabold px-1.5 py-0.5 rounded-md text-[11px] sm:text-xs ${
              displayNeedScooter === '需要'
                ? 'bg-teal-100 text-teal-800'
                : 'bg-gray-100 text-gray-700'
            }`}>
              {displayNeedScooter}
            </span>
          </div>
        </section>

        {/* Address Timeline (Matching Image q3) */}
        <section className="px-4 sm:px-6 py-4 flex-1 flex flex-col justify-center relative min-h-[140px] overflow-y-auto">
          <div className="relative pl-7 sm:pl-8 flex flex-col justify-between h-full py-1">
            
            {/* Timeline dotted line style */}
            <div 
              className="absolute left-[11px] sm:left-[13px] top-[16px] bottom-[16px]" 
              style={{
                borderLeft: '2px dashed #cbd5e1',
              }}
            />

            {/* Pickup Node (Image q3: 乘客出发地) */}
            <div className="relative flex items-start mb-4 sm:mb-5">
              <div className="absolute -left-[27px] sm:-left-[31px] w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-cyan-500 text-white flex items-center justify-center text-[10px] font-bold">
                起
              </div>
              <div className="flex flex-col pl-1.5 sm:pl-2">
                <span className="text-[11px] sm:text-xs text-gray-400 font-bold mb-1">乘客出发地</span>
                <div className="bg-white px-3 py-1.5 rounded-lg shadow-sm border border-gray-150 flex items-center gap-1.5 text-xs font-black text-gray-800 self-start max-w-full">
                  <span className="w-2 h-2 rounded-full bg-[#189F95] shrink-0" style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '9999px' }}></span>
                  <span className="break-all">{startLocation}</span>
                </div>
              </div>
            </div>

            {/* Dropoff Node (Image q3: 目的地 - 由司机根据现场口头协商规划行程) */}
            <div className="relative flex items-start">
              <div className="absolute -left-[27px] sm:-left-[31px] w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-orange-600 text-white flex items-center justify-center text-[10px] font-bold">
                终
              </div>
              <div className="flex flex-col pl-1.5 sm:pl-2">
                <span className="text-[11px] sm:text-xs text-gray-400 font-bold mb-1">目的地</span>
                <div className="bg-white px-3 py-1.5 rounded-lg shadow-sm border border-gray-150 flex items-center gap-1.5 text-xs font-black text-gray-800 self-start max-w-full">
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '9999px' }}></span>
                  <span className="break-all">{destinationDisplay}</span>
                </div>
              </div>
            </div>

          </div>
        </section>
      </main>

      {/* STICKY FOOTER ACTIONS (Matching Image q3: 确认接单 button) */}
      <footer className="shrink-0 w-full pt-2 px-4 pb-3 bg-white border-t border-gray-100 flex flex-col items-center z-[1000] relative shadow-[0_-4px_16px_rgba(0,0,0,0.06)] android-nav-safe-pb">
        {/* Countdown message (Image q3) */}
        <div className="w-full flex justify-center items-center py-1 text-center">
          <span className="text-xs sm:text-sm font-bold text-[#e61a1a] animate-pulse">
            (请在 <span className="text-sm sm:text-base font-black px-1 font-mono">{timeLeft}</span> 秒内确认接单)
          </span>
        </div>
        
        {/* Single Action Button (Image q3: Full width Red 确认接单) */}
        <div className="w-full mt-1.5">
          <button 
            onClick={handleConfirmOrder}
            onTouchEnd={handleConfirmOrder}
            disabled={isAccepting}
            className="w-full bg-[#e61a1a] active:bg-[#c81414] hover:bg-[#d01515] text-white py-3.5 sm:py-4 rounded-xl sm:rounded-2xl text-base sm:text-lg font-black text-center transition-all shadow-lg shadow-rose-600/25 active:scale-95 disabled:opacity-50 cursor-pointer touch-manipulation flex items-center justify-center gap-1.5"
            data-purpose="confirm-order-btn"
          >
            <span>{isAccepting ? '正在确认接单...' : '确认接单'}</span>
          </button>
        </div>
      </footer>

    </div>
  );
};
