import React, { useEffect, useRef, useState } from 'react';
import { Wifi, Volume2, VolumeX, Compass, Map, X, ArrowLeft, RotateCcw, Navigation } from 'lucide-react';
import { speakText, stopSpeaking, initAudioUnlock } from '../utils/speech';

interface NavigationViewProps {
  destination: string;
  startLocation?: string;
  driverCoords?: { lat: number; lng: number } | null;
  registeredCity?: string;
  currentDistance?: number;
  calculatedTotalFee?: number;
  onClose: () => void;
}

export default function NavigationView({
  destination,
  startLocation,
  driverCoords,
  registeredCity = '银川市',
  currentDistance = 0,
  calculatedTotalFee = 59,
  onClose
}: NavigationViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const drivingPluginRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);

  const destMarkerRef = useRef<any>(null);
  const offRouteCountRef = useRef<number>(0);

  // HUD & Maneuver state
  const [nextInstruction, setNextInstruction] = useState<string>('计算最优路线中...');
  const [nextRoad, setNextRoad] = useState<string>('获取道路信息...');
  const [turnAction, setTurnAction] = useState<'left' | 'right' | 'straight' | 'uturn'>('left');
  const [remainingDistance, setRemainingDistance] = useState<string>('计算中...');
  const [remainingTime, setRemainingTime] = useState<string>('计算中...');

  const [isOverviewMode, setIsOverviewMode] = useState<boolean>(false);
  const [isVoiceOn, setIsVoiceOn] = useState<boolean>(true);
  const [toastMsg, setToastMsg] = useState<string>('');
  const [scaleText, setScaleText] = useState<string>('25m');
  const [scaleBarWidth, setScaleBarWidth] = useState<number>(53);

  // Real-time Gaode Traffic Light (红绿灯倒计时) State
  const [totalTrafficLights, setTotalTrafficLights] = useState<number>(0);
  // 红绿灯状态已删除（2026-10-10）：虚假倒计时，有行车安全风险

  const lastRouteKeyRef = useRef<string>('');
  const currentDriverPosRef = useRef<{ lng: number; lat: number } | null>(null);
  const destinationCoordsRef = useRef<{ lng: number; lat: number } | null>(null);
  const activeRoutePathRef = useRef<Array<[number, number]>>([]);
  const activeRoutePolylineRef = useRef<any>(null);
  const intersectionMarkerRef = useRef<any>(null);
  const lastRerouteTimestampRef = useRef<number>(0);
  const headingAngleRef = useRef<number>(0);
  // BUG-1+2修复：保存完整steps用于指令推进和剩余距离实时计算
  const routeStepsRef = useRef<any[]>([]);
  const currentStepIndexRef = useRef<number>(0);
  const arrivedAnnouncedRef = useRef<boolean>(false);
  // BUG-9：GPS信号强度动态显示
  const [gpsSignalText, setGpsSignalText] = useState<string>('定位中…');

  // Helper to calculate bearing angle between two points
  const calculateBearing = (startLat: number, startLng: number, destLat: number, destLng: number) => {
    const startLatRad = (startLat * Math.PI) / 180;
    const startLngRad = (startLng * Math.PI) / 180;
    const destLatRad = (destLat * Math.PI) / 180;
    const destLngRad = (destLng * Math.PI) / 180;

    const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
    const x =
      Math.cos(startLatRad) * Math.sin(destLatRad) -
      Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(destLngRad - startLngRad);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  };

  // Helper to calculate ground scale bar based on zoom level and latitude
  const calculateScale = (zoom: number, lat: number) => {
    // Standard Web Mercator ground resolution in meters per pixel
    const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    
    // Scale standard nice distances (meters)
    const niceDistances = [
      5, 10, 20, 25, 50, 100, 200, 500,
      1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000
    ];
    
    // Target visual width in pixels (e.g. ~48-52px)
    const targetPx = 50;
    const idealDist = targetPx * metersPerPixel;
    
    let bestDist = niceDistances[0];
    let minDiff = Math.abs(niceDistances[0] - idealDist);
    for (let i = 1; i < niceDistances.length; i++) {
      const diff = Math.abs(niceDistances[i] - idealDist);
      if (diff < minDiff) {
        minDiff = diff;
        bestDist = niceDistances[i];
      }
    }
    
    const widthPx = Math.max(28, Math.min(84, Math.round(bestDist / metersPerPixel)));
    const text = bestDist >= 1000 ? `${bestDist / 1000}公里` : `${bestDist}m`;
    
    return { text, width: widthPx };
  };

  // Helper to calculate distance from point to line segment in meters
  const distanceToSegmentMeters = (
    pLng: number, pLat: number,
    aLng: number, aLat: number,
    bLng: number, bLat: number
  ): number => {
    const x = pLng, y = pLat;
    const x1 = aLng, y1 = aLat;
    const x2 = bLng, y2 = bLat;

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = (x - xx) * 111320 * Math.cos(((y + yy) / 2) * (Math.PI / 180));
    const dy = (y - yy) * 110574;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getMinDistanceToRoute = (pLng: number, pLat: number): number => {
    const path = activeRoutePathRef.current;
    if (!path || path.length < 2) return 0;
    let minDist = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const dist = distanceToSegmentMeters(pLng, pLat, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
      if (dist < minDist) {
        minDist = dist;
      }
    }
    return minDist === Infinity ? 0 : minDist;
  };


  // Trigger Toast Helper
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2500);
  };

  // Speak voice instruction helper
  const speakVoice = (text: string) => {
    if (!isVoiceOn || typeof window === 'undefined') return;
    speakText(text);
  };

  // Toggle Route Overview or Restore to default 25m scale view
  const toggleOverviewMode = () => {
    if (!mapInstanceRef.current) return;
    if (!isOverviewMode) {
      // Switch to Route Overview
      setIsOverviewMode(true);
      if (activeRoutePathRef.current && activeRoutePathRef.current.length > 0) {
        mapInstanceRef.current.setFitView(null, false, [140, 40, 160, 40]);
      } else if (currentDriverPosRef.current && destinationCoordsRef.current) {
        const AMap = (window as any).AMap;
        if (AMap && AMap.Bounds) {
          const bounds = new AMap.Bounds(
            [
              Math.min(currentDriverPosRef.current.lng, destinationCoordsRef.current.lng) - 0.015,
              Math.min(currentDriverPosRef.current.lat, destinationCoordsRef.current.lat) - 0.015
            ],
            [
              Math.max(currentDriverPosRef.current.lng, destinationCoordsRef.current.lng) + 0.015,
              Math.max(currentDriverPosRef.current.lat, destinationCoordsRef.current.lat) + 0.015
            ]
          );
          mapInstanceRef.current.setBounds(bounds);
        }
      }
      showToast('🗺️ 已切换至路线全览');
    } else {
      // Restore to Default 25m Scale Navigation View
      setIsOverviewMode(false);
      if (currentDriverPosRef.current) {
        mapInstanceRef.current.setZoomAndCenter(18, [
          currentDriverPosRef.current.lng,
          currentDriverPosRef.current.lat
        ]);
      }
      showToast('🚗 已恢复默认比例尺25m导航');
    }
  };

  // Real-time Device Compass Heading Listener (Real Phone Motion Direction)
  useEffect(() => {
    const handleOrientation = (e: any) => {
      let heading: number | null = null;
      if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
        heading = e.webkitCompassHeading;
      } else if (e.alpha !== null && e.alpha !== undefined) {
        heading = (360 - e.alpha) % 360;
      }
      if (heading !== null && !isNaN(heading)) {
        headingAngleRef.current = heading;
        updateVehicleMarkerHeading(heading);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
        window.removeEventListener('deviceorientation', handleOrientation, true);
      }
    };
  }, []);

  const updateVehicleMarkerHeading = (heading: number) => {
    const arrowElem = document.getElementById('driver-vehicle-arrow-icon');
    if (arrowElem) {
      arrowElem.style.transform = `rotate(${heading - 45}deg)`;
    }
  };

  useEffect(() => {
    initAudioUnlock();
    const AMap = (window as any).AMap;
    if (!AMap || !mapContainerRef.current) return;

    // Retrieve stable cached or passed driver coordinates as base anchor
    const cachedLat = localStorage.getItem('dd_bg_driver_coords_lat');
    const cachedLng = localStorage.getItem('dd_bg_driver_coords_lng');

    let initialLng = driverCoords?.lng || (cachedLng ? Number(cachedLng) : 106.2350);
    let initialLat = driverCoords?.lat || (cachedLat ? Number(cachedLat) : 38.4830);

    // Prevent fallback coordinates from placing position over Yinchuan Municipal Government (106.230912, 38.487193)
    if (Math.abs(initialLng - 106.230912) < 0.002 && Math.abs(initialLat - 38.487193) < 0.002) {
      initialLng = 106.2350;
      initialLat = 38.4830;
    }

    currentDriverPosRef.current = { lng: initialLng, lat: initialLat };

    // Create AMap instance in 2D top-down view with default 25m scale (zoom 18)
    const map = new AMap.Map(mapContainerRef.current, {
      zoom: 18,
      center: [initialLng, initialLat],
      pitch: 0,
      viewMode: '2D',
      mapStyle: 'amap://styles/normal',
      resizeEnable: true,
      rotateEnable: false,
      pitchEnable: false,
      zoomEnable: true,
      dragEnable: true,
      touchZoom: true,
      scrollWheel: true,
      doubleClickZoom: true
    });

    mapInstanceRef.current = map;

    // Synchronize scale indicator with map zoom and center latitude
    const updateScaleDisplay = () => {
      try {
        const currentZoom = map.getZoom();
        const center = map.getCenter();
        const lat = center ? (typeof center.getLat === 'function' ? center.getLat() : center.lat) : initialLat;
        const { text, width } = calculateScale(currentZoom, lat);
        setScaleText(text);
        setScaleBarWidth(width);
      } catch (err) {
        console.warn('Scale update err:', err);
      }
    };

    updateScaleDisplay();
    map.on('zoomchange', updateScaleDisplay);
    map.on('zoomend', updateScaleDisplay);
    map.on('moveend', updateScaleDisplay);
    map.on('mapmove', updateScaleDisplay);
    map.on('resize', updateScaleDisplay);

    // Create Driver blue navigation arrow marker with compass indicators (2D North-Up view matching q7.png)
    const driverMarker = new AMap.Marker({
      position: [initialLng, initialLat],
      offset: new AMap.Pixel(-36, -36),
      content: `
        <div class="relative flex items-center justify-center w-20 h-20 select-none pointer-events-none">
          <!-- Compass points around blue puck (北, 东, 南, 西 matching real orientation) -->
          <span class="absolute top-0 left-1/2 -translate-x-1/2 text-[11px] font-black text-red-600 bg-white/90 px-1 rounded shadow-sm">北</span>
          <span class="absolute right-0 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-800 bg-white/80 px-0.5 rounded">东</span>
          <span class="absolute bottom-0 left-1/2 -translate-x-1/2 text-[11px] font-bold text-slate-800 bg-white/80 px-0.5 rounded">南</span>
          <span class="absolute left-0 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-800 bg-white/80 px-0.5 rounded">西</span>

          <!-- Vehicle location blue puck -->
          <div class="relative w-9 h-9 bg-blue-500/20 rounded-full flex items-center justify-center animate-pulse">
            <div class="w-8 h-8 bg-blue-600 rounded-full border-2 border-white shadow-xl flex items-center justify-center">
              <svg id="driver-vehicle-arrow-icon" style="transition: transform 0.2s ease-out;" class="w-5 h-5 text-white transform -rotate-45" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
              </svg>
            </div>
          </div>
        </div>
      `,
      zIndex: 120
    });
    driverMarker.setMap(map);
    driverMarkerRef.current = driverMarker;

    const cleanStart = (startLocation || '')
      .replace(/^\([^)]+\)\s*/, '')
      .trim();

    const cleanDest = destination && 
      destination !== '请填写目的地（选填）' && 
      destination !== '待指定安全目的地' && 
      destination !== '未完成安全目的地设定' &&
      destination !== '未知' &&
      !destination.startsWith('未知') &&
      destination !== '待确定'
      ? destination.replace(/^\([^)]+\)\s*/, '').trim()
      : '建发大阅城';

    // Load Driving plugin, Geocoder plugin, and PlaceSearch plugin
    AMap.plugin(['AMap.Driving', 'AMap.Geocoder', 'AMap.PlaceSearch'], () => {
      const geocoder = new AMap.Geocoder({ city: registeredCity || '银川市' });
      const placeSearch = new AMap.PlaceSearch({ city: registeredCity || '银川市' });

      const driving = new AMap.Driving({
        map: map,
        policy: AMap.DrivingPolicy.LEAST_TIME,
        showTraffic: true,
        hideMarkers: true,
        autoFitView: false
      });
      drivingPluginRef.current = driving;

      const createOrUpdateDestMarker = (dLng: number, dLat: number, name: string) => {
        if (!mapInstanceRef.current || !AMap) return;
        if (destMarkerRef.current) {
          destMarkerRef.current.setPosition([dLng, dLat]);
        } else {
          const destMarker = new AMap.Marker({
            position: [dLng, dLat],
            offset: new AMap.Pixel(-14, -34),
            content: `
              <div class="relative flex flex-col items-center">
                <div class="px-2 py-0.5 bg-red-600 text-white font-bold text-[11px] rounded-md shadow-md mb-1 whitespace-nowrap border border-white">
                  ${name}
                </div>
                <div class="w-7 h-7 bg-red-600 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-white font-black text-xs">
                  终
                </div>
              </div>
            `,
            zIndex: 115
          });
          destMarker.setMap(mapInstanceRef.current);
          destMarkerRef.current = destMarker;
        }
      };

      const resolveDestination = (onResolvedDest: (dLng: number, dLat: number) => void) => {
        placeSearch.search(cleanDest, (pStatus: string, pResult: any) => {
          if (pStatus === 'complete' && pResult.poiList && pResult.poiList.pois && pResult.poiList.pois.length > 0) {
            const poi = pResult.poiList.pois[0];
            const pLng = poi.location.getLng ? poi.location.getLng() : poi.location.lng;
            const pLat = poi.location.getLat ? poi.location.getLat() : poi.location.lat;
            onResolvedDest(pLng, pLat);
            return;
          }

          geocoder.getLocation(cleanDest, (status: string, result: any) => {
            if (status === 'complete' && result.geocodes && result.geocodes.length > 0) {
              const loc = result.geocodes[0].location;
              const dLng = loc.getLng ? loc.getLng() : loc.lng;
              const dLat = loc.getLat ? loc.getLat() : loc.lat;
              onResolvedDest(dLng, dLat);
              return;
            }

            placeSearch.search(`${registeredCity || '银川市'}${cleanDest}`, (pStatus2: string, pResult2: any) => {
              // BUG-5修复：解析失败不再捏造假目的地，直接报错中止
              if (pStatus2 === 'complete' && pResult2.poiList && pResult2.poiList.pois && pResult2.poiList.pois.length > 0) {
                const poi2 = pResult2.poiList.pois[0];
                const dLng = poi2.location.getLng ? poi2.location.getLng() : poi2.location.lng;
                const dLat = poi2.location.getLat ? poi2.location.getLat() : poi2.location.lat;
                onResolvedDest(dLng, dLat);
              } else {
                showToast('❌ 目的地解析失败，请检查地址是否正确');
                setNextInstruction('目的地解析失败');
                setNextRoad('请检查地址');
              }
            });
          });
        });
      };

      const resolveOrigin = (onResolvedOrigin: (oLng: number, oLat: number) => void) => {
        const safeCallback = (lng: number, lat: number) => {
          // BUG-7修复：删除坐标魔改，不伪造位置
          onResolvedOrigin(lng, lat);
        };

        // Priority 1: driverCoords passed from parent
        if (driverCoords && typeof driverCoords.lng === 'number' && typeof driverCoords.lat === 'number') {
          safeCallback(driverCoords.lng, driverCoords.lat);
          return;
        }

        // Priority 2: startLocation prop
        // BUG-6修复：不再硬编码开发者个人地址，无有效起点时用实时GPS
        const queryStart = (cleanStart && !['银川', '银川市', '银川市人民政府', '太阳神大酒店', '当前位置', '定位中...', '未定位起点'].includes(cleanStart))
          ? cleanStart
          : '';

        // 无有效起点名时直接用实时GPS，不伪造
        if (!queryStart) {
          if (driverCoords && typeof driverCoords.lng === 'number' && typeof driverCoords.lat === 'number') {
            safeCallback(driverCoords.lng, driverCoords.lat);
          } else {
            showToast('📍 定位中，请稍候…');
            setNextInstruction('定位中…');
          }
          return;
        }

        placeSearch.search(queryStart, (sStatus: string, sResult: any) => {
          if (sStatus === 'complete' && sResult.poiList && sResult.poiList.pois && sResult.poiList.pois.length > 0) {
            const poi = sResult.poiList.pois[0];
            const sLng = poi.location.getLng ? poi.location.getLng() : poi.location.lng;
            const sLat = poi.location.getLat ? poi.location.getLat() : poi.location.lat;
            safeCallback(sLng, sLat);
            return;
          }

          geocoder.getLocation(queryStart, (gStatus: string, gResult: any) => {
            if (gStatus === 'complete' && gResult.geocodes && gResult.geocodes.length > 0) {
              const loc = gResult.geocodes[0].location;
              const sLng = loc.getLng ? loc.getLng() : loc.lng;
              const sLat = loc.getLat ? loc.getLat() : loc.lat;
              safeCallback(sLng, sLat);
              return;
            }

            if (cachedLng && cachedLat) {
              safeCallback(Number(cachedLng), Number(cachedLat));
            } else {
              safeCallback(initialLng, initialLat);
            }
          });
        });
      };

      // Resolve Origin & Destination together, then update vehicle position & plan route
      resolveOrigin((oLng, oLat) => {
        currentDriverPosRef.current = { lng: oLng, lat: oLat };
        if (driverMarkerRef.current) {
          driverMarkerRef.current.setPosition([oLng, oLat]);
        }
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setCenter([oLng, oLat]);
        }

        resolveDestination((dLng, dLat) => {
          destinationCoordsRef.current = { lng: dLng, lat: dLat };
          createOrUpdateDestMarker(dLng, dLat, cleanDest);
          planRoute(oLng, oLat, dLng, dLat, cleanDest);
        });
      });

      // Try browser HTML5 Geolocation to get actual device location if available
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { longitude, latitude } = pos.coords;
            if (longitude && latitude) {
              updateDriverPosition(longitude, latitude);
              if (destinationCoordsRef.current) {
                planRoute(longitude, latitude, destinationCoordsRef.current.lng, destinationCoordsRef.current.lat, cleanDest);
              }
            }
          },
          (err) => console.log('Geolocation prompt status:', err),
          { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
        );
      }
    });

    return () => {
      stopSpeaking();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.destroy();
      }
    };
  }, [destination, registeredCity]);

  // Sync position updates from driverCoords prop or GPS without random jumps
  useEffect(() => {
    if (driverCoords && typeof driverCoords.lng === 'number' && typeof driverCoords.lat === 'number') {
      setGpsSignalText('卫星信号强');
      updateDriverPosition(driverCoords.lng, driverCoords.lat);
    }
  }, [driverCoords]);

  // Plan driving navigation route helper
  const planRoute = (
    startLng: number,
    startLat: number,
    destLng: number,
    destLat: number,
    destName: string,
    isReroute: boolean = false
  ) => {
    if (isReroute) {
      lastRouteKeyRef.current = '';
    }

    const routeKey = `${startLng.toFixed(4)},${startLat.toFixed(4)}->${destLng.toFixed(4)},${destLat.toFixed(4)}`;
    
    if (!isReroute && lastRouteKeyRef.current === routeKey) {
      return;
    }
    lastRouteKeyRef.current = routeKey;

    const driving = drivingPluginRef.current;
    if (!driving) {
      // BUG-8修复：规划失败不再显示假数字
      setNextInstruction('路线规划失败');
      setNextRoad('请检查网络后重试');
      setRemainingDistance('—');
      setRemainingTime('—');
      showToast('❌ 路线规划失败，请检查网络');
      return;
    }

    driving.search(
      [startLng, startLat],
      [destLng, destLat],
      (status: string, result: any) => {
        if (status === 'complete' && result.routes && result.routes.length > 0) {
          const route = result.routes[0];
          const distMeters = route.distance;
          const timeSecs = route.time;

          const distKm = (distMeters / 1000).toFixed(2);
          const timeMins = Math.ceil(timeSecs / 60);

          setRemainingDistance(`${distKm}公里`);
          setRemainingTime(`${timeMins}分钟`);

          // Calculate total real traffic lights on route from AMap
          const totalLights = typeof route.traffic_lights === 'number'
            ? route.traffic_lights
            : (route.steps && Array.isArray(route.steps)
                ? route.steps.reduce((acc: number, cur: any) => acc + (typeof cur.traffic_lights === 'number' ? cur.traffic_lights : 0), 0)
                : 0);
          setTotalTrafficLights(totalLights);

          if (route.steps && Array.isArray(route.steps)) {
            const allPathPts: Array<[number, number]> = [];
            route.steps.forEach((stepItem: any) => {
              if (stepItem.path && Array.isArray(stepItem.path)) {
                stepItem.path.forEach((pt: any) => {
                  const pLng = typeof pt.getLng === 'function' ? pt.getLng() : (pt.lng ?? pt[0]);
                  const pLat = typeof pt.getLat === 'function' ? pt.getLat() : (pt.lat ?? pt[1]);
                  if (typeof pLng === 'number' && typeof pLat === 'number') {
                    allPathPts.push([pLng, pLat]);
                  }
                });
              }
            });
            activeRoutePathRef.current = allPathPts;
            // 保存steps用于指令推进
            routeStepsRef.current = route.steps;
            currentStepIndexRef.current = 0;
          }

          if (route.steps && route.steps.length > 0) {
            const step = route.steps[0];
            const stepDist = step.distance;
            const roadName = step.road || '前方道路';
            const action = step.action || '进入';

            const formattedStepDist = stepDist >= 1000 ? `${(stepDist / 1000).toFixed(2)}公里` : `${stepDist}米`;
            setNextInstruction(`${formattedStepDist}后 ${action}`);
            setNextRoad(roadName);

            // Determine if the current intersection actually has a real traffic light
            // In residential communities, small alleys (北寺巷, 小区内部), there are NO traffic lights
            const isCommunityOrAlley = /巷|小区|内部|支路|便道|无名|村道|停车场/.test(roadName) || /巷|小区|内部|支路|便道|无名|村道|停车场/.test(step.instruction || '');
            // 红绿灯倒计时已删除（2026-10-10），不再需要判断路口类型

            if (action.includes('左转') || action.includes('左前方') || action.includes('靠左') || action.includes('向左')) setTurnAction('left');
            else if (action.includes('右转') || action.includes('右前方') || action.includes('靠右') || action.includes('向右')) setTurnAction('right');
            else if (action.includes('掉头')) setTurnAction('uturn');
            else setTurnAction('straight');

            const amapNaviText = isReroute
              ? `偏离路线，已重新规划：前方 ${formattedStepDist} 后 ${action} ${roadName}`
              : (step.instruction 
                  ? `高德地图为您导航：${step.instruction}` 
                  : `高德地图开始导航，距离目的地【${destName}】全程 ${distKm} 公里，预计 ${timeMins} 分钟。前方 ${formattedStepDist} 后 ${action} ${roadName}`);

            speakVoice(amapNaviText);
          } else {
            setNextInstruction('沿道路继续行驶');
            setNextRoad(destName);
          }
        } else {
          // BUG-8修复：规划失败不再显示假数字
          setNextInstruction('路线规划失败');
          setNextRoad('请检查网络后重试');
          setRemainingDistance('—');
          setRemainingTime('—');
          showToast('❌ 路线规划失败，请检查网络');
        }
      }
    );
  };

  // Update driver GPS position with stability checks to prevent random position jumps
  const updateDriverPosition = (lng: number, lat: number) => {
    if (!currentDriverPosRef.current) {
      currentDriverPosRef.current = { lng, lat };
    } else {
      const prev = currentDriverPosRef.current;
      // Calculate movement displacement in meters
      const dx = (lng - prev.lng) * 111320 * Math.cos(((lat + prev.lat) / 2) * (Math.PI / 180));
      const dy = (lat - prev.lat) * 110574;
      const distMeters = Math.sqrt(dx * dx + dy * dy);

      // Filter out micro-jitter (< 1.5m) and unrealistic teleports (> 400m)
      if (distMeters < 1.5) return;
      if (distMeters > 400) return;

      // Update bearing angle if moved noticeably (> 2m)
      if (distMeters >= 2) {
        const b = calculateBearing(prev.lat, prev.lng, lat, lng);
        headingAngleRef.current = b;
        updateVehicleMarkerHeading(b);
      }

      currentDriverPosRef.current = { lng, lat };
    }

    // Cache stable position
    localStorage.setItem('dd_bg_driver_coords_lat', lat.toString());
    localStorage.setItem('dd_bg_driver_coords_lng', lng.toString());

    if (driverMarkerRef.current) {
      driverMarkerRef.current.setPosition([lng, lat]);
    }

    if (mapInstanceRef.current && !isOverviewMode) {
      mapInstanceRef.current.setCenter([lng, lat]);
    }

    // Off-route check
    if (destinationCoordsRef.current && activeRoutePathRef.current.length > 1) {
      const now = Date.now();
      if (now - lastRerouteTimestampRef.current < 10000) {
        return;
      }

      const minDistToRoute = getMinDistanceToRoute(lng, lat);
      if (minDistToRoute > 50) {
        offRouteCountRef.current += 1;
        if (offRouteCountRef.current >= 3) {
          offRouteCountRef.current = 0;
          lastRerouteTimestampRef.current = now;
          const dest = destinationCoordsRef.current;
          showToast('🚗 偏离主航路线路，正在为您重新规划路线...');
          planRoute(lng, lat, dest.lng, dest.lat, destination || '目的地', true);
        }
      } else {
        offRouteCountRef.current = 0;
      }
    }

    // BUG-1+2修复：实时更新剩余距离和推进导航指令
    updateRemainingAndInstruction(lng, lat);
  };

  // 根据当前位置计算剩余距离并推进导航指令
  const updateRemainingAndInstruction = (lng: number, lat: number) => {
    const path = activeRoutePathRef.current;
    const steps = routeStepsRef.current;
    if (!path || path.length < 2 || !steps || steps.length === 0) return;

    // 找到路径上距离当前位置最近的点下标
    let minIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < path.length; i++) {
      const dx = (path[i][0] - lng) * 111320 * Math.cos(lat * Math.PI / 180);
      const dy = (path[i][1] - lat) * 110574;
      const d = dx * dx + dy * dy;
      if (d < minDist) { minDist = d; minIdx = i; }
    }

    // 从最近点向后累加剩余距离
    let remainingMeters = 0;
    for (let i = minIdx; i < path.length - 1; i++) {
      const dx = (path[i+1][0] - path[i][0]) * 111320 * Math.cos(path[i][1] * Math.PI / 180);
      const dy = (path[i+1][1] - path[i][1]) * 110574;
      remainingMeters += Math.sqrt(dx * dx + dy * dy);
    }

    // 更新剩余距离显示
    const remainingKm = remainingMeters / 1000;
    setRemainingDistance(remainingKm >= 1 ? `${remainingKm.toFixed(2)}公里` : `${Math.round(remainingMeters)}米`);
    // 时间按 25km/h 市区均速估算
    const remainingMin = Math.max(1, Math.round(remainingMeters / 1000 / 25 * 60));
    setRemainingTime(`${remainingMin}分钟`);

    // 推进导航指令：找到当前最近点所属的 step
    let accPts = 0;
    let stepIdx = 0;
    for (let s = 0; s < steps.length; s++) {
      const stepPathLen = steps[s]?.path?.length || 0;
      if (minIdx < accPts + stepPathLen) { stepIdx = s; break; }
      accPts += stepPathLen;
      stepIdx = s;
    }
    // 只有 step 前进时才更新（避免回退抖动）
    if (stepIdx > currentStepIndexRef.current && stepIdx < steps.length) {
      currentStepIndexRef.current = stepIdx;
      const step = steps[stepIdx];
      const stepDist = Number(step.distance || 0);
      const roadName = step.road || '前方道路';
      const action = step.action || '';
      const formattedStepDist = stepDist >= 1000 ? `${(stepDist / 1000).toFixed(2)}公里` : `${stepDist}米`;
      setNextInstruction(`${formattedStepDist}后 ${action}`);
      setNextRoad(roadName);
      // 更新转向图标
      if (action.includes('左转') || action.includes('左前方') || action.includes('靠左') || action.includes('向左')) setTurnAction('left');
      else if (action.includes('右转') || action.includes('右前方') || action.includes('靠右') || action.includes('向右')) setTurnAction('right');
      else if (action.includes('掉头')) setTurnAction('uturn');
      else setTurnAction('straight');
      // 语音播报新指令
      try { speakText(`${formattedStepDist}后 ${action}，${roadName}`); } catch (_) {}
    }

    // BUG-10：到达判定（距终点 <50m）
    const destCoords = destinationCoordsRef.current;
    if (destCoords) {
      const dx = (destCoords.lng - lng) * 111320 * Math.cos(lat * Math.PI / 180);
      const dy = (destCoords.lat - lat) * 110574;
      const distToDest = Math.sqrt(dx * dx + dy * dy);
      if (distToDest < 50 && !arrivedAnnouncedRef.current) {
        arrivedAnnouncedRef.current = true;
        try { speakText('已到达目的地附近，本次导航结束'); } catch (_) {}
        showToast('🎉 已到达目的地附近');
      }
    }
  };

  const handleExit = () => {
    stopSpeaking();
    onClose();
  };

  return (
    <div className="absolute inset-0 z-[100] bg-black flex flex-col font-sans select-none overflow-hidden">
      
      {/* Toast Alert */}
      {toastMsg && (
        <div className="absolute top-[calc(max(env(safe-area-inset-top,0px),28px)+68px)] left-1/2 -translate-x-1/2 z-[110] bg-slate-900/95 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-2xl backdrop-blur-md animate-in fade-in zoom-in border border-slate-700">
          {toastMsg}
        </div>
      )}

      {/* TOP DARK HUD PANEL (Adapted to Android status bar: time, battery, signal without obstruction) */}
      <div className="relative z-20 bg-[#161d2b] text-white px-4 header-safe-pt pb-3 shadow-2xl border-b border-slate-800/80 shrink-0">
        
        {/* Header Top Sub-Bar: Satellite Signal & HUD exit */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-bold">
            <Wifi className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
            <span>{gpsSignalText}</span>
          </div>

          <button
            onClick={handleExit}
            className="bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-white px-3 py-1 rounded-full text-xs font-bold border border-white/10 flex items-center gap-1"
          >
            <span>退出</span>
          </button>
        </div>

        {/* Main Turn Direction & Next Maneuver Info with Gaode Real-time Traffic Light */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {turnAction === 'right' ? (
              <svg className="w-13 h-13 text-white shrink-0 drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M10 19V9a2 2 0 012-2h7M15 3l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" />
              </svg>
            ) : turnAction === 'straight' ? (
              <svg className="w-13 h-13 text-white shrink-0 drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" />
              </svg>
            ) : turnAction === 'uturn' ? (
              <svg className="w-13 h-13 text-white shrink-0 drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M18 19v-9a6 6 0 00-12 0v9M9 16l-3 3-3-3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" />
              </svg>
            ) : (
              <svg className="w-14 h-14 text-white shrink-0 drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M14 19V9a2 2 0 00-2-2H5M9 3L5 7l4 4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.8" />
              </svg>
            )}

            <div className="flex-1 text-left overflow-hidden min-w-0">
              <div className="text-2xl font-black tracking-tight text-white flex items-baseline gap-1.5 truncate">
                <span>{nextInstruction}</span>
              </div>
              <div className="text-base font-bold text-slate-300 mt-0.5 truncate">
                {nextRoad}
              </div>
              <div className="text-xs text-slate-400 mt-1 font-semibold flex items-center gap-1.5 flex-wrap">
                <span>剩余 {remainingDistance}</span>
                <span>•</span>
                <span>{remainingTime}</span>
                {totalTrafficLights > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-slate-300 font-medium">全程{totalTrafficLights}个红绿灯</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 红绿灯倒计时已删除（2026-10-10）：此前为本地固定周期假数据，与真实信号灯无关，有误导闯红灯风险 */}
        </div>
      </div>

      {/* MAP CANVAS CONTAINER */}
      <div className="relative flex-1 w-full h-full overflow-hidden">
        <div ref={mapContainerRef} className="w-full h-full bg-slate-100" />

        {/* TOP RIGHT FLOATING "🚦 路况" BUTTON (Matching q7.png) */}
        <div className="absolute top-4 right-4 z-20">
          <button
            onClick={() => {
              showToast('已更新高德实时路况信息');
            }}
            className="bg-white/95 text-slate-800 px-3 py-1.5 rounded-xl shadow-lg border border-slate-200/80 flex items-center gap-1.5 font-bold text-xs active:scale-95 transition-transform"
          >
            <div className="flex items-center gap-0.5">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            </div>
            <span className="text-slate-800 text-xs font-bold">路况</span>
          </button>
        </div>

        {/* RIGHT MIDDLE FLOATING CONTROLS: ↻, +, - (Matching q7.png) */}
        <div className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+74px)] right-4 z-20 flex flex-col items-center gap-2">
          {/* Recalculate / Refresh Route Button ↻ */}
          <button
            onClick={() => {
              if (mapInstanceRef.current && currentDriverPosRef.current && destinationCoordsRef.current) {
                planRoute(
                  currentDriverPosRef.current.lng,
                  currentDriverPosRef.current.lat,
                  destinationCoordsRef.current.lng,
                  destinationCoordsRef.current.lat,
                  destination || '目的地',
                  true
                );
                showToast('正在为您重新规划最优路线...');
              }
            }}
            className="w-11 h-11 bg-white rounded-2xl shadow-xl border border-slate-200 flex items-center justify-center text-slate-800 active:scale-95 transition-transform"
          >
            <RotateCcw className="w-5 h-5 text-slate-700" />
          </button>

          {/* Zoom In Button + */}
          <button
            onClick={() => {
              if (mapInstanceRef.current) {
                mapInstanceRef.current.zoomIn();
              }
            }}
            className="w-11 h-11 bg-white rounded-t-2xl shadow-xl border border-slate-200 flex items-center justify-center text-slate-800 text-2xl font-light active:scale-95 transition-transform border-b-0"
          >
            +
          </button>

          {/* Zoom Out Button - */}
          <button
            onClick={() => {
              if (mapInstanceRef.current) {
                mapInstanceRef.current.zoomOut();
              }
            }}
            className="w-11 h-11 bg-white rounded-b-2xl shadow-xl border border-slate-200 flex items-center justify-center text-slate-800 text-2xl font-light active:scale-95 transition-transform"
          >
            -
          </button>
        </div>

        {/* BOTTOM CENTER FLOATING MILEAGE & FEE BADGE (Synced live with trip) */}
        <div className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+58px)] left-1/2 -translate-x-1/2 z-20">
          <div className="bg-black/95 text-white px-5 py-2.5 rounded-2xl shadow-2xl border border-slate-800 flex flex-col items-center justify-center">
            <div className="flex items-center gap-6 text-[11px] font-medium text-slate-400">
              <span>里程</span>
              <span>费用</span>
            </div>
            <div className="flex items-center gap-4 text-base font-black font-mono tracking-wide text-white mt-0.5">
              <span>{(currentDistance || 0).toFixed(2)}</span>
              <span>{(calculatedTotalFee || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* BOTTOM LEFT MAP SCALE INDICATOR (Dynamically synchronized with zoom level) */}
        <div className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+58px)] left-4 z-20 flex flex-col items-start select-none">
          <div className="text-[10px] font-bold text-slate-700 mb-0.5 ml-0.5">{scaleText}</div>
          <div 
            style={{ width: `${scaleBarWidth}px` }} 
            className="h-1 bg-slate-800 rounded-sm border-x border-slate-900 transition-all duration-150 ease-out"
          />
          <div className="text-[10px] font-bold text-blue-600 mt-1 flex items-center gap-0.5">
            <svg className="w-3 h-3 text-blue-600 fill-current" viewBox="0 0 24 24">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
            <span>高德地图</span>
          </div>
        </div>

        {/* BOTTOM ACTION BAR ("退出 | 路线全览 / 恢复导航(25m)") (Adapted to Android bottom navigation bar / gesture bar) */}
        <div 
          className="absolute bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 px-6 pt-3 shadow-2xl flex items-center justify-between android-nav-safe-pb"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 18px)' }}
        >
          <button
            onClick={handleExit}
            className="text-slate-800 font-bold text-base hover:text-slate-900 px-3 py-1 active:scale-95 transition-transform"
          >
            退出
          </button>

          <button
            onClick={toggleOverviewMode}
            className="text-[#00a28f] font-extrabold text-lg tracking-wide hover:opacity-90 active:scale-95 transition-transform flex items-center gap-1.5"
          >
            {isOverviewMode ? (
              <>
                <Navigation className="w-5 h-5 text-[#00a28f] fill-current" />
                <span>恢复导航 (25m)</span>
              </>
            ) : (
              <>
                <Map className="w-5 h-5 text-[#00a28f]" />
                <span>路线全览</span>
              </>
            )}
          </button>
        </div>

      </div>

    </div>
  );
}
