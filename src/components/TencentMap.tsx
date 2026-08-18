import React, { useEffect, useRef, useState } from 'react';
import { db, doc, onSnapshot } from '../lib/dbProxy';

interface TencentMapProps {
  apiKey: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  onDragEnd?: (coords: { lat: number; lng: number }) => void;
  onZoomChange?: (zoom: number) => void;
  showBoundary?: boolean;
}

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

export default function TencentMap({
  center,
  zoom,
  onDragEnd,
  onZoomChange,
  showBoundary = false
}: TencentMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [polygonCoords, setPolygonCoords] = useState<{ lat: number; lng: number }[]>(DEFAULT_YINCHUAN_COORDS);

  // Sync state reference to prevent stale closures
  const centerRef = useRef(center);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Real-time listener for the custom drawing fence from Firestore
  useEffect(() => {
    const configDocRef = doc(db, 'config', 'online_billing_rules');
    const unsubscribe = onSnapshot(configDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.timeBasedConfig && Array.isArray(data.timeBasedConfig.polygonCoords) && data.timeBasedConfig.polygonCoords.length >= 3) {
          setPolygonCoords(data.timeBasedConfig.polygonCoords);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Update center programmatically when props change
  useEffect(() => {
    const map = mapRef.current;
    const AMap = (window as any).AMap;
    if (!map || !AMap || !center || loading) return;

    try {
      const currentCenter = map.getCenter();
      const latDiff = Math.abs(currentCenter.getLat() - center.lat);
      const lngDiff = Math.abs(currentCenter.getLng() - center.lng);

      if (latDiff > 0.0001 || lngDiff > 0.0001) {
        map.setCenter([center.lng, center.lat]);
      }
    } catch (e) {
      console.warn('Failed to set AMap center:', e);
    }
  }, [center, loading]);

  // Update zoom programmatically when props change
  useEffect(() => {
    const map = mapRef.current;
    const AMap = (window as any).AMap;
    if (!map || !AMap || zoom === undefined || loading) return;

    try {
      const currentZoom = map.getZoom();
      if (Math.abs(currentZoom - zoom) > 0.1) {
        map.setZoom(zoom);
      }
    } catch (e) {
      console.warn('Failed to set AMap zoom:', e);
    }
  }, [zoom, loading]);

  // Load AMap Script and initialize map
  useEffect(() => {
    let active = true;
    const scriptId = 'amap-script-simulation';
    let script = (document.getElementById('amap-script') || document.getElementById(scriptId)) as HTMLScriptElement | null;

    const initMap = () => {
      if (!active || !containerRef.current) return;
      try {
        const AMap = (window as any).AMap;
        if (AMap) {
          const initialLat = centerRef.current?.lat || 38.487193;
          const initialLng = centerRef.current?.lng || 106.230912;
          const initialZoom = zoomRef.current || 11; // default city zoom

          const map = new AMap.Map(containerRef.current, {
            center: [initialLng, initialLat],
            zoom: initialZoom,
            viewMode: '2D',
            resizeEnable: true,
            zoomEnable: true,
            dragEnable: true
          });

          mapRef.current = map;

          // Event handlers
          map.on('dragend', () => {
            const currentCenter = map.getCenter();
            if (onDragEnd) {
              onDragEnd({
                lat: currentCenter.getLat(),
                lng: currentCenter.getLng()
              });
            }
          });

          map.on('zoomend', () => {
            const currentZoom = map.getZoom();
            if (onZoomChange) {
              onZoomChange(currentZoom);
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
          setError('高德地图加载失败');
          setLoading(false);
        };
        document.head.appendChild(script);
      } else {
        const checkInterval = setInterval(() => {
          if ((window as any).AMap) {
            clearInterval(checkInterval);
            initMap();
          }
        }, 150);
        setTimeout(() => {
          clearInterval(checkInterval);
          if (loading && !(window as any).AMap) {
            setLoading(false);
            setError('加载高德地图超时');
          }
        }, 5000);
      }
    }

    return () => {
      active = false;
    };
  }, []);

  // Sync polygon drawing
  const boundaryPolygonRef = useRef<any>(null);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = (window as any).AMap;
    if (!map || !AMap || loading) return;

    try {
      if (boundaryPolygonRef.current) {
        boundaryPolygonRef.current.setMap(null);
        boundaryPolygonRef.current = null;
      }

      if (showBoundary && polygonCoords.length >= 3) {
        const path = polygonCoords.map(c => [c.lng, c.lat]);
        boundaryPolygonRef.current = new AMap.Polygon({
          path,
          strokeColor: '#033998',
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: '#033998',
          fillOpacity: 0.15,
          map: map
        });

        // Auto pan or fit boundary on initial load if we're only visualizing rules
        if (!center) {
          map.setFitView([boundaryPolygonRef.current], false, [10, 10, 10, 10], 13);
        }
      }
    } catch (e) {
      console.error('Error drawing AMap boundary polygon:', e);
    }
  }, [polygonCoords, loading, showBoundary, center]);

  return (
    <div className="relative w-full h-full bg-slate-900 flex items-center justify-center overflow-hidden select-none">
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 text-slate-400 text-xs font-medium space-y-2 select-none z-10">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span>正在加载高德地图...</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-slate-400 text-xs text-center p-4">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
