import React, { useState, useEffect } from 'react';
import TencentMap from './TencentMap';
import { db, doc, setDoc, onSnapshot, getBaseApiUrl } from '../lib/dbProxy';
import driverAvatar from '../assets/images/driver_cycling_helmet_avatar_1784017817358.jpg';
import { DRIVER_AVATAR_BASE64, READY_DRIVER_BASE64, READY_DRIVER_PATH, WECHAT_CARD_BANNER_BASE64, WECHAT_CARD_BANNER_PATH } from '../assets/images/driverImageConstants';
import { 
  Phone, 
  MapPin, 
  Navigation, 
  Copy, 
  Check, 
  FileCode, 
  ArrowRight, 
  ShieldCheck, 
  Smartphone,
  CloudRain,
  Compass,
  AlertCircle,
  Plus,
  Minus,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  Map,
  Share2
} from 'lucide-react';

const YINCHUAN_POIS = [
  { name: '唐徕小学', address: '宁夏回族自治区银川市兴庆区唐徕小区内', lng: 106.2285, lat: 38.4842 },
  { name: '唐徕小区', address: '宁夏回族自治区银川市兴庆区唐徕路与新华西街交叉口', lng: 106.2275, lat: 38.4838 },
  { name: '大阅城', address: '宁夏回族自治区银川市金凤区正源北街建发大阅城', lng: 106.2205, lat: 38.5175 },
  { name: '（和平巷）颐和家园', address: '宁夏回族自治区银川市兴庆区和平巷颐和家园', lng: 106.230912, lat: 38.487193 },
  { name: '和枫颐景', address: '宁夏回族自治区银川市兴庆区和枫路与和平巷交叉口东 100 米', lng: 106.2312, lat: 38.4878 },
  { name: '鲜西域生鲜超市', address: '宁夏回族自治区银川市兴庆区和枫路与和平巷交叉口东 50 米', lng: 106.230112, lat: 38.487093 },
  { name: '二哥辣炒小公鸡', address: '宁夏回族自治区银川市兴庆区和枫路 104 号', lng: 106.231212, lat: 38.487393 },
  { name: '万家香鲜蔬果屋', address: '宁夏回族自治区银川市兴庆区和平巷 12 号', lng: 106.230712, lat: 38.486993 },
  { name: '银川市人民政府', address: '宁夏回族自治区银川市金凤区北京中路 166 号', lng: 106.2223, lat: 38.4908 },
  { name: '春晓园', address: '宁夏回族自治区银川市兴庆区中山北街 204 号', lng: 106.2305, lat: 38.4875 },
  { name: '瑞丰小酒楼 (湖滨东街店)', address: '兴庆区湖滨东街 139 号', lng: 106.2335, lat: 38.4845 },
  { name: '长相忆宾馆 (银川鼓楼玉皇阁店)', address: '兴庆区玉皇阁北街 120 号', lng: 106.2315, lat: 38.4825 },
  { name: '银川市第三人民医院', address: '玉皇阁北街 8 号', lng: 106.2285, lat: 38.4815 },
  { name: '建发大阅城', address: '金凤区正源北街与万寿路交汇处', lng: 106.2205, lat: 38.5175 },
  { name: '银川火车站', address: '金凤区上海西路', lng: 106.1805, lat: 38.4975 },
  { name: '新华百货(鼓楼店)', address: '兴庆区新华东街', lng: 106.2355, lat: 38.4815 },
  { name: '宁夏大学(本部)', address: '西夏区贺兰山西路 489 号', lng: 106.1405, lat: 38.5075 },
  { name: '万达广场写字楼A座', address: '金凤区正源北街22号', lng: 106.2225, lat: 38.4885 },
  { name: '金凤万达广场', address: '金凤区正源北街与上海路交汇处', lng: 106.2215, lat: 38.4895 },
  { name: '宁夏医科大学总医院', address: '兴庆区胜利街21号', lng: 106.2345, lat: 38.4485 },
  { name: '玉皇阁', address: '兴庆区解放东街与玉皇阁北街交叉口', lng: 106.2325, lat: 38.4835 },
  { name: '中山公园', address: '兴庆区公园街', lng: 106.2225, lat: 38.4855 }
];

