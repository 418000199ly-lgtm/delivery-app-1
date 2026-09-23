import React, { useState, useEffect, useRef } from 'react';
import { 
  Home, 
  MapPin, 
  Volume2, 
  Plus, 
  Minus, 
  Crosshair, 
  Store, 
  Car, 
  Telescope,
  Users,
  Navigation
} from 'lucide-react';
import { ChauffeurSettings } from '../types';
import { db, collection, doc, onSnapshot, getBaseApiUrl } from '../lib/dbProxy';
import { formatDriverMaskedName, resolveDriverRealName } from '../utils/nameResolver';
import SquadDriverList from './SquadDriverList';
import HubbleManagerModal from './HubbleManagerModal';
import HubbleSettingsDialog, { HubbleFilterSettings } from './HubbleSettingsDialog';
import { ensureAMapLoaded } from '../utils/amapLoader';

interface NearbyMapViewProps {
  userPhone?: string;
  settings?: ChauffeurSettings;
  driverCoords?: { lat: number; lng: number };
  isOnline?: boolean;
  currentTrip?: any;
  todayOrdersCount?: number;
  onClose: () => void;
  onNavigateToSettings?: () => void;
}

export default function NearbyMapView({
  userPhone = '15509601222',
  settings,
  driverCoords,
  isOnline = true,
  currentTrip,
  todayOrdersCount = 0,
  onClose,
  onNavigateToSettings
}: NearbyMapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [squadList, setSquadList] = useState<any[]>([]);
  const [realtimeLocations, setRealtimeLocations] = useState<Record<string, any>>({});
  const [showSquadDriverList, setShowSquadDriverList] = useState(false);
  const [showHubbleModal, setShowHubbleModal] = useState(false);
  const [showHubbleSettingsDialog, setShowHubbleSettingsDialog] = useState(false);
  const [hubbleAuthorizedPhones, setHubbleAuthorizedPhones] = useState<string[]>([]);
  const [hubbleFilters, setHubbleFilters] = useState<HubbleFilterSettings>({
    showIdle: true,
    showBusy: true,
    showOffline: false,
    showFullName: false
  });
  const [hubbleSearchFeedback, setHubbleSearchFeedback] = useState<string | null>(null);
  const [devToast, setDevToast] = useState<string | null>(null);
  const toastTimerRef = useRef<any>(null);

  const [gpsLocation, setGpsLocation] = useState<{ lng: number; lat: number }>({
    lng: driverCoords?.lng || 106.23091,
    lat: driverCoords?.lat || 38.487167
  });

  const rawPhone = userPhone || 
    (typeof window !== 'undefined' ? (localStorage.getItem('dd_user_phone') || localStorage.getItem('user_phone') || (settings as any)?.phone) : '') || 
    '';
  const effectiveMyPhone = String(rawPhone).trim();

  const [removedPhones, setRemovedPhones] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('dd_removed_squad_phones_v2');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  // Listen to removed_squad_members in Firestore
  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(doc(db, 'config', 'removed_squad_members'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data?.phones)) {
          const list = data.phones.map((p: any) => String(p).trim());
          setRemovedPhones(list);
          try {
            localStorage.setItem('dd_removed_squad_phones_v2', JSON.stringify(list));
          } catch (_) {}
          if (effectiveMyPhone && effectiveMyPhone !== '15509601222' && list.includes(effectiveMyPhone)) {
            onClose();
          }
        }
      }
    }, () => {});
    return () => unsub();
  }, [effectiveMyPhone, onClose]);

  // If the current driver is removed from squad, automatically close the Nearby map!
  useEffect(() => {
    if (effectiveMyPhone && effectiveMyPhone !== '15509601222' && removedPhones.includes(effectiveMyPhone)) {
      onClose();
    }
  }, [effectiveMyPhone, removedPhones, onClose]);

  const [mySquadName, setMySquadName] = useState<string>(() => {
    return resolveDriverRealName(
      effectiveMyPhone,
      (settings as any)?.driverName || (settings as any)?.name,
      settings
    );
  });

  // Listen for global driver name changes to update map markers instantly
  useEffect(() => {
    const handleNameChange = (e: any) => {
      const { phone, name } = e.detail || {};
      const cleanTargetPhone = String(phone || '').replace(/\D/g, '').trim();
      const cleanMy = String(effectiveMyPhone || '').replace(/\D/g, '').trim();
      if (cleanTargetPhone === cleanMy) {
        setMySquadName(name);
      }
      // Trigger re-render of squadList
      setSquadList(prev => prev.map(item => {
        const itemPhone = String(item.phone || item.id || '').replace(/\D/g, '').trim();
        if (itemPhone === cleanTargetPhone) {
          return { ...item, name, driverName: name, realName: name };
        }
        return item;
      }));
    };

    window.addEventListener('driver_name_changed', handleNameChange);
    window.addEventListener('squad_members_updated', handleNameChange);
    return () => {
      window.removeEventListener('driver_name_changed', handleNameChange);
      window.removeEventListener('squad_members_updated', handleNameChange);
    };
  }, [effectiveMyPhone]);

  // Resolve current driver's name based on squad application, Baota database, or settings
  const currentDriverName = resolveDriverRealName(
    effectiveMyPhone,
    mySquadName || (settings as any)?.driverName || (settings as any)?.name,
    settings
  );

  const isMeMember = (phoneOrId?: string, name?: string) => {
    const clean = String(phoneOrId || '').replace(/\D/g, '').trim();
    const myClean = String(effectiveMyPhone || '').replace(/\D/g, '').trim();
    if (clean && myClean && clean.length >= 7 && myClean.length >= 7) {
      if (clean === myClean) {
        return true;
      }
    }
    return false;
  };

  // Realtime busy status calculation:
  // 红色: 报单中、接单做单中、有进行中行程；绿色: 空闲空车接单状态 (严禁使用紫色)
  const isCurrentDriverBusy = Boolean(
    currentTrip || 
    localStorage.getItem('dd_driver_status_is_busy') === 'true' ||
    (settings as any)?.isBusy === true
  );

  // Realtime online status calculation:
  // 下线状态全部显示为灰色；上线空闲为绿色；上线忙碌/做单中为红色
  const isCurrentDriverOnline = typeof isOnline === 'boolean' 
    ? isOnline 
    : (typeof window !== 'undefined' ? localStorage.getItem('dd_is_online') === 'true' : true);

  const triggerDevToast = (text: string = '开发中') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setDevToast(text);
    toastTimerRef.current = setTimeout(() => {
      setDevToast(null);
    }, 1500);
  };

  // Clean phone number for role and authorization checks
  const cleanMyPhone = effectiveMyPhone.replace(/\D/g, '').trim();
  const isDeveloperUser = cleanMyPhone === '15509601222';

  // Load Hubble authorized drivers real-time
  useEffect(() => {
    let unsubscribe = () => {};
    if (db) {
      const colRef = collection(db, 'hubble_authorized_drivers');
      unsubscribe = onSnapshot(colRef, (snapshot) => {
        const phones: string[] = [];
        snapshot.forEach((docSnap) => {
          phones.push(docSnap.id);
        });
        setHubbleAuthorizedPhones(phones);
      });
    }

    // Also check cached list
    try {
      const cached = localStorage.getItem('hubble_authorized_list_cache');
      if (cached) {
        const list = JSON.parse(cached);
        if (Array.isArray(list)) {
          setHubbleAuthorizedPhones(list.map((item: any) => item.phone));
        }
      }
    } catch (_) {}

    return () => {
      unsubscribe();
    };
  }, []);

  const hasHubblePermission = isDeveloperUser || hubbleAuthorizedPhones.includes(cleanMyPhone);

  const handleHubbleClick = () => {
    if (hasHubblePermission) {
      setShowHubbleModal(true);
    } else {
      triggerDevToast('您无权限');
    }
  };

  // Hubble Search Driver & Center on Map
  const handleHubbleSearchDriver = (query: string) => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return;
    const cleanQuery = trimmed.replace(/\D/g, '');

    // 1. Check if user is searching for myself (吴彦祖 / 我 / 15509601222 / cleanMyPhone)
    const isSearchingMe =
      (cleanQuery && cleanMyPhone && (cleanQuery === cleanMyPhone || cleanMyPhone.includes(cleanQuery) || cleanQuery.includes(cleanMyPhone))) ||
      trimmed === '15509601222' ||
      trimmed.includes('15509601222') ||
      trimmed === '吴彦祖' ||
      trimmed.includes('吴彦祖') ||
      trimmed === '我' ||
      (currentDriverName && trimmed.includes(currentDriverName.toLowerCase()));

    if (isSearchingMe) {
      const myLng = gpsLocation.lng || driverCoords?.lng || 106.23091;
      const myLat = gpsLocation.lat || driverCoords?.lat || 38.487167;
      if (mapInstanceRef.current && myLng && myLat) {
        mapInstanceRef.current.setZoomAndCenter(17, [myLng, myLat]);
        setHubbleSearchFeedback(`已定位至司机: ${currentDriverName} (我)`);
        triggerDevToast(`已定位至司机: ${currentDriverName} (我)`);
        setShowHubbleSettingsDialog(false);
        return;
      }
    }

    // 2. Search in squadList or realtimeLocations for OTHER drivers
    let targetPhone: string | null = null;
    let targetCoords: { lat: number; lng: number } | null = null;
    let targetDriverName: string = '';

    // Check squadList first (excluding myself)
    for (const member of squadList) {
      const p = String(member.phone || member.id || '').replace(/\D/g, '');
      const name = String(member.name || member.driverName || '').toLowerCase();
      if (isMeMember(p, name)) continue;

      if ((cleanQuery && p.includes(cleanQuery)) || (trimmed && name.includes(trimmed))) {
        targetPhone = p;
        targetDriverName = member.name || member.driverName || p;
        if (member.lat && member.lng && !isNaN(Number(member.lat)) && !isNaN(Number(member.lng))) {
          targetCoords = { lat: Number(member.lat), lng: Number(member.lng) };
        }
        break;
      }
    }

    // Check realtimeLocations
    if (!targetCoords && targetPhone && realtimeLocations[targetPhone]) {
      const loc = realtimeLocations[targetPhone];
      if (loc.lat && loc.lng && !isMeMember(targetPhone, loc.driverName || loc.name)) {
        targetCoords = { lat: Number(loc.lat), lng: Number(loc.lng) };
      }
    }

    // If still not found by phone, search in realtimeLocations by name
    if (!targetCoords) {
      for (const [phoneKey, loc] of Object.entries(realtimeLocations)) {
        const p = String(phoneKey || '').replace(/\D/g, '');
        const name = String((loc as any)?.driverName || (loc as any)?.name || '').toLowerCase();
        if (isMeMember(p, name)) continue;

        if ((cleanQuery && p.includes(cleanQuery)) || (trimmed && name.includes(trimmed))) {
          targetPhone = p;
          targetDriverName = (loc as any)?.driverName || (loc as any)?.name || p;
          if ((loc as any)?.lat && (loc as any)?.lng) {
            targetCoords = { lat: Number((loc as any).lat), lng: Number((loc as any).lng) };
          }
          break;
        }
      }
    }

    if (targetCoords && mapInstanceRef.current) {
      mapInstanceRef.current.setZoomAndCenter(17, [targetCoords.lng, targetCoords.lat]);
      setHubbleSearchFeedback(`已定位至司机: ${targetDriverName}`);
      triggerDevToast(`已定位至司机: ${targetDriverName}`);
      // 需求：搜索位置后自动关闭哈勃设置对话框，直接在地图中显示搜索的司机当前位置
      setShowHubbleSettingsDialog(false);
    } else {
      setHubbleSearchFeedback(`未找到司机或无位置数据`);
      triggerDevToast(`未找到该司机位置数据`);
    }
  };

  // Sync GPS Coordinates from driverCoords or cached storage
  useEffect(() => {
    if (driverCoords && driverCoords.lat && driverCoords.lng) {
      setGpsLocation({ lng: driverCoords.lng, lat: driverCoords.lat });
    } else {
      const cachedLat = localStorage.getItem('dd_bg_driver_coords_lat');
      const cachedLng = localStorage.getItem('dd_bg_driver_coords_lng');
      if (cachedLat && cachedLng) {
        setGpsLocation({ lng: parseFloat(cachedLng), lat: parseFloat(cachedLat) });
      }
    }
  }, [driverCoords]);

  // 1. Load real squad members directly from Alibaba Cloud Baota Server Panel API & dbProxy
  useEffect(() => {
    let unsubscribe = () => {};
    if (db) {
      const q = collection(db, 'squad_members');
      unsubscribe = onSnapshot(q, (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const phone = String(data?.phone || docSnap.id || '').trim();
          const name = String(data?.name || data?.driverName || '').trim();
          if (isMeMember(phone, name)) {
            if (name) setMySquadName(name);
          } else if (phone && name && !isMeMember(phone, name)) {
            list.push({ id: docSnap.id, phone, name, ...data });
          }
        });
        setSquadList(list);
      }, () => {});
    }

    // Direct HTTP fetch from Alibaba Cloud Baota Server
    const fetchBaotaSquad = async () => {
      try {
        const baseUrl = getBaseApiUrl();
        const res = await fetch(`${baseUrl}/api/squad/members`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.list)) {
            const myEntry = data.list.find((m: any) => isMeMember(m?.phone || m?.id, m?.name || m?.driverName));
            if (myEntry && (myEntry.name || myEntry.driverName)) {
              setMySquadName(myEntry.name || myEntry.driverName);
            }
            const filtered = data.list.filter((m: any) => {
              const phone = String(m?.phone || m?.id || '').trim();
              const name = String(m?.name || m?.driverName || '').trim();
              return phone && !isMeMember(phone, name);
            });
            setSquadList(filtered);
          }
        }
      } catch (_) {}
    };

    fetchBaotaSquad();
    const squadInterval = setInterval(fetchBaotaSquad, 4000); // Poll every 4 seconds for real-time name & squad sync

    return () => {
      unsubscribe();
      clearInterval(squadInterval);
    };
  }, [effectiveMyPhone]);

  // 2. Real-time 20s location updates purely via Alibaba Cloud Baota Server Panel API (/api/driver/locations) & dbProxy
  useEffect(() => {
    let unsubscribe = () => {};
    if (db) {
      const q = collection(db, 'driver_locations');
      unsubscribe = onSnapshot(q, (snapshot) => {
        const locMap: Record<string, any> = {};
        snapshot.forEach((docSnap) => {
          locMap[docSnap.id] = docSnap.data();
        });
        setRealtimeLocations((prev) => ({ ...prev, ...locMap }));
      }, () => {});
    }

    const fetchBaotaLocations = async () => {
      if (document.hidden) return; // Background render throttling (Save battery)
      try {
        const baseUrl = getBaseApiUrl();
        const res = await fetch(`${baseUrl}/api/driver/locations`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.locations) {
            setRealtimeLocations((prev) => ({ ...prev, ...data.locations }));
          }
        }
      } catch (_) {}
    };

    fetchBaotaLocations();
    const interval = setInterval(fetchBaotaLocations, 4000); // 4s polling when visible

    // Instant catchup when switching back to foreground
    const handleVisibilityCatchup = () => {
      if (!document.hidden) {
        fetchBaotaLocations();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityCatchup);

    return () => {
      unsubscribe();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityCatchup);
    };
  }, []);

  // Initialize Gaode AMap 2.0
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let isDisposed = false;
    let pollTimer: any = null;

    const initMap = (AMap: any) => {
      if (isDisposed || !mapContainerRef.current) return;

      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.destroy();
        } catch (_) {}
        mapInstanceRef.current = null;
      }

      const centerLng = gpsLocation.lng || 106.2350;
      const centerLat = gpsLocation.lat || 38.4830;

      let map: any = null;
      try {
        map = new AMap.Map(mapContainerRef.current, {
          zoom: 15.5,
          center: [centerLng, centerLat],
          viewMode: '2D',
          resizeEnable: true,
          mapStyle: 'amap://styles/normal'
        });
      } catch (err) {
        console.warn('Fallback initializing basic AMap without style:', err);
        try {
          map = new AMap.Map(mapContainerRef.current, {
            zoom: 15.5,
            center: [centerLng, centerLat],
            viewMode: '2D',
            resizeEnable: true
          });
        } catch (e2) {
          console.error('Failed to create AMap instance in NearbyMapView:', e2);
          return;
        }
      }

      mapInstanceRef.current = map;

      // Ensure map re-measures container layout on screen after paint
      setTimeout(() => {
        if (!isDisposed && mapInstanceRef.current) {
          try {
            window.dispatchEvent(new Event('resize'));
          } catch (_) {}
        }
      }, 300);

      // Geolocation for high precision GPS
      if (AMap.plugin) {
        AMap.plugin(['AMap.Geolocation'], () => {
          if (isDisposed || !mapInstanceRef.current) return;
          try {
            const geolocation = new AMap.Geolocation({
              enableHighAccuracy: true,
              timeout: 8000,
              showButton: false,
              showMarker: false,
              showCircle: false
            });

            geolocation.getCurrentPosition((status: string, result: any) => {
              if (isDisposed) return;
              if (status === 'complete' && result && result.position) {
                const curLng = result.position.lng;
                const curLat = result.position.lat;
                setGpsLocation({ lng: curLng, lat: curLat });
                if (mapInstanceRef.current) {
                  mapInstanceRef.current.setCenter([curLng, curLat]);
                }
              }
            });
          } catch (geoErr) {
            console.warn('AMap.Geolocation init warning:', geoErr);
          }
        });
      }

      setMapLoaded(true);

      // Clean up Gaode AMap logo and copyright watermark safely without removing map tiles
      const purgeAmapLogos = () => {
        if (!mapContainerRef.current) return;
        const targets = mapContainerRef.current.querySelectorAll(
          '.amap-logo, .amap-copyright, [class*="amap-logo"], [class*="amap-copyright"]'
        );
        targets.forEach((el: any) => {
          if (el) {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('opacity', '0', 'important');
          }
        });
      };

      purgeAmapLogos();
      map.on('complete', purgeAmapLogos);
      const timer = setInterval(purgeAmapLogos, 300);
      setTimeout(() => clearInterval(timer), 5000);
    };

    let attempts = 0;
    const startLoading = () => {
      ensureAMapLoaded().then((AMap) => {
        if (isDisposed) return;
        if (AMap && AMap.Map && mapContainerRef.current) {
          initMap(AMap);
        } else if (attempts < 50) {
          attempts++;
          pollTimer = setTimeout(startLoading, 150);
        }
      }).catch(() => {
        if (attempts < 50 && !isDisposed) {
          attempts++;
          pollTimer = setTimeout(startLoading, 200);
        }
      });
    };

    startLoading();

    return () => {
      isDisposed = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.destroy();
        } catch (_) {}
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update Markers whenever map is loaded, GPS changes, or squad 20s location updates arrive
  useEffect(() => {
    const map = mapInstanceRef.current;
    const AMap = (window as any).AMap;
    if (!map || !AMap || !mapLoaded) return;

    // Clear existing markers
    markersRef.current.forEach((m) => {
      try {
        m.setMap(null);
      } catch (_) {}
    });
    markersRef.current = [];
    if (typeof map.clearMap === 'function') {
      try {
        map.clearMap();
      } catch (_) {}
    }

    const newMarkers: any[] = [];

    // Helper to generate driver marker HTML
    // 规则：
    // 1. 下线状态：灰色 (#64748b / 帽子 #475569)
    // 2. 上线空闲：绿色 (#16a34a / #2e7d32)
    // 3. 做单/报单/接单忙碌：红色 (#dc2626 / #e53935)
    // 4. 严禁紫色
    const createDriverMarkerDom = (name: string, isOnlineState: boolean, isBusy: boolean, isMe: boolean = false) => {
      let tagBg = '#64748b'; // default grey for offline
      let circleFill = '#f1f5f9';
      let bodyFill = '#94a3b8';
      let hatFill = '#475569';
      let statusDesc = '';

      if (!isOnlineState) {
        tagBg = '#64748b';
        circleFill = '#f1f5f9';
        bodyFill = '#94a3b8';
        hatFill = '#475569';
        statusDesc = '<span style="font-size: 9px; opacity: 0.85; margin-left: 2px;">(下线)</span>';
      } else if (isBusy) {
        tagBg = '#e53935';
        circleFill = '#fef2f2';
        bodyFill = '#dc2626';
        hatFill = '#b91c1c';
      } else {
        tagBg = '#2e7d32';
        circleFill = '#f0fdf4';
        bodyFill = '#16a34a';
        hatFill = '#15803d';
      }

      const div = document.createElement('div');
      div.className = 'flex flex-col items-center select-none cursor-pointer';
      div.style.transform = 'translate(-50%, -100%)';
      div.innerHTML = `
        <div style="
          position: relative;
          padding: 3px 8px;
          border-radius: 6px;
          background-color: ${tagBg};
          color: #ffffff;
          font-size: 11px;
          font-weight: 800;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          white-space: nowrap;
          letter-spacing: -0.2px;
          border: 1px solid rgba(255,255,255,0.4);
          ${isMe ? 'outline: 2px solid #ffffff; outline-offset: 1px;' : ''}
        ">
          ${name} ${isMe ? '<span style="font-size: 9px; opacity: 0.9;">(我)</span>' : ''}${statusDesc}
          <div style="
            position: absolute;
            bottom: -5px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 5px solid ${tagBg};
          "></div>
        </div>
        <div style="
          position: relative;
          margin-top: 4px;
          width: ${isMe ? '36px' : '30px'};
          height: ${isMe ? '36px' : '30px'};
          border-radius: 9999px;
          background: #ffffff;
          border: ${isMe ? '3px' : '2px'} solid ${tagBg};
          box-shadow: 0 3px 10px rgba(0,0,0,0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        ">
          <svg viewBox="0 0 32 32" style="width: 100%; height: 100%; padding: 2px;" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="14" fill="${circleFill}"></circle>
            <path d="M8 28C8 22.8 11.5 20.5 16 20.5C20.5 20.5 24 22.8 24 28" fill="${bodyFill}"></path>
            <path d="M13 20.5L16 25L19 20.5" fill="#ffffff"></path>
            <circle cx="16" cy="13.5" r="5.5" fill="${!isOnlineState ? '#cbd5e1' : '#fed7aa'}"></circle>
            <path d="M10.5 12.5C10.5 9 13 7.5 16 7.5C19 7.5 21.5 9 21.5 12.5C20 12.5 18.5 12 16 12C13.5 12 12 12.5 10.5 12.5Z" fill="${hatFill}"></path>
            <path d="M9.5 12.5C11.5 11.5 20.5 11.5 22.5 12.5" stroke="#475569" stroke-width="1.2" stroke-linecap="round"></path>
            <circle cx="14" cy="14" r="0.75" fill="#475569"></circle>
            <circle cx="18" cy="14" r="0.75" fill="#475569"></circle>
          </svg>
        </div>
      `;
      return div;
    };

    // 1. Current Driver "吴彦祖 (我)" (15509601222) - Centered at GPS location
    const meMarker = new AMap.Marker({
      position: [gpsLocation.lng, gpsLocation.lat],
      content: createDriverMarkerDom(currentDriverName, isCurrentDriverOnline, isCurrentDriverBusy, true),
      offset: new AMap.Pixel(0, 0),
      zIndex: 150,
      title: `${currentDriverName} (我的位置) - ${!isCurrentDriverOnline ? '下线/离线' : (isCurrentDriverBusy ? '做单中' : '空闲')}`
    });
    meMarker.setMap(map);
    newMarkers.push(meMarker);

    // 2. Real Squad Members & Drivers (Alibaba Cloud Baota Panel & Firestore)
    // 严格规则：
    // - 只有当前登录软件app的司机本人显示全名（如“吴彦祖 (我)”），下线显示“吴彦祖 (我)(下线)”
    // - 其他上线的司机显示隐藏名字（如“李扬”->“李师傅”，“王元平”->“王师傅”，改名“A李扬”->“A李师傅”）
    // - 所有下线的其他司机：名字、头像、Marker图标绝不显示，不让任何人看见下线的司机
    const candidateDriversMap = new Map<string, {
      phone: string;
      name: string;
      lat: number;
      lng: number;
      isOnline: boolean;
      isBusy: boolean;
      uploadTime: number;
    }>();

    // Collect from squadList
    squadList.forEach((member) => {
      const phone = String(member.phone || member.id || '').replace(/\D/g, '').trim();
      const name = String(member.name || member.driverName || '').trim();
      if (!phone || isMeMember(phone, name) || removedPhones.includes(phone)) return;
      candidateDriversMap.set(phone, {
        phone,
        name,
        lat: member.lat !== undefined ? Number(member.lat) : 0,
        lng: member.lng !== undefined ? Number(member.lng) : 0,
        isOnline: Boolean(member.isOnline === true || member.isOnline === 'true'),
        isBusy: Boolean(member.isBusy === true || member.isBusy === 'true'),
        uploadTime: member.lastUpdatedTime ? new Date(member.lastUpdatedTime).getTime() : 0
      });
    });

    // Merge/Overlay live locations from Baota / Firestore (primary source of truth)
    Object.keys(realtimeLocations).forEach((phoneKey) => {
      const liveLoc = realtimeLocations[phoneKey];
      if (!liveLoc) return;
      const phone = String(liveLoc.phone || liveLoc.driverPhone || phoneKey || '').replace(/\D/g, '').trim();
      const name = String(liveLoc.driverName || liveLoc.name || '').trim();
      if (!phone || isMeMember(phone, name) || removedPhones.includes(phone)) return;

      const existing = candidateDriversMap.get(phone);

      const lat = liveLoc.lat !== undefined ? Number(liveLoc.lat) : (existing?.lat || 0);
      const lng = liveLoc.lng !== undefined ? Number(liveLoc.lng) : (existing?.lng || 0);
      const isOnline = liveLoc.isOnline !== undefined
        ? Boolean(liveLoc.isOnline === true || liveLoc.isOnline === 'true')
        : (existing?.isOnline || false);
      const isBusy = liveLoc.isBusy !== undefined
        ? Boolean(liveLoc.isBusy === true || liveLoc.isBusy === 'true')
        : (existing?.isBusy || false);
      const uploadTime = liveLoc.timestamp
        ? Number(liveLoc.timestamp)
        : (liveLoc.lastUpdatedTime ? new Date(liveLoc.lastUpdatedTime).getTime() : (existing?.uploadTime || 0));
      
      const candidateName = existing?.name || name || '';
      const resolvedName = resolveDriverRealName(phone, candidateName);

      candidateDriversMap.set(phone, {
        phone,
        name: resolvedName,
        lat,
        lng,
        isOnline,
        isBusy,
        uploadTime
      });
    });

    // Render other drivers according to Hubble settings
    candidateDriversMap.forEach((driver) => {
      // 1. Strictly exclude current driver "我" or removed drivers
      if (isMeMember(driver.phone, driver.name) || removedPhones.includes(driver.phone)) return;

      // 2. 必须有真实有效GPS坐标
      if (!driver.lat || !driver.lng || isNaN(driver.lat) || isNaN(driver.lng) || driver.lat === 0 || driver.lng === 0) return;

      // 3. 状态筛选判断
      if (driver.isOnline) {
        // 在线状态分流
        if (driver.isBusy) {
          if (!hubbleFilters.showBusy) return;
        } else {
          if (!hubbleFilters.showIdle) return;
        }
      } else {
        // 下线司机
        if (!hubbleFilters.showOffline) return;
      }

      // 4. 名字显示逻辑：若勾选显示全名，则显示真实全名；否则隐藏为“X师傅”
      const rawName = resolveDriverRealName(driver.phone, driver.name);
      const displayName = hubbleFilters.showFullName ? rawName : formatDriverMaskedName(rawName);

      const driverMarker = new AMap.Marker({
        position: [driver.lng, driver.lat],
        content: createDriverMarkerDom(displayName, driver.isOnline, driver.isBusy, false),
        offset: new AMap.Pixel(0, 0),
        zIndex: 100,
        title: `${displayName} - ${!driver.isOnline ? '下线状态(离线位置)' : (driver.isBusy ? '做单中' : '空闲接单中')}`
      });
      driverMarker.setMap(map);
      newMarkers.push(driverMarker);
    });

    markersRef.current = newMarkers;
  }, [mapLoaded, gpsLocation, isCurrentDriverOnline, isCurrentDriverBusy, currentDriverName, squadList, realtimeLocations, effectiveMyPhone, removedPhones, hubbleFilters]);

  // Center map on current GPS location
  const handleRecenter = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setZoomAndCenter(15.5, [gpsLocation.lng, gpsLocation.lat]);
    }
  };

  const handleZoomIn = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomOut();
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-[#e6f2f8] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 select-none">
      {/* Real Gaode AMap 2.0 Container with top spacing reserved for phone status bar */}
      <main className="relative flex-1 w-full h-full overflow-hidden">
        <div 
          ref={mapContainerRef} 
          className="w-full h-full bg-[#eef5f9]"
          style={{ width: '100%', height: '100%' }}
        />

        {/* Floating Right Controls Panel (Top positioned below status bar space - hidden when sub-pages/modals are active) */}
        {!showHubbleSettingsDialog && !showHubbleModal && !showSquadDriverList && (
          <aside 
            className="absolute right-2.5 z-20 flex flex-col items-end space-y-3"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          >
            {/* Primary Modes Stack: 大厅 / 司机 / 商家 (点击显示开发中) */}
            <div className="w-[50px] bg-white rounded-xl shadow-lg flex flex-col items-center divide-y divide-gray-100 overflow-hidden py-0.5 border border-slate-100">
              {/* 哈勃 (Hubble / Telescope) */}
              <button 
                type="button"
                onClick={handleHubbleClick}
                className="w-full py-2 flex flex-col items-center justify-center hover:bg-slate-50 active:scale-95 transition cursor-pointer"
              >
                <div className="w-6 h-6 bg-sky-500 rounded flex items-center justify-center text-white shadow-2xs">
                  <Telescope className="w-3.5 h-3.5" />
                </div>
                <span className="text-[11px] text-gray-700 mt-1 font-extrabold scale-90">哈勃</span>
              </button>

              {/* 司机 (Driver) -> 打开“小队司机列表”新页面 */}
              <button 
                type="button"
                onClick={() => setShowSquadDriverList(true)}
                className="w-full py-2 flex flex-col items-center justify-center hover:bg-slate-50 active:scale-95 transition cursor-pointer"
                title="小队司机列表"
              >
                <div className="w-6 h-6 flex items-center justify-center text-emerald-500">
                  <Car className="w-5 h-5" />
                </div>
                <span className="text-[11px] text-gray-700 mt-0.5 font-extrabold scale-90">司机</span>
              </button>

              {/* 商家 (Merchant) */}
              <button 
                type="button"
                onClick={() => triggerDevToast('开发中')}
                className="w-full py-2 flex flex-col items-center justify-center hover:bg-slate-50 active:scale-95 transition cursor-pointer"
              >
                <div className="w-6 h-6 flex items-center justify-center text-amber-500">
                  <Store className="w-4.5 h-4.5" />
                </div>
                <span className="text-[11px] text-gray-700 mt-0.5 font-extrabold scale-90">商家</span>
              </button>
            </div>

            {/* Zoom Controls */}
            <div className="w-[44px] bg-white rounded-xl shadow-lg flex flex-col items-center divide-y divide-gray-100 overflow-hidden border border-slate-100">
              <button 
                type="button"
                onClick={handleZoomIn}
                className="w-full h-10 flex items-center justify-center text-gray-700 hover:bg-gray-50 active:scale-90 font-light cursor-pointer"
              >
                <Plus className="w-4.5 h-4.5 text-slate-600" />
              </button>
              <button 
                type="button"
                onClick={handleZoomOut}
                className="w-full h-10 flex items-center justify-center text-gray-700 hover:bg-gray-50 active:scale-90 font-light cursor-pointer"
              >
                <Minus className="w-4.5 h-4.5 text-slate-600" />
              </button>
            </div>

            {/* Locate User Button (Crosshair) */}
            <button 
              type="button"
              onClick={handleRecenter}
              className="w-[44px] h-[44px] bg-white rounded-xl shadow-lg flex items-center justify-center text-gray-700 hover:bg-gray-50 active:scale-95 border border-slate-100 cursor-pointer"
            >
              <Crosshair className="w-5 h-5 text-slate-700" />
            </button>
          </aside>
        )}

        {/* Warning Toast Banner - hidden when sub-pages/modals are active */}
        {!showHubbleSettingsDialog && !showHubbleModal && !showSquadDriverList && (
          <div className="absolute bottom-4 left-0 right-0 px-4 flex justify-center z-20 pointer-events-auto">
            <div className="bg-white/95 backdrop-blur-md px-3.5 py-1.5 rounded-full shadow-md flex items-center space-x-1.5 border border-amber-100">
              <Volume2 className="w-4 h-4 text-orange-500 shrink-0" />
              <span className="text-orange-600 text-[11px] font-bold tracking-tight">
                如果当前定位地址与实际偏差过大，请重启app
              </span>
            </div>
          </div>
        )}

        {/* Dev Toast Notification */}
        {devToast && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-slate-900/85 backdrop-blur-sm text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xl animate-in fade-in zoom-in-95 duration-150">
            {devToast}
          </div>
        )}
      </main>

      {/* Bottom Navigation Bar (Enhanced Safe Area for All Android Navigation Bars) */}
      <nav 
        className="relative z-30 bg-white border-t border-gray-200/80 pt-2.5 px-6 sm:px-12 flex justify-between items-center select-none shrink-0 android-nav-safe-pb"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 18px)' }}
      >
        {/* Tab: 首页 (Home) */}
        <button 
          type="button"
          onClick={onClose}
          className="flex flex-col items-center justify-center text-slate-600 hover:text-slate-900 group cursor-pointer transition-all active:scale-95 min-w-[56px]"
        >
          <Home className="w-5.5 h-5.5 text-slate-400 group-hover:text-slate-800 transition" />
          <span className="text-[11px] text-slate-600 mt-0.5 font-bold">首页</span>
        </button>

        {/* Center Action Button: 定位 (Green Circle with "附近" text) */}
        <div className="-mt-5 flex flex-col items-center justify-center group cursor-pointer" onClick={handleRecenter}>
          <button 
            type="button"
            className="w-12 h-12 rounded-full bg-emerald-500 shadow-lg shadow-emerald-600/30 flex items-center justify-center text-white active:scale-95 transition-transform cursor-pointer border-2 border-white"
          >
            <Navigation className="w-5 h-5 text-white fill-current transform -rotate-45" />
          </button>
          <span className="text-[11px] text-slate-700 mt-1 font-bold">附近</span>
        </div>

        {/* Right Label: 恭喜你已加入小队 (静态展示，点击无任何效果) */}
        <div className="flex flex-col items-center justify-center text-emerald-600 select-none">
          <div className="flex items-center space-x-1">
            <Users className="w-4 h-4 text-emerald-500" />
            <span className="text-[11px] text-emerald-600 font-extrabold whitespace-nowrap">恭喜你已加入小队</span>
          </div>
        </div>
      </nav>

      {/* iOS / Android Home Indicator Safe Space */}
      <div className="w-full h-1 bg-transparent pointer-events-none"></div>

      {/* 小队司机列表新页面 / 弹窗 (适配手机状态栏与安卓导航栏) */}
      {showSquadDriverList && (
        <SquadDriverList 
          userPhone={effectiveMyPhone}
          settings={settings}
          isOnline={isCurrentDriverOnline}
          currentTrip={currentTrip}
          todayOrdersCount={todayOrdersCount}
          onClose={() => setShowSquadDriverList(false)}
        />
      )}

      {/* 哈勃管理中心对话框 (开发者权限管理 & 授权司机进入哈勃设置) */}
      {showHubbleModal && (
        <HubbleManagerModal
          userPhone={effectiveMyPhone}
          isDeveloper={isDeveloperUser}
          onClose={() => setShowHubbleModal(false)}
          onOpenHubbleSettings={() => {
            setShowHubbleModal(false);
            setShowHubbleSettingsDialog(true);
            triggerDevToast('已进入哈勃设置');
          }}
        />
      )}

      {/* 哈勃设置独立弹窗 (空闲中/做单中/下线司机/显示全名 & 司机搜索定位) */}
      {showHubbleSettingsDialog && (
        <HubbleSettingsDialog
          initialSettings={hubbleFilters}
          onConfirm={(newSettings) => {
            setHubbleFilters(newSettings);
            setShowHubbleSettingsDialog(false);
            triggerDevToast('哈勃地图显示设置已生效');
          }}
          onClose={() => {
            setShowHubbleSettingsDialog(false);
          }}
          onSearchDriver={(query) => {
            handleHubbleSearchDriver(query);
          }}
          searchFeedback={hubbleSearchFeedback}
        />
      )}
    </div>
  );
}
