import React, { useState, useRef, useEffect } from 'react';
import { QrCode, Clock, RotateCw, CheckCircle2, Plus, Minus, Phone } from 'lucide-react';
import { BillingRules, TripState, ChauffeurSettings, checkVipActive, DriverStats, DEFAULT_SLOTS } from '../types';
import { db, doc, onSnapshot, deleteDoc, setDoc, getDoc, getBaseApiUrl } from '../lib/dbProxy';
import { speakText } from '../utils/speech';
import PassengerOrderView from './PassengerOrderView';
import ReportTransferOrderModal from './ReportTransferOrderModal';
import QRCode from 'qrcode';

const MULTIPLIER_OPTIONS = Array.from({ length: 11 }, (_, i) => Number((1.0 + i * 0.1).toFixed(1))); // [1.0, 1.1, ..., 2.0]

const SUGGESTED_DESTINATIONS = [
  '银川火车站',
  '建发大阅城',
  '新华百货(鼓楼店)',
  '金凤万达广场',
  '悦海新天地购物广场',
  '银川河东国际机场',
  '阅海湾中央商务区',
];

// Beautiful dynamically generated QR code using pure local offline qrcode library
const SvgQrCode = ({ seed, url }: { seed: number; url?: string }) => {
  const [localQrUrl, setLocalQrUrl] = useState<string>('');

  useEffect(() => {
    if (url) {
      QRCode.toDataURL(url, {
        width: 300,
        margin: 1,
        color: {
          dark: '#0d9488', // Emerald teal
          light: '#ffffff'
        }
      })
      .then(dataUrl => {
        setLocalQrUrl(dataUrl);
      })
      .catch(err => {
        console.error('Error generating QR code locally:', err);
      });
    }
  }, [url, seed]);

  // If we have a real url, use the local generated base64 dataUrl
  if (url) {
    return (
      <div className="w-40 h-40 bg-white p-2 rounded-2xl border border-gray-100 shadow-xs overflow-hidden flex items-center justify-center">
        {localQrUrl ? (
          <img 
            src={localQrUrl} 
            alt="扫码呼车二维码"
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-8 h-8 rounded-full border-2 border-teal-600 border-t-transparent animate-spin" />
        )}
      </div>
    );
  }

  const blocks = [];
  const size = 15; // 15x15 grid
  const randomizer = (x: number, y: number) => {
    // simple deterministic pseudo-random logic based on x, y and seed
    const val = Math.sin(x * 12.9898 + y * 78.233 + seed * 153.1) * 43758.5453;
    return (val - Math.floor(val)) > 0.5;
  };

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const isTopLeft = r < 4 && c < 4;
      const isTopRight = r < 4 && c >= size - 4;
      const isBottomLeft = r >= size - 4 && c < 4;

      if (isTopLeft) {
        const isOuter = r === 0 || r === 3 || c === 0 || c === 3;
        blocks.push({ r, c, fill: isOuter || (r === 1.5 && c === 1.5) });
      } else if (isTopRight) {
        const isOuter = r === 0 || r === 3 || c === size - 1 || c === size - 4;
        blocks.push({ r, c, fill: isOuter });
      } else if (isBottomLeft) {
        const isOuter = r === size - 1 || r === size - 4 || c === 0 || c === 3;
        blocks.push({ r, c, fill: isOuter });
      } else {
        blocks.push({ r, c, fill: randomizer(r, c) });
      }
    }
  }

  return (
    <svg className="w-40 h-40 bg-white p-2.5 rounded-2xl border border-gray-100 shadow-sm" viewBox={`0 0 ${size} ${size}`}>
      {blocks.map((b, i) => b.fill ? (
        <rect 
          key={i} 
          x={b.c} 
          y={b.r} 
          width="1.0" 
          height="1.0" 
          fill="#0d9488" 
          shapeRendering="crispEdges"
        />
      ) : null)}
      <rect x="1" y="1" width="2" height="2" fill="#0d9488" />
      <rect x={size - 3} y="1" width="2" height="2" fill="#0d9488" />
      <rect x="1" y={size - 3} width="2" height="2" fill="#0d9488" />
    </svg>
  );
};

const getPoiLngLat = (poi: any) => {
  if (!poi || !poi.location) return null;
  const loc = poi.location;
  if (typeof loc.getLng === 'function' && typeof loc.getLat === 'function') {
    return { lng: loc.getLng(), lat: loc.getLat() };
  }
  if (typeof loc.lng === 'number' && typeof loc.lat === 'number') {
    return { lng: loc.lng, lat: loc.lat };
  }
  if (typeof loc.lng === 'function' && typeof loc.lat === 'function') {
    return { lng: loc.lng(), lat: loc.lat() };
  }
  if (typeof loc === 'string') {
    const parts = loc.split(',');
    if (parts.length === 2) {
      return { lng: parseFloat(parts[0]), lat: parseFloat(parts[1]) };
    }
  }
  return null;
};

const getDistance = (lng1: number, lat1: number, lng2: number, lat2: number): number => {
  const radLat1 = lat1 * Math.PI / 180.0;
  const radLat2 = lat2 * Math.PI / 180.0;
  const a = radLat1 - radLat2;
  const b = lng1 * Math.PI / 180.0 - lng2 * Math.PI / 180.0;
  const s = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a/2), 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b/2), 2)));
  return s * 6378137; // Earth radius in meters
};

const getPoiDistance = (poi: any, centerLng?: number, centerLat?: number): number => {
  if (centerLng !== undefined && centerLat !== undefined) {
    const loc = getPoiLngLat(poi);
    if (loc) {
      return getDistance(centerLng, centerLat, loc.lng, loc.lat);
    }
  }
  if (poi.distance !== undefined && poi.distance !== null && poi.distance !== '') {
    const dist = Number(poi.distance);
    if (!isNaN(dist)) return dist;
  }
  return 999999;
};

const getHighPrecisionLocationName = (
  regeocode: any, 
  fallbackAddress: string, 
  centerLng?: number, 
  centerLat?: number
): string => {
  if (!regeocode) return fallbackAddress;

  const addressComp = regeocode.addressComponent || {};
  const unacceptableKeywords = ['公厕', '公共厕所', '垃圾站', '垃圾转运', '配电房', '变电站', '充电站', '高压线', '环卫'];
  const minorStoreKeywords = [
    '面馆', '砂锅面', '调和', '牛肉面', '羊肉', '饭店', '餐馆', '小吃', '快餐', '便利店', '超市', 
    '烟酒', '理发', '美发', '药店', '水果', '熟食', '烧烤', '火锅', '菜馆', '鲜花', '修车', 
    '洗车', '麻将', '棋牌', '网吧', '足浴', 'SPA', '客栈', '旅馆', '烤鸭', '奶茶', '大排档'
  ];

  let neighborhoodName = '';
  if (addressComp.neighborhood) {
    neighborhoodName = typeof addressComp.neighborhood === 'string'
      ? addressComp.neighborhood
      : (addressComp.neighborhood.name || '');
  }

  let aoiName = '';
  if (regeocode.aois && regeocode.aois.length > 0 && regeocode.aois[0] && regeocode.aois[0].name) {
    aoiName = regeocode.aois[0].name;
  }

  // Identify the closest road name
  let roadName = '';
  if (regeocode.roads && regeocode.roads.length > 0) {
    if (regeocode.roads[0] && regeocode.roads[0].name) {
      roadName = regeocode.roads[0].name;
    }
  }

  if (!roadName && addressComp.street && typeof addressComp.street === 'string' && addressComp.street.trim()) {
    roadName = addressComp.street.trim();
  }
  if (!roadName && addressComp.streetNumber && addressComp.streetNumber.street && typeof addressComp.streetNumber.street === 'string') {
    roadName = addressComp.streetNumber.street.trim();
  }

  let poiName = '';
  const communityName = neighborhoodName.trim() || aoiName.trim();

  // Sort POIs strictly by physical geometric distance to the GPS/center coordinate
  if (regeocode.pois && regeocode.pois.length > 0) {
    const validPois = regeocode.pois.filter((poi: any) => {
      const name = poi.name || '';
      return !unacceptableKeywords.some(kw => name.includes(kw));
    });
    const targetPois = validPois.length > 0 ? validPois : regeocode.pois;
    const sortedPois = [...targetPois].sort((a, b) => {
      const distA = getPoiDistance(a, centerLng, centerLat);
      const distB = getPoiDistance(b, centerLng, centerLat);

      const isGenericResA = /([0-9]+号楼|[0-9]+栋|[0-9]+单元)/.test(a.name || '');
      const isGenericResB = /([0-9]+号楼|[0-9]+栋|[0-9]+单元)/.test(b.name || '');

      if (!isGenericResA && isGenericResB && distA <= 150) return -1;
      if (isGenericResA && !isGenericResB && distA <= 150) return 1;

      return distA - distB;
    });

    const topPoiName = sortedPois[0] ? sortedPois[0].name || '' : '';
    const isMinorStore = minorStoreKeywords.some(kw => topPoiName.includes(kw));

    if (isMinorStore && communityName) {
      poiName = communityName;
    } else if (topPoiName) {
      poiName = topPoiName;
    } else if (communityName) {
      poiName = communityName;
    }
  } else if (communityName) {
    poiName = communityName;
  } else {
    let buildingName = '';
    if (addressComp.building) {
      buildingName = typeof addressComp.building === 'string'
        ? addressComp.building
        : (addressComp.building.name || '');
    }
    if (buildingName && buildingName.trim()) {
      poiName = buildingName;
    } else {
      const formattedAddress = regeocode.formattedAddress || fallbackAddress;
      let cleanLabel = formattedAddress;
      if (addressComp.province) cleanLabel = cleanLabel.replace(addressComp.province, '');
      if (addressComp.city) cleanLabel = cleanLabel.replace(addressComp.city, '');
      if (addressComp.district) cleanLabel = cleanLabel.replace(addressComp.district, '');
      poiName = cleanLabel.trim() ? cleanLabel : formattedAddress;
    }
  }

  let finalRes = poiName.trim() || communityName || (roadName ? roadName.trim() : '') || fallbackAddress;
  if (finalRes && (finalRes.includes('马斯特') || finalRes.includes('马斯特府邸'))) {
    finalRes = communityName && !communityName.includes('马斯特') ? communityName : '运祥小区';
  }
  return finalRes;
};

const PI = 3.1415926535897932384626;
const a_axis = 6378245.0; // Semi-major axis
const ee_factor = 0.00669342162296594323; // Flattening factor

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

function outOfChina(lng: number, lat: number): boolean {
  if (lng < 72.004 || lng > 137.8347) return true;
  if (lat < 0.8293 || lat > 55.8271) return true;
  return false;
}

function wgs84ToGcj02(lng: number, lat: number): { lng: number; lat: number } {
  if (outOfChina(lng, lat)) {
    return { lng, lat };
  }
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee_factor * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a_axis * (1 - ee_factor)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (a_axis / sqrtMagic * Math.cos(radLat) * PI);
  const mgLat = lat + dLat;
  const mgLng = lng + dLng;
  return { lng: mgLng, lat: mgLat };
}