const getSimulationPointOverride = (lng: number, lat: number) => {
  const overrides = [
    { name: '（和平巷）颐和家园', address: '宁夏回族自治区银川市兴庆区和平巷颐和家园', lng: 106.230912, lat: 38.487193 },
    { name: '和枫颐景', address: '宁夏回族自治区银川市兴庆区中山北街与和枫路交叉口东 100 米', lng: 106.2312, lat: 38.4878 },
    { name: '鲜西域生鲜超市', address: '宁夏回族自治区银川市兴庆区和枫路与和平巷交叉口东 50 米', lng: 106.230112, lat: 38.487093 },
    { name: '二哥辣炒小公鸡', address: '宁夏回族自治区银川市兴庆区和枫路 104 号', lng: 106.231212, lat: 38.487393 },
    { name: '万家香鲜蔬果屋', address: '宁夏回族自治区银川市兴庆区和平巷 12 号', lng: 106.230712, lat: 38.486993 },
    { name: '银川市人民政府', address: '宁夏回族自治区银川市金凤区北京中路 166 号', lng: 106.2223, lat: 38.4908 },
  ];
  for (const item of overrides) {
    const dist = getDistance(lng, lat, item.lng, item.lat);
    if (dist < 150) { // Within 150 meters, match exactly for simulation fidelity
      return item;
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

const getClosestLocalPoi = (lng: number, lat: number) => {
  let closest = YINCHUAN_POIS[0];
  let minDist = Infinity;
  for (const poi of YINCHUAN_POIS) {
    const dist = getDistance(lng, lat, poi.lng, poi.lat);
    if (dist < minDist) {
      minDist = dist;
      closest = poi;
    }
  }
  return closest;
};

const getHighPrecisionLocationName = (regeocode: any, fallbackAddress: string, centerLng?: number, centerLat?: number): string => {
  if (!regeocode) return fallbackAddress || '未知地点';
  
  const addressComponent = regeocode.addressComponent;
  const district = addressComponent ? (addressComponent.district || '') : '';
  const township = addressComponent ? (addressComponent.township || '') : '';
  
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
        return { lng: parseFloat(parts[0]), lat: parseFloat(parts[1] || '0') };
      }
    }
    return null;
  };

  const getPoiDistance = (poi: any, cLng?: number, cLat?: number): number => {
    if (cLng !== undefined && cLat !== undefined) {
      const loc = getPoiLngLat(poi);
      if (loc) {
        return getDistance(cLng, cLat, loc.lng, loc.lat);
      }
    }
    if (poi.distance !== undefined && poi.distance !== null && poi.distance !== '') {
      const dist = Number(poi.distance);
      if (!isNaN(dist)) return dist;
    }
    return 999999;
  };

  const minorStoreKeywords = [
    '面馆', '砂锅面', '调和', '牛肉面', '羊肉', '饭店', '餐馆', '小吃', '快餐', '便利店', '超市', 
    '烟酒', '理发', '美发', '药店', '水果', '熟食', '烧烤', '火锅', '菜馆', '鲜花', '修车', 
    '洗车', '麻将', '棋牌', '网吧', '足浴', 'SPA', '客栈', '旅馆', '烤鸭', '奶茶', '大排档'
  ];

  let neighborhoodName = '';
  if (addressComponent && addressComponent.neighborhood) {
    neighborhoodName = typeof addressComponent.neighborhood === 'string'
      ? addressComponent.neighborhood
      : (addressComponent.neighborhood.name || '');
  }

  let aoiName = '';
  if (regeocode.aois && regeocode.aois.length > 0 && regeocode.aois[0] && regeocode.aois[0].name) {
    aoiName = regeocode.aois[0].name;
  }

  const communityName = neighborhoodName.trim() || aoiName.trim();

  let poiName = '';
  if (regeocode.pois && regeocode.pois.length > 0) {
    const validPois = regeocode.pois.filter((poi: any) => {
      const name = (poi.name || '').trim();
      return name !== '银川' && name !== '银川市' && name !== '市辖区' && name !== '兴庆区' && name !== '金凤区' && name !== '西夏区';
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
  }

  if (poiName) {
    return poiName;
  }

  const cleanFormat = fallbackAddress
    .replace('宁夏回族自治区', '')
    .replace('银川市', '')
    .replace(district, '')
    .replace(township, '')
    .trim();

  return cleanFormat || fallbackAddress;
};

interface WeChatMiniSimulatorProps {
  currentDriverPhone: string | null;
  onTriggerToast: (msg: string) => void;
}

export default function WeChatMiniSimulator({ currentDriverPhone, onTriggerToast }: WeChatMiniSimulatorProps) {
  // Simulator Interactive States
  const [targetDriver, setTargetDriver] = useState(currentDriverPhone || '18609518888');
  const [passengerPhone, setPassengerPhone] = useState('13988889999');
  const [startPoint, setStartPoint] = useState('（和平巷）颐和家园');
  const [destination, setDestination] = useState('');
  const [isRainy, setIsRainy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderStatus, setOrderStatus] = useState<'idle' | 'success' | 'profile' | 'about' | 'rules' | 'agreement' | 'privacy' | 'select-start' | 'select-dest' | 'driver-register'>('idle');
  const [privacyBackTo, setPrivacyBackTo] = useState<'profile' | 'driver-register'>('profile');
  const [isLogOutConfirmMode, setIsLogOutConfirmMode] = useState<boolean>(false);
  const [selectedLocationIndex, setSelectedLocationIndex] = useState<number>(0);
  const [selectedLocName, setSelectedLocName] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  // WeChat Native address-form Plugin States
  const [addressReceiver, setAddressReceiver] = useState<string>('张伟');
  const [addressPhone, setAddressPhone] = useState<string>('13988889999');
  const [addressArea, setAddressArea] = useState<string>('宁夏回族自治区 银川市 兴庆区');
  const [addressLabel, setAddressLabel] = useState<string>('家');
  const [addressIsDefault, setAddressIsDefault] = useState<boolean>(false);
  const [showAreaPicker, setShowAreaPicker] = useState<boolean>(false);
  const [showMapSelector, setShowMapSelector] = useState<boolean>(false);
  const [aiInputText, setAiInputText] = useState<string>('');
  const [showAiInput, setShowAiInput] = useState<boolean>(false);

  // Driver Registration States
  const [registerPhone, setRegisterPhone] = useState<string>('');
  const [registerCode, setRegisterCode] = useState<string>('');
  const [registerCountdown, setRegisterCountdown] = useState<number>(0);
  const [sentCode, setSentCode] = useState<string>('');
  const [driverRegStep, setDriverRegStep] = useState<'login' | 'form' | 'agreement' | 'success'>('login');
  const [driverRegName, setDriverRegName] = useState<string>('');
  const [driverRegIdCard, setDriverRegIdCard] = useState<string>('');
  const [driverRegCompany, setDriverRegCompany] = useState<string>('银川');
  const [driverRegGender, setDriverRegGender] = useState<'male' | 'female'>('male');
  const [driverRegJobType, setDriverRegJobType] = useState<'full' | 'part'>('full');
  const [driverRegEmergencyContact, setDriverRegEmergencyContact] = useState<string>('');
  const [driverRegEmergencyPhone, setDriverRegEmergencyPhone] = useState<string>('');
  const [driverRegIdPhoto, setDriverRegIdPhoto] = useState<string>('');
  const [driverRegIdPhotoBack, setDriverRegIdPhotoBack] = useState<string>('');
  const [driverRegLicensePhoto, setDriverRegLicensePhoto] = useState<string>('');
  const [driverRegLicenseType, setDriverRegLicenseType] = useState<string>('A1');
  const [driverRegIssueDate, setDriverRegIssueDate] = useState<string>('');
  const [driverRegAgreed, setDriverRegAgreed] = useState<boolean>(false);
  const [driverApplicationStatus, setDriverApplicationStatus] = useState<string>('pending');
  const [isSendingCode, setIsSendingCode] = useState<boolean>(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState<boolean>(false);
  const [isSubmittingReg, setIsSubmittingReg] = useState<boolean>(false);

  // Helper to check if driver registration form and images are fully completed
  const isDriverRegFormComplete = () => {
    return (
      driverRegName.trim() !== '' &&
      driverRegIdCard.trim() !== '' &&
      /^\d{17}[\dXx]$/.test(driverRegIdCard.trim()) &&
      driverRegCompany.trim() !== '' &&
      driverRegEmergencyContact.trim() !== '' &&
      driverRegEmergencyPhone.trim().length === 11 &&
      driverRegIdPhoto !== '' &&
      driverRegIdPhotoBack !== '' &&
      driverRegLicensePhoto !== '' &&
      driverRegIssueDate !== ''
    );
  };

  const handleAgreementClick = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!isDriverRegFormComplete()) {
      onTriggerToast('⚠️ 请先填写完所有的基本信息并上传所有的图片，再勾选同意协议！');
      setDriverRegAgreed(false);
      return;
    }
    setDriverRegAgreed(!driverRegAgreed);
  };

  // Tencent Map interactive states
  const [tencentMapCenter, setTencentMapCenter] = useState({ lat: 38.487193, lng: 106.230912 });
  const [tencentMapZoom, setTencentMapZoom] = useState(17);
  const [tencentPois, setTencentPois] = useState<any[]>([]);
  const [poisLoading, setPoisLoading] = useState(false);

  // Code Tab state: 'simulator' or 'code'
  const [activeTab, setActiveTab] = useState<'simulator' | 'code'>('simulator');
  const [codeFile, setCodeFile] = useState<'wxml' | 'wxss' | 'js' | 'json'>('wxml');
  const [copied, setCopied] = useState(false);

  // Sync target driver if the current driver phone changes
  useEffect(() => {
    if (currentDriverPhone) {
      setTargetDriver(currentDriverPhone);
    }
  }, [currentDriverPhone]);

  // Countdown timer for driver registration verification code
  useEffect(() => {
    if (registerCountdown > 0) {
      const timer = setTimeout(() => {
        setRegisterCountdown(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [registerCountdown]);

  // Persistent Login logic: keep user logged in unless they click "退出登录"
  useEffect(() => {
    const savedPhone = localStorage.getItem('driver_register_phone');
    const savedStep = localStorage.getItem('driver_register_step');
    if (savedPhone && savedStep && savedStep !== 'login') {
      setRegisterPhone(savedPhone);
      setDriverRegStep(savedStep as any);
    }
  }, []);

  useEffect(() => {
    if (driverRegStep) {
      localStorage.setItem('driver_register_step', driverRegStep);
    }
    if (registerPhone) {
      localStorage.setItem('driver_register_phone', registerPhone);
    }
  }, [driverRegStep, registerPhone]);

  useEffect(() => {
    if (!registerPhone) {
      setDriverApplicationStatus('pending');
      return;
    }
    const docRef = doc(db, 'online_applications', registerPhone);
    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      if (snapshot && snapshot.exists()) {
        const data = snapshot.data();
        if (data && data.status) {
          setDriverApplicationStatus(data.status);
        } else {
          setDriverApplicationStatus('pending');
        }
      } else {
        setDriverApplicationStatus('pending');
      }
    });
    return () => unsubscribe();
  }, [registerPhone]);

  const fetchPoisForCoords = (lng: number, lat: number, isInitial = false) => {
    setPoisLoading(true);
    
    const handleResults = (centerName: string, centerAddress?: string) => {
      // Create first result which represents the exact geolocated/center address
      const firstResult = {
        name: centerName,
        address: centerAddress || centerName,
        distance: '0m',
        isCurrentLocation: isInitial,
        isCenter: !isInitial,
        lng,
        lat
      };

      // Generate 6 sub-POIs dynamically based on centerName to ensure extremely high fidelity simulation
      const cleanName = centerName.trim();
      const cleanAddress = (centerAddress || centerName).trim();
      
      const subPoiTemplates = [
        { suffix: ' (东门)', addrSuffix: '东侧出入口' },
        { suffix: ' (西门)', addrSuffix: '西侧出入口' },
        { suffix: ' (南门)', addrSuffix: '南侧正门' },
        { suffix: ' (北门)', addrSuffix: '北侧通道' },
        { suffix: ' (地下停车场)', addrSuffix: '地下车库入口' },
        { suffix: ' (停车场)', addrSuffix: '地面硬化停车场' },
        { suffix: ' (1号楼)', addrSuffix: '1号楼单元楼口' },
        { suffix: ' (2号楼)', addrSuffix: '2号楼底商门口' },
        { suffix: ' (A座)', addrSuffix: 'A座写字楼大堂' },
        { suffix: ' (B座)', addrSuffix: 'B座商务中心' },
        { suffix: ' (正门)', addrSuffix: '正门大堂入口' },
        { suffix: ' (公交站)', addrSuffix: '公交站台旁' },
        { suffix: '-生活便利店', addrSuffix: '底商便利超市' },
        { suffix: '-综合服务中心', addrSuffix: '社区物业服务大厅' },
      ];

      // Shuffle templates and take exactly 6
      const shuffledTemplates = [...subPoiTemplates].sort(() => 0.5 - Math.random());
      const selectedTemplates = shuffledTemplates.slice(0, 6);
      
      const generatedSubPois = selectedTemplates.map((template, idx) => {
        const dist = [18, 35, 62, 89, 124, 158][idx] || (20 + idx * 25);
        // Calculate coordinate offsets for visual completeness on the map if displayed
        const angle = (idx * 2 * Math.PI) / 6;
        const offsetLng = (dist / 111000) * Math.cos(angle);
        const offsetLat = (dist / 111000) * Math.sin(angle);
        
        return {
          name: `${cleanName}${template.suffix}`,
          address: `${cleanAddress}${template.addrSuffix}`,
          distance: `${dist}m`,
          rawDistance: dist,
          lng: lng + offsetLng,
          lat: lat + offsetLat
        };
      });

      // Combine: First result, then the 6 generated sub-POIs
      const finalPois = [firstResult, ...generatedSubPois];
      setTencentPois(finalPois);
      setSelectedLocationIndex(0);
      
      // Update selected start point to centerName immediately
      if (isInitial || orderStatus === 'select-start') {
        setStartPoint(centerName);
      } else if (orderStatus === 'select-dest') {
        setDestination(centerName);
      }
      setPoisLoading(false);
    };

    // Check custom simulation override first to bypass incorrect physical/IP geocoding in sandbox
    const simOverride = getSimulationPointOverride(lng, lat);
    if (simOverride) {
      handleResults(simOverride.name, simOverride.address);
      return;
    }

    const AMap = (window as any).AMap;
    if (AMap) {
      AMap.plugin('AMap.Geocoder', () => {
        try {
          const geocoder = new AMap.Geocoder({
            city: '银川市',
            extensions: 'all'
          });
          geocoder.getAddress([lng, lat], (status: string, result: any) => {
            if (status === 'complete' && result.regeocode) {
              const addressName = getHighPrecisionLocationName(
                result.regeocode, 
                result.regeocode.formattedAddress, 
                lng, 
                lat
              );
              let streetAddress = result.regeocode.formattedAddress || addressName;
              streetAddress = streetAddress.replace('宁夏回族自治区', '').replace('银川市', '').trim();
              handleResults(addressName, streetAddress);
            } else {
              const closestPoi = getClosestLocalPoi(lng, lat);
              handleResults(closestPoi.name, closestPoi.address);
            }
          });
        } catch (err) {
          console.warn("Error inside AMap Geocoder:", err);
          const closestPoi = getClosestLocalPoi(lng, lat);
          handleResults(closestPoi.name, closestPoi.address);
        }
      });
    } else {
      const closestPoi = getClosestLocalPoi(lng, lat);
      handleResults(closestPoi.name, closestPoi.address);
    }
  };

  const triggerWeChatGeolocate = () => {
    setPoisLoading(true);
    // For selecting departure (select-start), always center on the physical current location of the user (which is （和平巷）颐和家园)
    // For selecting destination (select-dest), we center on the destination if it exists, otherwise default to current location
    let defaultLng = 106.230912;
    let defaultLat = 38.487193;

    if (orderStatus === 'select-dest' && destination) {
      const knownPoi = YINCHUAN_POIS.find(poi => poi.name === destination);
      if (knownPoi) {
        defaultLng = knownPoi.lng;
        defaultLat = knownPoi.lat;
      }
    }

    setTencentMapCenter({ lat: defaultLat, lng: defaultLng });
    setTencentMapZoom(17);
    fetchPoisForCoords(defaultLng, defaultLat, true);
  };

  const getSearchLocations = () => {
    if (!searchKeyword.trim()) {
      return tencentPois;
    }
    
    const lowerKeyword = searchKeyword.toLowerCase();
    const seenNames = new Set<string>();
    const results: any[] = [];
    
    for (const poi of tencentPois) {
      if (poi.name.toLowerCase().includes(lowerKeyword) || poi.address.toLowerCase().includes(lowerKeyword)) {
        results.push(poi);
        seenNames.add(poi.name);
      }
    }
    
    for (const poi of YINCHUAN_POIS) {
      if (seenNames.has(poi.name)) continue;
      if (poi.name.toLowerCase().includes(lowerKeyword) || poi.address.toLowerCase().includes(lowerKeyword)) {
        const dist = getDistance(tencentMapCenter.lng, tencentMapCenter.lat, poi.lng, poi.lat);
        results.push({
          name: poi.name,
          address: poi.address,
          distance: dist < 1000 ? `${Math.round(dist)}m` : `${(dist / 1000).toFixed(1)}km`,
          rawDistance: dist,
          lng: poi.lng,
          lat: poi.lat
        });
        seenNames.add(poi.name);
      }
    }
    
    return results;
  };

  const handleWeChatImport = () => {
    setAddressReceiver('李华');
    setAddressPhone('18912345678');
    setAddressArea('宁夏回族自治区 银川市 金凤区');
    setSearchKeyword('大阅城');
    setSelectedLocName('大阅城');
    const known = YINCHUAN_POIS.find(p => p.name === '大阅城');
    if (known) {
      setTencentMapCenter({ lat: known.lat, lng: known.lng });
    }
    setAddressLabel('公司');
    setAddressIsDefault(true);
    onTriggerToast('已成功导入微信收货地址！');
  };

  const handleSmartParse = () => {
    if (!aiInputText.trim()) {
      onTriggerToast('请先输入或选择要解析的文本！');
      return;
    }
    
    const phoneRegex = /(1[3-9]\d{9})/;
    const phoneMatch = aiInputText.match(phoneRegex);
    const parsedPhone = phoneMatch ? phoneMatch[0] : '';
    
    const cleanText = aiInputText.replace(parsedPhone, '').trim();
    const segments = cleanText.split(/[,，\s\n]+/).map(s => s.trim()).filter(Boolean);
    
    let parsedName = '联系人';
    let parsedAddress = '';
    
    if (segments.length >= 2) {
      if (segments[0].length < segments[1].length) {
        parsedName = segments[0];
        parsedAddress = segments[1];
      } else {
        parsedName = segments[1];
        parsedAddress = segments[0];
      }
    } else if (segments.length === 1) {
      parsedAddress = segments[0];
    }
    
    if (parsedName) setAddressReceiver(parsedName);
    if (parsedPhone) setAddressPhone(parsedPhone);
    
    if (parsedAddress) {
      setSearchKeyword(parsedAddress);
      setSelectedLocName(parsedAddress);
      
      if (parsedAddress.includes('唐徕')) {
        setAddressArea('宁夏回族自治区 银川市 兴庆区');
      } else if (parsedAddress.includes('大阅城')) {
        setAddressArea('宁夏回族自治区 银川市 金凤区');
      }
      
      const matchedPoi = YINCHUAN_POIS.find(p => p.name.includes(parsedAddress) || parsedAddress.includes(p.name));
      if (matchedPoi) {
        setTencentMapCenter({ lat: matchedPoi.lat, lng: matchedPoi.lng });
      }
    }
    
    onTriggerToast('智能解析成功！已自动填充表单。');
  };

  // Trigger geolocation and POI fetching automatically when selecting departure or destination
  useEffect(() => {
    if (orderStatus === 'select-start' || orderStatus === 'select-dest') {
      triggerWeChatGeolocate();
    }
  }, [orderStatus]);

  const handleCopyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    onTriggerToast('✓ 代码已成功复制到剪贴板！');
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePlaceOrder = async () => {
    if (!passengerPhone) {
      alert('请输入乘客手机号码，以便司机联系！');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(passengerPhone.trim())) {
      alert('请核对并输入11位有效手机号码！');
      return;
    }
    if (!startPoint) {
      alert('请输入出发地点！');
      return;
    }
    if (!targetDriver) {
      alert('暂无可派单的司机，请登录司机端或指定一个司机手机号！');
      return;
    }

    setSubmitting(true);
    
    // Slight coordinates offset to place order near center
    const lat = 38.487193 + (Math.random() - 0.5) * 0.005;
    const lng = 106.230912 + (Math.random() - 0.5) * 0.005;

    try {
      // Setup passenger link model in native dbProxy
      const docRef = doc(db, 'passenger_links', targetDriver.trim());
      await setDoc(docRef, {
        passengerPhone: passengerPhone.trim(),
        startLocation: startPoint.trim() + (isRainy ? ' (雨雪天加急)' : ''),
        destination: destination.trim() || '无需终点，听从分配',
        status: 'submitted',
        timestamp: Date.now(),
        passengerLat: lat,
        passengerLng: lng
      });

      setOrderStatus('success');
      onTriggerToast('🎉 微信小程序下单成功！司机端已同步发出强震动及播报语音！');
    } catch (err: any) {
      console.error('WeChat ordering proxy error:', err);
      // Fallback post
      try {
        const response = await fetch(`${getBaseApiUrl()}/api/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            driverPhone: targetDriver.trim(),
            passengerPhone: passengerPhone.trim(),
            startLocation: startPoint.trim() + (isRainy ? ' (雨雪天加急)' : ''),
            destination: destination.trim() || '无需终点，听从分配'
          })
        });
        const resData = await response.json();
        if (resData.success) {
          setOrderStatus('success');
          onTriggerToast('🎉 微信小程序下单成功 (阿里云宝塔 API 专线)！');
        } else {
          alert('下单通道响应异常，请核实后台配置。');
        }
      } catch (e: any) {
        alert('小程序连线提交失败: ' + e.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // WeChat Native Codes templates
  const wxmlCode = `<!-- index.wxml -->
<navigation-bar title="飞鸟代驾" back="{{false}}" color="#ffffff" background="#3B82F6"></navigation-bar>

<scroll-view class="container" scroll-y="true">
  <!-- 头部状态栏与胶囊导航由微信原生提供 -->
  
  <!-- 顶部 Banner -->
  <view class="banner-box">
    <view class="banner-content">
      <view class="logo-wrapper">
        <image class="logo-img" src="/hwdjtb.png" mode="aspectFill" />
        <text class="logo-title">黑湾酒后代驾</text>
      </view>
      <text class="banner-slogan">极速接驾 让出行更安心</text>
    </view>
  </view>

  <!-- 模拟下单卡片 -->
  <view class="order-card shadow-class">
    <!-- 附近司机数 -->
    <view class="status-header">
      <text class="driver-count">附近有 12 位司机候驾</text>
      <text class="base-price">起步价: 28元</text>
    </view>

    <!-- 地址选择区域 -->
    <view class="location-group">
      <!-- 乘客输入手机号 -->
      <view class="input-item border-bottom">
        <view class="dot dot-blue"></view>
        <input class="input-field" placeholder="请输入您的联系手机号" type="number" maxlength="11" bindinput="onInputPhone" value="{{passengerPhone}}" />
      </view>

      <!-- 出发地点 -->
      <view class="input-item border-bottom">
        <view class="dot dot-green"></view>
        <input class="input-field" placeholder="修改出发点" bindinput="onInputStart" value="{{startPoint}}" />
        <button class="locate-btn" bindtap="chooseLocation">地图定位</button>
      </view>

      <!-- 目的地 -->
      <view class="input-item">
        <view class="dot dot-red"></view>
        <input class="input-field" placeholder="输入代驾目的地 (选填)" bindinput="onInputDestination" value="{{destination}}" />
      </view>
    </view>

    <!-- 附加天气配置 -->
    <view class="options-area" bindtap="toggleRainWeather">
      <view class="option-icon-box {{isRainy ? 'option-active' : ''}}">
        <image class="option-icon" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC3qlNF0-oQybxBb1aQi-uvXG07BUVSaWUfq28B1oS1gSdmIz_y0YC_Ezk0KQaDPr3lOGD784PjZHxxuys8P9Jf7ThNw7FzrBk5G6Ge10g1IrI7LpccZthnv7uPqaiXEjaWnWUH1lWl_WMJWireu-aOsDmBE63MOysfacCGZ6tumaRxPutEyeIpD105lprJpfXLBMEaiTPuB16uHb-UwZpIPwz6AYQohkR-eTk72PyIBlch6y0a5VMCZQ" mode="aspectFill" />
        <text class="option-label">雨雪天气 {{isRainy ? '(加急)' : ''}}</text>
      </view>
    </view>
  </view>

  <!-- 立即下单主大按钮 -->
  <view class="btn-container">
    <button class="submit-btn" loading="{{submitting}}" disabled="{{submitting}}" bindtap="submitOrder">
      无需终点 立即下单
    </button>
  </view>

  <!-- 司机招募等 -->
  <view class="secondary-grid">
    <view class="recruit-card shadow-class">
      <view class="recruit-text">
        <text class="recruit-title">招募司机</text>
        <text class="recruit-desc">海量订单·多劳多得</text>
        <button class="join-btn">期待你的加入!</button>
      </view>
      <image class="recruit-img" src="https://lh3.googleusercontent.com/aida-public/AB6AXuB1UaTuiY0V-FR2lFLrMoA6sIiC6WqFYGJHxc4IH3p9PZ8dFm0tWKKL0Pyuo235CZglC5ZRy7lTZv3l8_33kiesqKC6fLp7jht-S5aOlkqHtdLygzsERGE_jYSaWAQU-C4sn8j1EAtqLgruvLFAMdJYNrAH4UcgvK9Q0Hek33BX1Nf7Kte0vTX2fEROJPD1xjMSehRTRRNWnbUlTpUije4iSLMUAm0Dtc8wqZcMvr2A1E5HIl91MsxS5Q" mode="aspectFill" />
    </view>
  </view>
</scroll-view>`;

  const wxssCode = `/* index.wxss */
page {
  background-color: #F8FAFC;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  padding-bottom: 50rpx;
}

.container {
  width: 100%;
  display: flex;
  flex-direction: column;
}

/* Banner 渐变样式 */
.banner-box {
  background: linear-gradient(180deg, #93C5FD 0%, #DBEAFE 100%);
  height: 350rpx;
  display: flex;
  align-items: center;
  padding: 0 40rpx;
  position: relative;
  overflow: hidden;
}

.banner-content {
  display: flex;
  flex-direction: column;
  z-index: 10;
}

.logo-wrapper {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 12rpx;
}

.logo-img {
  width: 110rpx;
  height: 110rpx;
  border-radius: 50%;
  background-color: #ffffff;
  margin-right: 20rpx;
  box-shadow: 0 4rpx 10rpx rgba(0,0,0,0.1);
}

.logo-title {
  font-size: 44rpx;
  font-weight: bold;
  color: #1E3A8A;
  letter-spacing: 2rpx;
}

.banner-slogan {
  font-size: 32rpx;
  font-weight: 800;
  color: #1E40AF;
  letter-spacing: 4rpx;
  margin-top: 10rpx;
}

/* 下单卡片样式 */
.order-card {
  background-color: #ffffff;
  border-radius: 40rpx;
  margin: -60rpx 30rpx 40rpx 30rpx;
  padding: 40rpx;
  position: relative;
  z-index: 20;
}

.shadow-class {
  box-shadow: 0 10rpx 40rpx rgba(0, 0, 0, 0.06);
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 40rpx;
}

.driver-count {
  font-size: 26rpx;
  color: #64748B;
}

.base-price {
  font-size: 26rpx;
  font-weight: bold;
  color: #1E293B;
}

/* 输入框组 */
.location-group {
  display: flex;
  flex-direction: column;
}

.input-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 30rpx 0;
}

.border-bottom {
  border-bottom: 2rpx solid #F1F5F9;
}

.dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  margin-right: 30rpx;
  flex-shrink: 0;
}

.dot-blue { background-color: #3B82F6; }
.dot-green { background-color: #10B981; }
.dot-red { background-color: #EF4444; }

.input-field {
  flex: 1;
  font-size: 30rpx;
  color: #1E293B;
}

.locate-btn {
  font-size: 24rpx;
  background-color: #F8FAFC;
  color: #475569;
  border: 2rpx solid #E2E8F0;
  border-radius: 8rpx;
  padding: 8rpx 16rpx;
  margin-left: 10rpx;
  line-height: 1.5;
}

/* 天气选项 */
.options-area {
  display: flex;
  justify-content: center;
  margin-top: 30rpx;
  padding-top: 30rpx;
  border-top: 2rpx solid #F8FAFC;
}

.option-icon-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16rpx 30rpx;
  border-radius: 16rpx;
  background-color: #F8FAFC;
  transition: all 0.2s ease;
}

.option-active {
  background-color: #EFF6FF;
  border: 1rpx solid #BFDBFE;
}

.option-icon {
  width: 80rpx;
  height: 80rpx;
  margin-bottom: 10rpx;
  border-radius: 50%;
}

.option-label {
  font-size: 24rpx;
  color: #475569;
}

/* 下单按钮 */
.btn-container {
  padding: 0 40rpx;
  margin-bottom: 50rpx;
}

.submit-btn {
  background: linear-gradient(90deg, #60A5FA, #3B82F6);
  color: #ffffff;
  font-size: 36rpx;
  font-weight: bold;
  height: 100rpx;
  line-height: 100rpx;
  border-radius: 20rpx;
  box-shadow: 0 10rpx 30rpx rgba(59, 130, 246, 0.3);
  letter-spacing: 2rpx;
}

/* 招募模块 */
.secondary-grid {
  padding: 0 30rpx;
}

.recruit-card {
  background-color: #ffffff;
  border-radius: 30rpx;
  padding: 30rpx;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  overflow: hidden;
  height: 200rpx;
}

.recruit-text {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.recruit-title {
  font-size: 28rpx;
  font-weight: bold;
  color: #1E293B;
}

.recruit-desc {
  font-size: 22rpx;
  color: #94A3B8;
}

.join-btn {
  background-color: #3B82F6;
  color: #ffffff;
  font-size: 20rpx;
  padding: 8rpx 20rpx;
  border-radius: 50rpx;
  margin-left: 0;
  margin-top: 10rpx;
  line-height: 1.5;
}

.recruit-img {
  width: 150rpx;
  height: 150rpx;
  align-self: flex-end;
}`;

  const jsCode = `// index.js
Page({
  data: {
    driverPhone: '${targetDriver}', // 当前指派绑定的司机手机号
    passengerPhone: '',
    startPoint: '兴庆区政府住宅区',
    destination: '',
    isRainy: false,
    submitting: false
  },

  onLoad: function (options) {
    // 若扫码URL携带特定司机手机号，可动态提取绑定
    if (options.driver) {
      this.setData({
        driverPhone: options.driver
      });
    }
  },

  onInputPhone: function (e) {
    this.setData({ passengerPhone: e.detail.value });
  },

  onInputStart: function (e) {
    this.setData({ startPoint: e.detail.value });
  },

  onInputDestination: function (e) {
    this.setData({ destination: e.detail.value });
  },

  toggleRainWeather: function() {
    this.setData({
      isRainy: !this.data.isRainy
    });
  },

  chooseLocation: function() {
    const that = this;
    wx.chooseLocation({
      success: function(res) {
        that.setData({
          startPoint: res.name
        });
      },
      fail: function() {
        wx.showToast({
          title: '定位失败，请手动输入',
          icon: 'none'
        });
      }
    });
  },

  // 核心：点击立即下单，上报数据触达司机端
  submitOrder: function () {
    const d = this.data;
    if (!d.passengerPhone) {
      wx.showModal({
        title: '提示',
        content: '请输入您的联系手机号，以便司机接单后联系！',
        showCancel: false
      });
      return;
    }

    if (!/^1[3-9]\\d{9}$/.test(d.passengerPhone.trim())) {
      wx.showModal({
        title: '格式错误',
        content: '请输入11位有效的中国手机号码！',
        showCancel: false
      });
      return;
    }

    this.setData({ submitting: true });

    // 微信小程序直接向中国大陆阿里云宝塔 API 服务器发起 REST POST 下单
    wx.request({
      url: '${getBaseApiUrl()}/api/submit',
      method: 'POST',
      header: {
        'content-type': 'application/json'
      },
      data: {
        driverPhone: d.driverPhone,
        passengerPhone: d.passengerPhone,
        startLocation: d.startPoint + (d.isRainy ? ' (雨雪天加急)' : ''),
        destination: d.destination || '无需终点，听从分配'
      },
      success: (res) => {
        if (res.data && res.data.success) {
          wx.showModal({
            title: '下单成功',
            content: '已成功通知黑湾代驾司机：' + d.driverPhone + '！司机端正在震动振铃播报，请在原地稍候。',
            showCancel: false,
            success: () => {
              // 微信内通常可重置表单或进入行程等待页
            }
          });
        } else {
          wx.showToast({
            title: '中继返回异常，请联系客服',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        wx.showModal({
          title: '连接超时',
          content: '上报数据异常，请确保设备联网或检查宝塔服务器节点！',
          showCancel: false
        });
      },
      complete: () => {
        this.setData({ submitting: false });
      }
    });
  }
});`;

  const jsonCode = `{
  "navigationBarTitleText": "飞鸟代驾-乘客自助端",
  "navigationBarBackgroundColor": "#3B82F6",
  "navigationBarTextStyle": "white",
  "usingComponents": {}
}`;

  return (
    <div className="w-full flex flex-col h-full bg-[#0a0d17] animate-in fade-in duration-300">
      
      {/* Simulation Selector Bar */}
      <div className="flex items-center justify-between bg-[#111625] px-4 py-2.5 border-b border-[#212b44] shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
          <span className="text-xs font-black text-slate-100 font-sans">
            微信小程序开发与联调中心
          </span>
        </div>
        
        {/* Toggle Mode button */}
        <div className="flex space-x-1.5 bg-[#1b233a] rounded-lg p-0.5 border border-slate-700/40 text-[10px] font-bold">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              activeTab === 'simulator' 
                ? 'bg-amber-500 text-slate-950 font-black' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📱 小程序交互模拟
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              activeTab === 'code' 
                ? 'bg-amber-500 text-slate-950 font-black' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            💻 微信原生开发代码
          </button>
        </div>
      </div>

      {activeTab === 'simulator' ? (
        <div className="flex-1 flex flex-col items-center justify-start overflow-y-auto p-4 space-y-4">
          
          {/* Device Frame */}
          <div className="relative w-full max-w-[340px] aspect-[9/18.5] bg-white rounded-[32px] shadow-2xl border-[6px] border-[#222] overflow-hidden flex flex-col text-left">
            
            {/* Phone Top Notch Bar */}
            <div className="w-full h-5 bg-white flex justify-between items-center px-4 pt-1 select-none text-[10px] text-slate-900 font-bold font-sans">
              <span>17:40</span>
              <div className="w-16 h-3 bg-black rounded-full shrink-0 -mt-1"></div>
              <div className="flex items-center space-x-1 font-mono text-[9px]">
                <span>5G</span>
                <div className="w-4 h-2 border border-slate-900 rounded-sm p-px flex items-center"><div className="w-2.5 h-full bg-slate-900 rounded-xs"></div></div>
              </div>
            </div>

            {/* WeChat Header Bar with Capsule Menu button */}
            {orderStatus === 'select-start' || orderStatus === 'select-dest' ? null : orderStatus === 'profile' || orderStatus === 'about' || orderStatus === 'rules' || orderStatus === 'agreement' || orderStatus === 'privacy' || orderStatus === 'driver-register' ? (
              <header className="w-full bg-white px-3 py-1.5 flex items-center justify-between sticky top-0 z-50 border-b border-slate-100 select-none">
                <button 
                  onClick={() => {
                    if (orderStatus === 'rules') {
                      setOrderStatus('profile');
                    } else if (orderStatus === 'about') {
                      setOrderStatus('profile');
                    } else if (orderStatus === 'agreement') {
                      setOrderStatus('profile');
                    } else if (orderStatus === 'privacy') {
                      if (isLogOutConfirmMode) {
                        setIsLogOutConfirmMode(false);
                      }
                      setOrderStatus(privacyBackTo);
                    } else if (orderStatus === 'driver-register') {
                      if (driverRegStep === 'agreement') {
                        setDriverRegStep('form');
                      } else if (driverRegStep === 'form') {
                        // User stays logged in when clicking Back - they just go back to home screen
                        setOrderStatus('idle');
                      } else if (driverRegStep === 'success') {
                        setDriverRegStep('form');
                      } else {
                        setOrderStatus('idle');
                      }
                    } else {
                      setOrderStatus('idle');
                    }
                  }}
                  className="p-1 hover:bg-slate-100 rounded-full transition-colors"
                  aria-label="返回"
                >
                  <svg className="w-5 h-5 text-slate-700 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
                  </svg>
                </button>
                <h1 className="text-sm font-bold absolute left-1/2 -translate-x-1/2 text-slate-800">
                  {orderStatus === 'rules' ? '计价规则' : orderStatus === 'about' ? '关于我们' : orderStatus === 'agreement' ? '代驾协议' : orderStatus === 'privacy' ? (isLogOutConfirmMode ? '确认退出与隐私权宣告' : '隐私政策') : orderStatus === 'driver-register' ? (driverRegStep === 'form' ? '基本信息' : driverRegStep === 'agreement' ? '合作协议' : driverRegStep === 'success' ? (driverApplicationStatus === 'approved' ? '审核通过' : '提交成功') : '成为司机') : '个人中心'}
                </h1>
                
                {/* WeChat standard Capsule button */}
                <div className="flex items-center bg-white border border-gray-150 rounded-full px-2 py-0.5 space-x-2 shadow-xs">
                  <div className="flex space-x-0.5">
                    <div className="w-1 h-1 bg-black rounded-full"></div>
                    <div className="w-1 h-1 bg-black rounded-full"></div>
                    <div className="w-1 h-1 bg-black rounded-full"></div>
                  </div>
                  <div className="w-[1px] h-2.5 bg-gray-200"></div>
                  <div className="w-2.5 h-2.5 border border-black rounded-full p-px flex items-center justify-center">
                    <div className="w-0.5 h-0.5 bg-black rounded-full"></div>
                  </div>
                </div>
              </header>
            ) : (
              <header className="w-full bg-white px-3.5 py-2 flex items-center justify-between sticky top-0 z-50 border-b border-slate-100 select-none relative">
                <div className="flex items-center space-x-1.5">
                </div>
                <h1 className="text-xs font-black text-gray-850 absolute left-1/2 -translate-x-1/2">黑湾代驾</h1>

                {/* WeChat standard Capsule button */}
                <div className="flex items-center bg-white border border-gray-150 rounded-full px-2.5 py-1 space-x-2.5 shadow-xs">
                  <div className="flex space-x-0.5">
                    <div className="w-1 h-1 bg-black rounded-full"></div>
                    <div className="w-1 h-1 bg-black rounded-full"></div>
                    <div className="w-1 h-1 bg-black rounded-full"></div>
                  </div>
                  <div className="w-[1px] h-3 bg-gray-200"></div>
                  <div className="w-3 h-3 border border-black rounded-full p-px flex items-center justify-center">
                    <div className="w-1 h-1 bg-black rounded-full"></div>
                  </div>
                </div>
              </header>
            )}

            {/* Mini-Program Scroll Canvas */}
            <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col relative text-slate-800 font-sans">
              {orderStatus === 'idle' ? (
                <>
                  {/* Banner Area - Redesigned with premium aesthetics */}
                  <section className="bg-slate-900 w-full h-40 flex items-center justify-between px-5 relative overflow-hidden shrink-0 select-none">
                    {/* Background glows & grids */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-black" />
                    
                    {/* Floating ambient glow spheres */}
                    <div className="absolute -left-10 -top-10 w-28 h-28 bg-blue-500/10 rounded-full blur-2xl" />
                    <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-amber-500/10 rounded-full blur-xl" />

                    {/* Main content layout */}
                    <div className="z-10 flex flex-col space-y-1.5 max-w-[75%] text-left">
                      {/* Premium Badge & Brand Label */}
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 bg-amber-400/10 text-amber-400 text-[8px] font-black tracking-widest rounded uppercase border border-amber-400/20">ALLIANCE</span>
                        <span className="text-xs font-black text-white/95 tracking-wider">黑湾代驾</span>
                      </div>
                      
                      {/* Catchy Slogan / Question */}
                      <p className="text-[10px] text-slate-300 font-medium leading-normal">
                        您是否遇到恶劣天气无司机接单？
                      </p>
                      
                      {/* Trust guarantee subtext */}
                      <p className="text-[9.5px] text-amber-300 font-bold leading-normal flex items-start gap-1">
                        <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse shrink-0 mt-1" />
                        <span>一键下单，为您全城极速匹配司机师傅</span>
                      </p>
                    </div>

                    {/* Right side: Interactive Avatar Button */}
                    <div className="z-10 flex flex-col items-center gap-1 shrink-0">
                      <div 
                        onClick={() => setOrderStatus('profile')}
                        className="relative w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center p-0.5 shadow-xl border border-white/10 cursor-pointer group active:scale-95 hover:scale-105 transition-all"
                      >
                        <div className="w-full h-full rounded-full overflow-hidden bg-slate-900 relative z-10 border border-slate-950 flex items-center justify-center">
                          <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                              <linearGradient id="avatarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#1e293b" />
                                <stop offset="100%" stopColor="#0f172a" />
                              </linearGradient>
                              <linearGradient id="capGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#fbbf24" />
                                <stop offset="100%" stopColor="#d97706" />
                              </linearGradient>
                              <linearGradient id="skinGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#ffedd5" />
                                <stop offset="100%" stopColor="#fed7aa" />
                              </linearGradient>
                            </defs>
                            
                            {/* Circle Background */}
                            <circle cx="50" cy="50" r="48" fill="url(#avatarGrad)" />
                            <circle cx="50" cy="50" r="46" fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeOpacity="0.4" />
                            
                            {/* Driver's Suit Body */}
                            <path d="M25,85 C25,70 35,65 50,65 C65,65 75,70 75,85" fill="#1e3a8a" />
                            <path d="M42,65 L50,78 L58,65" fill="#f8fafc" />
                            <path d="M48,72 L52,72 L50,85 Z" fill="#0f172a" />

                            {/* Driver's Head / Ears */}
                            <circle cx="34" cy="52" r="5" fill="url(#skinGrad)" />
                            <circle cx="66" cy="52" r="5" fill="url(#skinGrad)" />
                            <circle cx="50" cy="50" r="16" fill="url(#skinGrad)" />

                            {/* Eyes */}
                            <path d="M42,48 C43,46 46,46 47,48" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" fill="none" />
                            <path d="M53,48 C54,46 57,46 58,48" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" fill="none" />
                            
                            {/* Cheeks */}
                            <circle cx="38" cy="54" r="2.5" fill="#f43f5e" fillOpacity="0.4" />
                            <circle cx="62" cy="54" r="2.5" fill="#f43f5e" fillOpacity="0.4" />

                            {/* Friendly Smile */}
                            <path d="M45,54 Q50,59 55,54" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" fill="none" />

                            {/* Chauffeur's Cap */}
                            <path d="M30,38 C35,32 65,32 70,38 C72,40 70,42 66,42 C56,43 44,43 34,42 C30,42 28,40 30,38 Z" fill="#0f172a" />
                            <path d="M32,36 C32,24 68,24 68,36" fill="url(#capGrad)" />
                            <path d="M32,34 L68,34 L67,38 L33,38 Z" fill="#0f172a" />
                            {/* Golden Cap Badge */}
                            <path d="M50,28 L52,32 L56,32 L53,35 L54,39 L50,37 L46,39 L47,35 L44,32 L48,32 Z" fill="#fbbf24" />
                          </svg>
                        </div>
                      </div>
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">个人中心</span>
                    </div>
                  </section>

                  {/* Order card content - offset upwards */}
                  <section className="px-3 -mt-6 relative z-20 space-y-3">
                    <div className="bg-white rounded-2xl p-4 shadow-md flex flex-col border border-slate-100">
                      
                      {/* Driver nearby indicator */}
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] text-slate-500 font-bold">附近有 12 位司机候驾</span>
                        <div className="flex items-center text-[10px] font-black text-slate-900">
                          <span>起步价: 28元</span>
                          <ArrowRight className="w-3 h-3 text-slate-400 ml-0.5" />
                        </div>
                      </div>

                      {/* Location input forms */}
                      <div className="space-y-3">

                        {/* Start point input */}
                        <div className="flex flex-col space-y-1">
                          <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block">📍 出发地点</span>
                          <div 
                            onClick={() => {
                              setSelectedLocationIndex(0);
                              setSelectedLocName(startPoint);
                              setSearchKeyword('');
                              setOrderStatus('select-start');
                            }}
                            className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-1.5 flex items-center justify-between hover:bg-slate-100/50 active:scale-[0.99] transition-all cursor-pointer"
                          >
                            <div className="flex items-center flex-1 min-w-0">
                              <MapPin className="w-3.5 h-3.5 text-emerald-500 mr-2 shrink-0" />
                              <span className={`text-xs font-bold truncate ${startPoint ? 'text-slate-850' : 'text-slate-400'}`}>
                                {startPoint || "选择出发地点"}
                              </span>
                            </div>
                            <span className="text-[9px] px-2 py-0.5 bg-white border border-slate-200 text-slate-600 rounded shrink-0 font-extrabold shadow-2xs">修改</span>
                          </div>
                        </div>

                        {/* Destination input */}
                        <div className="flex flex-col space-y-1">
                          <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block">🏁 目的地 (选填)</span>
                          <div 
                            onClick={() => {
                              setSelectedLocationIndex(0);
                              setSelectedLocName(destination);
                              setSearchKeyword('');
                              setOrderStatus('select-dest');
                            }}
                            className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-1.5 flex items-center justify-between hover:bg-slate-100/50 active:scale-[0.99] transition-all cursor-pointer"
                          >
                            <div className="flex items-center flex-1 min-w-0">
                              <Navigation className="w-3.5 h-3.5 text-rose-500 mr-2 shrink-0" />
                              <span className={`text-xs font-bold truncate ${destination ? 'text-slate-850' : 'text-slate-400'}`}>
                                {destination || "输入代驾目的地"}
                              </span>
                            </div>
                            <span className="text-[9px] px-2 py-0.5 bg-white border border-slate-200 text-slate-600 rounded shrink-0 font-extrabold shadow-2xs">选择</span>
                          </div>
                        </div>

                      </div>

                      {/* Rainy Snow option */}
                      <button
                        type="button"
                        onClick={() => setIsRainy(!isRainy)}
                        className={`mt-4 py-2 px-3 border rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
                          isRainy 
                            ? 'bg-blue-50/80 border-blue-200 text-blue-600 font-black' 
                            : 'bg-slate-50 border-slate-100 text-slate-500'
                        }`}
                      >
                        <CloudRain className={`w-4 h-4 ${isRainy ? 'text-blue-500 animate-bounce' : 'text-slate-400'}`} />
                        <span className="text-xs">
                          {isRainy ? '☔ 雨雪天加急服务已激活' : '❄ 雨雪天气 (一键加急)'}
                        </span>
                      </button>

                    </div>

                    {/* Order Button */}
                    <button
                      onClick={handlePlaceOrder}
                      disabled={submitting}
                      className="w-full bg-gradient-to-r from-blue-400 to-blue-600 text-white py-3 rounded-xl font-extrabold text-sm shadow-md shadow-blue-300/30 tracking-wider text-center active:scale-[0.98] transition-all cursor-pointer"
                    >
                      {submitting ? '⏳ 正在提交至司机台...' : '无需终点 立即下单'}
                    </button>

                    {/* Promos cards mimicking WeChat Mini-program grids */}
                    <div className="grid grid-cols-2 gap-2 pb-5">
                      <div className="bg-white rounded-xl p-3 shadow-xs border border-slate-100 flex flex-col justify-between h-24 relative overflow-hidden">
                        <span className="text-[10px] font-black text-slate-800 leading-tight">极速接驾体验</span>
                        <span className="text-[8px] text-slate-400">一键代叫，闪电触达</span>
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center self-end mt-1 overflow-hidden">
                          <img 
                            src={WECHAT_CARD_BANNER_PATH} 
                            alt="Driver" 
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (target.src !== WECHAT_CARD_BANNER_BASE64) {
                                target.src = WECHAT_CARD_BANNER_BASE64;
                              }
                            }}
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </div>

                      <div 
                        onClick={() => setOrderStatus('driver-register')}
                        className="bg-white rounded-xl p-3 shadow-xs border border-slate-100 flex flex-col justify-between h-24 relative overflow-hidden cursor-pointer hover:bg-slate-50/80 active:scale-98 transition-all duration-200"
                      >
                        <div>
                          <span className="text-[10px] font-black text-slate-800 block">招募司机</span>
                          <span className="text-[8px] text-slate-400">海量订单·多劳多得</span>
                        </div>
                        <button className="bg-blue-500 text-white text-[8px] font-bold px-2 py-1 rounded-full w-max cursor-pointer">期待加入</button>
                        <div className="absolute right-1 bottom-1 w-10 h-10 overflow-hidden opacity-80 pointer-events-none">
                          <img 
                            alt="driver" 
                            className="w-full h-auto object-cover" 
                            referrerPolicy="no-referrer"
                            src={driverAvatar || '/driver_avatar.jpg'}
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (target.src !== DRIVER_AVATAR_BASE64) {
                                target.src = DRIVER_AVATAR_BASE64;
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>

                  </section>
                </>
              ) : orderStatus === 'select-start' || orderStatus === 'select-dest' ? (
                <div className="flex-1 flex flex-col bg-slate-50 text-slate-800 select-none overflow-hidden h-full absolute inset-0 z-50 animate-in fade-in slide-in-from-bottom duration-250">
                  {/* WeChat Native Plugin Top Bar */}
                  <header className="bg-white border-b border-slate-100 shrink-0 select-none px-3 py-2.5 flex items-center justify-between">
                    <button 
                      onClick={() => {
                        setOrderStatus('idle');
                        setSearchKeyword('');
                      }}
                      className="p-1 hover:bg-slate-100 rounded-full transition-colors active:opacity-70 text-slate-600"
                    >
                      <ChevronLeft className="w-4 h-4 text-slate-700 stroke-[2.5]" />
                    </button>
                    <h1 className="text-xs font-black text-slate-800">
                      {orderStatus === 'select-start' ? '编辑出发地址' : '编辑目的地'}
                    </h1>
                    <div className="w-6"></div> {/* spacer to balance back button */}
                  </header>

                  {/* Plugin Branding & WeChat Quick Import Header */}
                  <div className="bg-slate-100/50 px-3 py-2 shrink-0 flex items-center justify-between border-b border-slate-100">
                    <span className="text-[9px] font-black text-blue-600 flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-full">
                      <Compass className="w-2.5 h-2.5" /> 地图地址输入服务
                    </span>
                    <button 
                      onClick={handleWeChatImport}
                      className="bg-emerald-50 hover:bg-emerald-100/80 text-emerald-600 border border-emerald-100 text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 active:scale-95 transition-all"
                    >
                      <Share2 className="w-2.5 h-2.5" /> 微信一键导入
                    </button>
                  </div>

                  {/* Main Form Fields Container */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3.5 pb-6">
                    
                    {/* Collapsible AI Text Parser */}
                    <div className="bg-white rounded-xl border border-slate-100 p-2.5 shadow-xs">
                      <button 
                        onClick={() => setShowAiInput(!showAiInput)}
                        className="flex items-center justify-between w-full text-left text-[10px] font-black text-slate-600 hover:text-blue-600 transition-colors"
                      >
                        <span className="flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-blue-500" /> 智能快速填写 (粘贴整段地址解析)
                        </span>
                        <span className="text-[8px] font-bold text-blue-600 bg-blue-50/50 px-1.5 py-0.5 rounded">
                          {showAiInput ? '收起' : '展开'}
                        </span>
                      </button>
                      {showAiInput && (
                        <div className="mt-2 space-y-2 bg-slate-50/40 p-2 rounded-lg border border-slate-100 animate-in fade-in slide-in-from-top duration-200">
                          <textarea
                            value={aiInputText}
                            onChange={(e) => setAiInputText(e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-lg p-2 text-[9.5px] font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            rows={2}
                            placeholder="示例：张三，13812345678，银川市兴庆区唐徕小区"
                          />
                          <div className="flex items-center justify-between gap-1.5 flex-wrap">
                            <div className="flex gap-1">
                              <button 
                                onClick={() => setAiInputText('张小华，13811112222，唐徕小学')}
                                className="text-[8px] font-black text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-50"
                              >
                                填入唐徕小学例
                              </button>
                              <button 
                                onClick={() => setAiInputText('王大帅，15922223333，大阅城')}
                                className="text-[8px] font-black text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-50"
                              >
                                填入大阅城例
                              </button>
                            </div>
                            <button
                              onClick={handleSmartParse}
                              className="bg-blue-600 hover:bg-blue-700 text-white text-[9px] font-black px-2.5 py-0.5 rounded-full active:scale-95 transition-all"
                            >
                              解析填充
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Standard Contact Form Fields Card */}
                    <div className="bg-white rounded-2xl border border-slate-100 p-3 shadow-xs space-y-2.5">
                      
                      {/* 联系人 Field */}
                      <div className="flex items-center justify-between py-1 border-b border-slate-50">
                        <span className="text-[11px] font-black text-slate-500 w-16">联系人</span>
                        <input 
                          type="text"
                          value={addressReceiver}
                          onChange={(e) => setAddressReceiver(e.target.value)}
                          className="flex-1 bg-transparent border-none text-[11px] font-bold text-slate-800 placeholder:text-slate-300 outline-none p-0"
                          placeholder="您的姓名/称呼"
                        />
                      </div>

                      {/* 手机号码 Field */}
                      <div className="flex items-center justify-between py-1 border-b border-slate-50">
                        <span className="text-[11px] font-black text-slate-500 w-16">手机号码</span>
                        <input 
                          type="tel"
                          value={addressPhone}
                          onChange={(e) => setAddressPhone(e.target.value)}
                          maxLength={11}
                          className="flex-1 bg-transparent border-none text-[11px] font-bold text-slate-800 placeholder:text-slate-300 outline-none p-0"
                          placeholder="11位手机号码"
                        />
                      </div>

                      {/* 所在地区 Field */}
                      <div className="flex items-center justify-between py-1 border-b border-slate-50">
                        <span className="text-[11px] font-black text-slate-500 w-16">所在地区</span>
                        <button 
                          onClick={() => setShowAreaPicker(true)}
                          className="flex-1 text-left flex items-center justify-between text-[11px] font-bold text-slate-800 p-0"
                        >
                          <span className="truncate">{addressArea}</span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        </button>
                      </div>

                      {/* 详细地址 Input with Autocomplete Suggestions */}
                      <div className="flex items-start justify-between py-1 border-b border-slate-50 gap-2">
                        <span className="text-[11px] font-black text-slate-500 w-16 pt-1">详细地址</span>
                        <div className="flex-1 flex flex-col relative">
                          <div className="flex items-center gap-1 bg-slate-50 rounded-xl px-2.5 py-1">
                            <input 
                              type="text"
                              value={searchKeyword}
                              onChange={(e) => {
                                setSearchKeyword(e.target.value);
                                setSelectedLocationIndex(0);
                                setSelectedLocName(e.target.value);
                              }}
                              className="flex-1 bg-transparent border-none text-[11px] font-bold text-slate-800 placeholder:text-slate-400 outline-none p-0"
                              placeholder="输入地名，如唐、大..."
                            />
                            {searchKeyword && (
                              <button 
                                onClick={() => {
                                  setSearchKeyword('');
                                  setSelectedLocName('');
                                }}
                                className="p-0.5 rounded-full hover:bg-slate-200 text-slate-400 active:scale-95 shrink-0"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {/* Instant Autocomplete Suggestions List */}
                          {searchKeyword.trim() && (
                            <div className="absolute top-[32px] left-0 right-0 max-h-40 bg-white border border-slate-100 rounded-xl shadow-xl z-50 overflow-y-auto mt-1 divide-y divide-slate-50 animate-in fade-in duration-150">
                              {(() => {
                                const filtered = getSearchLocations();
                                return filtered.length > 0 ? (
                                  filtered.map((loc, idx) => {
                                    const isSelected = selectedLocName === loc.name;
                                    return (
                                      <div
                                        key={idx}
                                        onClick={() => {
                                          setSelectedLocName(loc.name);
                                          setSearchKeyword(loc.name);
                                          setSelectedLocationIndex(idx);
                                          if (loc.lng && loc.lat) {
                                            setTencentMapCenter({ lat: loc.lat, lng: loc.lng });
                                          }
                                        }}
                                        className={`p-2 hover:bg-blue-50/40 cursor-pointer flex flex-col text-left transition-colors ${isSelected ? 'bg-blue-50/60' : ''}`}
                                      >
                                        <span className="text-[10px] font-black text-slate-800 truncate">{loc.name}</span>
                                        <span className="text-[8px] text-slate-400 truncate mt-0.5">{loc.address}</span>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <div className="p-3 text-center text-slate-400 text-[9px] font-bold">
                                    暂无联想地址
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                        
                        {/* Inline Tencent Map Trigger */}
                        <button 
                          onClick={() => setShowMapSelector(!showMapSelector)}
                          className={`p-1.5 rounded-xl border flex items-center gap-1 transition-all text-[9px] font-extrabold shrink-0 ${
                            showMapSelector 
                              ? 'bg-blue-50 border-blue-200 text-blue-600 scale-105' 
                              : 'border-slate-100 hover:bg-slate-50 text-slate-500'
                          }`}
                        >
                          <Map className="w-3.5 h-3.5" />
                          <span>地图选点</span>
                        </button>
                      </div>

                      {/* WeChat Style Inline Tencent Map Selector */}
                      {showMapSelector && (
                        <div className="bg-slate-50 rounded-xl border border-slate-150 p-2 space-y-2 animate-in fade-in slide-in-from-top duration-200">
                          <div className="h-44 rounded-lg overflow-hidden relative border border-slate-200">
                            <TencentMap 
                              apiKey="5N4BZ-YFOCT-BWJXC-L7O2O-ATI6K-UYFZW" 
                              center={tencentMapCenter}
                              zoom={tencentMapZoom}
                              onDragEnd={(coords) => {
                                setTencentMapCenter(coords);
                                fetchPoisForCoords(coords.lng, coords.lat);
                              }}
                              onZoomChange={(newZoom) => {
                                setTencentMapZoom(newZoom);
                              }}
                            />
                            {/* Central Pin */}
                            <div className="absolute inset-0 flex justify-center items-center pointer-events-none z-20">
                              <div className="relative flex flex-col items-center -mt-5">
                                <div className="bg-blue-600 p-1.5 rounded-full shadow-lg border-2 border-white animate-bounce">
                                  <MapPin className="w-3.5 h-3.5 text-white" />
                                </div>
                                <div className="w-2.5 h-1 bg-black/20 rounded-full blur-[2px] mt-0.5"></div>
                              </div>
                            </div>
                            {/* Map Floating Controls */}
                            <div className="absolute bottom-2 right-2 z-30 flex flex-col items-center gap-1">
                              <div className="flex flex-col bg-white rounded-md shadow border border-slate-200 overflow-hidden shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setTencentMapZoom(prev => Math.min(20, prev + 1))}
                                  className="p-1 hover:bg-slate-50 active:bg-slate-100 transition-colors border-b border-slate-150 flex items-center justify-center"
                                >
                                  <Plus className="w-3 h-3 text-slate-700" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTencentMapZoom(prev => Math.max(3, prev - 1))}
                                  className="p-1 hover:bg-slate-50 active:bg-slate-100 transition-colors flex items-center justify-center"
                                >
                                  <Minus className="w-3 h-3 text-slate-700" />
                                </button>
                              </div>
                              <button 
                                onClick={triggerWeChatGeolocate}
                                className="bg-white p-1.5 rounded-md shadow border border-slate-200 hover:bg-slate-50 active:scale-90 transition-all shrink-0 flex items-center justify-center"
                              >
                                <Compass className="w-3.5 h-3.5 text-blue-600" />
                              </button>
                            </div>
                          </div>

                          {/* Nearby list under the map */}
                          <div className="max-h-36 overflow-y-auto space-y-1 relative pr-1">
                            {poisLoading && (
                              <div className="absolute inset-0 bg-white/80 z-20 flex flex-col items-center justify-center space-y-1">
                                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-[8px] text-slate-400 font-bold">获取周边位置中...</span>
                              </div>
                            )}
                            {tencentPois.map((loc, idx) => {
                              const isSelected = selectedLocName === loc.name;
                              return (
                                <div 
                                  key={idx}
                                  onClick={() => {
                                    setSelectedLocationIndex(idx);
                                    setSelectedLocName(loc.name);
                                    setSearchKeyword(loc.name);
                                    if (loc.lng && loc.lat) {
                                      setTencentMapCenter({ lat: loc.lat, lng: loc.lng });
                                    }
                                  }}
                                  className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer ${
                                    isSelected 
                                      ? 'bg-blue-50/50 border-blue-200' 
                                      : 'border-slate-50 hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="flex flex-col text-left max-w-[85%]">
                                    <span className="text-[10px] font-black text-slate-800 truncate">{loc.name}</span>
                                    <span className="text-[8px] text-slate-400 truncate mt-0.5">{loc.address}</span>
                                  </div>
                                  <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-all shrink-0 ${
                                    isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300'
                                  }`}>
                                    {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 标签 Choice Field */}
                      <div className="flex items-center justify-between py-1 border-b border-slate-50">
                        <span className="text-[11px] font-black text-slate-500 w-16">标签</span>
                        <div className="flex-1 flex gap-1.5 flex-wrap">
                          {['家', '公司', '学校'].map((lbl) => {
                            const isSelected = addressLabel === lbl;
                            return (
                              <button
                                key={lbl}
                                onClick={() => setAddressLabel(lbl)}
                                className={`px-3 py-1 text-[9px] font-black rounded-full border transition-all active:scale-95 ${
                                  isSelected 
                                    ? 'bg-blue-50 border-blue-200 text-blue-600 scale-105 shadow-xs' 
                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                }`}
                              >
                                {lbl}
                              </button>
                            );
                          })}
                          <button
                            onClick={() => {
                              const val = prompt('请输入自定义标签名称 (最多4个字)：', '');
                              if (val && val.trim()) {
                                setAddressLabel(val.trim().substring(0, 4));
                              }
                            }}
                            className={`px-3 py-1 text-[9px] font-black rounded-full border transition-all active:scale-95 ${
                              !['家', '公司', '学校'].includes(addressLabel) 
                                ? 'bg-blue-50 border-blue-200 text-blue-600 scale-105 shadow-xs' 
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            {!['家', '公司', '学校'].includes(addressLabel) ? addressLabel : '自定义'}
                          </button>
                        </div>
                      </div>

                      {/* 设为默认地址 WeChat Style Toggle Switch */}
                      <div className="flex items-center justify-between py-1">
                        <div className="flex flex-col text-left">
                          <span className="text-[11px] font-black text-slate-800">设为默认地址</span>
                          <span className="text-[8px] text-slate-400 font-medium mt-0.5">每次下单或添加地址时优先推荐</span>
                        </div>
                        <button 
                          onClick={() => setAddressIsDefault(!addressIsDefault)}
                          className={`w-8 h-4.5 rounded-full p-0.5 transition-colors focus:outline-none shrink-0 ${
                            addressIsDefault ? 'bg-emerald-500' : 'bg-slate-200'
                          }`}
                        >
                          <div className={`bg-white w-3.5 h-3.5 rounded-full shadow-md transform duration-200 ease-in-out ${
                            addressIsDefault ? 'translate-x-3.5' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>

                    </div>
                  </div>

                  {/* Standard WeChat Native bottom "保存" button */}
                  <div className="p-3 bg-white border-t border-slate-100 shrink-0">
                    <button 
                      onClick={() => {
                        const currentType = orderStatus === 'select-dest' ? 'dest' : 'start';
                        const finalAddressName = selectedLocName || searchKeyword.trim();
                        
                        if (!finalAddressName) {
                          onTriggerToast('请在详细地址中输入或选择有效位置！');
                          return;
                        }
                        
                        // Smart contact sync
                        if (addressPhone.trim() && addressPhone !== '13988889999') {
                          setPassengerPhone(addressPhone);
                        }
                        
                        if (currentType === 'start') {
                          setStartPoint(finalAddressName);
                        } else {
                          setDestination(finalAddressName);
                        }
                        
                        setOrderStatus('idle');
                        setSearchKeyword('');
                        onTriggerToast(`✓ 已应用${currentType === 'start' ? '出发' : '目的'}地址：${finalAddressName}`);
                      }}
                      className="w-full bg-[#0067FF] hover:bg-blue-700 text-white font-black text-[11px] py-2.5 rounded-xl transition-all active:scale-95 shadow-md shadow-blue-500/15"
                    >
                      保存并使用
                    </button>
                  </div>

                  {/* WeChat Bottom Sheet Region/District Picker Dialog Overlay */}
                  {showAreaPicker && (
                    <div className="absolute inset-0 bg-black/40 z-50 flex flex-col justify-end animate-in fade-in duration-200">
                      <div className="bg-white rounded-t-2xl max-h-[60%] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-250">
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
                          <span className="text-[11px] font-black text-slate-800">选择所在地区</span>
                          <button 
                            onClick={() => setShowAreaPicker(false)}
                            className="text-[11px] font-black text-blue-600"
                          >
                            确定
                          </button>
                        </div>
                        <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                          {[
                            '兴庆区',
                            '金凤区',
                            '西夏区',
                            '贺兰县',
                            '永宁县',
                            '灵武市'
                          ].map((district) => {
                            const areaName = `宁夏回族自治区 银川市 ${district}`;
                            const isSelected = addressArea === areaName;
                            return (
                              <div 
                                key={district}
                                onClick={() => {
                                  setAddressArea(areaName);
                                  setShowAreaPicker(false);
                                  onTriggerToast(`已选择所在地区：${district}`);
                                }}
                                className="px-4 py-3 text-left flex items-center justify-between hover:bg-slate-50 cursor-pointer transition-colors"
                              >
                                <span className={`text-[11.5px] font-black ${isSelected ? 'text-blue-600' : 'text-slate-700'}`}>
                                  {areaName}
                                </span>
                                {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 stroke-[3]" />}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : orderStatus === 'rules' ? (
                <div className="flex-1 flex flex-col bg-[#f8f9fb] text-[#191c1e] select-none pb-6 overflow-y-auto animate-in fade-in slide-in-from-right duration-200">
                  <main className="px-3 pt-3 space-y-4">
                    {/* Map Visualization Section */}
                    <section className="relative rounded-2xl overflow-hidden h-44 shadow-sm border border-slate-100 shrink-0">
                      <TencentMap apiKey="5N4BZ-YFOCT-BWJXC-L7O2O-ATI6K-UYFZW" showBoundary={true} />
                      
                      {/* Map Overlay Legend */}
                      <div className="absolute bottom-2 left-2 bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-lg shadow-sm flex items-center gap-1.5 border border-slate-200/50 z-20">
                        <span className="w-2.5 h-2.5 bg-[#033998] rounded-sm opacity-80" />
                        <span className="text-[9px] font-bold text-slate-800">围栏范围 (银川城区)</span>
                      </div>
                      
                      {/* Map Attribution */}
                      <div className="absolute bottom-1 right-2 flex items-center gap-0.5 opacity-60 z-20">
                        <span className="text-[8px] font-medium text-slate-500">高德地图</span>
                      </div>
                    </section>

                    {/* Pricing Rules Title */}
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>
                        <h2 className="text-sm font-black text-slate-800">代驾计价规则</h2>
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>
                      </div>
                    </div>

                    {/* Pricing Content Card */}
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-5">
                      
                      {/* Scope Section */}
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-1.5 border-l-3 border-[#033998] pl-2">
                          <h3 className="text-xs font-black text-slate-850">黑湾代驾银川城区范围内</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                            <span className="text-[9px] font-bold text-slate-400 mb-1">晚上12点前</span>
                            <div className="flex items-baseline gap-0.5">
                              <span className="text-[#033998] font-black text-xl">28</span>
                              <span className="text-slate-600 text-[9px] font-bold">元 / 一小时</span>
                            </div>
                            <div className="mt-1.5 pt-1 border-t border-slate-100 flex items-center gap-1 text-[8px] text-emerald-600 font-extrabold">
                              <span>✓</span>
                              <span>随便跑</span>
                            </div>
                          </div>
                          
                          <div className="flex flex-col p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                            <span className="text-[9px] font-bold text-slate-400 mb-1">晚上12点后</span>
                            <div className="flex items-baseline gap-0.5">
                              <span className="text-[#033998] font-black text-xl">35</span>
                              <span className="text-slate-600 text-[9px] font-bold">元 / 一小时</span>
                            </div>
                            <div className="mt-1.5 pt-1 border-t border-slate-100 flex items-center gap-1 text-[8px] text-emerald-600 font-extrabold">
                              <span>✓</span>
                              <span>随便跑</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Overtime & OOB rules */}
                      <div className="bg-slate-50 rounded-xl p-3 space-y-2 text-[10px] text-slate-600 font-medium">
                        <div className="flex items-center gap-2">
                          <span className="text-[#835500] font-bold">⏱</span>
                          <p>超一小时一分钟 <span className="font-bold text-slate-800">1</span> 元</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[#835500] font-bold">📍</span>
                          <p>超范围一公里 <span className="font-bold text-slate-800">5</span> 元</p>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-[#835500] font-bold mt-0.5">⏳</span>
                          <div>
                            <p>司机就位免费等待 <span className="font-bold text-slate-800">10</span> 分钟</p>
                            <p className="text-[8px] text-slate-400">超1分钟加收1元</p>
                          </div>
                        </div>
                      </div>

                      {/* Out of Bounds Rules */}
                      <div className="pt-4 border-t border-slate-100 space-y-2.5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[#033998]">🚫</span>
                          <h3 className="text-xs font-black text-slate-850">范围外起步计费规则</h3>
                        </div>
                        <div className="space-y-2">
                          <div className="flex flex-col gap-0.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                            <span className="text-[9px] font-bold text-amber-600">晚上12点前</span>
                            <p className="text-[10px] text-slate-600 font-medium">
                              <span className="font-black text-[#033998] text-xs">28元</span> 包含5公里，超5公里后每公里加收 <span className="font-black text-[#033998]">2元</span>
                            </p>
                          </div>
                          <div className="flex flex-col gap-0.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                            <span className="text-[9px] font-bold text-amber-600">晚上12点后</span>
                            <p className="text-[10px] text-slate-600 font-medium">
                              <span className="font-black text-[#033998] text-xs">35元</span> 包含5公里，超5公里后每公里加收 <span className="font-black text-[#033998]">2元</span>
                            </p>
                          </div>
                        </div>
                      </div>

                    </div>

                    {/* Small inline Return Button */}
                    <div className="pt-2 pb-4 flex justify-center">
                      <button 
                        onClick={() => setOrderStatus('profile')}
                        className="px-4 py-1.5 bg-gradient-to-r from-slate-700 to-slate-800 active:scale-95 text-white font-black rounded-xl text-[10px] transition-all flex items-center gap-1 shadow-md cursor-pointer"
                      >
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
                        </svg>
                        <span>返回个人中心</span>
                      </button>
                    </div>

                  </main>
                </div>
              ) : orderStatus === 'agreement' ? (
                <div className="flex-1 flex flex-col bg-slate-50 text-slate-800 select-none pb-6 overflow-y-auto animate-in fade-in slide-in-from-right duration-200">
                  <main className="px-3 pt-3.5 space-y-4">
                    {/* Agreement Card */}
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-4">
                      
                      <div className="flex flex-col items-center gap-1 pb-2 border-b border-slate-100">
                        <span className="text-[9px] uppercase tracking-widest text-slate-400 font-extrabold">USER AGREEMENT</span>
                        <h2 className="text-xs font-black text-slate-800">代驾服务使用协议</h2>
                      </div>

                      <div className="space-y-4 text-[10px] text-slate-600 leading-relaxed max-h-[340px] overflow-y-auto pr-1">
                        
                        {/* Section 1 */}
                        <div className="space-y-1.5">
                          <h3 className="font-extrabold text-slate-800 text-[11px] border-l-2 border-orange-500 pl-1.5">
                            第一条 用户注册与资格
                          </h3>
                          <div className="space-y-1 pl-1 text-slate-500">
                            <p className="font-medium">
                              1. 您注册时，请您认真阅读本协议，审阅并接受或不接受本协议。若您确认注册为本平台用户，即表示您已充分阅读、理解并同意自己与本平台订立本协议。
                            </p>
                          </div>
                        </div>

                        {/* Section 2 */}
                        <div className="space-y-1.5 text-left">
                          <h3 className="font-extrabold text-slate-800 text-[11px] border-l-2 border-orange-500 pl-1.5">
                            第二条 居间服务与收费
                          </h3>
                          <div className="space-y-1 pl-1 text-slate-500">
                            <p>
                              1. 本平台仅为用户与代驾员之间提供信息居间发布与撮合服务，并非道路运输主体或承运人。
                            </p>
                            <p>
                              2. 服务费用的计算标准将在“计价规则”中明确列示。用户应根据行程结束后的系统结算提示，通过本平台支持的支付渠道完成费用支付。
                            </p>
                          </div>
                        </div>

                      </div>
                    </div>

                    {/* Small inline Return Button */}
                    <div className="pt-2 pb-4 flex justify-center">
                      <button 
                        onClick={() => setOrderStatus('profile')}
                        className="px-4 py-1.5 bg-gradient-to-r from-slate-700 to-slate-800 active:scale-95 text-white font-black rounded-xl text-[10px] transition-all flex items-center gap-1 shadow-md cursor-pointer"
                      >
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
                        </svg>
                        <span>返回个人中心</span>
                      </button>
                    </div>

                  </main>
                </div>
              ) : orderStatus === 'privacy' ? (
                <div className="flex-1 flex flex-col bg-slate-50 text-slate-800 select-none pb-6 overflow-y-auto animate-in fade-in slide-in-from-right duration-200">
                  <main className="px-3 pt-3.5 space-y-4">
                    {/* Privacy Policy Card */}
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-4">
                      
                      <div className="flex flex-col items-center gap-1 pb-2 border-b border-slate-100">
                        <span className="text-[9px] uppercase tracking-widest text-slate-400 font-extrabold">PRIVACY POLICY</span>
                        <h2 className="text-xs font-black text-slate-800">隐私条款与个人信息保护政策</h2>
                      </div>

                      {isLogOutConfirmMode && (
                        <div className="bg-rose-50/70 border border-rose-100 text-rose-800 rounded-xl p-3 text-[9.5px] space-y-1">
                          <p className="font-extrabold text-[10px] flex items-center gap-1">⚠️ 确定退出登录并清除手机缓存吗？</p>
                          <p className="leading-relaxed">
                            为了保障您的数据隐私，退出登录将清除您在当前设备上的全部手机号认证及草稿状态。请阅读下方《隐私条款》以了解您的数据如何受到全面保护。<b>退出后如需重新注册，您需要再次输入手机号和验证码进行校验。</b>
                          </p>
                        </div>
                      )}

                      <div className="space-y-4 text-[10px] text-slate-600 leading-relaxed max-h-[300px] overflow-y-auto pr-1 font-sans">
                        
                        {/* Summary / Preamble */}
                        <div className="bg-amber-50/50 text-[9.5px] border border-amber-100 rounded-xl p-3 text-amber-800 space-y-1">
                          <p className="font-extrabold text-[10px]">💡 核心摘要与风险提示：</p>
                          <p>
                            为保障您的个人隐私与合法权益，我们特根据《中华人民共和国个人信息保护法》等法律法规制定本政策。本平台收集的手机号、GPS定位、身份信息及驾驶资质为提供<b>核心叫单、行车安全、居间匹配、代驾资质核验</b>所绝对必需。我们郑重承诺，绝不将您的个人敏感信息泄露或滥用。同时，本政策中包含了多项<b>平台免责及第三方SDK（如地图、短信）服务免责条款</b>，请您务必仔细阅读以了解您的权益范围。
                          </p>
                        </div>

                        {/* Section 1 */}
                        <div className="space-y-1.5">
                          <h3 className="font-extrabold text-slate-800 text-[11px] border-l-2 border-blue-500 pl-1.5">
                            第一条 个人信息收集与授权范围
                          </h3>
                          <div className="space-y-1 pl-1 text-slate-500">
                            <p className="font-medium">
                              在您使用黑湾代驾服务（包括叫单、查看路线、申请成为代驾司机等）过程中，我们将本着“合法、正当、必要和诚信”原则收集、使用、存储您的个人信息，用途如下：
                            </p>
                            <p>
                              1. <b>账号注册、登录与安全校验</b>：我们将收集您的<b>手机号码</b>。该信息用于为您建立用户档案、下发验证码、提供客服支持。
                            </p>
                            <p>
                              2. <b>精准定位与行车安全服务</b>：当您在前端叫单或在司机听单模式下，我们需要收集、使用您的<b>精准GPS地理位置信息、行驶轨迹、起点和终点</b>。这是计算行程里程、进行精确车费结算、向您推荐就近司机、在途路线追踪、保障行车人身安全的核心技术手段。若您拒绝授权，将无法使用本平台的地图核心叫单功能。
                            </p>
                            <p>
                              3. <b>服务人员（司机）资质核验与背景审查</b>：如果您申请注册成为代驾服务人员，根据中国法律关于公共道路运输、网约、代驾行业的合规要求，我们必须收集您的<b>真实姓名、身份证号码、身份证正反面照片、驾驶证正副页照片、准驾车型及领证日期</b>。这些信息仅用于背景安全审查、核查无犯罪记录、验证驾驶证有效性及排除危险驾驶倾向，不作他用。如您不提供，本平台有权拒绝您的注册申请。
                            </p>
                            <p>
                              4. <b>紧急情况救助保障</b>：在注册司机或叫单时，我们允许您填写<b>紧急联系人姓名及电话</b>。我们仅在极端突发状况（如交通事故、人身危险、紧急失联）下拨打该电话，以最大可能维护您生命财产安全。
                            </p>
                          </div>
                        </div>

                        {/* Section 2 */}
                        <div className="space-y-1.5">
                          <h3 className="font-extrabold text-slate-800 text-[11px] border-l-2 border-blue-500 pl-1.5">
                            第二条 信息的存储期限与安全防御
                          </h3>
                          <div className="space-y-1 pl-1 text-slate-500">
                            <p>
                              1. <b>本地存储与跨境</b>：我们在中华人民共和国境内收集和产生的个人信息将<b>存储在中华人民共和国境内</b>。除非有中国法律法规的明确授权或政府行政、司法机关的要求，我们不会将您的个人信息传输至境外。
                            </p>
                            <p>
                              2. <b>存储期限</b>：我们仅在提供本平台服务所必需的期限内保留您的个人信息。在您注销账号或删除个人信息后，我们将在法律要求的合理保留期（如《电子商务法》要求的交易信息保留不少于三年）届满后对您的信息进行删除或匿名化处理。
                            </p>
                            <p>
                              3. <b>技术安全防护措施</b>：本平台采用符合业界标准的安全防护措施、数据加密传输（如 HTTPS、TLS 协议）和存储加密（对身份证号、手机号采用高强度单向哈希或对称加密脱敏存储），严格防范他人未经授权访问、修改、泄露您的个人信息。
                            </p>
                          </div>
                        </div>

                        {/* Section 3 */}
                        <div className="space-y-1.5">
                          <h3 className="font-extrabold text-slate-800 text-[11px] border-l-2 border-blue-500 pl-1.5">
                            第三条 平台法律责任豁免与风险防范（重要）
                          </h3>
                          <div className="space-y-1 pl-1 text-slate-500">
                            <p className="font-semibold text-slate-700">
                              为了保障本平台的正常、合规运转，并妥善厘清各方的法律责任边界，特约定如下免责与风险分散机制：
                            </p>
                            <p>
                              1. <b>第三方组件（SDK）独立责任豁免</b>：
                              本平台的核心定位、地图展示、路径规划及短信发送分别集成了第三方供应商的成熟产品（如：腾讯地图 SDK、阿里云/腾讯云短信服务）。这些第三方服务为提供其特定功能，将独立收集和处理您的网络状态、IP及设备标识等。<b>本平台已在合理商业限度内对服务商的安全合规情况进行了审核，因第三方系统漏洞、未授权篡改、或不可抗拒技术波动引发的个人数据泄露，平台在法律允许的最大范围内不对第三方的独立侵权行为承担直接及连带赔偿责任。</b>
                            </p>
                            <p>
                              2. <b>居间撮合与法律关系独立性</b>：
                              本平台提供的是技术信息发布与居间匹配服务。代驾司机与乘客之间独立形成代驾服务合同关系。在服务履行期间（从司机接车开始至安全停靠交车完毕），如因道路突发车祸、财产遗失、三方侵权等原因遭受损失的，<b>应首先由各方的承运险、车辆交强险及商业险或司乘个人保险进行理赔</b>。本平台依法建立健全平台安全管理制度与资质审核，但除法律明文规定的严重审核失职、平台故意过错等法定责任外，不对司机或乘客在服务过程中的单方违约、过失侵权、交通违法罚款或人身损害等承担连带赔偿和合同保底责任。
                            </p>
                            <p>
                              3. <b>用户账号凭证保管义务</b>：
                              短信验证码、登录凭证是您访问本平台的唯一数字标识。任何由于您<b>主动或过失将验证码泄露给第三方、手机不慎遗失而被他人冒用、未及时申请挂失、或遭遇个人终端病毒木马感染</b>而导致的身份泄露、申请资料被篡改、财产遭受损失的情形，其不利法律后果应由您自行承担。
                            </p>
                            <p>
                              4. <b>技术与不可抗力免责</b>：
                              鉴于互联网无线通信技术的特殊性，遭遇黑客攻击、电信运营商基站故障、卫星定位信号盲区、政府管制命令、自然灾害等导致的定位偏差、系统卡顿、消息延迟发送或数据部分丢失，平台将尽力协助救援并恢复，但在法律允许限度内免于承担违约与赔偿连带责任。
                            </p>
                          </div>
                        </div>

                        {/* Section 4 */}
                        <div className="space-y-1.5">
                          <h3 className="font-extrabold text-slate-800 text-[11px] border-l-2 border-blue-500 pl-1.5">
                            第四条 个人信息管理权利
                          </h3>
                          <div className="space-y-1 pl-1 text-slate-500">
                            <p>
                              根据中国法律规定，您对您的个人信息享有合法的控制权，具体包括：
                            </p>
                            <p>
                              1. <b>查询与更正</b>：您有权访问您的个人资料及注册司机资料。若信息发生变化或发现有误，您可以随时修改。
                            </p>
                            <p>
                              2. <b>撤回同意</b>：您可以随时在系统设置中关闭位置定位权限、通知权限，撤回对相应数据的继续收集。撤回不影响在此之前基于您同意已进行的信息处理。
                            </p>
                            <p>
                              3. <b>注销账号</b>：若您不需要继续使用本平台服务，您可以联系客服申请注销。我们将在核验账户安全后为您彻底删除所有关联数据或进行不可逆的匿名化。
                            </p>
                          </div>
                        </div>

                        {/* Section 5 */}
                        <div className="space-y-1.5">
                          <h3 className="font-extrabold text-slate-800 text-[11px] border-l-2 border-blue-500 pl-1.5">
                            第五条 条款更新与适用法律
                          </h3>
                          <div className="space-y-1 pl-1 text-slate-500">
                            <p>
                              1. <b>政策调整公告</b>：本《隐私政策》将根据大陆法律政策动态、本平台服务升级等情况进行修订。一旦进行修改，我们将通过本软件弹窗、公告等合理形式告知。若您在修订后继续使用，即视为您完全阅读并理解新版隐私政策。
                            </p>
                            <p>
                              2. <b>管辖与争议解决</b>：本政策的成立、生效、履行、解释及争议解决均适用<b>中华人民共和国大陆地区法律</b>。若因本政策产生任何争议，双方应首先友好协商解决；协商不成的，任何一方均有权向<b>本平台运营方所在地有管辖权的人民法院提起诉讼</b>。
                            </p>
                          </div>
                        </div>

                      </div>
                    </div>

                    {/* Return or Action Buttons */}
                    {isLogOutConfirmMode ? (
                      <div className="pt-2 pb-6 flex gap-3 justify-center">
                        <button 
                          onClick={() => {
                            setIsLogOutConfirmMode(false);
                            setOrderStatus('driver-register');
                          }}
                          className="flex-1 max-w-[120px] py-2 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 font-extrabold rounded-xl text-[10px] transition-all text-center border border-slate-200 cursor-pointer"
                        >
                          取消并返回
                        </button>
                        <button 
                          onClick={() => {
                            setIsLogOutConfirmMode(false);
                            setOrderStatus('driver-register');
                            setDriverRegStep('login');
                            setRegisterPhone('');
                            setRegisterCode('');
                            setSentCode('');
                            setDriverRegName('');
                            setDriverRegIdCard('');
                            setDriverRegEmergencyContact('');
                            setDriverRegEmergencyPhone('');
                            setDriverRegIdPhoto('');
                            setDriverRegIdPhotoBack('');
                            setDriverRegLicensePhoto('');
                            setDriverRegIssueDate('');
                            setDriverRegAgreed(false);
                            onTriggerToast('✓ 已成功退出登录，临时缓存已安全清除。');
                          }}
                          className="flex-1 max-w-[120px] py-2 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 active:scale-95 text-white font-extrabold rounded-xl text-[10px] transition-all text-center shadow-md cursor-pointer flex items-center justify-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M17 16l4-4m0 0l-4-4m4 4H7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
                          </svg>
                          <span>确定退出登录</span>
                        </button>
                      </div>
                    ) : (
                      <div className="pt-1 pb-4 flex justify-center">
                        <button 
                          onClick={() => setOrderStatus(privacyBackTo)}
                          className="px-4 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 active:scale-95 text-white font-black rounded-xl text-[10px] transition-all flex items-center gap-1 shadow-md cursor-pointer"
                        >
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
                          </svg>
                          <span>返回上一页</span>
                        </button>
                      </div>
                    )}

                  </main>
                </div>
              ) : orderStatus === 'driver-register' ? (
                <div className="flex-1 flex flex-col bg-[#F7F7F7] text-slate-800 select-none pb-6 overflow-y-auto animate-in fade-in slide-in-from-right duration-250">
                  {driverRegStep === 'login' ? (
                    <>
                      {/* BEGIN: HeaderSection */}
                      <header 
                        className="w-full pt-10 pb-10 px-6 relative overflow-hidden shrink-0" 
                        style={{ background: 'linear-gradient(180deg, #FF8D3F 0%, #FF741F 100%)' }}
                        data-purpose="hero-banner"
                      >
                        <div className="relative z-10 max-w-[62%] text-left">
                          <h1 className="text-white text-2xl font-black italic tracking-wider mb-2 leading-tight">
                            海量订单·保险保障
                          </h1>
                          <div className="text-orange-100 text-xs opacity-95 leading-snug font-bold">
                            加入黑湾代驾 开启赚钱之旅
                            <div className="mt-1 text-[11px] font-medium text-orange-200">长期招募代驾员， 期待您的加入</div>
                          </div>
                        </div>
                        {/* Illustration Container */}
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 w-24 h-24 pointer-events-none flex items-center justify-end" data-purpose="illustration-container">
                          <img 
                            alt="Driver Illustration" 
                            className="object-contain max-h-full max-w-full mix-blend-multiply rounded-full" 
                            referrerPolicy="no-referrer"
                            src={driverAvatar || '/driver_avatar.jpg'}
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (target.src !== DRIVER_AVATAR_BASE64) {
                                target.src = DRIVER_AVATAR_BASE64;
                              }
                            }}
                          />
                        </div>
                      </header>
                      {/* END: HeaderSection */}

                      {/* BEGIN: RegistrationForm */}
                      <main className="flex-1 -mt-4 bg-white rounded-t-2xl px-5 pt-5 z-10 shadow-lg flex flex-col" data-purpose="main-form-container">

                        {/* Phone Number Field */}
                        <div className="mb-4" data-purpose="phone-input-group">
                          <label className="block text-slate-800 text-xs font-black mb-1.5">1. 手机号码</label>
                          <div className="relative border-b border-gray-200 focus-within:border-[#FF741F] transition-all">
                            <input 
                              className="w-full bg-transparent border-0 py-1.5 px-0 text-slate-900 text-sm font-bold placeholder-gray-300 focus:ring-0 focus:outline-none" 
                              placeholder="请输入您的手机号码" 
                              type="tel"
                              maxLength={11}
                              value={registerPhone}
                              onChange={(e) => setRegisterPhone(e.target.value.replace(/\D/g, ''))}
                            />
                          </div>
                        </div>

                        {/* Verification Code Field */}
                        <div className="mb-5" data-purpose="verification-input-group">
                          <label className="block text-slate-800 text-xs font-black mb-1.5">2. 验证码</label>
                          <div className="flex items-center border-b border-gray-200 focus-within:border-[#FF741F] transition-all">
                            <input 
                              className="flex-grow bg-transparent border-0 py-1.5 px-0 text-slate-900 text-sm font-bold placeholder-gray-300 focus:ring-0 focus:outline-none" 
                              placeholder="请输入验证码" 
                              type="text"
                              maxLength={6}
                              value={registerCode}
                              onChange={(e) => setRegisterCode(e.target.value.replace(/\D/g, ''))}
                            />
                            <button 
                              onClick={async () => {
                                if (!registerPhone || registerPhone.length !== 11) {
                                  onTriggerToast('⚠️ 请先输入11位有效手机号码！');
                                  return;
                                }
                                setIsSendingCode(true);
                                try {
                                  const res = await fetch(`${getBaseApiUrl()}/api/sms/send`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ phone: registerPhone.trim() })
                                  });
                                  const data = await res.json();
                                  setIsSendingCode(false);
                                  if (data.success) {
                                    setRegisterCountdown(60);
                                    if (data.mode === 'simulated' && false) {
                                      setSentCode(data.code || '');
                                      onTriggerToast(`📱 [测试环境模拟短信] 验证码为: ${data.code}，请填入。`);
                                    } else {
                                      setSentCode('REAL_SMS');
                                      onTriggerToast('✓ 真实验证码已发送！请查收您的手机短信。');
                                    }
                                  } else {
                                    onTriggerToast(`❌ 发送失败: ${data.error || '短信接口异常'}`);
                                  }
                                } catch (err: any) {
                                  setIsSendingCode(false);
                                  onTriggerToast('❌ 发送失败: 无法连接网络/服务器');
                                }
                              }}
                              disabled={registerCountdown > 0 || isSendingCode}
                              className={`font-black text-[11px] px-3 py-1 rounded-lg transition-all ${
                                registerCountdown > 0 || isSendingCode
                                  ? 'text-slate-400 bg-slate-100' 
                                  : 'text-[#FF741F] bg-orange-50 hover:bg-orange-100 active:scale-95'
                              }`}
                              data-purpose="send-code-button" 
                              type="button"
                            >
                              {isSendingCode ? '发送中...' : registerCountdown > 0 ? `${registerCountdown}s` : '发送验证码'}
                            </button>
                          </div>
                        </div>

                        {/* Submit Button */}
                        <div className="mt-auto pb-4" data-purpose="action-buttons">
                          <button 
                            onClick={async () => {
                              if (!registerPhone || registerPhone.length !== 11) {
                                onTriggerToast('⚠️ 请输入正确的11位手机号码！');
                                return;
                              }
                              if (!registerCode) {
                                onTriggerToast('⚠️ 请输入验证码！');
                                return;
                              }
                              setIsVerifyingCode(true);
                              try {
                                const res = await fetch(`${getBaseApiUrl()}/api/sms/verify`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ phone: registerPhone.trim(), code: registerCode.trim() })
                                });
                                const data = await res.json();
                                setIsVerifyingCode(false);
                                if (data.success) {
                                  onTriggerToast('✓ 手机验证通过！请继续填写基本信息。');
                                  setDriverRegStep('form');
                                } else {
                                  onTriggerToast(`⚠️ 校验失败: ${data.error || '验证码不正确'}`);
                                }
                              } catch (err: any) {
                                setIsVerifyingCode(false);
                                onTriggerToast('⚠️ 校验异常: 无法连接服务器');
                              }
                            }}
                            disabled={isVerifyingCode}
                            className="w-full text-white font-black py-2.5 rounded-full text-sm shadow-md tracking-wider transform transition-transform active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1"
                            style={{ background: 'linear-gradient(180deg, #FF8D3F 0%, #FF741F 100%)' }}
                            id="next-step-btn"
                          >
                            {isVerifyingCode ? '验证中...' : '下一步'}
                          </button>
                          {/* Agreement Link */}
                          <div className="mt-2 text-center">
                            <p className="text-[10px] text-gray-400 font-bold">
                              点击下一步即代表您同意 
                              <button 
                                onClick={() => {
                                  onTriggerToast('📑 打开《黑湾代驾用户注册协议》');
                                  setOrderStatus('agreement');
                                }}
                                className="text-blue-500 font-black ml-1 cursor-pointer focus:outline-none inline"
                              >
                                《黑湾代驾用户注册协议》
                              </button>
                            </p>
                          </div>

                          {/* 🛠️ Debug Section: Simulated Login */}
                          <div className="mt-5 p-3 border border-dashed border-orange-300 rounded-xl bg-orange-50/30 text-left">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-black text-orange-600 flex items-center gap-1">
                                🛠️ 调试专区 · 模拟免密登录
                              </span>
                              <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-black">
                                DEBUG
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 mb-2.5 leading-relaxed">
                              输入手机号后点击“一键登录”，可免验证码直接进入成为司机表单填写页面，方便调试。
                            </p>
                            <div className="flex gap-2">
                              <input 
                                type="tel"
                                maxLength={11}
                                className="flex-grow min-w-0 bg-white border border-gray-200 rounded px-2.5 py-1 text-xs font-bold text-slate-800 placeholder-gray-300 focus:ring-1 focus:ring-orange-400 focus:border-orange-400 focus:outline-none"
                                placeholder="输入手机号"
                                value={registerPhone}
                                onChange={(e) => setRegisterPhone(e.target.value.replace(/\D/g, ''))}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (!registerPhone || registerPhone.length !== 11) {
                                    onTriggerToast('⚠️ 请先输入或选择一个11位手机号码！');
                                    return;
                                  }
                                  onTriggerToast(`✓ 调试登录：手机号 ${registerPhone} 已免密通过校验！`);
                                  setDriverRegStep('form');
                                }}
                                className="px-3 py-1 bg-[#FF8225] hover:bg-orange-600 text-white font-black text-[11px] rounded transition-all active:scale-[0.98] cursor-pointer shadow-sm shrink-0"
                              >
                                🚀 一键登录
                              </button>
                            </div>
                            <div className="mt-2 flex gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => {
                                  setRegisterPhone('13888888888');
                                  onTriggerToast('💡 已填入默认测试手机号 13888888888');
                                }}
                                className="text-[9px] text-orange-600 hover:underline cursor-pointer bg-white px-1.5 py-0.5 rounded border border-orange-200 font-bold"
                              >
                                填入 13888888888
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRegisterPhone('18899998888');
                                  onTriggerToast('💡 已填入默认测试手机号 18899998888');
                                }}
                                className="text-[9px] text-orange-600 hover:underline cursor-pointer bg-white px-1.5 py-0.5 rounded border border-orange-200 font-bold"
                              >
                                填入 18899998888
                              </button>
                            </div>
                          </div>
                        </div>
                      </main>
                    </>
                  ) : driverRegStep === 'agreement' ? (
                    <div className="flex-1 flex flex-col bg-slate-50 text-slate-800 select-none pb-6 overflow-y-auto animate-in fade-in slide-in-from-right duration-200">
                      <main className="px-3 pt-3.5 space-y-4">
                        {/* Agreement Card */}
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-4">
                          
                          <div className="flex flex-col items-center gap-1 pb-2 border-b border-slate-100">
                            <span className="text-[9px] uppercase tracking-widest text-slate-400 font-extrabold">COOPERATION AGREEMENT</span>
                            <h2 className="text-xs font-black text-slate-800">服务人员合作协议</h2>
                          </div>

                          <div className="space-y-4 text-[10px] text-slate-600 leading-relaxed max-h-[380px] overflow-y-auto pr-1">
                            
                            {/* Section 1 */}
                            <div className="space-y-1.5 text-left">
                              <h3 className="font-extrabold text-slate-800 text-[11px] border-l-2 border-[#FF8225] pl-1.5">
                                第一条 用户注册与资格
                              </h3>
                              <div className="space-y-2 pl-1 text-slate-500">
                                <p className="font-medium text-slate-700">
                                  1. 您注册时，请您认真阅读本协议，审阅并接受或不接受本协议。若您确认注册为本平台用户，即表示您已充分阅读、理解并同意自己与本平台订立本协议，且您自愿受本协议的条款约束。本平台有权随时根据实际情况变更本协议并在本平台上予以公告。经修订的条款一经在本平台的公布后，立即自动生效。如您不同意相关变更，必须停止使用本平台，并注销您的账户信息，一旦您继续使用本平台，则表示您已接受并自愿遵守经修订后的条款。本协议内容包括协议正文及所有本平台已经发布的各类规则。所有规则为本协议不可分割的一部分，与本协议正文具有同等法律效力。
                                </p>
                                <p>
                                  2. 用户一经签署本协议，即视为用户允许代驾平台通过短信、公众号、APP 服务器推送或其他方式向其发送订单服务信息、优惠服务信息及与本协议相关的其他信息。
                                </p>
                                <p>
                                  3. 用户应保证其注册信息的真实、准确、有效；如该等信息有任何变更，用户应当及时完成信息更新。因用户信息更新不及时所导致用户遭受任何损失的，应由用户自行承担责任，代驾平台不承担责任。
                                </p>
                                <p>
                                  4、只有符合下列条件之一的自然人或法人才能申请成为本平台用户，可以使用本平台的服务：a、年满十八岁，并具有民事权利能力和民事行为能力的自然人；b、无民事行为能力人或限制民事行为能力人应事先取得其监护人的同意。
                                </p>
                              </div>
                            </div>

                            {/* Section 2 */}
                            <div className="space-y-1.5 text-left">
                              <h3 className="font-extrabold text-slate-800 text-[11px] border-l-2 border-[#FF8225] pl-1.5">
                                第二条 信息服务
                              </h3>
                              <div className="space-y-2 pl-1 text-slate-500">
                                <p>
                                  1. 代驾平台为用户提供发送代驾请求（叫单）和接受该请求（接单）的信息推送服务，以及用户代驾订单履行情况的信息记录服务。
                                </p>
                                <p>
                                  2. 代驾服务费收费标准由代驾服务提供商当地合作商制定及调整。
                                </p>
                                <p>
                                  3. 用户可通过代驾平台对代驾服务行为作出评价或投诉，代驾平台将用户评价和投诉实时反馈。
                                </p>
                              </div>
                            </div>

                          </div>
                        </div>

                        {/* Inline Return Buttons */}
                        <div className="pt-1 pb-4 flex flex-col items-center gap-2">
                          <button 
                            type="button"
                            onClick={() => {
                              setDriverRegAgreed(true);
                              setDriverRegStep('form');
                              onTriggerToast('✓ 已确认并同意服务人员合作协议');
                            }}
                            className="w-full max-w-[200px] py-2 bg-[#FF8225] active:scale-95 text-white font-extrabold rounded-lg text-xs transition-all shadow-md cursor-pointer text-center"
                          >
                            确认并同意协议
                          </button>
                          <button 
                            type="button"
                            onClick={() => setDriverRegStep('form')}
                            className="text-[10px] text-slate-400 hover:text-slate-600 font-bold hover:underline cursor-pointer"
                          >
                            返回信息填写页
                          </button>
                        </div>

                      </main>
                    </div>
                  ) : driverRegStep === 'success' ? (
                    driverApplicationStatus === 'approved' ? (
                      <div className="flex-1 flex flex-col bg-[#f9f9f9] text-[#1a1c1c] animate-in fade-in duration-200 overflow-hidden">
                        {/* Main Content Canvas */}
                        <main className="flex-grow flex flex-col items-center justify-center px-4 py-2 relative overflow-hidden text-center">
                          {/* Decorative Background Element */}
                          <div className="absolute inset-0 pointer-events-none -z-10 bg-radial-gradient from-orange-500/5 to-transparent"></div>
                          
                          {/* Success Icon */}
                          <div className="relative w-12 h-12 flex items-center justify-center bg-[#ff7d00]/10 rounded-full mb-2 shrink-0 cursor-pointer" onClick={() => onTriggerToast('✨ 祝您订单多多，出行安全！')}>
                            <div className="absolute inset-0 rounded-full border-4 border-[#ff7d00]/20 scale-105 animate-pulse"></div>
                            <svg className="w-8 h-8 text-[#ff7d00]" fill="currentColor" viewBox="0 0 24 24">
                              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.5 2.5a.75.75 0 001.14-.082l3.75-5.25z" clipRule="evenodd" />
                            </svg>
                          </div>

                          {/* Titles */}
                          <h2 className="text-sm font-black text-[#1a1c1c] mb-0.5 shrink-0">恭喜您加入黑湾代驾！</h2>
                          <div className="text-[10px] text-[#584235] max-w-[280px] mb-2 leading-snug shrink-0">
                            您已成功通过审核
                            <div className="font-bold text-[#ff7d00]">祝您订单多多，收入多多！</div>
                          </div>

                          {/* Info Card (Styled) */}
                          <div className="w-full bg-white border border-[#e2e2e2] rounded-lg p-2.5 text-left mb-2.5 space-y-0.5 shadow-xs shrink-0">
                            <div className="flex items-center gap-1 text-[#984800]">
                              <svg className="w-3.5 h-3.5 text-[#ff7d00]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 111.083 1.083l-.02.041m-1.013-1.013a4.5 4.5 0 00-6.364-6.364m10.932 10.932a4.5 4.5 0 10-6.364-6.364m6.364 6.364l4.5 4.5" />
                              </svg>
                              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-800">接单范围</h3>
                            </div>
                            <p className="text-[9.5px] text-[#636262] leading-normal">
                              微信小程序订单和支付宝小程序订单。实时为您推送周边订单，请保持接单状态。
                            </p>
                          </div>

                          {/* Driver Identity Glimpse */}
                          <div className="w-full relative rounded-lg overflow-hidden h-24 mb-2.5 shadow-xs border border-[#e2e2e2] shrink-0">
                            <img 
                              className="absolute inset-0 w-full h-full object-cover" 
                              src={READY_DRIVER_PATH}
                              alt="Ready Driver"
                              onError={(e) => {
                                const target = e.currentTarget;
                                if (target.src !== READY_DRIVER_BASE64) {
                                  target.src = READY_DRIVER_BASE64;
                                }
                              }}
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex items-end p-2.5">
                              <div className="text-white text-left">
                                <p className="text-[8px] opacity-80 font-bold uppercase tracking-wider">当前状态</p>
                                <div className="flex items-center gap-1">
                                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                                  <span className="text-[10px] font-black">准备就绪</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Action Area */}
                          <div className="w-full max-w-sm space-y-2 shrink-0">
                            <button 
                              type="button"
                              onClick={() => {
                                onTriggerToast('🎉 恭喜！您已成功进入听单队列，开启抢单与极速播报。');
                                setOrderStatus('idle');
                                setDriverRegStep('login');
                                setRegisterPhone('');
                                setRegisterCode('');
                                setSentCode('');
                                setDriverRegName('');
                                setDriverRegIdCard('');
                                setDriverRegEmergencyContact('');
                                setDriverRegEmergencyPhone('');
                                setDriverRegIdPhoto('');
                                setDriverRegIdPhotoBack('');
                                setDriverRegLicensePhoto('');
                                setDriverRegIssueDate('');
                                setDriverRegAgreed(false);
                              }}
                              className="w-full py-2 bg-[#ff7d00] text-white font-extrabold text-[11px] rounded-lg shadow-sm hover:brightness-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1"
                            >
                              立即接单
                              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0l-6.75 6.75M12 4.5l6.75 6.75" />
                              </svg>
                            </button>
                            <button 
                              type="button"
                              onClick={() => {
                                setOrderStatus('idle');
                                setDriverRegStep('login');
                                setRegisterPhone('');
                                setRegisterCode('');
                                setSentCode('');
                                setDriverRegName('');
                                setDriverRegIdCard('');
                                setDriverRegEmergencyContact('');
                                setDriverRegEmergencyPhone('');
                                setDriverRegIdPhoto('');
                                setDriverRegIdPhotoBack('');
                                setDriverRegLicensePhoto('');
                                setDriverRegIssueDate('');
                                setDriverRegAgreed(false);
                              }}
                              className="w-full py-2 bg-white border border-[#ff7d00] text-[#ff7d00] font-extrabold text-[11px] rounded-lg hover:bg-orange-50 active:scale-95 transition-all cursor-pointer text-center"
                            >
                              返回首页
                            </button>
                          </div>
                        </main>

                        {/* Footer Links */}
                        <footer className="pb-3 pt-1 flex flex-col items-center justify-center space-y-0.5 shrink-0">
                          <p className="text-[8px] text-[#8b7263] opacity-60">司机注册平台 · 安全合规服务</p>
                        </footer>
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col bg-[#f9f9f9] text-[#1a1c1c] animate-in fade-in duration-200 overflow-y-auto">
                        {/* Main Content Canvas */}
                        <main className="flex-grow flex flex-col items-center justify-center px-5 py-4 relative overflow-hidden text-center">
                            
                            {/* Background Decoration (Subtle) */}
                            <div className="absolute inset-0 pointer-events-none -z-10 bg-radial-gradient from-orange-500/5 to-transparent"></div>

                            {/* Success Hero Section */}
                            <div className="w-full max-w-sm flex flex-col items-center text-center space-y-3">
                                {/* Success Icon Container */}
                                <div className="relative w-12 h-12 flex items-center justify-center bg-[#ff7d00]/10 rounded-full">
                                    <div className="absolute inset-0 rounded-full border-4 border-[#ff7d00]/20 scale-105"></div>
                                    <svg className="w-8 h-8 text-[#ff7d00]" fill="currentColor" viewBox="0 0 24 24">
                                      <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.5 2.5a.75.75 0 001.14-.082l3.75-5.25z" clipRule="evenodd" />
                                    </svg>
                                </div>

                                {/* Typography Stack */}
                                <div className="space-y-1">
                                    <h2 className="text-base font-black text-[#1a1c1c]">申请已提交</h2>
                                    <p className="text-[10px] text-[#5f5e5e] px-2 leading-normal">
                                        您的注册申请已收到，我们将在最多3个工作日内完成审核。审核结果以黑湾代驾司管审批为准，请耐心等待。
                                    </p>
                                </div>

                                {/* Status Card (Bento-style detail) */}
                                <div className="w-full bg-[#f3f3f3] border border-[#dfc0af] rounded-lg p-2.5 flex items-center gap-2.5 text-left">
                                    <div className="p-1.5 bg-[#984800]/10 rounded-md">
                                        <svg className="w-4 h-4 text-[#984800]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p className="text-[8.5px] text-[#5f5e5e] font-extrabold uppercase tracking-wider">当前状态</p>
                                        <p className="text-[11px] text-[#1a1c1c] font-black">资料审核中 (预计72小时内)</p>
                                    </div>
                                </div>
                            </div>

                            {/* Action Area */}
                            <div className="w-full max-w-sm mt-4 space-y-2">
                                <button 
                                  type="button"
                                  onClick={() => onTriggerToast('📋 您已提交申请，当前状态：黑湾代驾司管审批中（预计72小时内）。')}
                                  className="w-full py-2 bg-[#ff7d00] text-white font-extrabold text-[11px] rounded-lg shadow-sm hover:brightness-105 active:scale-95 transition-all cursor-pointer"
                                >
                                    查看申请进度
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => {
                                    setOrderStatus('idle');
                                    setDriverRegStep('login');
                                    setRegisterPhone('');
                                    setRegisterCode('');
                                    setSentCode('');
                                    setDriverRegName('');
                                    setDriverRegIdCard('');
                                    setDriverRegEmergencyContact('');
                                    setDriverRegEmergencyPhone('');
                                    setDriverRegIdPhoto('');
                                    setDriverRegIdPhotoBack('');
                                    setDriverRegLicensePhoto('');
                                    setDriverRegIssueDate('');
                                    setDriverRegAgreed(false);
                                  }}
                                  className="w-full py-2 bg-white border border-[#ff7d00] text-[#ff7d00] font-extrabold text-[11px] rounded-lg hover:bg-orange-50 active:scale-95 transition-all cursor-pointer"
                                >
                                    返回首页
                                </button>
                            </div>
                        </main>

                        {/* Footer Links */}
                        <footer className="pb-4 pt-2 flex flex-col items-center justify-center space-y-0.5 shrink-0">
                            <div className="flex items-center space-x-2 text-[8.5px] text-[#5f5e5e] font-extrabold mb-0.5">
                                <span 
                                  onClick={() => { 
                                    setPrivacyBackTo('driver-register'); 
                                    setOrderStatus('privacy'); 
                                  }} 
                                  className="text-blue-500 hover:text-blue-600 transition-colors cursor-pointer select-none underline decoration-dashed decoration-1"
                                >
                                  隐私条款
                                </span>
                            </div>
                            <p className="text-[8px] text-[#8b7263] opacity-60">司机注册平台 · 安全合规服务</p>
                        </footer>
                      </div>
                    )
                  ) : (
                    <>
                      {/* BEGIN: Form Header Banner */}
                      <section className="bg-gradient-to-r from-orange-400 to-orange-500 relative overflow-hidden h-32 flex items-center px-4 shrink-0 shadow-inner">
                        <div className="z-10 text-left">
                          <h2 className="text-lg font-black text-white leading-tight">海量订单·保险保障</h2>
                          <p className="text-[10px] text-orange-50 bg-white/10 rounded-full px-2.5 py-0.5 inline-block mt-1 font-bold">
                            长期招募代驾员，期待您的加入！
                          </p>
                        </div>
                        {/* Driver Illustration */}
                        <div className="absolute right-2 bottom-0 w-24 h-24 flex items-end justify-end">
                          <img 
                            alt="Driver Illustration" 
                            className="max-h-full max-w-full object-contain rounded-full mix-blend-multiply" 
                            src={driverAvatar || '/driver_avatar.jpg'}
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (target.src !== DRIVER_AVATAR_BASE64) {
                                target.src = DRIVER_AVATAR_BASE64;
                              }
                            }}
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </section>
                      {/* END: Form Header Banner */}

                      {/* BEGIN: Detailed Form Content */}
                      <main className="-mt-3 relative z-20 px-3 pb-8 flex-1">
                        <div className="bg-white rounded-t-xl shadow-md p-4 text-left">
                          {/* 退出登录组件 (Log Out Component) */}
                          <div className="mb-4 p-3.5 rounded-2xl bg-gradient-to-br from-red-50/70 to-rose-50/50 border border-red-100/60 flex items-center justify-between shadow-xs">
                            <div className="flex flex-col gap-1">
                              <span className="text-[9px] font-black text-red-500 uppercase tracking-widest">当前登录账户</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-black text-slate-800 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                  {registerPhone || '13888888888'}
                                </span>
                              </div>
                            </div>
                            <button 
                              type="button"
                              onClick={() => {
                                setIsLogOutConfirmMode(true);
                                setPrivacyBackTo('driver-register');
                                setOrderStatus('privacy');
                              }}
                              className="text-[10px] text-red-600 font-black border border-red-200 bg-white hover:bg-red-50/50 px-2.5 py-1.5 rounded-xl transition-all active:scale-[0.98] flex items-center gap-1 cursor-pointer shadow-xs"
                            >
                              <svg className="w-3 h-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                              </svg>
                              <span>退出登录</span>
                            </button>
                          </div>

                          <form className="space-y-4" data-purpose="driver-registration-form" onSubmit={(e) => e.preventDefault()}>
                            
                            {/* 1. Name Input */}
                            <div data-purpose="field-group">
                              <label className="block text-slate-800 font-black text-xs mb-1">
                                <span className="text-red-500 mr-1">*</span>1. 您的姓名
                              </label>
                              <input 
                                className="w-full h-9 border border-gray-200 rounded px-3 text-slate-800 text-xs focus:ring-1 focus:ring-[#FF741F] focus:border-[#FF741F] focus:outline-none font-bold" 
                                placeholder="请输入您的姓名" 
                                type="text"
                                value={driverRegName}
                                onChange={(e) => setDriverRegName(e.target.value)}
                              />
                            </div>

                            {/* 2. ID Card Input */}
                            <div data-purpose="field-group">
                              <label className="block text-slate-800 font-black text-xs mb-1">
                                <span className="text-red-500 mr-1">*</span>2. 身份证号：
                              </label>
                              <input 
                                className="w-full h-9 border border-gray-200 rounded px-3 text-slate-800 text-xs focus:ring-1 focus:ring-[#FF741F] focus:border-[#FF741F] focus:outline-none font-bold font-mono" 
                                placeholder="请输入您的身份证号" 
                                type="text"
                                value={driverRegIdCard}
                                onChange={(e) => setDriverRegIdCard(e.target.value.replace(/[^0-9Xx]/g, ''))}
                                maxLength={18}
                              />
                            </div>

                            {/* 3. Company Input */}
                            <div data-purpose="field-group">
                              <label className="block text-slate-800 font-black text-xs mb-1">
                                <span className="text-red-500 mr-1">*</span>3. 公司
                              </label>
                              <input 
                                className="w-full h-9 border border-gray-200 rounded px-3 text-slate-800 text-xs focus:ring-1 focus:ring-[#FF741F] focus:border-[#FF741F] focus:outline-none font-bold bg-slate-50" 
                                type="text" 
                                value={driverRegCompany}
                                onChange={(e) => setDriverRegCompany(e.target.value)}
                              />
                            </div>

                            {/* 4. Gender Selection */}
                            <div data-purpose="field-group">
                              <label className="block text-slate-800 font-black text-xs mb-1">
                                <span className="text-red-500 mr-1">*</span>4. 性别
                              </label>
                              <div className="flex border border-gray-200 rounded overflow-hidden text-xs">
                                <button 
                                  type="button"
                                  onClick={() => setDriverRegGender('male')}
                                  className={`flex-1 py-1.5 font-black transition-colors flex items-center justify-center gap-1.5 ${driverRegGender === 'male' ? 'bg-orange-50 text-[#FF741F] font-extrabold' : 'bg-white text-slate-600'}`}
                                >
                                  <span className={`w-3 h-3 rounded-full border flex items-center justify-center ${driverRegGender === 'male' ? 'border-[#FF741F]' : 'border-gray-300'}`}>
                                    {driverRegGender === 'male' && <span className="w-1.5 h-1.5 bg-[#FF741F] rounded-full" />}
                                  </span>
                                  男
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setDriverRegGender('female')}
                                  className={`flex-1 py-1.5 font-black border-l border-gray-200 transition-colors flex items-center justify-center gap-1.5 ${driverRegGender === 'female' ? 'bg-orange-50 text-[#FF741F] font-extrabold' : 'bg-white text-slate-600'}`}
                                >
                                  <span className={`w-3 h-3 rounded-full border flex items-center justify-center ${driverRegGender === 'female' ? 'border-[#FF741F]' : 'border-gray-300'}`}>
                                    {driverRegGender === 'female' && <span className="w-1.5 h-1.5 bg-[#FF741F] rounded-full" />}
                                  </span>
                                  女
                                </button>
                              </div>
                            </div>

                            {/* 5. Job Type Selection */}
                            <div data-purpose="field-group">
                              <label className="block text-slate-800 font-black text-xs mb-1">
                                <span className="text-red-500 mr-1">*</span>5. 职业
                              </label>
                              <div className="flex border border-gray-200 rounded overflow-hidden text-xs">
                                <button 
                                  type="button"
                                  onClick={() => setDriverRegJobType('full')}
                                  className={`flex-1 py-1.5 font-black transition-colors flex items-center justify-center gap-1.5 ${driverRegJobType === 'full' ? 'bg-orange-50 text-[#FF741F] font-extrabold' : 'bg-white text-slate-600'}`}
                                >
                                  <span className={`w-3 h-3 rounded-full border flex items-center justify-center ${driverRegJobType === 'full' ? 'border-[#FF741F]' : 'border-gray-300'}`}>
                                    {driverRegJobType === 'full' && <span className="w-1.5 h-1.5 bg-[#FF741F] rounded-full" />}
                                  </span>
                                  全职
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setDriverRegJobType('part')}
                                  className={`flex-1 py-1.5 font-black border-l border-gray-200 transition-colors flex items-center justify-center gap-1.5 ${driverRegJobType === 'part' ? 'bg-orange-50 text-[#FF741F] font-extrabold' : 'bg-white text-slate-600'}`}
                                >
                                  <span className={`w-3 h-3 rounded-full border flex items-center justify-center ${driverRegJobType === 'part' ? 'border-[#FF741F]' : 'border-gray-300'}`}>
                                    {driverRegJobType === 'part' && <span className="w-1.5 h-1.5 bg-[#FF741F] rounded-full" />}
                                  </span>
                                  兼职
                                </button>
                              </div>
                            </div>

                            {/* 6. Emergency Contact Name */}
                            <div data-purpose="field-group">
                              <label className="block text-slate-800 font-black text-xs mb-1">
                                <span className="text-red-500 mr-1">*</span>6. 紧急联系人：
                              </label>
                              <input 
                                className="w-full h-9 border border-gray-200 rounded px-3 text-slate-800 text-xs focus:ring-1 focus:ring-[#FF741F] focus:border-[#FF741F] focus:outline-none font-bold" 
                                placeholder="请输入紧急联系人姓名" 
                                type="text"
                                value={driverRegEmergencyContact}
                                onChange={(e) => setDriverRegEmergencyContact(e.target.value)}
                              />
                            </div>

                            {/* 7. Emergency Contact Phone */}
                            <div data-purpose="field-group">
                              <label className="block text-slate-800 font-bold text-xs mb-1">
                                <span className="text-red-500 mr-1">*</span>7. 紧急联系人电话：
                              </label>
                              <input 
                                className="w-full h-9 border border-gray-200 rounded px-3 text-slate-800 text-xs focus:ring-1 focus:ring-[#FF741F] focus:border-[#FF741F] focus:outline-none font-bold font-mono" 
                                placeholder="请输入紧急联系人电话" 
                                type="tel"
                                maxLength={11}
                                value={driverRegEmergencyPhone}
                                onChange={(e) => setDriverRegEmergencyPhone(e.target.value.replace(/\D/g, ''))}
                              />
                            </div>

                            {/* 8. ID Photos Upload (人像面 & 国徽面) */}
                            <div data-purpose="field-group">
                              <label className="block text-slate-800 font-bold text-xs mb-2">
                                <span className="text-red-500 mr-1">*</span>8. 身份证照片:
                              </label>
                              <div className="flex space-x-3">
                                {/* ID Front */}
                                <div className="border border-gray-200 rounded-lg w-[115px] h-[115px] flex flex-col items-center justify-center bg-white relative p-1 text-center shrink-0 shadow-sm">
                                  {driverRegIdPhoto ? (
                                    <div className="relative w-full h-full rounded overflow-hidden">
                                      <img src={driverRegIdPhoto} className="w-full h-full object-cover" alt="身份证人像页" referrerPolicy="no-referrer" />
                                      <button 
                                        type="button"
                                        onClick={() => setDriverRegIdPhoto('')}
                                        className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-1 hover:bg-black transition-colors"
                                      >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                                        </svg>
                                      </button>
                                    </div>
                                  ) : (
                                    <label className="cursor-pointer w-full h-full flex flex-col items-center justify-center">
                                      <div className="relative w-[64px] h-[40px] border border-dashed border-gray-300 flex items-center justify-center mb-1 bg-slate-50/50">
                                        <div className="absolute w-1 h-1 border-t border-l border-gray-400 top-[-1px] left-[-1px]"></div>
                                        <div className="absolute w-1 h-1 border-t border-r border-gray-400 top-[-1px] right-[-1px]"></div>
                                        <div className="absolute w-1 h-1 border-b border-l border-gray-400 bottom-[-1px] left-[-1px]"></div>
                                        <div className="absolute w-1 h-1 border-b border-r border-gray-400 bottom-[-1px] right-[-1px]"></div>
                                        <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                                          <path d="M12 10a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H5z" />
                                          <circle cx="12" cy="12" fill="none" r="3" stroke="currentColor" strokeWidth="2" />
                                          <path d="M4 4h3l2-2h6l2 2h3a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM12 7a5 5 0 100 10 5 5 0 000-10z" fill="currentColor" />
                                        </svg>
                                      </div>
                                      <p className="text-[10px] text-gray-400 leading-normal">点击上传 <span className="text-[#FF8225] font-bold">人像面</span></p>
                                      <input 
                                        type="file" 
                                        accept="image/*" 
                                        className="hidden" 
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            const reader = new FileReader();
                                            reader.onload = (ev) => {
                                              if (ev.target?.result) setDriverRegIdPhoto(ev.target.result as string);
                                            };
                                            reader.readAsDataURL(file);
                                          }
                                        }}
                                      />
                                    </label>
                                  )}
                                </div>

                                {/* ID Back */}
                                <div className="border border-gray-200 rounded-lg w-[115px] h-[115px] flex flex-col items-center justify-center bg-white relative p-1 text-center shrink-0 shadow-sm">
                                  {driverRegIdPhotoBack ? (
                                    <div className="relative w-full h-full rounded overflow-hidden">
                                      <img src={driverRegIdPhotoBack} className="w-full h-full object-cover" alt="身份证国徽页" referrerPolicy="no-referrer" />
                                      <button 
                                        type="button"
                                        onClick={() => setDriverRegIdPhotoBack('')}
                                        className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-1 hover:bg-black transition-colors"
                                      >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                                        </svg>
                                      </button>
                                    </div>
                                  ) : (
                                    <label className="cursor-pointer w-full h-full flex flex-col items-center justify-center">
                                      <div className="relative w-[64px] h-[40px] border border-dashed border-gray-300 flex items-center justify-center mb-1 bg-slate-50/50">
                                        <div className="absolute w-1 h-1 border-t border-l border-gray-400 top-[-1px] left-[-1px]"></div>
                                        <div className="absolute w-1 h-1 border-t border-r border-gray-400 top-[-1px] right-[-1px]"></div>
                                        <div className="absolute w-1 h-1 border-b border-l border-gray-400 bottom-[-1px] left-[-1px]"></div>
                                        <div className="absolute w-1 h-1 border-b border-r border-gray-400 bottom-[-1px] right-[-1px]"></div>
                                        <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                                          <path d="M4 4h3l2-2h6l2 2h3a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM12 7a5 5 0 100 10 5 5 0 000-10z" />
                                        </svg>
                                      </div>
                                      <p className="text-[10px] text-gray-400 leading-normal">点击上传 <span className="text-[#FF8225] font-bold">国徽面</span></p>
                                      <input 
                                        type="file" 
                                        accept="image/*" 
                                        className="hidden" 
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            const reader = new FileReader();
                                            reader.onload = (ev) => {
                                              if (ev.target?.result) setDriverRegIdPhotoBack(ev.target.result as string);
                                            };
                                            reader.readAsDataURL(file);
                                          }
                                        }}
                                      />
                                    </label>
                                  )}
                                </div>
                              </div>
                              <p className="text-[#FF4D4F] text-[11px] mt-1">格式：支持png、jpg，大小：不超过5M</p>
                            </div>

                            {/* 9. License Photo Upload */}
                            <div data-purpose="field-group">
                              <label className="block text-slate-800 font-bold text-xs mb-2">
                                <span className="text-red-500 mr-1">*</span>9. 驾驶证照片:
                              </label>
                              <div className="border border-gray-200 rounded-lg w-[115px] h-[115px] flex flex-col items-center justify-center bg-white relative p-1 text-center shrink-0 shadow-sm">
                                {driverRegLicensePhoto ? (
                                  <div className="relative w-full h-full rounded overflow-hidden">
                                    <img src={driverRegLicensePhoto} className="w-full h-full object-cover" alt="驾驶证首页" referrerPolicy="no-referrer" />
                                    <button 
                                      type="button"
                                      onClick={() => setDriverRegLicensePhoto('')}
                                      className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-1 hover:bg-black transition-colors"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                                      </svg>
                                    </button>
                                  </div>
                                ) : (
                                  <label className="cursor-pointer w-full h-full flex flex-col items-center justify-center">
                                    <div className="relative w-[64px] h-[40px] border border-dashed border-gray-300 flex items-center justify-center mb-1 bg-slate-50/50">
                                      <div className="absolute w-1 h-1 border-t border-l border-gray-400 top-[-1px] left-[-1px]"></div>
                                      <div className="absolute w-1 h-1 border-t border-r border-gray-400 top-[-1px] right-[-1px]"></div>
                                      <div className="absolute w-1 h-1 border-b border-l border-gray-400 bottom-[-1px] left-[-1px]"></div>
                                      <div className="absolute w-1 h-1 border-b border-r border-gray-400 bottom-[-1px] right-[-1px]"></div>
                                      <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M4 4h3l2-2h6l2 2h3a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm8 3a5 5 0 100 10 5 5 0 000-10z" />
                                      </svg>
                                    </div>
                                    <p className="text-[10px] text-gray-400 leading-normal">点击上传 <span className="text-[#FF8225] font-bold">首页</span></p>
                                    <input 
                                      type="file" 
                                      accept="image/*" 
                                      className="hidden" 
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                          const reader = new FileReader();
                                          reader.onload = (ev) => {
                                            if (ev.target?.result) setDriverRegLicensePhoto(ev.target.result as string);
                                          };
                                          reader.readAsDataURL(file);
                                        }
                                      }}
                                    />
                                  </label>
                                )}
                              </div>
                              <p className="text-[#FF4D4F] text-[11px] mt-1">格式：支持png、jpg，大小：不超过5M</p>
                            </div>

                            {/* 10. License Type Selection */}
                            <div data-purpose="field-group">
                              <label className="block text-slate-800 font-bold text-xs mb-1">
                                <span className="text-red-500 mr-1">*</span>10. 驾驶证类型:
                              </label>
                              <select 
                                value={driverRegLicenseType} 
                                onChange={(e) => setDriverRegLicenseType(e.target.value)}
                                className="w-full h-9 border border-gray-200 rounded px-3 text-slate-800 text-xs focus:ring-1 focus:ring-[#FF741F] focus:border-[#FF741F] focus:outline-none font-bold bg-white"
                              >
                                <option value="A1">A1</option>
                                <option value="A2">A2</option>
                                <option value="B1">B1</option>
                                <option value="B2">B2</option>
                                <option value="C1">C1</option>
                                <option value="C2">C2</option>
                              </select>
                            </div>

                            {/* 11. Issue Date */}
                            <div data-purpose="field-group" className="mb-4">
                              <label className="block text-slate-800 font-bold text-xs mb-1">
                                <span className="text-red-500 mr-1">*</span>11. 领证时间:
                              </label>
                              <input 
                                className="w-full h-9 border border-gray-200 rounded px-3 text-slate-800 text-xs focus:ring-1 focus:ring-[#FF741F] focus:border-[#FF741F] focus:outline-none font-bold font-mono" 
                                placeholder="请选择您的领证时间" 
                                type="date"
                                value={driverRegIssueDate}
                                onChange={(e) => setDriverRegIssueDate(e.target.value)}
                              />
                            </div>

                             {/* Agreement Checkbox */}
                             <div className="flex items-center justify-center space-x-2 py-2">
                               <div 
                                 id="agreement-cb"
                                 onClick={() => handleAgreementClick()}
                                 className={`w-4 h-4 rounded flex items-center justify-center transition-all cursor-pointer border ${
                                   driverRegAgreed && isDriverRegFormComplete()
                                     ? 'bg-blue-500 border-blue-500 text-white shadow-sm' 
                                     : 'border-gray-300 bg-white'
                                 }`}
                               >
                                 {driverRegAgreed && isDriverRegFormComplete() && (
                                   <svg className="w-2.5 h-2.5 stroke-[4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                     <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                                   </svg>
                                 )}
                               </div>
                               <label 
                                 onClick={() => handleAgreementClick()}
                                 className="text-[10px] text-slate-600 font-medium select-none cursor-pointer flex flex-wrap items-center gap-x-1 justify-center leading-normal"
                               >
                                 <span>我已阅读并同意</span>
                                 <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDriverRegStep('agreement'); }} className="text-[#FF8225] font-bold cursor-pointer hover:underline">《服务人员合作协议》</span>
                                 <span>和</span>
                                 <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPrivacyBackTo('driver-register'); setOrderStatus('privacy'); }} className="text-blue-500 font-bold cursor-pointer hover:underline">《隐私条款》</span>
                               </label>
                             </div>

                            {/* Sandbox Preset Image Option */}
                            <div className="flex flex-col gap-2 pt-1 pb-2">
                              <button 
                                type="button"
                                onClick={() => {
                                  setDriverRegName('张伟');
                                  setDriverRegIdCard('110101199001011234');
                                  setDriverRegCompany('银川');
                                  setDriverRegEmergencyContact('李娜');
                                  setDriverRegEmergencyPhone('13999999999');
                                  setDriverRegIdPhoto(driverAvatar);
                                  setDriverRegIdPhotoBack(driverAvatar);
                                  setDriverRegLicensePhoto(driverAvatar);
                                  setDriverRegLicenseType('A1');
                                  setDriverRegIssueDate('2018-05-12');
                                  onTriggerToast('⚡ 已为您一键填写所有基本信息、联系人、领证时间及示例照片！(测试专用)');
                                }}
                                className="text-[10px] text-blue-600 font-black border border-blue-200 bg-blue-50/50 hover:bg-blue-50 px-2.5 py-1.5 rounded-md transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1"
                              >
                                ⚡ 快捷一键填写所有信息
                              </button>
                            </div>

                            {/* Submit Button */}
                            <div className="pt-1">
                              <button 
                                type="button"
                                onClick={async () => {
                                  if (!isDriverRegFormComplete()) {
                                    onTriggerToast('⚠️ 请确保填写完所有的基本信息（姓名、身份证、城市、联系人等）并上传所有的图片（身份证和驾驶证照片）！');
                                    return;
                                  }
                                  if (!driverRegAgreed) {
                                    onTriggerToast('⚠️ 所有的信息已填写完整。现在请点击协议前的选项框以显示蓝色对号，才能点击下一步！');
                                    return;
                                  }

                                  if (!driverRegName.trim()) {
                                    onTriggerToast('⚠️ 请输入您的姓名！');
                                    return;
                                  }
                                  if (!driverRegIdCard.trim()) {
                                    onTriggerToast('⚠️ 请输入您的身份证号！');
                                    return;
                                  }
                                  if (!/^\d{17}[\dXx]$/.test(driverRegIdCard.trim())) {
                                    onTriggerToast('⚠️ 身份证号格式不正确！');
                                    return;
                                  }
                                  if (!driverRegEmergencyContact.trim()) {
                                    onTriggerToast('⚠️ 请输入紧急联系人姓名！');
                                    return;
                                  }
                                  if (!driverRegEmergencyPhone.trim() || driverRegEmergencyPhone.trim().length !== 11) {
                                    onTriggerToast('⚠️ 请输入正确的11位紧急联系人电话！');
                                    return;
                                  }
                                  if (!driverRegIdPhoto) {
                                    onTriggerToast('⚠️ 请上传身份证人像面照片！');
                                    return;
                                  }
                                  if (!driverRegIdPhotoBack) {
                                    onTriggerToast('⚠️ 请上传身份证国徽面照片！');
                                    return;
                                  }
                                  if (!driverRegLicensePhoto) {
                                    onTriggerToast('⚠️ 请上传驾驶证首页照片！');
                                    return;
                                  }
                                  if (!driverRegIssueDate) {
                                    onTriggerToast('⚠️ 请选择您的领证时间！');
                                    return;
                                  }

                                  // Calculate driving years from issue date
                                  let calculatedDrivingYears = 5;
                                  const issueYear = new Date(driverRegIssueDate).getFullYear();
                                  if (!isNaN(issueYear) && issueYear > 1950 && issueYear <= 2026) {
                                    calculatedDrivingYears = Math.max(0, 2026 - issueYear);
                                  }

                                  // Calculate age from ID card birthday
                                  let calculatedAge = 35;
                                  const birthYearStr = driverRegIdCard.substring(6, 10);
                                  const birthYear = parseInt(birthYearStr, 10);
                                  if (!isNaN(birthYear) && birthYear > 1900 && birthYear < 2026) {
                                    calculatedAge = 2026 - birthYear;
                                  }

                                  setIsSubmittingReg(true);
                                  try {
                                    await setDoc(doc(db, 'online_applications', registerPhone), {
                                      id: registerPhone,
                                      driverPhone: registerPhone,
                                      driverName: driverRegName.trim(),
                                      idCardNumber: driverRegIdCard.trim(),
                                      city: driverRegCompany.trim(),
                                      driverGender: driverRegGender === 'male' ? '男' : '女',
                                      driverAge: calculatedAge,
                                      jobType: driverRegJobType === 'full' ? '全职' : '兼职',
                                      emergencyContact: driverRegEmergencyContact.trim(),
                                      emergencyPhone: driverRegEmergencyPhone.trim(),
                                      idCardFront: driverRegIdPhoto,
                                      idCardBack: driverRegIdPhotoBack,
                                      driverLicenseFront: driverRegLicensePhoto,
                                      driverLicenseBack: driverRegLicensePhoto, // duplicate
                                      drivingYears: calculatedDrivingYears,
                                      licenseType: driverRegLicenseType,
                                      licenseIssueDate: driverRegIssueDate,
                                      status: 'pending',
                                      updatedAt: new Date().toISOString()
                                    });

                                    setIsSubmittingReg(false);
                                    onTriggerToast(`🎉 提交成功！手机号 ${registerPhone} 的申请已录入，等待平台审批开通听单。`);
                                    
                                    // Enter success page state
                                    setDriverRegStep('success');
                                  } catch (err: any) {
                                    setIsSubmittingReg(false);
                                    onTriggerToast(`❌ 提交失败: ${err.message || '网络连接超时'}`);
                                  }
                                }}
                                disabled={isSubmittingReg}
                                className="w-full text-white font-bold py-3 rounded-lg text-base shadow-md tracking-wider transform transition-transform active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1 active:opacity-90 bg-[#FF8225]"
                              >
                                {isSubmittingReg ? '正在提交申请...' : '下一步'}
                              </button>
                            </div>

                          </form>
                        </div>
                      </main>
                    </>
                  )}
                  {/* END: RegistrationForm */}

                  {/* BEGIN: FooterBranding */}
                  <footer className="bg-white pb-4 text-center shrink-0" data-purpose="app-footer">
                    <div className="flex items-center justify-center gap-2 opacity-40">
                      <span className="h-px w-6 bg-gray-300"></span>
                      <span className="text-xs text-gray-500 tracking-widest font-black">黑湾代驾</span>
                      <span className="h-px w-6 bg-gray-300"></span>
                    </div>
                  </footer>
                  {/* END: FooterBranding */}
                </div>
              ) : orderStatus === 'about' ? (
                <div 
                  className="flex-1 flex flex-col text-slate-800 select-none pb-6 overflow-y-auto animate-in fade-in slide-in-from-right duration-200" 
                  style={{ background: 'linear-gradient(180deg, #ffb347 0%, #ffcc33 100%)' }}
                >
                  {/* BEGIN: TopDecorativeSection */}
                  <div className="relative h-44 w-full flex items-center justify-center overflow-hidden shrink-0">
                    {/* Abstract Orange Shapes */}
                    <div className="absolute -top-10 -left-10 w-44 h-44 bg-orange-400 opacity-60 rounded-full blur-2xl"></div>
                    <div className="absolute top-20 -right-20 w-48 h-48 bg-orange-300 opacity-40 rounded-full blur-xl"></div>
                    
                    {/* Visual Heading Container */}
                    <div className="relative z-10 bg-white/95 rounded-2xl p-5 shadow-lg flex flex-col items-center border border-white/40">
                      <div className="relative">
                        <h1 className="text-3xl font-black tracking-widest text-orange-500 drop-shadow-md">
                          关于<span className="text-orange-400">我们</span>
                        </h1>
                        {/* Small Bubble Detail */}
                        <div className="absolute -top-3.5 -right-6 bg-orange-500 text-white text-[8px] px-2 py-0.5 rounded-full font-bold shadow-xs">
                          ABOUT US
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* END: TopDecorativeSection */}

                  {/* BEGIN: ContentCard */}
                  <main className="relative z-10 flex-1 px-4 pb-6 -mt-2">
                    <div 
                      className="rounded-3xl min-h-[360px] relative border border-orange-100 flex flex-col p-5 shadow-xl"
                      style={{ background: 'linear-gradient(180deg, #ffffff 0%, #fff9e6 100%)' }}
                    >
                      {/* Section Header Label */}
                      <div 
                        className="absolute -top-3 left-1/2 -translate-x-1/2 w-32 h-7.5 flex items-center justify-center shadow-md"
                        style={{
                          background: 'linear-gradient(90deg, #ffcc00 0%, #ffd700 100%)',
                          clipPath: 'polygon(10% 0, 90% 0, 100% 100%, 0% 100%)'
                        }}
                      >
                        <span className="text-orange-950 font-black tracking-widest text-[10px]">公司简介</span>
                      </div>

                      {/* Body Text Content */}
                      <div className="pt-5 space-y-4 text-gray-700 text-[11px] leading-relaxed">
                        <p className="font-bold text-slate-800 text-center text-xs border-b border-orange-100 pb-2">
                          本公司承接酒后代驾、商务代驾、长途代驾、旅游代驾、婚庆代驾等。
                        </p>

                        {/* Section: Service Principle */}
                        <div className="space-y-1">
                          <h3 className="font-extrabold text-orange-600 flex items-center gap-1 text-[11px]">
                            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>
                            服务宗旨：
                          </h3>
                          <div className="pl-3.5 space-y-0.5 text-slate-600 font-medium">
                            <p>坚持诚信、周到服务是我们服务之本；</p>
                            <p>高效便捷、安全至上是我们的服务理念；</p>
                          </div>
                        </div>

                        {/* Section: Service Principle 2 */}
                        <div className="space-y-1">
                          <h3 className="font-extrabold text-orange-600 flex items-center gap-1 text-[11px]">
                            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>
                            服务品质：
                          </h3>
                          <ul className="pl-3.5 space-y-0.5 text-slate-600 list-none font-medium">
                            <li>您的意见 —— 是我们进步的动力；</li>
                            <li>您的信任 —— 是我们殷切的期盼；</li>
                            <li>您的满意 —— 是我们最高的荣誉。</li>
                          </ul>
                        </div>

                        {/* Section: Commitment */}
                        <div className="space-y-1">
                          <h3 className="font-extrabold text-orange-600 flex items-center gap-1 text-[11px]">
                            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>
                            代驾的承诺：
                          </h3>
                          <div className="pl-3.5 space-y-0.5 text-slate-600 font-medium">
                            <p>每一趟代驾，后台有司机出行轨迹定位；</p>
                            <p>每一趟代驾，都为您投保！</p>
                          </div>
                        </div>

                        {/* Section: Goal */}
                        <div className="space-y-1">
                          <h3 className="font-extrabold text-orange-600 flex items-center gap-1 text-[11px]">
                            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full"></span>
                            代驾的目标：
                          </h3>
                          <p className="pl-3.5 text-slate-600 font-medium">
                            安全为本，诚信至上，为您地生活保驾护航！
                          </p>
                        </div>
                      </div>

                      {/* Small inline Return Button */}
                      <div className="pt-4 flex justify-center">
                        <button 
                          onClick={() => setOrderStatus('profile')}
                          className="px-4 py-1.5 bg-gradient-to-r from-orange-400 to-orange-500 active:scale-95 hover:scale-105 text-white font-black rounded-xl text-[10px] transition-all flex items-center gap-1 shadow-sm shadow-orange-500/20 cursor-pointer"
                        >
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
                          </svg>
                          <span>返回个人中心</span>
                        </button>
                      </div>

                    </div>
                  </main>
                  {/* END: ContentCard */}
                </div>
              ) : orderStatus === 'profile' ? (
                <div className="flex-1 flex flex-col text-slate-800 select-none pb-4 overflow-y-auto animate-in fade-in slide-in-from-right duration-200" style={{ background: 'linear-gradient(to bottom, #FFF3E5 0%, #F5F5F5 30%, #F5F5F5 100%)' }}>
                  <main className="px-3 pt-4 space-y-4">
                    
                    {/* BEGIN: UserInfoSection */}
                    <section className="flex items-center space-x-3">
                      <div className="relative">
                        <div className="w-14 h-14 rounded-full border-[3px] border-orange-400 overflow-hidden bg-white shadow-sm flex items-center justify-center">
                          <svg viewBox="0 0 100 100" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                              <linearGradient id="avatarGradProfile" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#1e293b" />
                                <stop offset="100%" stopColor="#0f172a" />
                              </linearGradient>
                              <linearGradient id="capGradProfile" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#fbbf24" />
                                <stop offset="100%" stopColor="#d97706" />
                              </linearGradient>
                              <linearGradient id="skinGradProfile" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#ffedd5" />
                                <stop offset="100%" stopColor="#fed7aa" />
                              </linearGradient>
                            </defs>
                            
                            {/* Circle Background */}
                            <circle cx="50" cy="50" r="48" fill="url(#avatarGradProfile)" />
                            <circle cx="50" cy="50" r="46" fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeOpacity="0.4" />
                            
                            {/* Driver's Suit Body */}
                            <path d="M25,85 C25,70 35,65 50,65 C65,65 75,70 75,85" fill="#1e3a8a" />
                            <path d="M42,65 L50,78 L58,65" fill="#f8fafc" />
                            <path d="M48,72 L52,72 L50,85 Z" fill="#0f172a" />

                            {/* Driver's Head / Ears */}
                            <circle cx="34" cy="52" r="5" fill="url(#skinGradProfile)" />
                            <circle cx="66" cy="52" r="5" fill="url(#skinGradProfile)" />
                            <circle cx="50" cy="50" r="16" fill="url(#skinGradProfile)" />

                            {/* Eyes */}
                            <path d="M42,48 C43,46 46,46 47,48" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" fill="none" />
                            <path d="M53,48 C54,46 57,46 58,48" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" fill="none" />
                            
                            {/* Cheeks */}
                            <circle cx="38" cy="54" r="2.5" fill="#f43f5e" fillOpacity="0.4" />
                            <circle cx="62" cy="54" r="2.5" fill="#f43f5e" fillOpacity="0.4" />

                            {/* Friendly Smile */}
                            <path d="M45,54 Q50,59 55,54" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" fill="none" />

                            {/* Chauffeur's Cap */}
                            <path d="M30,38 C35,32 65,32 70,38 C72,40 70,42 66,42 C56,43 44,43 34,42 C30,42 28,40 30,38 Z" fill="#0f172a" />
                            <path d="M32,36 C32,24 68,24 68,36" fill="url(#capGradProfile)" />
                            <path d="M32,34 L68,34 L67,38 L33,38 Z" fill="#0f172a" />
                            {/* Golden Cap Badge */}
                            <path d="M50,28 L52,32 L56,32 L53,35 L54,39 L50,37 L46,39 L47,35 L44,32 L48,32 Z" fill="#fbbf24" />
                          </svg>
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base font-extrabold tracking-tight text-slate-900">
                            {passengerPhone || '15509601222'}
                          </span>
                          <span className="bg-orange-100 text-[#FF8200] text-[8px] px-1.5 py-0.5 rounded-full font-black flex items-center shadow-2xs">
                            至尊VIP
                          </span>
                        </div>
                        <button 
                          onClick={() => {
                            setOrderStatus('idle');
                            onTriggerToast('💡 提示：请直接在输入框修改您的联系手机号！');
                          }}
                          className="mt-1 flex items-center text-slate-500 text-[10px] hover:text-slate-700"
                        >
                          <svg className="w-3 h-3 mr-1 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"></path>
                          </svg>
                          更改手机号
                        </button>
                      </div>
                    </section>
                    {/* END: UserInfoSection */}

                    {/* BEGIN: WalletRechargeSection */}
                    <section className="bg-white rounded-2xl p-3 shadow-md flex flex-col border border-slate-100">
                      {/* Action Buttons Row */}
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        {/* Wallet Button */}
                        <button 
                          onClick={() => onTriggerToast('💳 当前钱包资产：0.00 元')}
                          className="flex items-center gap-2 bg-[#FFF5EB] p-2.5 rounded-xl border border-orange-50 active:scale-95 transition-all text-left"
                        >
                          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#FFB770] to-[#FF8200] flex items-center justify-center shadow-xs shrink-0">
                            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"></path>
                            </svg>
                          </div>
                          <div>
                            <div className="text-xs font-black text-slate-800">钱包</div>
                            <div className="text-[8px] text-[#FF8200] font-bold">查看资产</div>
                          </div>
                        </button>
                        
                        {/* Recharge Button */}
                        <button 
                          onClick={() => {
                            const amt = prompt('请输入您想要充值的金额 (元)：', '100');
                            if (amt) {
                              const parsed = parseFloat(amt);
                              if (!isNaN(parsed) && parsed > 0) {
                                onTriggerToast(`🎉 成功充值 ${parsed.toFixed(2)} 元！余额已更新。`);
                              } else {
                                onTriggerToast('⚠️ 输入金额有误！');
                              }
                            }
                          }}
                          className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100 active:scale-95 transition-all text-left"
                        >
                          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#87C8FF] to-[#3B99FF] flex items-center justify-center shadow-xs shrink-0">
                            <div className="w-5 h-5 bg-white/20 rounded-md flex items-center justify-center text-white text-xs font-black">￥</div>
                          </div>
                          <div>
                            <div className="text-xs font-black text-slate-800">充值</div>
                            <div className="text-[8px] text-slate-400">快速到账</div>
                          </div>
                        </button>
                      </div>
                      
                      {/* Balances Row */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-slate-50/80 rounded-xl p-2 flex flex-col gap-0.5">
                          <span className="text-[9px] text-slate-500 font-bold">钱包余额</span>
                          <div className="flex items-baseline gap-0.5">
                            <span className="text-sm font-black text-slate-800">0.00</span>
                            <span className="text-[9px] text-slate-400">元</span>
                          </div>
                        </div>
                        <div className="bg-slate-50/80 rounded-xl p-2 flex flex-col gap-0.5">
                          <span className="text-[9px] text-slate-500 font-bold">邀请奖励</span>
                          <div className="flex items-baseline gap-0.5">
                            <span className="text-sm font-black text-slate-800">0.00</span>
                            <span className="text-[9px] text-slate-400">元</span>
                          </div>
                        </div>
                      </div>
                    </section>
                    {/* END: WalletRechargeSection */}

                    {/* BEGIN: GridMenuSection */}
                    <section className="bg-white rounded-2xl p-3 shadow-md border border-slate-100 grid grid-cols-4 gap-y-4 gap-x-0.5">
                      {/* Item 1: 我的订单 */}
                      <div 
                        onClick={() => onTriggerToast('📁 您当前暂无微信小程序历史订单')}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                      >
                        <div className="w-9 h-9 rounded-xl bg-orange-50/70 flex items-center justify-center transition-all group-active:scale-95 border border-orange-50">
                          <div className="w-6.5 h-6.5 rounded-lg bg-gradient-to-br from-[#FFB770] to-[#FF8200] flex items-center justify-center shadow-xs">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeWidth="2"></path>
                            </svg>
                          </div>
                        </div>
                        <span className="text-[9px] font-bold text-slate-600">我的订单</span>
                      </div>

                      {/* Item 2: 开具发票 */}
                      <div 
                        onClick={() => onTriggerToast('📄 开具发票功能暂未开放')}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                      >
                        <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center transition-all group-active:scale-95 border border-slate-100">
                          <div className="w-6.5 h-6.5 rounded-lg bg-gradient-to-br from-[#87C8FF] to-[#3B99FF] flex items-center justify-center shadow-xs">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" strokeWidth="2"></path>
                            </svg>
                          </div>
                        </div>
                        <span className="text-[9px] font-bold text-slate-600">开具发票</span>
                      </div>

                      {/* Item 3: 优惠券 */}
                      <div 
                        onClick={() => onTriggerToast('🎫 您当前拥有 0 张可用优惠券')}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                      >
                        <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center transition-all group-active:scale-95 border border-slate-100">
                          <div className="w-6.5 h-6.5 rounded-lg bg-gradient-to-br from-[#FF99AA] to-[#FF5A78] flex items-center justify-center shadow-xs">
                            <span className="text-white text-[8px] font-black">惠</span>
                          </div>
                        </div>
                        <span className="text-[9px] font-bold text-slate-600">优惠券</span>
                      </div>

                      {/* Item 4: 安全中心 */}
                      <div 
                        onClick={() => onTriggerToast('🛡️ 本微信代叫行程均受人保车辆安行险全面保障')}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                      >
                        <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center transition-all group-active:scale-95 border border-slate-100">
                          <div className="w-6.5 h-6.5 rounded-lg bg-gradient-to-br from-[#A8E6CF] to-[#56C596] flex items-center justify-center shadow-xs">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" strokeWidth="2"></path>
                            </svg>
                          </div>
                        </div>
                        <span className="text-[9px] font-bold text-slate-600">安全中心</span>
                      </div>

                      {/* Item 5: 关于平台 */}
                      <div 
                        onClick={() => setOrderStatus('about')}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                      >
                        <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center transition-all group-active:scale-95 border border-slate-100">
                          <div className="w-6.5 h-6.5 rounded-lg bg-gradient-to-br from-[#FFAB91] to-[#FF7043] flex items-center justify-center shadow-xs">
                            <span className="text-white text-[11px] font-black">!</span>
                          </div>
                        </div>
                        <span className="text-[9px] font-bold text-slate-600">关于平台</span>
                      </div>

                      {/* Item 6: 计费规则 */}
                      <div 
                        onClick={() => setOrderStatus('rules')}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                      >
                        <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center transition-all group-active:scale-95 border border-slate-100">
                          <div className="w-6.5 h-6.5 rounded-lg bg-gradient-to-br from-[#C5CAE9] to-[#7986CB] flex items-center justify-center shadow-xs">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="2"></path>
                            </svg>
                          </div>
                        </div>
                        <span className="text-[9px] font-bold text-slate-600">计费规则</span>
                      </div>

                      {/* Item 7: 相关协议 */}
                      <div 
                        onClick={() => setOrderStatus('agreement')}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                      >
                        <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center transition-all group-active:scale-95 border border-slate-100">
                          <div className="w-6.5 h-6.5 rounded-lg bg-gradient-to-br from-[#FFE0B2] to-[#FFB74D] flex items-center justify-center shadow-xs">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" strokeWidth="2"></path>
                            </svg>
                          </div>
                        </div>
                        <span className="text-[9px] font-bold text-slate-600">相关协议</span>
                      </div>

                      {/* Item 8: 隐私政策 */}
                      <div 
                        onClick={() => { setPrivacyBackTo('profile'); setOrderStatus('privacy'); }}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                      >
                        <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center transition-all group-active:scale-95 border border-slate-100">
                          <div className="w-6.5 h-6.5 rounded-lg bg-gradient-to-br from-[#80DEEA] to-[#00ACC1] flex items-center justify-center shadow-xs">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                            </svg>
                          </div>
                        </div>
                        <span className="text-[9px] font-bold text-slate-600">隐私政策</span>
                      </div>

                      {/* Item 9: 商户中心 */}
                      <div 
                        onClick={() => onTriggerToast('🏪 商户特约合作通道申请中')}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                      >
                        <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center transition-all group-active:scale-95 border border-slate-100">
                          <div className="w-6.5 h-6.5 rounded-lg bg-gradient-to-br from-[#D1C4E9] to-[#9575CD] flex items-center justify-center shadow-xs">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" strokeWidth="2"></path>
                            </svg>
                          </div>
                        </div>
                        <span className="text-[9px] font-bold text-slate-600">商户中心</span>
                      </div>
                    </section>
                    {/* END: GridMenuSection */}

                    {/* BEGIN: BackButtonSection */}
                    <div className="pt-2 pb-6 flex justify-center">
                      <button 
                        onClick={() => setOrderStatus('idle')}
                        className="w-14 h-14 bg-gradient-to-br from-[#FFB770] to-[#FF8200] rounded-2xl flex flex-col items-center justify-center shadow-md shadow-orange-300/30 transition-all active:scale-95 hover:scale-105 cursor-pointer text-white"
                      >
                        <svg className="w-5 h-5 text-white mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                        </svg>
                        <span className="text-white font-extrabold text-[9px] tracking-wide">返回首页</span>
                      </button>
                    </div>
                    {/* END: BackButtonSection */}

                  </main>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-4 text-center space-y-3 animate-in fade-in zoom-in-95 duration-200">
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 border border-emerald-500 shrink-0">
                    <Check className="w-5 h-5 stroke-[3]" />
                  </div>
                  <div className="space-y-0.5 shrink-0">
                    <h3 className="text-xs font-black text-slate-900">🎉 下单通知发送成功！</h3>
                    <p className="text-[9px] text-slate-500 leading-normal px-1">
                      订单数据已同步写入云端数据库。绑定司机 <strong>{targetDriver}</strong> 的手机端将立即听到开单振铃，并弹出强光抢单框！
                    </p>
                  </div>

                  <div className="w-full bg-slate-50 rounded-lg p-2.5 border border-slate-100 text-[9px] text-slate-600 space-y-1 text-left font-sans shrink-0">
                    <div className="flex justify-between">
                      <span className="text-slate-400">乘客手机：</span>
                      <span className="font-bold font-mono text-slate-800">{passengerPhone}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">出发地点：</span>
                      <span className="font-bold text-slate-800">{startPoint}</span>
                    </div>
                    {destination && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">目的地：</span>
                        <span className="font-bold text-slate-800">{destination}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1 border-t border-slate-200">
                      <span className="text-slate-400">关联司机手机：</span>
                      <span className="font-bold font-mono text-blue-600">{targetDriver}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => setOrderStatus('idle')}
                    className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer shrink-0"
                  >
                    返回继续测试下单
                  </button>
                </div>
              )}
            </div>

            {/* Bottom Indicator */}
            <div className="w-full bg-slate-50 py-1.5 flex justify-center items-center shrink-0 select-none">
              <div className="w-24 h-1 bg-slate-800 rounded-full"></div>
            </div>

          </div>



        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          
          {/* File selector for WeChat files */}
          <div className="flex bg-[#121727] px-4 border-b border-slate-800/80 shrink-0 text-xs font-semibold overflow-x-auto select-none">
            <button
              onClick={() => setCodeFile('wxml')}
              className={`px-3 py-2.5 border-b-2 font-bold ${
                codeFile === 'wxml' ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-400'
              }`}
            >
              📄 index.wxml (骨架视图)
            </button>
            <button
              onClick={() => setCodeFile('wxss')}
              className={`px-3 py-2.5 border-b-2 font-bold ${
                codeFile === 'wxss' ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-400'
              }`}
            >
              🎨 index.wxss (样式皮肤)
            </button>
            <button
              onClick={() => setCodeFile('js')}
              className={`px-3 py-2.5 border-b-2 font-bold ${
                codeFile === 'js' ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-400'
              }`}
            >
              ⚙ index.js (交互控制与网络请求)
            </button>
            <button
              onClick={() => setCodeFile('json')}
              className={`px-3 py-2.5 border-b-2 font-bold ${
                codeFile === 'json' ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-400'
              }`}
            >
              ⚙ index.json (页面配置)
            </button>
          </div>

          {/* Code display window */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col space-y-3 relative">
            <div className="flex items-center justify-between bg-[#111322] border border-slate-800/60 rounded-xl px-4 py-2.5 text-xs text-slate-400 text-left">
              <div>
                <span className="font-bold text-slate-200">
                  {codeFile === 'wxml' && 'index.wxml (小程序骨架)'}
                  {codeFile === 'wxss' && 'index.wxss (页面样式)'}
                  {codeFile === 'js' && 'index.js (上报触发核心 js)'}
                  {codeFile === 'json' && 'index.json (配置声明)'}
                </span>
                <p className="text-[10px] text-slate-500 mt-0.5">可以直接复制此代码并放入您的微信小程序开发者工具中直接运行！</p>
              </div>
              
              <button
                onClick={() => {
                  const code = codeFile === 'wxml' ? wxmlCode : codeFile === 'wxss' ? wxssCode : codeFile === 'js' ? jsCode : jsonCode;
                  handleCopyCode(code);
                }}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg flex items-center gap-1.5 transition-all cursor-pointer font-bold"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? '已复制！' : '一键复制代码'}</span>
              </button>
            </div>

            {/* Code Highlight Box */}
            <pre className="flex-1 bg-[#090b12] text-emerald-400 border border-slate-900 rounded-xl p-4 font-mono text-[11px] overflow-auto text-left leading-relaxed">
              <code>
                {codeFile === 'wxml' && wxmlCode}
                {codeFile === 'wxss' && wxssCode}
                {codeFile === 'js' && jsCode}
                {codeFile === 'json' && jsonCode}
              </code>
            </pre>
          </div>

        </div>
      )}

    </div>
  );
}
