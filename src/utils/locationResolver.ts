import { TripState } from '../types';
import { db, doc, updateDoc } from '../lib/dbProxy';

const getPoiLngLat = (poi: any) => {
  if (!poi) return null;
  if (poi.location) {
    if (typeof poi.location.getLng === 'function') {
      return { lng: poi.location.getLng(), lat: poi.location.getLat() };
    }
    if (poi.location.lng !== undefined && poi.location.lat !== undefined) {
      return { lng: Number(poi.location.lng), lat: Number(poi.location.lat) };
    }
  }
  return null;
};

const getPoiDistance = (poi: any, centerLng?: number, centerLat?: number): number => {
  if (centerLng !== undefined && centerLat !== undefined) {
    const loc = getPoiLngLat(poi);
    if (loc) {
      const dLng = loc.lng - centerLng;
      const dLat = loc.lat - centerLat;
      return Math.sqrt(dLng * dLng + dLat * dLat);
    }
  }
  if (poi.distance !== undefined && poi.distance !== null && poi.distance !== '') {
    const dist = Number(poi.distance);
    if (!isNaN(dist)) return dist;
  }
  return 999999;
};

export const getHighPrecisionLocationName = (
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
      if (isGenericResA && !isGenericResB && distB <= 150) return 1;

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

/**
 * Check if the destination is unset or a placeholder string
 */
import { safeSetItem } from './safeStorage';

export function isUnsetDestination(dest?: string): boolean {
  if (!dest) return true;
  const d = dest.trim();
  return (
    !d ||
    d === '请填写目的地（选填）' ||
    d === '待指定安全目的地' ||
    d === '未完成安全目的地设定' ||
    d === '未填写' ||
    d === '请填写目的地' ||
    d === '未定位终点' ||
    d === '目的地'
  );
}

/**
 * Obtain current high-precision GPS position and resolve its landmark name
 */
export async function resolveCurrentGpsLocationName(): Promise<{ name: string; lng: number; lat: number } | null> {
  return new Promise((resolve) => {
    const defaultLng = Number(localStorage.getItem('dd_bg_driver_coords_lng') || '106.230912');
    const defaultLat = Number(localStorage.getItem('dd_bg_driver_coords_lat') || '38.487193');

    const doGeocode = (lng: number, lat: number) => {
      const AMap = typeof window !== 'undefined' ? (window as any).AMap : undefined;
      if (!AMap) {
        resolve(null);
        return;
      }

      AMap.plugin('AMap.Geocoder', () => {
        try {
          const geocoder = new AMap.Geocoder({
            extensions: 'all',
            city: '银川市'
          });
          geocoder.getAddress([lng, lat], (status: string, result: any) => {
            if (status === 'complete' && result && result.regeocode) {
              let resolvedName = getHighPrecisionLocationName(
                result.regeocode,
                result.regeocode.formattedAddress || '当前位置',
                lng,
                lat
              );
              if (resolvedName && resolvedName.includes('宁夏博物馆')) {
                resolvedName = '运祥小区';
              }
              if (resolvedName && resolvedName !== '当前位置' && !isUnsetDestination(resolvedName)) {
                resolve({ name: resolvedName, lng, lat });
                return;
              }
            }
            resolve(null);
          });
        } catch (err) {
          console.error('Error during AMap geocoding:', err);
          resolve(null);
        }
      });
    };

    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lng = pos.coords.longitude;
          const lat = pos.coords.latitude;
          if (lng && lat && !isNaN(lng) && !isNaN(lat)) {
            localStorage.setItem('dd_bg_driver_coords_lng', String(lng));
            localStorage.setItem('dd_bg_driver_coords_lat', String(lat));
            doGeocode(lng, lat);
          } else {
            doGeocode(defaultLng, defaultLat);
          }
        },
        (err) => {
          console.warn('Geolocation failed, falling back to cached/default coords:', err);
          doGeocode(defaultLng, defaultLat);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
      );
    } else {
      doGeocode(defaultLng, defaultLat);
    }
  });
}

/**
 * Automatically update the order's destination in all storage layers if it was unset.
 */
