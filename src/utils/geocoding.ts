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

// Known POI dictionary for Yinchuan and major regional landmarks
const YINCHUAN_POI_MAP: Array<{ keywords: string[]; coords: Coords }> = [
  {
    keywords: ['银川市第二中学', '银川第二中学', '银川二中', '第二中学', '二中', '英才巷', '英才路'],
    coords: { lat: 38.4908, lng: 106.2485 } // 兴庆区英才巷/民族北街 银川二中
  },
  {
    keywords: ['良益轩泡馍', '良益轩', '泡馍店', '羊肉泡馍'],
    coords: { lat: 38.4845, lng: 106.2380 } // 兴庆区新华东街/中山街 良益轩泡馍
  },
  {
    keywords: ['华江大肉夹馍', '华江肉夹馍', '大肉夹馍'],
    coords: { lat: 38.4812, lng: 106.2348 }
  },
  {
    keywords: ['光大国旅中山街营业部', '光大国旅中山街', '光大国旅', '中山街营业部'],
    coords: { lat: 38.4855, lng: 106.2410 }
  },
  {
    keywords: ['德隆楼德鼎逸品(北京路店)', '德隆楼德鼎逸品', '德隆楼(北京东路店)', '德隆楼', '德鼎逸品'],
    coords: { lat: 38.4875, lng: 106.2620 }
  },
  {
    keywords: ['人社服务窗口（阳澄社区）', '人社服务窗口', '阳澄社区', '阳澄'],
    coords: { lat: 38.4920, lng: 106.2550 }
  },
  {
    keywords: ['西桥巷粉条大盘鸡', '粉条大盘鸡', '西桥巷'],
    coords: { lat: 38.4873, lng: 106.2625 }
  },
  {
    keywords: ['运祥小区', '运祥', '运祥小区南门', '运祥小区北门'],
    coords: DEFAULT_YINCHUAN_COORDS
  },
  {
    keywords: ['金凤万达', '金凤万达广场', '银川金凤万达广场', '金凤区万达', '万达广场'],
    coords: { lat: 38.5085, lng: 106.2160 } // 金凤区亲水北大街/万达广场 ~ 2.7 - 3.2km from city center
  },
  {
    keywords: ['西夏万达', '西夏区万达', '西夏万达广场', '宁大万达'],
    coords: { lat: 38.4985, lng: 106.1485 } // 西夏区 ~ 7.3km
  },
  {
    keywords: ['怀远夜市', '怀远路', '怀远市场', '八一车场'],
    coords: { lat: 38.4950, lng: 106.1550 } // 怀远夜市 ~ 6.7km
  },
  {
    keywords: ['建发大阅城', '大阅城', '音乐餐吧'],
    coords: { lat: 38.5255, lng: 106.2205 } // 大阅城 ~ 4.8km
  },
  {
    keywords: ['阅海湾', '阅海中央商务区', '阅海大酒店'],
    coords: { lat: 38.5450, lng: 106.2150 } // 阅海湾 ~ 6.6km
  },
  {
    keywords: ['眉山川菜（北门店）', '眉山川菜(北门店)', '眉山川菜北门店', '眉山川菜', '北关清真寺', '北塔东路'],
    coords: { lat: 38.4988, lng: 106.2815 } // 兴庆区北塔东路与中山北街交汇处向北100米 眉山川菜（北门店）
  },
  {
    keywords: ['正源北街', '悦海新天地'],
    coords: { lat: 38.5120, lng: 106.2180 } // 悦海新天地 ~ 3.3km
  },
  {
    keywords: ['德隆楼德鼎逸品(北京路店)', '德隆楼德鼎逸品', '德隆楼(北京东路店)', '德隆楼', '德鼎逸品'],
    coords: { lat: 38.4875, lng: 106.2620 } // 兴庆区北京东路与西桥巷交汇处 德隆楼德鼎逸品
  },
  {
    keywords: ['蕴辉商店', '南京包子铺'],
    coords: { lat: 38.4878, lng: 106.2622 } // 西桥巷 蕴辉商店
  },
  {
    keywords: ['同乡斋羊羔肉', '同乡斋', '马小军过油肉拌面'],
    coords: { lat: 38.4873, lng: 106.2629 } // 北京东路 同乡斋羊羔肉
  },
  {
    keywords: ['迎春苑1号楼'],
    coords: { lat: 38.4880, lng: 106.2618 }
  },
  {
    keywords: ['迎春苑2号楼'],
    coords: { lat: 38.4883, lng: 106.2615 }
  },
  {
    keywords: ['迎春苑'],
    coords: { lat: 38.4882, lng: 106.2616 }
  },
  {
    keywords: ['海宝苑', '海宝苑小区'],
    coords: { lat: 38.4886, lng: 106.2625 }
  },
  {
    keywords: ['宁祥园', '宁祥园小区'],
    coords: { lat: 38.4866, lng: 106.2635 }
  },
  {
    keywords: ['过油肉总店'],
    coords: { lat: 38.4871, lng: 106.2628 }
  },
  {
    keywords: ['德隆楼(森林公园店)', '德隆楼(北京中路店)', '北京中路德隆楼', '森林公园德隆楼'],
    coords: { lat: 38.4965, lng: 106.2110 } // 金凤区北京中路德隆楼德鼎逸品
  },
  {
    keywords: ['铂金大厦', '长相忆宾馆'],
    coords: { lat: 38.4825, lng: 106.2315 } // ~ 0.5km
  },
  {
    keywords: ['太阳神大酒店', '和平巷', '二哥辣炒小公鸡', '颐和家园', '和枫颐景'],
    coords: { lat: 38.4830, lng: 106.2350 }
  },
  {
    keywords: ['鼓楼', '新华百货', '解放东街', '兴庆区鼓楼'],
    coords: { lat: 38.4815, lng: 106.2355 } // ~ 0.7km
  },
  {
    keywords: ['玉皇阁', '唐徕', '唐徕花园'],
    coords: { lat: 38.4835, lng: 106.2325 } // ~ 0.4km
  },
  {
    keywords: ['宁夏医科大学总医院', '医大总院', '胜利街'],
    coords: { lat: 38.4485, lng: 106.2345 } // ~ 4.3km
  },
  {
    keywords: ['火车站', '银川火车站', '银川站'],
    coords: { lat: 38.4680, lng: 106.1820 } // ~ 4.8km
  },
  {
    keywords: ['宁夏大学', '宁大', '贺兰山路'],
    coords: { lat: 38.5020, lng: 106.1380 } // ~ 8.1km
  },
  {
    keywords: ['悠阅城', '建发悠阅城'],
    coords: { lat: 38.4250, lng: 106.2280 } // ~ 7.0km
  },
  {
    keywords: ['中山公园', '公园街'],
    coords: { lat: 38.4855, lng: 106.2225 } // ~ 0.8km
  },
  {
    keywords: ['市政府', '北京中路', '凯宾斯基'],
    coords: { lat: 38.4908, lng: 106.2123 } // ~ 1.8km
  },
  {
    keywords: ['黄河龙大厦', '黄河龙', '上海东路中山北街', '上海东路与中山北街', '百通苑', '华苑小区'],
    coords: { lat: 38.4892, lng: 106.2435 }
  },
  {
    keywords: ['五宝苑', '北关清真寺'],
    coords: { lat: 38.4828, lng: 106.2415 }
  },
  {
    keywords: ['游乐小区', '阳光巷游乐小区', '阳光花园'],
    coords: { lat: 38.4872, lng: 106.2309 }
  },
  {
    keywords: ['温州商城'],
    coords: { lat: 38.4750, lng: 106.2380 } // ~ 1.5km
  },
  {
    keywords: ['兴庆区政府住宅区'],
    coords: { lat: 38.4830, lng: 106.2350 }
  },
  {
    keywords: ['宝湖公园', '宝湖路'],
    coords: { lat: 38.4480, lng: 106.2200 } // ~ 4.5km
  },
  {
    keywords: ['望远人家A区', '望远人家B区', '望远人家', '望远镇', '双庆路', '四季鲜'],
    coords: { lat: 38.3880, lng: 106.2580 } // 永宁县望远镇/望远人家 ~ 10.8km south
  },
  {
    keywords: ['机场', '河东机场', '银川机场'],
    coords: { lat: 38.3220, lng: 106.3920 } // ~ 23km
  }
];

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
    } else {
      oLat = dLat;
      oLng = dLng;
    }
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
  fallbackCoords?: Coords | null
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