const getRobustLocation = (
  AMap: any,
  onSuccess: (gcjLng: number, gcjLat: number, isHighAccuracy: boolean, addressName?: string) => void,
  onFailure: (err: any) => void
) => {
  if (!AMap) {
    onFailure(new Error('AMap is not loaded'));
    return;
  }

  let hasLowAccuracy = false;
  let hasHighAccuracy = false;

  const handleSuccess = (gcjLng: number, gcjLat: number, isHighAcc: boolean, addressName?: string) => {
    if (hasHighAccuracy) {
      // High accuracy already achieved, ignore any incoming results
      return;
    }
    if (isHighAcc) {
      hasHighAccuracy = true;
      clearTimeout(watchdog);
      onSuccess(gcjLng, gcjLat, true, addressName);
    } else {
      if (!hasLowAccuracy) {
        hasLowAccuracy = true;
        onSuccess(gcjLng, gcjLat, false, addressName);
      }
    }
  };

  const safeOnFailure = (err: any) => {
    // If we already achieved some sort of location, don't trigger general failure
    if (hasLowAccuracy || hasHighAccuracy) return;
    clearTimeout(watchdog);
    onFailure(err);
  };

  // Watchdog timer: If everything else fails or takes too long, fall back to city search
  const watchdog = setTimeout(() => {
    if (!hasLowAccuracy && !hasHighAccuracy) {
      console.warn('⚡ [GPS Watchdog] Positioning took too long (>6s) or got stuck, triggering IP/City fallback!');
      fallbackToCitySearch();
    }
  }, 6000); // 6s watchdog to cover cellular base stations/GPS warm-up

  // 1. Fast Coarse/Cached positioning (Base station simulation)
  if (typeof window !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const rawLng = pos.coords.longitude;
        const rawLat = pos.coords.latitude;
        const converted = wgs84ToGcj02(rawLng, rawLat);
        console.log('⚡ [Fast Network Geolocation] Resolved:', converted.lng, converted.lat);
        handleSuccess(converted.lng, converted.lat, false);
      },
      (err) => {
        console.warn('⚡ [Fast Network Geolocation] Failed:', err);
      },
      { enableHighAccuracy: false, timeout: 1200, maximumAge: 300000 } // use cache up to 5 mins for instant return
    );

    // 2. High accuracy browser GPS/Simulation positioning
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const rawLng = pos.coords.longitude;
        const rawLat = pos.coords.latitude;
        const converted = wgs84ToGcj02(rawLng, rawLat);
        console.log('⚡ [Precise GPS Geolocation] Resolved:', converted.lng, converted.lat);
        handleSuccess(converted.lng, converted.lat, true);
      },
      (err) => {
        console.warn('⚡ [Precise GPS Geolocation] Failed:', err);
      },
      { enableHighAccuracy: true, timeout: 3500, maximumAge: 0 } // fresh GPS reading
    );
  }

  // 3. Gaode Map Geolocation plugin
  AMap.plugin('AMap.Geolocation', () => {
    try {
      const geolocation = new AMap.Geolocation({
        enableHighAccuracy: true,
        timeout: 4000,
        zoomToAccuracy: false,
        noIpLocate: 0,
        noGeoLocation: 0,
        maximumAge: 0,
        convert: true
      });

      geolocation.getCurrentPosition((status: string, result: any) => {
        if (status === 'complete' && result.position) {
          console.log('⚡ [AMap Geolocation] Resolved:', result.position.lng, result.position.lat);
          const isHighAcc = result.location_type === 'gps' || result.location_type === 'html5';
          handleSuccess(result.position.lng, result.position.lat, isHighAcc, result.formattedAddress);
        } else {
          console.warn('⚡ [AMap Geolocation] Failed:', status, result);
          fallbackToCitySearch();
        }
      });
    } catch (e) {
      console.warn('⚡ [AMap Geolocation] Exception:', e);
      fallbackToCitySearch();
    }
  });

  const fallbackToCitySearch = () => {
    if (hasLowAccuracy || hasHighAccuracy) return;
    AMap.plugin('AMap.CitySearch', () => {
      try {
        const citySearch = new AMap.CitySearch();
        citySearch.getLocalCity((cityStatus: string, cityResult: any) => {
          if (cityStatus === 'complete' && cityResult.bounds) {
            const bounds = cityResult.bounds;
            const finalLng = (bounds.southWest.lng + bounds.northEast.lng) / 2;
            const finalLat = (bounds.southWest.lat + bounds.northEast.lat) / 2;
            console.log('⚡ [City Search Fallback] Resolved:', finalLng, finalLat);
            handleSuccess(finalLng, finalLat, false, cityResult.city ? `${cityResult.city}中心` : undefined);
          } else {
            safeOnFailure(new Error('All geolocation and IP fallbacks failed'));
          }
        });
      } catch (e) {
        safeOnFailure(e);
      }
    });
  };
};

interface CreateOrderViewProps {
  billingRules: BillingRules;
  settings: ChauffeurSettings;
  stats?: DriverStats;
  userPhone: string | null;
  onStartTrip: (trip: TripState) => void;
  onNavigateBack: () => void;
  driverCoords?: { lat: number; lng: number } | null;
  activeOnlineOrder?: any;
  onClearOnlineOrder?: () => void;
}

