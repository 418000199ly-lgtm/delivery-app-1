import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Trash2, 
  Check, 
  ArrowLeft, 
  Clock, 
  Coins, 
  Navigation, 
  PlusCircle, 
  MinusCircle, 
  Settings, 
  Info, 
  CheckCircle2, 
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { db, doc, onSnapshot, setDoc } from '../lib/dbProxy';
import { BillingRules, TimeSlot, DEFAULT_BILLING_RULES } from '../types';

interface AdminBillingRulesProps {
  onShowToast: (msg: string) => void;
}

// Preset options matching MileageModeView
const START_TIME_OPTIONS = [
  '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'
];

const END_TIME_OPTIONS = [
  '00:59', '01:59', '02:59', '03:59', '04:59', '05:59', '06:59', '07:59', '08:59', '09:59', '10:59', '11:59', '12:59', '13:59', '14:59', '15:59', '16:59', '17:59', '18:59', '19:59', '20:59', '21:59', '22:59', '23:59'
];

// Default Yinchuan city polygon vertices matching the visual road boundary precisely
const DEFAULT_YINCHUAN_COORDS = [
  // Fence 2 (North Boundary, from West to East)
  { lat: 38.522192, lng: 106.113327 },
  { lat: 38.523355, lng: 106.113322 },
  { lat: 38.53101, lng: 106.1133 },
  { lat: 38.531509, lng: 106.113252 },
  { lat: 38.531539, lng: 106.116058 },
  { lat: 38.531564, lng: 106.119507 },
  { lat: 38.531775, lng: 106.130433 },
  { lat: 38.531843, lng: 106.14305 },
  { lat: 38.531826, lng: 106.154594 },
  { lat: 38.531809, lng: 106.16352 },
  { lat: 38.531792, lng: 106.165473 },
  { lat: 38.531272, lng: 106.169593 },
  { lat: 38.530466, lng: 106.175322 },
  { lat: 38.529039, lng: 106.181931 },
  { lat: 38.527663, lng: 106.188969 },
  { lat: 38.526589, lng: 106.196994 },
  { lat: 38.526018, lng: 106.202316 },
  { lat: 38.5259, lng: 106.20547 },
  { lat: 38.525951, lng: 106.206586 },
  { lat: 38.52627, lng: 106.209161 },
  { lat: 38.528133, lng: 106.223473 },
  { lat: 38.529627, lng: 106.234438 },
  { lat: 38.530047, lng: 106.23785 },
  { lat: 38.530399, lng: 106.242635 },
  { lat: 38.530718, lng: 106.252505 },
  { lat: 38.531138, lng: 106.265401 },
  { lat: 38.531389, lng: 106.277868 },
  { lat: 38.531473, lng: 106.280829 },
  { lat: 38.531356, lng: 106.284284 },
  { lat: 38.531205, lng: 106.286988 },
  { lat: 38.530735, lng: 106.291344 },
  { lat: 38.5306, lng: 106.29291 },
  { lat: 38.529207, lng: 106.300528 },
  { lat: 38.52627, lng: 106.316578 },
  { lat: 38.525262, lng: 106.31999 },
  { lat: 38.524423, lng: 106.323187 },
  { lat: 38.523517, lng: 106.324732 },
  { lat: 38.522257, lng: 106.325869 },

  // Fence 1 (East, South, and West Boundaries, clockwise to close)
  { lat: 38.523245, lng: 106.324648 },
  { lat: 38.522053, lng: 106.325935 },
  { lat: 38.520643, lng: 106.327609 },
  { lat: 38.520223, lng: 106.328918 },
  { lat: 38.520207, lng: 106.330785 },
  { lat: 38.520979, lng: 106.333725 },
  { lat: 38.52113, lng: 106.336428 },
  { lat: 38.521231, lng: 106.337437 },
  { lat: 38.515338, lng: 106.337458 },
  { lat: 38.5125, lng: 106.337136 },
  { lat: 38.494656, lng: 106.335976 },
  { lat: 38.48494, lng: 106.335351 },
  { lat: 38.480237, lng: 106.33578 },
  { lat: 38.471771, lng: 106.337496 },
  { lat: 38.466344, lng: 106.33887 },
  { lat: 38.462917, lng: 106.339556 },
  { lat: 38.458179, lng: 106.339986 },
  { lat: 38.45334, lng: 106.339642 },
  { lat: 38.445576, lng: 106.338097 },
  { lat: 38.441979, lng: 106.336681 },
  { lat: 38.437004, lng: 106.334235 },
  { lat: 38.432164, lng: 106.331188 },
  { lat: 38.42628, lng: 106.327326 },
  { lat: 38.420565, lng: 106.322047 },
  { lat: 38.411755, lng: 106.312606 },
  { lat: 38.401128, lng: 106.300847 },
  { lat: 38.398833, lng: 106.298315 },
  { lat: 38.397505, lng: 106.297156 },
  { lat: 38.398934, lng: 106.295525 },
  { lat: 38.399825, lng: 106.293637 },
  { lat: 38.402886, lng: 106.28602 },
  { lat: 38.404399, lng: 106.280891 },
  { lat: 38.40566, lng: 106.274711 },
  { lat: 38.406316, lng: 106.269604 },
  { lat: 38.406501, lng: 106.265291 },
  { lat: 38.406669, lng: 106.260142 },
  { lat: 38.406804, lng: 106.256515 },
  { lat: 38.406888, lng: 106.253297 },
  { lat: 38.407291, lng: 106.248233 },
  { lat: 38.407863, lng: 106.243576 },
  { lat: 38.40862, lng: 106.239821 },
  { lat: 38.410066, lng: 106.23377 },
  { lat: 38.412235, lng: 106.227397 },
  { lat: 38.414622, lng: 106.221089 },
  { lat: 38.415833, lng: 106.217891 },
  { lat: 38.417362, lng: 106.213664 },
  { lat: 38.418959, lng: 106.20845 },
  { lat: 38.420136, lng: 106.204116 },
  { lat: 38.421632, lng: 106.197442 },
  { lat: 38.42365, lng: 106.188795 },
  { lat: 38.42491, lng: 106.183302 },
  { lat: 38.425919, lng: 106.178537 },
  { lat: 38.427701, lng: 106.172829 },
  { lat: 38.4306, lng: 106.1649 },
  { lat: 38.432256, lng: 106.161091 },
  { lat: 38.433836, lng: 106.157669 },
  { lat: 38.434929, lng: 106.155126 },
  { lat: 38.435904, lng: 106.152712 },
  { lat: 38.43666, lng: 106.150556 },
  { lat: 38.437493, lng: 106.147841 },
  { lat: 38.438165, lng: 106.145245 },
  { lat: 38.438661, lng: 106.143121 },
  { lat: 38.438964, lng: 106.141576 },
  { lat: 38.4393, lng: 106.139741 },
  { lat: 38.439577, lng: 106.137842 },
  { lat: 38.439888, lng: 106.135213 },
  { lat: 38.440207, lng: 106.124613 },
  { lat: 38.440191, lng: 106.119807 },
  { lat: 38.440315, lng: 106.113485 },
  { lat: 38.442954, lng: 106.113485 },
  { lat: 38.454698, lng: 106.113359 },
  { lat: 38.467451, lng: 106.113359 },
  { lat: 38.492001, lng: 106.113302 },
  { lat: 38.501087, lng: 106.113323 },
  { lat: 38.507501, lng: 106.113302 },
  { lat: 38.512257, lng: 106.113321 },
  { lat: 38.513643, lng: 106.113307 },
  { lat: 38.515805, lng: 106.113307 },
  { lat: 38.51732, lng: 106.113323 },
  { lat: 38.519624, lng: 106.113307 },
  { lat: 38.522205, lng: 106.113318 }
];