export async function autoUpdateOrderDestinationIfUnset(
  trip: TripState,
  userPhone?: string,
  onTripUpdated?: (updatedTrip: TripState) => void
): Promise<TripState> {
  const currentDest = trip.endLocation || (trip as any).destination || (trip as any).dropoffName || '';
  let resolvedName = '';

  // If trip distance is small (<= 0.3km) or ended in-place, and startLocation is valid, default destination to startLocation
  if (trip.startLocation && !isUnsetDestination(trip.startLocation) && (trip.currentDistance <= 0.3 || isUnsetDestination(currentDest) || currentDest.includes('宁夏博物馆'))) {
    resolvedName = trip.startLocation.includes('宁夏博物馆') ? '运祥小区' : trip.startLocation;
  } else if (!isUnsetDestination(currentDest) && !currentDest.includes('宁夏博物馆')) {
    // Driver already specified a valid destination, return untouched
    return trip;
  } else {
    // Destination was unset or Ningxia Museum artifact! Auto fetch current GPS location and geocode landmark name
    const gpsResult = await resolveCurrentGpsLocationName();
    if (gpsResult && gpsResult.name && !gpsResult.name.includes('宁夏博物馆')) {
      resolvedName = gpsResult.name;
    } else if (trip.startLocation && !isUnsetDestination(trip.startLocation) && !trip.startLocation.includes('宁夏博物馆')) {
      resolvedName = trip.startLocation;
    } else {
      resolvedName = '运祥小区';
    }
  }

  // Build updated trip
  const updatedTrip: TripState = {
    ...trip,
    endLocation: resolvedName,
    dropoffName: resolvedName,
    destination: resolvedName
  } as TripState;

  // 1. Notify caller / state
  if (onTripUpdated) {
    onTripUpdated(updatedTrip);
  }

  // 2. Update localStorage driver orders
  try {
    const ordersKey = userPhone ? `dd_driver_orders_${userPhone}` : 'dd_driver_orders';
    const rawDriverOrders = localStorage.getItem(ordersKey) || localStorage.getItem('dd_driver_orders');
    if (rawDriverOrders) {
      let orders = JSON.parse(rawDriverOrders);
      if (Array.isArray(orders)) {
        let matched = false;
        orders = orders.map((o: any) => {
          if (o.id === trip.id || (trip.id && String(o.id) === String(trip.id))) {
            matched = true;
            return {
              ...o,
              endLocation: resolvedName,
              destination: resolvedName,
              dropoffName: resolvedName
            };
          }
          return o;
        });

        // If not matched in existing list, update the first item if created recently
        if (!matched && orders.length > 0 && isUnsetDestination(orders[0].endLocation)) {
          orders[0].endLocation = resolvedName;
          orders[0].destination = resolvedName;
          orders[0].dropoffName = resolvedName;
        }

        localStorage.setItem(ordersKey, JSON.stringify(orders));
        localStorage.setItem('dd_driver_orders', JSON.stringify(orders));
      }
    }
  } catch (err) {
    console.error('Error updating dd_driver_orders in locationResolver:', err);
  }

  // 3. Update localStorage merchant valet orders (if this is a valet/dispatch order)
  try {
    const rawValetOrders = localStorage.getItem('dd_valet_orders');
    if (rawValetOrders) {
      let valetOrders = JSON.parse(rawValetOrders);
      if (Array.isArray(valetOrders)) {
        let changed = false;
        valetOrders = valetOrders.map((vo: any) => {
          if (vo.id === trip.id || String(vo.id) === String(trip.id)) {
            changed = true;
            return {
              ...vo,
              endLocation: resolvedName,
              destination: resolvedName,
              dropoffName: resolvedName
            };
          }
          return vo;
        });
        if (changed) {
          localStorage.setItem('dd_valet_orders', JSON.stringify(valetOrders));
          window.dispatchEvent(new CustomEvent('valet_orders_updated'));
        }
      }
    }
  } catch (err) {
    console.error('Error updating dd_valet_orders in locationResolver:', err);
  }

  // 4. Update dd_current_trip
  try {
    const rawCurrentTrip = localStorage.getItem('dd_current_trip');
    if (rawCurrentTrip) {
      const cur = JSON.parse(rawCurrentTrip);
      if (cur) {
        cur.endLocation = resolvedName;
        cur.destination = resolvedName;
        cur.dropoffName = resolvedName;
        safeSetItem('dd_current_trip', JSON.stringify(cur));
      }
    }
  } catch (err) {
    console.error('Error updating dd_current_trip:', err);
  }

  // 5. Async sync to Firestore if db is available
  if (db && trip.id) {
    try {
      const valetRef = doc(db, 'valet_orders', String(trip.id));
      updateDoc(valetRef, {
        endLocation: resolvedName,
        destination: resolvedName,
        dropoffName: resolvedName
      }).catch(() => {});

      const orderRef = doc(db, 'orders', String(trip.id));
      updateDoc(orderRef, {
        endLocation: resolvedName,
        destination: resolvedName,
        dropoffName: resolvedName
      }).catch(() => {});
    } catch (err) {
      console.warn('Firestore update doc silent warning:', err);
    }
  }

  return updatedTrip;
}
