import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Navigation, ChevronRight, Clock, ShieldCheck, X, PlusCircle, MinusCircle, CheckCircle, Phone } from 'lucide-react';
import { TripState, ChauffeurSettings, BillingRules, DEFAULT_SLOTS, checkVipActive } from '../types';
import NavigationView from './NavigationView';

const SUGGESTED_DESTINATIONS = [
  '银川火车站',
  '建发大阅城',
  '新华百货(鼓楼店)',
  '金凤万达广场',
  '悦海新天地购物广场',
  '银川河东国际机场',
  '阅海湾中央商务区',
];

// High-accuracy distance helper (uses AMap.GeometryUtil first, falls back to Haversine)
function getDistance(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const AMap = (window as any).AMap;
  if (AMap && AMap.GeometryUtil && typeof AMap.GeometryUtil.distance === 'function') {
    try {
      return AMap.GeometryUtil.distance([lng1, lat1], [lng2, lat2]); // returns meters
    } catch (e) {
      console.warn('[Distance helper] AMap.GeometryUtil.distance failed:', e);
    }
  }
  // Haversine formula fallback (returns meters)
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

interface ActiveTripViewProps {
  trip: TripState;
  settings: ChauffeurSettings;
  billingRules: BillingRules;
  driverCoords?: { lat: number; lng: number } | null;
  onUpdateTrip: (updated: TripState) => void;
  onEndTrip: (baseFee: number) => void;
}

export default function ActiveTripView({
  trip,
  settings,
  billingRules,
  driverCoords,
  onUpdateTrip,
  onEndTrip
}: ActiveTripViewProps) {
  const safeSettings = settings || { city: '银川市', deviationKm: 1.0, deviationWaitSec: 30, deviationMitigation: true } as any;
  const safeBillingRules = billingRules || { templateName: '标准计费', slots: DEFAULT_SLOTS, freeWaitingTime: 15, returnFeeStartKm: 0 } as any;
  const safeTrip: TripState = (trip && typeof trip === 'object') ? trip : {
    id: 'OL_DEFAULT',
    orderNumber: 'DD' + Date.now().toString().slice(-8),
    passengerName: '乘客',
    passengerPhone: '',
    startLocation: '银川大悦城',
    endLocation: '请填写目的地（选填）',
    startTimestamp: Date.now(),
    currentDistance: 0.0,
    currentWaitingTime: 0,
    currentStatus: 'serving',
    extraBridgeFee: 0,
    extraParkingFee: 0,
    extraOtherFee: 0,
    calculatedBaseFee: 59,
    calculatedTotalFee: 59,
    weatherMultiplier: 1.0,
    isOnlineOrder: true
  };

  // 1. Durations states (driving duration & waiting duration)
  const [drivingSeconds, setDrivingSeconds] = useState(0);
  const [waitingSeconds, setWaitingSeconds] = useState(() => (safeTrip.currentWaitingTime || 0) * 60);
  const [isWaiting, setIsWaiting] = useState(false);

  // Refs to avoid stale closures and infinite loop triggers in useEffect
  const tripRef = useRef(safeTrip);
  const billingRulesRef = useRef(safeBillingRules);
  const onUpdateTripRef = useRef(onUpdateTrip);

  useEffect(() => {
    tripRef.current = safeTrip;
  }, [safeTrip]);

  useEffect(() => {
    billingRulesRef.current = safeBillingRules;
  }, [safeBillingRules]);

  useEffect(() => {
    onUpdateTripRef.current = onUpdateTrip;
  }, [onUpdateTrip]);

  // Modal / Interaction states
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showDestModal, setShowDestModal] = useState(false);
  const [showNavigationView, setShowNavigationView] = useState(false);
  const [tempDest, setTempDest] = useState(safeTrip.endLocation || '');
  const [showSystemToast, setShowSystemToast] = useState(false);
  const [toastText, setToastText] = useState('');

  // Destination page and matching search suggest states
  const [showDestinationSearch, setShowDestinationSearch] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);

  // Local state or AMap auto completion suggestion loader
  useEffect(() => {
    const AMap = (window as any).AMap;
    if (!AMap || !searchText.trim()) {
      setSuggestions([]);
      return;
    }
    const delayDebounce = setTimeout(() => {
      AMap.plugin('AMap.AutoComplete', () => {
        try {
          const auto = new AMap.AutoComplete({
            city: settings.city || '银川市',
            citylimit: true
          });
          auto.search(searchText, (status: string, result: any) => {
            if (status === 'complete' && result.tips) {
              setSuggestions(result.tips.filter((t: any) => t.id && t.name));
            } else {
              setSuggestions([]);
            }
          });
        } catch (e) {
          console.warn('AutoComplete plugin failed:', e);
        }
      });
    }, 200);

    return () => clearTimeout(delayDebounce);
  }, [searchText, settings.city]);

  // Slider Drag states (Interactive Swiper simulation)
  const [sliderPos, setSliderPos] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const sliderWidthRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<number>(0);

  // 2. Mathematical cost calculation helper
  const calculateCost = (dist: number, waitMinutes: number, rules: BillingRules) => {
    const slots = (rules && Array.isArray(rules.slots) && rules.slots.length > 0) ? rules.slots : DEFAULT_SLOTS;
    const nowObj = new Date();
    const activeHour = nowObj.getHours();
    
    // Choose active slot based on hours
    let activeSlot = slots[0] || DEFAULT_SLOTS[0];
    for (const slot of slots) {
      if (!slot || !slot.startTime || !slot.endTime) continue;
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

    const base = activeSlot?.startingPrice ?? 40;
    const freeKm = activeSlot?.includedDistance ?? 7;
    const interval = activeSlot?.distanceInterval || 1;
    const increase = activeSlot?.priceIncrease ?? activeSlot?.unitPricePerKm ?? 5;

    let distanceCost = 0;
    if (dist > freeKm) {
      distanceCost = Math.ceil((dist - freeKm) / interval) * increase;
    }

    // Return trip surcharge
    let returnFee = 0;
    if (rules.returnFeeStartKm > 0 && dist > rules.returnFeeStartKm) {
      const rInterval = rules.returnFeeIntervalKm || 1;
      const rIncrease = rules.returnFeeIncreaseYuan ?? rules.returnFeePerKm ?? 0;
      returnFee = Math.ceil((dist - rules.returnFeeStartKm) / rInterval) * rIncrease;
    }

    // Waiting surcharge
    let waitingFee = 0;
    if (waitMinutes > rules.freeWaitingTime) {
      const wInterval = rules.waitingIntervalMin || 1;
      const wIncrease = rules.waitingIncreaseYuan ?? rules.waitingChargePerMin ?? 0;
      waitingFee = Math.ceil((waitMinutes - rules.freeWaitingTime) / wInterval) * wIncrease;
    }

    const wMultiplier = safeTrip.weatherMultiplier || 1.0;
    const totalCalculated = (base + distanceCost + returnFee + waitingFee) * wMultiplier;
    return {
      base: Number((base * wMultiplier).toFixed(2)),
      total: Number(totalCalculated.toFixed(2))
    };
  };

  // 3. Keep real-time counter ticking and advancing trip metrics (using absolute timestamps to survive background & lock screen)
  const tripStartMsRef = useRef<number>(safeTrip.startTimestamp || Date.now());
  const waitingStartMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (isWaiting && !waitingStartMsRef.current) {
      waitingStartMsRef.current = Date.now() - (waitingSeconds * 1000);
    } else if (!isWaiting) {
      waitingStartMsRef.current = null;
    }
  }, [isWaiting]);

  useEffect(() => {
    const updateDurations = () => {
      const now = Date.now();
      if (isWaiting) {
        if (waitingStartMsRef.current) {
          const wSec = Math.floor((now - waitingStartMsRef.current) / 1000);
          setWaitingSeconds(wSec);
          const wMins = Math.floor(wSec / 60);
          if (wMins !== tripRef.current.currentWaitingTime) {
            const currentTripValue = tripRef.current;
            const cost = calculateCost(currentTripValue.currentDistance, wMins, billingRulesRef.current);
            onUpdateTripRef.current({
              ...currentTripValue,
              currentWaitingTime: wMins,
              calculatedBaseFee: cost.base,
              calculatedTotalFee: cost.total
            });
          }
        }
      } else {
        const dSec = Math.floor((now - tripStartMsRef.current) / 1000);
        setDrivingSeconds(Math.max(0, dSec));
      }
    };

    updateDurations();
    const interval = setInterval(updateDurations, 1000);

    // App resume/unlock sync
    const handleVisibilitySync = () => {
      if (document.visibilityState === 'visible') {
        updateDurations();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilitySync);
    window.addEventListener('focus', handleVisibilitySync);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilitySync);
      window.removeEventListener('focus', handleVisibilitySync);
    };
  }, [isWaiting]);

  // Real-time GPS high-precision tracking & AMap mileage calculation
  const lastCoordsRef = useRef<{ lng: number; lat: number; timestamp: number } | null>(null);
  const preciseDistanceRef = useRef<number>(safeTrip.currentDistance || 0);

  // Restore saved active trip GPS state on mount if present
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`active_trip_gps_${safeTrip.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.lastCoords && typeof parsed.lastCoords.lng === 'number') {
          lastCoordsRef.current = parsed.lastCoords;
        }
        if (typeof parsed.preciseDistance === 'number' && parsed.preciseDistance > preciseDistanceRef.current) {
          preciseDistanceRef.current = parsed.preciseDistance;
        }
      }
    } catch (e) {}
  }, [safeTrip.id]);

  // Synchronize precise distance ref if trip currentDistance is adjusted from outside/manually (e.g., manual corrections)
  useEffect(() => {
    if (Math.abs(preciseDistanceRef.current - (safeTrip.currentDistance || 0)) > 0.05) {
      preciseDistanceRef.current = safeTrip.currentDistance || 0;
    }
  }, [safeTrip.currentDistance]);

  // Ref for position updater to avoid closure capture issues
  const handlePositionUpdateRef = useRef<(lng: number, lat: number, accuracy: number, speed: number | null) => void>(() => {});

  const handlePositionUpdate = (lng: number, lat: number, accuracy: number, speed: number | null = null) => {
    // 1. Filter out extreme cell tower leaps (> 80m)
    if (accuracy > 80) {
      console.log(`⚠️ [GPS Tracker] Coarse position filtered out due to accuracy: ${accuracy}m`);
      return;
    }

    const now = Date.now();

    if (!lastCoordsRef.current) {
      // Set initial anchor point
      lastCoordsRef.current = { lng, lat, timestamp: now };
      console.log('⚡ [GPS Tracker] Initialized reference GPS anchor position:', lastCoordsRef.current);
      try {
        localStorage.setItem(`active_trip_gps_${tripRef.current.id}`, JSON.stringify({
          lastCoords: lastCoordsRef.current,
          preciseDistance: preciseDistanceRef.current
        }));
      } catch (e) {}
      return;
    }

    const dt = (now - lastCoordsRef.current.timestamp) / 1000; // seconds elapsed
    if (dt <= 0) return;

    // Calculate physical displacement distance from last valid anchor point
    const distanceInMeters = getDistance(
      lastCoordsRef.current.lng,
      lastCoordsRef.current.lat,
      lng,
      lat
    );

    const calculatedSpeed = distanceInMeters / dt; // m/s

    // 2. Stationary / Parking check: update anchor timestamp & position when stationary or crawling (< 8m movement over short time)
    // to keep anchor point fresh without accumulating fake stationary drift
    if (distanceInMeters < 8 && (speed !== null && speed < 0.5)) {
      lastCoordsRef.current = { lng, lat, timestamp: now };
      return;
    }

    // 3. Anomalous Teleport / High Speed Jump Guard (Allow up to 180 km/h = 50 m/s)
    if (calculatedSpeed > 50) {
      console.warn(`⚠️ [GPS Tracker] Anomalous GPS teleport filtered out (Speed: ${(calculatedSpeed * 3.6).toFixed(1)} km/h, Dist: ${distanceInMeters.toFixed(0)}m)`);
      lastCoordsRef.current = { lng, lat, timestamp: now }; // Reset anchor without adding bogus mileage
      return;
    }

    // 4. Accumulate real vehicular movement distance in kilometers continuously (works across multiple stops and destinations A -> B)
    const addedKm = distanceInMeters / 1000;
    preciseDistanceRef.current += addedKm;

    // Keep exact to 0.01 km
    const nextDist = Math.max(0, Number(preciseDistanceRef.current.toFixed(2)));

    console.log(`⚡ [GPS Tracker] Real vehicular movement detected! Cumulative distance: ${nextDist} km (+${distanceInMeters.toFixed(1)}m, dt: ${dt.toFixed(1)}s)`);

    const currentTripValue = tripRef.current;
    if (nextDist !== currentTripValue.currentDistance) {
      // Calculate the new cost in real-time based on updated mileage and waiting duration
      const cost = calculateCost(nextDist, currentTripValue.currentWaitingTime, billingRulesRef.current);
      
      onUpdateTripRef.current({
        ...currentTripValue,
        currentDistance: nextDist,
        calculatedBaseFee: cost.base,
        calculatedTotalFee: cost.total
      });
    }

    // Advance last coordinate anchor
    lastCoordsRef.current = { lng, lat, timestamp: now };

    // Save active GPS state to localStorage for background/lock-screen recovery
    try {
      localStorage.setItem(`active_trip_gps_${currentTripValue.id}`, JSON.stringify({
        lastCoords: lastCoordsRef.current,
        preciseDistance: preciseDistanceRef.current
      }));
    } catch (e) {}
  };

  handlePositionUpdateRef.current = handlePositionUpdate;

  // Continuously sync location updates from driverCoords prop (e.g. from App.tsx background locator)
  useEffect(() => {
    if (driverCoords && typeof driverCoords.lng === 'number' && typeof driverCoords.lat === 'number') {
      handlePositionUpdateRef.current(driverCoords.lng, driverCoords.lat, 15, null);
    }
  }, [driverCoords]);

  // Continuously sync background location updates from localStorage fallback every 3s
  useEffect(() => {
    const checkBgCoords = () => {
      try {
        const bgLatStr = localStorage.getItem('dd_bg_driver_coords_lat');
        const bgLngStr = localStorage.getItem('dd_bg_driver_coords_lng');
        if (bgLatStr && bgLngStr) {
          const bgLat = Number(bgLatStr);
          const bgLng = Number(bgLngStr);
          if (!isNaN(bgLat) && !isNaN(bgLng) && (bgLat !== 0 || bgLng !== 0)) {
            handlePositionUpdateRef.current(bgLng, bgLat, 15, null);
          }
        }
      } catch (_) {}
    };

    const bgInterval = setInterval(checkBgCoords, 3000);
    return () => clearInterval(bgInterval);
  }, []);

  useEffect(() => {
    let watchId: number | null = null;
    let pollInterval: any = null;

    if (typeof window !== 'undefined' && navigator.geolocation) {
      console.log('⚡ [GPS Tracker] Starting active real-time background & lock-screen route path distance calculator...');
      
      const processPosition = (pos: GeolocationPosition) => {
        const rawLng = pos.coords.longitude;
        const rawLat = pos.coords.latitude;
        const accuracy = pos.coords.accuracy || 10;
        const speed = pos.coords.speed;

        const AMap = (window as any).AMap;
        if (AMap) {
          try {
            AMap.convertFrom([rawLng, rawLat], 'gps', (convertStatus: string, convertResult: any) => {
              if (convertStatus === 'complete' && convertResult.locations && convertResult.locations[0]) {
                handlePositionUpdateRef.current(convertResult.locations[0].lng, convertResult.locations[0].lat, accuracy, speed);
              } else {
                handlePositionUpdateRef.current(rawLng, rawLat, accuracy, speed);
              }
            });
          } catch (err) {
            handlePositionUpdateRef.current(rawLng, rawLat, accuracy, speed);
          }
        } else {
          handlePositionUpdateRef.current(rawLng, rawLat, accuracy, speed);
        }
      };

      const handlePosError = (err: any) => {
        console.warn('⚠️ [GPS Tracker] Geolocation positioning error:', err);
      };

      // Primary continuous GPS listener
      watchId = navigator.geolocation.watchPosition(processPosition, handlePosError, {
        enableHighAccuracy: true, // Forces phone's high-precision hardware GPS chip
        timeout: 15000,
        maximumAge: 0
      });

      // Secondary active background polling: Every 4 seconds, explicitly request position
      // Forces phone's GPS chip to stay awake even when app is backgrounded or screen is locked
      pollInterval = setInterval(() => {
        navigator.geolocation.getCurrentPosition(processPosition, handlePosError, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      }, 4000);

      // Instant GPS Sync on App Resume / Screen Unlock
      const handleAppResumeSync = () => {
        console.log('📱 [GPS Tracker] Screen unlocked / App resumed. Syncing GPS distance instantly...');
        navigator.geolocation.getCurrentPosition(processPosition, handlePosError, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      };

      document.addEventListener('visibilitychange', handleAppResumeSync);
      window.addEventListener('pageshow', handleAppResumeSync);
      window.addEventListener('focus', handleAppResumeSync);

      return () => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        if (pollInterval) clearInterval(pollInterval);
        document.removeEventListener('visibilitychange', handleAppResumeSync);
        window.removeEventListener('pageshow', handleAppResumeSync);
        window.removeEventListener('focus', handleAppResumeSync);
      };
    } else {
      console.warn('❌ [GPS Tracker] Geolocation API not supported in this client browser.');
    }
  }, []);

  // Toast notifier helper
  const triggerToast = (text: string) => {
    setToastText(text);
    setShowSystemToast(true);
    setTimeout(() => setShowSystemToast(false), 2400);
  };

  // 4. Formatter helper for HH:MM:SS
  const formatHms = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [
      h.toString().padStart(2, '0'),
      m.toString().padStart(2, '0'),
      s.toString().padStart(2, '0')
    ].join(':');
  };

  // Save updated destination location from popup dialog
  const handleSaveDestination = () => {
    onUpdateTrip({
      ...safeTrip,
      endLocation: tempDest.trim() || '未完成安全目的地设定'
    });
    setShowDestModal(false);
    triggerToast('修改目的地成功！实时计费规则自动匹配。');
  };

  // Navigation click trigger
  const handleSimulateNavigation = (e?: React.MouseEvent | React.TouchEvent) => {
    if (e) e.stopPropagation();
    const dest = safeTrip.endLocation ? safeTrip.endLocation.trim() : '';
    const isDestEmpty = !dest || 
                        dest === '待指定安全目的地' || 
                        dest === '未完成安全目的地设定' || 
                        dest === '请填写目的地（选填）';
    if (isDestEmpty) {
      triggerToast('请输入目的地');
      return;
    }
    setShowNavigationView(true);
  };

  // Handle dial phone action
  const handleMakePhoneCall = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    const phone = safeTrip.passengerPhone ? safeTrip.passengerPhone.trim() : '';
    if (phone && phone !== '' && phone !== '13900000000') {
      window.location.href = `tel:${phone}`;
      triggerToast(`正在拨打乘客电话: ${phone}`);
    } else {
      triggerToast('未输入手机号');
    }
  };

  // 5. Swipe/Drag Actions listener for Touch & Mouse
  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    dragStartRef.current = clientX;
    setIsSliding(true);
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isSliding || !sliderWidthRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const diffX = clientX - dragStartRef.current;
    const rect = sliderWidthRef.current.getBoundingClientRect();
    const maxDrag = rect.width - 52; // Slider handle diameter (52px)
    
    let pos = Math.max(0, Math.min(diffX, maxDrag));
    setSliderPos(pos);

    // If dragged to the end (over 88%), trigger trip ending!
    if (pos >= maxDrag * 0.88) {
      setIsSliding(false);
      setSliderPos(0);
      onEndTrip(safeTrip.calculatedTotalFee || safeTrip.calculatedBaseFee || 59);
    }
  };

  const handleTouchEnd = () => {
    setIsSliding(false);
    setSliderPos(0); // Snap back to start position smoothly
  };

  // Global mousemove/mouseup listener so sliding works for dry mouse on dekstop browsers
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isSliding || !sliderWidthRef.current) return;
      const diffX = e.clientX - dragStartRef.current;
      const rect = sliderWidthRef.current.getBoundingClientRect();
      const maxDrag = rect.width - 52;
      let pos = Math.max(0, Math.min(diffX, maxDrag));
      setSliderPos(pos);
      if (pos >= maxDrag * 0.88) {
        setIsSliding(false);
        setSliderPos(0);
        onEndTrip(safeTrip.calculatedTotalFee || safeTrip.calculatedBaseFee || 59);
      }
    };

    const handleGlobalMouseUp = () => {
      if (isSliding) {
        setIsSliding(false);
        setSliderPos(0);
      }
    };

    if (isSliding) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isSliding, safeTrip.calculatedTotalFee]);

  const stepKm = safeSettings.deviationKm ?? 1.0;
  const stepWaitSec = safeSettings.deviationWaitSec ?? 30;

  // Adjust distance manually (deviation helper to adjust on simulated app preview)
  const handleAdjustDistance = (amount: number) => {
    if (!checkVipActive(safeSettings.vipExpiry)) {
      triggerToast('🔒 提示：纠偏功能为VIP会员专属特权！请先激活VIP。');
      return;
    }
    if (!safeSettings.deviationMitigation) {
      triggerToast('纠偏功能已设定为禁用，请进入设置页开启它');
      return;
    }
    const currentDistVal = typeof safeTrip?.currentDistance === 'number' ? safeTrip.currentDistance : 0;
    const nextDist = Math.max(0, Number((currentDistVal + amount).toFixed(2)));
    const cost = calculateCost(nextDist, safeTrip?.currentWaitingTime || 0, safeBillingRules);
    onUpdateTrip({
      ...safeTrip,
      currentDistance: nextDist,
      calculatedBaseFee: cost.base,
      calculatedTotalFee: cost.total
    });
    // Actual rectification logic executed
  };

  // Adjust waiting time manually (deviation helper to adjust waiting duration in seconds)
  const handleAdjustWaitingTime = (amountSecs: number) => {
    if (!checkVipActive(safeSettings.vipExpiry)) {
      triggerToast('🔒 提示：纠偏功能为VIP会员专属特权！请先激活VIP。');
      return;
    }
    if (!safeSettings.deviationMitigation) {
      triggerToast('纠偏功能已设定为禁用，请进入设置页开启它');
      return;
    }
    const nextSec = Math.max(0, waitingSeconds + amountSecs);
    setWaitingSeconds(nextSec);

    const nextWaitingTime = Math.floor(nextSec / 60);
    const cost = calculateCost(safeTrip?.currentDistance || 0, nextWaitingTime, safeBillingRules);
    onUpdateTrip({
      ...safeTrip,
      currentWaitingTime: nextWaitingTime,
      calculatedBaseFee: cost.base,
      calculatedTotalFee: cost.total
    });
  };

  return (
    <div 
      className="flex-1 flex flex-col justify-between h-full w-full bg-[#f8f9fb] text-[#333] select-none relative overflow-hidden font-sans"
    >
      
      {/* SYSTEM TOAST ALERTS */}
      {showSystemToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[#3d465e] text-white px-4 py-2.5 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 max-w-[280px] text-center justify-center animate-in fade-in zoom-in duration-150">
          <ShieldCheck className="w-4 h-4 text-[#26a69a]" />
          <span>{toastText}</span>
        </div>
      )}

      {/* BEGIN: MainHeader */}
      <header className="bg-[#3d465e] text-white header-safe-pt pb-4 px-4 flex items-center justify-between sticky top-0 z-50 shrink-0">
        <div className="w-10"></div>
        <h1 className="text-base font-semibold tracking-wide">实时计费中</h1>
        <button 
          onClick={() => setShowRulesModal(true)}
          className="text-xs opacity-90 hover:opacity-100 transition-opacity bg-white/10 px-2.5 py-1 rounded-full border border-white/5 active:scale-95" 
          data-purpose="header-link"
        >
          计费规则
        </button>
      </header>
      {/* END: MainHeader */}

      {/* BEGIN: MainContent Scroll Area */}
      <main className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3.5 android-nav-safe-pb">
        
        {/* BEGIN: DestinationCard */}
        <section 
          onClick={() => {
            const currentDest = (!safeTrip.endLocation || safeTrip.endLocation === '待指定安全目的地' || safeTrip.endLocation === '未完成安全目的地设定' || safeTrip.endLocation === '请填写目的地（选填）') ? '' : safeTrip.endLocation;
            setSearchText(currentDest);
            setShowDestinationSearch(true);
          }}
          className="bg-white rounded-xl p-3.5 shadow-xs border border-gray-100 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors" 
          data-purpose="destination-selector"
        >
          <div className="flex items-center space-x-2.5 overflow-hidden">
            <MapPin className="h-4.5 w-4.5 text-[#26a69a] shrink-0" />
            <div className="text-left overflow-hidden">
              <div className="text-gray-400 text-[10px] uppercase font-bold tracking-wider leading-none mb-0.5">目的地</div>
              <span className={`text-sm font-bold truncate block ${(!safeTrip.endLocation || safeTrip.endLocation === '待指定安全目的地' || safeTrip.endLocation === '未完成安全目的地设定' || safeTrip.endLocation === '请填写目的地（选填）') ? 'text-gray-400 font-medium' : 'text-gray-800'}`}>
                {(!safeTrip.endLocation || safeTrip.endLocation === '待指定安全目的地' || safeTrip.endLocation === '未完成安全目的地设定' || safeTrip.endLocation === '请填写目的地（选填）') ? '请填写目的地（选填）' : safeTrip.endLocation}
              </span>
            </div>
          </div>
          <div className="flex items-center text-gray-400 shrink-0 select-none">
            {(!safeTrip.endLocation || safeTrip.endLocation === '待指定安全目的地' || safeTrip.endLocation === '未完成安全目的地设定' || safeTrip.endLocation === '请填写目的地（选填）') ? (
              <span className="text-xs text-slate-400 mr-1 font-medium">点击设置</span>
            ) : null}
            <ChevronRight className="h-4 w-4 text-slate-300" />
          </div>
        </section>
        {/* END: DestinationCard */}

        {/* BEGIN: MainBillingCard */}
        <section 
          className="bg-gradient-to-br from-[#4db6ac] to-[#26a69a] relative rounded-xl p-5 sm:p-6 text-white overflow-hidden shadow-lg shadow-teal-100/40" 
          data-purpose="billing-status-display"
        >
          {/* Large watermark-like Yen symbol */}
          <div className="absolute left-[-15px] bottom-[-25px] text-[180px] font-black text-white/10 leading-none pointer-events-none select-none">
            ¥
          </div>

          {/* Phone Call Button */}
          <button 
            type="button"
            onClick={handleMakePhoneCall}
            className="absolute top-4 left-4 z-30 bg-white rounded-xl shadow-md flex items-center justify-center w-11 h-11 cursor-pointer active:scale-95 transition-transform select-none border border-slate-100 pointer-events-auto" 
            data-purpose="phone-button"
            title="拨打电话"
          >
            <Phone className="h-5 w-5 text-[#26a69a] pointer-events-none" />
          </button>

          {/* Navigation Button */}
          <button 
            type="button"
            onClick={handleSimulateNavigation}
            className="absolute top-4 right-4 z-30 bg-white rounded-xl shadow-md flex items-center justify-center w-11 h-11 cursor-pointer active:scale-95 transition-transform select-none border border-slate-100 pointer-events-auto" 
            data-purpose="nav-button"
            title="开启高德地图导航"
          >
            <Navigation className="h-5 w-5 text-[#26a69a] transform rotate-45 pointer-events-none" />
          </button>

          {/* Price & Duration Info Display */}
          <div className="text-center relative z-10 py-1 sm:py-2">
            <div className="text-5xl font-black tracking-tight mb-1 animate-pulse font-mono">
              {(safeTrip?.calculatedTotalFee ?? safeTrip?.calculatedBaseFee ?? 0).toFixed(2)}
            </div>
            <div className="text-[11px] opacity-90 mb-4 font-medium tracking-wide">
              实时计费(元)
            </div>
            
            <div className="h-[1px] bg-white opacity-20 w-28 mx-auto mb-3"></div>
            
            <div className="flex items-center justify-center space-x-1.5 text-xs text-white/95">
              <span className="opacity-90 font-medium">开车时长:</span>
              <span className="font-bold tracking-widest font-mono text-sm bg-teal-800/20 px-2 py-0.5 rounded-md">
                {formatHms(drivingSeconds)}
              </span>
            </div>
          </div>
        </section>

        {/* BEGIN: SecondaryStatsRow */}
        <div className="grid grid-cols-2 gap-3.5">
          {/* Distance stats col - vertically split in half smoothly with seamless overlay */}
          <div 
            className="bg-white rounded-xl border border-gray-100 shadow-2xs relative overflow-hidden flex min-h-[96px] h-full" 
            data-purpose="stat-distance"
          >
            {/* Left half clickable area: Click to correct +stepKm */}
            <button
              onClick={(e) => { e.stopPropagation(); handleAdjustDistance(stepKm); }}
              className="w-1/2 bg-white hover:bg-emerald-50/10 active:bg-emerald-50/25 cursor-pointer transition-colors flex items-center justify-center p-3 relative focus:outline-hidden focus:ring-0 select-none"
              title={settings.deviationMitigation ? `纠偏里程增加 ${stepKm} 公里` : "点击使用纠偏功能"}
            >
            </button>

            {/* Right half clickable area: Click to correct -stepKm */}
            <button
              onClick={(e) => { e.stopPropagation(); handleAdjustDistance(-stepKm); }}
              className="w-1/2 bg-white hover:bg-rose-50/10 active:bg-rose-50/25 cursor-pointer transition-colors flex items-center justify-center p-3 relative focus:outline-hidden focus:ring-0 select-none"
              title={settings.deviationMitigation ? `纠偏里程减少 ${stepKm} 公里` : "点击使用纠偏功能"}
            >
            </button>

            {/* Centered Overlay Badge: Show current distance value and status label */}
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none select-none z-10 flex flex-col items-center justify-center min-w-[100px] ${!settings.deviationMitigation ? 'opacity-80' : ''}`}>
              <div className="text-2xl font-black text-[#26a69a] font-mono leading-none mb-1">
                {(safeTrip?.currentDistance ?? 0).toFixed(2)}
              </div>
              <div className="text-[10px] text-gray-500 font-bold tracking-wider leading-none whitespace-nowrap uppercase">
                已行程(公里)
              </div>
            </div>
          </div>

          {/* Waiting stats col - vertically split in half smoothly with seamless overlay */}
          <div 
            className="bg-white rounded-xl border border-gray-100 shadow-2xs relative overflow-hidden flex min-h-[96px] h-full" 
            data-purpose="stat-waiting"
          >
            {/* Left half clickable area: Click to increase waiting by stepWaitSec */}
            <button
              onClick={(e) => { e.stopPropagation(); handleAdjustWaitingTime(stepWaitSec); }}
              className="w-1/2 bg-white hover:bg-emerald-50/10 active:bg-emerald-50/25 cursor-pointer transition-colors flex items-center justify-center p-3 relative focus:outline-hidden focus:ring-0 select-none"
              title={settings.deviationMitigation ? `纠偏等候增加 ${stepWaitSec} 秒` : "点击使用纠偏功能"}
            >
            </button>

            {/* Right half clickable area: Click to decrease waiting by stepWaitSec */}
            <button
              onClick={(e) => { e.stopPropagation(); handleAdjustWaitingTime(-stepWaitSec); }}
              className="w-1/2 bg-white hover:bg-rose-50/10 active:bg-rose-50/25 cursor-pointer transition-colors flex items-center justify-center p-3 relative focus:outline-hidden focus:ring-0 select-none"
              title={settings.deviationMitigation ? `纠偏等候减少 ${stepWaitSec} 秒` : "点击使用纠偏功能"}
            >
            </button>

            {/* Centered Overlay Badge: Show current waiting metrics and status labels */}
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none select-none z-10 flex flex-col items-center justify-center min-w-[124px] ${!settings.deviationMitigation ? 'opacity-80' : ''}`}>
              <div className="text-2xl font-black text-[#26a69a] font-mono leading-none text-center">
                {formatHms(waitingSeconds)}
              </div>
            </div>
          </div>
        </div>
        {/* END: SecondaryStatsRow */}

        {/* BEGIN: ActionButtons */}
        <div className="pt-2 space-y-2.5">
          {/* Waiting State Trigger Button */}
          <button 
            onClick={() => {
              const nextWaiting = !isWaiting;
              setIsWaiting(nextWaiting);
            }}
            className={`w-full py-3 font-bold rounded-xl shadow-xs transition-all active:scale-98 flex items-center justify-center gap-2 border text-sm ${
              isWaiting 
                ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100/70' 
                : 'bg-white border-[#26a69a] text-[#26a69a] hover:bg-teal-50/40'
            }`}
            data-purpose="action-wait"
          >
            <Clock className={`w-4 h-4 ${isWaiting ? 'animate-spin' : ''}`} />
            <span>{isWaiting ? '结束等待 恢复驾车' : '开始等待'}</span>
          </button>

          {/* Finish Service Slide Button (Horizontal Gesture Swiper) */}
          <div 
            ref={sliderWidthRef}
            onMouseDown={handleTouchStart}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onMouseMove={isSliding ? handleTouchMove : undefined}
            onTouchEnd={handleTouchEnd}
            onMouseUp={handleTouchEnd}
            className="relative w-full h-[54px] bg-[#26a69a] select-none rounded-xl flex items-center justify-center overflow-hidden active:opacity-95 transition-all cursor-grab active:cursor-grabbing shadow-md shadow-teal-500/10 border border-teal-600/10" 
            data-purpose="action-finish-slider"
          >
            {/* Sliding background fill */}
            <div 
              className="absolute left-0 top-0 bottom-0 bg-teal-800/25 pointer-events-none transition-all duration-75"
              style={{ width: `${sliderPos + 48}px` }}
            ></div>

            {/* Slider active trigger handle */}
            <div 
              className="absolute bg-white text-[#26a69a] rounded-xl flex items-center justify-center shadow-lg transition-transform duration-75 select-none pointer-events-none"
              style={{ 
                transform: `translateX(${sliderPos}px)`,
                left: '3px',
                width: '48px',
                height: '48px'
              }}
            >
              {/* Chevron Icons representing right dragging motion */}
              <svg className="h-5 w-5 text-[#26a69a] animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M13 7l5 5-5 5M6 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3"></path>
              </svg>
            </div>

            {/* Simulated text */}
            <span className="text-white font-bold text-sm tracking-wide select-none pointer-events-none z-10 pl-6">
              {isSliding ? '请一直滑行到右侧结束...' : '右滑 完成服务'}
            </span>
          </div>
        </div>
        {/* END: ActionButtons */}

        {/* BEGIN: FooterNote */}
        <footer className="pt-2 pb-[calc(2.5rem+max(env(safe-area-inset-bottom,0px),var(--android-nav-bar-height,0px),36px))] android-nav-safe-pb">
          <p className="text-center text-slate-400 text-[10px] tracking-wide leading-relaxed">
            请确认行驶路线安全无误，结束工作后根据实际费率跟乘客结算费用
          </p>
        </footer>
        {/* END: FooterNote */}

      </main>
      {/* END: MainContent */}

      {/* BEGIN: Full-screen Destination Selection Overlay */}
      {showDestinationSearch && (
        <div 
          className="absolute inset-0 bg-white z-[70] flex flex-col animate-in slide-in-from-bottom duration-300 pointer-events-auto"
          id="active-destination-search-page"
        >
          {/* Header */}
          <div className="bg-gray-700 border-b border-gray-600 px-4 header-safe-pt pb-4 flex items-center justify-between shrink-0">
            <button 
              onClick={() => setShowDestinationSearch(false)}
              className="text-white hover:text-gray-200 p-1 rounded-full active:scale-95 transition-all cursor-pointer flex items-center gap-1"
            >
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
              </svg>
              <span className="text-sm font-bold text-white">返回</span>
            </button>
            <h3 className="text-lg font-black text-white tracking-tight">修改行程目的地</h3>
            
            {/* "取消目的地" Button: Reset to default state and close */}
            <button 
              onClick={() => {
                onUpdateTrip({
                  ...safeTrip,
                  endLocation: '请填写目的地（选填）'
                });
                setSearchText('');
                setShowDestinationSearch(false);
                triggerToast('已清除目的地');
              }}
              className="text-white bg-rose-600 hover:bg-rose-750 font-bold text-xs active:scale-95 transition-all cursor-pointer px-3.5 py-2 rounded-full border border-rose-500"
            >
              取消目的地
            </button>
          </div>

          {/* Search Input bar */}
          <div className="p-4 bg-gray-50 border-b border-gray-100 shrink-0">
            <div className="relative flex items-center bg-white rounded-2xl border border-gray-200 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100 transition-all p-3 shadow-xs">
              <div className="w-2.5 h-2.5 bg-[#26a69a] rounded-full shrink-0 mr-3"></div>
              <input 
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="搜索终点 / 输入具体地址"
                className="bg-transparent border-none focus:outline-hidden p-0 text-sm font-bold text-gray-800 flex-grow placeholder:text-gray-400 placeholder:font-normal focus:ring-0"
                autoFocus
              />
              {searchText && (
                <button 
                  onClick={() => setSearchText('')}
                  className="p-1 rounded-full hover:bg-gray-150 text-gray-400 hover:text-gray-650"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Content Area - suggestions vs defaults */}
          <div className="flex-grow overflow-y-auto p-4 space-y-4">
            {suggestions.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-2 mb-2">匹配搜索建议</p>
                {suggestions.map((tip, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setSearchText(tip.name);
                    }}
                    className="w-full text-left p-3.5 hover:bg-teal-50/50 rounded-xl flex items-start gap-3 transition-colors border border-transparent hover:border-teal-500/10 cursor-pointer"
                  >
                    <div className="w-5 h-5 bg-teal-50 text-teal-600 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                        <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                      </svg>
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-800 leading-snug">{tip.name}</h4>
                      <p className="text-xs text-gray-400 mt-0.5">{tip.address || tip.district}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                {searchText.trim() ? (
                  <div className="p-3 bg-teal-50/40 rounded-xl border border-teal-500/10 mb-4">
                    <p className="text-xs text-teal-800 leading-relaxed font-semibold">
                      找不到精准建议？
                    </p>
                    <p className="text-xs text-teal-600/70 leading-relaxed mt-0.5">
                      您可直接点击下方【确认修改】使用您手输的终点名称。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-2 mb-2">常用目的地推荐</p>
                      <div className="grid grid-cols-2 gap-2">
                        {SUGGESTED_DESTINATIONS.map((name, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSearchText(name)}
                            className="text-left px-3.5 py-2.5 bg-gray-50 hover:bg-teal-50/35 hover:border-teal-500/20 border border-transparent rounded-xl text-xs font-bold text-gray-700 transition-all cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis mr-1 mb-1"
                          >
                            📍 {name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom Action Footer */}
          <div className="p-4 border-t border-gray-100 bg-white shrink-0">
            <button
              onClick={() => {
                const finalDest = searchText.trim();
                onUpdateTrip({
                  ...safeTrip,
                  endLocation: finalDest || '请填写目的地（选填）'
                });
                setShowDestinationSearch(false);
                triggerToast(finalDest ? '修改目的地成功！实时计费规则自动匹配。' : '已重置目的地为选填');
              }}
              className="w-full py-4 bg-[#26a69a] hover:bg-[#208a80] text-white rounded-2xl font-black text-sm active:scale-[0.98] transition-transform shadow-lg shadow-teal-500/10 cursor-pointer flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3"></path>
              </svg>
              <span>确认修改</span>
            </button>
          </div>
        </div>
      )}

      {/* DETAILED BILLING RULES OVERVIEW MODAL */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl w-full max-w-[320px] p-5 shadow-2xl border border-slate-100 text-left animate-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <span className="text-sm font-black text-slate-800">代驾规则与计费模版</span>
              <button 
                onClick={() => setShowRulesModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-3.5 text-xs text-slate-600 mb-5 max-h-[300px] overflow-y-auto pr-1">
              <div>
                <span className="font-bold text-slate-800 block mb-0.5">模版名称</span>
                <p className="bg-teal-50 text-teal-800 rounded-md py-1 px-2.5 inline-block font-semibold">
                  {safeBillingRules.templateName || '标准默认计费'}
                </p>
              </div>

              <div>
                <span className="font-bold text-slate-800 block mb-0.5">当前时间段计费</span>
                <ul className="space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed text-[11px]">
                  {(safeBillingRules?.slots || DEFAULT_SLOTS).map((slot: any, index: number) => (
                    <li key={index} className="flex justify-between">
                      <span>{slot.startTime}–{slot.endTime}</span>
                      <span className="font-bold text-slate-705">起步 ¥{slot.startingPrice} (含 {slot.includedDistance}km)</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <span className="font-bold text-slate-800 block mb-0.5">公里运价</span>
                {(() => {
                  const firstSlot = (safeBillingRules?.slots && safeBillingRules.slots[0]) || DEFAULT_SLOTS[0];
                  const displayInterval = firstSlot?.distanceInterval || 1;
                  const displayIncrease = firstSlot?.priceIncrease ?? firstSlot?.unitPricePerKm ?? 5;
                  return (
                    <p className="text-slate-500">
                      超出初始里程后，每增加 <span className="font-semibold text-slate-800">{displayInterval}</span> 公里需支付 <span className="font-bold text-teal-600">¥{displayIncrease} 元</span> 收款运价。
                    </p>
                  );
                })()}
              </div>

              <div>
                <span className="font-bold text-slate-800 block mb-0.5">等候计时计费</span>
                <p className="text-slate-500">
                  乘客前 <span className="font-bold text-teal-600">{safeBillingRules.freeWaitingTime ?? 15} 分钟</span> 免费等待。
                  超出后每过 <span className="font-semibold text-slate-800">{safeBillingRules.waitingIntervalMin ?? 1}</span> 分钟加收 <span className="font-bold text-teal-600">¥{safeBillingRules.waitingIncreaseYuan ?? safeBillingRules.waitingChargePerMin ?? 5} 元</span>。
                </p>
              </div>

              <div>
                <span className="font-bold text-slate-800 block mb-0.5">返程收费准则</span>
                {(safeBillingRules.returnFeeStartKm ?? 0) > 0 ? (
                  <p className="text-slate-500">
                    行程里程超过 <span className="font-bold text-slate-800">{safeBillingRules.returnFeeStartKm} 公里</span> 时，超公里部分每增加 <span className="font-bold text-teal-600">{safeBillingRules.returnFeeIntervalKm || 1} 公里</span> 加收 <span className="font-bold text-teal-600">¥{(safeBillingRules.returnFeeIncreaseYuan ?? safeBillingRules.returnFeePerKm ?? 0)} 元</span>。
                  </p>
                ) : (
                  <p className="text-slate-500">无返程加收费用。</p>
                )}
              </div>
            </div>

            <button 
              onClick={() => setShowRulesModal(false)}
              className="w-full py-2.5 bg-[#3d465e] text-white hover:bg-[#343c51] rounded-xl text-xs font-bold transition-all"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      {/* FULLSCREEN GAODE DRIVING NAVIGATION VIEW */}
      {showNavigationView && (
        <NavigationView
          destination={(!safeTrip.endLocation || safeTrip.endLocation === '待指定安全目的地' || safeTrip.endLocation === '未完成安全目的地设定' || safeTrip.endLocation === '请填写目的地（选填）') ? '银川火车站' : safeTrip.endLocation}
          startLocation={safeTrip.startLocation}
          driverCoords={driverCoords || (lastCoordsRef.current ? { lng: lastCoordsRef.current.lng, lat: lastCoordsRef.current.lat } : null)}
          registeredCity={safeSettings.city || '银川市'}
          currentDistance={safeTrip.currentDistance || 0}
          calculatedTotalFee={safeTrip.calculatedTotalFee || safeTrip.calculatedBaseFee || 59}
          onClose={() => setShowNavigationView(false)}
        />
      )}

    </div>
  );
}