// Gaode Map Draw Polygon Sub-Component
function FenceDrawingMap({
  apiKey,
  coords,
  onChange,
  onShowToast
}: {
  apiKey: string;
  coords: { lat: number; lng: number }[];
  onChange: (newCoords: { lat: number; lng: number }[]) => void;
  onShowToast: (msg: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drawing states
  const [drawMode, setDrawMode] = useState<'pan' | 'polygon' | 'rectangle' | 'circle'>('pan');
  const [tempCoords, setTempCoords] = useState<{ lat: number; lng: number }[]>([]);
  const [mouseHoverCoord, setMouseHoverCoord] = useState<{ lat: number; lng: number } | null>(null);

  // Keep track of Gaode Map overlays using refs
  const finalPolygonRef = useRef<any>(null);
  const finalMarkersRef = useRef<any[]>([]);

  const tempPolygonRef = useRef<any>(null);
  const tempPolylineRef = useRef<any>(null);
  const tempMarkersRef = useRef<any[]>([]);

  // Keep function refs updated to avoid stale closure issues
  const handleAddPointRef = useRef<any>(null);
  const handleUndoRef = useRef<any>(null);
  const handleFinishRef = useRef<any>(null);

  // Safe coordinates: filter out invalid entries to prevent any crash
  const safeCoords = Array.isArray(coords)
    ? coords.filter(c => c && typeof c.lat === 'number' && typeof c.lng === 'number')
    : [];

  // Load Gaode Map Script
  useEffect(() => {
    let active = true;
    const scriptId = 'amap-script-drawing';
    let script = (document.getElementById('amap-script') || document.getElementById(scriptId)) as HTMLScriptElement | null;

    const initMap = () => {
      if (!active || !containerRef.current) return;
      try {
        const AMap = (window as any).AMap;
        if (AMap) {
          const map = new AMap.Map(containerRef.current, {
            center: [106.230912, 38.487193], // Yinchuan center
            zoom: 11,
            viewMode: '2D',
            resizeEnable: true
          });
          mapRef.current = map;

          // Event Listeners
          map.on('click', (e: any) => {
            const lng = e.lnglat.getLng();
            const lat = e.lnglat.getLat();
            if (handleAddPointRef.current) {
              handleAddPointRef.current(lat, lng);
            }
          });

          map.on('mousemove', (e: any) => {
            if (drawModeRef.current === 'pan') return;
            const lng = e.lnglat.getLng();
            const lat = e.lnglat.getLat();
            setMouseHoverCoord({ lat, lng });
          });

          map.on('rightclick', (e: any) => {
            if (drawModeRef.current !== 'pan') {
              if (handleUndoRef.current) {
                handleUndoRef.current();
              }
            }
          });

          map.on('dblclick', (e: any) => {
            if (drawModeRef.current === 'polygon') {
              if (tempCoordsRef.current.length >= 2) {
                const lng = e.lnglat.getLng();
                const lat = e.lnglat.getLat();
                const last = tempCoordsRef.current[tempCoordsRef.current.length - 1];
                if (Math.abs(last.lat - lat) > 0.0001 || Math.abs(last.lng - lng) > 0.0001) {
                  const final = [...tempCoordsRef.current, { lat, lng }];
                  if (handleFinishRef.current) {
                    handleFinishRef.current(final);
                  }
                  onShowToast('✅ 区域绘制已自动闭合');
                } else {
                  if (handleFinishRef.current) {
                    handleFinishRef.current();
                  }
                  onShowToast('✅ 区域绘制已自动闭合');
                }
              } else {
                onShowToast('⚠️ 绘制多边形至少需要 3 个顶点！');
              }
            }
          });

          setLoading(false);
        } else {
          setError('AMap library missing on window');
          setLoading(false);
        }
      } catch (err: any) {
        console.error('Error initializing AMap:', err);
        setError(err.message || 'Error initializing map');
        setLoading(false);
      }
    };

    if ((window as any).AMap) {
      initMap();
    } else {
      if (!script) {
        script = document.createElement('script');
        script.id = scriptId;
        script.src = 'https://webapi.amap.com/maps?v=2.0&key=4143e567d55bbc1855231f9637efd6b0';
        script.async = true;
        script.defer = true;
        script.onload = () => {
          setTimeout(() => {
            if ((window as any).AMap) initMap();
          }, 200);
        };
        script.onerror = () => {
          setLoading(false);
          setError('高德地图脚本加载失败');
        };
        document.head.appendChild(script);
      } else {
        const checkInterval = setInterval(() => {
          if ((window as any).AMap) {
            clearInterval(checkInterval);
            initMap();
          }
        }, 150);
        setTimeout(() => clearInterval(checkInterval), 5000);
      }
    }

    return () => {
      active = false;
    };
  }, []);

  // Keep references to prevent stale closures in event handlers
  const coordsRef = useRef(safeCoords);
  const onChangeRef = useRef(onChange);
  const drawModeRef = useRef(drawMode);
  const tempCoordsRef = useRef(tempCoords);
  const mouseHoverCoordRef = useRef(mouseHoverCoord);

  useEffect(() => {
    coordsRef.current = safeCoords;
    onChangeRef.current = onChange;
    drawModeRef.current = drawMode;
    tempCoordsRef.current = tempCoords;
    mouseHoverCoordRef.current = mouseHoverCoord;
  }, [safeCoords, onChange, drawMode, tempCoords, mouseHoverCoord]);

  // Handle addition of coordinate points depending on current drawMode
  const handleAddPoint = (lat: number, lng: number) => {
    const currentMode = drawModeRef.current;
    if (currentMode === 'pan') return;

    if (currentMode === 'polygon') {
      const next = [...tempCoordsRef.current, { lat, lng }];
      setTempCoords(next);
      onShowToast(`📍 已添加第 ${next.length} 个顶点`);
    } else if (currentMode === 'rectangle') {
      if (tempCoordsRef.current.length === 0) {
        setTempCoords([{ lat, lng }]);
        onShowToast('📐 已确定矩形起点，请移动鼠标并点击确定终点');
      } else {
        const start = tempCoordsRef.current[0];
        const rectPoints = [
          { lat: start.lat, lng: start.lng },
          { lat: start.lat, lng: lng },
          { lat: lat, lng: lng },
          { lat: lat, lng: start.lng }
        ];
        handleFinish(rectPoints);
        onShowToast('✅ 矩形范围已保存');
      }
    } else if (currentMode === 'circle') {
      if (tempCoordsRef.current.length === 0) {
        setTempCoords([{ lat, lng }]);
        onShowToast('🎯 已确定圆形中心，请移动鼠标并点击确定半径');
      } else {
        const center = tempCoordsRef.current[0];
        const dLat = lat - center.lat;
        const dLng = lng - center.lng;
        const r = Math.sqrt(dLat * dLat + dLng * dLng);
        const circlePoints = [];
        for (let i = 0; i < 36; i++) {
          const angle = (i * 360 / 36) * (Math.PI / 180);
          const cLat = center.lat + r * Math.sin(angle);
          const cLng = center.lng + (r * Math.cos(angle)) / Math.cos(center.lat * Math.PI / 180);
          circlePoints.push({ lat: cLat, lng: cLng });
        }
        handleFinish(circlePoints);
        onShowToast('✅ 圆形范围已保存');
      }
    }
  };

  const handleUndo = () => {
    if (tempCoordsRef.current.length > 0) {
      const next = tempCoordsRef.current.slice(0, -1);
      setTempCoords(next);
      onShowToast('↩️ 已撤销上个绘制点');
    }
  };

  const handleCancel = () => {
    setTempCoords([]);
    setMouseHoverCoord(null);
    setDrawMode('pan');
    onShowToast('❌ 已中断并清空当前绘制');
  };

  const handleFinish = (finalCoords?: { lat: number; lng: number }[]) => {
    const coordsToSave = finalCoords || tempCoordsRef.current;
    if (coordsToSave.length >= 3) {
      onChangeRef.current(coordsToSave);
      setTempCoords([]);
      setMouseHoverCoord(null);
      setDrawMode('pan');
    } else if (!finalCoords) {
      onShowToast('⚠️ 绘制多边形至少需要 3 个顶点才能闭合！');
    }
  };

  useEffect(() => {
    handleAddPointRef.current = handleAddPoint;
    handleUndoRef.current = handleUndo;
    handleFinishRef.current = handleFinish;
  });

  // Disable Double-click zoom on map during drawing mode to prevent zoom behavior
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      if (drawMode !== 'pan') {
        map.setStatus({ doubleClickZoom: false });
      } else {
        map.setStatus({ doubleClickZoom: true });
      }
    } catch (err) {
      console.error('Error toggling map doubleClickZoom option:', err);
    }
  }, [drawMode]);

  // Keyboard events for global interrupt (Esc) and Undo (Ctrl+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (drawModeRef.current === 'pan') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }

      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Sync coords array to final markers and polygon on Gaode Map
  useEffect(() => {
    const map = mapRef.current;
    const AMap = (window as any).AMap;
    if (!map || !AMap || loading) return;

    try {
      // 1. Clear old final overlays
      if (finalPolygonRef.current) {
        finalPolygonRef.current.setMap(null);
        finalPolygonRef.current = null;
      }
      finalMarkersRef.current.forEach(m => m.setMap(null));
      finalMarkersRef.current = [];

      // 2. Draw final polygon if >= 3 vertices
      if (safeCoords.length >= 3) {
        const path = safeCoords.map(c => [c.lng, c.lat]);
        finalPolygonRef.current = new AMap.Polygon({
          path,
          strokeColor: '#14b8a6',
          strokeOpacity: 0.85,
          strokeWeight: 3,
          fillColor: '#14b8a6',
          fillOpacity: 0.22,
          map: map
        });
      }

      // 3. Draw final markers for each vertex (Disabled to keep the map fence display clean and free of marker clutter)
      /*
      if (safeCoords.length > 0) {
        finalMarkersRef.current = safeCoords.map((c) => {
          return new AMap.Marker({
            position: [c.lng, c.lat],
            offset: new AMap.Pixel(-10, -26), // Anchor bottom-center
            icon: new AMap.Icon({
              size: new AMap.Size(20, 26),
              image: 'https://mapapi.qq.com/web/lbs/javascriptGL/demo/img/marker_blue.png',
              imageSize: new AMap.Size(20, 26)
            }),
            map: map
          });
        });
      }
      */
    } catch (err) {
      console.error('Error rendering AMap final overlays:', err);
    }
  }, [safeCoords, loading]);

  // Sync drawing preview layers live on the map
  useEffect(() => {
    const map = mapRef.current;
    const AMap = (window as any).AMap;
    if (!map || !AMap || loading) return;

    try {
      // Clear old temp overlays
      if (tempPolygonRef.current) {
        tempPolygonRef.current.setMap(null);
        tempPolygonRef.current = null;
      }
      if (tempPolylineRef.current) {
        tempPolylineRef.current.setMap(null);
        tempPolylineRef.current = null;
      }
      tempMarkersRef.current.forEach(m => m.setMap(null));
      tempMarkersRef.current = [];

      if (drawMode === 'pan') return;

      // 1. Draw markers for currently clicked temporary points
      if (tempCoords.length > 0) {
        tempMarkersRef.current = tempCoords.map((c) => {
          return new AMap.Marker({
            position: [c.lng, c.lat],
            offset: new AMap.Pixel(-6, -6),
            icon: new AMap.Icon({
              size: new AMap.Size(12, 12),
              image: 'https://mapapi.qq.com/web/lbs/javascriptGL/demo/img/marker_red.png',
              imageSize: new AMap.Size(12, 12)
            }),
            map: map
          });
        });
      }

      // 2. Draw lines and fill based on drawMode
      if (drawMode === 'polygon') {
        const linePoints = [...tempCoords];
        if (mouseHoverCoord) {
          linePoints.push(mouseHoverCoord);
        }

        if (linePoints.length >= 2) {
          const path = linePoints.map(c => [c.lng, c.lat]);
          tempPolylineRef.current = new AMap.Polyline({
            path,
            strokeColor: '#ef4444',
            strokeOpacity: 0.8,
            strokeWeight: 3,
            strokeStyle: 'dashed',
            strokeDasharray: [10, 5],
            map: map
          });

          if (linePoints.length >= 3) {
            tempPolygonRef.current = new AMap.Polygon({
              path,
              strokeColor: '#ef4444',
              strokeOpacity: 0.1,
              strokeWeight: 1,
              fillColor: '#ef4444',
              fillOpacity: 0.15,
              map: map
            });
          }
        }
      } else if (drawMode === 'rectangle') {
        if (tempCoords.length === 1 && mouseHoverCoord) {
          const start = tempCoords[0];
          const rectPath = [
            [start.lng, start.lat],
            [mouseHoverCoord.lng, start.lat],
            [mouseHoverCoord.lng, mouseHoverCoord.lat],
            [start.lng, mouseHoverCoord.lat]
          ];

          tempPolygonRef.current = new AMap.Polygon({
            path: rectPath,
            strokeColor: '#3b82f6',
            strokeOpacity: 0.85,
            strokeWeight: 2,
            fillColor: '#3b82f6',
            fillOpacity: 0.18,
            map: map
          });
        }
      } else if (drawMode === 'circle') {
        if (tempCoords.length === 1 && mouseHoverCoord) {
          const center = tempCoords[0];
          const dLat = mouseHoverCoord.lat - center.lat;
          const dLng = mouseHoverCoord.lng - center.lng;
          const r = Math.sqrt(dLat * dLat + dLng * dLng);

          const circlePath = [];
          for (let i = 0; i < 36; i++) {
            const angle = (i * 360 / 36) * (Math.PI / 180);
            const cLat = center.lat + r * Math.sin(angle);
            const cLng = center.lng + (r * Math.cos(angle)) / Math.cos(center.lat * Math.PI / 180);
            circlePath.push([cLng, cLat]);
          }

          tempPolygonRef.current = new AMap.Polygon({
            path: circlePath,
            strokeColor: '#a855f7',
            strokeOpacity: 0.85,
            strokeWeight: 2,
            fillColor: '#a855f7',
            fillOpacity: 0.18,
            map: map
          });
        }
      }
    } catch (err) {
      console.error('Error rendering temporary AMap drawing layers:', err);
    }
  }, [tempCoords, mouseHoverCoord, drawMode, loading]);

  // Clean up layers on unmount
  useEffect(() => {
    return () => {
      if (finalPolygonRef.current) finalPolygonRef.current.setMap(null);
      finalMarkersRef.current.forEach(m => m.setMap(null));
      if (tempPolygonRef.current) tempPolygonRef.current.setMap(null);
      if (tempPolylineRef.current) tempPolylineRef.current.setMap(null);
      tempMarkersRef.current.forEach(m => m.setMap(null));
    };
  }, []);

  return (
    <div className="relative w-full h-[380px] sm:h-[450px] bg-slate-950 rounded-2xl overflow-hidden border border-slate-800">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 z-20 space-y-3">
          <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-slate-400 font-bold">高德地图加载中...</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 z-20 p-6 text-center space-y-3">
          <span className="text-sm text-rose-500 font-black">⚠️ 地图加载失败</span>
          <span className="text-xs text-slate-500">{error}</span>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />

      {/* Interactive Drawing Toolbar Overlay */}
      {!loading && !error && (
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
          <div className="flex bg-slate-900/90 backdrop-blur-md border border-slate-700/80 p-1.5 rounded-xl shadow-2xl items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setDrawMode('pan');
                setTempCoords([]);
                setMouseHoverCoord(null);
                onShowToast('✋ 已切换为地图平移拖拽模式');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                drawMode === 'pan'
                  ? 'bg-slate-800 text-teal-400 border border-teal-500/30 shadow-inner'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span>✋ 拖拽模式</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDrawMode('polygon');
                setTempCoords([]);
                setMouseHoverCoord(null);
                onShowToast('⬡ 开启多边形绘制：鼠标左键点击打点，双击最后一点完成');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                drawMode === 'polygon'
                  ? 'bg-teal-500/10 text-teal-400 border border-teal-500/45 shadow-inner'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span>⬡ 多边形</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDrawMode('rectangle');
                setTempCoords([]);
                setMouseHoverCoord(null);
                onShowToast('▭ 开启矩形绘制：左键点击起点，再次点击对角终点完成');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                drawMode === 'rectangle'
                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/45 shadow-inner'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span>▭ 矩形</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDrawMode('circle');
                setTempCoords([]);
                setMouseHoverCoord(null);
                onShowToast('◯ 开启圆形绘制：左键点击圆心点，再次点击圆周点完成');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                drawMode === 'circle'
                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/45 shadow-inner'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span>◯ 圆形</span>
            </button>
          </div>

          {/* Guide Banner for active drawMode */}
          {drawMode !== 'pan' && (
            <div className="bg-slate-950/95 backdrop-blur-md border border-slate-800 px-3 py-2 rounded-xl flex flex-col gap-1 shadow-2xl animate-fade-in max-w-sm sm:max-w-md">
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                <span className="text-slate-200">
                  {drawMode === 'polygon' && '⬡ 正在绘制多边形...'}
                  {drawMode === 'rectangle' && '▭ 正在绘制矩形...'}
                  {drawMode === 'circle' && '◯ 正在绘制圆形...'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 leading-relaxed font-sans">
                {drawMode === 'polygon' && (
                  <span>
                    鼠标左键依次点击打点放置顶点。双击以闭合并保存。<strong className="text-rose-400">鼠标右键 / Ctrl+Z</strong> 撤销上一个点，<strong className="text-amber-400">ESC</strong> 键中断。
                  </span>
                )}
                {drawMode === 'rectangle' && (
                  <span>
                    {tempCoords.length === 0 ? '在地图上单击鼠标左键确定矩形起点' : '移动鼠标，单击另一点确定对角线终点以完成'}。可按 <strong className="text-amber-400">ESC</strong> 键中断。
                  </span>
                )}
                {drawMode === 'circle' && (
                  <span>
                    {tempCoords.length === 0 ? '在地图上单击鼠标左键确定圆心位置' : '移动鼠标，单击另一点确定半径大小以完成'}。可按 <strong className="text-amber-400">ESC</strong> 键中断。
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export default function AdminBillingRules({ onShowToast }: AdminBillingRulesProps) {
  // Global Firestore State
  const [activeTemplateName, setActiveTemplateName] = useState<string>('线上二维码开单');
  const [templates, setTemplates] = useState<BillingRules[]>([]);
  const [loading, setLoading] = useState(true);

  // New billing mode configurations
  const [activeBillingMode, setActiveBillingMode] = useState<'system_default' | 'time_based'>('system_default');
  const [timeBasedConfig, setTimeBasedConfig] = useState({
    fenceName: '黑湾代驾银川城区',
    beforeMidnightHourPrice: 28,
    afterMidnightHourPrice: 35,
    overtimePricePerMin: 1,
    outOfBoundsPricePerKm: 5,
    freeWaitTimeMins: 10,
    overtimeWaitPricePerMin: 1,
    polygonCoords: DEFAULT_YINCHUAN_COORDS as { lat: number; lng: number }[],
    // Legacy support keys to avoid compilation problems elsewhere
    baseMinutes: 60,
    basePrice: 28,
    overtimeInterval: 1,
    overtimePrice: 1,
    nightStart: '00:00',
    nightEnd: '06:00',
    nightExtraPrice: 7,
    outOfBoundsKm: 15,
    outOfBoundsPrice: 5
  });
  const [selectedSettingPanel, setSelectedSettingPanel] = useState<'system_default' | 'time_based' | null>(null);
  const [showRulesList, setShowRulesList] = useState(false);

  // Time-based simulator states
  const [simDuration, setSimDuration] = useState<number>(60);
  const [simIsNight, setSimIsNight] = useState<boolean>(false);
  const [simExtraKm, setSimExtraKm] = useState<number>(0);

  // Editing workspace states
  const [editingTemplate, setEditingTemplate] = useState<BillingRules | null>(null);
  const [editName, setEditName] = useState('');
  const [editSlots, setEditSlots] = useState<TimeSlot[]>([]);
  const [editReturnStartKm, setEditReturnStartKm] = useState(15);
  const [editReturnPerKm, setEditReturnPerKm] = useState(2);
  const [editReturnIntervalKm, setEditReturnIntervalKm] = useState(1);
  const [editReturnIncrease, setEditReturnIncrease] = useState(2);
  const [editFreeWaitingTime, setEditFreeWaitingTime] = useState(15);
  const [editWaitingPerMin, setEditWaitingPerMin] = useState(1);
  const [editWaitingInterval, setEditWaitingInterval] = useState(1);
  const [editWaitingIncrease, setEditWaitingIncrease] = useState(1);

  // New Template modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Selected template menu drawer (mobile style option sheet)
  const [activeMenuTemplate, setActiveMenuTemplate] = useState<BillingRules | null>(null);

  // Custom pricing image style screen state
  const [showCustomPricingImageScreen, setShowCustomPricingImageScreen] = useState(false);

  // Helper to activate night high template
  const handleActivateCustomNightTemplate = async () => {
    const nightTemplate = templates.find(t => t.templateName === '夜间高额线上加价模版');
    if (nightTemplate) {
      await handleSetActiveTemplate(nightTemplate);
      setShowCustomPricingImageScreen(false);
    } else {
      onShowToast('⚠️ 未找到夜间高额线上加价模版');
    }
  };

  // Fetch online billing configurations on mount
  useEffect(() => {
    const configDocRef = doc(db, 'config', 'online_billing_rules');
    const unsubscribe = onSnapshot(configDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setActiveTemplateName(data.activeTemplateName || '线上二维码开单');
        setTemplates(data.templates || []);
        setActiveBillingMode(data.activeBillingMode || 'system_default');
        if (data.timeBasedConfig) {
          setTimeBasedConfig(prev => {
            const merged = { ...prev, ...data.timeBasedConfig };
            let needsUpdate = false;
            if (!Array.isArray(merged.polygonCoords) || merged.polygonCoords.length !== 119) {
              merged.polygonCoords = DEFAULT_YINCHUAN_COORDS;
              needsUpdate = true;
            }
            if (needsUpdate) {
              setTimeout(() => {
                setDoc(configDocRef, {
                  ...data,
                  timeBasedConfig: {
                    ...data.timeBasedConfig,
                    polygonCoords: DEFAULT_YINCHUAN_COORDS
                  }
                }).catch(err => console.error('Error auto-migrating coordinates:', err));
              }, 500);
            }
            return merged;
          });
        }
      } else {
        // Populate default template in database if not set
        const defaultTemplates = [
          {
            templateName: '线上二维码开单',
            slots: [
              { id: '1', startTime: '06:00', endTime: '18:59', startingPrice: 38, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
              { id: '2', startTime: '19:00', endTime: '23:59', startingPrice: 42, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
              { id: '3', startTime: '00:00', endTime: '05:59', startingPrice: 48, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
            ],
            returnFeeStartKm: 15,
            returnFeePerKm: 2,
            returnFeeIntervalKm: 1,
            returnFeeIncreaseYuan: 2,
            freeWaitingTime: 15,
            waitingChargePerMin: 1,
            waitingIntervalMin: 1,
            waitingIncreaseYuan: 1,
          },
          {
            templateName: '夜间高额线上加价模版',
            slots: [
              { id: '1', startTime: '06:00', endTime: '18:59', startingPrice: 45, includedDistance: 6, unitPricePerKm: 6, distanceInterval: 1, priceIncrease: 6 },
              { id: '2', startTime: '19:00', endTime: '23:59', startingPrice: 50, includedDistance: 6, unitPricePerKm: 6, distanceInterval: 1, priceIncrease: 6 },
              { id: '3', startTime: '00:00', endTime: '05:59', startingPrice: 60, includedDistance: 6, unitPricePerKm: 6, distanceInterval: 1, priceIncrease: 6 },
            ],
            returnFeeStartKm: 10,
            returnFeePerKm: 3,
            returnFeeIntervalKm: 1,
            returnFeeIncreaseYuan: 3,
            freeWaitingTime: 10,
            waitingChargePerMin: 2,
            waitingIntervalMin: 1,
            waitingIncreaseYuan: 2,
          }
        ];
        const defaultTimeBased = {
          fenceName: '黑湾代驾银川城区',
          beforeMidnightHourPrice: 28,
          afterMidnightHourPrice: 35,
          overtimePricePerMin: 1,
          outOfBoundsPricePerKm: 5,
          freeWaitTimeMins: 10,
          overtimeWaitPricePerMin: 1,
          polygonCoords: DEFAULT_YINCHUAN_COORDS,
          // Legacy support keys
          baseMinutes: 60,
          basePrice: 28,
          overtimeInterval: 1,
          overtimePrice: 1,
          nightStart: '00:00',
          nightEnd: '06:00',
          nightExtraPrice: 7,
          outOfBoundsKm: 15,
          outOfBoundsPrice: 5
        };
        setTemplates(defaultTemplates);
        setActiveTemplateName('线上二维码开单');
        setActiveBillingMode('system_default');
        setTimeBasedConfig(defaultTimeBased);
        
        setDoc(configDocRef, {
          activeTemplateName: '线上二维码开单',
          templates: defaultTemplates,
          activeBillingMode: 'system_default',
          timeBasedConfig: defaultTimeBased
        }).catch(err => console.error('Error seeding default online billing config:', err));
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Save the complete online config to Firestore
  const persistOnlineConfig = async (
    newTemplates: BillingRules[], 
    newActive: string,
    newBillingMode?: 'system_default' | 'time_based',
    newTimeBasedConfig?: typeof timeBasedConfig
  ) => {
    const configDocRef = doc(db, 'config', 'online_billing_rules');
    try {
      const modeToSave = newBillingMode !== undefined ? newBillingMode : activeBillingMode;
      const timeBasedToSave = newTimeBasedConfig !== undefined ? newTimeBasedConfig : timeBasedConfig;
      
      await setDoc(configDocRef, {
        activeTemplateName: newActive,
        templates: newTemplates,
        activeBillingMode: modeToSave,
        timeBasedConfig: timeBasedToSave
      });
      return true;
    } catch (err) {
      console.error('Failed to save online billing config:', err);
      onShowToast('❌ 计费配置同步至云端失败，已保存至本地');
      return false;
    }
  };

  // Set selected template as current active
  const handleSetActiveTemplate = async (template: BillingRules) => {
    setActiveTemplateName(template.templateName);
    const success = await persistOnlineConfig(templates, template.templateName);
    if (success) {
      onShowToast(`🎉 成功启用线上单计费模板: "${template.templateName}"`);
    }
    setActiveMenuTemplate(null);
  };

  // Add a new empty template
  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim()) {
      onShowToast('⚠️ 请输入模板名称');
      return;
    }
    const exists = templates.some(t => t.templateName === newTemplateName.trim());
    if (exists) {
      onShowToast('⚠️ 模板名称已存在，请更换');
      return;
    }

    const newTemplate: BillingRules = {
      templateName: newTemplateName.trim(),
      slots: [
        { id: '1', startTime: '06:00', endTime: '18:59', startingPrice: 40, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
        { id: '2', startTime: '19:00', endTime: '23:59', startingPrice: 40, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
        { id: '3', startTime: '00:00', endTime: '05:59', startingPrice: 40, includedDistance: 7, unitPricePerKm: 5, distanceInterval: 1, priceIncrease: 5 },
      ],
      returnFeeStartKm: 15,
      returnFeePerKm: 2,
      returnFeeIntervalKm: 1,
      returnFeeIncreaseYuan: 2,
      freeWaitingTime: 15,
      waitingChargePerMin: 1,
      waitingIntervalMin: 1,
      waitingIncreaseYuan: 1,
    };

    const nextTemplates = [...templates, newTemplate];
    setTemplates(nextTemplates);
    setShowAddModal(false);
    setNewTemplateName('');

    const success = await persistOnlineConfig(nextTemplates, activeTemplateName);
    if (success) {
      onShowToast(`🎉 成功创建线上计费模板: "${newTemplate.templateName}"`);
    }
  };

  // Delete a template
  const handleDeleteTemplate = async (templateToDelete: BillingRules) => {
    if (templateToDelete.templateName === activeTemplateName) {
      onShowToast('⚠️ 无法删除当前正在使用中的线上计费模板！');
      return;
    }
    if (templates.length <= 1) {
      onShowToast('⚠️ 至少需要保留一个线上单计费模板！');
      return;
    }

    const nextTemplates = templates.filter(t => t.templateName !== templateToDelete.templateName);
    setTemplates(nextTemplates);
    setActiveMenuTemplate(null);

    const success = await persistOnlineConfig(nextTemplates, activeTemplateName);
    if (success) {
      onShowToast(`🗑️ 已成功删除线上计费模板: "${templateToDelete.templateName}"`);
    }
  };

  // Open Edit Workspace for a selected template
  const handleOpenEdit = (template: BillingRules) => {
    setEditingTemplate(template);
    setEditName(template.templateName);
    setEditSlots(JSON.parse(JSON.stringify(template.slots))); // Deep copy
    setEditReturnStartKm(template.returnFeeStartKm !== undefined ? template.returnFeeStartKm : 15);
    setEditReturnPerKm(template.returnFeePerKm !== undefined ? template.returnFeePerKm : 2);
    setEditReturnIntervalKm(template.returnFeeIntervalKm !== undefined ? template.returnFeeIntervalKm : 1);
    setEditReturnIncrease(template.returnFeeIncreaseYuan !== undefined ? template.returnFeeIncreaseYuan : 2);
    setEditFreeWaitingTime(template.freeWaitingTime !== undefined ? template.freeWaitingTime : 15);
    setEditWaitingPerMin(template.waitingChargePerMin !== undefined ? template.waitingChargePerMin : 1);
    setEditWaitingInterval(template.waitingIntervalMin !== undefined ? template.waitingIntervalMin : 1);
    setEditWaitingIncrease(template.waitingIncreaseYuan !== undefined ? template.waitingIncreaseYuan : 1);
    
    setActiveMenuTemplate(null);
    setSelectedSettingPanel('system_default');
  };

  // Add time slot in editor
  const handleAddSlot = () => {
    const newId = (editSlots.length + 1).toString();
    const newSlot: TimeSlot = {
      id: newId,
      startTime: '08:00',
      endTime: '17:59',
      startingPrice: 35,
      includedDistance: 7,
      unitPricePerKm: 5,
      distanceInterval: 1,
      priceIncrease: 5
    };
    setEditSlots([...editSlots, newSlot]);
  };

  // Remove time slot in editor
  const handleRemoveSlot = (id: string) => {
    if (editSlots.length <= 1) {
      onShowToast('⚠️ 计费模板必须至少包含一个时间段！');
      return;
    }
    setEditSlots(editSlots.filter(s => s.id !== id));
  };

  // Save changes from editing workspace
  const handleSaveEdit = async () => {
    if (!editingTemplate) return;
    if (!editName.trim()) {
      onShowToast('⚠️ 模板名称不能为空');
      return;
    }

    // Check slot bounds
    for (const slot of editSlots) {
      if (slot.startingPrice < 0 || slot.includedDistance <= 0) {
        onShowToast('⚠️ 请确保时段起步价与包含公里数为正数');
        return;
      }
    }

    const rStart = isNaN(Number(editReturnStartKm)) ? 15 : Number(editReturnStartKm);
    const rInterval = isNaN(Number(editReturnIntervalKm)) || Number(editReturnIntervalKm) <= 0 ? 1 : Number(editReturnIntervalKm);
    const rIncrease = isNaN(Number(editReturnIncrease)) ? 2 : Number(editReturnIncrease);
    const calculatedReturnFeePerKm = rInterval > 0 ? Number((rIncrease / rInterval).toFixed(4)) : 0;

    const fWait = isNaN(Number(editFreeWaitingTime)) ? 15 : Number(editFreeWaitingTime);
    const wInterval = isNaN(Number(editWaitingInterval)) || Number(editWaitingInterval) <= 0 ? 1 : Number(editWaitingInterval);
    const wIncrease = isNaN(Number(editWaitingIncrease)) ? 1 : Number(editWaitingIncrease);
    const calculatedWaitingPerMin = wInterval > 0 ? Number((wIncrease / wInterval).toFixed(4)) : 0;

    const updatedTemplate: BillingRules = {
      templateName: editName.trim(),
      slots: editSlots,
      returnFeeStartKm: rStart,
      returnFeePerKm: calculatedReturnFeePerKm,
      returnFeeIntervalKm: rInterval,
      returnFeeIncreaseYuan: rIncrease,
      freeWaitingTime: fWait,
      waitingChargePerMin: calculatedWaitingPerMin,
      waitingIntervalMin: wInterval,
      waitingIncreaseYuan: wIncrease,
    };

    // Replace original template in list
    const nextTemplates = templates.map(t => 
      t.templateName === editingTemplate.templateName ? updatedTemplate : t
    );

    // If we renamed the currently active template, update the activeTemplateName
    let nextActive = activeTemplateName;
    if (editingTemplate.templateName === activeTemplateName) {
      nextActive = updatedTemplate.templateName;
    }

    setTemplates(nextTemplates);
    setActiveTemplateName(nextActive);
    setEditingTemplate(null);

    const success = await persistOnlineConfig(nextTemplates, nextActive);
    if (success) {
      onShowToast(`🎉 成功保存计费模板 "${updatedTemplate.templateName}" 的修改`);
    }
  };

  const handleSaveTimeBasedConfig = async () => {
    const success = await persistOnlineConfig(templates, activeTemplateName, activeBillingMode, timeBasedConfig);
    if (success) {
      onShowToast('🎉 时间单计费规则参数保存成功！');
      setSelectedSettingPanel(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-4">
        <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-mono text-slate-500">正在从 Firestore 云数据库读取线上计费数据...</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start text-left select-none">
      
      {/* LEFT COLUMN: Simulated App Screen for Template Listing */}
      <div className={`${showRulesList ? 'xl:col-span-5' : 'hidden'} bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex flex-col items-center animate-in fade-in-50 duration-200`}>
        <div className="w-full max-w-[360px] bg-gray-50 text-gray-900 rounded-[40px] border-[8px] border-slate-950 overflow-hidden relative shadow-2xl flex flex-col" style={{ height: '620px' }}>
          
          {/* Simulated phone speaker and notch */}
          <div className="absolute top-0 inset-x-0 h-5 bg-slate-950 flex justify-center items-center z-50">
            <div className="w-20 h-3 bg-slate-950 rounded-b-xl flex items-center justify-center">
              <div className="w-8 h-1 bg-gray-800 rounded-full"></div>
            </div>
          </div>

          {/* App Header */}
          <header className="pt-7 pb-3 px-4 bg-[#353b50] text-white flex items-center justify-between sticky top-0 z-40 select-none">
            <span className="text-sm font-bold tracking-tight">线上接单计费规则</span>
            <button 
              onClick={() => setShowAddModal(true)}
              className="text-xs font-bold text-[#4dbfb3] bg-[#4dbfb3]/10 hover:bg-[#4dbfb3]/20 px-2 py-1 rounded-lg transition-all"
            >
              新建规则
            </button>
          </header>

          {/* App List Container */}
          <main className="flex-1 overflow-y-auto bg-white p-3 space-y-2.5 pb-20">
            {templates.map((rule) => {
              const isActive = rule.templateName === activeTemplateName;
              return (
                <div 
                  key={rule.templateName}
                  onClick={() => {
                    if (rule.templateName === '夜间高额线上加价模版') {
                      setShowCustomPricingImageScreen(true);
                    } else {
                      setActiveMenuTemplate(rule);
                    }
                  }}
                  className={`flex flex-col p-3.5 rounded-2xl border transition-all cursor-pointer select-none ${
                    isActive 
                      ? 'bg-[#eefaf8] border-[#4dbfb3]/40 shadow-xs' 
                      : 'bg-white border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-bold text-gray-800">{rule.templateName}</span>
                    {isActive ? (
                      <span className="text-[10px] bg-[#4dbfb3] text-white font-black px-1.5 py-0.5 rounded-sm animate-pulse">
                        当前使用中
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-400 font-bold bg-gray-100 px-1.5 py-0.5 rounded-sm">
                        未启用
                      </span>
                    )}
                  </div>
                  
                  {/* Brief Rules Summary */}
                  <div className="text-[11px] text-gray-500 space-y-0.5 border-t border-dashed border-gray-100 pt-1.5 font-sans">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-400" />
                      <span>含时段起步价：{rule.slots?.map(s => `${s.startTime}(${s.startingPrice}元)`).join(' | ')}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Navigation className="w-3 h-3 text-gray-400" />
                      <span>含公里数：{rule.slots?.[0]?.includedDistance || 7}公里 | 返程起征公里：{rule.returnFeeStartKm || 15}公里</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-end items-center mt-2.5 pt-1 border-t border-gray-50 text-[10px] text-[#4dbfb3] font-bold">
                    <span>管理该模板</span>
                    <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                  </div>
                </div>
              );
            })}
          </main>

          {/* Custom high-fidelity pricing rules screen (matching the WeChat screenshot) */}
          {showCustomPricingImageScreen && (
            <div className="absolute inset-0 bg-[#f7f8fa] z-40 flex flex-col pt-5 animate-in slide-in-from-right duration-200">
              {/* Custom Status Bar / Header (WeChat style) */}
              <div className="bg-[#f7f7f7] border-b border-gray-200/60 px-3 py-2 flex items-center justify-between shrink-0">
                <button 
                  onClick={() => setShowCustomPricingImageScreen(false)}
                  className="p-1 text-slate-800 hover:text-slate-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </button>
                
                <span className="text-[16px] font-black text-[#111111] tracking-wide">计价规则</span>
                
                {/* WeChat-style Menu Capsule Pill */}
                <div className="border border-slate-300 rounded-full py-1 px-2 flex items-center space-x-2 bg-white shadow-2xs">
                  <div className="flex space-x-0.5 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900"></span>
                    <span className="w-1 h-1 rounded-full bg-slate-900 opacity-60"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900"></span>
                  </div>
                  <div className="h-3 w-[0.5px] bg-slate-200"></div>
                  <div className="w-3.5 h-3.5 rounded-full border border-slate-900 flex items-center justify-center p-[1px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900"></span>
                  </div>
                </div>
              </div>

              {/* Scrollable Rules Content */}
              <div className="flex-1 overflow-y-auto flex flex-col bg-[#f7f8fa] pb-10">
                
                {/* Yinchuan Schematic Map */}
                <div className="relative w-full h-[220px] bg-[#f5f4f0] shrink-0 overflow-hidden border-b border-gray-100">
                  <svg className="w-full h-full" viewBox="0 0 340 220" preserveAspectRatio="none">
                    <path d="M 0,40 Q 150,50 340,30" stroke="#E6E3DB" strokeWidth="2.5" fill="none" />
                    <path d="M 0,110 L 340,110" stroke="#FFFDF8" strokeWidth="6" fill="none" />
                    <path d="M 0,110 L 340,110" stroke="#FFE9B5" strokeWidth="3.5" fill="none" />
                    
                    <path d="M 0,60 L 340,60" stroke="#FFFDF8" strokeWidth="5" fill="none" />
                    <path d="M 0,60 L 340,60" stroke="#FFE9B5" strokeWidth="3" fill="none" />

                    <path d="M 60,220 Q 90,130 120,0" stroke="#FFFDF8" strokeWidth="5" fill="none" />
                    <path d="M 60,220 Q 90,130 120,0" stroke="#FFD899" strokeWidth="2.5" fill="none" />

                    {/* Water channels */}
                    <path d="M 280,220 Q 250,150 290,100 T 310,0" stroke="#A9CDE2" strokeWidth="3" fill="none" />
                    <path d="M 180,220 Q 160,140 170,80 T 200,0" stroke="#A9CDE2" strokeWidth="1.5" fill="none" />

                    {/* Parks */}
                    <circle cx="25" cy="100" r="15" fill="#E2EDC5" />

                    {/* Polygon Fence */}
                    <polygon 
                      points="38,28 120,28 260,26 312,32 316,98 314,145 295,175 235,180 108,180 38,172 40,70" 
                      fill="rgba(59, 89, 152, 0.28)" 
                      stroke="#2B5998" 
                      strokeWidth="2.5" 
                      strokeLinejoin="round"
                    />

                    {/* Map text labels */}
                    <text x="80" y="85" fill="#5c5a54" fontSize="10" fontWeight="bold">西夏区</text>
                    <text x="145" y="52" fill="#7a766d" fontSize="9">贺兰山中路</text>
                    <text x="145" y="103" fill="#7a766d" fontSize="9">北京中路</text>
                    <text x="180" y="115" fill="#5c5a54" fontSize="10" fontWeight="bold">金凤区</text>
                    <text x="245" y="105" fill="#5c5a54" fontSize="10" fontWeight="bold">兴庆区</text>
                    <text x="225" y="145" fill="#4d7c94" fontSize="8">红花渠</text>
                    <text x="85" y="130" fill="#6d6a62" fontSize="8" transform="rotate(73,85,130)">银西高速公路</text>
                    <text x="215" y="170" fill="#6d6a62" fontSize="8">胜利街</text>
                    <text x="260" y="80" fill="#4d7c94" fontSize="8" transform="rotate(-65,260,80)">唐徕渠</text>
                    <text x="5" y="112" fill="#324d0d" fontSize="8">西夏公园</text>
                  </svg>

                  {/* Floating label: 围栏范围 */}
                  <div className="absolute bottom-3 left-3 bg-white px-2.5 py-1.5 rounded-lg shadow-md border border-gray-100 flex items-center space-x-1.5">
                    <svg className="w-3.5 h-3.5 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polygon points="12,2 22,8 17,20 7,20 2,8" />
                    </svg>
                    <span className="text-[11px] font-bold text-slate-800">围栏范围</span>
                  </div>

                  {/* Floating watermark: 腾讯地图 */}
                  <div className="absolute bottom-3 right-3 flex items-center space-x-1 opacity-90">
                    <div className="w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center shadow-xs">
                      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none">
                        <path d="M12 2L22 22L12 17L2 22L12 2Z" fill="url(#compassGrad)" />
                        <defs>
                          <linearGradient id="compassGrad" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor="#ff5a5f" />
                            <stop offset="100%" stopColor="#3b5998" />
                          </linearGradient>
                        </defs>
                      </svg>
                    </div>
                    <span className="text-[10px] font-black tracking-tighter text-slate-600 font-sans" style={{ textShadow: '1px 1px 1px #fff' }}>腾讯地图</span>
                  </div>
                </div>

                {/* Heading: 代驾计价规则 */}
                <div className="flex items-center justify-center space-x-2 py-5 select-none shrink-0">
                  <span className="text-sm text-slate-800 font-black flex items-center gap-1.5">
                    <span>⚫</span>
                    <span>代驾计价规则</span>
                    <span>⚫</span>
                  </span>
                </div>

                {/* White rules details card */}
                <div className="mx-4 mb-4 bg-white rounded-2xl p-5 shadow-xs flex flex-col space-y-5">
                  <div className="text-left">
                    <p className="text-[#111111] font-black text-[14px] leading-tight">黑湾代驾银川城区范围内</p>
                  </div>
                  
                  <div className="text-left border-t border-gray-50 pt-1">
                    <p className="text-[#111111] font-black text-[14px] leading-tight mt-1">晚12点前 一小时28元 随便跑</p>
                  </div>

                  <div className="text-left border-t border-gray-50 pt-1">
                    <p className="text-[#111111] font-black text-[14px] leading-tight mt-1">晚12点后 一小时35元 随便跑</p>
                  </div>

                  <div className="text-left border-t border-gray-50 pt-3 space-y-1">
                    <p className="text-slate-800 font-medium text-[12px] leading-relaxed">
                      超一小时一分钟1元，超范围1公里5元
                    </p>
                    <p className="text-slate-800 font-medium text-[12px] leading-relaxed">
                      司机就位免费等时10分钟，超1分钟1元
                    </p>
                  </div>
                </div>

                {/* Interactive Actions for Admin */}
                <div className="px-4 mt-auto pt-2 flex gap-2 shrink-0">
                  <button
                    onClick={() => {
                      const template = templates.find(t => t.templateName === '夜间高额线上加价模版');
                      if (template) {
                        handleOpenEdit(template);
                      }
                      setShowCustomPricingImageScreen(false);
                    }}
                    className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-all border border-slate-200 cursor-pointer"
                  >
                    配置规则属性
                  </button>
                  <button
                    onClick={handleActivateCustomNightTemplate}
                    className="flex-1 py-2 bg-[#4dbfb3] hover:bg-[#43a69b] text-white text-xs font-black rounded-xl transition-all shadow-md shadow-teal-500/10 flex items-center justify-center space-x-1 cursor-pointer"
                  >
                    {activeTemplateName === '夜间高额线上加价模版' ? (
                      <>
                        <Check className="w-3.5 h-3.5 stroke-[3px]" />
                        <span>当前已启用</span>
                      </>
                    ) : (
                      <span>启用此模板</span>
                    )}
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* Phone home indicator */}
          <div className="absolute bottom-1 inset-x-0 h-4 bg-transparent flex justify-center items-center z-50">
            <div className="w-28 h-1 bg-gray-900 rounded-full"></div>
          </div>

          {/* Simulated App Action Bottom Drawer */}
          {activeMenuTemplate && (
            <div 
              className="absolute inset-0 bg-black/50 z-50 flex flex-col justify-end animate-in fade-in duration-200"
              onClick={() => setActiveMenuTemplate(null)}
            >
              <div 
                className="bg-white rounded-t-[24px] px-4 pt-3 pb-8 flex flex-col space-y-2.5 animate-in slide-in-from-bottom duration-250"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-2" />
                <p className="text-center text-xs font-bold text-gray-400 mb-1">
                  选择对【{activeMenuTemplate.templateName}】的操作
                </p>
                
                <button
                  onClick={() => handleSetActiveTemplate(activeMenuTemplate)}
                  className="w-full py-3 bg-[#4dbfb3] hover:bg-[#43a69b] text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-teal-500/10"
                >
                  启用该模板 (设为线上单计费)
                </button>
                
                <button
                  onClick={() => handleOpenEdit(activeMenuTemplate)}
                  className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-sm rounded-xl transition-all"
                >
                  修改计费规则详情
                </button>
                
                {activeMenuTemplate.templateName !== activeTemplateName && (
                  <button
                    onClick={() => {
                      if (confirm(`确定要彻底删除该线上计费规则模板【${activeMenuTemplate.templateName}】吗？此操作无法撤销。`)) {
                        handleDeleteTemplate(activeMenuTemplate);
                      }
                    }}
                    className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-500 font-bold text-sm rounded-xl transition-all"
                  >
                    删除该模板
                  </button>
                )}
                
                <button
                  onClick={() => setActiveMenuTemplate(null)}
                  className="w-full py-3 bg-gray-50 hover:bg-gray-100 text-gray-400 font-bold text-sm rounded-xl transition-all"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* Simulated App Add Template Popup */}
          {showAddModal && (
            <div 
              className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
              onClick={() => setShowAddModal(false)}
            >
              <div 
                className="bg-white rounded-2xl p-5 w-full max-w-[300px] flex flex-col space-y-4 animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-center">
                  <p className="text-sm font-bold text-gray-800">新建线上接单规则</p>
                  <p className="text-[10px] text-gray-400 mt-1">请为新的线上计费模板命名</p>
                </div>
                
                <input
                  type="text"
                  placeholder="如: 银川市特定线上加价版"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-hidden focus:border-[#4dbfb3]"
                />
                
                <div className="flex gap-2.5">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-2 bg-gray-50 text-gray-400 text-xs font-bold rounded-xl hover:bg-gray-100 transition-all"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreateTemplate}
                    className="flex-1 py-2 bg-[#4dbfb3] text-white text-xs font-bold rounded-xl hover:bg-[#43a69b] transition-all"
                  >
                    确定创建
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* RIGHT COLUMN: Interactive Work Editor / Explanatory Desk */}
      <div className={`${showRulesList ? 'xl:col-span-7' : 'xl:col-span-12'} space-y-6`}>
        
        {selectedSettingPanel === 'system_default' && editingTemplate ? (
          /* WORK EDITOR FOR ACTIVE TEMPLATE */
          <div className="bg-[#12141F] border border-slate-800 rounded-3xl p-6 space-y-6 animate-in fade-in-50 duration-200">
            
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <button 
                  onClick={() => {
                    setEditingTemplate(null);
                    setSelectedSettingPanel(null);
                  }}
                  className="p-1.5 bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-all cursor-pointer flex items-center gap-1"
                  title="返回计费模式选择"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="text-xs font-bold font-sans">返回计费模式选择</span>
                </button>
                <button
                  onClick={() => setShowRulesList(!showRulesList)}
                  className="p-1.5 bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-all cursor-pointer flex items-center gap-1 text-xs font-bold"
                  title="切换规则列表显示"
                >
                  <span>{showRulesList ? '✕ 隐藏规则列表' : '📋 显示规则列表'}</span>
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditingTemplate(null);
                    setSelectedSettingPanel(null);
                  }}
                  className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 font-bold rounded-xl text-xs transition-all cursor-pointer"
                >
                  放弃修改
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-1.5 bg-gradient-to-r from-teal-500 to-emerald-500 text-slate-950 font-black rounded-xl text-xs hover:opacity-95 shadow-md shadow-teal-500/10 transition-all active:scale-95 cursor-pointer"
                >
                  保存模板修改
                </button>
              </div>
            </div>

            {/* Enable/Disable Active Toggle Banner */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-slate-200">系统默认里程/时段计费模式</span>
                  {activeBillingMode === 'system_default' ? (
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 font-extrabold px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      启用中
                    </span>
                  ) : (
                    <span className="text-[10px] bg-slate-800 text-slate-400 font-bold px-2 py-0.5 rounded-full">未启用</span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500">启用后，线上自主动扫码、线上预约订单将遵循以下里程起步价和多时段溢价细则进行。</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (activeBillingMode === 'system_default') {
                    onShowToast('ℹ️ 当前已是启用状态');
                    return;
                  }
                  setActiveBillingMode('system_default');
                  const success = await persistOnlineConfig(templates, activeTemplateName, 'system_default');
                  if (success) {
                    onShowToast('🎉 成功启用：系统默认里程/时段计费方式！');
                  }
                }}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  activeBillingMode === 'system_default'
                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100 border border-slate-700'
                }`}
              >
                {activeBillingMode === 'system_default' ? '已启用当前方式' : '启用当前计费方式'}
              </button>
            </div>

            {/* Template name modifier */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">模板名称</span>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-56 text-right bg-transparent border-b border-dashed border-slate-800 focus:border-teal-500 text-xs focus:outline-hidden font-bold text-slate-100"
              />
            </div>

            {/* Time slots Area */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-400 tracking-wider">起步价时段标准</span>
                <button
                  onClick={handleAddSlot}
                  className="text-xs text-teal-400 hover:text-teal-300 font-bold flex items-center gap-1 py-1 px-2.5 bg-teal-500/10 border border-teal-500/20 rounded-lg cursor-pointer transition-all hover:bg-teal-500/20"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>添加时段</span>
                </button>
              </div>

              <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                {editSlots.map((slot, index) => (
                  <div 
                    key={slot.id}
                    className="bg-slate-950/20 border border-slate-800/80 rounded-2xl p-4 space-y-4 relative"
                  >
                    {/* Index Badge */}
                    <div className="absolute top-4 left-4 w-5 h-5 rounded-full bg-slate-800 text-slate-300 text-[10px] flex items-center justify-center font-bold font-mono">
                      {index + 1}
                    </div>

                    <div className="pl-7 flex flex-wrap items-center justify-between gap-4">
                      {/* Time Slot Selector */}
                      <div className="flex items-center space-x-2">
                        <select
                          value={slot.startTime}
                          onChange={(e) => {
                            const next = [...editSlots];
                            const idx = next.findIndex(s => s.id === slot.id);
                            if (idx !== -1) {
                              next[idx].startTime = e.target.value;
                              setEditSlots(next);
                            }
                          }}
                          className="bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-2 py-1 focus:outline-hidden focus:border-teal-500 font-mono"
                        >
                          {START_TIME_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <span className="text-slate-600">-</span>
                        <select
                          value={slot.endTime}
                          onChange={(e) => {
                            const next = [...editSlots];
                            const idx = next.findIndex(s => s.id === slot.id);
                            if (idx !== -1) {
                              next[idx].endTime = e.target.value;
                              setEditSlots(next);
                            }
                          }}
                          className="bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-2 py-1 focus:outline-hidden focus:border-teal-500 font-mono"
                        >
                          {END_TIME_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>

                      {/* Starting price & mileage */}
                      <div className="flex items-center space-x-2">
                        <div className="flex items-center space-x-1 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1">
                          <span className="text-[10px] text-slate-500">起步价</span>
                          <input 
                            type="number"
                            value={slot.startingPrice}
                            onChange={(e) => {
                              const next = [...editSlots];
                              const idx = next.findIndex(s => s.id === slot.id);
                              if (idx !== -1) {
                                next[idx].startingPrice = Number(e.target.value);
                                setEditSlots(next);
                              }
                            }}
                            className="w-12 bg-transparent text-center text-xs font-bold text-slate-100 font-mono border-b border-dashed border-slate-700 focus:border-teal-500"
                          />
                          <span className="text-[10px] text-slate-400">元</span>
                        </div>

                        <div className="flex items-center space-x-1 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1">
                          <span className="text-[10px] text-slate-500">包含</span>
                          <input 
                            type="number"
                            value={slot.includedDistance}
                            onChange={(e) => {
                              const next = [...editSlots];
                              const idx = next.findIndex(s => s.id === slot.id);
                              if (idx !== -1) {
                                next[idx].includedDistance = Number(e.target.value);
                                setEditSlots(next);
                              }
                            }}
                            className="w-10 bg-transparent text-center text-xs font-bold text-teal-400 font-mono border-b border-dashed border-slate-700 focus:border-teal-500"
                          />
                          <span className="text-[10px] text-slate-400">公里</span>
                        </div>

                        <button 
                          onClick={() => handleRemoveSlot(slot.id)}
                          className="p-1 text-slate-600 hover:text-red-400 transition-colors"
                          title="删除时段"
                          type="button"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Surcharge details */}
                    <div className="pl-7 pt-2.5 border-t border-slate-900 flex items-center justify-between text-[11px] text-slate-500">
                      <span>超出里程后加收：</span>
                      <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1 text-slate-300">
                        <span>每超</span>
                        <input 
                          type="number"
                          value={slot.distanceInterval || 1}
                          onChange={(e) => {
                            const next = [...editSlots];
                            const idx = next.findIndex(s => s.id === slot.id);
                            if (idx !== -1) {
                              next[idx].distanceInterval = Number(e.target.value);
                              setEditSlots(next);
                            }
                          }}
                          className="w-8 bg-transparent text-center text-xs font-bold text-teal-400 font-mono border-b border-dashed border-slate-700 focus:border-teal-500"
                        />
                        <span>公里，加收</span>
                        <input 
                          type="number"
                          value={slot.priceIncrease ?? slot.unitPricePerKm ?? 5}
                          onChange={(e) => {
                            const next = [...editSlots];
                            const idx = next.findIndex(s => s.id === slot.id);
                            if (idx !== -1) {
                              next[idx].priceIncrease = Number(e.target.value);
                              setEditSlots(next);
                            }
                          }}
                          className="w-10 bg-transparent text-center text-xs font-bold text-slate-100 font-mono border-b border-dashed border-slate-700 focus:border-teal-500"
                        />
                        <span>元</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Return Fee section */}
            <div className="space-y-2">
              <span className="text-xs font-extrabold text-slate-400 tracking-wider block">返程加收规则</span>
              <div className="bg-slate-950/20 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-300">
                <div className="flex items-center gap-1 font-sans">
                  <span>行程超过</span>
                  <input
                    type="number"
                    value={editReturnStartKm}
                    onChange={(e) => setEditReturnStartKm(Number(e.target.value))}
                    className="w-12 bg-slate-900 border border-slate-800 rounded-lg text-center text-xs font-bold text-teal-400 py-1 font-mono focus:border-teal-500"
                  />
                  <span>公里起，开始计算返程费</span>
                </div>
                
                <div className="flex items-center gap-1 font-sans">
                  <span>每超出</span>
                  <input
                    type="number"
                    value={editReturnIntervalKm}
                    onChange={(e) => setEditReturnIntervalKm(Number(e.target.value))}
                    className="w-10 bg-slate-900 border border-slate-800 rounded-lg text-center text-xs font-bold text-teal-400 py-1 font-mono focus:border-teal-500"
                  />
                  <span>公里，加收</span>
                  <input
                    type="number"
                    value={editReturnIncrease}
                    onChange={(e) => setEditReturnIncrease(Number(e.target.value))}
                    className="w-10 bg-slate-900 border border-slate-800 rounded-lg text-center text-xs font-bold text-slate-100 py-1 font-mono focus:border-teal-500"
                  />
                  <span>元</span>
                </div>
              </div>
            </div>

            {/* Waiting Fee section */}
            <div className="space-y-2">
              <span className="text-xs font-extrabold text-slate-400 tracking-wider block">等候计费规则</span>
              <div className="bg-slate-950/20 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-300">
                <div className="flex items-center gap-1 font-sans">
                  <span>免费等候时长：</span>
                  <input
                    type="number"
                    value={editFreeWaitingTime}
                    onChange={(e) => setEditFreeWaitingTime(Number(e.target.value))}
                    className="w-12 bg-slate-900 border border-slate-800 rounded-lg text-center text-xs font-bold text-teal-400 py-1 font-mono focus:border-teal-500"
                  />
                  <span>分钟</span>
                </div>
                
                <div className="flex items-center gap-1 font-sans">
                  <span>超时每</span>
                  <input
                    type="number"
                    value={editWaitingInterval}
                    onChange={(e) => setEditWaitingInterval(Number(e.target.value))}
                    className="w-10 bg-slate-900 border border-slate-800 rounded-lg text-center text-xs font-bold text-teal-400 py-1 font-mono focus:border-teal-500"
                  />
                  <span>分钟，加收</span>
                  <input
                    type="number"
                    value={editWaitingIncrease}
                    onChange={(e) => setEditWaitingIncrease(Number(e.target.value))}
                    className="w-10 bg-slate-900 border border-slate-800 rounded-lg text-center text-xs font-bold text-slate-100 py-1 font-mono focus:border-teal-500"
                  />
                  <span>元</span>
                </div>
              </div>
            </div>

          </div>
        ) : selectedSettingPanel === 'time_based' ? (
          /* WORK EDITOR FOR TIME-BASED CONFIG (Tencent Map & Polygon Billing) */
          <div className="bg-[#12141F] border border-slate-800 rounded-3xl p-6 space-y-6 animate-in fade-in-50 duration-200">
            
            {/* Header section */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <button 
                  onClick={() => setSelectedSettingPanel(null)}
                  className="p-1.5 bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-all cursor-pointer flex items-center gap-1"
                  title="返回计费模式选择"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="text-xs font-bold font-sans">返回计费模式</span>
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedSettingPanel(null)}
                  className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 font-bold rounded-xl text-xs transition-all cursor-pointer"
                >
                  放弃修改
                </button>
                <button
                  onClick={handleSaveTimeBasedConfig}
                  className="px-4 py-1.5 bg-gradient-to-r from-teal-500 to-emerald-500 text-slate-950 font-black rounded-xl text-xs hover:opacity-95 shadow-md shadow-teal-500/10 transition-all active:scale-95 cursor-pointer"
                >
                  保存时间单配置
                </button>
              </div>
            </div>

            {/* Enable/Disable Active Toggle Banner */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-slate-200">服务模式：时间单计费模式</span>
                  {activeBillingMode === 'time_based' ? (
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 font-extrabold px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      启用中
                    </span>
                  ) : (
                    <span className="text-[10px] bg-slate-800 text-slate-400 font-bold px-2 py-0.5 rounded-full">未启用</span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500">启用时间单模式后，线上新发起的订单将采用多边形围栏加时长费率进行结算。</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (activeBillingMode === 'time_based') {
                    onShowToast('ℹ️ 当前已是启用状态');
                    return;
                  }
                  setActiveBillingMode('time_based');
                  const success = await persistOnlineConfig(templates, activeTemplateName, 'time_based');
                  if (success) {
                    onShowToast('🎉 成功启用：时间单计费方式！');
                  }
                }}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  activeBillingMode === 'time_based'
                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20 pointer-events-none'
                    : 'bg-indigo-500 text-white hover:bg-indigo-400 border border-indigo-400'
                }`}
              >
                {activeBillingMode === 'time_based' ? '已启用当前方式' : '启用当前计费方式'}
              </button>
            </div>

            {/* Interactive Grid Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Side: Tencent Map Drawing Panel */}
              <div className="lg:col-span-7 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-xs font-extrabold text-slate-300 tracking-wider block">服务范围电子围栏绘制</span>
                    <span className="text-[10px] text-slate-500 block">在下方腾讯地图上点击任意位置，可添加多边形围栏的顶点。</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTimeBasedConfig({ ...timeBasedConfig, polygonCoords: [] });
                        onShowToast('🗑️ 多边形标记点已清空，请在地图重新点击绘制');
                      }}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-rose-950/30 hover:text-rose-400 border border-slate-800 text-slate-400 font-bold rounded-lg text-[10px] transition-all cursor-pointer"
                    >
                      清空绘制
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTimeBasedConfig({ ...timeBasedConfig, polygonCoords: DEFAULT_YINCHUAN_COORDS });
                        onShowToast('🔄 已恢复银川默认城区多边形范围');
                      }}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-teal-950/30 hover:text-teal-400 border border-slate-800 text-slate-400 font-bold rounded-lg text-[10px] transition-all cursor-pointer"
                    >
                      重置默认区域
                    </button>
                  </div>
                </div>

                {/* Tencent Map Container */}
                <FenceDrawingMap
                  apiKey="5N4BZ-YFOCT-BWJXC-L7O2O-ATI6K-UYFZW"
                  coords={timeBasedConfig.polygonCoords || []}
                  onChange={(newCoords) => {
                    setTimeBasedConfig({ ...timeBasedConfig, polygonCoords: newCoords });
                  }}
                  onShowToast={onShowToast}
                />

                {/* Coordinates Info & Guidelines */}
                {(() => {
                  const displayCoords = Array.isArray(timeBasedConfig.polygonCoords)
                    ? timeBasedConfig.polygonCoords.filter(c => c && typeof c.lat === 'number' && typeof c.lng === 'number')
                    : [];
                  return (
                    <div className="bg-slate-950/40 border border-slate-800/80 rounded-2xl p-4 space-y-3 font-mono">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">已绘制顶点数:</span>
                        <span className={`font-black ${displayCoords.length >= 3 ? 'text-teal-400' : 'text-amber-500 animate-pulse'}`}>
                          {displayCoords.length} 个 {displayCoords.length < 3 && '(最少需3个点闭合区域)'}
                        </span>
                      </div>

                      {displayCoords.length > 0 ? (
                        <div className="text-[9px] text-slate-500 max-h-[80px] overflow-y-auto space-y-1 divide-y divide-slate-900/50 pr-2 scrollbar-thin">
                          {displayCoords.map((coord, idx) => (
                            <div key={idx} className="flex justify-between py-1 items-center">
                              <span>顶点 {idx + 1}: 纬度 {typeof coord?.lat === 'number' ? coord.lat.toFixed(5) : 'N/A'} / 经度 {typeof coord?.lng === 'number' ? coord.lng.toFixed(5) : 'N/A'}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = displayCoords.filter((_, i) => i !== idx);
                                  setTimeBasedConfig({ ...timeBasedConfig, polygonCoords: updated });
                                  onShowToast('❌ 已移除该顶点');
                                }}
                                className="text-rose-500 hover:text-rose-400 font-bold px-1 py-0.5 rounded"
                              >
                                删除
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-500 text-center py-2 italic">
                          未在地图打点，请在上方地图点击放置服务范围顶点
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Right Side: Pricing Rules Config Panel */}
              <div className="lg:col-span-5 space-y-6">
                <div>
                  <span className="text-xs font-extrabold text-slate-300 tracking-wider block mb-3">多边形区域时间单计费标准</span>
                  
                  {/* Visual Premium Mock Rule Display Card */}
                  <div className="bg-gradient-to-br from-slate-950 to-slate-900 border border-teal-500/30 rounded-2xl p-4 relative overflow-hidden shadow-xl">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/5 blur-2xl rounded-full"></div>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-[10px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-2 py-0.5 rounded-full font-bold">
                        电子围栏计费规则
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono">ID: 飞鸟_YNC</span>
                    </div>
                    
                    <h4 className="text-xs font-extrabold text-slate-200 mb-2">
                      {timeBasedConfig.fenceName || '黑湾代驾银川城区'}范围内：
                    </h4>
                    
                    <ul className="text-[10px] text-slate-400 space-y-1.5 list-disc pl-4 font-sans leading-relaxed">
                      <li>晚12点前：一小时计服务基础费 <strong className="text-teal-400">{timeBasedConfig.beforeMidnightHourPrice ?? 28} 元</strong> (随变跑)</li>
                      <li>晚12点后：一小时计服务基础费 <strong className="text-teal-400">{timeBasedConfig.afterMidnightHourPrice ?? 35} 元</strong> (随变跑)</li>
                      <li>超出 1 小时部分：每分钟加收服务费 <strong className="text-slate-200">{timeBasedConfig.overtimePricePerMin ?? 1} 元</strong></li>
                      <li>超出多边形围栏：超出距离每公里收取行驶费 <strong className="text-amber-400">{timeBasedConfig.outOfBoundsPricePerKm ?? 5} 元</strong></li>
                      <li>司机就位免费等待 <strong className="text-slate-200">{timeBasedConfig.freeWaitTimeMins ?? 10} 分钟</strong>，超额后每分钟加收 <strong className="text-slate-200">{timeBasedConfig.overtimeWaitPricePerMin ?? 1} 元</strong></li>
                    </ul>
                  </div>
                </div>

                {/* Configuration Fields */}
                <div className="space-y-4">
                  <div className="bg-slate-950/20 border border-slate-800/80 rounded-2xl p-4 space-y-1.5">
                    <span className="text-[11px] text-slate-400 font-bold">区域围栏名称</span>
                    <input 
                      type="text"
                      value={timeBasedConfig.fenceName || ''}
                      onChange={(e) => setTimeBasedConfig({ ...timeBasedConfig, fenceName: e.target.value })}
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs w-full focus:outline-hidden focus:border-teal-500 font-sans"
                      placeholder="例如: 黑湾代驾银川城区"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950/20 border border-slate-800/80 rounded-2xl p-4 space-y-1.5">
                      <span className="text-[11px] text-slate-400 font-bold">晚12点前价格</span>
                      <div className="flex items-center justify-between">
                        <input 
                          type="number"
                          value={timeBasedConfig.beforeMidnightHourPrice ?? ''}
                          onChange={(e) => setTimeBasedConfig({ ...timeBasedConfig, beforeMidnightHourPrice: Number(e.target.value) })}
                          className="bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-slate-100 font-mono text-xs w-full focus:outline-hidden focus:border-teal-500"
                        />
                        <span className="text-[10px] text-slate-500 ml-2 shrink-0">元/时</span>
                      </div>
                    </div>

                    <div className="bg-slate-950/20 border border-slate-800/80 rounded-2xl p-4 space-y-1.5">
                      <span className="text-[11px] text-slate-400 font-bold">晚12点后价格</span>
                      <div className="flex items-center justify-between">
                        <input 
                          type="number"
                          value={timeBasedConfig.afterMidnightHourPrice ?? ''}
                          onChange={(e) => setTimeBasedConfig({ ...timeBasedConfig, afterMidnightHourPrice: Number(e.target.value) })}
                          className="bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-slate-100 font-mono text-xs w-full focus:outline-hidden focus:border-teal-500"
                        />
                        <span className="text-[10px] text-slate-500 ml-2 shrink-0">元/时</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950/20 border border-slate-800/80 rounded-2xl p-4 space-y-1.5">
                      <span className="text-[11px] text-slate-400 font-bold">超出1小时费率</span>
                      <div className="flex items-center justify-between">
                        <input 
                          type="number"
                          value={timeBasedConfig.overtimePricePerMin ?? ''}
                          onChange={(e) => setTimeBasedConfig({ ...timeBasedConfig, overtimePricePerMin: Number(e.target.value) })}
                          className="bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-slate-100 font-mono text-xs w-full focus:outline-hidden focus:border-teal-500"
                        />
                        <span className="text-[10px] text-slate-500 ml-2 shrink-0">元/分钟</span>
                      </div>
                    </div>

                    <div className="bg-slate-950/20 border border-slate-800/80 rounded-2xl p-4 space-y-1.5">
                      <span className="text-[11px] text-slate-400 font-bold">超围栏里程费</span>
                      <div className="flex items-center justify-between">
                        <input 
                          type="number"
                          value={timeBasedConfig.outOfBoundsPricePerKm ?? ''}
                          onChange={(e) => setTimeBasedConfig({ ...timeBasedConfig, outOfBoundsPricePerKm: Number(e.target.value) })}
                          className="bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-slate-100 font-mono text-xs w-full focus:outline-hidden focus:border-teal-500"
                        />
                        <span className="text-[10px] text-slate-500 ml-2 shrink-0">元/公里</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950/20 border border-slate-800/80 rounded-2xl p-4 space-y-1.5">
                      <span className="text-[11px] text-slate-400 font-bold">就位免费等待</span>
                      <div className="flex items-center justify-between">
                        <input 
                          type="number"
                          value={timeBasedConfig.freeWaitTimeMins ?? ''}
                          onChange={(e) => setTimeBasedConfig({ ...timeBasedConfig, freeWaitTimeMins: Number(e.target.value) })}
                          className="bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-slate-100 font-mono text-xs w-full focus:outline-hidden focus:border-teal-500"
                        />
                        <span className="text-[10px] text-slate-500 ml-2 shrink-0">分钟</span>
                      </div>
                    </div>

                    <div className="bg-slate-950/20 border border-slate-800/80 rounded-2xl p-4 space-y-1.5">
                      <span className="text-[11px] text-slate-400 font-bold">超额等待加收</span>
                      <div className="flex items-center justify-between">
                        <input 
                          type="number"
                          value={timeBasedConfig.overtimeWaitPricePerMin ?? ''}
                          onChange={(e) => setTimeBasedConfig({ ...timeBasedConfig, overtimeWaitPricePerMin: Number(e.target.value) })}
                          className="bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-slate-100 font-mono text-xs w-full focus:outline-hidden focus:border-teal-500"
                        />
                        <span className="text-[10px] text-slate-500 ml-2 shrink-0">元/分钟</span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

            </div>

          </div>
        ) : (
          /* BILLING MODE SWITCHER DASHBOARD */
          <div className="bg-[#12141F] border border-slate-800 rounded-3xl p-6 space-y-6 animate-in fade-in-50 duration-200">
            
            {/* Header section */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-teal-400" />
                  <h3 className="font-extrabold text-slate-100 text-base">线上代驾单计费模式控制中心</h3>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  管理员可在两种不同的计结算体系之间进行分流控制，并配置其对应的价格属性。
                </p>
              </div>
              <button
                onClick={() => setShowRulesList(!showRulesList)}
                className="px-3 py-1.5 bg-slate-900 hover:bg-[#1b1e2f] border border-slate-800/80 hover:border-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <span>{showRulesList ? '✕ 隐藏规则列表' : '📋 显示规则列表'}</span>
              </button>
            </div>

            {/* Currently Active Banner */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[10px] text-slate-500 font-extrabold tracking-wider block">当前生效结算模式</span>
                <span className="text-xs font-black text-slate-100 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  {activeBillingMode === 'system_default' 
                    ? `里程/多时段计费方式 (模板: "${activeTemplateName}")` 
                    : '时间单/包时服务计费方式'
                  }
                </span>
              </div>
              <div className="text-[10px] bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-xl border border-emerald-500/20 font-bold">
                全网实时生效中
              </div>
            </div>

            {/* Mode Selection Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              
              {/* Card 1: System Default (Mileage/Time slots) */}
              <div 
                className={`border rounded-2xl p-5 flex flex-col justify-between space-y-4 transition-all hover:scale-[1.01] ${
                  activeBillingMode === 'system_default'
                    ? 'bg-slate-950/50 border-teal-500/40 shadow-md shadow-teal-500/5'
                    : 'bg-slate-950/10 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="p-2 bg-teal-500/10 text-teal-400 border border-teal-500/20 rounded-xl">
                      <Navigation className="w-4 h-4" />
                    </div>
                    {activeBillingMode === 'system_default' ? (
                      <span className="text-[9px] bg-emerald-500/10 text-emerald-400 font-extrabold px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-emerald-500"></span>
                        已启用
                      </span>
                    ) : (
                      <span className="text-[9px] bg-slate-900 text-slate-500 font-bold px-2 py-0.5 rounded-full">未启用</span>
                    )}
                  </div>
                  
                  <div className="space-y-1">
                    <h4 className="text-xs font-extrabold text-slate-200">里程/时段计费</h4>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      基于行驶里程、不同时间段起步价、超出里程溢价、返程加价及等候分钟进行阶梯结算。
                    </p>
                  </div>

                  <div className="bg-slate-900/50 rounded-xl p-3 space-y-1.5 text-[10px] text-slate-400 font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-500">当前激活模板:</span>
                      <span className="text-slate-300 font-bold max-w-[90px] truncate block text-right" title={activeTemplateName}>{activeTemplateName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">含起步里程:</span>
                      <span className="text-slate-300">
                        {templates.find(t => t.templateName === activeTemplateName)?.slots?.[0]?.includedDistance || 7} 公里
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <button
                    onClick={() => {
                      const activeT = templates.find(t => t.templateName === activeTemplateName) || templates[0];
                      if (activeT) {
                        handleOpenEdit(activeT);
                      } else {
                        onShowToast('⚠️ 未找到可用模板，请先在左侧新建');
                      }
                    }}
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold rounded-xl text-xs transition-all cursor-pointer text-center block"
                  >
                    配置里程计费细节
                  </button>

                  {activeBillingMode !== 'system_default' ? (
                    <button
                      onClick={async () => {
                        setActiveBillingMode('system_default');
                        const success = await persistOnlineConfig(templates, activeTemplateName, 'system_default');
                        if (success) {
                          onShowToast('🎉 成功启用：系统默认里程/时段计费方式！');
                        }
                      }}
                      className="w-full py-2 bg-teal-500 text-slate-950 font-black rounded-xl text-xs transition-all hover:bg-teal-400 cursor-pointer"
                    >
                      启用当前计费方式
                    </button>
                  ) : (
                    <div className="w-full py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-center font-bold rounded-xl text-xs">
                      当前已是激活方式
                    </div>
                  )}
                </div>
              </div>

              {/* Card 2: Time-based */}
              <div 
                className={`border rounded-2xl p-5 flex flex-col justify-between space-y-4 transition-all hover:scale-[1.01] ${
                  activeBillingMode === 'time_based'
                    ? 'bg-slate-950/50 border-indigo-500/40 shadow-md shadow-indigo-500/5'
                    : 'bg-slate-950/10 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="p-2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-xl">
                      <Clock className="w-4 h-4" />
                    </div>
                    {activeBillingMode === 'time_based' ? (
                      <span className="text-[9px] bg-emerald-500/10 text-emerald-400 font-extrabold px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-emerald-500"></span>
                        已启用
                      </span>
                    ) : (
                      <span className="text-[9px] bg-slate-900 text-slate-500 font-bold px-2 py-0.5 rounded-full">未启用</span>
                    )}
                  </div>
                  
                  <div className="space-y-1">
                    <h4 className="text-xs font-extrabold text-slate-200">时间单/时长计费</h4>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      按行车服务总时长结算（包时定制）。超时按分钟步长加收，支持设定夜间加价与超围栏费。
                    </p>
                  </div>

                  <div className="bg-slate-900/50 rounded-xl p-3 space-y-1.5 text-[10px] text-slate-400 font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-500">起步含时间:</span>
                      <span className="text-slate-300 font-bold">{timeBasedConfig.baseMinutes} 分钟</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">起步含金额:</span>
                      <span className="text-slate-300 font-bold">{timeBasedConfig.basePrice} 元</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <button
                    onClick={() => {
                      setSelectedSettingPanel('time_based');
                    }}
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold rounded-xl text-xs transition-all cursor-pointer text-center block"
                  >
                    配置时间单细节
                  </button>

                  {activeBillingMode !== 'time_based' ? (
                    <button
                      onClick={async () => {
                        setActiveBillingMode('time_based');
                        const success = await persistOnlineConfig(templates, activeTemplateName, 'time_based');
                        if (success) {
                          onShowToast('🎉 成功启用：时间单计费方式！');
                        }
                      }}
                      className="w-full py-2 bg-indigo-500 text-white font-black rounded-xl text-xs transition-all hover:bg-indigo-400 cursor-pointer"
                    >
                      启用当前计费方式
                    </button>
                  ) : (
                    <div className="w-full py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-center font-bold rounded-xl text-xs">
                      当前已是激活方式
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Quick Informational Guide */}
            <div className="border border-slate-800/80 bg-slate-950/20 rounded-2xl p-4 space-y-2.5">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-teal-400" />
                双重模式运行指南
              </span>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                ● <strong>里程多时段模式：</strong> 线上服务默认规则。此模式高度契合出行及接单时段特征，通过起步含公里+超公里续费+夜间溢价进行。
                <br />
                ● <strong>时间单包时模式：</strong> 专门针对长时间陪伴服务或特定小时包。用户下单后，后台及结算系统将全链路忽略行驶轨迹里程，仅按照车辆启动代驾到代驾服务结束的累计总时长进行结算。
              </p>
            </div>

          </div>
        )}

      </div>

    </div>
  );
}
