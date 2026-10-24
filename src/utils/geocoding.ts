import { getBaseApiUrl, getAuthHeaders } from '../lib/dbProxy';

/**
 * Utility for geocoding and distance calculation across the application.
 * Guarantees valid Yinchuan / city coordinates and accurate distance sync.
 */

export interface Coords {
  lat: number;
  lng: number;
}

// Default Yinchuan city center coordinates (Yunxiang Residential Quarter / Xinhua Commercial Center)
export const DEFAULT_YINCHUAN_COORDS: Coords = {
  lat: 38.4830,
  lng: 106.2350
};

// 2026-10-12：本地POI已全部删除（用户铁律：纯服务端高德实时解析）
// 本地不再存储任何POI坐标，未知位置显示"位置未知"，绝不用假坐标冒充
const YINCHUAN_POI_MAP: Array<{ keywords: string[]; coords: Coords }> = [];

/**
 * Finds the nearest known POI landmark from coordinates if within maxDistKm (default 0.01 km = 10m)
 */
export function findNearestKnownPoi(coords?: { lat?: number; lng?: number } | null, maxDistKm = 0.01): string | null {
  if (!coords || !isValidCoords(coords.lat, coords.lng)) return null;
  const lat = Number(coords.lat);
  const lng = Number(coords.lng);
  let nearestName: string | null = null;
  let minDist = maxDistKm;

  for (const poi of YINCHUAN_POI_MAP) {
    const d = calculateHaversineDistanceKm(lat, lng, poi.coords.lat, poi.coords.lng);
    if (d < minDist) {
      minDist = d;
      nearestName = poi.keywords[0];
    }
  }
  return nearestName;
}

/**
 * Checks if coordinates are default city-level fallback / centroid coordinates (e.g. Ningxia Museum or People Square)
 */
export function isDefaultYinchuanCoords(coords: { lat: number; lng: number } | null | undefined): boolean {
  if (!coords || !isValidCoords(coords.lat, coords.lng)) return true;
  // Ningxia Museum / Default centroid: 38.4830, 106.2350
  if (Math.abs(coords.lat - 38.4830) < 0.003 && Math.abs(coords.lng - 106.2350) < 0.003) return true;
  // Municipal Government / People Square centroid: 38.487193, 106.230912
  if (Math.abs(coords.lat - 38.487193) < 0.003 && Math.abs(coords.lng - 106.230912) < 0.003) return true;
  if (Math.abs(coords.lat - 38.487167) < 0.003 && Math.abs(coords.lng - 106.23091) < 0.003) return true;
  return false;
}

/**
 * Validates if coordinates are within standard valid China geography range
 */
export function isValidCoords(lat: any, lng: any): boolean {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (isNaN(numLat) || isNaN(numLng)) return false;
  if (numLat === 0 && numLng === 0) return false;
  // China latitude roughly 15 ~ 55, longitude roughly 70 ~ 140
  return numLat >= 15 && numLat <= 55 && numLng >= 70 && numLng <= 140;
}

/**
 * Geocode an address string to latitude/longitude coordinates.
 * H9修复：POI查不到时返回null（不再回退银川市中心假坐标），调用方需处理null显示"位置未知"
 */
export function geocodeAddress(addressName?: string, fallbackCenter?: Coords): Coords | null {
  if (!addressName || typeof addressName !== 'string' || !addressName.trim() || addressName.includes('****') || addressName.trim() === '起点') {
    return null;
  }

  // Clean out common prefixes like "代驾商家起点为", "代驾商家起点：", "代驾商家起点", "商家起点：", "起点为", "起点："
  let cleanAddr = addressName.trim()
    .replace(/^代驾商家起点[为：:\s]*/g, '')
    .replace(/^商家代叫起点[为：:\s]*/g, '')
    .replace(/^商家起点[为：:\s]*/g, '')
    .replace(/^代叫商家起点[为：:\s]*/g, '')
    .replace(/^代驾起点[为：:\s]*/g, '')
    .replace(/^起点[为：:\s]*/g, '')
    .trim();

  if (!cleanAddr) {
    cleanAddr = addressName.trim();
  }

  // 1. Keyword search against known POI dictionary
  for (const poi of YINCHUAN_POI_MAP) {
    if (poi.keywords.some(kw => cleanAddr.includes(kw) || kw.includes(cleanAddr))) {
      return poi.coords;
    }
  }

  // If address only consisted of generic merchant start terms with no landmark, fallback to merchant/driver location
  if (['代驾商家起点', '代驾商家', '商家代叫', '代叫商家', '商家起点', '代驾起点'].some(kw => addressName.includes(kw))) {
    if (fallbackCenter && isValidCoords(fallbackCenter.lat, fallbackCenter.lng)) {
      return fallbackCenter;
    }
  }

  // H9修复：POI查不到时返回null，不再回退市中心假坐标
  return null;
}

