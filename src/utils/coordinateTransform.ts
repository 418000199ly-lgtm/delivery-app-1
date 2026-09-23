/**
 * Unified Coordinate Transformation & Distance Calculation
 * Standard WGS-84 (GPS/Native HTML5 Geolocation) <-> GCJ-02 (Gaode/AMap/Tencent)
 */

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

export function outOfChina(lng: number, lat: number): boolean {
  if (lng < 72.004 || lng > 137.8347) return true;
  if (lat < 0.8293 || lat > 55.8271) return true;
  return false;
}

/**
 * Converts standard WGS-84 (GPS/HTML5 Geolocation) to GCJ-02 (Gaode AMap / Tencent Map)
 */
export function wgs84ToGcj02(lng: number, lat: number): { lng: number; lat: number } {
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

/**
 * Converts GCJ-02 to WGS-84
 */
export function gcj02ToWgs84(lng: number, lat: number): { lng: number; lat: number } {
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
  return { lng: lng * 2 - (lng + dLng), lat: lat * 2 - (lat + dLat) };
}

/**
 * Calculates straight line distance in meters between two lat/lng pairs
 */
export function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radLat1 = (lat1 * Math.PI) / 180.0;
  const radLat2 = (lat2 * Math.PI) / 180.0;
  const a = radLat1 - radLat2;
  const b = (lng1 * Math.PI) / 180.0 - (lng2 * Math.PI) / 180.0;
  let s = 2 * Math.asin(
    Math.sqrt(
      Math.pow(Math.sin(a / 2), 2) +
      Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b / 2), 2)
    )
  );
  s = s * 6378137.0; // WGS84 earth radius in meters
  return Math.round(s * 100) / 100;
}
