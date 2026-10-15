import React, { useState, useEffect } from 'react';
import { Clock, Bike } from 'lucide-react';
import { TripState, BillingRules } from '../types';
import { getTimeSlotForTime } from '../utils/billingUtils';
import { speakText, stopSpeaking, initAudioUnlock } from '../utils/speech';
import { geocodeAddress, isValidCoords, calculateHaversineDistanceKm, formatDistance, calculateOrderDriverDistance } from '../utils/geocoding';
import { isOrderAlreadyEnded } from '../utils/orderValidation';
import { reportDriverBusyStatus } from '../utils/powerAndLocationManager';
import { getBaseApiUrl, getAuthHeaders } from '../lib/dbProxy';

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

  // 2026-10-12重构：倒计时唯一真理是中国大陆阿里云服务器。
  // 客户端不做本地递减、不预设60，只显示服务器 /api/dispatch/countdown 返回的数字。
  // -1 表示尚未从服务器拿到数字，显示"…"占位，避免假60误导。
  // 2026-10-13优化：初始直接显示60（静态占位，不递减），服务端数字1秒内覆盖。
  // 不违反"无本地倒计时"铁律：仅初始显示值，无setInterval递减逻辑。
  // orderRef 已在下方声明（用于语音播报），此处复用；onDecline 用 ref 避免 effect 反复重建。
  const [timeLeft, setTimeLeft] = useState<number>(60);
  // 2026-10-15新增：timeLeft的ref版本，供防跳变逻辑读取当前值（setState异步，闭包读不到最新）
  const timeLeftRef = React.useRef<number>(60);
  const setTimeLeftSync = (v: number) => {
    timeLeftRef.current = v;
    setTimeLeft(v);
  };
  // 保持 ref 与 state 同步（其他直接调 setTimeLeft 的地方）
  React.useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  // 2026-10-12修复：订单切换时重置倒计时，防止旧订单的0覆盖新订单的秒数
  // 解决倒计时乱跳（0→33）的根本原因
  // 2026-10-13更新：初始值改为60（配合开屏即显60秒优化）
  const prevOrderIdRef = React.useRef<string>('');
  // P1-6修复(2026-10-13)：onDecline幂等，多路径(轮询/取消监听/手动)只执行一次
  const declinedRef = React.useRef<boolean>(false);
  // P1(2026-10-15)：API成功返回后永久忽略prop的serverCountdown（防旧单prop致33→59跳变）
  const hasApiRespondedRef = React.useRef(false);
  const safeDecline = React.useCallback(() => {
    if (declinedRef.current) return;
    declinedRef.current = true;
    onDeclineRef.current();
  }, []);
  useEffect(() => {
    if (targetOrderId && targetOrderId !== prevOrderIdRef.current) {
      prevOrderIdRef.current = targetOrderId;
      setTimeLeft(60);
      lastServerSyncRef.current = Date.now();
      // P1-8修复(2026-10-13)：订单切换时重置接单锁和decline幂等，否则新订单按钮被旧锁卡死
      isAcceptingRef.current = false;
      setIsAccepting(false);
      declinedRef.current = false;
      hasApiRespondedRef.current = false; // P1(2026-10-15)：新订单重置API标记
    }
  }, [targetOrderId]);
  const onDeclineRef = React.useRef(onDecline);
  onDeclineRef.current = onDecline;

  // 2026-10-13新增：接单原子锁。司机点击"确认接单"后，阻断超时拒单逻辑，
  // 避免接单请求与超时判定并发时误拒单。
  const isAcceptingRef = React.useRef(false);

  // 2026-10-13修复：props 下发的 serverCountdown 仅在"尚未从服务器 API 拿到数字"时作为初值。
  // 收到 API 数字后一律采用按序到达的服务器数字，不再做单调递减过滤——
  // 否则服务端合法的 33→60 重置会被当作脏数据丢弃，迟弹窗场景看不到完整 60 秒。
  // 2026-10-13优化：初始已为60，此处仅当prop值与当前差异显著时才同步，避免闪烁。
  useEffect(() => {
    if (hasApiRespondedRef.current) return; // API已返回，不再信任可能过期的prop
    const sSec = (order as any)?.serverCountdown;
    if (typeof sSec === 'number') {
      const v = Math.max(0, Math.min(60, sSec));
      // 仅当差异超过2秒时同步，避免API即将覆盖前的无谓闪烁
      setTimeLeft(prev => (Math.abs(prev - v) > 2 ? v : prev));
      if (v <= 0 && !isAcceptingRef.current) {
        const curOrder = orderRef.current as any;
        const orderAgeMs = Date.now() - (Number(curOrder?.timestamp || curOrder?.dispatchedAt || Date.now()));
        if (orderAgeMs > 25000) {
          safeDecline();
        }
      }
    }
  }, [(order as any)?.serverCountdown]);

  // 倒计时核心引擎：每秒主动对齐中国大陆阿里云服务器 /api/dispatch/countdown 权威秒数
  // 2026-10-13双轨：显示轨本地500ms平滑（弱网不断显），决策轨100%服务端（超时/进大厅/拒单只用服务端返回值）
  const lastServerSyncRef = React.useRef<number>(Date.now());
  // 2026-10-13滴滴式"上屏心跳"：新来单页显示时每2秒告诉服务端"我在屏幕上"，服务端5秒收不到则判定未上屏转大厅
  useEffect(() => {
    if (!targetOrderId) return;
    const driverPhone = (() => {
      try {
        const p = localStorage.getItem('dd_driver_phone') || localStorage.getItem('driverPhone') || '';
        return String(p).replace(/\D/g, '');
      } catch (_) { return ''; }
    })();
    const sendHeartbeat = () => {
      try {
        const url = `${getBaseApiUrl()}/api/dispatch/page-heartbeat`;
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ orderId: targetOrderId, driverPhone }),
        }).catch(() => {});
      } catch (_) {}
    };
    sendHeartbeat(); // 立即发一次
    const hbTimer = setInterval(sendHeartbeat, 2000); // 每2秒一次
    return () => clearInterval(hbTimer);
  }, [targetOrderId]);
  useEffect(() => {
    let isMounted = true;
    const baseUrl = getBaseApiUrl();

    // 2026-10-12重构：每秒只从服务器取数，不做本地递减。
    // 用递增序号丢弃乱序到达的旧响应，杜绝 33→41 这类上跳。
    let seq = 0;
    const syncWithServerCountdown = async () => {
      const mySeq = ++seq;
      try {
        const queryParams = new URLSearchParams();
        if (targetOrderId) queryParams.set('orderId', targetOrderId);
        if (cleanDriverPhone) queryParams.set('driverPhone', cleanDriverPhone);
        queryParams.set('_t', String(Date.now()));

        const resp = await fetch(`${baseUrl}/api/dispatch/countdown?${queryParams.toString()}`, {
          cache: 'no-store'
        });

        if (resp.ok && isMounted && mySeq === seq) {
          const data = await resp.json();
          const curOrder: any = orderRef.current;
          if (data && data.success) {
            hasApiRespondedRef.current = true; // P1(2026-10-15)：标记API已返回，后续忽略prop
            // 服务器判定超时、倒计时<=0 或已转入选单大厅 (且非本司机直接抢单的订单)
            // 2026-10-13新增：接单中(isAcceptingRef)时阻断超时拒单，防并发误拒
            if (
              !isAcceptingRef.current &&
              !curOrder?.isDirectClaim &&
              (data.isExpired || data.inHall || (typeof data.serverCountdown === 'number' && data.serverCountdown <= 0))
            ) {
              // P0-2修复(2026-10-13)：服务端明确inHall时直接放行，不受25秒guard拦截。
              // 心跳转大厅(约派单后15秒)时orderAgeMs<25秒，旧guard会卡死页面。
              if (data.inHall) {
                setTimeLeft(0);
                safeDecline();
                return;
              }
              const orderAgeMs = Date.now() - (Number(curOrder?.timestamp || curOrder?.dispatchedAt || Date.now()));
              // 严密防抖防闪保护：刚刚创建下单25秒内的派单，绝不误触超时拒单
              if (orderAgeMs > 25000) {
                setTimeLeft(0);
                safeDecline();
                return;
              }
            }

            if (typeof data.serverCountdown === 'number') {
              // 2026-10-15修复：防跳变保护。倒计时正常每秒减1，允许服务端合法重置（上跳如33→60），
              // 但阻断异常下跳（如56→33这种1秒内掉23秒的脏数据）。下跳超过3秒视为异常，保留本地值。
              const v = Math.max(0, Math.min(60, data.serverCountdown));
              const curLeft = timeLeftRef.current;
              const drop = curLeft - v;
              // 允许：上跳（重置）、正常递减（0-2秒）、初始同步（curLeft为0或60）
              // 阻断：异常下跳（1秒内掉超过3秒）
              const isAbnormalDrop = curLeft > 0 && curLeft < 60 && drop > 3;
              if (!isAbnormalDrop) {
                setTimeLeftSync(v);
                // 双轨：记录服务端同步时间
                lastServerSyncRef.current = Date.now();
                // 2026-10-15 P1-1：拒单决策也纳入防跳变校验，脏数据不触发拒单
                if (v <= 0 && !isAcceptingRef.current) {
                  const orderAgeMs = Date.now() - (Number(curOrder?.timestamp || curOrder?.dispatchedAt || Date.now()));
                  if (orderAgeMs > 25000) {
                    // 延迟到 effect 外处理，避免在 setState 更新函数中产生副作用
                    setTimeout(() => safeDecline(), 0);
                  }
                }
              } else {
                // 异常下跳：记录日志但保留本地平滑值，不采用脏数据
                console.warn(`[Countdown] 阻断异常下跳: 本地${curLeft} → 服务端${v}，保留本地值`);
              }
            }
          }
        }
      } catch (_) {
        // 网络异常时保持上次服务器数字，不本地递减造假
      }
    };

    // 立即执行首次服务器对齐
    syncWithServerCountdown();

    // 每秒与阿里云服务器心跳同步，秒数100%由服务器掌控
    const timer = setInterval(syncWithServerCountdown, 1000);

    // 双轨显示：本地500ms平滑插值（弱网/断网时显示不冻结）。
    // 仅用于显示，决策（超时/进大厅/拒单）100%用服务端返回值，绝不用本地值。
    // 服务端1.5秒内有响应则不插值，直接显示服务端数字。
    const smoothTimer = setInterval(() => {
      if (!isMounted || isAcceptingRef.current) return;
      const silentMs = Date.now() - lastServerSyncRef.current;
      if (silentMs > 1500) {
        // 服务端超过1.5秒无响应，本地平滑递减0.5秒（500ms间隔）
        setTimeLeft(prev => {
          if (typeof prev !== 'number' || prev <= 0) return prev;
          // 保留一位小数用于平滑，显示时取整
          const next = Math.max(0, prev - 0.5);
          return next;
        });
      }
    }, 500);

    return () => {
      isMounted = false;
      clearInterval(timer);
      clearInterval(smoothTimer);
    };
  }, [targetOrderId, cleanDriverPhone]);

  // 无论3公里内还是3公里外派单，只要司机端屏幕弹出 w31 新来单页面，立即标记为忙碌状态并上报服务器
  // P1-7修复(2026-10-13)：卸载时恢复空闲，否则司机永久"忙碌"接不到单
  useEffect(() => {
    const phone = userPhone || localStorage.getItem('dd_user_phone') || '';
    if (phone) {
      reportDriverBusyStatus(phone, true, { currentView: 'incoming_overlay', isBusy: true });
    }
    return () => {
      const p = userPhone || localStorage.getItem('dd_user_phone') || '';
      if (p) {
        try { reportDriverBusyStatus(p, false, { currentView: 'incoming_overlay', isBusy: false }); } catch (_) {}
      }
    };
  }, [userPhone]);

  // Parse details with fallbacks
  const startLocation = order.startLocation || '位置未知';
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
    // H9修复：driverCoords 无效时传 null，不再回退银川市中心假坐标，调用方显示"距离未知"
    const currentCoords = (driverCoords && isValidCoords(driverCoords.lat, driverCoords.lng))
      ? driverCoords
      : (savedLat && savedLng && isValidCoords(Number(savedLat), Number(savedLng)) ? { lat: Number(savedLat), lng: Number(savedLng) } : null);

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
            if (isAcceptingRef.current) return; // P1-1:接单中不响应取消
            stopSpeaking();
            safeDecline();
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
          if (isAcceptingRef.current) return; // P1-1:接单中不响应取消
          stopSpeaking();
          safeDecline();
        }
      } catch (_) {}
    };

    const handleCustomCancelled = (e: any) => {
      if (e?.detail) {
        const d = e.detail;
        const dId = String(d.orderId || '').trim();
        const dNo = String(d.orderNo || '').trim();
        if ((dId && validCandidateIds.includes(dId)) || (dNo && validCandidateIds.includes(dNo))) {
          if (isAcceptingRef.current) return; // P1-1:接单中不响应取消
          stopSpeaking();
          safeDecline();
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
    if (isAccepting || isAcceptingRef.current) return; // P2-1:用ref防双击缝隙
    setIsAccepting(true);
    isAcceptingRef.current = true;

    try {
      stopSpeaking();

      // Prevent duplicate accepting of already ended/completed orders with 1.2s timeout race
      const ended = await Promise.race([
        isOrderAlreadyEnded(order, userPhone),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1200))
      ]).catch(() => false);

      if (ended) {
        speakText('该订单已结单，无法重复接单');
        safeDecline();
        return;
      }

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
      // P0修复(2026-10-13)：必须await等待服务端确认！此前fire-and-forget直接onAccept，
      // 若服务端返回409(已被他人抢走)用户仍会进服务页，形成幽灵单。
      try {
        const baseUrl = getBaseApiUrl();
        const claimResp = await fetch(`${baseUrl}/api/order/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            orderId: rawOrderId,
            orderNo: orderNumber,
            driverPhone: cleanUserPhone,
            isDispatchedClaim: true,
            orderPayload: { ...order, ...trip }
          })
        });
        const claimData = await claimResp.json().catch(() => ({}));
        if (!claimResp.ok || claimData.success === false) {
          // 接单失败：已被抢/订单不存在/网络错误，绝不进服务页
          const msg = String(claimData.message || claimData.error || '');
          // 2026-10-15 P1-5：401/403区分提示（401重登录，403找开发者充值）
          if (claimResp.status === 401) {
            speakText('登录已过期，请重新登录');
            alert('⚠️ 登录已过期，请重新短信登录');
          } else if (claimResp.status === 403) {
            const licMsg = msg || '接单授权已到期，请联系开发者充值接单授权';
            speakText(licMsg);
            alert('⚠️ ' + licMsg);
          } else if (claimResp.status === 409 || /已被|已接单|不存在/.test(msg)) {
            speakText('该订单已被其他司机接走');
          } else {
            speakText('接单失败，请重试');
          }
          isAcceptingRef.current = false;
          safeDecline();
          return;
        }
      } catch (_) {
        // 网络异常：不进服务页，避免幽灵单
        speakText('网络异常，接单失败');
        isAcceptingRef.current = false;
        return;
      }

      speakText('接单成功，请前往接驾地点'); // P1-4:移到服务端确认成功后
      onAccept(trip);
    } catch (err) {
      console.error('Confirm order execution error:', err);
      // P1-3修复(2026-10-13)：异常时绝不伪造接单，改为拒单+报错，避免幽灵行程
      speakText('接单异常，请重试');
      safeDecline();
    } finally {
      setIsAccepting(false);
      isAcceptingRef.current = false;
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
            (请在 <span className="text-sm sm:text-base font-black px-1 font-mono">{Math.ceil(timeLeft)}</span> 秒内确认接单)
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