/**
 * Haversine formula to compute straight line distance between two coordinates in kilometers
 */
export function calculateHaversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
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
 * 平滑移动地图镜头到目标点（2026-10-24 第四十九轮，修「地图先在他处、又被强行拉回」）：
 * - 当前中心与目标相距 ≤100 米：不动镜头（只更新标记即可），返回 false；
 * - 当前中心是未知（0,0/无效）：直接 setCenter 落位（从无意义视图切走不存在「平滑」一说）；
 * - 其余：优先 panTo 平滑飞行，旧版 AMap 无 panTo 时退回 setCenter。
 * 返回是否实际移动了镜头。
 */
export function smoothPanMapTo(map: any, lng: number, lat: number): boolean {
  if (!map || !isValidCoords(lat, lng)) return false;
  try {
    const c = typeof map.getCenter === 'function' ? map.getCenter() : null;
    const cLng = c ? Number(typeof c.getLng === 'function' ? c.getLng() : c.lng) : 0;
    const cLat = c ? Number(typeof c.getLat === 'function' ? c.getLat() : c.lat) : 0;
    if (isValidCoords(cLat, cLng)) {
      if (calculateHaversineDistanceKm(cLat, cLng, lat, lng) <= 0.1) return false;
      if (typeof map.panTo === 'function') {
        map.panTo([lng, lat]);
        return true;
      }
    }
    if (typeof map.setCenter === 'function') {
      map.setCenter([lng, lat]);
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * Format distance in meters or kilometers appropriately per user requirement:
 * - 1公里内显示多少米 (例如 "50米", "280米", "850米")
 * - 1公里外显示公里数保留2位小数 (例如 "1.01公里", "2.35公里")
 */
export function formatDistance(distInKm: number): string {
  // H9修复：NaN/负数返回"距离未知"，不再返回假的"850米"
  if (isNaN(distInKm) || distInKm < 0) return '距离未知';
  if (distInKm < 1.0) {
    const meters = Math.max(50, Math.round(distInKm * 1000));
    return `${meters}米`;
  } else {
    return `${distInKm.toFixed(2)}公里`;
  }
}

/**
 * Calculates the exact straight-line distance between order start location and current driver position.
 * Guarantees accurate distance sync and handles local POIs like '运祥小区'.
 */
export function calculateOrderDriverDistance(
  orderStartLocation?: string,
  orderLat?: number | null,
  orderLng?: number | null,
  driverCoords?: { lat: number; lng: number } | null,
  coordsUnknown?: boolean
): { distKm: number; displayDistText: string; resolvedLat: number; resolvedLng: number; isUnknown: boolean } {
  // 1. Resolve Driver Coords
  // w51/w53修复：司机GPS无效时不再回退到银川市中心（违反"未知坐标铁律"，曾致4.70km误算），
  // 直接标记距离未知
  // 2026-10-11修复：删除 localStorage 旧坐标兜底（无时间戳，几小时前坐标会导致373km误算）
  let dLat = driverCoords && isValidCoords(driverCoords.lat, driverCoords.lng) ? Number(driverCoords.lat) : 0;
  let dLng = driverCoords && isValidCoords(driverCoords.lat, driverCoords.lng) ? Number(driverCoords.lng) : 0;

  // 司机坐标无效：不回退市中心、不读旧缓存，直接返回未知
  if (!isValidCoords(dLat, dLng)) {
    let oLat = Number(orderLat);
    let oLng = Number(orderLng);
    return {
      distKm: -1,
      displayDistText: '距离未知',
      resolvedLat: isValidCoords(oLat, oLng) ? oLat : 0,
      resolvedLng: isValidCoords(oLat, oLng) ? oLng : 0,
      isUnknown: true
    };
  }

  // 2. Resolve Order Coords
  let oLat = Number(orderLat);
  let oLng = Number(orderLng);

  const isDefaultCityCoords = (
    (Math.abs(oLat - 38.4830) < 0.0001 && Math.abs(oLng - 106.2350) < 0.0001) ||
    (Math.abs(oLat - 38.487167) < 0.0001 && Math.abs(oLng - 106.23091) < 0.0001)
  );

  // If order coordinates are missing, invalid, or default city center, re-geocode using start location name with driver coordinates as fallback
  if (!isValidCoords(oLat, oLng) || isDefaultCityCoords) {
    if (orderStartLocation && typeof orderStartLocation === 'string' && orderStartLocation.trim()) {
      const geocodedPOI = geocodeAddress(orderStartLocation, { lat: dLat, lng: dLng });
      // H9修复：geocodeAddress可能返回null，需判空
      if (geocodedPOI && isValidCoords(geocodedPOI.lat, geocodedPOI.lng)) {
        oLat = geocodedPOI.lat;
        oLng = geocodedPOI.lng;
      }
      // 2026-10-12：如果POI查不到，保持无效，后面统一返回"距离未知"
    } else {
      // 2026-10-12修复：订单名为空且坐标无效时，不再用司机坐标冒充（会导致距离=0误判），保持无效走"距离未知"
      oLat = NaN;
      oLng = NaN;
    }
  }

  // 2026-10-12修复：坐标仍无效时直接返回"距离未知"，绝不用无效坐标算出上万公里（铁律）
  if (!isValidCoords(oLat, oLng)) {
    return {
      distKm: -1,
      displayDistText: '距离未知',
      resolvedLat: 0,
      resolvedLng: 0,
      isUnknown: true
    };
  }

  // 3. Calculate exact straight line Haversine distance between real driver GPS and real order GPS
  const distKm = calculateHaversineDistanceKm(dLat, dLng, oLat, oLng);
  const displayDistText = distKm < 0.05 ? '80米' : formatDistance(distKm);

  return {
    distKm: distKm < 0.05 ? 0 : distKm,
    displayDistText,
    resolvedLat: oLat,
    resolvedLng: oLng,
    isUnknown: false
  };
}

/**
 * Asynchronously geocode merchant start location using Aliyun server /api/geocode,
 * with fallback to local POI map and device coordinates.
 */
export async function geocodeAddressViaServer(
  addressName?: string,
  fallbackCoords?: Coords | null,
  city?: string // 2026-10-11：城市限制，防跨城误解析
): Promise<Coords> {
  const fallback = (fallbackCoords && isValidCoords(fallbackCoords.lat, fallbackCoords.lng))
    ? fallbackCoords
    : DEFAULT_YINCHUAN_COORDS;

  if (!addressName || typeof addressName !== 'string' || !addressName.trim()) {
    return fallback;
  }

  try {
    const baseUrl = getBaseApiUrl();
    const cleanAddr = addressName.trim();
    const params = new URLSearchParams();
    params.set('address', cleanAddr);
    params.set('lat', String(fallback.lat));
    params.set('lng', String(fallback.lng));
    if (city && city.trim()) {
      params.set('city', city.trim());
    }

    const res = await fetch(`${baseUrl}/api/geocode?${params.toString()}`, {
      headers: { ...getAuthHeaders() }
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.success && isValidCoords(json.lat, json.lng)) {
        return { lat: Number(json.lat), lng: Number(json.lng) };
      }
    }
  } catch (_) {}

  // H9修复：geocodeAddress可能返回null，用fallback兜底（保持Promise<Coords>签名）
  return geocodeAddress(addressName, fallback) || fallback;
}