export default function CreateOrderView({
  billingRules,
  settings,
  stats,
  userPhone,
  onStartTrip,
  onNavigateBack,
  driverCoords,
  activeOnlineOrder,
  onClearOnlineOrder
}: CreateOrderViewProps) {
  const isMerchantValetOrder = Boolean(
    activeOnlineOrder && (
      activeOnlineOrder.isValetOrder ||
      activeOnlineOrder.isPlatformDispatch ||
      activeOnlineOrder.orderRemark === '商户代叫' ||
      activeOnlineOrder.orderType === '商户代叫' ||
      activeOnlineOrder.orderType === '后台指派订单' ||
      activeOnlineOrder.type === '商户代叫' ||
      activeOnlineOrder.type === '后台指派订单'
    )
  );

  const [arrivedAtDeparture, setArrivedAtDeparture] = useState(false);
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);

  const handleConfirmCancelOrder = async () => {
    if (activeOnlineOrder) {
      const candidateIds = Array.from(new Set([
        activeOnlineOrder.id,
        activeOnlineOrder.orderId,
        activeOnlineOrder.rawOrder?.id,
        activeOnlineOrder.rawOrder?.orderId,
        activeOnlineOrder.orderNo,
        activeOnlineOrder.rawOrder?.orderNo,
        activeOnlineOrder.passengerPhone,
        activeOnlineOrder.rawOrder?.passengerPhone
      ].filter(Boolean)));

      if (candidateIds.length > 0) {
        for (const targetId of candidateIds) {
          try {
            if (db) {
              await setDoc(doc(db, 'merchant_orders', targetId as string), {
                in_hall: false,
                status: 'cancelled',
                statusCategory: '已取消',
                cancelledAt: Date.now()
              }, { merge: true });
            }
          } catch (e) {
            console.error("Error cancelling merchant order in Firestore:", e);
          }
        }

        try {
          const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
          let found = false;
          const updated = saved.map((o: any) => {
            const isMatch = candidateIds.some(cid =>
              o.id === cid ||
              o.orderId === cid ||
              o.orderNo === cid ||
              (o.passengerPhone && o.passengerPhone === cid)
            );
            if (isMatch) {
              found = true;
              return {
                ...o,
                in_hall: false,
                status: 'cancelled',
                statusCategory: '已取消',
                cancelledAt: Date.now()
              };
            }
            return o;
          });

          if (!found) {
            updated.push({
              ...activeOnlineOrder,
              id: candidateIds[0] || `ord_${Date.now()}`,
              orderId: candidateIds[0] || `ord_${Date.now()}`,
              in_hall: false,
              status: 'cancelled',
              statusCategory: '已取消',
              cancelledAt: Date.now()
            });
          }

          localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(updated));
          window.dispatchEvent(new CustomEvent('merchant_orders_updated'));
        } catch (_) {}
      }
    }
    setShowCancelConfirmModal(false);
    if (onClearOnlineOrder) onClearOnlineOrder();
    onNavigateBack();
  };

  // Dedicated back button handler for Arrived at Origin page: returns home and ensures order does NOT re-appear in hall
  const handleBackButtonClick = async () => {
    if (isMerchantValetOrder) {
      setShowCancelConfirmModal(true);
      return;
    }
    if (activeOnlineOrder) {
      const orderId = activeOnlineOrder.id || activeOnlineOrder.orderId;
      if (orderId) {
        try {
          if (db) {
            await setDoc(doc(db, 'merchant_orders', orderId), {
              in_hall: false,
              status: 'dispatched',
              statusCategory: '已接单',
              dispatchedDriverPhone: userPhone || activeOnlineOrder.dispatchedDriverPhone || ''
            }, { merge: true });
          }
        } catch (e) {
          console.error("Error updating merchant order state on back:", e);
        }

        try {
          const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
          const updated = saved.map((o: any) => {
            if (o.id === orderId || o.orderId === orderId) {
              return {
                ...o,
                in_hall: false,
                status: 'dispatched',
                statusCategory: '已接单',
                dispatchedDriverPhone: userPhone || o.dispatchedDriverPhone || ''
              };
            }
            return o;
          });
          localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(updated));
          window.dispatchEvent(new CustomEvent('merchant_orders_updated'));
        } catch (_) {}
      }
    }
    onNavigateBack();
  };

  const registeredCity = settings?.city || '';

  // Driver's current location address name
  const getDriverGpsName = () => {
    const cachedName = localStorage.getItem('dd_bg_driver_coords_name');
    if (cachedName && cachedName !== '正在获取当前位置...' && cachedName !== '请授权开启定位权限' && cachedName !== '未定位起点' && !cachedName.includes('铂金大厦') && !cachedName.includes('马斯特')) {
      return cachedName;
    }
    return '正在获取当前位置...';
  };

  // Passenger's pickup / departure address name
  const getPassengerDepartureAddress = () => {
    const addr = activeOnlineOrder?.startLocation || activeOnlineOrder?.originName;
    if (addr && addr.trim() !== '' && addr !== '出发地') {
      return addr.trim();
    }
    return '银川大悦城音乐餐吧';
  };

  const [startLocation, setStartLocation] = useState(() => {
    if (activeOnlineOrder) {
      if (isMerchantValetOrder && !arrivedAtDeparture) {
        return getDriverGpsName();
      }
      return getPassengerDepartureAddress();
    }
    const cachedName = localStorage.getItem('dd_bg_driver_coords_name');
    if (cachedName && cachedName !== '玉皇阁北街铂金大厦' && !cachedName.includes('铂金大厦') && !cachedName.includes('马斯特')) {
      return cachedName;
    }
    return '正在获取当前位置...';
  });

  const [destination, setDestination] = useState(() => {
    if (activeOnlineOrder) {
      if (isMerchantValetOrder && !arrivedAtDeparture) {
        // Stage 1: Destination input is automatically filled with passenger departure address!
        return getPassengerDepartureAddress();
      }
      // Stage 2 or regular order: fill passenger destination if valid
      const passDest = activeOnlineOrder.destination;
      if (passDest && passDest !== activeOnlineOrder.startLocation && !passDest.includes('口头') && !passDest.includes('报单转单')) {
        return passDest;
      }
      return '';
    }
    return '';
  });

  // Synchronize startLocation and destination when activeOnlineOrder or arrivedAtDeparture state changes
  useEffect(() => {
    if (isMerchantValetOrder && activeOnlineOrder) {
      if (!arrivedAtDeparture) {
        // Stage 1: Heading to passenger departure location
        // Departure input (startLocation): Driver's current GPS location
        setStartLocation(getDriverGpsName());
        // Destination input (destination): Passenger's departure address (e.g. "凯宾斯基饭店宴会厅")
        setDestination(getPassengerDepartureAddress());
      } else {
        // Stage 2: Arrived at passenger departure location
        // Departure input (startLocation): Passenger's departure address
        setStartLocation(getPassengerDepartureAddress());
        // Destination input (destination): Passenger's final destination if specified, else empty for verbal negotiation
        const passDest = activeOnlineOrder.destination;
        if (passDest && passDest !== activeOnlineOrder.startLocation && !passDest.includes('口头') && !passDest.includes('报单转单')) {
          setDestination(passDest);
        } else {
          setDestination('');
        }
      }
    }
  }, [isMerchantValetOrder, arrivedAtDeparture, activeOnlineOrder?.id, activeOnlineOrder?.startLocation, activeOnlineOrder?.destination]);
  const [phoneNumber, setPhoneNumber] = useState(() => {
    if (activeOnlineOrder) {
      return activeOnlineOrder.passengerPhone || '';
    }
    return '';
  });

  const startLocationRef = useRef(startLocation);
  const destinationRef = useRef(destination);

  useEffect(() => {
    startLocationRef.current = startLocation;
  }, [startLocation]);

  useEffect(() => {
    destinationRef.current = destination;
  }, [destination]);
  const [isEditingStart, setIsEditingStart] = useState(false);

  const [showDestinationSearch, setShowDestinationSearch] = useState(false);
  const [showReportTransferModal, setShowReportTransferModal] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(null);
    }, 3000);
  };

  const isDefaultYinchuanCoords = (coords: { lat: number; lng: number } | null | undefined) => {
    if (!coords) return true;
    return Math.abs(coords.lat - 38.487193) < 0.0001 && Math.abs(coords.lng - 106.230912) < 0.0001;
  };

  // Check if current driver is an approved team member (只有已通过审批的小队司机才显示)
  const isApprovedSquadMember = (m: any) => {
    if (!m) return false;
    const phone = m.phone || m.id || '';
    if (!phone) return false;
    try {
      const savedRemoved = localStorage.getItem('dd_removed_squad_phones_v2');
      if (savedRemoved) {
        const removed = JSON.parse(savedRemoved);
        if (Array.isArray(removed) && removed.includes(phone)) {
          return false;
        }
      }
    } catch (_) {}

    const role = m.role || m.userRole || '';
    if (role === '商户、商家' || role.includes('商户') || role.includes('商家')) {
      return false; // Merchants are not squad drivers
    }
    const status = m.status || m.approvalStatus || '';
    if (['已拒绝', 'rejected', '拒绝', '待审核'].includes(status)) {
      return false;
    }
    const mgmtRoles = ['开发者司机', '城市老板司机', '城市管理司机', '城市派单员司机', '总指挥官', '开发者', '小队长', '队员', '普通司机'];
    if (mgmtRoles.includes(role)) return true;
    return ['已通过', 'approved', '通过'].includes(status);
  };

  const [isTeamDriver, setIsTeamDriver] = useState<boolean>(() => {
    if (!userPhone) return false;
    if (userPhone === '15509601222') return true;
    try {
      const savedRemoved = localStorage.getItem('dd_removed_squad_phones_v2');
      if (savedRemoved) {
        const removed = JSON.parse(savedRemoved);
        if (Array.isArray(removed) && removed.includes(userPhone)) {
          return false;
        }
      }
    } catch (_) {}

    try {
      const saved = localStorage.getItem('dd_squad_members_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const match = parsed.find((m: any) => m.phone === userPhone || m.id === userPhone || (m.phone && String(m.phone).trim() === userPhone.trim()));
          if (match) return isApprovedSquadMember(match);
        }
      }
    } catch (e) {
      console.error("Error checking local squad members:", e);
    }
    return false;
  });

  useEffect(() => {
    if (!userPhone) {
      setIsTeamDriver(false);
      return;
    }
    if (userPhone === '15509601222') {
      setIsTeamDriver(true);
      return;
    }

    const checkLocal = () => {
      try {
        const saved = localStorage.getItem('dd_squad_members_v2');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const match = parsed.find((m: any) => m.phone === userPhone || m.id === userPhone || (m.phone && String(m.phone).trim() === userPhone.trim()));
            if (match) return isApprovedSquadMember(match);
          }
        }
      } catch (e) {}
      return false;
    };

    setIsTeamDriver(checkLocal());

    if (db) {
      const unsub = onSnapshot(doc(db, 'squad_members', userPhone), (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setIsTeamDriver(isApprovedSquadMember({ ...data, phone: userPhone }));
        } else {
          setIsTeamDriver(checkLocal());
        }
      }, () => {
        setIsTeamDriver(checkLocal());
      });
      return () => unsub();
    }
  }, [userPhone]);

  const [showPermissionPrompt, setShowPermissionPrompt] = useState(() => {
    return !localStorage.getItem('dd_location_permission_prompt_shown');
  });

  // AMap AutoComplete suggestions
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
            city: registeredCity || '银川市',
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
  }, [searchText, registeredCity]);


  // Real Web Gaode (AMap) API Integration
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapInstanceRef = useRef<any>(null);
  const isMapMovingProgrammaticallyRef = useRef<boolean>(false);
  const isUserDraggingRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<any>(null);
  const prefetchedCoordsRef = useRef<{ lng: number; lat: number } | null>(null);
  const prefetchedGeocodedRef = useRef<boolean>(false);
  useEffect(() => {
    if (driverCoords && !isDefaultYinchuanCoords(driverCoords)) {
      prefetchedCoordsRef.current = { lng: driverCoords.lng, lat: driverCoords.lat };
    }
  }, [driverCoords]);

  useEffect(() => {
    // 0. Start high-accuracy native geolocation pre-fetching in parallel immediately on page open
    if (typeof window !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const rawLat = position.coords.latitude;
          const rawLng = position.coords.longitude;
          prefetchedCoordsRef.current = { lng: rawLng, lat: rawLat };
          console.log('⚡ Prefetched native GPS coordinates:', rawLng, rawLat);

          const AMap = (window as any).AMap;
          const map = mapInstanceRef.current;
          // If map and AMap are already fully loaded, immediately update center & reverse-geocode
          if (map && AMap && !prefetchedGeocodedRef.current) {
            prefetchedGeocodedRef.current = true;
            const converted = wgs84ToGcj02(rawLng, rawLat);
            const finalLng = converted.lng;
            const finalLat = converted.lat;
            
            isMapMovingProgrammaticallyRef.current = true;
            map.setCenter([finalLng, finalLat]);
            
            AMap.plugin('AMap.Geocoder', () => {
              const geocoder = new AMap.Geocoder({
                extensions: 'all'
              });
              geocoder.getAddress([finalLng, finalLat], (geoStatus: string, geoResult: any) => {
                isMapMovingProgrammaticallyRef.current = false;
                if (geoStatus === 'complete' && geoResult.regeocode) {
                  const cleanLabel = getHighPrecisionLocationName(geoResult.regeocode, geoResult.regeocode.formattedAddress, finalLng, finalLat);
                  setStartLocation(cleanLabel);
                  localStorage.setItem('dd_bg_driver_coords_lng', String(finalLng));
                  localStorage.setItem('dd_bg_driver_coords_lat', String(finalLat));
                  localStorage.setItem('dd_bg_driver_coords_name', cleanLabel);
                } else {
                  setStartLocation(prev => {
                    if (prev && prev !== '正在获取当前位置...' && prev !== '请授权开启定位权限' && prev !== '未定位起点') {
                      return prev;
                    }
                    return registeredCity ? `${registeredCity}中心` : '未知起点';
                  });
                }
              });
            });
          }
        },
        (err) => {
          console.warn('⚡ Native geolocation pre-fetch skipped or timed out:', err);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0 // force fresh location request
        }
      );
    }

    // 1. Configure the Gaode Security Key
    (window as any)._AMapSecurityConfig = {
      securityJsCode: '0aa3912e6a88fe59f9e5f0275524feba'
    };

    const scriptId = 'amap-js-api-v2';

    const initializeMap = () => {
      const AMap = (window as any).AMap;
      if (!AMap || !mapContainerRef.current) return;

      try {
        const cachedLat = localStorage.getItem('dd_bg_driver_coords_lat');
        const cachedLng = localStorage.getItem('dd_bg_driver_coords_lng');
        const hasCached = cachedLat && cachedLng;

        // Fixed scale level 18: high-precision street & building block view as shown in user screenshot (图片gd)
        const initialZoom = 18;

        const initialCenter = driverCoords && !isDefaultYinchuanCoords(driverCoords)
          ? [driverCoords.lng, driverCoords.lat]
          : (hasCached ? [Number(cachedLng), Number(cachedLat)] : (prefetchedCoordsRef.current ? (() => {
              const converted = wgs84ToGcj02(prefetchedCoordsRef.current.lng, prefetchedCoordsRef.current.lat);
              return [converted.lng, converted.lat];
            })() : [106.2350, 38.4830]));

        // Initialize AMap strictly in 2D mode, with disabled manual rotatability/pitching
        const map = new AMap.Map(mapContainerRef.current, {
          zoom: initialZoom,
          center: initialCenter, // Centered directly on driver's actual position
          viewMode: '2D',
          pitch: 0,
          rotateEnable: false,
          pitchEnable: false,
          resizeEnable: true
        });

        mapInstanceRef.current = map;
        setMapLoaded(true);

        AMap.plugin(['AMap.Geocoder', 'AMap.Geolocation', 'AMap.Driving'], () => {
          const geocoder = new AMap.Geocoder({
            extensions: 'all'
          });

          const reverseGeocodeCenter = (lng: number, lat: number) => {
            isMapMovingProgrammaticallyRef.current = true;
            if (typeof map.setZoomAndCenter === 'function') {
              map.setZoomAndCenter(18, [lng, lat]);
            } else {
              map.setZoom(18);
              map.setCenter([lng, lat]);
            }
            geocoder.getAddress([lng, lat], (geoStatus: string, geoResult: any) => {
              isMapMovingProgrammaticallyRef.current = false;
              if (geoStatus === 'complete' && geoResult.regeocode) {
                const cleanLabel = getHighPrecisionLocationName(geoResult.regeocode, geoResult.regeocode.formattedAddress, lng, lat);
                setStartLocation(cleanLabel);
                localStorage.setItem('dd_bg_driver_coords_lng', String(lng));
                localStorage.setItem('dd_bg_driver_coords_lat', String(lat));
                localStorage.setItem('dd_bg_driver_coords_name', cleanLabel);
              } else {
                setStartLocation(prev => {
                  if (prev && prev !== '正在获取当前位置...' && prev !== '请授权开启定位权限' && prev !== '未定位起点') {
                    return prev;
                  }
                  return registeredCity ? `${registeredCity}中心` : '未知起点';
                });
              }
            });
          };

          const fallbackGeolocation = () => {
            if (isMerchantValetOrder) {
              return;
            }
            isMapMovingProgrammaticallyRef.current = true;
            
            // If the current text is generic/unlocated, let's default to a friendly city location
            const isGeneric = startLocation === '正在获取当前位置...' || startLocation === '未定位起点' || !startLocation;
            const queryAddr = isGeneric 
              ? (registeredCity ? `${registeredCity}万达广场` : '银川市人民政府') 
              : startLocation;
            
            setStartLocation(queryAddr);
            geocoder.getLocation(queryAddr, (locStatus: string, locResult: any) => {
              isMapMovingProgrammaticallyRef.current = false;
              if (locStatus === 'complete' && locResult && locResult.geocodes && locResult.geocodes.length) {
                const loc = locResult.geocodes[0].location;
                map.setCenter([loc.lng, loc.lat]);
                reverseGeocodeCenter(loc.lng, loc.lat);
              } else {
                // IP fallback for virtual sandbox environments
                AMap.plugin('AMap.CitySearch', () => {
                  try {
                    const citySearch = new AMap.CitySearch();
                    citySearch.getLocalCity((cityStatus: string, cityResult: any) => {
                      if (cityStatus === 'complete' && cityResult.bounds) {
                        map.setBounds(cityResult.bounds);
                        // Center of the bounds
                        const bounds = cityResult.bounds;
                        const cLng = (bounds.southWest.lng + bounds.northEast.lng) / 2;
                        const cLat = (bounds.southWest.lat + bounds.northEast.lat) / 2;
                        reverseGeocodeCenter(cLng, cLat);
                      } else {
                        setStartLocation(prev => {
                          if (prev && prev !== '正在获取当前位置...' && prev !== '请授权开启定位权限' && prev !== '未定位起点') {
                            return prev;
                          }
                          return registeredCity ? `${registeredCity}中心` : '未知起点';
                        });
                      }
                    });
                  } catch (e) {
                    console.warn('CitySearch failed:', e);
                    setStartLocation(prev => {
                      if (prev && prev !== '正在获取当前位置...' && prev !== '请授权开启定位权限' && prev !== '未定位起点') {
                        return prev;
                      }
                      return registeredCity ? `${registeredCity}中心` : '未知起点';
                    });
                  }
                });
              }
            });
          };

          // Try using our fast pre-fetched native coordinates first
          const tryUsePrefetched = () => {
            if (prefetchedCoordsRef.current && !prefetchedGeocodedRef.current && !isDefaultYinchuanCoords({ lat: prefetchedCoordsRef.current.lat, lng: prefetchedCoordsRef.current.lng })) {
              prefetchedGeocodedRef.current = true;
              const { lng, lat } = prefetchedCoordsRef.current;
              console.log('⚡ Speeding up using pre-fetched native GPS coordinates:', lng, lat);
              
              const converted = wgs84ToGcj02(lng, lat);
              reverseGeocodeCenter(converted.lng, converted.lat);
              return true;
            }
            return false;
          };

          // If we have driverCoords or cached background coordinates, use them immediately!
          if (driverCoords && !isDefaultYinchuanCoords(driverCoords)) {
            reverseGeocodeCenter(driverCoords.lng, driverCoords.lat);
          } else if (hasCached) {
            reverseGeocodeCenter(Number(cachedLng), Number(cachedLat));
          } else {
            const isFirstTime = !localStorage.getItem('dd_location_permission_prompt_shown');
            if (isFirstTime) {
              console.log('Skipping automatic geolocation on load because permission prompt is active');
              setStartLocation('请授权开启定位权限');
              return;
            }

            if (tryUsePrefetched()) {
              return;
            }

            setStartLocation('正在获取当前位置...');
            isMapMovingProgrammaticallyRef.current = true;
            getRobustLocation(
              AMap,
              (finalLng, finalLat) => {
                console.log('⚡ [GPS] Successfully got coordinates on load:', finalLng, finalLat);
                reverseGeocodeCenter(finalLng, finalLat);
              },
              (err) => {
                console.warn('⚡ [GPS] Robust GPS on load failed, using fallback:', err);
                isMapMovingProgrammaticallyRef.current = false;
                if (!tryUsePrefetched()) {
                  fallbackGeolocation();
                }
              }
            );
          }

          const updateAddressFromMapCenter = () => {
            // LOCK DEPARTURE ADDRESS IF DESTINATION IS SET OR IF IT'S A MERCHANT VALET ORDER:
            if (isMerchantValetOrder) {
              return;
            }
            if (destinationRef.current && destinationRef.current.trim() !== '') {
              return;
            }

            const center = map.getCenter();
            const lng = center.getLng ? center.getLng() : center.lng;
            const lat = center.getLat ? center.getLat() : center.lat;
            geocoder.getAddress(center, (geocodestatus: string, geocoderesult: any) => {
              if (destinationRef.current && destinationRef.current.trim() !== '') {
                return;
              }
              if (geocodestatus === 'complete' && geocoderesult.regeocode) {
                const cleanLabel = getHighPrecisionLocationName(geocoderesult.regeocode, geocoderesult.regeocode.formattedAddress, lng, lat);
                setStartLocation(cleanLabel);
              } else {
                setStartLocation(prev => {
                  if (prev && prev !== '正在获取当前位置...' && prev !== '请授权开启定位权限' && prev !== '未定位起点') {
                    return prev;
                  }
                  return registeredCity ? `${registeredCity}中心` : '未知起点';
                });
              }
            });
          };

          // Listen ONLY to user manual map drag events (not zoom in/out) to update departure location
          let isUserDraggingMap = false;

          map.on('dragstart', () => {
            if (isMapMovingProgrammaticallyRef.current) return;
            isUserDraggingMap = true;
          });

          map.on('dragging', () => {
            if (!isUserDraggingMap || isMapMovingProgrammaticallyRef.current) return;
            if (debounceTimerRef.current) {
              clearTimeout(debounceTimerRef.current);
            }
            debounceTimerRef.current = setTimeout(() => {
              updateAddressFromMapCenter();
            }, 150);
          });

          map.on('dragend', () => {
            if (!isUserDraggingMap || isMapMovingProgrammaticallyRef.current) return;
            if (debounceTimerRef.current) {
              clearTimeout(debounceTimerRef.current);
            }
            updateAddressFromMapCenter();
            isUserDraggingMap = false;
          });

          // Ensure zoom start / change / end events NEVER trigger address updates and clear pending timers
          const cancelDragOnZoom = () => {
            isUserDraggingMap = false;
            if (debounceTimerRef.current) {
              clearTimeout(debounceTimerRef.current);
            }
          };

          map.on('zoomstart', cancelDragOnZoom);
          map.on('zoomchange', cancelDragOnZoom);
          map.on('zoomend', cancelDragOnZoom);
        });
      } catch (err) {
        console.error('Failed to initialize Gaode AMap:', err);
      }
    };

    let script = document.getElementById(scriptId) as HTMLScriptElement || document.querySelector('script[src*="webapi.amap.com"]');

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://webapi.amap.com/maps?v=2.0&key=4143e567d55bbc1855231f9637efd6b0';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        initializeMap();
      };
      document.head.appendChild(script);
    } else {
      if ((window as any).AMap) {
        initializeMap();
      } else {
        script.addEventListener('load', initializeMap);
      }
    }

    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.destroy();
        } catch (_) {}
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Synchronize map center ONLY when the user finishes manual editing
  const prevIsEditingStartRef = useRef(isEditingStart);
  useEffect(() => {
    const AMap = (window as any).AMap;
    const map = mapInstanceRef.current;
    
    // Detect transition from true (editing) to false (finished editing)
    const finishedEditing = prevIsEditingStartRef.current === true && isEditingStart === false;
    prevIsEditingStartRef.current = isEditingStart;

    if (finishedEditing && AMap && map && startLocation) {
      AMap.plugin('AMap.Geocoder', () => {
        const geocoder = new AMap.Geocoder({
          extensions: 'all'
        });
        geocoder.getLocation(startLocation, (status: string, result: any) => {
          if (status === 'complete' && result && result.geocodes && result.geocodes.length) {
            const loc = result.geocodes[0].location;
            const currentCenter = map.getCenter();
            const dist = Math.sqrt(Math.pow(currentCenter.lng - loc.lng, 2) + Math.pow(currentCenter.lat - loc.lat, 2));
            if (dist > 0.0008) { // update center if offset exists to make it snug
              map.setCenter([loc.lng, loc.lat]);
            }
          }
        });
      });
    }
  }, [isEditingStart, startLocation, registeredCity]);

  const handleAcceptPermission = () => {
    localStorage.setItem('dd_location_permission_prompt_shown', 'true');
    setShowPermissionPrompt(false);
    // Let state commit, then run the locate function immediately
    setTimeout(() => {
      handleRecenterAndLocate();
    }, 150);
  };

  const handleDenyPermission = () => {
    setShowPermissionPrompt(false);
    setStartLocation(registeredCity ? `${registeredCity}中心` : '未获得定位授权');
  };

  const handleRecenterAndLocate = () => {
    const AMap = (window as any).AMap;
    const map = mapInstanceRef.current;
    if (!AMap || !map) return;

    setStartLocation('正在获取当前位置...');

    const runReverseGeocoding = (finalLng: number, finalLat: number) => {
      isMapMovingProgrammaticallyRef.current = true;
      if (typeof map.setZoomAndCenter === 'function') {
        map.setZoomAndCenter(18, [finalLng, finalLat]);
      } else {
        map.setZoom(18);
        map.setCenter([finalLng, finalLat]);
      }
      
      AMap.plugin('AMap.Geocoder', () => {
        const geocoder = new AMap.Geocoder({
          extensions: 'all'
        });
        geocoder.getAddress([finalLng, finalLat], (geoStatus: string, geoResult: any) => {
          isMapMovingProgrammaticallyRef.current = false;
          if (geoStatus === 'complete' && geoResult.regeocode) {
            const highPrecisionName = getHighPrecisionLocationName(geoResult.regeocode, geoResult.regeocode.formattedAddress, finalLng, finalLat);
            setStartLocation(highPrecisionName);
          } else {
            setStartLocation(prev => {
              if (prev && prev !== '正在获取当前位置...' && prev !== '请授权开启定位权限' && prev !== '未定位起点') {
                return prev;
              }
              return registeredCity ? `${registeredCity}中心` : '未知起点';
            });
          }
        });
      });
    };

    getRobustLocation(
      AMap,
      (finalLng, finalLat) => {
        runReverseGeocoding(finalLng, finalLat);
      },
      (err) => {
        console.warn('⚡ [GPS] Robust GPS locating failed, using fallbacks:', err);
        if (driverCoords && !isDefaultYinchuanCoords(driverCoords)) {
          runReverseGeocoding(driverCoords.lng, driverCoords.lat);
        } else {
          // Fall back to city search bounds center as a clean backup city-center coordinate
          AMap.plugin('AMap.CitySearch', () => {
            try {
              const citySearch = new AMap.CitySearch();
              citySearch.getLocalCity((cityStatus: string, cityResult: any) => {
                if (cityStatus === 'complete' && cityResult.bounds) {
                  const bounds = cityResult.bounds;
                  const cLng = (bounds.southWest.lng + bounds.northEast.lng) / 2;
                  const cLat = (bounds.southWest.lat + bounds.northEast.lat) / 2;
                  runReverseGeocoding(cLng, cLat);
                } else {
                  setStartLocation(prev => {
                    if (prev && prev !== '正在获取当前位置...' && prev !== '请授权开启定位权限' && prev !== '未定位起点') {
                      return prev;
                    }
                    return registeredCity ? `${registeredCity}中心` : '未知起点';
                  });
                }
              });
            } catch (e) {
              setStartLocation(prev => {
                if (prev && prev !== '正在获取当前位置...' && prev !== '请授权开启定位权限' && prev !== '未定位起点') {
                  return prev;
                }
                return registeredCity ? `${registeredCity}中心` : '未知起点';
              });
            }
          });
        }
      }
    );
  };

  // AMap Driving/Riding Route planning for distance calculation and map display
  const [routeDistance, setRouteDistance] = useState<number | null>(null);
  const drivingInstanceRef = useRef<any>(null);
  const ridingInstanceRef = useRef<any>(null);
  const lastPlannedRouteKeyRef = useRef<string>('');

  // Reset route planning key on mount or state change to ensure route is re-planned every time page opens
  useEffect(() => {
    lastPlannedRouteKeyRef.current = '';
  }, [activeOnlineOrder?.id, arrivedAtDeparture]);

  useEffect(() => {
    const AMap = (window as any).AMap;
    const map = mapInstanceRef.current;
    if (!AMap || !map || !mapLoaded) return;

    // 1. Merchant Valet Order Riding Navigation: Driver location (startLocation) -> Passenger Pickup Location (getPassengerDepartureAddress)
    if (isMerchantValetOrder && !arrivedAtDeparture) {
      const pickupLoc = activeOnlineOrder?.startLocation || activeOnlineOrder?.originName || getPassengerDepartureAddress();
      if (!pickupLoc.trim()) return;

      const currentRouteKey = `riding|${startLocation.trim()}|${pickupLoc.trim()}|${activeOnlineOrder?.id || ''}`;
      if (lastPlannedRouteKeyRef.current === currentRouteKey) {
        return;
      }

      const delayDebounce = setTimeout(() => {
        AMap.plugin(['AMap.Riding', 'AMap.Driving'], () => {
          try {
            if (drivingInstanceRef.current) {
              try { drivingInstanceRef.current.clear(); } catch (_) {}
            }
            if (!ridingInstanceRef.current) {
              ridingInstanceRef.current = new AMap.Riding({
                map: map,
                hideMarkers: false,
                autoFitView: true,
                city: registeredCity || '银川市'
              });
            } else {
              try { ridingInstanceRef.current.clear(); } catch (_) {}
            }

            isMapMovingProgrammaticallyRef.current = true;

            // Geocode origin (startLocation) and destination (passenger departure address) for robust Riding route planning
            AMap.plugin(['AMap.Riding', 'AMap.PlaceSearch', 'AMap.Geocoder', 'AMap.Driving'], () => {
              const resolveOrigin = (cb: (originParam: any) => void) => {
                if (driverCoords && typeof driverCoords.lng === 'number' && typeof driverCoords.lat === 'number' && !isDefaultYinchuanCoords(driverCoords)) {
                  cb(new AMap.LngLat(driverCoords.lng, driverCoords.lat));
                  return;
                }
                if (prefetchedCoordsRef.current && !isDefaultYinchuanCoords(prefetchedCoordsRef.current)) {
                  cb(new AMap.LngLat(prefetchedCoordsRef.current.lng, prefetchedCoordsRef.current.lat));
                  return;
                }
                const driverKeyword = (startLocation && startLocation !== '我的当前位置' && startLocation !== '正在获取当前位置...')
                  ? startLocation
                  : (registeredCity ? `${registeredCity}中心` : '银川市兴庆区');

                const placeSearch = new AMap.PlaceSearch({ city: registeredCity || '银川市', pageSize: 1 });
                placeSearch.search(driverKeyword, (status: string, result: any) => {
                  if (status === 'complete' && result.poiList && result.poiList.pois && result.poiList.pois.length > 0) {
                    const loc = result.poiList.pois[0].location;
                    cb(new AMap.LngLat(loc.lng, loc.lat));
                  } else {
                    const geocoder = new AMap.Geocoder({ city: registeredCity || '银川市' });
                    geocoder.getLocation(driverKeyword, (gStatus: string, gResult: any) => {
                      if (gStatus === 'complete' && gResult.geocodes && gResult.geocodes[0]) {
                        const loc = gResult.geocodes[0].location;
                        cb(new AMap.LngLat(loc.lng, loc.lat));
                      } else {
                        cb({ keyword: driverKeyword, city: registeredCity || '银川市' });
                      }
                    });
                  }
                });
              };

              const resolveDest = (cb: (destParam: any) => void) => {
                const orderCoords = activeOnlineOrder?.startCoords || activeOnlineOrder?.originCoords || activeOnlineOrder?.startLocationCoords;
                if (orderCoords && typeof orderCoords.lng === 'number' && typeof orderCoords.lat === 'number' && !isDefaultYinchuanCoords(orderCoords)) {
                  cb(new AMap.LngLat(orderCoords.lng, orderCoords.lat));
                  return;
                }

                const destKeyword = pickupLoc.trim();
                const placeSearch = new AMap.PlaceSearch({ city: registeredCity || '银川市', pageSize: 1 });
                placeSearch.search(destKeyword, (status: string, result: any) => {
                  if (status === 'complete' && result.poiList && result.poiList.pois && result.poiList.pois.length > 0) {
                    const loc = result.poiList.pois[0].location;
                    cb(new AMap.LngLat(loc.lng, loc.lat));
                  } else {
                    const geocoder = new AMap.Geocoder({ city: registeredCity || '银川市' });
                    geocoder.getLocation(destKeyword, (gStatus: string, gResult: any) => {
                      if (gStatus === 'complete' && gResult.geocodes && gResult.geocodes[0]) {
                        const loc = gResult.geocodes[0].location;
                        cb(new AMap.LngLat(loc.lng, loc.lat));
                      } else {
                        cb({ keyword: destKeyword, city: registeredCity || '银川市' });
                      }
                    });
                  }
                });
              };

              resolveOrigin((originLngLat) => {
                resolveDest((destLngLat) => {
                  if (drivingInstanceRef.current) {
                    try { drivingInstanceRef.current.clear(); } catch (_) {}
                  }
                  if (!ridingInstanceRef.current) {
                    ridingInstanceRef.current = new AMap.Riding({
                      map: map,
                      hideMarkers: false,
                      autoFitView: true,
                      city: registeredCity || '银川市'
                    });
                  } else {
                    try { ridingInstanceRef.current.clear(); } catch (_) {}
                  }

                  ridingInstanceRef.current.search(
                    originLngLat,
                    destLngLat,
                    (status: string, result: any) => {
                      setTimeout(() => {
                        isMapMovingProgrammaticallyRef.current = false;
                      }, 1200);

                      if (status === 'complete' && result.routes && result.routes[0]) {
                        lastPlannedRouteKeyRef.current = currentRouteKey;
                        const distanceMeters = result.routes[0].distance;
                        const distanceKm = Number((distanceMeters / 1000).toFixed(2));
                        setRouteDistance(distanceKm);
                      } else {
                        console.warn('AMap.Riding search status:', status, result);
                        // Fallback to Driving route line if riding path unavailable
                        if (!drivingInstanceRef.current) {
                          drivingInstanceRef.current = new AMap.Driving({
                            map: map,
                            hideMarkers: false,
                            autoFitView: true,
                            city: registeredCity || '银川市'
                          });
                        }
                        drivingInstanceRef.current.search(originLngLat, destLngLat, (st3: string, res3: any) => {
                          if (st3 === 'complete' && res3.routes && res3.routes[0]) {
                            lastPlannedRouteKeyRef.current = currentRouteKey;
                            setRouteDistance(Number((res3.routes[0].distance / 1000).toFixed(2)));
                          } else {
                            setRouteDistance(null);
                          }
                        });
                      }
                    }
                  );
                });
              });
            });
          } catch (e) {
            console.warn('Initializing or using AMap.Riding failed:', e);
          }
        });
      }, 150);

      return () => clearTimeout(delayDebounce);
    }

    // 2. Standard Driving Route for normal orders OR after arriving at departure
    if (!startLocation || !destination || !destination.trim()) {
      if (drivingInstanceRef.current) {
        try { drivingInstanceRef.current.clear(); } catch (_) {}
      }
      if (ridingInstanceRef.current) {
        try { ridingInstanceRef.current.clear(); } catch (_) {}
      }
      setRouteDistance(null);
      lastPlannedRouteKeyRef.current = '';
      return;
    }

    const currentRouteKey = `driving|${startLocation.trim()}|${destination.trim()}|${activeOnlineOrder?.id || ''}`;
    if (lastPlannedRouteKeyRef.current === currentRouteKey) {
      return;
    }

    const delayDebounce = setTimeout(() => {
      AMap.plugin(['AMap.Driving', 'AMap.PlaceSearch', 'AMap.Geocoder'], () => {
        try {
          if (ridingInstanceRef.current) {
            try { ridingInstanceRef.current.clear(); } catch (_) {}
          }
          if (!drivingInstanceRef.current) {
            drivingInstanceRef.current = new AMap.Driving({
              map: map,
              hideMarkers: false,
              autoFitView: true,
              city: registeredCity || '银川市'
            });
          } else {
            try { drivingInstanceRef.current.clear(); } catch (_) {}
          }

          isMapMovingProgrammaticallyRef.current = true;

          const resolvePlace = (kw: string, cb: (res: any) => void) => {
            const placeSearch = new AMap.PlaceSearch({ city: registeredCity || '银川市', pageSize: 1 });
            placeSearch.search(kw, (status: string, result: any) => {
              if (status === 'complete' && result.poiList && result.poiList.pois && result.poiList.pois.length > 0) {
                const loc = result.poiList.pois[0].location;
                cb(new AMap.LngLat(loc.lng, loc.lat));
              } else {
                const geocoder = new AMap.Geocoder({ city: registeredCity || '银川市' });
                geocoder.getLocation(kw, (gStatus: string, gResult: any) => {
                  if (gStatus === 'complete' && gResult.geocodes && gResult.geocodes[0]) {
                    const loc = gResult.geocodes[0].location;
                    cb(new AMap.LngLat(loc.lng, loc.lat));
                  } else {
                    cb({ keyword: kw, city: registeredCity || '银川市' });
                  }
                });
              }
            });
          };

          resolvePlace(startLocation.trim(), (origParam) => {
            resolvePlace(destination.trim(), (destParam) => {
              drivingInstanceRef.current.search(
                origParam,
                destParam,
                (status: string, result: any) => {
                  setTimeout(() => {
                    isMapMovingProgrammaticallyRef.current = false;
                  }, 1500);

                  if (status === 'complete' && result.routes && result.routes[0]) {
                    lastPlannedRouteKeyRef.current = currentRouteKey;
                    const distanceMeters = result.routes[0].distance;
                    const distanceKm = Number((distanceMeters / 1000).toFixed(2));
                    setRouteDistance(distanceKm);
                  } else {
                    console.warn('AMap.Driving status:', status, result);
                    setRouteDistance(null);
                  }
                }
              );
            });
          });
        } catch (e) {
          console.warn('Initializing or using AMap.Driving failed:', e);
        }
      });
    }, 150);

    return () => clearTimeout(delayDebounce);
  }, [startLocation, destination, mapLoaded, registeredCity, activeOnlineOrder, driverCoords, isMerchantValetOrder, arrivedAtDeparture]);

  // Clean up driving and riding instances on unmount
  useEffect(() => {
    return () => {
      if (drivingInstanceRef.current) {
        try { drivingInstanceRef.current.clear(); } catch (_) {}
        drivingInstanceRef.current = null;
      }
      if (ridingInstanceRef.current) {
        try { ridingInstanceRef.current.clear(); } catch (_) {}
        ridingInstanceRef.current = null;
      }
    };
  }, []);

  // QR Code creation modal states
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCountdown, setQrCountdown] = useState(180); // 3 minutes = 180s
  const [qrUpdateCount, setQrUpdateCount] = useState(1);
  const [qrTimestamp, setQrTimestamp] = useState<number>(() => Date.now());
  const [scanSuccessMsg, setScanSuccessMsg] = useState(false);
  const [scanBannerDismissed, setScanBannerDismissed] = useState(false);
  const [showSimulatedScanner, setShowSimulatedScanner] = useState(false);

  // Countdown timer effect
  useEffect(() => {
    if (!showQrModal) return;
    
    setQrTimestamp(Date.now());
    setQrCountdown(180);
    const interval = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          setQrUpdateCount(c => c + 1);
          setQrTimestamp(Date.now());
          return 180;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showQrModal]);

  // Real-time synchronization for passenger self-service QR code scans
  useEffect(() => {
    const driverPhoneNum = (userPhone || '18609518888').replace(/\s+/g, '').trim();

    const docRef = doc(db, 'passenger_links', driverPhoneNum);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // Check if the submission occurred within the last 5 minutes to avoid stale entries
        if (data && data.status === 'submitted' && data.timestamp > Date.now() - 300000) {
          const isValet = data.isValetOrder || data.isPlatformDispatch || data.orderRemark === '商户代叫';

          if (data.passengerPhone) setPhoneNumber(data.passengerPhone);

          if (!isValet) {
            if (data.destination) setDestination(data.destination);
            if (data.startLocation) setStartLocation(data.startLocation);
            setScanSuccessMsg(true);

            // Audio vocal broadcast announcement
            if (settings?.voiceBroadcast === '开单语音播报') {
              speakText('乘客已授权，扫码开单成功！');
            }
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try { navigator.vibrate([100, 50, 100]); } catch(e){}
            }
          }

          setShowQrModal(false);

          // Clear the processed link to prevent infinite populating loops
          deleteDoc(docRef).catch(err => console.error('Error clearing passenger link document:', err));
        }
      }
    });

    return () => unsubscribe();
  }, [userPhone]);

  // Synchronous Firestore persist for passenger scan access so they get the driver's latest active location
  useEffect(() => {
    const driverPhoneNum = (userPhone || '18609518888').replace(/\s+/g, '').trim();
    const docRef = doc(db, 'passenger_links', driverPhoneNum);
    
    getDoc(docRef).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        if (d && (d.status === 'submitted' || d.passengerPhone)) {
          return; // Preserve submitted passenger order data completely
        }
      }
      setDoc(docRef, {
        driverPhone: driverPhoneNum,
        driverStartLocation: startLocation,
        updatedAt: Date.now()
      }, { merge: true }).catch(err => console.error('Error persisting driver start location in passenger_links:', err));
    }).catch(() => {});
  }, [startLocation, userPhone]);


  const passengerScanUrl = (() => {
    const currentTs = qrTimestamp || Date.now();
    if (typeof window === 'undefined') {
      return `https://lyheiwandaijiamax.com/passenger_order.html?driver=${encodeURIComponent(userPhone || '18609518888')}&name=${encodeURIComponent(settings?.customAppName?.trim() || 'XX代驾')}&startLocation=${encodeURIComponent(startLocation || '')}&t=${currentTs}`;
    }
    const hostname = window.location.hostname;
    const origin = window.location.origin;
    
    // Only force production domain fallback for non-accessible private local hosts.
    // Public container/cloud preview environments (like Cloud Run or AI Studio) are globally accessible by phones, 
    // so they should generate native preview scan URLs for accurate live testing.
    const isPrivateLocal = (
      hostname.includes('localhost') || 
      hostname.includes('127.0.0.1')
    );
    
    const customWorkerApiUrl = localStorage.getItem('baota_api_url') || localStorage.getItem('cloudflare_worker_api_url') || '';
    let baseOrigin = "https://lyheiwandaijiamax.com";
    const basePath = '/passenger_order.html';
    
    return `${baseOrigin}${basePath}?driver=${encodeURIComponent(userPhone || '18609518888')}&name=${encodeURIComponent(settings?.customAppName?.trim() || 'XX代驾')}&startLocation=${encodeURIComponent(startLocation || '')}&t=${currentTs}`;
  })();

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Weather multiplier states
  const [weatherMultiplier, setWeatherMultiplier] = useState(1.0);
  const [showMultiplierPicker, setShowMultiplierPicker] = useState(false);
  const [tempMultiplier, setTempMultiplier] = useState(1.0);
  const multiplierScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (showMultiplierPicker) {
      const timer = setTimeout(() => {
        if (multiplierScrollRef.current) {
          const idx = MULTIPLIER_OPTIONS.indexOf(tempMultiplier);
          if (idx !== -1) {
            multiplierScrollRef.current.scrollTop = idx * 40;
          }
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [showMultiplierPicker]);

  const handleMultiplierScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const index = Math.round(container.scrollTop / 40);
    if (index >= 0 && index < MULTIPLIER_OPTIONS.length) {
      const selected = MULTIPLIER_OPTIONS[index];
      if (tempMultiplier !== selected) {
        setTempMultiplier(selected);
      }
    }
  };

  // Find active time slot for the current time
  const getActiveTimeSlot = () => {
    const slots = (billingRules && Array.isArray(billingRules.slots) && billingRules.slots.length > 0) ? billingRules.slots : DEFAULT_SLOTS;
    const nowObj = new Date();
    const activeHour = nowObj.getHours();
    let activeSlot = slots[0] || DEFAULT_SLOTS[0];
    
    for (const slot of slots) {
      if (!slot || !slot.startTime || !slot.endTime) continue;
      const [startH] = slot.startTime.split(':').map(Number);
      const [endH] = slot.endTime.split(':').map(Number);
      
      if (startH > endH) { // overnight slot
        if (activeHour >= startH || activeHour <= endH) {
          activeSlot = slot;
          break;
        }
      } else {
        if (activeHour >= startH && activeHour <= endH) {
          activeSlot = slot;
          break;
        }
      }
    }
    return activeSlot;
  };

  const activeSlot = getActiveTimeSlot();
  const baseStartingPrice = activeSlot.startingPrice ?? 40;
  
  // Calculate estimation fee: show starting price as minimum even if destination is empty
  const isEstimated = destination.trim().length > 0;
  
  // Calculate distance cost and return fee if we have a routeDistance
  let estimatedPriceSubtotal = baseStartingPrice;
  const freeKm = activeSlot.includedDistance ?? 7;
  const interval = activeSlot.distanceInterval || 1;
  const increase = activeSlot.priceIncrease ?? activeSlot.unitPricePerKm ?? 5;

  if (routeDistance !== null) {
    let distanceCost = 0;
    if (routeDistance > freeKm) {
      distanceCost = Math.ceil((routeDistance - freeKm) / interval) * increase;
    }
    
    let returnFee = 0;
    if (billingRules.returnFeeStartKm > 0 && routeDistance > billingRules.returnFeeStartKm) {
      const rInterval = billingRules.returnFeeIntervalKm || 1;
      const rIncrease = billingRules.returnFeeIncreaseYuan ?? billingRules.returnFeePerKm ?? 0;
      returnFee = Math.ceil((routeDistance - billingRules.returnFeeStartKm) / rInterval) * rIncrease;
    }
    
    estimatedPriceSubtotal = baseStartingPrice + distanceCost + returnFee;
  }

  const estimatedPrice = Number((estimatedPriceSubtotal * weatherMultiplier).toFixed(2));

  const handleCreateOrder = () => {
    if (settings && settings.isBanned) {
      alert("⚠️ 无法接单！因账户违规，您的账号已被管理员封停。封停期间无法接取任何线上/线下订单，请联系后台解封！");
      return;
    }

    try {
      // Generate new robust trip state with fallback guards
      const userEnteredDest = (destination || '').trim();
      const targetDestination = userEnteredDest || '请填写目的地（选填）';
      const targetPhone = (phoneNumber || '').trim();
      const startingFeeApplied = Number(((baseStartingPrice || 59) * (weatherMultiplier || 1.0)).toFixed(2));
      
      if (registeredCity && startLocation && typeof startLocation === 'string' && !startLocation.includes(registeredCity)) {
        console.warn(`出发地（当前输入：${startLocation}）不在线上认证的听单开通城市（${registeredCity}）范围内。但因属于线下自助报单，已放行创建订单。`);
      }
      
      if (activeOnlineOrder) {
        const isValet = Boolean(activeOnlineOrder.isValetOrder || activeOnlineOrder.isPlatformDispatch || activeOnlineOrder.orderRemark === '商户代叫' || activeOnlineOrder.orderType === '商户代叫');
        const isReportTransfer = Boolean(
          activeOnlineOrder.orderType === '报单转单' ||
          activeOnlineOrder.orderRemark === '报单转单' ||
          activeOnlineOrder.type === '报单转单' ||
          activeOnlineOrder.isReportTransferOrder ||
          activeOnlineOrder.isReportTransfer
        );
        const orderIdVal = activeOnlineOrder.orderId || activeOnlineOrder.id || activeOnlineOrder.orderNo || ('DD' + Date.now().toString().slice(-8));
        
        const newTrip: TripState = {
          id: 'OL' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 9000 + 1000),
          orderNumber: orderIdVal,
          orderId: orderIdVal,
          passengerName: isReportTransfer ? '报单转单乘客' : (isValet ? '商户代叫乘客' : '线上自助预约乘客'),
          passengerPhone: targetPhone || activeOnlineOrder.passengerPhone || '',
          startLocation: activeOnlineOrder.startLocation || activeOnlineOrder.originName || startLocation || '银川市',
          endLocation: userEnteredDest || activeOnlineOrder.destination || activeOnlineOrder.endLocation || targetDestination,
          startTimestamp: Date.now(),
          currentDistance: 0.0,
          currentWaitingTime: 0,
          currentStatus: 'serving',
          extraBridgeFee: 0,
          extraParkingFee: 0,
          extraOtherFee: 0,
          calculatedBaseFee: startingFeeApplied,
          calculatedTotalFee: startingFeeApplied,
          weatherMultiplier: weatherMultiplier || 1.0,
          isOnlineOrder: true,
          orderType: isReportTransfer ? '报单转单' : (isValet ? '商户代叫' : '二维码开单'),
          orderRemark: isReportTransfer ? '报单转单' : (activeOnlineOrder.orderRemark || (isValet ? '商户代叫' : '')),
          dispatchedByPhone: activeOnlineOrder.dispatchedByPhone || activeOnlineOrder.adminPhone || activeOnlineOrder.dispatchedBy || activeOnlineOrder.merchantPhone || '',
          adminPhone: activeOnlineOrder.adminPhone || activeOnlineOrder.dispatchedByPhone || '',
          dispatchedBy: activeOnlineOrder.dispatchedBy || activeOnlineOrder.dispatchedByPhone || '',
          dispatcherPhone: activeOnlineOrder.dispatchedByPhone || activeOnlineOrder.adminPhone || activeOnlineOrder.dispatchedBy || '',
          paymentQrCode: activeOnlineOrder.paymentQrCode || activeOnlineOrder.merchantPaymentQrCode || '',
          merchantPaymentQrCode: activeOnlineOrder.paymentQrCode || activeOnlineOrder.merchantPaymentQrCode || '',
          merchantPhone: activeOnlineOrder.merchantPhone || activeOnlineOrder.dispatchedByPhone || '',
          dispatchedByName: activeOnlineOrder.dispatchedByName || activeOnlineOrder.adminName || '',
          adminName: activeOnlineOrder.adminName || activeOnlineOrder.dispatchedByName || '',
          isValetOrder: isValet,
          isPlatformDispatch: activeOnlineOrder.isPlatformDispatch
        };

        onStartTrip(newTrip);
        if (onClearOnlineOrder) onClearOnlineOrder();

        const cleanPhone = (userPhone || '').replace(/\s+/g, '').trim();
        if (cleanPhone) {
          if (db) {
            deleteDoc(doc(db, 'passenger_links', cleanPhone)).catch(() => {});
          }
          try {
            const baseUrl = getBaseApiUrl();
            fetch(`${baseUrl}/api/db/delete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ collection: 'passenger_links', docId: cleanPhone })
            }).catch(() => {});
          } catch (_) {}
        }
        return;
      }

      const newTrip: TripState = {
        id: 'Z' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 9000 + 1000),
        orderNumber: 'DD' + Date.now().toString().slice(-8),
        passengerName: '线下自助代驾客户',
        passengerPhone: targetPhone,
        startLocation: startLocation || '银川市',
        endLocation: targetDestination,
        startTimestamp: Date.now(),
        currentDistance: 0.0,
        currentWaitingTime: 0,
        currentStatus: 'serving',
        extraBridgeFee: 0,
        extraParkingFee: 0,
        extraOtherFee: 0,
        calculatedBaseFee: startingFeeApplied,
        calculatedTotalFee: startingFeeApplied,
        weatherMultiplier: weatherMultiplier || 1.0,
        orderType: scanSuccessMsg ? '二维码开单' : '报单'
      };

      onStartTrip(newTrip);
    } catch (err) {
      console.error("Error creating trip inside handleCreateOrder:", err);
      const fallbackTrip: TripState = {
        id: 'OL' + Date.now().toString().slice(-6),
        orderNumber: 'DD' + Date.now().toString().slice(-8),
        passengerName: '商户代叫乘客',
        passengerPhone: '',
        startLocation: startLocation || '银川市',
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
      onStartTrip(fallbackTrip);
      if (onClearOnlineOrder) onClearOnlineOrder();
    }
  };

  return (
    <div className="relative flex-grow flex flex-col justify-between w-full h-full select-none overflow-hidden text-gray-900 bg-gray-100 font-sans">
      
      {/* Toast Overlay Banner */}
      {toastMsg && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[99999] bg-gray-900/90 text-white px-5 py-2.5 rounded-full text-xs font-medium shadow-2xl backdrop-blur-md animate-fade-in flex items-center gap-2 border border-white/10 pointer-events-none">
          <span>{toastMsg}</span>
        </div>
      )}
      
      {/* Location Permission Prompt Dialog */}
      {showPermissionPrompt && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-xs p-6 shadow-2xl flex flex-col items-center text-center space-y-4 animate-in zoom-in-95 duration-200">
            {/* Pulsing MapPin Icon */}
            <div className="relative flex items-center justify-center mt-2">
              <div className="absolute w-14 h-14 bg-teal-100 rounded-full animate-ping opacity-50" />
              <div className="relative w-12 h-12 bg-teal-500 rounded-full flex items-center justify-center shadow-md">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                  <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                </svg>
              </div>
            </div>

            {/* Content */}
            <div className="space-y-1.5">
              <h3 className="text-sm font-black text-gray-900 tracking-tight">授权地理位置服务</h3>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                为了能够自动获取您当前的位置、精准推荐出发地并开启代驾计费服务，「黑湾代驾」申请获取您的手机定位权限。
              </p>
            </div>

            {/* Buttons */}
            <div className="w-full flex flex-col space-y-1.5 pt-1">
              <button
                onClick={handleAcceptPermission}
                className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 active:scale-98 text-white text-[11px] font-bold rounded-xl shadow-xs transition-all cursor-pointer"
              >
                允许并开启定位
              </button>
              <button
                onClick={handleDenyPermission}
                className="w-full py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-400 text-[11px] font-bold rounded-xl transition-all cursor-pointer"
              >
                暂不授权
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* BEGIN: MapBackground (Real Dynamic Gaode AMap Integration) */}
      <div className="absolute inset-0 z-0 bg-[#e4eae4] overflow-hidden">
        {/* Real Gaode map target container */}
        <div ref={mapContainerRef} className="w-full h-full z-0" />
        
        {/* Dynamic loading overlays/fallbacks before map initialization resolves */}
        {!mapLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 z-10 space-y-3">
            <div className="w-8 h-8 rounded-full border-3 border-teal-600 border-t-transparent animate-spin" />
            <span className="text-xs text-teal-800 font-medium font-sans">高德地图初始化中...</span>
          </div>
        )}

        {/* Elegant overlay to match styling */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-white/20 pointer-events-none z-5" />
      </div>
      {/* END: MapBackground */}

      {/* BEGIN: NavigationHeader (Floating top panel bar) */}
      <header className="relative p-4 header-safe-pt flex justify-between items-start z-10 pointer-events-none">
        <button 
          onClick={handleBackButtonClick}
          className="bg-white rounded-full p-2.5 shadow-lg active:scale-90 transition-transform pointer-events-auto" 
          data-purpose="back-button"
        >
          <svg className="h-6 w-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
          </svg>
        </button>
        {activeOnlineOrder ? (
          isMerchantValetOrder ? (
            <div className="bg-teal-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-1.5 border border-teal-500/10 pointer-events-auto animate-pulse">
              <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
              <span className="text-xs font-black">
                {!arrivedAtDeparture ? "接单骑行：前往乘客出发地" : "已到达出发地：点击下方创建订单"}
              </span>
            </div>
          ) : null
        ) : (
          <div 
            onClick={() => {
              if (!checkVipActive(settings?.vipExpiry)) {
                alert('🔒 提示：二维码创单属于VIP专属高级特权功能。您当前非VIP会员或会员已到期，请先在设置中激活VIP会员。');
                return;
              }
              setShowQrModal(true);
            }}
            className="bg-white px-4 py-2 rounded-full shadow-lg flex items-center gap-1.5 cursor-pointer active:scale-95 transition-transform border border-teal-500/10 hover:bg-teal-50/50 pointer-events-auto" 
            data-purpose="qr-order-trigger"
          >
            <QrCode className="w-3.5 h-3.5 text-[#189F95]" />
            <span className="text-xs font-bold text-gray-700">二维码创单</span>
          </div>
        )}
      </header>
      {/* END: NavigationHeader */}

      {/* BEGIN: MapMarkerSection */}
      <main className="flex-grow relative z-10 flex flex-col justify-between pointer-events-none">
        
        {/* Center Map Marker (Pulsing blue circle representing user's current/pushed location) */}
        {!activeOnlineOrder && !routeDistance && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-10 pb-5" data-purpose="pickup-location-marker">
            {/* Speech bubble showing current high-precision location address name (read-only, non-clickable) */}
            <div className="bg-white/95 backdrop-blur-xs px-3.5 py-1.5 rounded-lg shadow-xl border border-blue-100 mb-2.5 whitespace-nowrap flex items-center gap-1.5 animate-bounce pointer-events-none transition-all duration-200">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
              <span className="text-xs font-black text-gray-800 select-none">
                {startLocation}
              </span>
            </div>
            
            {/* Pulsing blue circle component */}
            <div className="relative flex items-center justify-center">
              {/* Outer soft pulsing ring */}
              <div className="absolute w-12 h-12 bg-blue-500/25 rounded-full animate-ping pointer-events-none"></div>
              {/* Middle glowing shadow ring */}
              <div className="absolute w-8 h-8 bg-blue-500/40 rounded-full blur-xs pointer-events-none"></div>
              {/* Inner crisp solid blue circle with white border */}
              <div className="relative w-5 h-5 bg-blue-600 rounded-full border-2 border-white shadow-lg flex items-center justify-center">
                <div className="w-2.5 h-2.5 bg-white rounded-full"></div>
              </div>
            </div>
          </div>
        )}

        {/* Spacer for filling up remaining section */}
        <div className="flex-grow"></div>

        {/* Map Action Buttons (Floating above the bottom sheet) */}
        <div className="w-full px-4 mb-4 flex justify-between items-end gap-2 pointer-events-none" data-purpose="map-tools">
          <div className="flex flex-col gap-2 items-start pointer-events-auto">
            <button 
              onClick={() => alert(`当前代驾规则模板：${billingRules.templateName}`)}
              className="bg-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-md flex items-center gap-1 active:scale-95 transition-transform text-gray-800"
            >
              <span>{billingRules.templateName}</span>
            </button>
            <button 
              id="weather-multiplier-trigger-button"
              type="button"
              onClick={() => {
                setTempMultiplier(weatherMultiplier);
                setShowMultiplierPicker(true);
              }}
              className="bg-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-md flex items-center gap-1 active:scale-95 transition-transform text-gray-800"
            >
              <span>恶劣天气 {weatherMultiplier.toFixed(1)}倍</span>
              <svg className="h-3 w-3 text-[#4dbfb3]" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
              </svg>
            </button>
            {isTeamDriver && (
              <button 
                id="report-transfer-order-trigger-button"
                type="button"
                onClick={() => setShowReportTransferModal(true)}
                className="bg-[#189F95] hover:bg-[#158C83] text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-md shadow-[#189F95]/20 flex items-center gap-1 active:scale-95 transition-transform cursor-pointer border border-[#189F95]"
              >
                <span>报单转单（赚取代叫费用）</span>
              </button>
            )}
          </div>
          <div className="flex flex-col items-center gap-2 pointer-events-auto">
            {/* Zoom Controls Panel stacked vertically above the re-center button */}
            <div className="flex flex-col bg-white rounded-xl shadow-md overflow-hidden border border-gray-100 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) {
                    isMapMovingProgrammaticallyRef.current = true;
                    map.zoomIn();
                    setTimeout(() => {
                      isMapMovingProgrammaticallyRef.current = false;
                    }, 300);
                  }
                }}
                className="p-2.5 hover:bg-gray-50 active:bg-gray-100 transition-colors border-b border-gray-150 flex items-center justify-center"
                title="放大"
              >
                <Plus className="w-5 h-5 text-gray-700" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) {
                    isMapMovingProgrammaticallyRef.current = true;
                    map.zoomOut();
                    setTimeout(() => {
                      isMapMovingProgrammaticallyRef.current = false;
                    }, 300);
                  }
                }}
                className="p-2.5 hover:bg-gray-50 active:bg-gray-100 transition-colors flex items-center justify-center"
                title="缩小"
              >
                <Minus className="w-5 h-5 text-gray-700" />
              </button>
            </div>

            {/* Re-center / Geolocation Button */}
            <button 
              onClick={handleRecenterAndLocate}
              className="bg-white p-2.5 rounded-xl shadow-md active:scale-95 transition-transform shrink-0" 
              data-purpose="re-center"
            >
              <svg className="h-5 w-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
              </svg>
            </button>
          </div>
        </div>
      </main>
      {/* END: MapMarkerSection */}

      {/* BEGIN: OrderDetailsCard */}
      <div className="bg-white rounded-t-3xl shadow-2xl z-20 px-4 sm:px-6 pt-3 sm:pt-3.5 pb-[calc(1.25rem+max(env(safe-area-inset-bottom,0px),var(--android-nav-bar-height,0px),28px))] shrink-0 border-t border-gray-100 max-w-full overflow-hidden android-nav-safe-pb" data-purpose="order-form-container">
        {((scanSuccessMsg || (activeOnlineOrder && !isMerchantValetOrder)) && !scanBannerDismissed) && (
          <div className="mb-2.5 bg-[#e8f8f2] border border-[#07c160]/30 rounded-2xl p-2.5 sm:p-3 flex items-center justify-between gap-2 animate-in slide-in-from-top-3 duration-200 shadow-xs max-w-full overflow-hidden">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1 overflow-hidden">
              <div className="w-6 h-6 rounded-full bg-[#07c160] flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-white stroke-[2.5]" />
              </div>
              <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
                <span className="text-sm font-black text-[#1a1c1c] leading-snug truncate">
                  扫码成功并安全连线!
                </span>
                <span className="text-xs text-[#059669] font-medium leading-tight mt-0.5 truncate">
                  已接收乘客下单地址，点击下方「创建订单」即开启行驶计费
                </span>
              </div>
            </div>
            <button 
              type="button"
              onClick={() => {
                setScanBannerDismissed(true);
                setScanSuccessMsg(false);
              }}
              className="text-gray-700 hover:text-black text-xs font-bold px-2.5 sm:px-3 py-1.5 bg-white rounded-xl border border-gray-200/80 shadow-xs shrink-0 active:scale-95 transition-transform cursor-pointer whitespace-nowrap"
            >
              知道了
            </button>
          </div>
        )}
        
        {/* Pickup and Destination Inputs */}
        <div className="space-y-2 max-w-full overflow-hidden">
          
          {/* Pickup Point Row */}
          <div className="flex items-center gap-2 sm:gap-3 py-1 border-b border-gray-100 max-w-full overflow-hidden">
            <div className="w-2.5 h-2.5 bg-cyan-500 rounded-full shrink-0"></div>
            <div className="flex-grow flex items-center justify-between min-w-0 overflow-hidden">
              <span className="text-gray-400 text-xs shrink-0 whitespace-nowrap">出发地</span>
              <div className="flex items-center text-cyan-700 font-bold ml-2 text-sm min-w-0 overflow-hidden select-text">
                <span className="truncate">{startLocation}</span>
                <svg className="h-4 w-4 ml-1 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                </svg>
              </div>
            </div>
          </div>

          {/* Destination Input Row */}
          <div 
            onClick={() => {
              if (isMerchantValetOrder && !arrivedAtDeparture) {
                setSearchText(getPassengerDepartureAddress());
                setShowDestinationSearch(true);
              } else {
                setSearchText(destination);
                setShowDestinationSearch(true);
              }
            }}
            className="flex items-center gap-2 sm:gap-3 bg-gray-50 hover:bg-white rounded-2xl px-3.5 sm:px-4 py-1.5 border border-transparent hover:border-teal-500/20 active:scale-[0.99] transition-all cursor-pointer select-none max-w-full overflow-hidden"
            id="destination-trigger"
          >
            <div className="w-2.5 h-2.5 bg-rose-500 rounded-full shrink-0"></div>
            <div className="flex-grow flex items-center justify-between min-w-0 overflow-hidden">
              {isMerchantValetOrder && !arrivedAtDeparture ? (
                <div className="flex items-center gap-2 min-w-0 overflow-hidden flex-grow">
                  <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/80 shrink-0 whitespace-nowrap">
                    乘客出发地
                  </span>
                  <span className="text-sm font-bold text-gray-800 truncate">
                    {getPassengerDepartureAddress()}
                  </span>
                </div>
              ) : (
                <span className={`text-sm tracking-wide truncate ${destination ? 'font-bold text-gray-800' : 'text-gray-400 font-normal font-sans'}`}>
                  {destination || "请填写目的地（选填）"}
                </span>
              )}
              <svg className="h-4 w-4 text-gray-400 shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
              </svg>
            </div>
          </div>

          {/* Phone Number Input Row */}
          <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 rounded-2xl px-3.5 sm:px-4 py-1 border border-transparent focus-within:border-teal-500/30 focus-within:bg-white transition-all max-w-full overflow-hidden">
            <svg className="h-4 w-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
            </svg>
            <input 
              type="tel"
              inputMode="numeric"
              maxLength={11}
              value={phoneNumber}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/\D/g, '').slice(0, 11);
                setPhoneNumber(cleaned);
              }}
              className="bg-transparent border-none outline-none focus:outline-none focus-visible:outline-none focus:ring-0 p-0 text-sm font-bold text-gray-800 flex-1 min-w-0 tracking-tight placeholder:text-gray-400 placeholder:font-normal" 
              placeholder="客户手机号（选填）" 
              style={{ outline: 'none', boxShadow: 'none' }}
            />
            {phoneNumber.trim() !== '' && (
              <a
                href={`tel:${phoneNumber.trim()}`}
                onClick={(e) => {
                  e.stopPropagation();
                  window.location.href = `tel:${phoneNumber.trim()}`;
                }}
                className="flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white px-2.5 py-1 rounded-xl text-xs font-bold shadow-xs transition-all shrink-0 cursor-pointer whitespace-nowrap ml-auto"
                title="一键拨打电话"
              >
                <Phone className="w-3.5 h-3.5 fill-current shrink-0" />
                <span className="whitespace-nowrap">一键拨打</span>
              </a>
            )}
          </div>

        </div>

        {/* Price and Submit Action Row */}
        <div className="mt-2.5 mb-0.5 flex items-center justify-between gap-2 max-w-full overflow-hidden">
          <div data-purpose="price-estimation" className="text-left shrink-0 min-w-0">
            <div className="flex items-baseline leading-none whitespace-nowrap shrink-0">
              <span className="text-gray-500 text-[11px] font-semibold mr-1.5 whitespace-nowrap shrink-0">预估费用</span>
              {isMerchantValetOrder ? (
                <span className="text-orange-500 font-black text-xl sm:text-2xl tracking-tight ml-0.5 whitespace-nowrap">
                  自行协商
                </span>
              ) : (
                <div className="flex items-baseline whitespace-nowrap">
                  <span className="text-orange-500 font-bold text-sm">¥</span>
                  <span className="text-orange-500 font-black text-2xl sm:text-3xl ml-0.5 tracking-tight">
                    {estimatedPrice.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
            {!isMerchantValetOrder && (
              <p className="text-gray-400 text-[10px] scale-95 origin-left mt-1 font-medium select-none truncate">
                {routeDistance !== null && destination.trim() !== '' ? (
                  <span className="text-teal-600 font-bold truncate">
                    预估里程: {routeDistance.toFixed(2)}公里 (起步含{activeSlot.includedDistance || 7}公里)
                  </span>
                ) : destination.trim() !== '' ? (
                  `正在规划最优路线并计算距离...`
                ) : null}
              </p>
            )}
          </div>
          
          <button 
            onClick={async () => {
              if (isMerchantValetOrder && !arrivedAtDeparture) {
                setArrivedAtDeparture(true);
                const passStart = activeOnlineOrder?.startLocation || activeOnlineOrder?.originName || '出发地';
                const rawDest = activeOnlineOrder?.destination || '';
                const isValidDest = rawDest && 
                  rawDest !== activeOnlineOrder?.startLocation && 
                  !rawDest.includes('口头') && 
                  !rawDest.includes('报单转单');
                const passDest = isValidDest ? rawDest : '';
                setStartLocation(passStart);
                setDestination(passDest);

                // Update merchant order status to '司机到达'
                if (activeOnlineOrder) {
                  const orderId = activeOnlineOrder.id || activeOnlineOrder.orderId;
                  if (orderId) {
                    try {
                      if (db) {
                        await setDoc(doc(db, 'merchant_orders', orderId), {
                          status: 'arrived',
                          statusCategory: '司机到达',
                          arrivedAt: Date.now()
                        }, { merge: true });
                      }
                    } catch (e) {
                      console.error("Error updating merchant order to arrived:", e);
                    }

                    try {
                      const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
                      const updated = saved.map((o: any) => {
                        if (o.id === orderId || o.orderId === orderId || (o.orderNo && activeOnlineOrder?.orderNo && o.orderNo === activeOnlineOrder?.orderNo)) {
                          return {
                            ...o,
                            status: 'arrived',
                            statusCategory: '司机到达',
                            arrivedAt: Date.now()
                          };
                        }
                        return o;
                      });
                      localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(updated));
                      window.dispatchEvent(new CustomEvent('merchant_orders_updated'));
                    } catch (_) {}
                  }
                }
                return;
              }

              // Update merchant order status to '服务中' when creating order
              if (activeOnlineOrder) {
                const orderId = activeOnlineOrder.id || activeOnlineOrder.orderId;
                if (orderId) {
                  // Run Firestore sync asynchronously without blocking UI transition
                  if (db) {
                    setDoc(doc(db, 'merchant_orders', orderId), {
                      status: 'serving',
                      statusCategory: '服务中',
                      servingAt: Date.now()
                    }, { merge: true }).catch(e => {
                      console.error("Error updating merchant order to serving:", e);
                    });
                  }

                  try {
                    const saved = JSON.parse(localStorage.getItem('dd_merchant_orders_v2') || '[]');
                    const updated = saved.map((o: any) => {
                      if (o.id === orderId || o.orderId === orderId || (o.orderNo && activeOnlineOrder?.orderNo && o.orderNo === activeOnlineOrder?.orderNo)) {
                        return {
                          ...o,
                          status: 'serving',
                          statusCategory: '服务中',
                          servingAt: Date.now()
                        };
                      }
                      return o;
                    });
                    localStorage.setItem('dd_merchant_orders_v2', JSON.stringify(updated));
                    window.dispatchEvent(new CustomEvent('merchant_orders_updated'));
                  } catch (_) {}
                }
              }

              handleCreateOrder();
            }}
            className="bg-[#189F95] hover:bg-[#158C83] text-white px-4 sm:px-7 py-2.5 sm:py-3 rounded-xl font-bold text-sm sm:text-base active:scale-95 shadow-md shadow-[#189F95]/25 transition-all font-sans cursor-pointer whitespace-nowrap shrink-0" 
            data-purpose="submit-order"
          >
            {isMerchantValetOrder ? (
              !arrivedAtDeparture ? "到达出发地" : "创建订单"
            ) : (
              "创建订单"
            )}
          </button>
        </div>

      </div>
      {/* END: OrderDetailsCard */}

      {/* Custom Weather Multiplier Picker Dialog */}
      {showMultiplierPicker && (
        <div 
          id="weather-multiplier-picker-backdrop"
          className="absolute inset-0 bg-black/60 z-50 flex flex-col justify-end animate-in fade-in duration-200 animate-duration-200"
          onClick={() => {
            setShowMultiplierPicker(false);
          }}
        >
          <div 
            id="weather-multiplier-picker-card"
            className="bg-white rounded-t-[24px] px-6 pt-3 pb-8 flex flex-col space-y-4 animate-in slide-in-from-bottom duration-250 cursor-default relative text-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* iOS style drag handle indicator */}
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-1" />
            
            <div className="text-center">
              <p className="text-[17px] font-bold text-gray-800 font-sans">请选择恶劣天气加价倍数</p>
              <p className="text-xs text-gray-400 mt-1 font-sans">请上下滑动选择天气加价系数（1.0倍 ~ 2.0倍）</p>
            </div>

            {/* Scrolling picker wheel section */}
            <div className="relative h-[200px] overflow-hidden my-2 flex justify-center items-center bg-gray-50/50 rounded-2xl border border-gray-100">
              {/* Highlight Overlay representing chosen item */}
              <div className="absolute inset-x-0 top-[80px] h-[40px] bg-[#eefaf8]/60 border-y border-[#189F95]/30 pointer-events-none z-10 mx-6 rounded-xl" />
              
              <div 
                ref={multiplierScrollRef}
                onScroll={handleMultiplierScroll}
                className="h-full w-full overflow-y-auto scrollbar-none scroll-smooth snap-y snap-mandatory relative"
                style={{ scrollSnapType: 'y mandatory', scrollbarWidth: 'none' }}
              >
                <div className="h-[80px] pointer-events-none" />

                {MULTIPLIER_OPTIONS.map((val, idx) => {
                  const isSelected = tempMultiplier === val;
                  return (
                    <div
                      key={`mul-${val}`}
                      onClick={() => {
                        if (multiplierScrollRef.current) {
                          multiplierScrollRef.current.scrollTo({
                            top: idx * 40,
                            behavior: 'smooth'
                          });
                        }
                      }}
                      className={`h-[40px] flex items-center justify-center text-sm font-semibold transition-all duration-150 cursor-pointer snap-center ${
                        isSelected 
                          ? 'text-[#189F95] font-black text-base scale-110' 
                          : 'text-gray-400 opacity-60 scale-95 hover:text-gray-600'
                      }`}
                    >
                      {val.toFixed(1)} 倍
                    </div>
                  );
                })}

                <div className="h-[80px] pointer-events-none" />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                id="weather-multiplier-cancel-button"
                type="button"
                onClick={() => {
                  setShowMultiplierPicker(false);
                }}
                className="flex-1 py-3 text-center text-sm font-semibold text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-sans"
              >
                取消
              </button>
              <button
                id="weather-multiplier-confirm-button"
                type="button"
                onClick={() => {
                  setWeatherMultiplier(tempMultiplier);
                  setShowMultiplierPicker(false);
                }}
                className="flex-1 py-3 text-center text-sm font-bold text-white bg-[#189F95] rounded-xl hover:bg-[#158C83] transition-colors shadow-xs font-sans"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BEGIN: Live-Updating QR Code Order Modal Dialogue */}
      {showQrModal && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-[24px] w-full max-w-[325px] overflow-hidden shadow-2xl border border-gray-100 flex flex-col items-center p-6 space-y-5 animate-in zoom-in-95 duration-200">
            
            {/* Modal Title Header Banner */}
            <div className="text-center space-y-1 w-full pb-3 border-b border-gray-100">
              <h3 className="text-base font-black text-gray-900 flex items-center justify-center gap-1.5">
                <QrCode className="w-5 h-5 text-[#189F95]" />
                乘客扫码自助创单
              </h3>
              <p className="text-xs text-slate-400 font-sans">
                请向乘客出示下方二维码扫码呼叫
              </p>
            </div>

            {/* Dynamic Generating QR Code representation */}
            <div className="relative flex flex-col items-center justify-center p-4 bg-slate-50 rounded-2xl border border-gray-150">
              <SvgQrCode seed={qrUpdateCount} url={passengerScanUrl} />
              
              <div className="mt-3.5 flex items-center gap-2 text-xs text-slate-500 font-sans font-semibold">
                <Clock className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
                <span>二维码有效时间：</span>
                <span className="font-mono text-orange-500 font-black text-xs bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100">
                  {formatCountdown(qrCountdown)}
                </span>
              </div>
            </div>

            {/* Guideline text blocks */}
            <div className="text-left text-[11px] bg-slate-50/70 border border-slate-100/80 p-3.5 rounded-xl space-y-2 text-slate-500 leading-relaxed font-sans font-medium">
              <div className="flex items-start gap-1.5">
                <span className="text-[#189F95] font-black">•</span>
                <span>乘客使用微信或支付宝扫描上方二维码自动授权与填单。</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-[#189F95] font-black">•</span>
                <span>每过 <span className="font-bold text-orange-500">3分钟</span> 二维码将自动更新，安全防作弊，请及时核查。</span>
              </div>
            </div>



            {/* Actions Panel */}
            <div className="w-full flex flex-col gap-2 pt-1 font-sans">
              
              <button
                type="button"
                onClick={() => {
                  setShowQrModal(false);
                }}
                className="w-full py-2 bg-gray-50 hover:bg-gray-100 text-gray-500 rounded-xl font-semibold text-xs tracking-wide active:scale-[0.98] transition-transform cursor-pointer"
              >
                关闭返回
              </button>
            </div>

          </div>
         </div>
       )}

       {/* IN-APP REAL-TIME SIMULATION PANEL (Exposes Passenger view inside a Phone Frame for Mainland China Devs) */}
      {/* BEGIN: Full-screen Destination Selection Overlay */}
      {showDestinationSearch && (
        <div 
          className="absolute inset-0 bg-white z-[70] flex flex-col animate-in slide-in-from-bottom duration-300 pointer-events-auto"
          id="destination-search-page"
        >
          {/* Header */}
          <div className="bg-gray-700 border-b border-gray-600 px-4 py-7 flex items-center justify-between shrink-0">
            <button 
              onClick={() => setShowDestinationSearch(false)}
              className="text-white hover:text-gray-200 p-1 rounded-full active:scale-95 transition-all cursor-pointer flex items-center gap-1"
            >
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
              </svg>
              <span className="text-sm font-bold text-white">返回</span>
            </button>
            <h3 className="text-lg font-black text-white tracking-tight">输入目的地</h3>
            
            {/* "取消目的地" Button: Reset to default state and close */}
            <button 
              onClick={() => {
                setDestination('');
                setSearchText('');
                setShowDestinationSearch(false);
              }}
              className="text-white bg-rose-600 hover:bg-rose-750 font-bold text-xs active:scale-95 transition-all cursor-pointer px-3.5 py-2 rounded-full border border-rose-500"
            >
              取消目的地
            </button>
          </div>

          {/* Search Input bar */}
          <div className="p-4 bg-gray-50 border-b border-gray-100 shrink-0">
            <div className="relative flex items-center bg-white rounded-2xl border border-gray-200 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100 transition-all p-3 shadow-xs">
              <div className="w-2.5 h-2.5 bg-rose-500 rounded-full shrink-0 mr-3"></div>
              <input 
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="搜索目的地 / 输入具体地址"
                className="bg-transparent border-none outline-none focus:outline-none focus-visible:outline-none focus:ring-0 p-0 text-sm font-bold text-gray-800 flex-grow placeholder:text-gray-400 placeholder:font-normal"
                style={{ outline: 'none', boxShadow: 'none' }}
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
                      setDestination(tip.name);
                      setSearchText(tip.name);
                      setShowDestinationSearch(false);
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
                      您可直接点击下方【确认目的地】使用您手输的地址名称。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-2 mb-2">热门 / 推荐目的地</p>
                      <div className="grid grid-cols-2 gap-2">
                        {SUGGESTED_DESTINATIONS.map((name, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setDestination(name);
                              setSearchText(name);
                              setShowDestinationSearch(false);
                            }}
                            className="text-left px-3.5 py-2.5 bg-gray-50 hover:bg-teal-50/35 hover:border-teal-500/20 border border-transparent rounded-xl text-xs font-bold text-gray-700 transition-all cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis mr-1 mb-1"
                          >
                            📍 {name}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    {destination && (
                      <div className="pt-2">
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-2 mb-2">当前已设定</p>
                        <div className="p-3 bg-gray-50 rounded-xl flex items-center justify-between">
                          <span className="text-xs font-bold text-gray-850">{destination}</span>
                          <button 
                            onClick={() => {
                              setDestination('');
                              setSearchText('');
                              setShowDestinationSearch(false);
                            }}
                            className="text-xs font-bold text-rose-500 hover:text-rose-700 bg-rose-50 px-2 py-1 rounded-lg"
                          >
                            清除
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom Action Footer */}
          <div className="p-4 pb-[calc(1.25rem+max(env(safe-area-inset-bottom,0px),28px))] border-t border-gray-100 bg-white shrink-0 android-nav-safe-pb">
            <button
              onClick={() => {
                if (searchText.trim()) {
                  setDestination(searchText.trim());
                } else {
                  setDestination('');
                }
                setShowDestinationSearch(false);
              }}
              className="w-full py-4 bg-[#189F95] hover:bg-[#13827a] text-white rounded-2xl font-black text-sm active:scale-[0.98] transition-transform shadow-lg shadow-teal-500/10 cursor-pointer flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3"></path>
              </svg>
              <span>确认目的地</span>
            </button>
          </div>
        </div>
      )}

       {showSimulatedScanner && (
         <div className="absolute inset-0 bg-[#07080b]/95 z-[60] flex flex-col items-center justify-center p-2 animate-in fade-in duration-300">
           <div className="w-full max-w-[360px] h-[92vh] bg-[#07080b] rounded-[32px] border-4 border-slate-800 shadow-2xl relative overflow-hidden flex flex-col">
             
             {/* Simulated Notch / Speaker bar for aesthetics */}
             <div className="absolute top-0 inset-x-0 h-6 bg-slate-900 flex items-center justify-center z-50">
               <div className="w-24 h-4 bg-black rounded-b-xl flex items-center justify-center">
                 <div className="w-8 h-1 bg-slate-800 rounded-full"></div>
               </div>
             </div>

             <div className="flex-1 pt-6 overflow-y-auto">
               <PassengerOrderView
                 driverPhone={userPhone || '18609518888'}
                 onClose={() => {
                   setShowSimulatedScanner(false);
                 }}
               />
             </div>

             {/* Close Button overlay */}
             <button
               type="button"
               onClick={() => setShowSimulatedScanner(false)}
               className="absolute top-8 right-4 z-50 bg-slate-900/80 hover:bg-slate-950 text-slate-400 p-2 rounded-full border border-slate-800 flex items-center justify-center w-8 h-8 cursor-pointer"
             >
               ✕
             </button>
             
           </div>
         </div>
       )}

       {/* Cancel Order Confirmation Modal */}
       {showCancelConfirmModal && (
         <div className="absolute inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 animate-in fade-in duration-200">
           <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl flex flex-col items-center text-center space-y-4">
             <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 mb-1">
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
               </svg>
             </div>
             <h3 className="text-lg font-black text-gray-900">是否确认取消此订单</h3>
             <p className="text-xs text-gray-500 font-medium">取消后将返回首页，且此订单将从选单大厅中彻底移除，不会再次出现。</p>
             <div className="grid grid-cols-2 gap-3 w-full pt-2">
               <button
                 onClick={() => setShowCancelConfirmModal(false)}
                 className="py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-2xl text-sm transition-all cursor-pointer"
               >
                 返回
               </button>
               <button
                 onClick={handleConfirmCancelOrder}
                 className="py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-2xl text-sm transition-all shadow-lg shadow-rose-600/20 cursor-pointer"
               >
                 确认取消
               </button>
             </div>
           </div>
         </div>
       )}

    
        {/* Report Transfer Order Modal */}
        <ReportTransferOrderModal 
          isOpen={showReportTransferModal}
          onClose={() => setShowReportTransferModal(false)}
          userPhone={userPhone}
          defaultPickup={startLocation || '运祥小区'}
          driverCoords={driverCoords}
        />

</div>
  );
}
